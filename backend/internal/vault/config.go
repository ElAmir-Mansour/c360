package vault

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// Auth method identifiers accepted by Config.AuthMethod.
const (
	AuthMethodToken   = "token"
	AuthMethodAppRole = "approle"
)

// Defaults.
const (
	defaultTransitPath = "transit/"
	defaultTimeout     = 5 * time.Second
)

// Config is the env-driven configuration for the Vault client.
type Config struct {
	// Addr is the base URL of the Vault HTTP API, e.g. "http://localhost:8200".
	Addr string
	// AuthMethod is "token" (dev) or "approle" (prod).
	AuthMethod string
	// Token is the static Vault token; only honored when AuthMethod == "token".
	Token string
	// AppRoleRoleID is the role_id for the approle login; required when
	// AuthMethod == "approle".
	AppRoleRoleID string
	// AppRoleSecretID is the secret_id for the approle login; required when
	// AuthMethod == "approle".
	AppRoleSecretID string
	// TransitPath is the mount path of the Transit secrets engine. Defaults
	// to "transit/" if empty. Always ends with a trailing slash internally.
	TransitPath string
	// Namespace is the Vault namespace header value. Empty in dev.
	Namespace string
	// TLSCACert is the filesystem path to a CA bundle. Empty in dev.
	TLSCACert string
	// Timeout is the per-call context timeout. Defaults to 5s.
	Timeout time.Duration
	// Environment lets the loader enforce prod-only constraints; populated
	// from SIEM_ENV.
	Environment string
}

// ConfigFromEnv builds a Config from the SIEM_VAULT_* environment variables
// and rejects insecure combinations (token auth in prod).
//
// Env vars consumed:
//
//   - SIEM_VAULT_ADDR              (required, default http://localhost:8200)
//   - SIEM_VAULT_AUTH_METHOD       ("token" or "approle"; default "token")
//   - SIEM_VAULT_TOKEN             (token auth)
//   - SIEM_VAULT_APPROLE_ROLE_ID   (approle auth)
//   - SIEM_VAULT_APPROLE_SECRET_ID (approle auth)
//   - SIEM_VAULT_TRANSIT_PATH      (default "transit/")
//   - SIEM_VAULT_NAMESPACE
//   - SIEM_VAULT_TLS_CA_CERT
//   - SIEM_VAULT_TIMEOUT           (Go duration, default "5s")
//   - SIEM_ENV                     ("dev" or "prod"; "prod" rejects token auth)
func ConfigFromEnv() (Config, error) {
	cfg := Config{
		Addr:            strings.TrimSpace(envOr("SIEM_VAULT_ADDR", "http://localhost:8200")),
		AuthMethod:      strings.ToLower(strings.TrimSpace(envOr("SIEM_VAULT_AUTH_METHOD", AuthMethodToken))),
		Token:           os.Getenv("SIEM_VAULT_TOKEN"),
		AppRoleRoleID:   os.Getenv("SIEM_VAULT_APPROLE_ROLE_ID"),
		AppRoleSecretID: os.Getenv("SIEM_VAULT_APPROLE_SECRET_ID"),
		TransitPath:     strings.TrimSpace(envOr("SIEM_VAULT_TRANSIT_PATH", defaultTransitPath)),
		Namespace:       strings.TrimSpace(os.Getenv("SIEM_VAULT_NAMESPACE")),
		TLSCACert:       strings.TrimSpace(os.Getenv("SIEM_VAULT_TLS_CA_CERT")),
		Environment:     strings.ToLower(strings.TrimSpace(os.Getenv("SIEM_ENV"))),
	}

	if raw := strings.TrimSpace(os.Getenv("SIEM_VAULT_TIMEOUT")); raw != "" {
		d, err := time.ParseDuration(raw)
		if err != nil {
			return Config{}, fmt.Errorf("vault: SIEM_VAULT_TIMEOUT invalid: %w", err)
		}
		cfg.Timeout = d
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg.WithDefaults(), nil
}

// WithDefaults returns a copy with zero-valued fields filled in.
func (c Config) WithDefaults() Config {
	if c.TransitPath == "" {
		c.TransitPath = defaultTransitPath
	}
	if !strings.HasSuffix(c.TransitPath, "/") {
		c.TransitPath += "/"
	}
	if c.Timeout <= 0 {
		c.Timeout = defaultTimeout
	}
	if c.AuthMethod == "" {
		c.AuthMethod = AuthMethodToken
	}
	return c
}

// Validate enforces required-field and security invariants. It does NOT
// fill defaults — call WithDefaults for that.
func (c Config) Validate() error {
	if c.Addr == "" {
		return fmt.Errorf("vault: addr is required")
	}
	switch c.AuthMethod {
	case AuthMethodToken, "":
		if c.Environment == "prod" {
			return fmt.Errorf("vault: token auth is not permitted in SIEM_ENV=prod")
		}
		if c.Token == "" {
			return fmt.Errorf("vault: token auth requires SIEM_VAULT_TOKEN")
		}
	case AuthMethodAppRole:
		if c.AppRoleRoleID == "" || c.AppRoleSecretID == "" {
			return fmt.Errorf("vault: approle auth requires SIEM_VAULT_APPROLE_ROLE_ID and SIEM_VAULT_APPROLE_SECRET_ID")
		}
	default:
		return fmt.Errorf("vault: unsupported auth method %q (want %q or %q)", c.AuthMethod, AuthMethodToken, AuthMethodAppRole)
	}
	return nil
}

func envOr(name, fallback string) string {
	if v, ok := os.LookupEnv(name); ok && v != "" {
		return v
	}
	return fallback
}
