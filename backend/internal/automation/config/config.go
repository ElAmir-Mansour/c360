// Package config loads automation-service configuration from the environment,
// layered over the shared platform config. All knobs are AUTO_* env vars; unset
// values fall back to development defaults or are derived from the platform
// config (database DSN, Kafka brokers).
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	appconfig "github.com/clario360/platform/internal/config"
)

// Config carries automation-service settings.
type Config struct {
	HTTPPort   int
	AdminPort  int
	DBURL      string
	DBMinConns int
	DBMaxConns int

	KafkaBrokers []string
	KafkaGroupID string

	MigrationsPath string

	// JWTPublicKeyPath optionally overrides the platform JWT public key for
	// validating gateway-issued tokens.
	JWTPublicKeyPath string

	// --- Leadership (the run-driver and cron schedule service are singletons) ---
	// LeaderTTL is how long an acquired leadership lease lives before it must be
	// renewed; LeaderRenew is the renewal cadence (must be < TTL).
	LeaderTTL   time.Duration
	LeaderRenew time.Duration

	// --- Run orchestrator driver (the gated FSM, §6) ---
	// DriverPollInterval is how often the leader driver polls for runnable runs
	// (PENDING|RUNNING) to claim with FOR UPDATE SKIP LOCKED.
	DriverPollInterval time.Duration
	// DriverBatchSize bounds how many runs the driver claims per poll.
	DriverBatchSize int
	// StepMaxAttempts caps action retries before a step (and the run) FAILs.
	StepMaxAttempts int

	// --- Approval gates ---
	// GateSweepInterval is how often the leader sweeps for timed-out gates to
	// escalate or abort per the step's TimeoutAction policy.
	GateSweepInterval time.Duration

	// --- Schedule service (cron triggers, leader-singleton) ---
	// ScheduleTickInterval is how often the cron scheduler wakes to fire due
	// schedule-trigger automations.
	ScheduleTickInterval time.Duration

	// --- Idempotency / dedupe ---
	// IdempotencyTTL is how long a processed trigger occurrence id is remembered
	// in Redis to suppress duplicates (the DB unique backstop covers permanence).
	IdempotencyTTL time.Duration
}

// Default returns development defaults; ports follow the platform layout
// (HTTP 80xx / admin 90xx). license-service is x96, clario-dr-service is 8097,
// so automation-service takes x98.
func Default() *Config {
	return &Config{
		HTTPPort:             8098,
		AdminPort:            9098,
		DBMinConns:           2,
		DBMaxConns:           10,
		KafkaGroupID:         "automation-service",
		MigrationsPath:       "migrations/automation_db",
		LeaderTTL:            15 * time.Second,
		LeaderRenew:          5 * time.Second,
		DriverPollInterval:   2 * time.Second,
		DriverBatchSize:      10,
		StepMaxAttempts:      3,
		GateSweepInterval:    30 * time.Second,
		ScheduleTickInterval: 30 * time.Second,
		IdempotencyTTL:       24 * time.Hour,
	}
}

// Load reads AUTO_* environment variables over defaults, deriving the database
// URL and Kafka brokers from the platform config when unset.
func Load(base *appconfig.Config) (*Config, error) {
	cfg := Default()

	var err error
	if cfg.HTTPPort, err = intEnv("AUTO_HTTP_PORT", cfg.HTTPPort); err != nil {
		return nil, err
	}
	if cfg.AdminPort, err = intEnv("AUTO_ADMIN_PORT", cfg.AdminPort); err != nil {
		return nil, err
	}

	cfg.DBURL = os.Getenv("AUTO_DATABASE_URL")
	if cfg.DBURL == "" {
		derived := base.Database
		derived.Name = "automation_db"
		cfg.DBURL = derived.DSN()
	}
	if cfg.DBMinConns, err = intEnv("AUTO_DB_MIN_CONNS", cfg.DBMinConns); err != nil {
		return nil, err
	}
	if cfg.DBMaxConns, err = intEnv("AUTO_DB_MAX_CONNS", cfg.DBMaxConns); err != nil {
		return nil, err
	}

	if v := os.Getenv("AUTO_KAFKA_BROKERS"); v != "" {
		cfg.KafkaBrokers = splitNonEmpty(v)
	} else {
		cfg.KafkaBrokers = base.Kafka.Brokers
	}
	if v := os.Getenv("AUTO_KAFKA_GROUP_ID"); v != "" {
		cfg.KafkaGroupID = v
	}

	if v := os.Getenv("AUTO_MIGRATIONS_PATH"); v != "" {
		cfg.MigrationsPath = v
	}
	cfg.JWTPublicKeyPath = os.Getenv("AUTO_JWT_PUBLIC_KEY_PATH")

	if cfg.LeaderTTL, err = durEnv("AUTO_LEADER_TTL", cfg.LeaderTTL); err != nil {
		return nil, err
	}
	if cfg.LeaderRenew, err = durEnv("AUTO_LEADER_RENEW", cfg.LeaderRenew); err != nil {
		return nil, err
	}
	if cfg.DriverPollInterval, err = durEnv("AUTO_DRIVER_POLL_INTERVAL", cfg.DriverPollInterval); err != nil {
		return nil, err
	}
	if cfg.DriverBatchSize, err = intEnv("AUTO_DRIVER_BATCH_SIZE", cfg.DriverBatchSize); err != nil {
		return nil, err
	}
	if cfg.StepMaxAttempts, err = intEnv("AUTO_STEP_MAX_ATTEMPTS", cfg.StepMaxAttempts); err != nil {
		return nil, err
	}
	if cfg.GateSweepInterval, err = durEnv("AUTO_GATE_SWEEP_INTERVAL", cfg.GateSweepInterval); err != nil {
		return nil, err
	}
	if cfg.ScheduleTickInterval, err = durEnv("AUTO_SCHEDULE_TICK_INTERVAL", cfg.ScheduleTickInterval); err != nil {
		return nil, err
	}
	if cfg.IdempotencyTTL, err = durEnv("AUTO_IDEMPOTENCY_TTL", cfg.IdempotencyTTL); err != nil {
		return nil, err
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// Validate rejects internally inconsistent configuration that would silently
// break the leader loops (e.g. a renew cadence at or above the lease TTL would
// never renew in time).
func (c *Config) Validate() error {
	if c.LeaderRenew >= c.LeaderTTL {
		return fmt.Errorf("AUTO_LEADER_RENEW (%s) must be less than AUTO_LEADER_TTL (%s)", c.LeaderRenew, c.LeaderTTL)
	}
	if c.DriverBatchSize < 1 {
		return fmt.Errorf("AUTO_DRIVER_BATCH_SIZE must be >= 1, got %d", c.DriverBatchSize)
	}
	if c.StepMaxAttempts < 1 {
		return fmt.Errorf("AUTO_STEP_MAX_ATTEMPTS must be >= 1, got %d", c.StepMaxAttempts)
	}
	if c.DBMaxConns < c.DBMinConns {
		return fmt.Errorf("AUTO_DB_MAX_CONNS (%d) must be >= AUTO_DB_MIN_CONNS (%d)", c.DBMaxConns, c.DBMinConns)
	}
	return nil
}

func intEnv(key string, fallback int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s %q: %w", key, v, err)
	}
	return n, nil
}

func durEnv(key string, fallback time.Duration) (time.Duration, error) {
	v := os.Getenv(key)
	if v == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("invalid %s %q: %w", key, v, err)
	}
	return d, nil
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
