package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/agent"
)

func TestAgentConfig_LogicalPostgresSourceDoesNotRequireWatermark(t *testing.T) {
	cfg := baseAgentConfig()
	cfg.Sources = []sourceConfig{{
		StreamID:     "pg-stream",
		Kind:         string(agent.SourcePostgres),
		DSN:          "postgres://replicator:secret@db.example.com:5432/app?sslmode=verify-full",
		DEKHex:       testDEKHex(),
		Schema:       "public",
		Table:        "account",
		Columns:      []string{"id", "name", "updated_at"},
		PrimaryKey:   []string{"id"},
		Mode:         string(agent.PostgresModeLogical),
		Plugin:       "pgoutput",
		SlotName:     "clario_slot",
		Publications: []string{"clario_pub"},
	}}

	if err := cfg.validate(); err != nil {
		t.Fatalf("validate logical config: %v", err)
	}
	specs, err := cfg.toSourceSpecs()
	if err != nil {
		t.Fatalf("toSourceSpecs: %v", err)
	}
	if len(specs) != 1 {
		t.Fatalf("spec len = %d, want 1", len(specs))
	}
	got := specs[0]
	if got.PostgresMode != agent.PostgresModeLogical {
		t.Fatalf("PostgresMode = %q, want logical", got.PostgresMode)
	}
	if got.PGLogical.SlotName != "clario_slot" || got.PGLogical.Plugin != "pgoutput" {
		t.Fatalf("PGLogical = %+v, want slot/plugin", got.PGLogical)
	}
	if got.PGTable.Watermark != "" {
		t.Fatalf("logical config should not require or synthesize a watermark, got %q", got.PGTable.Watermark)
	}
}

func TestAgentConfig_RejectsInsecureRemoteIngest(t *testing.T) {
	cfg := baseAgentConfig()
	cfg.IngestURL = "https://dr.example.com:8098"
	cfg.InsecureSkipVerify = true
	cfg.Sources = []sourceConfig{validFileSource()}

	if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("validate err = %v, want loopback-only insecure_skip_verify error", err)
	}
}

func TestAgentConfig_AllowsLoopbackHTTPOnlyForLocalDevelopment(t *testing.T) {
	cfg := baseAgentConfig()
	cfg.IngestURL = "http://127.0.0.1:8098"
	cfg.InsecureSkipVerify = true
	cfg.Sources = []sourceConfig{validFileSource()}

	if err := cfg.validate(); err != nil {
		t.Fatalf("validate loopback HTTP config: %v", err)
	}

	cfg.IngestURL = "http://dr.example.com:8098"
	if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), "https outside loopback") {
		t.Fatalf("validate err = %v, want remote HTTP rejection", err)
	}
}

func TestAgentConfig_EnvOverridesSecretsAndTuning(t *testing.T) {
	cfg := &agentConfig{
		Sources: []sourceConfig{{StreamID: "stream-1"}},
	}
	t.Setenv("CLARIO_DR_AGENT_DEK_STREAM_1", testDEKHex())
	t.Setenv("CLARIO_DR_AGENT_DSN_STREAM_1", "postgres://env-secret")
	t.Setenv("CLARIO_DR_AGENT_RECONNECT_BACKOFF", "250ms")
	t.Setenv("CLARIO_DR_AGENT_MAX_RECONNECT_BACKOFF", "5s")
	t.Setenv("CLARIO_DR_AGENT_THROTTLE_BYTES_PER_SEC", "4096")
	t.Setenv("CLARIO_DR_AGENT_RENEWAL_TOKEN_FILE", "/run/secrets/dr/rotate.jwt")
	t.Setenv("CLARIO_DR_AGENT_CERT_RENEW_BEFORE", "12h")
	t.Setenv("CLARIO_DR_AGENT_CERT_RENEW_CHECK_INTERVAL", "30m")
	t.Setenv("CLARIO_DR_AGENT_CERT_RENEW_RETRY_BACKOFF", "2m")

	if err := cfg.applyEnvOverrides(); err != nil {
		t.Fatalf("applyEnvOverrides: %v", err)
	}
	if cfg.Sources[0].DEKHex != testDEKHex() {
		t.Fatalf("DEK override not applied")
	}
	if cfg.Sources[0].DSN != "postgres://env-secret" {
		t.Fatalf("DSN override = %q", cfg.Sources[0].DSN)
	}
	if cfg.ReconnectBackoff != 250*time.Millisecond || cfg.MaxReconnectBackoff != 5*time.Second {
		t.Fatalf("backoff overrides = %s/%s", cfg.ReconnectBackoff, cfg.MaxReconnectBackoff)
	}
	if cfg.ThrottleBytesPerSec != 4096 {
		t.Fatalf("throttle override = %v", cfg.ThrottleBytesPerSec)
	}
	if cfg.RenewalTokenFile != "/run/secrets/dr/rotate.jwt" {
		t.Fatalf("renewal token file = %q", cfg.RenewalTokenFile)
	}
	if cfg.CertRenewBefore != 12*time.Hour || cfg.CertRenewCheckInterval != 30*time.Minute || cfg.CertRenewRetryBackoff != 2*time.Minute {
		t.Fatalf("renewal timings = %s/%s/%s", cfg.CertRenewBefore, cfg.CertRenewCheckInterval, cfg.CertRenewRetryBackoff)
	}
}

func TestAgentConfig_EnvFileOverridesStreamSecrets(t *testing.T) {
	clearAgentEnv(t)
	dir := t.TempDir()
	dekPath := filepath.Join(dir, "stream.dek")
	dsnPath := filepath.Join(dir, "stream.dsn")
	if err := os.WriteFile(dekPath, []byte(" "+testDEKHex()+"\n"), 0o600); err != nil {
		t.Fatalf("write dek file: %v", err)
	}
	if err := os.WriteFile(dsnPath, []byte(" postgres://file-secret \n"), 0o600); err != nil {
		t.Fatalf("write dsn file: %v", err)
	}
	cfg := &agentConfig{
		Sources: []sourceConfig{{StreamID: "stream-1"}},
	}
	t.Setenv("CLARIO_DR_AGENT_DEK_STREAM_1_FILE", dekPath)
	t.Setenv("CLARIO_DR_AGENT_DSN_STREAM_1_FILE", dsnPath)

	if err := cfg.applyEnvOverrides(); err != nil {
		t.Fatalf("applyEnvOverrides: %v", err)
	}
	if cfg.Sources[0].DEKHex != testDEKHex() {
		t.Fatalf("DEK file override = %q", cfg.Sources[0].DEKHex)
	}
	if cfg.Sources[0].DSN != "postgres://file-secret" {
		t.Fatalf("DSN file override = %q", cfg.Sources[0].DSN)
	}
}

func TestAgentConfig_DirectEnvOverridesSecretFile(t *testing.T) {
	clearAgentEnv(t)
	dekPath := filepath.Join(t.TempDir(), "stream.dek")
	if err := os.WriteFile(dekPath, []byte(strings.Repeat("cd", 32)), 0o600); err != nil {
		t.Fatalf("write dek file: %v", err)
	}
	cfg := &agentConfig{
		Sources: []sourceConfig{{StreamID: "stream-1"}},
	}
	t.Setenv("CLARIO_DR_AGENT_DEK_STREAM_1", testDEKHex())
	t.Setenv("CLARIO_DR_AGENT_DEK_STREAM_1_FILE", dekPath)

	if err := cfg.applyEnvOverrides(); err != nil {
		t.Fatalf("applyEnvOverrides: %v", err)
	}
	if cfg.Sources[0].DEKHex != testDEKHex() {
		t.Fatalf("DEK override = %q, want direct env value", cfg.Sources[0].DEKHex)
	}
}

func TestAgentConfig_SupportsLegacyThrottleEnvName(t *testing.T) {
	clearAgentEnv(t)
	cfg := &agentConfig{}
	t.Setenv("DR_THROTTLE_BYTES_PER_SEC", "2048")

	if err := cfg.applyEnvOverrides(); err != nil {
		t.Fatalf("applyEnvOverrides: %v", err)
	}
	if cfg.ThrottleBytesPerSec != 2048 {
		t.Fatalf("throttle override = %v, want 2048", cfg.ThrottleBytesPerSec)
	}
}

func TestAgentConfig_PrefersCurrentThrottleEnvName(t *testing.T) {
	clearAgentEnv(t)
	cfg := &agentConfig{}
	t.Setenv("CLARIO_DR_AGENT_THROTTLE_BYTES_PER_SEC", "4096")
	t.Setenv("DR_THROTTLE_BYTES_PER_SEC", "2048")

	if err := cfg.applyEnvOverrides(); err != nil {
		t.Fatalf("applyEnvOverrides: %v", err)
	}
	if cfg.ThrottleBytesPerSec != 4096 {
		t.Fatalf("throttle override = %v, want 4096", cfg.ThrottleBytesPerSec)
	}
}

func TestLoadConfig_ParsesYAMLDurationStrings(t *testing.T) {
	clearAgentEnv(t)
	path := filepath.Join(t.TempDir(), "agent.yaml")
	raw := []byte(`
ingest_url: https://dr.example.com:8098
cache_dir: /var/lib/clario-dr-agent
reconnect_backoff: 250ms
max_reconnect_backoff: 5s
sources:
  - stream_id: file-stream
    kind: file
    path: /srv/app
    dek_hex: ` + testDEKHex() + `
`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg, err := loadConfig(path)
	if err != nil {
		t.Fatalf("loadConfig: %v", err)
	}
	if cfg.ReconnectBackoff != 250*time.Millisecond || cfg.MaxReconnectBackoff != 5*time.Second {
		t.Fatalf("duration strings parsed as %s/%s", cfg.ReconnectBackoff, cfg.MaxReconnectBackoff)
	}
	if err := cfg.validate(); err != nil {
		t.Fatalf("validate loaded config: %v", err)
	}
	if cfg.CertRenewBefore != 24*time.Hour || cfg.CertRenewCheckInterval != time.Hour || cfg.CertRenewRetryBackoff != 5*time.Minute {
		t.Fatalf("default renewal timings = %s/%s/%s", cfg.CertRenewBefore, cfg.CertRenewCheckInterval, cfg.CertRenewRetryBackoff)
	}
}

func TestLoadConfig_CommittedExampleStaysValid(t *testing.T) {
	clearAgentEnv(t)

	cfg, err := loadConfig("clario-dr-agent.example.yaml")
	if err != nil {
		t.Fatalf("load example config: %v", err)
	}
	if err := cfg.validate(); err != nil {
		t.Fatalf("validate example config: %v", err)
	}
	if got := len(cfg.Sources); got < 3 {
		t.Fatalf("example sources = %d, want file plus postgres logical examples", got)
	}
}

func TestAgentConfig_InvalidBooleanEnvFailsClosed(t *testing.T) {
	cfg := &agentConfig{}
	t.Setenv("CLARIO_DR_AGENT_INSECURE_SKIP_VERIFY", "not-a-bool")

	if err := cfg.applyEnvOverrides(); err == nil {
		t.Fatal("expected invalid boolean env to fail")
	}
}

func baseAgentConfig() *agentConfig {
	return &agentConfig{
		IngestURL:              "https://dr.example.com:8098",
		CacheDir:               "/var/lib/clario-dr-agent",
		ReconnectBackoff:       time.Second,
		MaxReconnectBackoff:    30 * time.Second,
		CertRenewBefore:        24 * time.Hour,
		CertRenewCheckInterval: time.Hour,
		CertRenewRetryBackoff:  5 * time.Minute,
	}
}

func validFileSource() sourceConfig {
	return sourceConfig{
		StreamID: "file-stream",
		Kind:     string(agent.SourceFile),
		Path:     "/srv/app",
		DEKHex:   testDEKHex(),
	}
}

func testDEKHex() string {
	return strings.Repeat("ab", 32)
}

func clearAgentEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"CLARIO_DR_AGENT_CONTROL_PLANE_URL",
		"CLARIO_DR_AGENT_INGEST_URL",
		"CLARIO_DR_AGENT_CACHE_DIR",
		"CLARIO_DR_AGENT_AGENT_ID",
		"CLARIO_DR_AGENT_TENANT_ID",
		"CLARIO_DR_AGENT_SITE_ID",
		"CLARIO_DR_AGENT_ENROLLMENT_TOKEN",
		"CLARIO_DR_AGENT_RENEWAL_TOKEN_FILE",
		"CLARIO_DR_AGENT_ENROLL_CA_BUNDLE_PEM",
		"CLARIO_DR_AGENT_METRICS_ADDR",
		"CLARIO_DR_AGENT_SERVER_NAME",
		"CLARIO_DR_AGENT_RECONNECT_BACKOFF",
		"CLARIO_DR_AGENT_MAX_RECONNECT_BACKOFF",
		"CLARIO_DR_AGENT_CERT_RENEW_BEFORE",
		"CLARIO_DR_AGENT_CERT_RENEW_CHECK_INTERVAL",
		"CLARIO_DR_AGENT_CERT_RENEW_RETRY_BACKOFF",
		"CLARIO_DR_AGENT_THROTTLE_BYTES_PER_SEC",
		"DR_THROTTLE_BYTES_PER_SEC",
		"CLARIO_DR_AGENT_INSECURE_SKIP_VERIFY",
		"CLARIO_DR_AGENT_DEK_FILE_STREAM",
		"CLARIO_DR_AGENT_DEK_FILE_STREAM_FILE",
		"CLARIO_DR_AGENT_DSN_FILE_STREAM",
		"CLARIO_DR_AGENT_DSN_FILE_STREAM_FILE",
		"CLARIO_DR_AGENT_DEK_STREAM_1",
		"CLARIO_DR_AGENT_DEK_STREAM_1_FILE",
		"CLARIO_DR_AGENT_DSN_STREAM_1",
		"CLARIO_DR_AGENT_DSN_STREAM_1_FILE",
	} {
		t.Setenv(key, "")
	}
}
