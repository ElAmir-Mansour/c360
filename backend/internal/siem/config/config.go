package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/clario360/platform/internal/observability/bootstrap"
	"github.com/clario360/platform/internal/observability/tracing"
	"github.com/clario360/platform/internal/siem/internal/buildinfo"
)

// ServiceName is the canonical name used by metrics, logs, traces and
// the audit chain. It is duplicated as a const so tests that need to
// assert prefix sanitization do not import the bootstrap package.
const ServiceName = "siem-service"

// Config holds the fully resolved siem-service configuration.
//
// Fields marked "redacted in String()" are stripped from the diagnostic
// representation so we never leak secrets through logs.
type Config struct {
	ServiceConfig *bootstrap.ServiceConfig // backing bootstrap config (composed)

	// Ports
	HTTPPort  int
	AdminPort int

	// Postgres
	PGDSN      string // redacted in String()
	PGMaxConns int

	// Redis
	RedisAddr string
	RedisDB   int

	// Kafka
	KafkaBrokers   []string
	KafkaClientID  string
	KafkaTLSEnable bool // reserved

	// OpenSearch — reserved for SIEM-02, accept empty without crashing.
	OpenSearchURL  string
	OpenSearchAuth string // redacted in String()

	// OTEL
	OTELExporterEndpoint string

	// Lifecycle
	ShutdownTimeout time.Duration

	// Profiling
	EnablePprof bool

	// Logging
	LogLevel string

	// JWT
	JWTIssuer        string
	JWTPublicKeyPath string // redacted in String() since the path may carry a secret-loader hint

	// SIEM-02 store configuration. Populated from SIEM_OPENSEARCH_*,
	// SIEM_MINIO_*, SIEM_VAULT_*, SIEM_STORE_* env vars.
	Store StoreConfig

	// SIEM-03 sources / control-plane configuration.
	Sources SourcesConfig
}

// SourcesConfig is the SIEM-03 configuration block. Populated from
// SIEM_MTLS_*, SIEM_PKI_*, SIEM_ENROLL_*, SIEM_DETECTOR_*,
// SIEM_HEARTBEAT_*, SIEM_EPS_*, SIEM_IDEMPOTENCY_* env vars.
type SourcesConfig struct {
	MTLSListenAddr            string
	MTLSCABundlePath          string
	MTLSServerCertPath        string
	MTLSServerKeyPath         string
	PKIRootMount              string
	PKIIntermediatePrefix     string
	PKILeafTTL                time.Duration
	PKILeafRotationWindow     time.Duration
	PKILeafOverlap            time.Duration
	EnrollTokenTTL            time.Duration
	EnrollTokenKeyName        string
	EnrollTokenPrivateKeyB64  string
	EnrollTokenPrivateKeyPath string
	DetectorInterval          time.Duration
	DetectorBaselineMin       int
	DetectorDriftThreshold    float64
	DetectorRecoveryThreshold float64
	DetectorHeartbeatGap      time.Duration
	EPSSamplesRetention       time.Duration
	HeartbeatRateLimitPerMin  int
	IdempotencyTTL            time.Duration
	InstanceID                string
}

// StoreConfig is the SIEM-02 storage-layer configuration. Populated from
// SIEM_* env vars in ConfigFromEnv. The fields are intentionally typed and
// validated at load time so misconfiguration fails fast.
//
// Secret values (MinIO secret key, Vault token, OpenSearch auth) are
// redacted in the diagnostic String() representation.
type StoreConfig struct {
	// OpenSearch
	OpenSearchAddresses            []string
	OpenSearchUsername             string
	OpenSearchPassword             string // redacted
	OpenSearchInsecureTLS          bool
	OpenSearchHealthMinStatus      string
	OpenSearchMaxBulkBytes         int
	OpenSearchRolloverMaxAge       string
	OpenSearchRolloverMaxShardSize string

	// MinIO
	MinIOEndpoint           string
	MinIOAccessKey          string
	MinIOSecretKey          string // redacted
	MinIOUseSSL             bool
	MinIORegion             string
	MinIOBucket             string
	MinIOWORMSelfTestBucket string
	MinIOZstdLevel          int
	MinIOSkipSSECheck       bool

	// DEK manager
	DEKCacheTTL        time.Duration
	DEKCacheMaxEntries int

	// Admin
	SelfTestEnabled bool

	// Environment is "dev" or "prod"; informs validation invariants.
	Environment string
}

// LoadOptions allows tests to inject a deterministic environment without
// going through os.Setenv (which is process-global and bleeds between
// parallel tests).
type LoadOptions struct {
	// Getenv overrides os.Getenv. Must be non-nil to be honored.
	Getenv func(string) string
}

// Load reads the environment, validates required values, and returns a
// fully resolved Config plus a bootstrap.ServiceConfig pre-populated for
// `bootstrap.Bootstrap`.
//
// It aggregates ALL missing required vars into a single error rather
// than failing on the first.
func Load() (*Config, error) {
	return LoadWith(LoadOptions{Getenv: os.Getenv})
}

// LoadWith is identical to Load but accepts an override hook.
func LoadWith(opts LoadOptions) (*Config, error) {
	get := opts.Getenv
	if get == nil {
		get = os.Getenv
	}

	var missing []string

	getRequired := func(key string) string {
		v := get(key)
		if v == "" {
			missing = append(missing, key)
		}
		return v
	}
	getOptional := func(key, fallback string) string {
		if v := get(key); v != "" {
			return v
		}
		return fallback
	}
	getOptionalInt := func(key string, fallback int) (int, error) {
		v := get(key)
		if v == "" {
			return fallback, nil
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			return 0, fmt.Errorf("%s: invalid integer %q: %w", key, v, err)
		}
		return n, nil
	}
	getOptionalBool := func(key string, fallback bool) (bool, error) {
		v := get(key)
		if v == "" {
			return fallback, nil
		}
		b, err := strconv.ParseBool(v)
		if err != nil {
			return false, fmt.Errorf("%s: invalid bool %q: %w", key, v, err)
		}
		return b, nil
	}
	getOptionalDuration := func(key string, fallback time.Duration) (time.Duration, error) {
		v := get(key)
		if v == "" {
			return fallback, nil
		}
		// Allow bare integer seconds for operator ergonomics.
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Second, nil
		}
		d, err := time.ParseDuration(v)
		if err != nil {
			return 0, fmt.Errorf("%s: invalid duration %q: %w", key, v, err)
		}
		return d, nil
	}

	// Required up-front so we collect them all.
	pgDSN := getRequired("SIEM_PG_DSN")
	jwtPub := getRequired("SIEM_JWT_PUBLIC_KEY_PATH")

	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	httpPort, err := getOptionalInt("SIEM_HTTP_PORT", 8094)
	if err != nil {
		return nil, err
	}
	adminPort, err := getOptionalInt("SIEM_ADMIN_PORT", 9082)
	if err != nil {
		return nil, err
	}
	pgMax, err := getOptionalInt("SIEM_PG_MAX_CONNS", 20)
	if err != nil {
		return nil, err
	}
	if pgMax < 1 {
		return nil, fmt.Errorf("SIEM_PG_MAX_CONNS must be >= 1, got %d", pgMax)
	}
	redisDB, err := getOptionalInt("SIEM_REDIS_DB", 7)
	if err != nil {
		return nil, err
	}
	shutdownSec, err := getOptionalInt("SIEM_SHUTDOWN_TIMEOUT_SEC", 30)
	if err != nil {
		return nil, err
	}
	if shutdownSec < 1 {
		return nil, fmt.Errorf("SIEM_SHUTDOWN_TIMEOUT_SEC must be >= 1, got %d", shutdownSec)
	}
	pprof, err := getOptionalBool("SIEM_ENABLE_PPROF", false)
	if err != nil {
		return nil, err
	}
	kafkaTLS, err := getOptionalBool("SIEM_KAFKA_TLS_ENABLED", false)
	if err != nil {
		return nil, err
	}

	// Tracing sample rate kept default; advanced overrides arrive in SIEM-02.
	_, err = getOptionalDuration("SIEM_TRACING_SAMPLE", 0)
	if err != nil {
		return nil, err
	}

	redisAddr := getOptional("SIEM_REDIS_ADDR", "localhost:6379")
	logLevel := getOptional("SIEM_LOG_LEVEL", "info")
	switch logLevel {
	case "debug", "info", "warn", "error":
	default:
		return nil, fmt.Errorf("SIEM_LOG_LEVEL must be one of debug|info|warn|error, got %q", logLevel)
	}

	brokersRaw := getOptional("SIEM_KAFKA_BROKERS", "localhost:9092")
	brokers := splitTrim(brokersRaw, ",")

	cfg := &Config{
		HTTPPort:             httpPort,
		AdminPort:            adminPort,
		PGDSN:                pgDSN,
		PGMaxConns:           pgMax,
		RedisAddr:            redisAddr,
		RedisDB:              redisDB,
		KafkaBrokers:         brokers,
		KafkaClientID:        getOptional("SIEM_KAFKA_CLIENT_ID", ServiceName),
		KafkaTLSEnable:       kafkaTLS,
		OpenSearchURL:        getOptional("SIEM_OPENSEARCH_URL", ""),
		OpenSearchAuth:       getOptional("SIEM_OPENSEARCH_AUTH", ""),
		OTELExporterEndpoint: getOptional("SIEM_OTEL_EXPORTER_ENDPOINT", "localhost:4317"),
		ShutdownTimeout:      time.Duration(shutdownSec) * time.Second,
		EnablePprof:          pprof,
		LogLevel:             logLevel,
		JWTIssuer:            getOptional("SIEM_JWT_ISSUER", "clario360"),
		JWTPublicKeyPath:     jwtPub,
	}

	env := getOptional("SIEM_ENVIRONMENT", "development")

	// SIEM-02 store config.
	storeCfg, storeErr := loadStoreConfig(get, env)
	if storeErr != nil {
		return nil, storeErr
	}
	cfg.Store = storeCfg

	// SIEM-03 sources config.
	srcCfg, srcErr := loadSourcesConfig(get)
	if srcErr != nil {
		return nil, srcErr
	}
	cfg.Sources = srcCfg

	cfg.ServiceConfig = &bootstrap.ServiceConfig{
		Name:        ServiceName,
		Version:     buildinfo.Version,
		Environment: env,
		Port:        httpPort,
		AdminPort:   adminPort,
		LogLevel:    logLevel,
		EnablePprof: pprof,
		DB: &bootstrap.DBConfig{
			URL:               pgDSN,
			MinConns:          1,
			MaxConns:          pgMax,
			MaxConnLife:       time.Hour,
			MaxConnIdle:       30 * time.Minute,
			HealthCheckPeriod: time.Minute,
		},
		Redis: &bootstrap.RedisConfig{
			Addr: redisAddr,
			DB:   redisDB,
		},
		Kafka: &bootstrap.KafkaConfig{
			Brokers: brokers,
			GroupID: cfg.KafkaClientID,
		},
		Tracing: tracing.TracerConfig{
			Enabled:     true,
			Endpoint:    cfg.OTELExporterEndpoint,
			ServiceName: ServiceName,
			Version:     buildinfo.Version,
			Environment: env,
			SampleRate:  0.1,
			Insecure:    true,
		},
		ShutdownTimeout: cfg.ShutdownTimeout,
		ReadTimeout:     15 * time.Second,
		WriteTimeout:    30 * time.Second,
	}

	return cfg, nil
}

// String returns a diagnostic representation safe to log. Secrets are
// redacted (DSN, OpenSearch auth, JWT key path).
func (c *Config) String() string {
	if c == nil {
		return "config<nil>"
	}
	return fmt.Sprintf(
		"siem.Config{HTTP=%d,Admin=%d,PG=[REDACTED],PGMax=%d,Redis=%s/%d,Kafka=%s,ClientID=%s,TLS=%t,OS=%s,OSAuth=[REDACTED],OTEL=%s,Shutdown=%s,Pprof=%t,Log=%s,Issuer=%s,JWTKeyPath=[REDACTED]}",
		c.HTTPPort, c.AdminPort, c.PGMaxConns,
		c.RedisAddr, c.RedisDB,
		strings.Join(c.KafkaBrokers, ","),
		c.KafkaClientID, c.KafkaTLSEnable,
		c.OpenSearchURL,
		c.OTELExporterEndpoint,
		c.ShutdownTimeout,
		c.EnablePprof,
		c.LogLevel,
		c.JWTIssuer,
	)
}

func splitTrim(s, sep string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
