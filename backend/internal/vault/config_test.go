package vault

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestConfigValidate(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		cfg     Config
		wantErr string
	}{
		{
			name:    "missing addr",
			cfg:     Config{AuthMethod: AuthMethodToken, Token: "x"},
			wantErr: "addr is required",
		},
		{
			name:    "token auth without token",
			cfg:     Config{Addr: "http://v", AuthMethod: AuthMethodToken},
			wantErr: "SIEM_VAULT_TOKEN",
		},
		{
			name:    "token auth in prod is rejected",
			cfg:     Config{Addr: "http://v", AuthMethod: AuthMethodToken, Token: "x", Environment: "prod"},
			wantErr: "not permitted in SIEM_ENV=prod",
		},
		{
			name:    "approle without role_id",
			cfg:     Config{Addr: "http://v", AuthMethod: AuthMethodAppRole, AppRoleSecretID: "s"},
			wantErr: "APPROLE_ROLE_ID",
		},
		{
			name:    "approle without secret_id",
			cfg:     Config{Addr: "http://v", AuthMethod: AuthMethodAppRole, AppRoleRoleID: "r"},
			wantErr: "APPROLE_ROLE_ID",
		},
		{
			name:    "unknown method",
			cfg:     Config{Addr: "http://v", AuthMethod: "kubernetes"},
			wantErr: "unsupported auth method",
		},
		{
			name: "token ok in dev",
			cfg:  Config{Addr: "http://v", AuthMethod: AuthMethodToken, Token: "x", Environment: "dev"},
		},
		{
			name: "approle ok in prod",
			cfg:  Config{Addr: "http://v", AuthMethod: AuthMethodAppRole, AppRoleRoleID: "r", AppRoleSecretID: "s", Environment: "prod"},
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			err := tc.cfg.Validate()
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %q", tc.wantErr, err.Error())
			}
		})
	}
}

func TestConfigWithDefaults(t *testing.T) {
	t.Parallel()
	c := Config{Addr: "http://v"}.WithDefaults()
	if c.TransitPath != "transit/" {
		t.Errorf("expected TransitPath default transit/, got %q", c.TransitPath)
	}
	if c.Timeout != defaultTimeout {
		t.Errorf("expected Timeout default %v, got %v", defaultTimeout, c.Timeout)
	}
	if c.AuthMethod != AuthMethodToken {
		t.Errorf("expected default auth method %q, got %q", AuthMethodToken, c.AuthMethod)
	}
	// Trailing slash injection.
	c = Config{Addr: "http://v", TransitPath: "custom"}.WithDefaults()
	if c.TransitPath != "custom/" {
		t.Errorf("expected trailing slash, got %q", c.TransitPath)
	}
}

func TestConfigFromEnv(t *testing.T) {
	// Sequential — mutates env.
	clearEnv := func() {
		envs := []string{
			"SIEM_VAULT_ADDR", "SIEM_VAULT_AUTH_METHOD", "SIEM_VAULT_TOKEN",
			"SIEM_VAULT_APPROLE_ROLE_ID", "SIEM_VAULT_APPROLE_SECRET_ID",
			"SIEM_VAULT_TRANSIT_PATH", "SIEM_VAULT_NAMESPACE",
			"SIEM_VAULT_TLS_CA_CERT", "SIEM_VAULT_TIMEOUT", "SIEM_ENV",
		}
		for _, e := range envs {
			t.Setenv(e, "")
		}
	}

	t.Run("dev token defaults", func(t *testing.T) {
		clearEnv()
		t.Setenv("SIEM_VAULT_TOKEN", "dev-token")
		cfg, err := ConfigFromEnv()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cfg.Addr != "http://localhost:8200" {
			t.Errorf("unexpected addr: %q", cfg.Addr)
		}
		if cfg.AuthMethod != AuthMethodToken {
			t.Errorf("unexpected auth method: %q", cfg.AuthMethod)
		}
		if cfg.Timeout != defaultTimeout {
			t.Errorf("unexpected timeout: %v", cfg.Timeout)
		}
	})

	t.Run("prod token rejected", func(t *testing.T) {
		clearEnv()
		t.Setenv("SIEM_ENV", "prod")
		t.Setenv("SIEM_VAULT_TOKEN", "any")
		_, err := ConfigFromEnv()
		if err == nil || !strings.Contains(err.Error(), "prod") {
			t.Fatalf("expected prod rejection, got %v", err)
		}
	})

	t.Run("approle prod ok", func(t *testing.T) {
		clearEnv()
		t.Setenv("SIEM_ENV", "prod")
		t.Setenv("SIEM_VAULT_AUTH_METHOD", "approle")
		t.Setenv("SIEM_VAULT_APPROLE_ROLE_ID", "rid")
		t.Setenv("SIEM_VAULT_APPROLE_SECRET_ID", "sid")
		t.Setenv("SIEM_VAULT_TIMEOUT", "10s")
		cfg, err := ConfigFromEnv()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cfg.Timeout != 10*time.Second {
			t.Errorf("unexpected timeout: %v", cfg.Timeout)
		}
	})

	t.Run("bad duration", func(t *testing.T) {
		clearEnv()
		t.Setenv("SIEM_VAULT_TOKEN", "x")
		t.Setenv("SIEM_VAULT_TIMEOUT", "lol")
		_, err := ConfigFromEnv()
		if err == nil {
			t.Fatal("expected duration parse error")
		}
	})
}

func TestParseEnvelopeVersion(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in      string
		want    int
		wantErr bool
	}{
		{"vault:v1:abc", 1, false},
		{"vault:v42:abc==", 42, false},
		{"vault:v0:abc", 0, true},
		{"vault:vN:abc", 0, true},
		{"vault::abc", 0, true},
		{"notvault:v1:abc", 0, true},
		{"", 0, true},
	}
	for _, tc := range tests {
		got, err := parseEnvelopeVersion(tc.in)
		if tc.wantErr {
			if err == nil {
				t.Errorf("%q: expected error", tc.in)
			} else if !errors.Is(err, ErrEnvelopeInvalid) {
				t.Errorf("%q: error not ErrEnvelopeInvalid: %v", tc.in, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: unexpected error %v", tc.in, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%q: want %d, got %d", tc.in, tc.want, got)
		}
	}
}
