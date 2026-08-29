package config

import (
	"testing"
)

// WTQ-SEC-03 / WTQ-SEC-04: new config fields default to "disabled" so existing
// behavior is preserved when no env vars are set.
func TestLoad_ResidencyAndTLS_DefaultsDisabled(t *testing.T) {
	// Ensure no env leaks from the runner.
	for _, k := range []string{
		"SERVICE_REGION", "RESIDENCY_ALLOWED_REGIONS",
		"SERVER_TLS_ENABLED", "SERVER_TLS_CERT_PATH", "SERVER_TLS_KEY_PATH",
	} {
		t.Setenv(k, "")
	}

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}

	if cfg.Residency.Enabled() {
		t.Errorf("residency should be disabled by default, got ServiceRegion=%q", cfg.Residency.ServiceRegion)
	}
	if cfg.Server.TLSReady() {
		t.Errorf("TLS should be disabled by default")
	}
	if cfg.Server.TLSEnabled {
		t.Errorf("TLSEnabled should default to false")
	}
}

func TestLoad_ResidencyEnabledFromEnv(t *testing.T) {
	t.Setenv("SERVICE_REGION", "ksa-central")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if !cfg.Residency.Enabled() {
		t.Fatalf("residency should be enabled when SERVICE_REGION set")
	}
	if cfg.Residency.ServiceRegion != "ksa-central" {
		t.Errorf("ServiceRegion = %q, want ksa-central", cfg.Residency.ServiceRegion)
	}
}

func TestLoad_TLSEnabledFromEnv(t *testing.T) {
	t.Setenv("SERVER_TLS_ENABLED", "true")
	t.Setenv("SERVER_TLS_CERT_PATH", "/etc/clario/tls.crt")
	t.Setenv("SERVER_TLS_KEY_PATH", "/etc/clario/tls.key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error: %v", err)
	}
	if !cfg.Server.TLSEnabled {
		t.Fatalf("TLSEnabled should be true")
	}
	if !cfg.Server.TLSReady() {
		t.Fatalf("TLSReady should be true when enabled with cert+key")
	}
	if cfg.Server.TLSCertPath != "/etc/clario/tls.crt" {
		t.Errorf("TLSCertPath = %q", cfg.Server.TLSCertPath)
	}
}

func TestServerConfig_TLSReady(t *testing.T) {
	cases := []struct {
		name    string
		c       ServerConfig
		wantTLS bool
	}{
		{"disabled", ServerConfig{}, false},
		{"enabled-no-paths", ServerConfig{TLSEnabled: true}, false},
		{"enabled-cert-only", ServerConfig{TLSEnabled: true, TLSCertPath: "c"}, false},
		{"enabled-key-only", ServerConfig{TLSEnabled: true, TLSKeyPath: "k"}, false},
		{"paths-but-disabled", ServerConfig{TLSCertPath: "c", TLSKeyPath: "k"}, false},
		{"ready", ServerConfig{TLSEnabled: true, TLSCertPath: "c", TLSKeyPath: "k"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.c.TLSReady(); got != tc.wantTLS {
				t.Errorf("TLSReady() = %v, want %v", got, tc.wantTLS)
			}
		})
	}
}

func TestResidencyConfig_Enabled(t *testing.T) {
	if (ResidencyConfig{}).Enabled() {
		t.Error("empty ResidencyConfig should be disabled")
	}
	if !(ResidencyConfig{ServiceRegion: "ksa-central"}).Enabled() {
		t.Error("ResidencyConfig with ServiceRegion should be enabled")
	}
}
