package config

import (
	"testing"
	"time"

	appconfig "github.com/clario360/platform/internal/config"
)

func baseConfig() *appconfig.Config {
	base := &appconfig.Config{}
	base.Database.User = "clario"
	base.Database.Password = "secret"
	base.Database.Host = "localhost"
	base.Database.Port = 5432
	base.Database.SSLMode = "disable"
	base.Kafka.Brokers = []string{"localhost:9092"}
	return base
}

func TestLoad_Defaults(t *testing.T) {
	cfg, err := Load(baseConfig())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPPort != 8098 || cfg.AdminPort != 9098 {
		t.Fatalf("default ports = %d/%d, want 8098/9098", cfg.HTTPPort, cfg.AdminPort)
	}
	if cfg.KafkaGroupID != "automation-service" {
		t.Fatalf("KafkaGroupID = %q", cfg.KafkaGroupID)
	}
	if cfg.MigrationsPath != "migrations/automation_db" {
		t.Fatalf("MigrationsPath = %q", cfg.MigrationsPath)
	}
	// DSN derived from base config with automation_db name.
	wantDSN := "postgres://clario:secret@localhost:5432/automation_db?sslmode=disable"
	if cfg.DBURL != wantDSN {
		t.Fatalf("DBURL = %q, want %q", cfg.DBURL, wantDSN)
	}
	if len(cfg.KafkaBrokers) != 1 || cfg.KafkaBrokers[0] != "localhost:9092" {
		t.Fatalf("KafkaBrokers = %v", cfg.KafkaBrokers)
	}
	if cfg.LeaderRenew >= cfg.LeaderTTL {
		t.Fatalf("LeaderRenew %s should be < LeaderTTL %s", cfg.LeaderRenew, cfg.LeaderTTL)
	}
}

func TestLoad_EnvOverrides(t *testing.T) {
	t.Setenv("AUTO_HTTP_PORT", "9999")
	t.Setenv("AUTO_DATABASE_URL", "postgres://x/y")
	t.Setenv("AUTO_KAFKA_BROKERS", "a:9092, b:9092 ,")
	t.Setenv("AUTO_DRIVER_POLL_INTERVAL", "750ms")
	t.Setenv("AUTO_STEP_MAX_ATTEMPTS", "7")

	cfg, err := Load(baseConfig())
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.HTTPPort != 9999 {
		t.Fatalf("HTTPPort = %d, want 9999", cfg.HTTPPort)
	}
	if cfg.DBURL != "postgres://x/y" {
		t.Fatalf("DBURL = %q", cfg.DBURL)
	}
	if len(cfg.KafkaBrokers) != 2 {
		t.Fatalf("KafkaBrokers = %v, want 2 entries", cfg.KafkaBrokers)
	}
	if cfg.DriverPollInterval != 750*time.Millisecond {
		t.Fatalf("DriverPollInterval = %s", cfg.DriverPollInterval)
	}
	if cfg.StepMaxAttempts != 7 {
		t.Fatalf("StepMaxAttempts = %d", cfg.StepMaxAttempts)
	}
}

func TestLoad_RejectsBadDuration(t *testing.T) {
	t.Setenv("AUTO_LEADER_TTL", "not-a-duration")
	if _, err := Load(baseConfig()); err == nil {
		t.Fatal("expected error for invalid AUTO_LEADER_TTL")
	}
}

func TestLoad_RejectsRenewGEThanTTL(t *testing.T) {
	t.Setenv("AUTO_LEADER_TTL", "5s")
	t.Setenv("AUTO_LEADER_RENEW", "5s")
	if _, err := Load(baseConfig()); err == nil {
		t.Fatal("expected error when renew >= ttl")
	}
}

func TestLoad_RejectsBadInt(t *testing.T) {
	t.Setenv("AUTO_HTTP_PORT", "abc")
	if _, err := Load(baseConfig()); err == nil {
		t.Fatal("expected error for invalid AUTO_HTTP_PORT")
	}
}
