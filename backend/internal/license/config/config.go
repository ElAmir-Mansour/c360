// Package config loads license-service configuration from the environment,
// layered over the shared platform config.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"

	appconfig "github.com/clario360/platform/internal/config"
)

// Config carries license-service settings.
type Config struct {
	HTTPPort   int
	AdminPort  int
	DBURL      string
	DBMinConns int
	DBMaxConns int

	KafkaBrokers []string
	KafkaGroupID string

	// JWTPublicKeyPath optionally overrides the platform JWT public key for
	// validating gateway-issued tokens.
	JWTPublicKeyPath string

	// SigningPrivateKeyPath enables offline license issuing (vendor side).
	// SigningPublicKeyPath enables offline license activation (customer side).
	SigningPrivateKeyPath string
	SigningPublicKeyPath  string

	MigrationsPath string
}

// Default returns development defaults; ports follow the platform layout
// (HTTP 80xx / admin 90xx, license-service = x96).
func Default() *Config {
	return &Config{
		HTTPPort:       8096,
		AdminPort:      9096,
		DBMinConns:     2,
		DBMaxConns:     10,
		KafkaGroupID:   "license-service",
		MigrationsPath: "migrations/license_db",
	}
}

// Load reads LICENSE_* environment variables over defaults, deriving the
// database URL and Kafka brokers from the platform config when unset.
func Load(base *appconfig.Config) (*Config, error) {
	cfg := Default()

	if v := os.Getenv("LICENSE_HTTP_PORT"); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid LICENSE_HTTP_PORT %q: %w", v, err)
		}
		cfg.HTTPPort = port
	}
	if v := os.Getenv("LICENSE_ADMIN_PORT"); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid LICENSE_ADMIN_PORT %q: %w", v, err)
		}
		cfg.AdminPort = port
	}

	cfg.DBURL = os.Getenv("LICENSE_DATABASE_URL")
	if cfg.DBURL == "" {
		derived := base.Database
		derived.Name = "license_db"
		cfg.DBURL = derived.DSN()
	}
	if v := os.Getenv("LICENSE_DB_MIN_CONNS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid LICENSE_DB_MIN_CONNS %q: %w", v, err)
		}
		cfg.DBMinConns = n
	}
	if v := os.Getenv("LICENSE_DB_MAX_CONNS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid LICENSE_DB_MAX_CONNS %q: %w", v, err)
		}
		cfg.DBMaxConns = n
	}

	if v := os.Getenv("LICENSE_KAFKA_BROKERS"); v != "" {
		cfg.KafkaBrokers = splitNonEmpty(v)
	} else {
		cfg.KafkaBrokers = base.Kafka.Brokers
	}
	if v := os.Getenv("LICENSE_KAFKA_GROUP_ID"); v != "" {
		cfg.KafkaGroupID = v
	}

	cfg.JWTPublicKeyPath = os.Getenv("LICENSE_JWT_PUBLIC_KEY_PATH")
	cfg.SigningPrivateKeyPath = os.Getenv("LICENSE_SIGNING_PRIVATE_KEY_PATH")
	cfg.SigningPublicKeyPath = os.Getenv("LICENSE_SIGNING_PUBLIC_KEY_PATH")

	if v := os.Getenv("LICENSE_MIGRATIONS_PATH"); v != "" {
		cfg.MigrationsPath = v
	}

	return cfg, nil
}

func splitNonEmpty(csv string) []string {
	parts := strings.Split(csv, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
