package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
	"golang.org/x/sync/errgroup"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/cyber/cti"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	intbot "github.com/clario360/platform/internal/integration/bot"
	"github.com/clario360/platform/internal/integration/connector"
	"github.com/clario360/platform/internal/integration/connector/adapters"
	intconsumer "github.com/clario360/platform/internal/integration/consumer"
	"github.com/clario360/platform/internal/integration/drsource"
	intencrypt "github.com/clario360/platform/internal/integration/encryption"
	inthandler "github.com/clario360/platform/internal/integration/handler"
	intmodel "github.com/clario360/platform/internal/integration/model"
	intrepo "github.com/clario360/platform/internal/integration/repository"
	intservice "github.com/clario360/platform/internal/integration/service"
	jirasvc "github.com/clario360/platform/internal/integration/service/jira"
	servicenowsvc "github.com/clario360/platform/internal/integration/service/servicenow"
	slacksvc "github.com/clario360/platform/internal/integration/service/slack"
	teamssvc "github.com/clario360/platform/internal/integration/service/teams"
	webhooksvc "github.com/clario360/platform/internal/integration/service/webhook"
	"github.com/clario360/platform/internal/middleware"
	notifchannel "github.com/clario360/platform/internal/notification/channel"
	notifcfg "github.com/clario360/platform/internal/notification/config"
	"github.com/clario360/platform/internal/notification/consumer"
	"github.com/clario360/platform/internal/notification/handler"
	"github.com/clario360/platform/internal/notification/health"
	notifmetrics "github.com/clario360/platform/internal/notification/metrics" // registers Prometheus metrics on import (init) and exposes gauges to Set
	notifmw "github.com/clario360/platform/internal/notification/middleware"
	notifrepo "github.com/clario360/platform/internal/notification/repository"
	notifservice "github.com/clario360/platform/internal/notification/service"
	"github.com/clario360/platform/internal/notification/websocket"
	"github.com/clario360/platform/internal/observability"
	"github.com/clario360/platform/internal/server"
)

func main() {
	// 1. Load platform config.
	cfg, err := config.Load()
	if err != nil {
		panic("loading config: " + err.Error())
	}

	// Load notification-specific config.
	notifCfg := notifcfg.LoadFromEnv()
	if err := notifCfg.Validate(); err != nil {
		panic("invalid notification config: " + err.Error())
	}
	cfg.Server.Port = notifCfg.HTTPPort

	// 2. Initialize logger.
	logger := observability.NewLogger(
		cfg.Observability.LogLevel,
		cfg.Observability.LogFormat,
		"notification-service",
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 3. Initialize tracer.
	shutdownTracer, err := observability.InitTracer(ctx, "notification-service", cfg.Observability.OTLPEndpoint)
	if err != nil {
		logger.Warn().Err(err).Msg("failed to initialize tracer")
	} else {
		defer shutdownTracer(ctx)
	}

	// 4. Connect PostgreSQL.
	db, err := database.NewPostgresPool(ctx, cfg.Database, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer db.Close()

	// 5. Run schema migration.
	if err := notifrepo.RunMigration(ctx, db); err != nil {
		logger.Fatal().Err(err).Msg("failed to run notification schema migration")
	}
	logger.Info().Msg("notification schema migration completed")

	// 5b. Ensure the transactional outbox table exists (#12). When ready,
	// notification.created is staged in the same tx as the notification insert
	// and drained by the relay; if this fails we log and fall back to
	// best-effort direct publish (outboxReady stays false).
	outboxReady := false
	if err := outbox.EnsureSchema(ctx, db); err != nil {
		logger.Error().Err(err).Msg("failed to ensure event outbox schema — notification.created falls back to direct publish")
	} else {
		outboxReady = true
	}

	// 6. Connect Redis.
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Addr(),
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})
	defer rdb.Close()

	if err := rdb.Ping(ctx).Err(); err != nil {
		logger.Warn().Err(err).Msg("redis connection failed — continuing with degraded functionality")
	}

	// 6. Create HTTP server with middleware stack.
	srv, err := server.New(cfg, db, rdb, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create server")
	}

	// 7. Initialize Kafka producer.
	var producer *events.Producer
	kafkaProducer, err := events.NewProducer(cfg.Kafka, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("kafka producer unavailable — notification events will not be published")
	} else {
		producer = kafkaProducer
		defer producer.Close()
	}

	// 8. Initialize WebSocket hub + cross-instance fan-out bridge (#7). The
	// publisher broadcasts each real-time push to every replica over Redis and
	// the subscriber delivers to THIS replica's local hub, so a push reaches the
	// connection wherever it lives. Publishing is publish-only (the origin's own
	// subscriber does its local delivery), avoiding double-delivery; if Redis is
	// unreachable the channels fall back to the local hub.
	hub := websocket.NewHub(notifCfg.WSMaxConnectionsPerUser, logger)
	wsFanoutPublisher := websocket.NewFanoutPublisher(rdb, websocket.DefaultFanoutChannel, logger)
	wsFanoutSubscriber := websocket.NewFanoutSubscriber(rdb, websocket.DefaultFanoutChannel, hub, logger)

	// 9. Initialize repositories.
	notifRepo := notifrepo.NewNotificationRepository(db, logger)
	prefRepo := notifrepo.NewPreferenceRepository(db, logger)
	deliveryRepo := notifrepo.NewDeliveryRepository(db, logger)
	webhookRepo := notifrepo.NewWebhookRepository(db, logger)
	deadLetterRepo := notifrepo.NewDeadLetterRepository(db, logger)
	// Compliance & templating (#17, #18): the suppression list consulted before
	// outbound dispatch, and the DB-backed template override store.
	suppressionRepo := notifrepo.NewSuppressionRepository(db, logger)
	templateRepo := notifrepo.NewTemplateRepository(db, logger)
	integrationRepo := intrepo.NewIntegrationRepository(db, logger)
	integrationDeliveryRepo := intrepo.NewDeliveryRepository(db, logger)
	ticketLinkRepo := intrepo.NewTicketLinkRepository(db, logger)

	// 10. Initialize services.
	tmplSvc := notifservice.NewTemplateService(logger)
	// DB-backed template store (#18): prefer per-tenant / seeded templates, then
	// fall back to the embedded Go-const defaults. Seeding is insert-if-absent so
	// operator customizations survive restarts; a seed error is non-fatal (the
	// embedded defaults still render).
	tmplSvc.SetStore(templateRepo)
	if err := tmplSvc.SeedDefaultTemplates(ctx, templateRepo); err != nil {
		logger.Warn().Err(err).Msg("failed to seed default notification templates — using embedded defaults")
	}
	prefSvc := notifservice.NewPreferenceService(prefRepo, rdb, logger)

	// RFC 8058 one-click unsubscribe (#17): resolve the signing secret and public
	// base URL, deriving sensible defaults when the dedicated env vars are unset.
	// If neither a secret nor a base URL resolves, outbound email simply omits the
	// List-Unsubscribe headers (backward compatible).
	unsubSecret := notifCfg.UnsubscribeSecret
	if unsubSecret == "" {
		unsubSecret = notifCfg.WebhookHMACSecret
	}
	unsubBaseURL := notifCfg.UnsubscribeBaseURL
	if unsubBaseURL == "" && strings.TrimSpace(notifCfg.GatewayURL) != "" {
		unsubBaseURL = strings.TrimRight(notifCfg.GatewayURL, "/") + "/api/v1/notifications/unsubscribe"
	}

	// Initialize channels. Both the websocket and in_app channels push the same
	// real-time WSMessage, so both use the cross-instance fan-out publisher (#7).
	websocketChannel := notifchannel.NewWebSocketChannel(hub, logger)
	websocketChannel.SetFanout(wsFanoutPublisher)
	inAppChannel := notifchannel.NewInAppChannel(hub, logger)
	inAppChannel.SetFanout(wsFanoutPublisher)
	channels := map[string]notifchannel.Channel{
		"in_app":    inAppChannel,
		"websocket": websocketChannel,
		"push":      websocketChannel,
		"email": notifchannel.NewEmailChannel(notifchannel.EmailConfig{
			Provider:           notifCfg.EmailProvider,
			SMTPHost:           notifCfg.SMTPHost,
			SMTPPort:           notifCfg.SMTPPort,
			SMTPUser:           notifCfg.SMTPUsername,
			SMTPPass:           notifCfg.SMTPPassword,
			SMTPFrom:           notifCfg.SMTPFrom,
			TLSEnabled:         notifCfg.SMTPTLSEnabled,
			SendGridAPIKey:     notifCfg.SendGridAPIKey,
			SendGridFrom:       notifCfg.SendGridFrom,
			UnsubscribeBaseURL: unsubBaseURL,
			UnsubscribeSecret:  unsubSecret,
		}, tmplSvc, logger),
		"webhook": notifchannel.NewWebhookChannel(
			webhookRepo,
			time.Duration(notifCfg.WebhookTimeoutSec)*time.Second,
			notifCfg.WebhookHMACSecret,
			notifCfg.Environment,
			logger,
		),
	}

	dispatcher := notifservice.NewDispatcherService(channels, deliveryRepo, logger)
	// Honor the compliance suppression list (#17) before dispatching email/webhook.
	dispatcher.SetSuppressionChecker(suppressionRepo)
	notifSvc := notifservice.NewNotificationService(notifRepo, prefSvc, dispatcher, tmplSvc, producer, rdb, logger)
	if outboxReady {
		// Route notification.created through the transactional outbox (#12).
		notifSvc.SetOutbox(true)
	}
	digestSvc := notifservice.NewDigestService(notifRepo, prefRepo, tmplSvc, dispatcher, notifCfg.DigestDailyUTCHour, notifCfg.DigestWeeklyDay, notifCfg.PublicAppURL, logger)
	// Durable delivery-retry + quiet-hours flush worker (#6, #10). It claims due
	// failed/retrying rows and deferred pending rows, re-invokes the channel, and
	// dead-letters after the retry budget is exhausted.
	retryWorker := notifservice.NewRetryWorker(
		deliveryRepo,
		webhookRepo,
		channels,
		time.Duration(notifCfg.RetryIntervalSec)*time.Second,
		notifCfg.RetryBatchSize,
		logger,
	)
	guard := events.NewIdempotencyGuard(rdb, 24*time.Hour)
	crossSuiteMetrics := events.NewCrossSuiteMetrics(prometheus.DefaultRegisterer)
	dlqTracker := events.NewDLQTracker(rdb)

	encryptor, err := intencrypt.NewConfigEncryptor(cfg.Encryption.Key, "notification-service")
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to initialize integration config encryptor")
	}
	clarioAPI := intservice.NewClarioAPIClient(notifCfg.GatewayURL, notifCfg.IAMServiceURL, srv.JWTManager, logger)
	slackClient := slacksvc.NewClient(15*time.Second, notifCfg.PublicAppURL)
	teamsClient := teamssvc.NewClient(15*time.Second, notifCfg.PublicAppURL)
	jiraClient := jirasvc.NewClient(20 * time.Second)
	snClient := servicenowsvc.NewClient(25 * time.Second)
	webhookClient := webhooksvc.NewClient(15 * time.Second)
	slackMapper := slacksvc.NewUserMapper(slackClient, rdb, logger)
	jiraTicketSvc := jirasvc.NewTicketService(jiraClient, clarioAPI, ticketLinkRepo, notifCfg.PublicAppURL)
	snIncidentSvc := servicenowsvc.NewIncidentService(snClient, clarioAPI, ticketLinkRepo, notifCfg.PublicAppURL)

	// Build the single connector registry from the SAME client instances above.
	// adapters.BuildDefaultRegistry wraps the five existing clients
	// (slack/teams/webhook/jira/servicenow) AND registers the three new pure-SDK
	// connectors (email/pagerduty/rest), so all outbound dispatch and all config
	// validation flow through one manifest-driven registry. The slack/teams/jira/
	// servicenow/webhook clients themselves remain owned here for the inbound
	// webhook/OAuth/bot handlers (those are separate from outbound dispatch).
	connectorRegistry := adapters.BuildDefaultRegistry(adapters.Clients{
		Slack:      slackClient,
		Teams:      teamsClient,
		Webhook:    webhookClient,
		Jira:       jiraTicketSvc,
		ServiceNow: snIncidentSvc,
	})
	// Wire DataStream/DR rendering: outbound deliveries of datastream.dr.* events
	// are enriched by the DR renderer before dispatch, so every connector (the
	// five legacy clients and the three new connectors) emits DR-appropriate
	// output. Non-DR events pass through unchanged.
	connectorRegistry.SetSendTransform(connector.EventTransform(drsource.NewEventTransform(notifCfg.PublicAppURL)))

	integrationSvc := intservice.NewIntegrationService(
		integrationRepo,
		integrationDeliveryRepo,
		ticketLinkRepo,
		encryptor,
		producer,
		connectorRegistry,
		slackClient,
		teamsClient,
		jiraTicketSvc,
		snIncidentSvc,
		webhookClient,
		logger,
	)
	integrationDeliverySvc := intservice.NewDeliveryService(
		integrationDeliveryRepo,
		integrationRepo,
		encryptor,
		rdb,
		connectorRegistry,
		slackClient,
		teamsClient,
		jiraTicketSvc,
		snIncidentSvc,
		webhookClient,
		logger,
	)
	integrationWorker := intservice.NewDeliveryWorker(integrationDeliverySvc, integrationDeliveryRepo, logger)
	botRouter := intbot.NewRouter(clarioAPI, logger)
	gatewayURL := strings.TrimRight(notifCfg.GatewayURL, "/")
	providerStatuses := []inthandler.ProviderStatus{
		{
			Type:             intmodel.IntegrationTypeSlack,
			Name:             "Slack",
			Description:      "Workspace install plus slash commands, interactions, and outbound alert delivery.",
			SetupMode:        "oauth",
			Configured:       strings.TrimSpace(notifCfg.SlackClientID) != "" && strings.TrimSpace(notifCfg.SlackClientSecret) != "" && strings.TrimSpace(notifCfg.SlackSigningSecret) != "",
			OAuthEnabled:     true,
			OAuthStartURL:    gatewayURL + "/api/v1/integrations/slack/oauth/start",
			MissingConfig:    missingProviderConfig(map[string]string{"NOTIF_SLACK_CLIENT_ID": notifCfg.SlackClientID, "NOTIF_SLACK_CLIENT_SECRET": notifCfg.SlackClientSecret, "NOTIF_SLACK_SIGNING_SECRET": notifCfg.SlackSigningSecret}),
			SupportsInbound:  true,
			SupportsOutbound: true,
		},
		{
			Type:             intmodel.IntegrationTypeTeams,
			Name:             "Microsoft Teams",
			Description:      "Manual Bot Framework setup for outbound cards and inbound bot commands.",
			SetupMode:        "manual",
			Configured:       true,
			OAuthEnabled:     false,
			SupportsInbound:  true,
			SupportsOutbound: true,
		},
		{
			Type:             intmodel.IntegrationTypeJira,
			Name:             "Jira Cloud",
			Description:      "OAuth install for outbound ticket creation and inbound status synchronization.",
			SetupMode:        "oauth",
			Configured:       strings.TrimSpace(notifCfg.AtlassianClientID) != "" && strings.TrimSpace(notifCfg.AtlassianClientSecret) != "",
			OAuthEnabled:     true,
			OAuthStartURL:    gatewayURL + "/api/v1/integrations/jira/oauth/start",
			MissingConfig:    missingProviderConfig(map[string]string{"NOTIF_ATLASSIAN_CLIENT_ID": notifCfg.AtlassianClientID, "NOTIF_ATLASSIAN_CLIENT_SECRET": notifCfg.AtlassianClientSecret}),
			SupportsInbound:  true,
			SupportsOutbound: true,
		},
		{
			Type:             intmodel.IntegrationTypeServiceNow,
			Name:             "ServiceNow",
			Description:      "Manual incident integration with bidirectional webhook synchronization.",
			SetupMode:        "manual",
			Configured:       true,
			OAuthEnabled:     false,
			SupportsInbound:  true,
			SupportsOutbound: true,
		},
		{
			Type:             intmodel.IntegrationTypeWebhook,
			Name:             "Generic Webhook",
			Description:      "Signed outbound webhook delivery to arbitrary HTTP endpoints.",
			SetupMode:        "manual",
			Configured:       true,
			OAuthEnabled:     false,
			SupportsInbound:  false,
			SupportsOutbound: true,
		},
	}

	// 11. Initialize handlers.
	notifHandler := handler.NewNotificationHandler(notifSvc, notifRepo, logger)
	prefHandler := handler.NewPreferenceHandler(prefSvc, webhookRepo, deliveryRepo, notifCfg.Environment, logger)
	wsHandler := handler.NewWebSocketHandler(hub, srv.JWTManager, notifRepo, notifCfg, logger)
	adminHandler := handler.NewAdminHandler(notifSvc, deliveryRepo, dispatcher, logger)
	// Pass a genuinely-nil publisher (not a typed-nil *events.Producer) when the
	// producer is unavailable, so DLQ replay reports 503 instead of panicking.
	var dlqHandler *handler.DLQHandler
	if producer != nil {
		dlqHandler = handler.NewDLQHandler(deadLetterRepo, producer, logger)
	} else {
		dlqHandler = handler.NewDLQHandler(deadLetterRepo, nil, logger)
	}
	integrationHandler := inthandler.NewIntegrationHandler(integrationSvc, providerStatuses, connectorRegistry, logger)
	slackHandler := inthandler.NewSlackHandler(
		integrationSvc,
		clarioAPI,
		slackClient,
		slackMapper,
		botRouter,
		producer,
		rdb,
		slacksvc.OAuthConfig{
			ClientID:     notifCfg.SlackClientID,
			ClientSecret: notifCfg.SlackClientSecret,
			RedirectURI:  strings.TrimRight(notifCfg.GatewayURL, "/") + "/api/v1/integrations/slack/oauth/callback",
			Scopes:       notifCfg.SlackScopes,
		},
		notifCfg.SlackSigningSecret,
		notifCfg.PublicAppURL,
		time.Duration(notifCfg.IntegrationStateTTLMin)*time.Minute,
		logger,
	)
	teamsHandler := inthandler.NewTeamsHandler(integrationSvc, clarioAPI, teamsClient, botRouter, producer, logger)
	jiraHandler := inthandler.NewJiraHandler(
		integrationSvc,
		jiraTicketSvc,
		producer,
		rdb,
		jirasvc.OAuthConfig{
			ClientID:     notifCfg.AtlassianClientID,
			ClientSecret: notifCfg.AtlassianClientSecret,
			RedirectURI:  strings.TrimRight(notifCfg.GatewayURL, "/") + "/api/v1/integrations/jira/oauth/callback",
			Scopes:       notifCfg.AtlassianScopes,
		},
		notifCfg.PublicAppURL,
		time.Duration(notifCfg.IntegrationStateTTLMin)*time.Minute,
		logger,
	)
	serviceNowHandler := inthandler.NewServiceNowHandler(integrationSvc, snIncidentSvc, producer, logger)
	webhookHandler := inthandler.NewWebhookHandler(logger)

	// 12. Initialize health checker.
	smtpAddr := ""
	if notifCfg.EmailProvider == "smtp" && notifCfg.SMTPHost != "" {
		smtpAddr = fmt.Sprintf("%s:%d", notifCfg.SMTPHost, notifCfg.SMTPPort)
	}
	healthChecker := health.NewChecker(db, rdb, cfg.Kafka.Brokers, smtpAddr, logger)

	// Override health and metrics endpoints.
	srv.Router.Get("/healthz", health.LivenessHandler())
	srv.Router.Get("/readyz", healthChecker.ReadinessHandler())
	srv.Router.Handle("/metrics", promhttp.Handler())

	// 13. WebSocket endpoint (authenticated via query param, not middleware).
	srv.Router.Get("/ws/v1/notifications", wsHandler.HandleWebSocket)

	// 13b. Public, token-verified one-click unsubscribe (#17, RFC 8058).
	//
	// Registered as STANDALONE routes here (NOT inside the /api/v1/notifications
	// Route group below) so they bypass that group's Auth + TenantGuard +
	// RateLimiter middleware — the sole credential is the HMAC-signed token in the
	// URL. These static paths coexist with the mounted /api/v1/notifications
	// subrouter without shadowing it (a static segment beats the subrouter's
	// wildcard). This block is intentionally separate from the API route wiring.
	unsubscribeHandler := handler.NewUnsubscribeHandler(unsubSecret, suppressionRepo, prefSvc, logger)
	srv.Router.Get("/api/v1/notifications/unsubscribe", unsubscribeHandler.Confirm)
	srv.Router.Post("/api/v1/notifications/unsubscribe", unsubscribeHandler.OneClick)

	// 14. Register API routes.
	srv.Router.Route("/api/v1/notifications", func(r chi.Router) {
		r.Use(middleware.Auth(srv.JWTManager))
		r.Use(notifmw.TenantGuard)
		r.Use(notifmw.RateLimiter(rdb, notifCfg.RateLimitPerMinute, logger))

		// Notification endpoints.
		r.Get("/", notifHandler.ListNotifications)
		r.Get("/counts", notifHandler.GetCounts)
		r.Get("/unread-count", notifHandler.UnreadCount)
		r.Get("/read-all", notifHandler.MarkAllRead) // PUT mapped to GET for simplicity; see below
		r.Put("/read-all", notifHandler.MarkAllRead)
		r.Post("/bulk", notifHandler.BulkDeleteNotifications)
		r.Get("/{id}", notifHandler.GetNotification)
		r.Put("/{id}/read", notifHandler.MarkRead)
		r.Delete("/{id}", notifHandler.DeleteNotification)

		// Preference endpoints.
		r.Get("/preferences", prefHandler.GetPreferences)
		r.Put("/preferences", prefHandler.UpdatePreferences)

		// Webhook + operational endpoints (control plane).
		//
		// SEC-hardening (Wave B #2): these routes expose the tenant-wide
		// integrations surface — webhook config (including secrets), test/rotate,
		// delivery-log inspection + retry, operational test-send, cross-channel
		// stats, and bulk retry-failed. Previously the group carried only
		// Auth+TenantGuard+RateLimiter, so ANY authenticated tenant user could
		// register/exfiltrate webhooks or fire retries. Each is now gated behind
		// notifications:manage (super_admin's admin:* and tenant_admin hold it).
		// A user's OWN notification reads/marks and OWN delivery preferences stay
		// open (handled above / by the preference routes).
		manage := middleware.RequirePermission(auth.PermNotificationsManage)
		r.With(manage).Get("/webhooks", prefHandler.ListWebhooks)
		r.With(manage).Post("/webhooks", prefHandler.CreateWebhook)
		r.With(manage).Get("/webhooks/{id}", prefHandler.GetWebhook)
		r.With(manage).Put("/webhooks/{id}", prefHandler.UpdateWebhook)
		r.With(manage).Delete("/webhooks/{id}", prefHandler.DeleteWebhook)
		r.With(manage).Post("/webhooks/{id}/test", prefHandler.TestWebhook)
		r.With(manage).Post("/webhooks/{id}/rotate", prefHandler.RotateWebhookSecret)
		r.With(manage).Get("/webhooks/{id}/deliveries", prefHandler.ListWebhookDeliveries)
		r.With(manage).Post("/webhooks/{id}/deliveries/{deliveryId}/retry", prefHandler.RetryWebhookDelivery)

		// Admin endpoints.
		r.With(manage).Post("/test", adminHandler.SendTestNotification)
		r.With(manage).Get("/delivery-stats", adminHandler.GetDeliveryStats)
		r.With(manage).Post("/retry-failed", adminHandler.RetryFailed)

		// Durable dead-letter store (#14): inspect / replay / acknowledge failed
		// events. Tenant-scoped and gated by notifications:manage.
		r.With(manage).Get("/dlq", dlqHandler.List)
		r.With(manage).Post("/dlq/{id}/replay", dlqHandler.Replay)
		r.With(manage).Post("/dlq/{id}/ack", dlqHandler.Ack)
	})
	if strings.TrimSpace(notifCfg.InternalToken) != "" {
		srv.Router.Route("/internal/notifications", func(r chi.Router) {
			r.Use(middleware.ServiceToken(notifCfg.InternalToken))
			r.Post("/", adminHandler.CreateInternalNotification)
		})
		logger.Info().Msg("internal notification API enabled (service-token auth)")
	}
	inthandler.RegisterRoutes(srv.Router, inthandler.RouteDependencies{
		JWTManager:         srv.JWTManager,
		Redis:              rdb,
		RateLimitPerMinute: notifCfg.RateLimitPerMinute,
		Integration:        integrationHandler,
		Slack:              slackHandler,
		Teams:              teamsHandler,
		Jira:               jiraHandler,
		ServiceNow:         serviceNowHandler,
		Webhook:            webhookHandler,
		Logger:             logger,
	})

	// 15. Initialize Kafka consumer.
	// dlqOverrides maps a source topic to an explicit DLQ topic (default is
	// topic+".dlq"). Shared by the live consumer's SetDLQTopicOverrides and the
	// durable DLQ ingestion consumer's topic list so both agree on where failed
	// events land (#14).
	dlqOverrides := map[string]string{
		cti.TopicCTIAlerts: cti.TopicCTIDLQ,
	}
	var notifConsumer *consumer.NotificationConsumer
	kafkaConsumer, err := events.NewConsumer(cfg.Kafka, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("kafka consumer unavailable — notification event ingestion disabled")
	} else {
		kafkaConsumer.SetDeadLetterProducer(producer)
		kafkaConsumer.SetCrossSuiteMetrics(crossSuiteMetrics)
		kafkaConsumer.SetDLQTracker(dlqTracker, "notification-service")
		kafkaConsumer.SetDLQTopicOverrides(dlqOverrides)
		recipientResolver := consumer.NewRecipientResolver(
			notifCfg.IAMServiceURL,
			notifCfg.DataServiceURL,
			notifCfg.ActaServiceURL,
			notifCfg.CyberServiceURL,
			logger,
		)
		notifConsumer = consumer.NewNotificationConsumer(kafkaConsumer, notifSvc, recipientResolver, guard, crossSuiteMetrics, logger)
	}
	var integrationConsumer *intconsumer.IntegrationConsumer
	integrationKafkaConsumer, err := events.NewConsumerWithConfig(events.ConsumerConfig{
		Brokers:             cfg.Kafka.Brokers,
		GroupID:             "integration-delivery-consumer",
		AutoOffsetReset:     cfg.Kafka.AutoOffsetReset,
		WorkersPerPartition: 1,
	}, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("integration kafka consumer unavailable — external delivery ingestion disabled")
	} else {
		integrationKafkaConsumer.SetDeadLetterProducer(producer)
		integrationKafkaConsumer.SetCrossSuiteMetrics(crossSuiteMetrics)
		integrationKafkaConsumer.SetDLQTracker(dlqTracker, "notification-service")
		integrationConsumer = intconsumer.NewIntegrationConsumer(integrationKafkaConsumer, integrationRepo, integrationDeliverySvc, rdb, time.Minute, logger)
	}

	// Durable DLQ ingestion (#14): a separate consumer group tails the DLQ topics
	// fed by the consumers above and persists each failed event to
	// notification_dead_letters so it survives restarts and is inspectable/
	// replayable via the /api/v1/notifications/dlq admin routes.
	var dlqConsumer *consumer.DLQConsumer
	dlqKafkaConsumer, err := events.NewConsumerWithConfig(events.ConsumerConfig{
		Brokers:             cfg.Kafka.Brokers,
		GroupID:             "notification-dlq-consumer",
		AutoOffsetReset:     cfg.Kafka.AutoOffsetReset,
		WorkersPerPartition: 1,
	}, logger)
	if err != nil {
		logger.Warn().Err(err).Msg("dlq kafka consumer unavailable — durable dead-letter capture disabled")
	} else {
		dlqConsumer = consumer.NewDLQConsumer(dlqKafkaConsumer, deadLetterRepo, consumer.DLQTopics(dlqOverrides), logger)
	}

	// 15b. Observability admin server (Wave E #1).
	//
	// The main HTTP server already serves /metrics inline (step 12), but
	// Prometheus scrapes the dedicated admin port (default 9094, see
	// deploy/prometheus/prometheus.yml and deploy/monitoring/prometheus/
	// prometheus.yml). Serve /metrics + health probes on that port from the
	// default Prometheus registry (where the notification and observability
	// collectors register), mirroring bootstrap.AdminServer. The inline
	// /metrics on the main port is retained and harmless.
	var adminServer *http.Server
	if notifCfg.AdminPort > 0 {
		adminRouter := chi.NewRouter()
		adminRouter.Use(middleware.RecoveryWithLogger(logger))
		adminRouter.Handle("/metrics", promhttp.Handler())
		adminRouter.Get("/healthz", health.LivenessHandler())
		adminRouter.Get("/readyz", healthChecker.ReadinessHandler())
		// DLQ count is an ops-plane probe: it lives on the admin/scrape port next
		// to /metrics, not on the public service router where it was reachable
		// without authentication.
		adminRouter.Get("/api/v1/admin/dlq/count", events.DLQCountHandler("notification-service", dlqTracker, logger))
		adminServer = &http.Server{
			Addr:         fmt.Sprintf(":%d", notifCfg.AdminPort),
			Handler:      adminRouter,
			ReadTimeout:  5 * time.Second,
			WriteTimeout: 10 * time.Second,
			IdleTimeout:  30 * time.Second,
		}
	}

	// 16. Start all components via errgroup.
	g, gCtx := errgroup.WithContext(ctx)

	// Observability admin server (/metrics, /healthz, /readyz) on the scrape
	// port (Wave E #1).
	if adminServer != nil {
		g.Go(func() error {
			logger.Info().Int("admin_port", notifCfg.AdminPort).Msg("notification-service admin/metrics server starting")
			if err := adminServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				return err
			}
			return nil
		})
	}

	// Observability metrics sampler (Wave E #12): periodically populates gauges
	// that reflect point-in-time state rather than events — the durable DLQ
	// depth and the Kafka consumer lag per subscribed topic. The delivery
	// retry-backlog gauge is sampled by the retry worker on its own loop.
	g.Go(func() error {
		const sampleInterval = 30 * time.Second
		ticker := time.NewTicker(sampleInterval)
		defer ticker.Stop()

		kafkaHealth := events.NewHealthChecker(cfg.Kafka, logger)
		lagTopics := consumer.ExtractEventTopics()

		sample := func() {
			// Durable DLQ depth: entries still pending operator action.
			if n, err := deadLetterRepo.Count(gCtx, "", "pending"); err != nil {
				logger.Debug().Err(err).Msg("dlq depth sample failed")
			} else {
				notifmetrics.DLQDepth.Set(float64(n))
			}

			// Kafka consumer lag: only meaningful when a live consumer exists.
			if notifConsumer != nil && len(lagTopics) > 0 {
				lag, err := kafkaHealth.ConsumerLag(gCtx, lagTopics)
				if err != nil {
					logger.Debug().Err(err).Msg("consumer lag sample failed")
				} else {
					for topic, partitions := range lag {
						var total int64
						for _, l := range partitions {
							total += l
						}
						notifmetrics.KafkaConsumerLag.WithLabelValues(topic).Set(float64(total))
					}
				}
			}
		}

		sample() // prime the gauges immediately on startup
		for {
			select {
			case <-gCtx.Done():
				return nil
			case <-ticker.C:
				sample()
			}
		}
	})

	// Cross-instance WebSocket fan-out subscriber (#7).
	g.Go(func() error {
		return wsFanoutSubscriber.Run(gCtx)
	})

	// Transactional-outbox relay (#12): drains staged notification.created events
	// to Kafka. Only started when the outbox schema is ready and a live producer
	// exists; otherwise staged events wait durably until a restart with a
	// reachable broker.
	if outboxReady && producer != nil {
		relay := outbox.NewRelay(db, producer, outbox.Config{}, logger, outbox.NewMetrics(prometheus.DefaultRegisterer))
		g.Go(func() error {
			if err := relay.Run(gCtx); err != nil {
				logger.Error().Err(err).Msg("outbox relay stopped with error")
				return err
			}
			return nil
		})
	}

	// Durable DLQ ingestion consumer (#14).
	if dlqConsumer != nil {
		g.Go(func() error {
			return dlqConsumer.Start(gCtx)
		})
	}

	// WebSocket hub.
	g.Go(func() error {
		return hub.Run(gCtx)
	})

	// HTTP server.
	g.Go(func() error {
		logger.Info().Int("port", cfg.Server.Port).Msg("notification-service HTTP server starting")
		if err := srv.HTTPServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			return err
		}
		return nil
	})

	// Kafka consumer.
	if notifConsumer != nil {
		g.Go(func() error {
			return notifConsumer.Start(gCtx)
		})
	}
	if integrationConsumer != nil {
		g.Go(func() error {
			return integrationConsumer.Start(gCtx)
		})
	}

	// Digest scheduler.
	if notifCfg.DigestEnabled {
		g.Go(func() error {
			return digestSvc.RunScheduler(gCtx)
		})
	}

	// Delivery retry + quiet-hours flush worker (#6, #10).
	if notifCfg.RetryWorkerEnabled {
		g.Go(func() error {
			return retryWorker.Run(gCtx)
		})
	}

	g.Go(func() error {
		return integrationWorker.Run(gCtx)
	})

	// 17. Wait for shutdown signal.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		logger.Info().Str("signal", sig.String()).Msg("shutdown signal received")
	case <-gCtx.Done():
		logger.Info().Msg("context cancelled")
	}

	// 18. Graceful shutdown sequence.
	cancel()

	// Shutdown HTTP server first (stops accepting new connections).
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	if err := srv.HTTPServer.Shutdown(shutdownCtx); err != nil {
		logger.Error().Err(err).Msg("HTTP server shutdown error")
	}
	if adminServer != nil {
		if err := adminServer.Shutdown(shutdownCtx); err != nil {
			logger.Error().Err(err).Msg("admin/metrics server shutdown error")
		}
	}

	// Stop Kafka consumer.
	if notifConsumer != nil {
		if err := notifConsumer.Stop(); err != nil {
			logger.Error().Err(err).Msg("kafka consumer shutdown error")
		}
	}
	if integrationConsumer != nil {
		if err := integrationConsumer.Stop(); err != nil {
			logger.Error().Err(err).Msg("integration kafka consumer shutdown error")
		}
	}
	if dlqConsumer != nil {
		if err := dlqConsumer.Stop(); err != nil {
			logger.Error().Err(err).Msg("dlq kafka consumer shutdown error")
		}
	}

	// Hub shutdown happens via context cancellation (gCtx.Done in hub.Run).

	if err := g.Wait(); err != nil {
		logger.Error().Err(err).Msg("errgroup finished with error")
	}

	logger.Info().Msg("notification-service stopped")
}

func missingProviderConfig(values map[string]string) []string {
	missing := make([]string, 0, len(values))
	for key, value := range values {
		if strings.TrimSpace(value) == "" {
			missing = append(missing, key)
		}
	}
	return missing
}
