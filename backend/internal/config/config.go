package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config holds all application configuration.
type Config struct {
	Server        ServerConfig        `mapstructure:"server"`
	Database      DatabaseConfig      `mapstructure:"database"`
	Redis         RedisConfig         `mapstructure:"redis"`
	Kafka         KafkaConfig         `mapstructure:"kafka"`
	Auth          AuthConfig          `mapstructure:"auth"`
	Observability ObservabilityConfig `mapstructure:"observability"`
	MinIO         MinIOConfig         `mapstructure:"minio"`
	Encryption    EncryptionConfig    `mapstructure:"encryption"`
	Residency     ResidencyConfig     `mapstructure:"residency"`
	WebAuthn      WebAuthnConfig      `mapstructure:"webauthn"`
}

type ServerConfig struct {
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout"`
	WriteTimeout    time.Duration `mapstructure:"write_timeout"`
	ShutdownTimeout time.Duration `mapstructure:"shutdown_timeout"`

	// WTQ-SEC-04 (in-transit): optional app-level TLS termination. When
	// TLSEnabled is false (the default) the server serves plain HTTP exactly as
	// before, relying on external TLS termination. When enabled with a valid
	// cert/key pair the server serves HTTPS via ListenAndServeTLS.
	TLSEnabled  bool   `mapstructure:"tls_enabled"`
	TLSCertPath string `mapstructure:"tls_cert_path"`
	TLSKeyPath  string `mapstructure:"tls_key_path"`
}

func (s ServerConfig) Addr() string {
	return fmt.Sprintf("%s:%d", s.Host, s.Port)
}

// TLSReady reports whether the server should serve over TLS. It requires TLS to
// be explicitly enabled and both a certificate and key path to be configured.
func (s ServerConfig) TLSReady() bool {
	return s.TLSEnabled && s.TLSCertPath != "" && s.TLSKeyPath != ""
}

// ResidencyConfig holds WTQ-SEC-03 data-residency enforcement settings.
//
// Enforcement is OFF by default to preserve existing behavior: when
// ServiceRegion is empty the residency middleware is a pass-through. Set
// SERVICE_REGION (and optionally RESIDENCY_ALLOWED_REGIONS) to turn it on.
type ResidencyConfig struct {
	// ServiceRegion is the region this deployment physically runs in
	// (e.g. "ksa-central"). Empty disables residency enforcement entirely.
	ServiceRegion string `mapstructure:"service_region"`
	// AllowedRegions is an optional allowlist of tenant residency regions this
	// deployment may serve in addition to ServiceRegion. Empty means only the
	// ServiceRegion (and unrestricted tenants) are served.
	AllowedRegions []string `mapstructure:"allowed_regions"`
}

// Enabled reports whether residency enforcement is active for this deployment.
func (r ResidencyConfig) Enabled() bool {
	return r.ServiceRegion != ""
}

type DatabaseConfig struct {
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	User            string        `mapstructure:"user"`
	Password        string        `mapstructure:"password"`
	Name            string        `mapstructure:"name"`
	SSLMode         string        `mapstructure:"ssl_mode"`
	MaxOpenConns    int           `mapstructure:"max_open_conns"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns"`
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
}

func (d DatabaseConfig) DSN() string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		d.User, d.Password, d.Host, d.Port, d.Name, d.SSLMode,
	)
}

type RedisConfig struct {
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

func (r RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type KafkaConfig struct {
	Brokers         []string `mapstructure:"brokers"`
	GroupID         string   `mapstructure:"group_id"`
	AutoOffsetReset string   `mapstructure:"auto_offset_reset"`
}

type AuthConfig struct {
	JWTSecret        string        `mapstructure:"jwt_secret"`          // Deprecated: use RSA keys for RS256
	RSAPrivateKeyPEM string        `mapstructure:"rsa_private_key_pem"` // PEM-encoded RSA private key for RS256 signing
	RSAPublicKeyPEM  string        `mapstructure:"rsa_public_key_pem"`  // PEM-encoded RSA public key for RS256 verification
	JWTIssuer        string        `mapstructure:"jwt_issuer"`
	AccessTokenTTL   time.Duration `mapstructure:"access_token_ttl"`
	RefreshTokenTTL  time.Duration `mapstructure:"refresh_token_ttl"`
	BcryptCost       int           `mapstructure:"bcrypt_cost"`
}

type ObservabilityConfig struct {
	LogLevel     string `mapstructure:"log_level"`
	LogFormat    string `mapstructure:"log_format"`
	OTLPEndpoint string `mapstructure:"otlp_endpoint"`
	ServiceName  string `mapstructure:"service_name"`
	MetricsPort  int    `mapstructure:"metrics_port"`
}

type MinIOConfig struct {
	Endpoint  string `mapstructure:"endpoint"`
	AccessKey string `mapstructure:"access_key"`
	SecretKey string `mapstructure:"secret_key"`
	UseSSL    bool   `mapstructure:"use_ssl"`
	Bucket    string `mapstructure:"bucket"`
}

type EncryptionConfig struct {
	Key string `mapstructure:"key"`
}

// WebAuthnConfig holds the WebAuthn Relying Party (RP) settings (Decision D6).
//
// RPID is the Relying Party identifier (effective domain, e.g. "localhost").
// RPOrigins is the set of origins permitted to perform WebAuthn ceremonies
// (e.g. "http://localhost:3002"); it is read from a comma-separated env value.
// RPDisplayName is the human-readable RP name shown by authenticators.
type WebAuthnConfig struct {
	RPID          string   `mapstructure:"rp_id"`
	RPOrigins     []string `mapstructure:"rp_origins"`
	RPDisplayName string   `mapstructure:"rp_display_name"`
}

// Load reads configuration from environment variables, config files, and defaults.
func Load() (*Config, error) {
	v := viper.New()

	setDefaults(v)

	// Environment variable binding
	v.SetEnvPrefix("")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	bindEnvVars(v)

	// Optional YAML config file
	v.SetConfigName("config")
	v.SetConfigType("yaml")
	v.AddConfigPath(".")
	v.AddConfigPath("./config")
	v.AddConfigPath("/etc/clario360")

	if err := v.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return nil, fmt.Errorf("reading config file: %w", err)
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("unmarshaling config: %w", err)
	}

	return &cfg, nil
}

func setDefaults(v *viper.Viper) {
	// Server
	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.read_timeout", 15*time.Second)
	v.SetDefault("server.write_timeout", 15*time.Second)
	v.SetDefault("server.shutdown_timeout", 30*time.Second)
	// WTQ-SEC-04: TLS disabled by default — preserves plain-HTTP behavior.
	v.SetDefault("server.tls_enabled", false)
	v.SetDefault("server.tls_cert_path", "")
	v.SetDefault("server.tls_key_path", "")

	// Database
	v.SetDefault("database.host", "localhost")
	v.SetDefault("database.port", 5432)
	v.SetDefault("database.user", "clario")
	v.SetDefault("database.password", "clario_dev_pass")
	v.SetDefault("database.name", "clario360")
	v.SetDefault("database.ssl_mode", "disable")
	v.SetDefault("database.max_open_conns", 25)
	v.SetDefault("database.max_idle_conns", 10)
	v.SetDefault("database.conn_max_lifetime", 5*time.Minute)

	// Redis
	v.SetDefault("redis.host", "localhost")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)

	// Kafka
	v.SetDefault("kafka.brokers", []string{"localhost:9092"})
	v.SetDefault("kafka.group_id", "clario360")
	v.SetDefault("kafka.auto_offset_reset", "earliest")

	// Auth
	v.SetDefault("auth.jwt_secret", "change-me-in-production-use-256-bit-key")
	v.SetDefault("auth.jwt_issuer", "clario360")
	v.SetDefault("auth.access_token_ttl", 15*time.Minute)
	v.SetDefault("auth.refresh_token_ttl", 7*24*time.Hour)
	v.SetDefault("auth.bcrypt_cost", 12)

	// Observability
	v.SetDefault("observability.log_level", "debug")
	v.SetDefault("observability.log_format", "json")
	v.SetDefault("observability.otlp_endpoint", "")
	v.SetDefault("observability.service_name", "clario360")
	v.SetDefault("observability.metrics_port", 9090)

	// MinIO
	v.SetDefault("minio.endpoint", "localhost:9000")
	v.SetDefault("minio.access_key", "clario_minio")
	v.SetDefault("minio.secret_key", "clario_minio_secret")
	v.SetDefault("minio.use_ssl", false)
	v.SetDefault("minio.bucket", "clario360")

	// Encryption
	v.SetDefault("encryption.key", "0123456789abcdef0123456789abcdef")

	// WTQ-SEC-03: residency enforcement disabled by default (empty ServiceRegion).
	v.SetDefault("residency.service_region", "")
	v.SetDefault("residency.allowed_regions", []string{})

	// WebAuthn RP config (Decision D6): dev defaults.
	v.SetDefault("webauthn.rp_id", "localhost")
	v.SetDefault("webauthn.rp_origins", []string{"http://localhost:3002"})
	v.SetDefault("webauthn.rp_display_name", "Clario360")
}

func bindEnvVars(v *viper.Viper) {
	bindings := map[string]string{
		"server.host":                 "SERVER_HOST",
		"server.port":                 "SERVER_PORT",
		"server.read_timeout":         "SERVER_READ_TIMEOUT",
		"server.write_timeout":        "SERVER_WRITE_TIMEOUT",
		"server.shutdown_timeout":     "SERVER_SHUTDOWN_TIMEOUT",
		"server.tls_enabled":          "SERVER_TLS_ENABLED",
		"server.tls_cert_path":        "SERVER_TLS_CERT_PATH",
		"server.tls_key_path":         "SERVER_TLS_KEY_PATH",
		"database.host":               "DATABASE_HOST",
		"database.port":               "DATABASE_PORT",
		"database.user":               "DATABASE_USER",
		"database.password":           "DATABASE_PASSWORD",
		"database.name":               "DATABASE_NAME",
		"database.ssl_mode":           "DATABASE_SSL_MODE",
		"database.max_open_conns":     "DATABASE_MAX_OPEN_CONNS",
		"database.max_idle_conns":     "DATABASE_MAX_IDLE_CONNS",
		"database.conn_max_lifetime":  "DATABASE_CONN_MAX_LIFETIME",
		"redis.host":                  "REDIS_HOST",
		"redis.port":                  "REDIS_PORT",
		"redis.password":              "REDIS_PASSWORD",
		"redis.db":                    "REDIS_DB",
		"kafka.brokers":               "KAFKA_BROKERS",
		"kafka.group_id":              "KAFKA_GROUP_ID",
		"kafka.auto_offset_reset":     "KAFKA_AUTO_OFFSET_RESET",
		"auth.jwt_secret":             "AUTH_JWT_SECRET",
		"auth.rsa_private_key_pem":    "AUTH_RSA_PRIVATE_KEY_PEM",
		"auth.rsa_public_key_pem":     "AUTH_RSA_PUBLIC_KEY_PEM",
		"auth.jwt_issuer":             "AUTH_JWT_ISSUER",
		"auth.access_token_ttl":       "AUTH_JWT_ACCESS_TOKEN_TTL",
		"auth.refresh_token_ttl":      "AUTH_JWT_REFRESH_TOKEN_TTL",
		"auth.bcrypt_cost":            "AUTH_BCRYPT_COST",
		"observability.log_level":     "LOG_LEVEL",
		"observability.log_format":    "LOG_FORMAT",
		"observability.otlp_endpoint": "OTEL_EXPORTER_OTLP_ENDPOINT",
		"observability.service_name":  "OTEL_SERVICE_NAME",
		"observability.metrics_port":  "METRICS_PORT",
		"minio.endpoint":              "MINIO_ENDPOINT",
		"minio.access_key":            "MINIO_ACCESS_KEY",
		"minio.secret_key":            "MINIO_SECRET_KEY",
		"minio.use_ssl":               "MINIO_USE_SSL",
		"minio.bucket":                "MINIO_BUCKET",
		"encryption.key":              "ENCRYPTION_KEY",
		"residency.service_region":    "SERVICE_REGION",
		"residency.allowed_regions":   "RESIDENCY_ALLOWED_REGIONS",
		"webauthn.rp_id":              "WEBAUTHN_RP_ID",
		"webauthn.rp_origins":         "WEBAUTHN_RP_ORIGINS",
		"webauthn.rp_display_name":    "WEBAUTHN_RP_DISPLAY_NAME",
	}
	for key, env := range bindings {
		_ = v.BindEnv(key, env)
	}
}
