package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	appconfig "github.com/clario360/platform/internal/config"
)

type Config struct {
	HTTPPort                  int
	AdminPort                 int
	DBURL                     string
	DBMinConns                int
	DBMaxConns                int
	RedisAddr                 string
	RedisPassword             string
	RedisDB                   int
	KafkaBrokers              []string
	KafkaGroupID              string
	KafkaTopic                string
	JWTPublicKeyPath          string
	RateLimitPerMinute        int
	DashboardCacheTTL         time.Duration
	ExpiryMonitorInterval     time.Duration
	ComplianceMonitorInterval time.Duration
	RenewalReminderInterval   time.Duration
	// Phase 1 background-monitor intervals (LEX_*_INTERVAL pattern). SLAMonitor
	// sweeps due SLA clocks (ack-overdue / breach / escalation) and enqueues the
	// outbox; DeliveryAutoClose expires unanswered delivery confirmations.
	SLAMonitorInterval        time.Duration
	DeliveryAutoCloseInterval time.Duration
	// SupportExpiryInterval is the cadence for expiring due, still-active legal
	// support requests. The monitor performs a bounded atomic sweep per tenant.
	SupportExpiryInterval time.Duration
	// Phase 4: ProximityMonitor sweeps upcoming hearings and fires approaching-date
	// reminders (CAP-162) at the {7,3,1,0}-calendar-day horizons, deduped per
	// (hearing, horizon). Mirrors the other LEX_*_INTERVAL monitors.
	ProximityMonitorInterval time.Duration
	// Round 1 maturation: OutboxDispatchInterval drives the lex-outbox-dispatcher
	// ticker that drains the SLA-notification + obligation-reminder outbox tables
	// per tenant. The SLA monitor / reminder planner only ENQUEUE rows; this ticker
	// DELIVERS them. Dispatch is idempotent (status-precondition guards), so a short
	// interval is safe. LEX_OUTBOX_DISPATCH_INTERVAL pattern; default 60s.
	OutboxDispatchInterval time.Duration
	// IntegrationSyncInterval is the TICK cadence of the lex Integration Platform's
	// pull scheduler (IntegrationSyncMonitor). On each tick it fans out cross-tenant,
	// lists active Syncer-capable endpoints, and dispatches a delta sync for those
	// DUE per their per-endpoint sync_interval_minutes config (full on first sync).
	// This knob is the scheduler's wake cadence, NOT the per-endpoint pull cadence.
	// LEX_INTEGRATION_SYNC_INTERVAL pattern; default 5m.
	IntegrationSyncInterval time.Duration
	// IntegrationRotationInterval is the TICK cadence of the integration secret
	// ROTATION scheduler (IntegrationRotationMonitor, governance #14). On each tick it
	// fans out cross-tenant, evaluates each active endpoint's secret fields against its
	// rotate_every_days cadence (vs the recorded last_rotated stamps), emits rotation
	// reminders/expiry alerts, and auto-rotates overdue external-reference secrets when
	// the endpoint opted in. This knob is the scheduler's wake cadence, NOT the
	// per-endpoint rotation cadence. LEX_INTEGRATION_ROTATION_INTERVAL pattern;
	// default 6h (rotation is a slow-moving concern; a non-positive value also
	// defaults to 6h inside the monitor).
	IntegrationRotationInterval time.Duration
	SeedDemoData                bool
	SeedTenantID                string
	SeedSystemUserID            string
	OrgJurisdiction             string

	// LLM enrichment (safe by default: off). The deterministic analyzer is the
	// baseline; when enabled and a tenant is entitled via AI governance, the
	// governed LLM enricher augments clause/obligation extraction.
	LLMEnrichmentEnabled bool
	LLMMaxTokens         int
	LLMTimeout           time.Duration
	LLMMaxInputRunes     int
	// LLMInteractiveDraftingModel is a faster per-request model used only by
	// latency-sensitive drafting flows such as pleading generation. The shared
	// provider default remains the stronger model used by analysis and review.
	LLMInteractiveDraftingModel string

	SignatureProviderMode     string
	SignatureProviderEndpoint string
	SignatureProviderAPIKey   string
	SignatureProviderTimeout  time.Duration

	ObligationReminderProviderMode     string
	ObligationReminderProviderEndpoint string
	ObligationReminderProviderAPIKey   string
	ObligationReminderProviderTimeout  time.Duration

	// SLANotificationProvider mirrors the ObligationReminderProvider seam: the
	// deterministic dispatcher is the default (no wiring needed); "http" wires an
	// external provider for SLA ack-overdue / breach / escalation notifications.
	SLANotificationProviderMode     string
	SLANotificationProviderEndpoint string
	SLANotificationProviderAPIKey   string
	SLANotificationProviderTimeout  time.Duration

	// LexNotificationProvider (CAP-157) is the live email-dispatch seam for the
	// in-app notification service. The deterministic dispatcher is the default
	// (no wiring needed); "http" wires the production notification-service email
	// adapter (HTTPLexEmailDispatcher). When this is in http mode it ALSO drives
	// the SLA notification path at the SAME endpoint UNLESS a dedicated
	// LEX_SLA_NOTIFICATION_PROVIDER_* block is configured (that wins). Name is an
	// optional logical provider label (defaults to notification-service).
	LexNotificationProviderMode     string
	LexNotificationProviderEndpoint string
	LexNotificationProviderAPIKey   string
	LexNotificationProviderTimeout  time.Duration
	LexNotificationProviderName     string

	// LexNotificationSMTP* configures the self-contained SMTP email dispatcher
	// (SMTPLexEmailDispatcher), selected when LEX_LEX_NOTIFICATION_PROVIDER_MODE=smtp.
	// This is the demonstrable local delivery path: point HOST/PORT at a MailHog
	// container (localhost:1025, no auth) for a working demo, or at a real relay
	// (with USERNAME/PASSWORD + TLS) for production. HOST + FROM are required in smtp
	// mode; USERNAME/PASSWORD are optional (omit for MailHog). TLS toggles STARTTLS
	// before AUTH.
	LexNotificationSMTPHost     string
	LexNotificationSMTPPort     int
	LexNotificationSMTPFrom     string
	LexNotificationSMTPUsername string
	LexNotificationSMTPPassword string
	LexNotificationSMTPTLS      bool

	// SSOSuccessRedirect (CAP-152) is the optional frontend URL the lex SSO
	// callback 302-redirects to on success, carrying the minted access token in
	// the URL fragment. When empty the callback returns the platform session as
	// JSON. No other SSO config lives here — the IdP-connection / Redis flow
	// state / JWT config are all owned by the platform IAM FederationService.
	SSOSuccessRedirect string

	// ExecutionSubstantialRequirementDelta (CAP-024) is the requirement-set churn
	// threshold above which a request edit is deemed "substantial" and re-opens the
	// completeness gate. Optional: 0 (default) leaves the detector's built-in
	// default (3) in force. Negative values are ignored by the detector constructor.
	ExecutionSubstantialRequirementDelta int

	// ContractFieldEncryption (WTQ-SEC-04 at-rest) controls application-level
	// encryption of sensitive contract fields. Mode "off" (default) stores
	// plaintext; "software" enables AES-256-GCM using a base64-encoded 32-byte
	// key supplied via the key env var (in-process software custody); "external"
	// sources the 32-byte key at startup from a file path the deployment mounts
	// from an external key store (e.g. a KMS/Vault secret surfaced by an
	// External-Secrets/CSI driver) — the same real AES-256-GCM, key out of
	// process. Production KMS-region attestation remains an infra/audit gate.
	ContractFieldEncryptionMode    string
	ContractFieldEncryptionKeyB64  string
	ContractFieldEncryptionKeyFile string

	// ContractFieldEncryptionPreviousKeysB64 (WTQ-SEC-04 rotation) is an optional,
	// ordered list of SUPERSEDED base64-encoded 32-byte keys, supplied via the
	// comma-separated LEX_CONTRACT_FIELD_ENCRYPTION_PREVIOUS_KEYS env var. They are
	// used as DECRYPT-ONLY fallbacks (newest-first) so rows sealed under a rotated
	// key stay readable until they are re-written under the current key. New writes
	// always use the current key. Without this list a key change makes previously
	// encrypted contract fields unrecoverable (F50). app bootstrap decodes these
	// into key providers and calls FieldCrypto.WithPreviousKeys.
	ContractFieldEncryptionPreviousKeysB64 []string

	// ApprovalAuthorityTrustedRootsPEM (Feature 3) is an optional PEM bundle of
	// trusted root CAs used to cryptographically validate Delegation-of-Authority
	// approval evidence (cert chain + detached signature + validity). It may be
	// supplied inline via LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_PEM or by file path
	// via LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_FILE. Protected profiles require a
	// trust bundle and fail startup without one; development may omit it for local
	// deterministic testing. ApprovalAuthorityRevocationEnabled toggles offline revocation
	// checking against ApprovalAuthorityRevokedSerials (comma-separated serials).
	ApprovalAuthorityTrustedRootsPEM   string
	ApprovalAuthorityRevocationEnabled bool
	ApprovalAuthorityRevokedSerials    []string

	// InboundEmailProviderSecrets holds the provider inbound-parse receiver's
	// per-provider signing/shared secret, keyed by provider name (mailgun |
	// sendgrid | postmark | ses), sourced from LEX_INBOUND_EMAIL_<PROVIDER>_SECRET.
	// A provider with no secret is DISABLED — its public receiver route 404s before
	// any verification, so an unconfigured provider is never an unauthenticated
	// ingest (the receiver bypasses the per-mailbox HMAC, so the provider's own
	// secret is the sole edge auth and MUST fail closed). Empty map = all disabled;
	// the Simulate-Inbound admin action needs none of this.
	InboundEmailProviderSecrets map[string]string

	// Environment is the deployment profile (development / staging / production),
	// sourced from the ENVIRONMENT env var (the cross-service convention; defaults
	// to "development"). It is the gate for the WS5 fail-fast encryption guard:
	// a non-dev profile MUST NOT run with PII field-encryption disabled. Detection
	// mirrors gateway/config.IsProduction — only "development"/"dev"/"local"/""
	// are treated as developer profiles; everything else (production, prod,
	// staging, qa, ...) is a protected profile.
	Environment string
}

func Default() *Config {
	return &Config{
		HTTPPort:                          8087,
		AdminPort:                         9087,
		DBMinConns:                        5,
		DBMaxConns:                        20,
		RedisAddr:                         "localhost:6379",
		RedisDB:                           0,
		KafkaGroupID:                      "lex-service",
		KafkaTopic:                        "enterprise.lex.events",
		RateLimitPerMinute:                300,
		DashboardCacheTTL:                 60 * time.Second,
		ExpiryMonitorInterval:             time.Hour,
		ComplianceMonitorInterval:         6 * time.Hour,
		RenewalReminderInterval:           6 * time.Hour,
		SLAMonitorInterval:                15 * time.Minute,
		DeliveryAutoCloseInterval:         time.Hour,
		SupportExpiryInterval:             5 * time.Minute,
		ProximityMonitorInterval:          time.Hour,
		OutboxDispatchInterval:            60 * time.Second,
		IntegrationSyncInterval:           5 * time.Minute,
		IntegrationRotationInterval:       6 * time.Hour,
		OrgJurisdiction:                   "Saudi Arabia",
		LLMEnrichmentEnabled:              false,
		LLMMaxTokens:                      4096,
		LLMTimeout:                        20 * time.Second,
		LLMMaxInputRunes:                  60000,
		LLMInteractiveDraftingModel:       "claude-sonnet-5",
		SignatureProviderMode:             "deterministic",
		SignatureProviderTimeout:          10 * time.Second,
		ObligationReminderProviderMode:    "deterministic",
		ObligationReminderProviderTimeout: 10 * time.Second,
		SLANotificationProviderMode:       "deterministic",
		SLANotificationProviderTimeout:    10 * time.Second,
		LexNotificationProviderMode:       "deterministic",
		LexNotificationProviderTimeout:    10 * time.Second,
		LexNotificationSMTPPort:           1025,
		// WS5 security hardening: PII field encryption now defaults to "software"
		// (in-process AES-256-GCM) rather than "off". A deployment that genuinely
		// wants plaintext-at-rest must now OPT IN explicitly via
		// LEX_CONTRACT_FIELD_ENCRYPTION_MODE=off — and Validate() forbids that opt-out
		// outside a developer profile. "software" still requires a key to be supplied
		// (LEX_CONTRACT_FIELD_ENCRYPTION_KEY); Load() surfaces the missing-key error.
		ContractFieldEncryptionMode: "software",
		Environment:                 "development",
	}
}

func Load(base *appconfig.Config) (*Config, error) {
	if base == nil {
		return nil, fmt.Errorf("base config is required")
	}

	cfg := Default()
	// F42: reset the per-Load env-parse error accumulator. envInt/envDuration/
	// envBool record malformed values here instead of silently substituting a
	// default; the accumulated errors are checked below before Load returns.
	envParseErrs = nil
	cfg.HTTPPort = envInt("LEX_HTTP_PORT", cfg.HTTPPort)
	cfg.AdminPort = envInt("LEX_ADMIN_PORT", cfg.AdminPort)
	cfg.DBURL = envOr("LEX_DB_URL", buildDBURL(base, "lex_db"))
	cfg.DBMinConns = envInt("LEX_DB_MIN_CONNS", max(base.Database.MaxIdleConns, cfg.DBMinConns))
	cfg.DBMaxConns = envInt("LEX_DB_MAX_CONNS", max(base.Database.MaxOpenConns, cfg.DBMaxConns))
	cfg.RedisAddr = envOr("LEX_REDIS_ADDR", base.Redis.Addr())
	cfg.RedisPassword = envOr("LEX_REDIS_PASSWORD", base.Redis.Password)
	cfg.RedisDB = envInt("LEX_REDIS_DB", base.Redis.DB)
	cfg.KafkaBrokers = splitCSV(envOr("LEX_KAFKA_BROKERS", strings.Join(base.Kafka.Brokers, ",")))
	cfg.KafkaGroupID = envOr("LEX_KAFKA_GROUP_ID", cfg.KafkaGroupID)
	cfg.KafkaTopic = envOr("LEX_KAFKA_TOPIC", cfg.KafkaTopic)
	cfg.JWTPublicKeyPath = os.Getenv("LEX_JWT_PUBLIC_KEY_PATH")
	cfg.RateLimitPerMinute = envInt("LEX_RATE_LIMIT_PER_MINUTE", cfg.RateLimitPerMinute)
	cfg.DashboardCacheTTL = envDuration("LEX_DASHBOARD_CACHE_TTL", cfg.DashboardCacheTTL)
	cfg.ExpiryMonitorInterval = envDuration("LEX_EXPIRY_MONITOR_INTERVAL", cfg.ExpiryMonitorInterval)
	cfg.ComplianceMonitorInterval = envDuration("LEX_COMPLIANCE_MONITOR_INTERVAL", cfg.ComplianceMonitorInterval)
	cfg.RenewalReminderInterval = envDuration("LEX_RENEWAL_REMINDER_INTERVAL", cfg.RenewalReminderInterval)
	cfg.SLAMonitorInterval = envDuration("LEX_SLA_MONITOR_INTERVAL", cfg.SLAMonitorInterval)
	cfg.DeliveryAutoCloseInterval = envDuration("LEX_DELIVERY_AUTOCLOSE_INTERVAL", cfg.DeliveryAutoCloseInterval)
	cfg.SupportExpiryInterval = envDuration("LEX_SUPPORT_EXPIRY_INTERVAL", cfg.SupportExpiryInterval)
	cfg.ProximityMonitorInterval = envDuration("LEX_PROXIMITY_MONITOR_INTERVAL", cfg.ProximityMonitorInterval)
	cfg.OutboxDispatchInterval = envDuration("LEX_OUTBOX_DISPATCH_INTERVAL", cfg.OutboxDispatchInterval)
	cfg.IntegrationSyncInterval = envDuration("LEX_INTEGRATION_SYNC_INTERVAL", cfg.IntegrationSyncInterval)
	cfg.IntegrationRotationInterval = envDuration("LEX_INTEGRATION_ROTATION_INTERVAL", cfg.IntegrationRotationInterval)
	cfg.SeedDemoData = envBool("LEX_SEED_DEMO_DATA", false)
	cfg.SeedTenantID = envOr("LEX_SEED_TENANT_ID", cfg.SeedTenantID)
	cfg.SeedSystemUserID = envOr("LEX_SEED_SYSTEM_USER_ID", cfg.SeedSystemUserID)
	cfg.OrgJurisdiction = envOr("LEX_ORG_JURISDICTION", cfg.OrgJurisdiction)
	cfg.LLMEnrichmentEnabled = envBool("LEX_LLM_ENRICHMENT_ENABLED", cfg.LLMEnrichmentEnabled)
	cfg.LLMMaxTokens = envInt("LEX_LLM_MAX_TOKENS", cfg.LLMMaxTokens)
	cfg.LLMTimeout = envDuration("LEX_LLM_TIMEOUT", cfg.LLMTimeout)
	cfg.LLMMaxInputRunes = envInt("LEX_LLM_MAX_INPUT_RUNES", cfg.LLMMaxInputRunes)
	cfg.LLMInteractiveDraftingModel = envOr("LEX_LLM_INTERACTIVE_DRAFTING_MODEL", cfg.LLMInteractiveDraftingModel)
	cfg.SignatureProviderMode = strings.ToLower(envOr("LEX_SIGNATURE_PROVIDER_MODE", cfg.SignatureProviderMode))
	cfg.SignatureProviderEndpoint = envOr("LEX_SIGNATURE_PROVIDER_ENDPOINT", cfg.SignatureProviderEndpoint)
	cfg.SignatureProviderAPIKey = envOr("LEX_SIGNATURE_PROVIDER_API_KEY", cfg.SignatureProviderAPIKey)
	cfg.SignatureProviderTimeout = envDuration("LEX_SIGNATURE_PROVIDER_TIMEOUT", cfg.SignatureProviderTimeout)
	cfg.ObligationReminderProviderMode = strings.ToLower(envOr("LEX_OBLIGATION_REMINDER_PROVIDER_MODE", cfg.ObligationReminderProviderMode))
	cfg.ObligationReminderProviderEndpoint = envOr("LEX_OBLIGATION_REMINDER_PROVIDER_ENDPOINT", cfg.ObligationReminderProviderEndpoint)
	cfg.ObligationReminderProviderAPIKey = envOr("LEX_OBLIGATION_REMINDER_PROVIDER_API_KEY", cfg.ObligationReminderProviderAPIKey)
	cfg.ObligationReminderProviderTimeout = envDuration("LEX_OBLIGATION_REMINDER_PROVIDER_TIMEOUT", cfg.ObligationReminderProviderTimeout)
	cfg.SLANotificationProviderMode = strings.ToLower(envOr("LEX_SLA_NOTIFICATION_PROVIDER_MODE", cfg.SLANotificationProviderMode))
	cfg.SLANotificationProviderEndpoint = envOr("LEX_SLA_NOTIFICATION_PROVIDER_ENDPOINT", cfg.SLANotificationProviderEndpoint)
	cfg.SLANotificationProviderAPIKey = envOr("LEX_SLA_NOTIFICATION_PROVIDER_API_KEY", cfg.SLANotificationProviderAPIKey)
	cfg.SLANotificationProviderTimeout = envDuration("LEX_SLA_NOTIFICATION_PROVIDER_TIMEOUT", cfg.SLANotificationProviderTimeout)
	cfg.LexNotificationProviderMode = strings.ToLower(envOr("LEX_LEX_NOTIFICATION_PROVIDER_MODE", cfg.LexNotificationProviderMode))
	cfg.LexNotificationProviderEndpoint = envOr("LEX_LEX_NOTIFICATION_PROVIDER_ENDPOINT", cfg.LexNotificationProviderEndpoint)
	cfg.LexNotificationProviderAPIKey = envOr("LEX_LEX_NOTIFICATION_PROVIDER_API_KEY", cfg.LexNotificationProviderAPIKey)
	cfg.LexNotificationProviderTimeout = envDuration("LEX_LEX_NOTIFICATION_PROVIDER_TIMEOUT", cfg.LexNotificationProviderTimeout)
	cfg.LexNotificationProviderName = envOr("LEX_LEX_NOTIFICATION_PROVIDER_NAME", cfg.LexNotificationProviderName)
	cfg.LexNotificationSMTPHost = envOr("LEX_LEX_NOTIFICATION_SMTP_HOST", cfg.LexNotificationSMTPHost)
	cfg.LexNotificationSMTPPort = envInt("LEX_LEX_NOTIFICATION_SMTP_PORT", cfg.LexNotificationSMTPPort)
	cfg.LexNotificationSMTPFrom = envOr("LEX_LEX_NOTIFICATION_SMTP_FROM", cfg.LexNotificationSMTPFrom)
	cfg.LexNotificationSMTPUsername = envOr("LEX_LEX_NOTIFICATION_SMTP_USERNAME", cfg.LexNotificationSMTPUsername)
	cfg.LexNotificationSMTPPassword = envOr("LEX_LEX_NOTIFICATION_SMTP_PASSWORD", cfg.LexNotificationSMTPPassword)
	cfg.LexNotificationSMTPTLS = envBool("LEX_LEX_NOTIFICATION_SMTP_TLS", cfg.LexNotificationSMTPTLS)
	cfg.SSOSuccessRedirect = envOr("LEX_SSO_SUCCESS_REDIRECT", cfg.SSOSuccessRedirect)
	cfg.ExecutionSubstantialRequirementDelta = envInt("LEX_EXECUTION_SUBSTANTIAL_REQUIREMENT_DELTA", cfg.ExecutionSubstantialRequirementDelta)
	cfg.ContractFieldEncryptionMode = strings.ToLower(envOr("LEX_CONTRACT_FIELD_ENCRYPTION_MODE", cfg.ContractFieldEncryptionMode))
	cfg.ContractFieldEncryptionKeyB64 = envOr("LEX_CONTRACT_FIELD_ENCRYPTION_KEY", cfg.ContractFieldEncryptionKeyB64)
	cfg.ContractFieldEncryptionKeyFile = envOr("LEX_CONTRACT_FIELD_ENCRYPTION_KEY_FILE", cfg.ContractFieldEncryptionKeyFile)
	cfg.ContractFieldEncryptionPreviousKeysB64 = splitCSV(envOr("LEX_CONTRACT_FIELD_ENCRYPTION_PREVIOUS_KEYS", ""))
	// Provider inbound-parse receiver secrets. Absent/blank => that provider's
	// receiver stays disabled (404), so this needs no validation: it can only
	// ever ENABLE a provider by supplying its secret.
	cfg.InboundEmailProviderSecrets = loadInboundEmailProviderSecrets()
	// ENVIRONMENT is the shared cross-service profile var (see cmd/*/main.go). LEX_ENVIRONMENT
	// is honoured as a service-scoped override; both default to "development".
	cfg.Environment = strings.ToLower(envOr("LEX_ENVIRONMENT", envOr("ENVIRONMENT", cfg.Environment)))

	// Feature 3: approval authority-evidence trusted roots. Inline PEM wins; else
	// read from a file path if supplied. A missing file is a hard config error so
	// a misconfigured deployment fails fast rather than silently falling back.
	cfg.ApprovalAuthorityTrustedRootsPEM = envOr("LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_PEM", "")
	if cfg.ApprovalAuthorityTrustedRootsPEM == "" {
		if path := strings.TrimSpace(os.Getenv("LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_FILE")); path != "" {
			raw, err := os.ReadFile(path)
			if err != nil {
				return nil, fmt.Errorf("LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_FILE: %w", err)
			}
			cfg.ApprovalAuthorityTrustedRootsPEM = string(raw)
		}
	}
	cfg.ApprovalAuthorityRevocationEnabled = envBool("LEX_APPROVAL_AUTHORITY_REVOCATION_ENABLED", false)
	cfg.ApprovalAuthorityRevokedSerials = splitCSV(envOr("LEX_APPROVAL_AUTHORITY_REVOKED_SERIALS", ""))

	// F42: fail LOUDLY on any malformed LEX_* numeric/duration/bool env var rather
	// than silently falling back to its default. A typo such as LEX_LLM_TIMEOUT=90
	// (no unit) or =7d would otherwise quietly revert a deploy-time tuning to the
	// built-in default with no signal. Checked before the semantic validations so
	// the most actionable error surfaces first.
	if len(envParseErrs) > 0 {
		return nil, fmt.Errorf("invalid lex environment configuration: %w", errors.Join(envParseErrs...))
	}

	if _, err := url.Parse(cfg.DBURL); err != nil {
		return nil, fmt.Errorf("LEX_DB_URL is invalid: %w", err)
	}
	if cfg.HTTPPort < 1 || cfg.HTTPPort > 65535 {
		return nil, fmt.Errorf("LEX_HTTP_PORT must be between 1 and 65535")
	}
	if cfg.AdminPort < 1 || cfg.AdminPort > 65535 {
		return nil, fmt.Errorf("LEX_ADMIN_PORT must be between 1 and 65535")
	}
	if cfg.DBMinConns < 1 {
		return nil, fmt.Errorf("LEX_DB_MIN_CONNS must be >= 1")
	}
	if cfg.DBMaxConns < cfg.DBMinConns {
		return nil, fmt.Errorf("LEX_DB_MAX_CONNS must be >= LEX_DB_MIN_CONNS")
	}
	if cfg.RateLimitPerMinute < 1 {
		return nil, fmt.Errorf("LEX_RATE_LIMIT_PER_MINUTE must be >= 1")
	}
	if cfg.DashboardCacheTTL <= 0 {
		return nil, fmt.Errorf("LEX_DASHBOARD_CACHE_TTL must be > 0")
	}
	if cfg.ExpiryMonitorInterval <= 0 || cfg.ComplianceMonitorInterval <= 0 || cfg.RenewalReminderInterval <= 0 ||
		cfg.SLAMonitorInterval <= 0 || cfg.DeliveryAutoCloseInterval <= 0 || cfg.SupportExpiryInterval <= 0 || cfg.ProximityMonitorInterval <= 0 ||
		cfg.OutboxDispatchInterval <= 0 || cfg.IntegrationSyncInterval <= 0 || cfg.IntegrationRotationInterval <= 0 {
		return nil, fmt.Errorf("scheduler intervals must be > 0")
	}
	if cfg.JWTPublicKeyPath != "" {
		if _, err := os.Stat(cfg.JWTPublicKeyPath); err != nil {
			return nil, fmt.Errorf("LEX_JWT_PUBLIC_KEY_PATH: %w", err)
		}
	}
	if cfg.LLMMaxTokens < 1 || cfg.LLMMaxTokens > 8192 {
		return nil, fmt.Errorf("LEX_LLM_MAX_TOKENS must be between 1 and 8192")
	}
	if cfg.LLMTimeout <= 0 {
		return nil, fmt.Errorf("LEX_LLM_TIMEOUT must be > 0")
	}
	if cfg.LLMMaxInputRunes < 1 {
		return nil, fmt.Errorf("LEX_LLM_MAX_INPUT_RUNES must be >= 1")
	}
	if strings.ContainsAny(cfg.LLMInteractiveDraftingModel, "\r\n") {
		return nil, fmt.Errorf("LEX_LLM_INTERACTIVE_DRAFTING_MODEL must be a single-line model identifier")
	}
	switch cfg.SignatureProviderMode {
	case "deterministic":
	case "http":
		if cfg.SignatureProviderEndpoint == "" {
			return nil, fmt.Errorf("LEX_SIGNATURE_PROVIDER_ENDPOINT is required when LEX_SIGNATURE_PROVIDER_MODE=http")
		}
		endpoint, err := url.Parse(cfg.SignatureProviderEndpoint)
		if err != nil || endpoint.Scheme == "" || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
			return nil, fmt.Errorf("LEX_SIGNATURE_PROVIDER_ENDPOINT must be an absolute http(s) URL")
		}
		if cfg.SignatureProviderAPIKey == "" {
			return nil, fmt.Errorf("LEX_SIGNATURE_PROVIDER_API_KEY is required when LEX_SIGNATURE_PROVIDER_MODE=http")
		}
	default:
		return nil, fmt.Errorf("LEX_SIGNATURE_PROVIDER_MODE must be deterministic or http")
	}
	if cfg.SignatureProviderTimeout <= 0 {
		return nil, fmt.Errorf("LEX_SIGNATURE_PROVIDER_TIMEOUT must be > 0")
	}
	switch cfg.ObligationReminderProviderMode {
	case "deterministic":
	case "http":
		if cfg.ObligationReminderProviderEndpoint == "" {
			return nil, fmt.Errorf("LEX_OBLIGATION_REMINDER_PROVIDER_ENDPOINT is required when LEX_OBLIGATION_REMINDER_PROVIDER_MODE=http")
		}
		endpoint, err := url.Parse(cfg.ObligationReminderProviderEndpoint)
		if err != nil || endpoint.Scheme == "" || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
			return nil, fmt.Errorf("LEX_OBLIGATION_REMINDER_PROVIDER_ENDPOINT must be an absolute http(s) URL")
		}
		if cfg.ObligationReminderProviderAPIKey == "" {
			return nil, fmt.Errorf("LEX_OBLIGATION_REMINDER_PROVIDER_API_KEY is required when LEX_OBLIGATION_REMINDER_PROVIDER_MODE=http")
		}
	default:
		return nil, fmt.Errorf("LEX_OBLIGATION_REMINDER_PROVIDER_MODE must be deterministic or http")
	}
	if cfg.ObligationReminderProviderTimeout <= 0 {
		return nil, fmt.Errorf("LEX_OBLIGATION_REMINDER_PROVIDER_TIMEOUT must be > 0")
	}
	switch cfg.SLANotificationProviderMode {
	case "deterministic":
	case "http":
		if cfg.SLANotificationProviderEndpoint == "" {
			return nil, fmt.Errorf("LEX_SLA_NOTIFICATION_PROVIDER_ENDPOINT is required when LEX_SLA_NOTIFICATION_PROVIDER_MODE=http")
		}
		endpoint, err := url.Parse(cfg.SLANotificationProviderEndpoint)
		if err != nil || endpoint.Scheme == "" || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
			return nil, fmt.Errorf("LEX_SLA_NOTIFICATION_PROVIDER_ENDPOINT must be an absolute http(s) URL")
		}
		if cfg.SLANotificationProviderAPIKey == "" {
			return nil, fmt.Errorf("LEX_SLA_NOTIFICATION_PROVIDER_API_KEY is required when LEX_SLA_NOTIFICATION_PROVIDER_MODE=http")
		}
	default:
		return nil, fmt.Errorf("LEX_SLA_NOTIFICATION_PROVIDER_MODE must be deterministic or http")
	}
	if cfg.SLANotificationProviderTimeout <= 0 {
		return nil, fmt.Errorf("LEX_SLA_NOTIFICATION_PROVIDER_TIMEOUT must be > 0")
	}
	switch cfg.LexNotificationProviderMode {
	case "deterministic":
	case "http":
		if cfg.LexNotificationProviderEndpoint == "" {
			return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_PROVIDER_ENDPOINT is required when LEX_LEX_NOTIFICATION_PROVIDER_MODE=http")
		}
		endpoint, err := url.Parse(cfg.LexNotificationProviderEndpoint)
		if err != nil || endpoint.Scheme == "" || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
			return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_PROVIDER_ENDPOINT must be an absolute http(s) URL")
		}
		if cfg.LexNotificationProviderAPIKey == "" {
			return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_PROVIDER_API_KEY is required when LEX_LEX_NOTIFICATION_PROVIDER_MODE=http")
		}
	case "smtp":
		if strings.TrimSpace(cfg.LexNotificationSMTPHost) == "" {
			return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_SMTP_HOST is required when LEX_LEX_NOTIFICATION_PROVIDER_MODE=smtp")
		}
		if strings.TrimSpace(cfg.LexNotificationSMTPFrom) == "" {
			return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_SMTP_FROM is required when LEX_LEX_NOTIFICATION_PROVIDER_MODE=smtp")
		}
		if cfg.LexNotificationSMTPPort <= 0 || cfg.LexNotificationSMTPPort > 65535 {
			return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_SMTP_PORT must be between 1 and 65535")
		}
		// USERNAME/PASSWORD are optional (MailHog and other dev relays take none);
		// when a username IS supplied a password must accompany it.
		if strings.TrimSpace(cfg.LexNotificationSMTPUsername) != "" && cfg.LexNotificationSMTPPassword == "" {
			return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_SMTP_PASSWORD is required when LEX_LEX_NOTIFICATION_SMTP_USERNAME is set")
		}
	default:
		return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_PROVIDER_MODE must be deterministic, http or smtp")
	}
	if cfg.LexNotificationProviderTimeout <= 0 {
		return nil, fmt.Errorf("LEX_LEX_NOTIFICATION_PROVIDER_TIMEOUT must be > 0")
	}
	switch cfg.ContractFieldEncryptionMode {
	case "", "off":
		cfg.ContractFieldEncryptionMode = "off"
	case "software":
	case "external":
	default:
		return nil, fmt.Errorf("LEX_CONTRACT_FIELD_ENCRYPTION_MODE must be off, software, or external")
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

// IsDevProfile reports whether this deployment runs under a developer profile.
// Only "development"/"dev"/"local"/"test"/"" are developer profiles; everything
// else (production, prod, staging, qa, uat, ...) is a PROTECTED profile where the
// security floor (PII encryption on) is mandatory. This is intentionally the
// inverse-by-allowlist of gateway/config.IsProduction: staging and any unknown
// label are treated as protected, so a typo never silently disables encryption.
func (c *Config) IsDevProfile() bool {
	switch strings.ToLower(strings.TrimSpace(c.Environment)) {
	case "", "development", "dev", "local", "test":
		return true
	default:
		return false
	}
}

// Validate enforces deploy-time security invariants that depend on the
// deployment profile. It is the WS5 fail-fast guard: a PROTECTED (non-dev)
// profile MUST NOT run with PII field encryption disabled. Validate is called at
// the end of Load (so startup fails fast) and is also safe to call directly from
// app bootstrap as an explicit, self-documenting gate. It NEVER weakens an
// already-validated config; it only rejects insecure combinations.
func (c *Config) Validate() error {
	// Resolve software/external mode that has NO usable key BEFORE the security
	// floor. The key-presence check in Load() is bypassed when a Config is built
	// directly (tests, Default() fallback), so Validate() — which app bootstrap
	// always calls — is the authoritative guard:
	//   - dev profile  + no key  -> DOWNGRADE to "off" so the service boots
	//     plaintext-at-rest (acceptable in development/test; no secret material to
	//     custody). This is what lets the integration harness and a keyless dev run
	//     start while the new "software" default still applies the moment a key is
	//     supplied.
	//   - non-dev      + no key  -> FAIL FAST (a protected profile must never run
	//     plaintext, and must not silently misconfigure encryption).
	switch c.ContractFieldEncryptionMode {
	case "software":
		if c.ContractFieldEncryptionKeyB64 == "" {
			if c.IsDevProfile() {
				c.ContractFieldEncryptionMode = "off"
			} else {
				return fmt.Errorf(
					"LEX_CONTRACT_FIELD_ENCRYPTION_KEY is required when LEX_CONTRACT_FIELD_ENCRYPTION_MODE=software in a non-development profile (ENVIRONMENT=%q)",
					c.Environment,
				)
			}
		}
	case "external":
		if c.ContractFieldEncryptionKeyFile == "" {
			if c.IsDevProfile() {
				c.ContractFieldEncryptionMode = "off"
			} else {
				return fmt.Errorf(
					"LEX_CONTRACT_FIELD_ENCRYPTION_KEY_FILE is required when LEX_CONTRACT_FIELD_ENCRYPTION_MODE=external in a non-development profile (ENVIRONMENT=%q)",
					c.Environment,
				)
			}
		}
	}

	// Security floor: PII field encryption must be enabled outside dev profiles.
	// "off" is the only insecure mode; "software"/"external" both perform real
	// AES-256-GCM. After the downgrade above, a non-dev profile reaching "off"
	// here genuinely lacks a key and is correctly refused.
	if !c.IsDevProfile() && c.ContractFieldEncryptionMode == "off" {
		return fmt.Errorf(
			"LEX_CONTRACT_FIELD_ENCRYPTION_MODE=off is forbidden in a non-development profile (ENVIRONMENT=%q): "+
				"PII field encryption must be enabled (set mode=software with LEX_CONTRACT_FIELD_ENCRYPTION_KEY, "+
				"or mode=external with LEX_CONTRACT_FIELD_ENCRYPTION_KEY_FILE)",
			c.Environment,
		)
	}

	// Approval policies default to requiring Delegation-of-Authority evidence.
	// In protected environments, accepting that evidence without a configured
	// trust anchor reduces the check to caller-supplied role/amount text. Fail
	// startup instead of silently weakening the advertised PKI guarantee.
	if !c.IsDevProfile() && strings.TrimSpace(c.ApprovalAuthorityTrustedRootsPEM) == "" {
		return fmt.Errorf(
			"LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_PEM or LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS_FILE is required in a non-development profile (ENVIRONMENT=%q): Delegation-of-Authority evidence must be cryptographically verified",
			c.Environment,
		)
	}
	return nil
}

// loadInboundEmailProviderSecrets reads the per-provider inbound-parse secrets
// from LEX_INBOUND_EMAIL_<PROVIDER>_SECRET for the supported providers. Only
// providers with a non-empty secret appear in the map (present ⇒ enabled).
func loadInboundEmailProviderSecrets() map[string]string {
	secrets := map[string]string{}
	for _, provider := range []string{"mailgun", "sendgrid", "postmark", "ses"} {
		if v := strings.TrimSpace(os.Getenv("LEX_INBOUND_EMAIL_" + strings.ToUpper(provider) + "_SECRET")); v != "" {
			secrets[provider] = v
		}
	}
	return secrets
}

func buildDBURL(base *appconfig.Config, dbName string) string {
	return fmt.Sprintf(
		"postgres://%s:%s@%s:%d/%s?sslmode=%s",
		base.Database.User,
		base.Database.Password,
		base.Database.Host,
		base.Database.Port,
		dbName,
		base.Database.SSLMode,
	)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// envParseErrs accumulates env-var parse failures produced by envInt/envDuration/
// envBool during a single Load() so the loader can fail LOUDLY instead of silently
// substituting a default (F42). Load() resets it at entry; lex config is loaded
// once at startup, so this package-global is never exercised concurrently.
var envParseErrs []error

func recordEnvParseErr(key, raw string, err error) {
	envParseErrs = append(envParseErrs, fmt.Errorf("%s=%q: %w", key, raw, err))
}

func envInt(key string, fallback int) int {
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			recordEnvParseErr(key, raw, err)
			return fallback
		}
		return parsed
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		parsed, err := time.ParseDuration(raw)
		if err != nil {
			recordEnvParseErr(key, raw, err)
			return fallback
		}
		return parsed
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	if raw := strings.TrimSpace(os.Getenv(key)); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			recordEnvParseErr(key, raw, err)
			return fallback
		}
		return parsed
	}
	return fallback
}

func splitCSV(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
