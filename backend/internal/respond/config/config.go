package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	appconfig "github.com/clario360/platform/internal/config"
)

type Config struct {
	HTTPPort   int
	AdminPort  int
	DBURL      string
	DBMinConns int
	DBMaxConns int

	MigrationsPath   string
	JWTPublicKeyPath string

	LicenseServiceURL   string
	EntitlementTimeout  time.Duration
	EntitlementFailOpen bool

	NotificationServiceURL   string
	NotificationServiceToken string
	NotificationTimeout      time.Duration
	MobilizationAckTimeout   time.Duration

	IntegrationSecretKey   string
	IntegrationSecretKeyID string
}

func Default() *Config {
	return &Config{
		HTTPPort:               8099,
		AdminPort:              9099,
		DBMinConns:             2,
		DBMaxConns:             10,
		MigrationsPath:         "migrations/respond_db",
		LicenseServiceURL:      "http://localhost:8096",
		EntitlementTimeout:     3 * time.Second,
		NotificationTimeout:    5 * time.Second,
		MobilizationAckTimeout: 5 * time.Minute,
	}
}

func Load(base *appconfig.Config) (*Config, error) {
	cfg := Default()
	var err error
	if cfg.HTTPPort, err = intEnv("RESPOND_HTTP_PORT", cfg.HTTPPort); err != nil {
		return nil, err
	}
	if cfg.AdminPort, err = intEnv("RESPOND_ADMIN_PORT", cfg.AdminPort); err != nil {
		return nil, err
	}
	cfg.DBURL = strings.TrimSpace(os.Getenv("RESPOND_DATABASE_URL"))
	if cfg.DBURL == "" {
		derived := base.Database
		derived.Name = "respond_db"
		cfg.DBURL = derived.DSN()
	}
	if cfg.DBMinConns, err = intEnv("RESPOND_DB_MIN_CONNS", cfg.DBMinConns); err != nil {
		return nil, err
	}
	if cfg.DBMaxConns, err = intEnv("RESPOND_DB_MAX_CONNS", cfg.DBMaxConns); err != nil {
		return nil, err
	}
	if v := strings.TrimSpace(os.Getenv("RESPOND_MIGRATIONS_PATH")); v != "" {
		cfg.MigrationsPath = v
	}
	cfg.JWTPublicKeyPath = strings.TrimSpace(os.Getenv("RESPOND_JWT_PUBLIC_KEY_PATH"))
	if v := strings.TrimSpace(os.Getenv("RESPOND_LICENSE_SERVICE_URL")); v != "" {
		cfg.LicenseServiceURL = v
	}
	if v := strings.TrimSpace(os.Getenv("RESPOND_ENTITLEMENT_TIMEOUT")); v != "" {
		timeout, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid RESPOND_ENTITLEMENT_TIMEOUT %q: %w", v, err)
		}
		cfg.EntitlementTimeout = timeout
	}
	if v := strings.TrimSpace(os.Getenv("RESPOND_ENTITLEMENT_FAIL_OPEN")); v != "" {
		failOpen, err := strconv.ParseBool(v)
		if err != nil {
			return nil, fmt.Errorf("invalid RESPOND_ENTITLEMENT_FAIL_OPEN %q: %w", v, err)
		}
		cfg.EntitlementFailOpen = failOpen
	}
	cfg.NotificationServiceURL = strings.TrimSpace(os.Getenv("RESPOND_NOTIFICATION_SERVICE_URL"))
	cfg.NotificationServiceToken = strings.TrimSpace(os.Getenv("RESPOND_NOTIFICATION_SERVICE_TOKEN"))
	if v := strings.TrimSpace(os.Getenv("RESPOND_NOTIFICATION_TIMEOUT")); v != "" {
		timeout, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid RESPOND_NOTIFICATION_TIMEOUT %q: %w", v, err)
		}
		cfg.NotificationTimeout = timeout
	}
	if v := strings.TrimSpace(os.Getenv("RESPOND_MOBILIZATION_ACK_TIMEOUT")); v != "" {
		timeout, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid RESPOND_MOBILIZATION_ACK_TIMEOUT %q: %w", v, err)
		}
		cfg.MobilizationAckTimeout = timeout
	}
	cfg.IntegrationSecretKey = strings.TrimSpace(os.Getenv("RESPOND_INTEGRATION_SECRET_KEY"))
	cfg.IntegrationSecretKeyID = strings.TrimSpace(os.Getenv("RESPOND_INTEGRATION_SECRET_KEY_ID"))
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) Validate() error {
	if c.HTTPPort < 1 || c.HTTPPort > 65535 {
		return fmt.Errorf("RESPOND_HTTP_PORT must be in [1,65535], got %d", c.HTTPPort)
	}
	if c.AdminPort < 1 || c.AdminPort > 65535 {
		return fmt.Errorf("RESPOND_ADMIN_PORT must be in [1,65535], got %d", c.AdminPort)
	}
	if c.DBMaxConns < c.DBMinConns {
		return fmt.Errorf("RESPOND_DB_MAX_CONNS (%d) must be >= RESPOND_DB_MIN_CONNS (%d)", c.DBMaxConns, c.DBMinConns)
	}
	if strings.TrimSpace(c.LicenseServiceURL) == "" {
		return fmt.Errorf("RESPOND_LICENSE_SERVICE_URL is required")
	}
	if c.EntitlementTimeout <= 0 {
		return fmt.Errorf("RESPOND_ENTITLEMENT_TIMEOUT must be positive")
	}
	if strings.TrimSpace(c.NotificationServiceURL) != "" && strings.TrimSpace(c.NotificationServiceToken) == "" {
		return fmt.Errorf("RESPOND_NOTIFICATION_SERVICE_TOKEN is required when RESPOND_NOTIFICATION_SERVICE_URL is set")
	}
	if c.NotificationTimeout <= 0 {
		return fmt.Errorf("RESPOND_NOTIFICATION_TIMEOUT must be positive")
	}
	if c.MobilizationAckTimeout <= 0 {
		return fmt.Errorf("RESPOND_MOBILIZATION_ACK_TIMEOUT must be positive")
	}
	if strings.TrimSpace(c.IntegrationSecretKey) == "" && strings.TrimSpace(c.IntegrationSecretKeyID) != "" {
		return fmt.Errorf("RESPOND_INTEGRATION_SECRET_KEY_ID requires RESPOND_INTEGRATION_SECRET_KEY")
	}
	return nil
}

func intEnv(key string, fallback int) (int, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s %q: %w", key, v, err)
	}
	return n, nil
}
