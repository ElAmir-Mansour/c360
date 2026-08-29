package main

import (
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/agent"
)

// agentConfig is the self-contained clario-dr-agent configuration. The agent
// runs on customer infrastructure as a static, air-gap-friendly binary, so it
// has NO dependency on the platform's service config (no DB/Kafka/Vault): every
// input it needs is in this file or its environment overrides.
//
// Loaded from a YAML file (--config) and overlaid with environment variables so
// secrets (enrollment token, per-stream DEKs) can be injected without baking
// them into a file on disk.
type agentConfig struct {
	// ControlPlaneURL is the base URL of the DR control-plane HTTP API where the
	// agent enrolls (POST /api/v1/dr/agents/enroll).
	ControlPlaneURL string `yaml:"control_plane_url"`
	// IngestURL is the base URL of the control-plane mTLS ingest listener where
	// the agent ships frames.
	IngestURL string `yaml:"ingest_url"`

	// CacheDir is the local directory holding the enrolled cert/key/CA and the
	// resumable checkpoint cache.
	CacheDir string `yaml:"cache_dir"`

	// AgentID is this agent's dr_agent.id (the CSR common name / enrollment
	// subject). The control plane authoritatively binds the issued cert to the
	// enrollment token's subject.
	AgentID string `yaml:"agent_id"`
	// TenantID / SiteID are optional assertions sent at enrollment.
	TenantID string `yaml:"tenant_id"`
	SiteID   string `yaml:"site_id"`

	// EnrollmentToken is the single-use enrollment JWT. Prefer the
	// CLARIO_DR_AGENT_ENROLLMENT_TOKEN env var over the file for secrecy.
	EnrollmentToken string `yaml:"enrollment_token"`
	// RenewalTokenFile is read at renewal time for a fresh single-use rotation
	// token. Operators can atomically replace this file without restarting.
	RenewalTokenFile string `yaml:"renewal_token_file"`

	// EnrollCABundlePEM, when set, anchors trust in the control-plane HTTPS
	// endpoint for the enrollment call (before the agent has the issued CA). May
	// be inline PEM or a "@/path/to/ca.pem" file reference.
	EnrollCABundlePEM string `yaml:"enroll_ca_bundle_pem"`

	// ThrottleBytesPerSec optionally byte-rate-limits every stream's send path.
	ThrottleBytesPerSec float64 `yaml:"throttle_bytes_per_sec"`
	// ReconnectBackoff / MaxReconnectBackoff tune link-drop reconnect timing.
	ReconnectBackoff    time.Duration `yaml:"reconnect_backoff"`
	MaxReconnectBackoff time.Duration `yaml:"max_reconnect_backoff"`
	// CertRenewBefore controls when a live agent attempts certificate rotation.
	CertRenewBefore time.Duration `yaml:"cert_renew_before"`
	// CertRenewCheckInterval bounds how often the renewal scheduler wakes before
	// the renewal window.
	CertRenewCheckInterval time.Duration `yaml:"cert_renew_check_interval"`
	// CertRenewRetryBackoff is the delay after a failed renewal attempt.
	CertRenewRetryBackoff time.Duration `yaml:"cert_renew_retry_backoff"`

	// MetricsAddr, when set, serves Prometheus metrics on this address (e.g.
	// :9098) so the agent's ship throughput/resume counters are scrapeable.
	MetricsAddr string `yaml:"metrics_addr"`

	// InsecureSkipVerify disables ingest server cert verification. ONLY for local
	// loopback testing; never set in production.
	InsecureSkipVerify bool `yaml:"insecure_skip_verify"`
	// ServerName overrides the ingest TLS verification name (advanced/testing).
	ServerName string `yaml:"server_name"`

	// Sources are the local sources to capture and ship.
	Sources []sourceConfig `yaml:"sources"`
}

// sourceConfig is one capture source in the config file.
type sourceConfig struct {
	StreamID string `yaml:"stream_id"`
	Kind     string `yaml:"kind"` // "file" | "postgres"
	Path     string `yaml:"path"`
	DSN      string `yaml:"dsn"`

	// DEKHex is the 32-byte AES-256 per-stream DEK, hex-encoded (64 hex chars).
	// It MUST match the control plane's per-stream DEK so frames decrypt. Prefer
	// the env override CLARIO_DR_AGENT_DEK_<STREAMID> for secrecy.
	DEKHex string `yaml:"dek_hex"`

	// Postgres table config (SourcePostgres only).
	Schema     string   `yaml:"schema"`
	Table      string   `yaml:"table"`
	Columns    []string `yaml:"columns"`
	PrimaryKey []string `yaml:"primary_key"`
	Watermark  string   `yaml:"watermark"`

	// PostgreSQL capture mode. "watermark" keeps the compatibility polling
	// driver; "logical" uses PostgreSQL logical replication via pgoutput or
	// wal2json. Empty defaults to logical when slot/plugin fields are set,
	// otherwise watermark.
	Mode         string   `yaml:"mode"`
	Plugin       string   `yaml:"plugin"`
	SlotName     string   `yaml:"slot_name"`
	Publications []string `yaml:"publications"`
	PluginArgs   []string `yaml:"plugin_args"`
}

// loadConfig reads the YAML config at path and overlays environment variables.
func loadConfig(path string) (*agentConfig, error) {
	cfg := &agentConfig{
		CacheDir:               "/var/lib/clario-dr-agent",
		ReconnectBackoff:       time.Second,
		MaxReconnectBackoff:    30 * time.Second,
		CertRenewBefore:        24 * time.Hour,
		CertRenewCheckInterval: time.Hour,
		CertRenewRetryBackoff:  5 * time.Minute,
	}
	if path != "" {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("read config %s: %w", path, err)
		}
		if err := yaml.Unmarshal(raw, cfg); err != nil {
			return nil, fmt.Errorf("parse config %s: %w", path, err)
		}
	}
	if err := cfg.applyEnvOverrides(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// applyEnvOverrides overlays environment variables so secrets and deployment
// specifics can be injected without editing the file.
func (c *agentConfig) applyEnvOverrides() error {
	if v := os.Getenv("CLARIO_DR_AGENT_CONTROL_PLANE_URL"); v != "" {
		c.ControlPlaneURL = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_INGEST_URL"); v != "" {
		c.IngestURL = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_CACHE_DIR"); v != "" {
		c.CacheDir = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_AGENT_ID"); v != "" {
		c.AgentID = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_TENANT_ID"); v != "" {
		c.TenantID = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_SITE_ID"); v != "" {
		c.SiteID = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_ENROLLMENT_TOKEN"); v != "" {
		c.EnrollmentToken = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_RENEWAL_TOKEN_FILE"); v != "" {
		c.RenewalTokenFile = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_ENROLL_CA_BUNDLE_PEM"); v != "" {
		c.EnrollCABundlePEM = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_METRICS_ADDR"); v != "" {
		c.MetricsAddr = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_SERVER_NAME"); v != "" {
		c.ServerName = v
	}
	if v := os.Getenv("CLARIO_DR_AGENT_RECONNECT_BACKOFF"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("parse CLARIO_DR_AGENT_RECONNECT_BACKOFF: %w", err)
		}
		c.ReconnectBackoff = d
	}
	if v := os.Getenv("CLARIO_DR_AGENT_MAX_RECONNECT_BACKOFF"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("parse CLARIO_DR_AGENT_MAX_RECONNECT_BACKOFF: %w", err)
		}
		c.MaxReconnectBackoff = d
	}
	if v := os.Getenv("CLARIO_DR_AGENT_CERT_RENEW_BEFORE"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("parse CLARIO_DR_AGENT_CERT_RENEW_BEFORE: %w", err)
		}
		c.CertRenewBefore = d
	}
	if v := os.Getenv("CLARIO_DR_AGENT_CERT_RENEW_CHECK_INTERVAL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("parse CLARIO_DR_AGENT_CERT_RENEW_CHECK_INTERVAL: %w", err)
		}
		c.CertRenewCheckInterval = d
	}
	if v := os.Getenv("CLARIO_DR_AGENT_CERT_RENEW_RETRY_BACKOFF"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return fmt.Errorf("parse CLARIO_DR_AGENT_CERT_RENEW_RETRY_BACKOFF: %w", err)
		}
		c.CertRenewRetryBackoff = d
	}
	if key, v := firstEnv("CLARIO_DR_AGENT_THROTTLE_BYTES_PER_SEC", "DR_THROTTLE_BYTES_PER_SEC"); v != "" {
		n, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return fmt.Errorf("parse %s: %w", key, err)
		}
		c.ThrottleBytesPerSec = n
	}
	if v := os.Getenv("CLARIO_DR_AGENT_INSECURE_SKIP_VERIFY"); v != "" {
		b, err := strconv.ParseBool(v)
		if err != nil {
			return fmt.Errorf("parse CLARIO_DR_AGENT_INSECURE_SKIP_VERIFY: %w", err)
		}
		c.InsecureSkipVerify = b
	}
	// Per-stream DEK override: CLARIO_DR_AGENT_DEK_<STREAMID> (stream id sanitized
	// to env-safe upper-snake: non-alnum -> '_').
	for i := range c.Sources {
		suffix := envSanitize(c.Sources[i].StreamID)
		dekKey := "CLARIO_DR_AGENT_DEK_" + suffix
		if v, err := envOrFile(dekKey, dekKey+"_FILE"); err != nil {
			return err
		} else if v != "" {
			c.Sources[i].DEKHex = v
		}
		dsnKey := "CLARIO_DR_AGENT_DSN_" + suffix
		if v, err := envOrFile(dsnKey, dsnKey+"_FILE"); err != nil {
			return err
		} else if v != "" {
			c.Sources[i].DSN = v
		}
	}
	return nil
}

// resolveCABundle returns the enrollment CA bundle PEM bytes, reading a
// "@/path" reference from disk when present.
func (c *agentConfig) resolveCABundle() ([]byte, error) {
	v := strings.TrimSpace(c.EnrollCABundlePEM)
	if v == "" {
		return nil, nil
	}
	if strings.HasPrefix(v, "@") {
		b, err := os.ReadFile(strings.TrimPrefix(v, "@"))
		if err != nil {
			return nil, fmt.Errorf("read enroll CA bundle: %w", err)
		}
		return b, nil
	}
	return []byte(v), nil
}

// validate checks the config is internally consistent before the agent starts.
func (c *agentConfig) validate() error {
	if c.IngestURL == "" {
		return errors.New("ingest_url is required")
	}
	if err := validateAgentURL("ingest_url", c.IngestURL, c.InsecureSkipVerify); err != nil {
		return err
	}
	if c.ControlPlaneURL != "" {
		if err := validateAgentURL("control_plane_url", c.ControlPlaneURL, true); err != nil {
			return err
		}
	}
	if c.InsecureSkipVerify && !isLoopbackURL(c.IngestURL) {
		return errors.New("insecure_skip_verify is only allowed for loopback ingest_url")
	}
	if c.CacheDir == "" {
		return errors.New("cache_dir is required")
	}
	if c.ThrottleBytesPerSec < 0 {
		return errors.New("throttle_bytes_per_sec must be non-negative")
	}
	if c.ReconnectBackoff <= 0 {
		return errors.New("reconnect_backoff must be positive")
	}
	if c.MaxReconnectBackoff <= 0 {
		return errors.New("max_reconnect_backoff must be positive")
	}
	if c.MaxReconnectBackoff < c.ReconnectBackoff {
		return errors.New("max_reconnect_backoff must be >= reconnect_backoff")
	}
	if c.CertRenewBefore <= 0 {
		return errors.New("cert_renew_before must be positive")
	}
	if c.CertRenewCheckInterval <= 0 {
		return errors.New("cert_renew_check_interval must be positive")
	}
	if c.CertRenewRetryBackoff <= 0 {
		return errors.New("cert_renew_retry_backoff must be positive")
	}
	if len(c.Sources) == 0 {
		return errors.New("at least one source is required")
	}
	seen := map[string]struct{}{}
	for i, s := range c.Sources {
		if s.StreamID == "" {
			return fmt.Errorf("source %d is missing stream_id", i)
		}
		if _, dup := seen[s.StreamID]; dup {
			return fmt.Errorf("duplicate source stream_id %q", s.StreamID)
		}
		seen[s.StreamID] = struct{}{}
		switch agent.SourceKind(s.Kind) {
		case agent.SourceFile:
			if s.Path == "" {
				return fmt.Errorf("file source %q requires a path", s.StreamID)
			}
		case agent.SourcePostgres:
			if s.DSN == "" {
				return fmt.Errorf("postgres source %q requires a dsn", s.StreamID)
			}
			if s.Table == "" {
				return fmt.Errorf("postgres source %q requires a table", s.StreamID)
			}
			if len(s.Columns) == 0 {
				return fmt.Errorf("postgres source %q requires columns", s.StreamID)
			}
			if len(s.PrimaryKey) == 0 {
				return fmt.Errorf("postgres source %q requires primary_key", s.StreamID)
			}
			switch mode := s.postgresMode(); mode {
			case agent.PostgresModeWatermark:
				if s.Watermark == "" {
					return fmt.Errorf("postgres source %q watermark mode requires a watermark", s.StreamID)
				}
			case agent.PostgresModeLogical:
				if s.SlotName == "" {
					return fmt.Errorf("postgres source %q logical mode requires slot_name", s.StreamID)
				}
				switch s.logicalPlugin() {
				case "pgoutput":
					if len(s.Publications) == 0 && len(s.PluginArgs) == 0 {
						return fmt.Errorf("postgres source %q pgoutput mode requires publications or plugin_args", s.StreamID)
					}
				case "wal2json":
				default:
					return fmt.Errorf("postgres source %q has unsupported logical plugin %q", s.StreamID, s.Plugin)
				}
			default:
				return fmt.Errorf("postgres source %q has unsupported mode %q", s.StreamID, s.Mode)
			}
		default:
			return fmt.Errorf("source %q has unsupported kind %q", s.StreamID, s.Kind)
		}
		if _, err := s.dek(); err != nil {
			return fmt.Errorf("source %q: %w", s.StreamID, err)
		}
	}
	return nil
}

// dek decodes the source's hex DEK and validates its length.
func (s sourceConfig) dek() ([]byte, error) {
	if s.DEKHex == "" {
		return nil, errors.New("dek_hex is required (set via config or CLARIO_DR_AGENT_DEK_<STREAMID>)")
	}
	dek, err := hex.DecodeString(strings.TrimSpace(s.DEKHex))
	if err != nil {
		return nil, fmt.Errorf("dek_hex is not valid hex: %w", err)
	}
	if len(dek) != core.AESKeySize256 {
		return nil, fmt.Errorf("dek must be %d bytes (%d hex chars), got %d", core.AESKeySize256, core.AESKeySize256*2, len(dek))
	}
	return dek, nil
}

// toSourceSpecs converts the config sources to runtime SourceSpecs.
func (c *agentConfig) toSourceSpecs() ([]agent.SourceSpec, error) {
	out := make([]agent.SourceSpec, 0, len(c.Sources))
	for _, s := range c.Sources {
		dek, err := s.dek()
		if err != nil {
			return nil, fmt.Errorf("source %q: %w", s.StreamID, err)
		}
		out = append(out, agent.SourceSpec{
			StreamID:     s.StreamID,
			Kind:         agent.SourceKind(s.Kind),
			Path:         s.Path,
			DSN:          s.DSN,
			PostgresMode: s.postgresMode(),
			PGTable: agent.PGTableSpec{
				Schema:     s.Schema,
				Table:      s.Table,
				Columns:    s.Columns,
				PrimaryKey: s.PrimaryKey,
				Watermark:  s.Watermark,
			},
			PGLogical: agent.PGLogicalSpec{
				SlotName:     s.SlotName,
				Plugin:       s.logicalPlugin(),
				Publications: append([]string(nil), s.Publications...),
				PluginArgs:   append([]string(nil), s.PluginArgs...),
			},
			DEK: dek,
		})
	}
	return out, nil
}

func (s sourceConfig) postgresMode() agent.PostgresMode {
	mode := strings.ToLower(strings.TrimSpace(s.Mode))
	if mode != "" {
		return agent.PostgresMode(mode)
	}
	if s.SlotName != "" || s.Plugin != "" || len(s.Publications) > 0 || len(s.PluginArgs) > 0 {
		return agent.PostgresModeLogical
	}
	return agent.PostgresModeWatermark
}

func (s sourceConfig) logicalPlugin() string {
	plugin := strings.ToLower(strings.TrimSpace(s.Plugin))
	if plugin == "" {
		return "pgoutput"
	}
	return plugin
}

func validateAgentURL(name, raw string, allowLoopbackHTTP bool) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%s is not a valid URL: %w", name, err)
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return fmt.Errorf("%s must use https", name)
	}
	if u.Hostname() == "" {
		return fmt.Errorf("%s must include a host", name)
	}
	if u.Scheme == "http" && !(allowLoopbackHTTP && isLoopbackHost(u.Hostname())) {
		return fmt.Errorf("%s must use https outside loopback development", name)
	}
	return nil
}

func isLoopbackURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && isLoopbackHost(u.Hostname())
}

func isLoopbackHost(host string) bool {
	h := strings.Trim(strings.ToLower(host), "[]")
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func envSanitize(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
			out = append(out, r-('a'-'A'))
		case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	return string(out)
}

func firstEnv(names ...string) (string, string) {
	for _, name := range names {
		if v := os.Getenv(name); v != "" {
			return name, v
		}
	}
	return "", ""
}

func envOrFile(valueKey, fileKey string) (string, error) {
	if v := os.Getenv(valueKey); v != "" {
		return v, nil
	}
	path := strings.TrimSpace(os.Getenv(fileKey))
	if path == "" {
		return "", nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", fileKey, err)
	}
	return strings.TrimSpace(string(raw)), nil
}
