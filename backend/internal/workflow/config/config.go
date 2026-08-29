package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds workflow-engine specific configuration.
type Config struct {
	// HTTPPort is the port the workflow service listens on.
	HTTPPort int

	// ServiceTaskTimeoutSec is the maximum duration (in seconds) a service task
	// HTTP call may take before being cancelled.
	ServiceTaskTimeoutSec int

	// ServiceTaskMaxRetries is the maximum number of retry attempts for a
	// failed service task before the step is marked as failed.
	ServiceTaskMaxRetries int

	// TimerPollIntervalSec is the interval (in seconds) at which the engine
	// polls for timer steps that are due to fire.
	TimerPollIntervalSec int

	// SLACheckIntervalSec is the interval (in seconds) at which the engine
	// checks for SLA breaches on human tasks.
	SLACheckIntervalSec int

	// InstanceRecoveryBatch is the maximum number of instances to recover
	// (re-process) in a single recovery cycle after an engine restart.
	InstanceRecoveryBatch int

	// ServiceURLs maps service-task service names to their base URLs.
	// For example: {"notification": "http://notification-svc:8080", "billing": "http://billing-svc:8080"}
	ServiceURLs map[string]string

	// PayloadEncryptionMode selects field-level payload encryption at rest for the
	// sensitive workflow JSONB (variables / step_outputs / form_data): "off" (the
	// DEFAULT — legacy plaintext, byte-for-byte unchanged), or "software" (AES-256-GCM
	// using a base64-encoded 32-byte key supplied in PayloadEncryptionKeyB64). It
	// reuses the platform field crypto (internal/lex/crypto); it does NOT invent a
	// cipher. Sourced from WF_PAYLOAD_ENCRYPTION_MODE.
	PayloadEncryptionMode string

	// PayloadEncryptionKeyB64 is the base64-encoded 32-byte AES-256 data key used
	// when PayloadEncryptionMode=software. It is a KMS-ref / secret material read
	// from the environment (WF_PAYLOAD_ENCRYPTION_KEY) — NEVER inlined in code and
	// NEVER logged. Empty when encryption is off.
	PayloadEncryptionKeyB64 string

	// PayloadResidencyPin is an OPTIONAL data-residency label (e.g. "ksa") stamped
	// into each encryption envelope's metadata for sovereignty audit. Sourced from
	// WF_PAYLOAD_RESIDENCY. Empty to omit.
	PayloadResidencyPin string

	// FederatedReadDBURLs is an OPTIONAL, comma-separated list of read-only
	// Postgres DSNs (suite databases) that the admin instance list/detail READ
	// endpoints federate over, so the shared console can surface workflow
	// instances a suite's embedded engine still stores in its own database.
	// Sourced from WF_FEDERATED_DB_URLS. Empty = no federation (default). This is
	// a temporary read-model bridge until suites are consolidated onto the shared
	// store; it NEVER touches the write/execution paths.
	FederatedReadDBURLs []string

	// Computed durations derived from the integer second fields.
	ServiceTaskTimeout time.Duration
	TimerPollInterval  time.Duration
	SLACheckInterval   time.Duration
}

// DefaultConfig returns a Config with sensible production defaults.
func DefaultConfig() *Config {
	return &Config{
		HTTPPort:              8083,
		ServiceTaskTimeoutSec: 60,
		ServiceTaskMaxRetries: 3,
		TimerPollIntervalSec:  5,
		SLACheckIntervalSec:   60,
		InstanceRecoveryBatch: 100,
		ServiceURLs:           make(map[string]string),
		PayloadEncryptionMode: "off",
	}
}

// LoadFromEnv overlays environment variable values onto the default config.
// All environment variables use the WF_ prefix.
func LoadFromEnv() *Config {
	cfg := DefaultConfig()

	if v := os.Getenv("WF_HTTP_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.HTTPPort = n
		}
	}
	if v := os.Getenv("WF_SERVICE_TASK_TIMEOUT_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.ServiceTaskTimeoutSec = n
		}
	}
	if v := os.Getenv("WF_SERVICE_TASK_MAX_RETRIES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			cfg.ServiceTaskMaxRetries = n
		}
	}
	if v := os.Getenv("WF_TIMER_POLL_INTERVAL_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.TimerPollIntervalSec = n
		}
	}
	if v := os.Getenv("WF_SLA_CHECK_INTERVAL_SEC"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.SLACheckIntervalSec = n
		}
	}
	if v := os.Getenv("WF_INSTANCE_RECOVERY_BATCH"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.InstanceRecoveryBatch = n
		}
	}

	// Parse service URLs from comma-separated key=value pairs.
	// Example: WF_SERVICE_URLS=notification=http://notification:8080,billing=http://billing:8080
	if v := os.Getenv("WF_SERVICE_URLS"); v != "" {
		cfg.ServiceURLs = parseServiceURLs(v)
	}

	if v := strings.TrimSpace(os.Getenv("WF_PAYLOAD_ENCRYPTION_MODE")); v != "" {
		cfg.PayloadEncryptionMode = strings.ToLower(v)
	}
	if v := os.Getenv("WF_PAYLOAD_ENCRYPTION_KEY"); v != "" {
		cfg.PayloadEncryptionKeyB64 = strings.TrimSpace(v)
	}
	if v := strings.TrimSpace(os.Getenv("WF_PAYLOAD_RESIDENCY")); v != "" {
		cfg.PayloadResidencyPin = v
	}
	// WF_FEDERATED_DB_URLS: comma-separated read-only suite DSNs for the admin
	// read-model bridge (see Config.FederatedReadDBURLs).
	if v := strings.TrimSpace(os.Getenv("WF_FEDERATED_DB_URLS")); v != "" {
		for _, dsn := range strings.Split(v, ",") {
			if dsn = strings.TrimSpace(dsn); dsn != "" {
				cfg.FederatedReadDBURLs = append(cfg.FederatedReadDBURLs, dsn)
			}
		}
	}

	cfg.computeDurations()
	return cfg
}

// Validate checks that configuration values are within acceptable bounds.
func (c *Config) Validate() error {
	if c.HTTPPort < 1 || c.HTTPPort > 65535 {
		return fmt.Errorf("http_port must be between 1 and 65535, got %d", c.HTTPPort)
	}
	if c.ServiceTaskTimeoutSec < 1 || c.ServiceTaskTimeoutSec > 300 {
		return fmt.Errorf("service_task_timeout_sec must be between 1 and 300, got %d", c.ServiceTaskTimeoutSec)
	}
	if c.ServiceTaskMaxRetries < 0 || c.ServiceTaskMaxRetries > 10 {
		return fmt.Errorf("service_task_max_retries must be between 0 and 10, got %d", c.ServiceTaskMaxRetries)
	}
	if c.TimerPollIntervalSec < 1 || c.TimerPollIntervalSec > 60 {
		return fmt.Errorf("timer_poll_interval_sec must be between 1 and 60, got %d", c.TimerPollIntervalSec)
	}
	if c.SLACheckIntervalSec < 10 || c.SLACheckIntervalSec > 600 {
		return fmt.Errorf("sla_check_interval_sec must be between 10 and 600, got %d", c.SLACheckIntervalSec)
	}
	if c.InstanceRecoveryBatch < 1 || c.InstanceRecoveryBatch > 1000 {
		return fmt.Errorf("instance_recovery_batch must be between 1 and 1000, got %d", c.InstanceRecoveryBatch)
	}

	switch c.PayloadEncryptionMode {
	case "", "off":
		c.PayloadEncryptionMode = "off"
	case "software":
		// Fail closed: an operator who asked for encryption must supply the key,
		// rather than silently falling back to plaintext.
		if strings.TrimSpace(c.PayloadEncryptionKeyB64) == "" {
			return fmt.Errorf("WF_PAYLOAD_ENCRYPTION_KEY is required when WF_PAYLOAD_ENCRYPTION_MODE=software")
		}
	default:
		return fmt.Errorf("payload_encryption_mode must be off or software, got %q", c.PayloadEncryptionMode)
	}

	c.computeDurations()
	return nil
}

// PayloadEncryptionEnabled reports whether field-level payload encryption at rest
// is active. When false the repository stores JSONB in plaintext exactly as
// before.
func (c *Config) PayloadEncryptionEnabled() bool {
	return c.PayloadEncryptionMode == "software"
}

// computeDurations derives time.Duration fields from the integer second values.
func (c *Config) computeDurations() {
	c.ServiceTaskTimeout = time.Duration(c.ServiceTaskTimeoutSec) * time.Second
	c.TimerPollInterval = time.Duration(c.TimerPollIntervalSec) * time.Second
	c.SLACheckInterval = time.Duration(c.SLACheckIntervalSec) * time.Second
}

// parseServiceURLs parses a comma-separated list of name=url pairs.
func parseServiceURLs(raw string) map[string]string {
	result := make(map[string]string)
	pairs := strings.Split(raw, ",")
	for _, pair := range pairs {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		parts := strings.SplitN(pair, "=", 2)
		if len(parts) == 2 {
			name := strings.TrimSpace(parts[0])
			url := strings.TrimSpace(parts[1])
			if name != "" && url != "" {
				result[name] = url
			}
		}
	}
	return result
}
