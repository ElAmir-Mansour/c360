// Package config loads clario-dr-service configuration from the environment,
// layered over the shared platform config (DESIGN_DataStream_DR.md §4.1).
package config

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	appconfig "github.com/clario360/platform/internal/config"
	drprovider "github.com/clario360/platform/internal/dr/provider"
)

// Config carries clario-dr-service settings.
type Config struct {
	HTTPPort   int
	AdminPort  int
	DBURL      string
	DBMinConns int
	DBMaxConns int

	KafkaBrokers []string
	KafkaGroupID string

	// JWTPublicKeyPath optionally overrides the platform JWT public key for
	// validating gateway-issued tokens.
	JWTPublicKeyPath string

	// MTLSListenAddr is the address the mTLS ingest listener binds to; DR
	// agents ship encrypted resumable streams here (§2.1, §4.2 step 7).
	MTLSListenAddr string
	// MTLSCABundlePath/ServerCertPath/ServerKeyPath configure the dedicated
	// mTLS ingest listener. When any path is empty, ingest is not started.
	MTLSCABundlePath   string
	MTLSServerCertPath string
	MTLSServerKeyPath  string
	MTLSCRLRefresh     time.Duration

	// EnrollTokenKeyName is the JWT kid used for DR agent enrollment tokens.
	// Production must provide one of EnrollTokenPrivateKeyPath,
	// EnrollTokenPrivateKeyPEM, or EnrollTokenPrivateJWK. Non-production may
	// fall back to an ephemeral key for local development only.
	EnrollTokenKeyName        string
	EnrollTokenPrivateKeyPath string
	EnrollTokenPrivateKeyPEM  string
	EnrollTokenPrivateJWK     string
	AllowEphemeralEnrollKey   bool

	MigrationsPath string

	// --- Recovery-point store (WP-4: WORM + per-tenant DEK) ---------------
	// When MinIOEndpoint and VaultAddr are both set, main.go wires the real
	// recovery-point store: a MinIO/S3 bucket with object-lock GOVERNANCE and a
	// per-tenant DEK from Vault Transit. Left empty, the recovery-point seal
	// path is disabled (sites/groups/streams still serve).
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
	MinIOUseSSL    bool
	MinIORegion    string
	// WORMBucket is the object-lock recovery-point bucket (dr-recovery-points).
	WORMBucket string
	// WORMRetentionMode selects the object-lock retention mode the WORM client
	// applies: "governance" (default; ransomware-immutable but bypassable by a
	// privileged operator for lifecycle reclaim) or "compliance" (un-bypassable
	// until retention expires; the DR thinner must NOT run against it). Empty /
	// unknown => governance. Env DR_WORM_RETENTION_MODE.
	WORMRetentionMode string
	// WORMRequireExplicitRegion, when true, makes an empty object-store region a
	// hard startup error (worm.ErrRegionRequired) instead of silently defaulting
	// to worm.DefaultRegion. Sovereign deployments set it so recovery data can
	// never land in an unintended region. Env DR_WORM_REQUIRE_EXPLICIT_REGION.
	WORMRequireExplicitRegion bool
	// CleanPointGateEnforce, when true, enables the ransomware-safe clean-recovery
	// -point promotion gate: ValidateRecoveryPoint consults the latest STORED
	// clean-room verdict (read-only, never triggers a fresh scan) and refuses to
	// mark a recovery point promotion-safe unless its clean-point score is clean.
	// Default false preserves the content-hash-fidelity validation behavior, so
	// this is opt-in like the other sovereign gates. Env DR_CLEANPOINT_GATE_ENFORCE.
	CleanPointGateEnforce bool
	// RecoveryRetention is the default GOVERNANCE retain window for sealed
	// chunks; DR layers a rolling reclaim window on top (§5). Default 7 days.
	RecoveryRetention time.Duration
	// LegalHoldCount is how many of the newest validated points keep a
	// legal-hold (the ransomware-safe floor). Default 3.
	LegalHoldCount int

	VaultAddr            string
	VaultAuthMethod      string
	VaultToken           string
	VaultAppRoleRoleID   string
	VaultAppRoleSecretID string
	VaultTransitPath     string
	VaultNamespace       string

	// --- Recover productization layer ---------------------------------------
	// LicenseServiceURL is the base URL of the licensing service the Recover
	// product resolves per-tenant entitlement state against (the SAME engine the
	// gateway gates suite routes with). When empty it defaults to the platform's
	// license-service. RecoverEntitlementFailOpen, when true, treats a licensing
	// outage as entitled (dev only); production must fail closed (default).
	LicenseServiceURL          string
	RecoverEntitlementFailOpen bool
	RecoverEntitlementTimeout  time.Duration

	// --- Failover recovery executor -----------------------------------------
	// RecoveryDriver selects the RecoveryTargetDriver wired into Gate 3.
	// "verify" restores/decrypts and records a deterministic id for local/dev.
	// "command" invokes an external provisioner command for production recovery.
	RecoveryDriver          string
	RecoveryEnsureCommand   []string
	RecoveryTeardownCommand []string
	RecoveryCommandTimeout  time.Duration
	RecoveryProvider        drprovider.Config

	// DeploymentProfile switches additional fail-closed startup validation on
	// for regulated deployments. DR_REGULATED_MODE is a compatibility boolean
	// trigger for the same posture.
	DeploymentProfile string
	RegulatedMode     bool

	// ResidencyRegion is the data-residency region this DR deployment is bound
	// to (e.g. "me-central-1" / KSA). It is the SINGLE source of truth for the
	// data-plane sovereignty guard (worm Seal/Get) and the regulated-profile
	// residency gate. It is read from the DOCUMENTED env names first —
	// DR_RESIDENCY (runbook primary), then RESIDENCY — falling back to the
	// platform-wide SERVICE_REGION for backward compatibility. Empty disables
	// residency enforcement (non-regulated deployments are unaffected); the
	// regulated profile REQUIRES it non-empty (ValidateRuntime fails closed).
	//
	// ResidencyRegionSource records which env var supplied the value, purely for
	// startup diagnostics / the readiness posture view.
	ResidencyRegion       string
	ResidencyRegionSource string

	// Environment is the deployment environment (ENVIRONMENT env var:
	// development | production | prod | ...). It gates the BYOK fail-closed rule:
	// production forbids the volatile in-memory keystore.
	Environment string

	// --- BYOK sovereign key custody (WP: sealed key custody) ---------------
	// RehearsalProofSigningKeyPEM is the PEM CONTENT (RSA or ECDSA private key —
	// NOT a file path) used to sign sealed rehearsal proofs. Env
	// DR_REHEARSAL_PROOF_SIGNING_KEY_PEM. When empty, the rehearsal-proof service
	// stays compute-only (GET works; sealed POST returns 501).
	RehearsalProofSigningKeyPEM string

	// RootKeyB64 is the operator ROOT key that seals every tenant KEK, base64 of
	// 32 raw bytes (AES-256). Env DR_BYOK_ROOT_KEY. When set, the DR service
	// custodies software KEKs through the SEALED, persistent keystore
	// (restart-safe) instead of the volatile in-memory keystore. In production one
	// of RootKeyB64 or a remote KMS endpoint (DR_BYOK_KMS_ENDPOINT) is MANDATORY.
	RootKeyB64 string
}

// Default returns development defaults; ports follow the platform layout
// (HTTP 80xx / admin 90xx, clario-dr-service = x97; mTLS ingest = :8098).
func Default() *Config {
	return &Config{
		HTTPPort:                  8097,
		AdminPort:                 9097,
		DBMinConns:                2,
		DBMaxConns:                10,
		KafkaGroupID:              "clario-dr-service",
		MTLSListenAddr:            ":8098",
		MTLSCRLRefresh:            time.Minute,
		EnrollTokenKeyName:        "dr-enrollment-jwt",
		MigrationsPath:            "migrations/dr_db",
		WORMBucket:                "dr-recovery-points",
		WORMRetentionMode:         "governance",
		RecoveryRetention:         7 * 24 * time.Hour,
		LegalHoldCount:            3,
		VaultAuthMethod:           "token",
		VaultTransitPath:          "transit/",
		RecoveryDriver:            "verify",
		RecoveryCommandTimeout:    10 * time.Minute,
		LicenseServiceURL:         "http://localhost:8096",
		RecoverEntitlementTimeout: 3 * time.Second,
		DeploymentProfile:         "standard",
	}
}

// Load reads DR_* environment variables over defaults, deriving the database
// URL and Kafka brokers from the platform config when unset.
func Load(base *appconfig.Config) (*Config, error) {
	cfg := Default()

	cfg.Environment = strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT")))
	if cfg.Environment == "prod" {
		cfg.Environment = "production"
	}

	if v := os.Getenv("DR_DEPLOYMENT_PROFILE"); v != "" {
		cfg.DeploymentProfile = strings.ToLower(strings.TrimSpace(v))
	}
	if v := os.Getenv("DR_REGULATED_MODE"); v != "" {
		enabled, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return nil, fmt.Errorf("invalid DR_REGULATED_MODE %q: %w", v, err)
		}
		cfg.RegulatedMode = enabled
	}

	// Data-residency region. The runbook (DR_Regulated_Release_Runbook.md) and the
	// code-map document DR_RESIDENCY / RESIDENCY, but the platform-wide config only
	// wired SERVICE_REGION — that mismatch silently left the data-plane guard OFF
	// for operators following the runbook. Resolve from the DOCUMENTED names first,
	// then fall back to SERVICE_REGION (as surfaced on base.Residency) so both the
	// runbook path AND the legacy path turn enforcement on. Backward compatible.
	if key, v := firstEnv("DR_RESIDENCY", "RESIDENCY"); v != "" {
		cfg.ResidencyRegion = strings.TrimSpace(v)
		cfg.ResidencyRegionSource = key
	} else if base != nil && strings.TrimSpace(base.Residency.ServiceRegion) != "" {
		cfg.ResidencyRegion = strings.TrimSpace(base.Residency.ServiceRegion)
		cfg.ResidencyRegionSource = "SERVICE_REGION"
	}

	if v := os.Getenv("DR_HTTP_PORT"); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_HTTP_PORT %q: %w", v, err)
		}
		cfg.HTTPPort = port
	}
	if v := os.Getenv("DR_ADMIN_PORT"); v != "" {
		port, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_ADMIN_PORT %q: %w", v, err)
		}
		cfg.AdminPort = port
	}

	cfg.DBURL = os.Getenv("DR_DATABASE_URL")
	if cfg.DBURL == "" {
		derived := base.Database
		derived.Name = "dr_db"
		cfg.DBURL = derived.DSN()
	}
	if v := os.Getenv("DR_DB_MIN_CONNS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_DB_MIN_CONNS %q: %w", v, err)
		}
		cfg.DBMinConns = n
	}
	if v := os.Getenv("DR_DB_MAX_CONNS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_DB_MAX_CONNS %q: %w", v, err)
		}
		cfg.DBMaxConns = n
	}

	if v := os.Getenv("DR_KAFKA_BROKERS"); v != "" {
		cfg.KafkaBrokers = splitNonEmpty(v)
	} else {
		cfg.KafkaBrokers = base.Kafka.Brokers
	}
	if v := os.Getenv("DR_KAFKA_GROUP_ID"); v != "" {
		cfg.KafkaGroupID = v
	}

	cfg.JWTPublicKeyPath = os.Getenv("DR_JWT_PUBLIC_KEY_PATH")

	if v := os.Getenv("DR_MTLS_LISTEN_ADDR"); v != "" {
		cfg.MTLSListenAddr = v
	}
	cfg.MTLSCABundlePath = os.Getenv("DR_MTLS_CA_BUNDLE_PATH")
	cfg.MTLSServerCertPath = os.Getenv("DR_MTLS_SERVER_CERT_PATH")
	cfg.MTLSServerKeyPath = os.Getenv("DR_MTLS_SERVER_KEY_PATH")
	if key, v := firstEnv("DR_MTLS_CRL_REFRESH", "DR_CRL_CACHE_TTL"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid %s %q: %w", key, v, err)
		}
		cfg.MTLSCRLRefresh = d
	}

	if v := os.Getenv("DR_ENROLL_TOKEN_KEY_NAME"); v != "" {
		cfg.EnrollTokenKeyName = v
	}
	cfg.EnrollTokenPrivateKeyPath = os.Getenv("DR_ENROLL_TOKEN_PRIVATE_KEY_PATH")
	cfg.EnrollTokenPrivateKeyPEM = os.Getenv("DR_ENROLL_TOKEN_PRIVATE_KEY_PEM")
	cfg.EnrollTokenPrivateJWK = os.Getenv("DR_ENROLL_TOKEN_PRIVATE_JWK")
	if v := os.Getenv("DR_ENROLL_TOKEN_ALLOW_EPHEMERAL"); v != "" {
		allowed, err := strconv.ParseBool(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_ENROLL_TOKEN_ALLOW_EPHEMERAL %q: %w", v, err)
		}
		cfg.AllowEphemeralEnrollKey = allowed
	}

	if v := os.Getenv("DR_MIGRATIONS_PATH"); v != "" {
		cfg.MigrationsPath = v
	}

	// --- Recovery-point store (WP-4) -------------------------------------
	cfg.MinIOEndpoint = os.Getenv("DR_MINIO_ENDPOINT")
	cfg.MinIOAccessKey = os.Getenv("DR_MINIO_ACCESS_KEY")
	cfg.MinIOSecretKey = os.Getenv("DR_MINIO_SECRET_KEY")
	cfg.MinIOUseSSL = os.Getenv("DR_MINIO_USE_SSL") == "true"
	if v := os.Getenv("DR_MINIO_REGION"); v != "" {
		cfg.MinIORegion = v
	}
	if v := os.Getenv("DR_WORM_BUCKET"); v != "" {
		cfg.WORMBucket = v
	}
	if v := strings.TrimSpace(os.Getenv("DR_WORM_RETENTION_MODE")); v != "" {
		cfg.WORMRetentionMode = strings.ToLower(v)
	}
	if v := os.Getenv("DR_WORM_REQUIRE_EXPLICIT_REGION"); v != "" {
		enabled, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return nil, fmt.Errorf("invalid DR_WORM_REQUIRE_EXPLICIT_REGION %q: %w", v, err)
		}
		cfg.WORMRequireExplicitRegion = enabled
	}
	if v := os.Getenv("DR_CLEANPOINT_GATE_ENFORCE"); v != "" {
		enabled, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return nil, fmt.Errorf("invalid DR_CLEANPOINT_GATE_ENFORCE %q: %w", v, err)
		}
		cfg.CleanPointGateEnforce = enabled
	}
	if v := os.Getenv("DR_RECOVERY_RETENTION"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_RECOVERY_RETENTION %q: %w", v, err)
		}
		cfg.RecoveryRetention = d
	}
	if v := os.Getenv("DR_LEGAL_HOLD_COUNT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_LEGAL_HOLD_COUNT %q: %w", v, err)
		}
		cfg.LegalHoldCount = n
	}

	cfg.VaultAddr = os.Getenv("DR_VAULT_ADDR")
	if v := os.Getenv("DR_VAULT_AUTH_METHOD"); v != "" {
		cfg.VaultAuthMethod = v
	}
	cfg.VaultToken = os.Getenv("DR_VAULT_TOKEN")
	cfg.VaultAppRoleRoleID = os.Getenv("DR_VAULT_APPROLE_ROLE_ID")
	cfg.VaultAppRoleSecretID = os.Getenv("DR_VAULT_APPROLE_SECRET_ID")
	if v := os.Getenv("DR_VAULT_TRANSIT_PATH"); v != "" {
		cfg.VaultTransitPath = v
	}
	cfg.VaultNamespace = os.Getenv("DR_VAULT_NAMESPACE")

	if v := os.Getenv("DR_RECOVERY_DRIVER"); v != "" {
		cfg.RecoveryDriver = strings.ToLower(strings.TrimSpace(v))
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_CONFIG"); v != "" {
		if err := json.Unmarshal([]byte(v), &cfg.RecoveryProvider); err != nil {
			return nil, fmt.Errorf("invalid DR_RECOVERY_PROVIDER_CONFIG: %w", err)
		}
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER"); v != "" {
		cfg.RecoveryProvider.Kind = strings.ToLower(strings.TrimSpace(v))
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_ENDPOINT"); v != "" {
		cfg.RecoveryProvider.Endpoint = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_CREDENTIAL_REF"); v != "" {
		cfg.RecoveryProvider.CredentialRef = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_REGION"); v != "" {
		cfg.RecoveryProvider.Region = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_PROJECT"); v != "" {
		cfg.RecoveryProvider.Project = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_CLUSTER"); v != "" {
		cfg.RecoveryProvider.Cluster = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_DATACENTER"); v != "" {
		cfg.RecoveryProvider.Datacenter = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_RESOURCE_GROUP"); v != "" {
		cfg.RecoveryProvider.ResourceGroup = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_STORAGE_VM"); v != "" {
		cfg.RecoveryProvider.StorageVM = strings.TrimSpace(v)
	}
	// --- Vendor transit hardening (Wave 3) --------------------------------
	// PEM CONTENT env vars (never file paths), consistent with the rest of the
	// DR key-custody surface. They pin the gateway TLS trust, present an optional
	// mTLS client identity, and key the detached request-envelope signature.
	if v := os.Getenv("DR_RECOVERY_PROVIDER_CA_PEM"); v != "" {
		cfg.RecoveryProvider.CABundlePEM = v
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_CLIENT_CERT_PEM"); v != "" {
		cfg.RecoveryProvider.ClientCertPEM = v
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_CLIENT_KEY_PEM"); v != "" {
		cfg.RecoveryProvider.ClientKeyPEM = v
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_MIN_TLS"); v != "" {
		cfg.RecoveryProvider.MinTLSVersion = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_SIGNING_KEY_PEM"); v != "" {
		cfg.RecoveryProvider.SigningKeyPEM = v
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_SIGNING_KEY_ID"); v != "" {
		cfg.RecoveryProvider.SigningKeyID = strings.TrimSpace(v)
	}
	if v := os.Getenv("DR_RECOVERY_PROVIDER_SETTINGS"); v != "" {
		settings := map[string]string{}
		if cfg.RecoveryProvider.Settings != nil {
			for key, value := range cfg.RecoveryProvider.Settings {
				settings[key] = value
			}
		}
		if err := json.Unmarshal([]byte(v), &settings); err != nil {
			return nil, fmt.Errorf("invalid DR_RECOVERY_PROVIDER_SETTINGS: %w", err)
		}
		cfg.RecoveryProvider.Settings = settings
	}
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "gateway_url", "DR_RECOVERY_PROVIDER_GATEWAY_URL")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "token", "DR_RECOVERY_PROVIDER_TOKEN")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "bearer_token", "DR_RECOVERY_PROVIDER_BEARER_TOKEN")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "api_token", "DR_RECOVERY_PROVIDER_API_TOKEN")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "namespace", "DR_RECOVERY_PROVIDER_NAMESPACE")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "namespace_prefix", "DR_RECOVERY_PROVIDER_NAMESPACE_PREFIX")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "image", "DR_RECOVERY_PROVIDER_IMAGE")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "command", "DR_RECOVERY_PROVIDER_COMMAND")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "insecure_skip_tls_verify", "DR_RECOVERY_PROVIDER_INSECURE_SKIP_TLS_VERIFY")
	setRecoveryProviderSetting(&cfg.RecoveryProvider, "delete_namespace_on_teardown", "DR_RECOVERY_PROVIDER_DELETE_NAMESPACE_ON_TEARDOWN")
	if v := os.Getenv("DR_RECOVERY_COMMAND_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_RECOVERY_COMMAND_TIMEOUT %q: %w", v, err)
		}
		cfg.RecoveryCommandTimeout = d
	}
	if v := os.Getenv("DR_RECOVERY_ENSURE_COMMAND"); v != "" {
		cmd, err := parseCommandList(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_RECOVERY_ENSURE_COMMAND: %w", err)
		}
		cfg.RecoveryEnsureCommand = cmd
	}
	if v := os.Getenv("DR_RECOVERY_TEARDOWN_COMMAND"); v != "" {
		cmd, err := parseCommandList(v)
		if err != nil {
			return nil, fmt.Errorf("invalid DR_RECOVERY_TEARDOWN_COMMAND: %w", err)
		}
		cfg.RecoveryTeardownCommand = cmd
	}

	if v := os.Getenv("RECOVER_LICENSE_SERVICE_URL"); v != "" {
		cfg.LicenseServiceURL = strings.TrimSpace(v)
	} else if v := os.Getenv("GW_SVC_URL_LICENSE"); v != "" {
		cfg.LicenseServiceURL = strings.TrimSpace(v)
	}
	if v := os.Getenv("RECOVER_ENTITLEMENT_FAIL_OPEN"); v != "" {
		b, err := strconv.ParseBool(strings.TrimSpace(v))
		if err != nil {
			return nil, fmt.Errorf("invalid RECOVER_ENTITLEMENT_FAIL_OPEN %q: %w", v, err)
		}
		cfg.RecoverEntitlementFailOpen = b
	}
	if v := os.Getenv("RECOVER_ENTITLEMENT_TIMEOUT"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil {
			return nil, fmt.Errorf("invalid RECOVER_ENTITLEMENT_TIMEOUT %q: %w", v, err)
		}
		cfg.RecoverEntitlementTimeout = d
	}

	cfg.RehearsalProofSigningKeyPEM = os.Getenv("DR_REHEARSAL_PROOF_SIGNING_KEY_PEM")

	// --- BYOK sovereign key custody (sealed keystore) --------------------
	// The operator ROOT key seals every tenant KEK persistently. In production the
	// volatile in-memory keystore is FORBIDDEN: a restart would orphan every
	// wrapped DEK, so production must supply either a sealed root key
	// (DR_BYOK_ROOT_KEY) or a remote KMS endpoint (DR_BYOK_KMS_ENDPOINT). Fail
	// closed at load time so a misconfigured production deployment never boots.
	cfg.RootKeyB64 = os.Getenv("DR_BYOK_ROOT_KEY")
	if cfg.Environment == "production" {
		hasSealed := strings.TrimSpace(cfg.RootKeyB64) != ""
		hasRemote := strings.TrimSpace(os.Getenv("DR_BYOK_KMS_ENDPOINT")) != ""
		if !hasSealed && !hasRemote {
			return nil, fmt.Errorf("dr byok: production requires a sealed root key (DR_BYOK_ROOT_KEY) or a remote KMS endpoint (DR_BYOK_KMS_ENDPOINT); the in-memory keystore is forbidden in production")
		}
	}

	return cfg, nil
}

// Regulated reports whether this runtime should enforce the fail-closed
// regulated deployment profile.
func (c *Config) Regulated() bool {
	if c == nil {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(c.DeploymentProfile), "regulated") || c.RegulatedMode
}

// ValidationResult is the structured startup/readiness view of DR runtime
// configuration. Regulated deployments treat failed required checks as fatal.
type ValidationResult struct {
	Profile   string            `json:"profile"`
	Regulated bool              `json:"regulated"`
	Valid     bool              `json:"valid"`
	Checks    []ValidationCheck `json:"checks"`
}

// ValidationCheck captures one runtime posture check.
type ValidationCheck struct {
	Name     string   `json:"name"`
	Status   string   `json:"status"`
	Required bool     `json:"required"`
	Env      []string `json:"env,omitempty"`
	Message  string   `json:"message,omitempty"`
}

// Error returns a compact fatal startup message for regulated validation
// failures.
func (r ValidationResult) Error() string {
	var failed []string
	for _, check := range r.Checks {
		if check.Required && check.Status == "fail" {
			if check.Message != "" {
				failed = append(failed, check.Name+": "+check.Message)
			} else {
				failed = append(failed, check.Name)
			}
		}
	}
	if len(failed) == 0 {
		return ""
	}
	return fmt.Sprintf("regulated DR deployment profile is not satisfied: %s", strings.Join(failed, "; "))
}

// ValidateRuntime evaluates the fail-closed regulated profile. It only performs
// static configuration checks; dependency reachability remains covered by the
// normal readiness probes.
func ValidateRuntime(cfg *Config, base *appconfig.Config) ValidationResult {
	profile := "standard"
	if cfg != nil && strings.TrimSpace(cfg.DeploymentProfile) != "" {
		profile = strings.TrimSpace(cfg.DeploymentProfile)
	}
	result := ValidationResult{
		Profile:   profile,
		Regulated: cfg != nil && cfg.Regulated(),
		Valid:     true,
	}
	required := result.Regulated
	add := func(name string, ok bool, env []string, message string) {
		status := "pass"
		if !required {
			status = "skipped"
			message = "not required outside the regulated deployment profile"
		} else if !ok {
			status = "fail"
			result.Valid = false
		}
		result.Checks = append(result.Checks, ValidationCheck{
			Name:     name,
			Status:   status,
			Required: required,
			Env:      env,
			Message:  message,
		})
	}
	if cfg == nil {
		result.Valid = false
		result.Checks = append(result.Checks, ValidationCheck{
			Name:     "dr_config_loaded",
			Status:   "fail",
			Required: true,
			Message:  "DR config is not loaded",
		})
		return result
	}

	add("vault_transit", vaultTransitConfigured(cfg), []string{
		"DR_VAULT_ADDR", "DR_VAULT_AUTH_METHOD", "DR_VAULT_TOKEN",
		"DR_VAULT_APPROLE_ROLE_ID", "DR_VAULT_APPROLE_SECRET_ID", "DR_VAULT_TRANSIT_PATH",
	}, "Vault transit address, auth credentials, and transit path are required")
	add("minio_worm_store", minioWORMConfigured(cfg), []string{
		"DR_MINIO_ENDPOINT", "DR_MINIO_ACCESS_KEY", "DR_MINIO_SECRET_KEY", "DR_WORM_BUCKET",
	}, "MinIO endpoint, credentials, WORM bucket, and positive retention are required")
	add("redis_dependency", redisConfigured(base), []string{
		"REDIS_HOST", "REDIS_PORT",
	}, "Redis host and port are required for regulated leader election")
	add("kafka_dependency", kafkaConfigured(cfg), []string{
		"DR_KAFKA_BROKERS", "KAFKA_BROKERS", "DR_KAFKA_GROUP_ID",
	}, "Kafka brokers and DR consumer group are required")
	add("mtls_ingest_enabled", boolEnvEnabled("DR_MTLS_INGEST_ENABLED") && mtlsPathsConfigured(cfg), []string{
		"DR_MTLS_INGEST_ENABLED", "DR_MTLS_CA_BUNDLE_PATH", "DR_MTLS_SERVER_CERT_PATH", "DR_MTLS_SERVER_KEY_PATH",
	}, "mTLS ingest must be explicitly enabled with CA, server certificate, and key paths")
	add("failover_driver_enabled", boolEnvEnabled("DR_FAILOVER_DRIVER_ENABLED"), []string{
		"DR_FAILOVER_DRIVER_ENABLED",
	}, "failover driver must be explicitly enabled")
	add("integrations_encryption_key", integrationsKeyConfigured(), []string{
		"DR_INTEGRATIONS_ENC_KEY",
	}, "DR_INTEGRATIONS_ENC_KEY must be base64 and decode to 32 bytes")
	add("recovery_driver", recoveryDriverConfigured(cfg), []string{
		"DR_RECOVERY_DRIVER", "DR_RECOVERY_ENSURE_COMMAND", "DR_RECOVERY_TEARDOWN_COMMAND",
		"DR_RECOVERY_PROVIDER", "DR_RECOVERY_PROVIDER_CONFIG",
	}, "regulated mode requires a configured non-verify DR_RECOVERY_DRIVER")
	dataResidencyOK, dataResidencyMsg := dataResidencyConfigured(cfg)
	add("data_residency", dataResidencyOK, []string{
		"DR_RESIDENCY", "RESIDENCY", "SERVICE_REGION", "DR_WORM_REQUIRE_EXPLICIT_REGION", "DR_MINIO_REGION",
	}, dataResidencyMsg)

	// Vendor transit hardening gate (Wave 3): only meaningful when the recovery
	// driver delegates to a provider gateway (vsphere/cloud/netapp/provider).
	// The command/verify drivers do not open an outbound vendor channel.
	if providerGatewayDriver(cfg) {
		transitOK, transitMsg := providerTransitConfigured(cfg)
		add("provider_transit_hardening", transitOK, []string{
			"DR_RECOVERY_PROVIDER_ENDPOINT", "DR_RECOVERY_PROVIDER_GATEWAY_URL",
			"DR_RECOVERY_PROVIDER_CA_PEM", "DR_RECOVERY_PROVIDER_SIGNING_KEY_PEM",
			"DR_RECOVERY_PROVIDER_CLIENT_CERT_PEM", "DR_RECOVERY_PROVIDER_CLIENT_KEY_PEM",
			"DR_RECOVERY_PROVIDER_MIN_TLS",
		}, transitMsg)
	}

	return result
}

// providerGatewayDriver reports whether the configured recovery driver opens an
// outbound provider-gateway channel (vsphere/cloud/netapp, or the generic
// "provider" driver with a gateway-backed kind). Kubernetes talks to its own API
// server (its own TLS surface) and is not gated here.
func providerGatewayDriver(cfg *Config) bool {
	driver := strings.ToLower(strings.TrimSpace(cfg.RecoveryDriver))
	kind := strings.ToLower(strings.TrimSpace(cfg.RecoveryProvider.Kind))
	isGatewayKind := func(k string) bool {
		switch k {
		case drprovider.KindVSphere, drprovider.KindCloud, drprovider.KindNetApp:
			return true
		default:
			return false
		}
	}
	switch driver {
	case drprovider.KindVSphere, drprovider.KindCloud, drprovider.KindNetApp:
		return true
	case "provider":
		return isGatewayKind(kind)
	default:
		return false
	}
}

// providerTransitConfigured is the regulated-profile fail-closed vendor-transit
// gate. When the DR service delegates recovery to a provider gateway it must
// NOT be able to boot with:
//
//  1. a non-https (plaintext) gateway endpoint — regulated recovery envelopes
//     never travel in cleartext;
//  2. no pinned CA bundle (DR_RECOVERY_PROVIDER_CA_PEM) — an unpinned client
//     would trust the ambient system roots and could be MITM'd;
//  3. no detached-signing key (DR_RECOVERY_PROVIDER_SIGNING_KEY_PEM) — every
//     outbound operation must carry a verifiable signature; and
//  4. an incoherent mTLS pair — one of cert/key set without the other.
//
// It returns (ok, message); the message is the fatal reason on failure.
func providerTransitConfigured(cfg *Config) (bool, string) {
	p := cfg.RecoveryProvider
	endpoint := strings.TrimSpace(p.Endpoint)
	if p.Settings != nil {
		if gw := strings.TrimSpace(p.Settings["gateway_url"]); gw != "" {
			endpoint = gw
		}
	}
	if endpoint == "" {
		return false, "a provider gateway endpoint is required (DR_RECOVERY_PROVIDER_ENDPOINT or DR_RECOVERY_PROVIDER_GATEWAY_URL)"
	}
	if !strings.HasPrefix(strings.ToLower(endpoint), "https://") {
		return false, "the provider gateway endpoint must be https:// (plaintext http is refused); regulated recovery envelopes never travel in cleartext"
	}
	if strings.TrimSpace(p.CABundlePEM) == "" {
		return false, "a pinned CA bundle is required (DR_RECOVERY_PROVIDER_CA_PEM, PEM content); an unpinned client could be MITM'd via ambient system roots"
	}
	if strings.TrimSpace(p.SigningKeyPEM) == "" {
		return false, "a request-signing key is required (DR_RECOVERY_PROVIDER_SIGNING_KEY_PEM, PEM content); every outbound operation must carry a verifiable detached signature"
	}
	cert := strings.TrimSpace(p.ClientCertPEM)
	key := strings.TrimSpace(p.ClientKeyPEM)
	if (cert == "") != (key == "") {
		return false, "mTLS requires BOTH DR_RECOVERY_PROVIDER_CLIENT_CERT_PEM and DR_RECOVERY_PROVIDER_CLIENT_KEY_PEM (PEM content), or neither"
	}
	if v := strings.TrimSpace(p.MinTLSVersion); v != "" {
		switch v {
		case "1.2", "12", "TLS1.2", "tls1.2", "1.3", "13", "TLS1.3", "tls1.3":
		default:
			return false, fmt.Sprintf("DR_RECOVERY_PROVIDER_MIN_TLS=%q is invalid (want 1.2 or 1.3)", v)
		}
	}
	return true, ""
}

// dataResidencyConfigured is the regulated-profile fail-closed residency gate. A
// regulated deployment must NOT be able to boot with residency enforcement off,
// so it requires:
//
//  1. a non-empty residency region (DR_RESIDENCY / RESIDENCY / SERVICE_REGION) —
//     without it the data-plane guard and control-plane middleware are inert;
//  2. DR_WORM_REQUIRE_EXPLICIT_REGION=true — so an empty object-store region is a
//     hard error rather than silently defaulting to worm.DefaultRegion; and
//  3. where knowable (DR_MINIO_REGION set), the WORM bucket region must equal the
//     residency region — recovery bytes must land in-jurisdiction. When the MinIO
//     region is left empty, requirement (2) already forces it to be set explicitly
//     at client construction, so we do not fail here on an unset MinIO region.
//
// It returns (ok, message); the message is the fatal reason on failure.
func dataResidencyConfigured(cfg *Config) (bool, string) {
	region := strings.TrimSpace(cfg.ResidencyRegion)
	if region == "" {
		return false, "a residency region is required (set DR_RESIDENCY, RESIDENCY, or SERVICE_REGION); a regulated deployment must not run with data-residency enforcement off"
	}
	if !cfg.WORMRequireExplicitRegion {
		return false, "DR_WORM_REQUIRE_EXPLICIT_REGION=true is required so the WORM object-store region can never be implicitly defaulted"
	}
	if minioRegion := strings.TrimSpace(cfg.MinIORegion); minioRegion != "" &&
		!strings.EqualFold(minioRegion, region) {
		return false, fmt.Sprintf("WORM object-store region (DR_MINIO_REGION=%q) must equal the residency region (%q) so recovery data lands in-jurisdiction", minioRegion, region)
	}
	return true, ""
}

func vaultTransitConfigured(cfg *Config) bool {
	if cfg.VaultAddr == "" || cfg.VaultTransitPath == "" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(cfg.VaultAuthMethod)) {
	case "", "token":
		return cfg.VaultToken != ""
	case "approle":
		return cfg.VaultAppRoleRoleID != "" && cfg.VaultAppRoleSecretID != ""
	default:
		return false
	}
}

func minioWORMConfigured(cfg *Config) bool {
	return cfg.MinIOEndpoint != "" &&
		cfg.MinIOAccessKey != "" &&
		cfg.MinIOSecretKey != "" &&
		cfg.WORMBucket != "" &&
		cfg.RecoveryRetention > 0
}

func redisConfigured(base *appconfig.Config) bool {
	return base != nil && strings.TrimSpace(base.Redis.Host) != "" && base.Redis.Port > 0
}

func kafkaConfigured(cfg *Config) bool {
	return cfg.KafkaGroupID != "" && len(cfg.KafkaBrokers) > 0
}

func mtlsPathsConfigured(cfg *Config) bool {
	return cfg.MTLSCABundlePath != "" && cfg.MTLSServerCertPath != "" && cfg.MTLSServerKeyPath != ""
}

func integrationsKeyConfigured() bool {
	raw := os.Getenv("DR_INTEGRATIONS_ENC_KEY")
	if raw == "" {
		return false
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	return err == nil && len(key) == 32
}

func recoveryDriverConfigured(cfg *Config) bool {
	driver := strings.ToLower(strings.TrimSpace(cfg.RecoveryDriver))
	switch driver {
	case "", "verify":
		return false
	case "command":
		return len(cfg.RecoveryEnsureCommand) > 0 &&
			len(cfg.RecoveryTeardownCommand) > 0 &&
			cfg.RecoveryCommandTimeout > 0
	case "provider":
		return strings.TrimSpace(cfg.RecoveryProvider.Kind) != ""
	default:
		return true
	}
}

func setRecoveryProviderSetting(cfg *drprovider.Config, key, envKey string) {
	if cfg == nil {
		return
	}
	value := strings.TrimSpace(os.Getenv(envKey))
	if value == "" {
		return
	}
	if cfg.Settings == nil {
		cfg.Settings = map[string]string{}
	}
	cfg.Settings[key] = value
}

func boolEnvEnabled(key string) bool {
	enabled, err := strconv.ParseBool(strings.TrimSpace(os.Getenv(key)))
	return err == nil && enabled
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

func firstEnv(names ...string) (string, string) {
	for _, name := range names {
		if v := os.Getenv(name); v != "" {
			return name, v
		}
	}
	return "", ""
}

func parseCommandList(raw string) ([]string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var parts []string
	if strings.HasPrefix(raw, "[") {
		if err := json.Unmarshal([]byte(raw), &parts); err != nil {
			return nil, fmt.Errorf("expected JSON argv array: %w", err)
		}
	} else {
		parts = strings.Fields(raw)
	}
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("command is empty")
	}
	return out, nil
}
