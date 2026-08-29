package config

import (
	"strings"
	"testing"
)

func newGetter(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoad_ValidMinimum(t *testing.T) {
	t.Parallel()
	cfg, err := LoadWith(LoadOptions{Getenv: newGetter(map[string]string{
		"SIEM_PG_DSN":              "postgres://siem:siem@localhost:5432/siem_db?sslmode=disable",
		"SIEM_JWT_PUBLIC_KEY_PATH": "/tmp/jwt.pub",
	})})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.HTTPPort != 8094 {
		t.Errorf("HTTPPort default = %d, want 8094", cfg.HTTPPort)
	}
	if cfg.AdminPort != 9082 {
		t.Errorf("AdminPort default = %d, want 9082", cfg.AdminPort)
	}
	if cfg.RedisDB != 7 {
		t.Errorf("RedisDB default = %d, want 7", cfg.RedisDB)
	}
	if cfg.KafkaClientID != ServiceName {
		t.Errorf("KafkaClientID default = %q, want %q", cfg.KafkaClientID, ServiceName)
	}
	if cfg.ServiceConfig == nil {
		t.Fatal("ServiceConfig must be populated")
	}
	if cfg.ServiceConfig.Name != ServiceName {
		t.Errorf("ServiceConfig.Name = %q, want %q", cfg.ServiceConfig.Name, ServiceName)
	}
}

func TestLoad_MissingRequired(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		env  map[string]string
		want []string
	}{
		{
			name: "missing both",
			env:  map[string]string{},
			want: []string{"SIEM_PG_DSN", "SIEM_JWT_PUBLIC_KEY_PATH"},
		},
		{
			name: "missing pg only",
			env:  map[string]string{"SIEM_JWT_PUBLIC_KEY_PATH": "/tmp/key"},
			want: []string{"SIEM_PG_DSN"},
		},
		{
			name: "missing jwt only",
			env:  map[string]string{"SIEM_PG_DSN": "postgres://x"},
			want: []string{"SIEM_JWT_PUBLIC_KEY_PATH"},
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			_, err := LoadWith(LoadOptions{Getenv: newGetter(tc.env)})
			if err == nil {
				t.Fatal("expected error")
			}
			for _, missing := range tc.want {
				if !strings.Contains(err.Error(), missing) {
					t.Errorf("error must mention %s; got %v", missing, err)
				}
			}
		})
	}
}

func TestLoad_InvalidValues(t *testing.T) {
	t.Parallel()
	base := map[string]string{
		"SIEM_PG_DSN":              "postgres://x",
		"SIEM_JWT_PUBLIC_KEY_PATH": "/tmp/key",
	}
	cases := []struct {
		name, key, value, mustContain string
	}{
		{"bad http port", "SIEM_HTTP_PORT", "not-a-number", "SIEM_HTTP_PORT"},
		{"bad admin port", "SIEM_ADMIN_PORT", "abc", "SIEM_ADMIN_PORT"},
		{"bad pg max", "SIEM_PG_MAX_CONNS", "-1", ">= 1"},
		{"bad shutdown", "SIEM_SHUTDOWN_TIMEOUT_SEC", "0", "SIEM_SHUTDOWN_TIMEOUT_SEC"},
		{"bad pprof", "SIEM_ENABLE_PPROF", "not-a-bool", "SIEM_ENABLE_PPROF"},
		{"bad tls", "SIEM_KAFKA_TLS_ENABLED", "notbool", "SIEM_KAFKA_TLS_ENABLED"},
		{"bad log level", "SIEM_LOG_LEVEL", "trace", "SIEM_LOG_LEVEL"},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			env := map[string]string{}
			for k, v := range base {
				env[k] = v
			}
			env[tc.key] = tc.value
			_, err := LoadWith(LoadOptions{Getenv: newGetter(env)})
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tc.mustContain) {
				t.Errorf("error must mention %q; got %v", tc.mustContain, err)
			}
		})
	}
}

func TestLoad_KafkaBrokersSplit(t *testing.T) {
	t.Parallel()
	cfg, err := LoadWith(LoadOptions{Getenv: newGetter(map[string]string{
		"SIEM_PG_DSN":              "postgres://x",
		"SIEM_JWT_PUBLIC_KEY_PATH": "/tmp/k",
		"SIEM_KAFKA_BROKERS":       "a:1, b:2 ,c:3",
	})})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(cfg.KafkaBrokers), 3; got != want {
		t.Fatalf("brokers count = %d, want %d (%v)", got, want, cfg.KafkaBrokers)
	}
	for i, b := range cfg.KafkaBrokers {
		if strings.ContainsAny(b, " \t") {
			t.Errorf("broker[%d]=%q is not trimmed", i, b)
		}
	}
}

func TestConfig_StringRedacts(t *testing.T) {
	t.Parallel()
	cfg, err := LoadWith(LoadOptions{Getenv: newGetter(map[string]string{
		"SIEM_PG_DSN":              "postgres://user:topsecretpassword@host/siem_db",
		"SIEM_JWT_PUBLIC_KEY_PATH": "/etc/keys/PRODUCTION_KEY.pem",
		"SIEM_OPENSEARCH_AUTH":     "Basic dXNlcjpwYXNz",
	})})
	if err != nil {
		t.Fatal(err)
	}
	s := cfg.String()
	for _, secret := range []string{"topsecretpassword", "PRODUCTION_KEY.pem", "dXNlcjpwYXNz"} {
		if strings.Contains(s, secret) {
			t.Errorf("String() must redact %q; got %s", secret, s)
		}
	}
	if !strings.Contains(s, "[REDACTED]") {
		t.Errorf("String() should mark redactions; got %s", s)
	}
}

func TestConfig_NilString(t *testing.T) {
	t.Parallel()
	var c *Config
	if got, want := c.String(), "config<nil>"; got != want {
		t.Errorf("nil String() = %q, want %q", got, want)
	}
}

func TestLoad_TopLevelLoadHonorsEnvAbsence(t *testing.T) {
	// Top-level Load() should error when nothing is set. We isolate process env.
	t.Setenv("SIEM_PG_DSN", "")
	t.Setenv("SIEM_JWT_PUBLIC_KEY_PATH", "")
	_, err := Load()
	if err == nil {
		t.Fatal("Load() with empty env should error")
	}
}
