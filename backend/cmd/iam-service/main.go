package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"golang.org/x/sync/errgroup"

	aigovbenchmark "github.com/clario360/platform/internal/aigovernance/benchmark"
	aigovdrift "github.com/clario360/platform/internal/aigovernance/drift"
	aigovhandler "github.com/clario360/platform/internal/aigovernance/handler"
	aigovrepo "github.com/clario360/platform/internal/aigovernance/repository"
	aigovservice "github.com/clario360/platform/internal/aigovernance/service"
	aigovshadow "github.com/clario360/platform/internal/aigovernance/shadow"
	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/authz"
	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	filemetrics "github.com/clario360/platform/internal/filemanager/metrics"
	filerepo "github.com/clario360/platform/internal/filemanager/repository"
	fileservice "github.com/clario360/platform/internal/filemanager/service"
	iamhandler "github.com/clario360/platform/internal/iam/handler"
	iamrepo "github.com/clario360/platform/internal/iam/repository"
	iamservice "github.com/clario360/platform/internal/iam/service"
	"github.com/clario360/platform/internal/middleware"
	notebookconsumer "github.com/clario360/platform/internal/notebook/consumer"
	notebookhandler "github.com/clario360/platform/internal/notebook/handler"
	notebookservice "github.com/clario360/platform/internal/notebook/service"
	notifchannel "github.com/clario360/platform/internal/notification/channel"
	notifcfg "github.com/clario360/platform/internal/notification/config"
	notifservice "github.com/clario360/platform/internal/notification/service"
	"github.com/clario360/platform/internal/observability/bootstrap"
	"github.com/clario360/platform/internal/observability/tracing"
	onboardinghandler "github.com/clario360/platform/internal/onboarding/handler"
	onboardingmiddleware "github.com/clario360/platform/internal/onboarding/middleware"
	onboardingrepo "github.com/clario360/platform/internal/onboarding/repository"
	onboardingsvc "github.com/clario360/platform/internal/onboarding/service"
	platformabac "github.com/clario360/platform/internal/platform/abac"
	platformaifleet "github.com/clario360/platform/internal/platform/aifleet"
	platformfleet "github.com/clario360/platform/internal/platform/fleet"
	platformidentity "github.com/clario360/platform/internal/platform/identity"
	platformprovisioning "github.com/clario360/platform/internal/platform/provisioning"
	platformtenants "github.com/clario360/platform/internal/platform/tenants"
	"github.com/clario360/platform/internal/security"
	"github.com/clario360/platform/pkg/storage"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Load legacy config for auth and Kafka settings.
	legacyCfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("loading config")
	}

	env := envOrDefault("ENVIRONMENT", "development")

	cfg := &bootstrap.ServiceConfig{
		Name:        "iam-service",
		Version:     "1.0.0",
		Environment: env,
		Port:        8081,
		AdminPort:   9081,
		LogLevel:    legacyCfg.Observability.LogLevel,
		DB: &bootstrap.DBConfig{
			URL:               "postgres://" + legacyCfg.Database.User + ":" + legacyCfg.Database.Password + "@" + legacyCfg.Database.Host + ":" + intToStr(legacyCfg.Database.Port) + "/platform_core?sslmode=" + legacyCfg.Database.SSLMode,
			MinConns:          legacyCfg.Database.MaxIdleConns,
			MaxConns:          legacyCfg.Database.MaxOpenConns,
			MaxConnLife:       legacyCfg.Database.ConnMaxLifetime,
			MaxConnIdle:       5 * time.Minute,
			HealthCheckPeriod: 1 * time.Minute,
		},
		Redis: &bootstrap.RedisConfig{
			Addr:     legacyCfg.Redis.Addr(),
			Password: legacyCfg.Redis.Password,
			DB:       legacyCfg.Redis.DB,
		},
		Kafka: &bootstrap.KafkaConfig{
			Brokers: legacyCfg.Kafka.Brokers,
			GroupID: "iam-service",
		},
		Tracing: tracing.TracerConfig{
			Enabled:     legacyCfg.Observability.OTLPEndpoint != "",
			Endpoint:    legacyCfg.Observability.OTLPEndpoint,
			ServiceName: "iam-service",
			Version:     "1.0.0",
			Environment: env,
			SampleRate:  0.1,
			Insecure:    true,
		},
		ShutdownTimeout: legacyCfg.Server.ShutdownTimeout,
		ReadTimeout:     legacyCfg.Server.ReadTimeout,
		WriteTimeout:    legacyCfg.Server.WriteTimeout,
	}

	svc, err := bootstrap.Bootstrap(ctx, cfg)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to bootstrap iam-service")
	}

	// Run platform_core migrations before any repository is initialized.
	platformMigrationsPath := filepath.Join(resolveMigrationsBasePath(), "platform_core")
	if err := database.RunMigrations(cfg.DB.URL, platformMigrationsPath); err != nil {
		svc.Logger.Fatal().Err(err).Msg("failed to run platform_core migrations")
	}
	svc.Logger.Info().Msg("platform_core migrations applied")

	// Register IAM-specific metrics.
	svc.Metrics.Counter("iam_logins_total", "Total login attempts", []string{"status", "method"})
	svc.Metrics.Counter("iam_tokens_issued_total", "Total tokens issued", []string{"grant_type"})
	// Monitoring alert metric (used by clario360-alerts.yaml for brute-force detection).
	svc.Metrics.Counter("clario360_auth_login_failures_total", "Failed login attempts by source IP", []string{"ip"})

	// Initialize Kafka producer (optional — graceful degradation if unavailable).
	var producer *events.Producer
	kafkaProducer, producerErr := events.NewProducer(legacyCfg.Kafka, svc.Logger)
	if producerErr != nil {
		svc.Logger.Warn().Err(producerErr).Msg("kafka producer unavailable — events will not be published")
	} else {
		producer = kafkaProducer
		defer producer.Close()
	}

	// JWT Manager.
	jwtMgr, err := auth.NewJWTManager(legacyCfg.Auth)
	if err != nil {
		svc.Logger.Fatal().Err(err).Msg("failed to create JWT manager")
	}

	// Repositories (using raw pool for backward compatibility with existing repos).
	userRepo := iamrepo.NewUserRepository(svc.DBPool)
	roleRepo := iamrepo.NewRoleRepository(svc.DBPool)
	sessionRepo := iamrepo.NewSessionRepository(svc.DBPool)
	tenantRepo := iamrepo.NewTenantRepository(svc.DBPool)
	apiKeyRepo := iamrepo.NewAPIKeyRepository(svc.DBPool)
	webauthnRepo := iamrepo.NewWebAuthnRepository(svc.DBPool)
	magicLinkRepo := iamrepo.NewMagicLinkRepository(svc.DBPool)
	trustedDeviceRepo := iamrepo.NewTrustedDeviceRepository(svc.DBPool)
	dashboardPreferenceRepo := iamrepo.NewDashboardPreferenceRepository(svc.DBPool)

	// Services.
	authSvc := iamservice.NewAuthService(
		userRepo, sessionRepo, roleRepo, tenantRepo,
		jwtMgr, svc.Redis, producer, svc.Logger,
		legacyCfg.Auth.BcryptCost, legacyCfg.Auth.RefreshTokenTTL,
	)
	userSvc := iamservice.NewUserService(userRepo, roleRepo, sessionRepo, svc.Redis, producer, svc.Logger, legacyCfg.Auth.BcryptCost)
	roleSvc := iamservice.NewRoleService(roleRepo, userRepo, producer, svc.Logger)
	tenantSvc := iamservice.NewTenantService(tenantRepo, roleRepo, userRepo, svc.DBPool, producer, svc.Logger, legacyCfg.Auth.BcryptCost)
	apiKeySvc := iamservice.NewAPIKeyService(apiKeyRepo, producer, svc.Logger)
	oauthClients := []iamservice.OAuthClient{
		{
			ClientID:     "jupyterhub",
			ClientSecret: envOrDefault("JUPYTERHUB_OAUTH_CLIENT_SECRET", ""),
			RedirectURIs: splitCSV(
				envOrDefault("JUPYTERHUB_OAUTH_CALLBACK_URL", "https://notebooks.clario360.sa/hub/oauth_callback"),
			),
			Scopes:      []string{"openid", "profile", "email", "roles"},
			RequirePKCE: true,
		},
	}
	oauthClients = append(oauthClients, loadAdditionalOAuthClientsFromEnv(svc.Logger)...)
	oauthSvc := iamservice.NewOAuthService(
		jwtMgr,
		authSvc,
		userRepo,
		tenantRepo,
		svc.Redis,
		envOrDefault("CLARIO360_PUBLIC_URL", "http://localhost:8080"),
		envOrDefault("NOTEBOOK_LOGIN_URL", envOrDefault("CLARIO360_APP_URL", "http://localhost:3000")+"/login"),
		oauthClients,
		svc.Logger,
	)
	// External identity / SSO federation (WTQ-INT-04): OIDC + Nafath (OIDC
	// variant) clients federating against external IdPs, with SAML as a seam.
	// The admin repository (read + write + delete) backs BOTH the login-path
	// federation service and the tenant IdP admin CRUD. client_secret is
	// encrypted at rest when IDP_SECRET_ENC_KEY (32-byte base64) is set; when
	// unset the repo transparently falls back to legacy plaintext.
	idpSecretKey := decodeIDPSecretKey(envOrDefault("IDP_SECRET_ENC_KEY", ""), svc.Logger)
	idpConnRepo := iamrepo.NewIdPConnectionAdminRepository(svc.DBPool, idpSecretKey)
	externalIdentityRepo := iamrepo.NewExternalIdentityRepository(svc.DBPool)
	federationSvc := iamservice.NewFederationService(
		idpConnRepo,
		externalIdentityRepo,
		userRepo,
		roleRepo,
		authSvc,
		svc.Redis,
		&http.Client{Timeout: 15 * time.Second},
		envOrDefault("SSO_DEFAULT_TENANT_ID", ""),
		svc.Logger,
	)

	// WebAuthn (passkey / FIDO2 assertion login). RP settings come from
	// config.WebAuthnConfig (Decision D6); token issuance reuses AuthService.
	webauthnSvc, err := iamservice.NewWebAuthnService(
		legacyCfg.WebAuthn.RPID,
		legacyCfg.WebAuthn.RPDisplayName,
		legacyCfg.WebAuthn.RPOrigins,
		webauthnRepo,
		userRepo,
		authSvc,
		svc.Redis,
		svc.Logger,
	)
	if err != nil {
		svc.Logger.Fatal().Err(err).Msg("failed to create webauthn service")
	}

	// Trusted devices (authenticated device registration + listing).
	deviceSvc := iamservice.NewDeviceService(trustedDeviceRepo, svc.Logger)
	dashboardPreferenceSvc := iamservice.NewDashboardPreferenceService(dashboardPreferenceRepo)

	notebookMetrics := security.NewNotebookMetrics(svc.Metrics.Registry())
	notebookSvc := notebookservice.NewNotebookService(
		envOrDefault("JUPYTERHUB_API_URL", "http://hub.jupyterhub.svc.cluster.local:8081/hub/api"),
		envOrDefault("JUPYTERHUB_BASE_URL", "https://notebooks.clario360.sa"),
		envOrDefault("JUPYTERHUB_ADMIN_TOKEN", ""),
		nil,
		producer,
		notebookMetrics,
		svc.Logger,
	)

	// Handlers.
	authHandler := iamhandler.NewAuthHandler(authSvc, svc.Logger)
	userHandler := iamhandler.NewUserHandler(userSvc, dashboardPreferenceSvc, svc.Logger)
	roleHandler := iamhandler.NewRoleHandler(roleSvc, svc.Logger)
	tenantHandler := iamhandler.NewTenantHandler(tenantSvc, svc.Logger)
	apiKeyHandler := iamhandler.NewAPIKeyHandler(apiKeySvc, svc.Logger)
	oauthHandler := iamhandler.NewOAuthHandler(oauthSvc, svc.Logger)
	// SSO success lands on the frontend completion page by default (which reads
	// the #access_token/#refresh_token fragment and establishes the session)
	// instead of dumping the session JSON in the browser. SSO_SUCCESS_REDIRECT_URL
	// still overrides.
	ssoHandler := iamhandler.NewSSOHandler(
		federationSvc,
		envOrDefault("SSO_SUCCESS_REDIRECT_URL",
			envOrDefault("CLARIO360_APP_URL", "http://localhost:3000")+"/auth/sso/complete"),
		svc.Logger,
	)
	// Tenant IdP admin CRUD (register/manage SSO connections). Reuses the same
	// admin repo instance as the federation service so a connection created here
	// is immediately resolvable by the login path. The callback base defaults a
	// new connection's redirect_url to {base}/api/v1/auth/sso/{provider}/callback.
	idpAdminSvc := iamservice.NewIdPAdminService(
		idpConnRepo,
		envOrDefault("SSO_PUBLIC_BASE", envOrDefault("CLARIO360_PUBLIC_URL", "http://localhost:8080")),
		svc.Logger,
	)
	idpAdminHandler := iamhandler.NewIdPAdminHandler(idpAdminSvc, svc.Logger)
	webauthnHandler := iamhandler.NewWebAuthnHandler(webauthnSvc, svc.Logger)
	deviceHandler := iamhandler.NewDeviceHandler(deviceSvc, svc.Logger)
	notebookHandler := notebookhandler.NewNotebookHandler(notebookSvc, svc.Logger)

	// AI governance control plane.
	aiMetrics := aigovservice.NewMetrics(svc.Metrics.Registry())
	aiRegistryRepo := aigovrepo.NewModelRegistryRepository(svc.DBPool, svc.Logger)
	aiPredictionRepo := aigovrepo.NewPredictionLogRepository(svc.DBPool, svc.Logger)
	aiShadowRepo := aigovrepo.NewShadowComparisonRepository(svc.DBPool, svc.Logger)
	aiDriftRepo := aigovrepo.NewDriftReportRepository(svc.DBPool, svc.Logger)
	aiValidationRepo := aigovrepo.NewValidationResultRepository(svc.DBPool, svc.Logger)
	aiExplanationSvc := aigovservice.NewExplanationService(svc.Logger)
	aiRegistrySvc := aigovservice.NewRegistryService(aiRegistryRepo, producer, aiMetrics, svc.Logger)
	aiPredictionSvc := aigovservice.NewPredictionService(aiPredictionRepo, aiRegistryRepo, producer, aiMetrics, svc.Logger)
	aiComparisonSvc := aigovservice.NewComparisonService(aiRegistryRepo, aiPredictionRepo, aiShadowRepo, producer, aiMetrics, svc.Logger)
	aiShadowSvc := aigovservice.NewShadowService(aiRegistryRepo, aiShadowRepo, aiPredictionRepo, producer, aiMetrics, svc.Logger)
	aiLifecycleSvc := aigovservice.NewLifecycleService(aiRegistryRepo, aiShadowRepo, producer, aiMetrics, svc.Logger)
	aiDriftSvc := aigovservice.NewDriftService(aiRegistryRepo, aiPredictionRepo, aiDriftRepo, producer, aiMetrics, svc.Logger)
	aiValidationSvc := aigovservice.NewValidationService(aiRegistryRepo, aiPredictionRepo, aiValidationRepo, producer, aiMetrics, nil, svc.Logger)
	aiDashboardSvc := aigovservice.NewDashboardService(aiRegistryRepo, aiPredictionRepo, aiDriftRepo, svc.Logger)
	// Platform AI governance fleet rollup (G23) — cross-tenant rollup over the
	// same aigovernance repositories used by the per-tenant /api/v1/ai/* routes.
	aiFleetRepo := aigovrepo.NewFleetRepository(svc.DBPool, svc.Logger)
	aiFleetSvc := platformaifleet.NewService(aiFleetRepo, aiRegistryRepo, aiPredictionRepo, aiDriftRepo, aiDashboardSvc, svc.Logger)
	aiFleetHandler := platformaifleet.NewHandler(aiFleetSvc, svc.Logger)
	aiServerRepo := aigovrepo.NewInferenceServerRepository(svc.DBPool, svc.Logger)
	aiBenchmarkRepo := aigovrepo.NewBenchmarkRepository(svc.DBPool, svc.Logger)
	aiBenchmarkRunner := aigovbenchmark.NewRunner(svc.Logger)
	aiBenchmarkSvc := aigovservice.NewBenchmarkService(aiBenchmarkRepo, aiServerRepo, aiBenchmarkRunner, aiMetrics, svc.Logger)
	aiServices := aigovhandler.Services{
		Registry:     aiRegistrySvc,
		Predictions:  aiPredictionSvc,
		Explanations: aiExplanationSvc,
		Shadow:       aiShadowSvc,
		Lifecycle:    aiLifecycleSvc,
		Drift:        aiDriftSvc,
		Validation:   aiValidationSvc,
		Dashboard:    aiDashboardSvc,
		Benchmark:    aiBenchmarkSvc,
	}
	bg, bgCtx := errgroup.WithContext(ctx)
	bg.Go(func() error {
		err := aigovshadow.NewScheduler(aiComparisonSvc, time.Hour, svc.Logger).Run(bgCtx)
		if err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
		return nil
	})
	bg.Go(func() error {
		err := aigovdrift.NewScheduler(aiDriftSvc, 24*time.Hour, svc.Logger).Run(bgCtx)
		if err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
		return nil
	})

	// Onboarding dependencies.
	onboardingMetrics := onboardingsvc.NewMetrics(svc.Metrics)
	dbPools, dbDSNs, err := buildOnboardingDBPools(ctx, legacyCfg, svc.Logger)
	if err != nil {
		svc.Logger.Fatal().Err(err).Msg("failed to initialize onboarding database pools")
	}
	for _, pool := range dbPools {
		defer pool.Close()
	}

	storageClient := buildOnboardingStorage(ctx, legacyCfg, svc.Logger)
	notifEmailChannel := buildNotificationEmailChannel(svc.Logger)
	emailSender := onboardingsvc.NewChannelEmailSender(
		envOrDefault("CLARIO360_APP_URL", "http://localhost:3000"),
		notifEmailChannel,
		svc.Logger,
	)
	migrationsBasePath := resolveMigrationsBasePath()

	// Password-reset email delivery reuses the same notification email channel
	// as the magic-link flow; reset links point at {APP_URL}/reset-password.
	authSvc.SetPasswordResetEmailDelivery(
		iamservice.NewChannelPasswordResetEmailSender(notifEmailChannel, svc.Logger),
		envOrDefault("CLARIO360_APP_URL", "http://localhost:3000"),
	)

	// Magic-link (passwordless email sign-in). Reuses the onboarding email
	// sender for delivery and AuthService for token issuance.
	magicLinkSvc := iamservice.NewMagicLinkService(
		userRepo,
		magicLinkRepo,
		authSvc,
		svc.Redis,
		emailSender,
		envOrDefault("CLARIO360_APP_URL", "http://localhost:3000"),
		svc.Logger,
	)
	magicLinkHandler := iamhandler.NewMagicLinkHandler(magicLinkSvc, svc.Logger)

	onboardingRepository := onboardingrepo.NewOnboardingRepository(svc.DBPool)
	invitationRepository := onboardingrepo.NewInvitationRepository(svc.DBPool)
	provisioningRepository := onboardingrepo.NewProvisioningRepository(svc.DBPool)
	var brandingUploader onboardingsvc.BrandingAssetUploader
	if storageClient != nil {
		fileRepository := filerepo.NewFileRepository(svc.DBPool, svc.Logger)
		fileService := fileservice.NewFileService(
			fileRepository,
			storageClient,
			nil,
			producer,
			filemetrics.NewFileMetrics(svc.Metrics.Registry()),
			svc.Logger,
			"clario360",
			"clario360-quarantine",
			15*time.Minute,
		)
		brandingUploader = onboardingsvc.NewBrandingAssetUploader(fileService)
	}

	// Onboarding -> licensing integration. When LICENSE_INTERNAL_URL +
	// LICENSE_INTERNAL_TOKEN are configured, the provisioner assigns a scoped
	// trial license to each new tenant via the license-service internal API;
	// otherwise the assign step no-ops (assigner == nil).
	licenseAssigner := onboardingsvc.NewHTTPLicenseAssigner(
		os.Getenv("LICENSE_INTERNAL_URL"),
		os.Getenv("LICENSE_INTERNAL_TOKEN"),
		svc.Logger,
	)
	// Onboarding -> Watheeq/Lex integration. When LEX_INTERNAL_URL +
	// LEX_INTERNAL_TOKEN are configured, the provisioner applies the Legal Affairs
	// starter template to each new tenant that selected Watheeq via the lex-service
	// internal API; otherwise the step no-ops (provisioner == nil).
	lexProvisioner := onboardingsvc.NewHTTPLexProvisioner(
		os.Getenv("LEX_INTERNAL_URL"),
		os.Getenv("LEX_INTERNAL_TOKEN"),
		svc.Logger,
	)
	provisioner := onboardingsvc.NewTenantProvisioner(
		svc.DBPool,
		dbPools,
		dbDSNs,
		migrationsBasePath,
		onboardingRepository,
		provisioningRepository,
		storageClient,
		emailSender,
		producer,
		svc.Logger,
		onboardingMetrics,
		licenseAssigner,
		lexProvisioner,
	)
	registrationService := onboardingsvc.NewRegistrationService(
		onboardingRepository,
		userRepo,
		roleRepo,
		sessionRepo,
		jwtMgr,
		svc.Redis,
		producer,
		emailSender,
		provisioner,
		svc.Logger,
		onboardingMetrics,
		legacyCfg.Auth.BcryptCost,
		legacyCfg.Auth.RefreshTokenTTL,
	)
	invitationService := onboardingsvc.NewInvitationService(
		invitationRepository,
		onboardingRepository,
		userRepo,
		roleRepo,
		sessionRepo,
		jwtMgr,
		producer,
		emailSender,
		svc.Logger,
		onboardingMetrics,
		legacyCfg.Auth.BcryptCost,
		legacyCfg.Auth.RefreshTokenTTL,
	)
	wizardService := onboardingsvc.NewWizardService(
		onboardingRepository,
		provisioningRepository,
		invitationService,
		producer,
		svc.Logger,
		onboardingMetrics,
		licenseAssigner,
		lexProvisioner,
	)
	deprovisioner := onboardingsvc.NewTenantDeprovisioner(
		svc.DBPool,
		dbPools,
		onboardingRepository,
		storageClient,
		svc.Redis,
		producer,
		svc.Logger,
		onboardingMetrics,
	)
	onboardingHandler := onboardinghandler.New(
		registrationService,
		wizardService,
		invitationService,
		provisioner,
		deprovisioner,
		brandingUploader,
		provisioningRepository,
		svc.Logger,
	)

	// Platform admin console handlers (cross-tenant, super-admin only).
	// Fleet health/summary aggregator (G1) — static service registry + defaults.
	fleetHandler := platformfleet.NewHandler(platformfleet.New(platformfleet.Config{}, svc.Logger))
	// Cross-tenant user search (G6).
	identityHandler := platformidentity.NewHandler(platformidentity.NewRepository(svc.DBPool), svc.Logger)
	// In-flight provisioning oversight (G24) — reuses the onboarding provisioning repo.
	platformProvisioningHandler := platformprovisioning.New(provisioningRepository, svc.Logger)
	// ABAC policy management (G22) — construct the authz engine here (iam-service
	// does not otherwise build one). Repository cache TTL mirrors the engine default.
	abacRepo := authz.NewRepository(svc.DBPool, 30*time.Second)
	abacEngine := authz.NewEngine(abacRepo)
	abacHandler := platformabac.New(abacRepo, abacEngine, svc.Logger)
	// Tenant lifecycle / impersonation / overview rollup (G2-G5). Producer may be
	// nil (Kafka graceful-degradation); audit is written synchronously via the repo.
	platformTenantsHandler := platformtenants.NewHandler(
		platformtenants.NewService(
			platformtenants.NewRepository(svc.DBPool),
			jwtMgr,
			svc.Redis,
			producer,
			svc.Logger,
		),
		svc.Logger,
	)

	// Security headers on all responses.
	svc.Router.Use(middleware.SecurityHeaders())
	svc.Router.Get("/.well-known/openid-configuration", oauthHandler.Discovery)
	svc.Router.Get("/.well-known/jwks.json", oauthHandler.JWKS)

	// Routes.
	svc.Router.Route("/api/v1", func(r chi.Router) {
		r.Get("/internal/users/by-role", roleHandler.InternalUserIDsByRole)
		r.Get("/internal/users/by-email", userHandler.InternalGetByEmail)
		r.Get("/internal/users/{id}/email", userHandler.InternalGetEmail)

		r.Group(func(r chi.Router) {
			r.Use(middleware.RateLimit(svc.Redis, middleware.RateLimitConfig{
				RequestsPerWindow: 20,
				Window:            1 * time.Minute,
				KeyPrefix:         "ratelimit:auth",
			}))
			r.Mount("/auth", authHandler.Routes())
			r.Mount("/auth/oauth", oauthHandler.Routes())
			// Passwordless / passkey login — public, rate-limited like /auth.
			r.Mount("/auth/webauthn", webauthnHandler.Routes())
			r.Mount("/auth/magic-link", magicLinkHandler.Routes())
		})

		// External identity / SSO federation (WTQ-INT-04). The login/callback
		// endpoints are public: the IdP redirect-back cannot carry a platform
		// JWT, so the flow is secured by signed/one-time state + PKCE + nonce.
		r.Group(func(r chi.Router) {
			r.Use(middleware.RateLimit(svc.Redis, middleware.RateLimitConfig{
				RequestsPerWindow: 20,
				Window:            1 * time.Minute,
				KeyPrefix:         "ratelimit:auth:sso",
			}))
			r.Mount("/auth/sso", ssoHandler.Routes())
		})

		r.Route("/onboarding", func(r chi.Router) {
			r.With(onboardingmiddleware.NewPublicRateLimiter(svc.Redis, onboardingmiddleware.PublicRateLimitConfig{
				RequestsPerWindow: 5,
				Window:            time.Hour,
				KeyPrefix:         "ratelimit:onboarding:register",
			})).Post("/register", onboardingHandler.Register)
			r.With(onboardingmiddleware.NewPublicRateLimiter(svc.Redis, onboardingmiddleware.PublicRateLimitConfig{
				RequestsPerWindow: 20,
				Window:            10 * time.Minute,
				KeyPrefix:         "ratelimit:onboarding:verify-email",
			})).Post("/verify-email", onboardingHandler.VerifyEmail)
			r.With(onboardingmiddleware.NewPublicRateLimiter(svc.Redis, onboardingmiddleware.PublicRateLimitConfig{
				RequestsPerWindow: 1,
				Window:            time.Minute,
				KeyPrefix:         "ratelimit:onboarding:resend-otp",
			})).Post("/resend-otp", onboardingHandler.ResendOTP)
			r.With(onboardingmiddleware.NewPublicRateLimiter(svc.Redis, onboardingmiddleware.PublicRateLimitConfig{
				RequestsPerWindow: 120,
				Window:            time.Minute,
				KeyPrefix:         "ratelimit:onboarding:plans",
			})).Get("/plans", onboardingHandler.GetPlans)
			r.With(
				middleware.OptionalAuth(jwtMgr),
				onboardingmiddleware.NewPublicRateLimiter(svc.Redis, onboardingmiddleware.PublicRateLimitConfig{
					RequestsPerWindow: 120,
					Window:            time.Minute,
					KeyPrefix:         "ratelimit:onboarding:status",
				}),
			).Get("/status/{tenantId}", onboardingHandler.GetOnboardingStatus)

			r.Group(func(r chi.Router) {
				r.Use(middleware.Auth(jwtMgr))
				r.Use(middleware.RateLimit(svc.Redis, middleware.DefaultRateLimitConfig()))
				r.Use(middleware.Tenant)
				r.Use(tracing.SpanEnricher())

				r.Get("/wizard", onboardingHandler.GetWizardProgress)
				r.Post("/wizard/organization", onboardingHandler.SaveOrganization)
				r.Post("/wizard/branding", onboardingHandler.SaveBranding)
				r.Post("/wizard/team", onboardingHandler.SaveTeam)
				r.Post("/wizard/suites", onboardingHandler.SaveSuites)
				r.Post("/wizard/complete", onboardingHandler.CompleteWizard)
			})
		})

		r.Route("/invitations", func(r chi.Router) {
			r.With(onboardingmiddleware.NewPublicRateLimiter(svc.Redis, onboardingmiddleware.PublicRateLimitConfig{
				RequestsPerWindow: 60,
				Window:            time.Minute,
				KeyPrefix:         "ratelimit:onboarding:invite-validate",
			})).Get("/validate", onboardingHandler.ValidateInviteToken)
			r.With(onboardingmiddleware.NewPublicRateLimiter(svc.Redis, onboardingmiddleware.PublicRateLimitConfig{
				RequestsPerWindow: 10,
				Window:            15 * time.Minute,
				KeyPrefix:         "ratelimit:onboarding:invite-accept",
			})).Post("/accept", onboardingHandler.AcceptInvitation)

			r.Group(func(r chi.Router) {
				r.Use(middleware.Auth(jwtMgr))
				r.Use(middleware.RateLimit(svc.Redis, middleware.DefaultRateLimitConfig()))
				r.Use(middleware.Tenant)
				r.Use(tracing.SpanEnricher())

				r.Get("/", onboardingHandler.ListInvitations)
				r.Post("/", onboardingHandler.CreateBatchInvitations)
				r.Delete("/{id}", onboardingHandler.CancelInvitation)
				r.Post("/resend/{id}", onboardingHandler.ResendInvitation)
				r.Get("/stats", onboardingHandler.GetStats)
			})
		})

		// Protected routes.
		r.Group(func(r chi.Router) {
			r.Use(middleware.Auth(jwtMgr))
			r.Use(middleware.RateLimit(svc.Redis, middleware.DefaultRateLimitConfig()))
			r.Use(middleware.Tenant)
			r.Use(tracing.SpanEnricher())

			r.Mount("/users", userHandler.Routes())
			r.Mount("/roles", roleHandler.Routes())
			r.Mount("/tenants", tenantHandler.Routes())
			// Tenant SSO / external IdP connection admin (Othaim PRD 12.0).
			// Auth + Tenant middleware above set the JWT tenant; the handler
			// derives tenant scope from it (no cross-tenant IDOR).
			r.Mount("/idp-connections", idpAdminHandler.Routes())
			r.Mount("/api-keys", apiKeyHandler.Routes())
			r.Mount("/notebooks", notebookHandler.Routes())
			// Trusted devices — authenticated; needs auth.UserFromContext.
			r.Mount("/auth/devices", deviceHandler.Routes())
			// Authenticated social-login endpoints — inlined rather than Mounted
			// because the public OAuth group above already Mounts /auth/oauth,
			// and chi panics on a second Mount of the same prefix.
			r.Get("/auth/oauth/connections", oauthHandler.ListConnections)
			r.Delete("/auth/oauth/link/{provider}", oauthHandler.UnlinkProvider)
			aigovhandler.RegisterRoutes(r, aiServices, svc.Logger)

			r.Route("/users/{id}/roles", func(r chi.Router) {
				r.Get("/", roleHandler.GetUserRoles)
				r.Post("/", roleHandler.AssignRole)
				r.Delete("/{roleId}", roleHandler.RemoveRole)
			})
		})

		r.Route("/admin", func(r chi.Router) {
			r.Use(middleware.Auth(jwtMgr))
			r.Use(middleware.RateLimit(svc.Redis, middleware.DefaultRateLimitConfig()))
			r.Use(tracing.SpanEnricher())

			r.Post("/tenants/provision", onboardingHandler.AdminProvision)
			r.Get("/tenants/{id}/provision-status", onboardingHandler.AdminGetProvisionStatus)
			r.Post("/tenants/{id}/deprovision", onboardingHandler.AdminDeprovision)
			r.Post("/tenants/{id}/reprovision", onboardingHandler.AdminReprovision)
			r.Post("/tenants/{id}/reactivate", onboardingHandler.AdminReactivate)

			// Cross-tenant user search (G6) — /api/v1/admin/users/search.
			r.Mount("/users", identityHandler.Routes())
			// In-flight provisioning oversight (G24) — /api/v1/admin/provisioning.
			r.Mount("/", platformProvisioningHandler.Routes())
		})

		// Platform admin console — cross-tenant surfaces (super-admin only).
		// These are mounted on the /api/v1 sub-router (NOT the /admin sub-router)
		// because their handlers register absolute /admin, /platform and /abac
		// sub-paths. Each group applies middleware.Auth (so RequirePermission can
		// read the auth context) WITHOUT middleware.Tenant — they are cross-tenant
		// by design.
		r.Group(func(r chi.Router) {
			r.Use(middleware.Auth(jwtMgr))
			r.Use(middleware.RateLimit(svc.Redis, middleware.DefaultRateLimitConfig()))
			r.Use(tracing.SpanEnricher())

			// Fleet health/summary (G1) — /api/v1/platform/fleet/{health,summary}.
			r.Mount("/platform", fleetHandler.Routes())
			// ABAC policy management (G22) — /api/v1/abac/policies*.
			r.Mount("/abac", abacHandler.Routes())
			// Tenant lifecycle / impersonation / overview rollup (G2-G5) — registers
			// /admin/tenants, /admin/impersonation/stop, /platform/tenants/summary.
			platformTenantsHandler.Mount(r)
			// AI governance fleet rollup (G23) — /admin/ai/fleet/* and
			// /admin/tenants/{id}/ai-summary.
			aiFleetHandler.RegisterRoutes(r, middleware.RequirePermission)
		})
	})

	if producer != nil {
		notebookConsumerCfg := legacyCfg.Kafka
		notebookConsumerCfg.GroupID = "iam-service-notebook-consumer"
		kafkaConsumer, err := events.NewConsumer(notebookConsumerCfg, svc.Logger)
		if err != nil {
			svc.Logger.Warn().Err(err).Msg("notebook audit consumer unavailable")
		} else {
			kafkaConsumer.Subscribe(events.Topics.NotebookEvents, notebookconsumer.NewNotebookConsumer(producer, svc.Logger))
			bg.Go(func() error {
				err := kafkaConsumer.Start(bgCtx)
				if err != nil && !errors.Is(err, context.Canceled) {
					return err
				}
				return nil
			})
			defer kafkaConsumer.Close()
		}
	}

	svc.Logger.Info().Int("port", cfg.Port).Msg("iam-service starting")
	runErr := svc.Run(ctx)
	cancel()
	if bgErr := bg.Wait(); bgErr != nil && !errors.Is(bgErr, context.Canceled) {
		svc.Logger.Error().Err(bgErr).Msg("iam background components stopped with error")
	}
	if runErr != nil {
		svc.Logger.Fatal().Err(runErr).Msg("server failed")
		os.Exit(1)
	}
}

func envOrDefault(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// decodeIDPSecretKey decodes the IdP client_secret encryption key from a base64
// (standard or URL) string. An empty value returns nil (repo falls back to
// legacy plaintext). A non-empty value that does not decode to exactly 32 bytes
// is logged and ignored (nil) rather than silently truncating a bad key.
func decodeIDPSecretKey(raw string, logger zerolog.Logger) []byte {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		if key, err = base64.RawURLEncoding.DecodeString(raw); err != nil {
			logger.Warn().Msg("IDP_SECRET_ENC_KEY is not valid base64; falling back to plaintext client_secret storage")
			return nil
		}
	}
	if len(key) != 32 {
		logger.Warn().Int("len", len(key)).Msg("IDP_SECRET_ENC_KEY must decode to 32 bytes; falling back to plaintext client_secret storage")
		return nil
	}
	return key
}

func intToStr(n int) string {
	s := ""
	if n == 0 {
		return "0"
	}
	for n > 0 {
		s = string(rune('0'+n%10)) + s
		n /= 10
	}
	return s
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func loadAdditionalOAuthClientsFromEnv(logger zerolog.Logger) []iamservice.OAuthClient {
	raw := strings.TrimSpace(os.Getenv("OAUTH_ADDITIONAL_CLIENTS_JSON"))
	if raw == "" {
		return nil
	}

	var clients []iamservice.OAuthClient
	if err := json.Unmarshal([]byte(raw), &clients); err != nil {
		logger.Fatal().Err(err).Msg("failed to parse OAUTH_ADDITIONAL_CLIENTS_JSON")
	}
	for i := range clients {
		if clients[i].ClientID == "" || len(clients[i].RedirectURIs) == 0 {
			logger.Fatal().Int("index", i).Msg("oauth additional clients must define client_id and redirect_uris")
		}
		if len(clients[i].Scopes) == 0 {
			clients[i].Scopes = []string{"openid", "profile", "email", "roles"}
		}
		clients[i].RequirePKCE = true
	}
	return clients
}

func buildOnboardingDBPools(ctx context.Context, cfg *config.Config, logger zerolog.Logger) (map[string]*pgxpool.Pool, map[string]string, error) {
	dsns := map[string]string{
		"platform_core": envOrDefault("PLATFORM_DB_URL", buildPostgresURL(cfg.Database, "platform_core")),
		"cyber_db":      envOrDefault("CYBER_DB_URL", buildPostgresURL(cfg.Database, "cyber_db")),
		"data_db":       envOrDefault("DATA_DB_URL", buildPostgresURL(cfg.Database, "data_db")),
		"acta_db":       envOrDefault("ACTA_DB_URL", buildPostgresURL(cfg.Database, "acta_db")),
		"lex_db":        envOrDefault("LEX_DB_URL", buildPostgresURL(cfg.Database, "lex_db")),
		"visus_db":      envOrDefault("VISUS_DB_URL", buildPostgresURL(cfg.Database, "visus_db")),
	}

	pools := make(map[string]*pgxpool.Pool, len(dsns)-1)
	for name, dsn := range dsns {
		if name == "platform_core" {
			continue
		}

		pool, err := newPGXPool(ctx, dsn, cfg.Database.MaxIdleConns, cfg.Database.MaxOpenConns)
		if err != nil {
			return nil, nil, fmt.Errorf("connect %s: %w", name, err)
		}
		pools[name] = pool
		logger.Info().Str("database", name).Msg("onboarding database pool established")
	}

	return pools, dsns, nil
}

func newPGXPool(ctx context.Context, dsn string, minConns, maxConns int) (*pgxpool.Pool, error) {
	poolCfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse postgres dsn: %w", err)
	}

	if minConns < 1 {
		minConns = 1
	}
	if maxConns < minConns {
		maxConns = minConns
	}

	poolCfg.MinConns = int32(minConns)
	poolCfg.MaxConns = int32(maxConns)
	poolCfg.MaxConnLifetime = 5 * time.Minute
	poolCfg.MaxConnIdleTime = 5 * time.Minute
	poolCfg.HealthCheckPeriod = 30 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("create postgres pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres pool: %w", err)
	}
	return pool, nil
}

func buildOnboardingStorage(ctx context.Context, cfg *config.Config, logger zerolog.Logger) *storage.MinIOStorage {
	storageClient, err := storage.NewMinIOStorage(storage.Config{
		Backend:      "minio",
		Endpoint:     cfg.MinIO.Endpoint,
		AccessKey:    cfg.MinIO.AccessKey,
		SecretKey:    cfg.MinIO.SecretKey,
		UseSSL:       cfg.MinIO.UseSSL,
		BucketPrefix: "clario360",
	})
	if err != nil {
		logger.Warn().Err(err).Msg("failed to initialize onboarding storage client")
		return nil
	}

	if _, err := storageClient.Client().ListBuckets(ctx); err != nil {
		logger.Warn().Err(err).Msg("minio connectivity check failed for onboarding")
	}

	return storageClient
}

// buildNotificationEmailChannel constructs the shared notification email
// channel (SMTP or SendGrid from NOTIF_* env). It backs the onboarding email
// sender, magic-link delivery, and password-reset delivery so outbound email
// configuration lives in one place.
func buildNotificationEmailChannel(logger zerolog.Logger) *notifchannel.EmailChannel {
	notifCfg := notifcfg.LoadFromEnv()
	templateService := notifservice.NewTemplateService(logger)
	return notifchannel.NewEmailChannel(notifchannel.EmailConfig{
		Provider:       notifCfg.EmailProvider,
		SMTPHost:       notifCfg.SMTPHost,
		SMTPPort:       notifCfg.SMTPPort,
		SMTPUser:       notifCfg.SMTPUsername,
		SMTPPass:       notifCfg.SMTPPassword,
		SMTPFrom:       notifCfg.SMTPFrom,
		TLSEnabled:     notifCfg.SMTPTLSEnabled,
		SendGridAPIKey: notifCfg.SendGridAPIKey,
		SendGridFrom:   notifCfg.SendGridFrom,
	}, templateService, logger)
}

func resolveMigrationsBasePath() string {
	candidates := []string{
		envOrDefault("ONBOARDING_MIGRATIONS_BASE_PATH", ""),
		"migrations",
		filepath.Join("backend", "migrations"),
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		info, err := os.Stat(filepath.Join(candidate, "platform_core"))
		if err == nil && info.IsDir() {
			return candidate
		}
	}

	return "migrations"
}

func buildPostgresURL(cfg config.DatabaseConfig, dbName string) string {
	u := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(cfg.User, cfg.Password),
		Host:   fmt.Sprintf("%s:%d", cfg.Host, cfg.Port),
		Path:   dbName,
	}
	q := u.Query()
	q.Set("sslmode", cfg.SSLMode)
	u.RawQuery = q.Encode()
	return u.String()
}
