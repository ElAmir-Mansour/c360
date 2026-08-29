// license-service is the platform's Licensing & Billing core service
// (Solution Architecture E2E, slide 18): entitlement registry, enforcement
// API for the gateway and apps, usage metering from the event bus, and
// signed offline license files for air-gapped estates.
//
// Every license state change commits in one transaction with its outbox
// event; the in-process relay delivers staged events to Kafka.
package main

import (
	"context"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/auth"
	appconfig "github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	licconfig "github.com/clario360/platform/internal/license/config"
	licconsumer "github.com/clario360/platform/internal/license/consumer"
	lichandler "github.com/clario360/platform/internal/license/handler"
	licrepo "github.com/clario360/platform/internal/license/repository"
	licservice "github.com/clario360/platform/internal/license/service"
	sharedmw "github.com/clario360/platform/internal/middleware"
	bootstrap "github.com/clario360/platform/internal/observability/bootstrap"
	"github.com/clario360/platform/internal/observability/tracing"
	pricinghandler "github.com/clario360/platform/internal/pricing/handler"
	licenseadapter "github.com/clario360/platform/internal/pricing/licenseadapter"
	pricingmodel "github.com/clario360/platform/internal/pricing/model"
	pricingrepo "github.com/clario360/platform/internal/pricing/repository"
	pricingservice "github.com/clario360/platform/internal/pricing/service"
)

const serviceVersion = "1.0.0"

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	baseCfg, err := appconfig.Load()
	if err != nil {
		os.Stderr.WriteString("loading platform config: " + err.Error() + "\n")
		os.Exit(1)
	}
	licCfg, err := licconfig.Load(baseCfg)
	if err != nil {
		os.Stderr.WriteString("loading license config: " + err.Error() + "\n")
		os.Exit(1)
	}

	svc, err := bootstrap.Bootstrap(ctx, buildBootstrapConfig(baseCfg, licCfg))
	if err != nil {
		os.Stderr.WriteString("bootstrapping license-service: " + err.Error() + "\n")
		os.Exit(1)
	}
	logger := svc.Logger

	if err := runMigrations(licCfg); err != nil {
		logger.Fatal().Err(err).Msg("failed to run license migrations")
	}

	if licCfg.JWTPublicKeyPath != "" {
		publicKeyPEM, err := os.ReadFile(licCfg.JWTPublicKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Str("path", licCfg.JWTPublicKeyPath).Msg("failed to read LICENSE_JWT_PUBLIC_KEY_PATH")
		}
		baseCfg.Auth.RSAPublicKeyPEM = string(publicKeyPEM)
	}
	jwtMgr, err := auth.NewJWTManager(baseCfg.Auth)
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to create JWT manager")
	}

	// Offline license cryptography: each side of the air gap configures only
	// the key it holds — the vendor signs, the customer estate verifies.
	var signer *licservice.OfflineSigner
	if licCfg.SigningPrivateKeyPath != "" {
		pem, err := os.ReadFile(licCfg.SigningPrivateKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Str("path", licCfg.SigningPrivateKeyPath).Msg("failed to read license signing private key")
		}
		if signer, err = licservice.NewOfflineSigner(pem); err != nil {
			logger.Fatal().Err(err).Msg("invalid license signing private key")
		}
		logger.Info().Msg("offline license issuing enabled")
	}
	var verifier *licservice.OfflineVerifier
	if licCfg.SigningPublicKeyPath != "" {
		pem, err := os.ReadFile(licCfg.SigningPublicKeyPath)
		if err != nil {
			logger.Fatal().Err(err).Str("path", licCfg.SigningPublicKeyPath).Msg("failed to read license verification public key")
		}
		if verifier, err = licservice.NewOfflineVerifier(pem); err != nil {
			logger.Fatal().Err(err).Msg("invalid license verification public key")
		}
		logger.Info().Msg("offline license activation enabled")
	}

	licSvc := licservice.New(svc.DBPool, licrepo.New(), logger)
	httpHandler := lichandler.New(licSvc, signer, verifier, logger)

	svc.Router.Use(sharedmw.SecurityHeaders())
	svc.Router.Route("/api/v1/licensing", func(r chi.Router) {
		r.Use(sharedmw.Auth(jwtMgr))
		r.Use(sharedmw.Tenant)
		r.Mount("/", httpHandler.Routes())
	})

	// Pricing & Quoting (pricing-console-design.md): PRICING is the sibling of
	// LICENSING — the four tiers map to license_plans. It reuses this service's
	// DB pool, the transactional-outbox audit pattern, and the same JWT auth
	// group; routes are gated per-route on the pricing:read/write/admin verbs
	// (the internal margin block is served only to pricing:admin by DTO shape).
	pricingRepo := pricingrepo.New()
	pricingSvc := pricingservice.New(svc.DBPool, pricingRepo, logger)
	// The concrete repository satisfies both Repo (config) and QuoteRepo (quotes);
	// attaching it enables the Phase-2 quote persistence/state-machine paths.
	pricingSvc.SetQuoteRepo(pricingRepo)
	// Commercial loop (Phase 3): the four pricing tiers map to license_plans by
	// key. New() installs the identity default (tier name == plan key, seeded by
	// migration 000012). An optional PRICING_TIER_PLAN_* env override remaps a
	// tier to a differently-keyed plan; a bad override fails fast (fail-closed).
	if m := tierPlanMapFromEnv(pricingSvc.TierPlanMap()); m != nil {
		if err := pricingSvc.SetTierPlanMap(m); err != nil {
			logger.Fatal().Err(err).Msg("invalid PRICING_TIER_PLAN_* mapping")
		}
	}
	// Wire the license-assignment seam so provision-from-quote closes the loop by
	// REUSING the license lifecycle in-process (both services share this DB pool).
	pricingSvc.SetLicenseAssigner(licenseadapter.New(licSvc, logger))
	pricingHandler := pricinghandler.New(pricingSvc, logger)
	svc.Router.Route("/api/v1/pricing", func(r chi.Router) {
		r.Use(sharedmw.Auth(jwtMgr))
		r.Use(sharedmw.Tenant)
		r.Mount("/", pricingHandler.Routes())
	})

	// Internal service-to-service API (off unless LICENSE_INTERNAL_TOKEN is set).
	// Trusted backend callers (the onboarding provisioner) assign a tenant's
	// default trial license here, guarded by a shared service token rather than a
	// human "licensing:admin" JWT. NOT proxied by the gateway — called directly.
	if internalToken := envOr("LICENSE_INTERNAL_TOKEN", ""); internalToken != "" {
		svc.Router.Route("/internal/licensing", func(r chi.Router) {
			r.Use(sharedmw.ServiceToken(internalToken))
			r.Mount("/", httpHandler.InternalRoutes())
		})
		logger.Info().Msg("internal licensing API enabled (service-token auth)")
	}

	// Outbox relay: license events staged in-transaction are delivered to
	// Kafka here; without a reachable broker they accumulate durably.
	if len(licCfg.KafkaBrokers) > 0 {
		kafkaProducer, err := events.NewProducer(appconfig.KafkaConfig{
			Brokers: licCfg.KafkaBrokers,
			GroupID: licCfg.KafkaGroupID,
		}, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("kafka producer unavailable — license events will accumulate in the outbox")
		} else {
			defer kafkaProducer.Close()
			relay := outbox.NewRelay(svc.DBPool, kafkaProducer, outbox.Config{}, logger,
				outbox.NewMetrics(svc.Metrics.Registry()))
			go func() {
				if err := relay.Run(ctx); err != nil {
					logger.Error().Err(err).Msg("outbox relay stopped with error")
				}
			}()
		}

		// Usage metering from the bus (slide 18): IAM user lifecycle drives
		// seat counters.
		kafkaConsumer, err := events.NewConsumer(appconfig.KafkaConfig{
			Brokers:         licCfg.KafkaBrokers,
			GroupID:         licCfg.KafkaGroupID + "-metering",
			AutoOffsetReset: baseCfg.Kafka.AutoOffsetReset,
		}, logger)
		if err != nil {
			logger.Warn().Err(err).Msg("kafka consumer unavailable — usage metering from the bus disabled")
		} else {
			defer kafkaConsumer.Close()
			metering := licconsumer.NewMeteringConsumer(licSvc, logger)
			for _, topic := range metering.Topics() {
				kafkaConsumer.Subscribe(topic, metering)
			}
			go func() {
				if err := kafkaConsumer.Start(ctx); err != nil {
					logger.Error().Err(err).Msg("metering consumer stopped with error")
				}
			}()
		}
	}

	logger.Info().Int("port", licCfg.HTTPPort).Int("admin_port", licCfg.AdminPort).Msg("license-service starting")
	if err := svc.Run(ctx); err != nil {
		logger.Fatal().Err(err).Msg("license-service failed")
	}
}

func buildBootstrapConfig(baseCfg *appconfig.Config, licCfg *licconfig.Config) *bootstrap.ServiceConfig {
	env := envOr("ENVIRONMENT", "development")
	return &bootstrap.ServiceConfig{
		Name:        "license-service",
		Version:     serviceVersion,
		Environment: env,
		Port:        licCfg.HTTPPort,
		AdminPort:   licCfg.AdminPort,
		LogLevel:    baseCfg.Observability.LogLevel,
		DB: &bootstrap.DBConfig{
			URL:               licCfg.DBURL,
			MinConns:          licCfg.DBMinConns,
			MaxConns:          licCfg.DBMaxConns,
			MaxConnLife:       baseCfg.Database.ConnMaxLifetime,
			MaxConnIdle:       5 * time.Minute,
			HealthCheckPeriod: time.Minute,
		},
		Tracing: tracing.TracerConfig{
			Enabled:     baseCfg.Observability.OTLPEndpoint != "",
			Endpoint:    baseCfg.Observability.OTLPEndpoint,
			ServiceName: "license-service",
			Version:     serviceVersion,
			Environment: env,
			SampleRate:  0.1,
			Insecure:    true,
		},
		ShutdownTimeout: baseCfg.Server.ShutdownTimeout,
		ReadTimeout:     baseCfg.Server.ReadTimeout,
		WriteTimeout:    baseCfg.Server.WriteTimeout,
	}
}

func runMigrations(licCfg *licconfig.Config) error {
	migrationsPath := licCfg.MigrationsPath
	if _, err := os.Stat(migrationsPath); err != nil {
		migrationsPath = filepath.Join("backend", "migrations", "license_db")
	}
	return database.RunMigrations(licCfg.DBURL, migrationsPath)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// tierPlanMapFromEnv layers optional PRICING_TIER_PLAN_<TIER> overrides over the
// supplied base mapping (the service default). Each var, when set, remaps one
// tier to a differently-keyed license plan, e.g.
// PRICING_TIER_PLAN_STANDARD=std-2026. It returns nil when no override is set so
// the caller keeps the default without a redundant SetTierPlanMap call.
func tierPlanMapFromEnv(base pricingservice.TierPlanMap) pricingservice.TierPlanMap {
	overrides := map[pricingmodel.Tier]string{
		pricingmodel.TierStandard:     os.Getenv("PRICING_TIER_PLAN_STANDARD"),
		pricingmodel.TierGrowth:       os.Getenv("PRICING_TIER_PLAN_GROWTH"),
		pricingmodel.TierProfessional: os.Getenv("PRICING_TIER_PLAN_PROFESSIONAL"),
		pricingmodel.TierCustomized:   os.Getenv("PRICING_TIER_PLAN_CUSTOMIZED"),
	}
	changed := false
	out := make(pricingservice.TierPlanMap, len(base))
	for t, k := range base {
		out[t] = k
	}
	for t, k := range overrides {
		if k != "" {
			out[t] = k
			changed = true
		}
	}
	if !changed {
		return nil
	}
	return out
}
