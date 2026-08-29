package config

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	appconfig "github.com/clario360/platform/internal/config"
)

func TestDefaultRuntimePortsAndRecoveryStore(t *testing.T) {
	cfg := Default()

	require.Equal(t, 8097, cfg.HTTPPort)
	require.Equal(t, 9097, cfg.AdminPort)
	require.Equal(t, ":8098", cfg.MTLSListenAddr)
	require.Equal(t, "dr-recovery-points", cfg.WORMBucket)
	require.Equal(t, 7*24*time.Hour, cfg.RecoveryRetention)
	require.Equal(t, 3, cfg.LegalHoldCount)
}

func TestLoadEnrollmentSignerAndCRLConfig(t *testing.T) {
	t.Setenv("DR_MTLS_CRL_REFRESH", "2m")
	t.Setenv("DR_ENROLL_TOKEN_KEY_NAME", "dr-k2")
	t.Setenv("DR_ENROLL_TOKEN_PRIVATE_KEY_PATH", "/var/run/secrets/dr/enroll.pem")
	t.Setenv("DR_ENROLL_TOKEN_ALLOW_EPHEMERAL", "true")

	cfg, err := Load(&appconfig.Config{})
	require.NoError(t, err)
	require.Equal(t, 2*time.Minute, cfg.MTLSCRLRefresh)
	require.Equal(t, "dr-k2", cfg.EnrollTokenKeyName)
	require.Equal(t, "/var/run/secrets/dr/enroll.pem", cfg.EnrollTokenPrivateKeyPath)
	require.True(t, cfg.AllowEphemeralEnrollKey)
}

func TestLoadSupportsLegacyCRLCacheTTLName(t *testing.T) {
	t.Setenv("DR_CRL_CACHE_TTL", "3m")

	cfg, err := Load(&appconfig.Config{})
	require.NoError(t, err)
	require.Equal(t, 3*time.Minute, cfg.MTLSCRLRefresh)
}

func TestLoadPrefersMTLSCRLRefreshOverLegacyName(t *testing.T) {
	t.Setenv("DR_MTLS_CRL_REFRESH", "2m")
	t.Setenv("DR_CRL_CACHE_TTL", "3m")

	cfg, err := Load(&appconfig.Config{})
	require.NoError(t, err)
	require.Equal(t, 2*time.Minute, cfg.MTLSCRLRefresh)
}

func TestLoadRejectsInvalidEnrollmentEphemeralFlag(t *testing.T) {
	t.Setenv("DR_ENROLL_TOKEN_ALLOW_EPHEMERAL", "definitely")

	_, err := Load(&appconfig.Config{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "DR_ENROLL_TOKEN_ALLOW_EPHEMERAL")
}

func TestLoadRecoveryProviderConfig(t *testing.T) {
	t.Setenv("DR_RECOVERY_DRIVER", "provider")
	t.Setenv("DR_RECOVERY_PROVIDER_CONFIG", `{"kind":"kubernetes","endpoint":"https://k8s.example","credential_ref":"vault:dr/k8s","settings":{"namespace":"dr"}}`)
	t.Setenv("DR_RECOVERY_PROVIDER_CLUSTER", "prod-dr")
	t.Setenv("DR_RECOVERY_PROVIDER_SETTINGS", `{"image":"registry.example/recover:1"}`)
	t.Setenv("DR_RECOVERY_PROVIDER_TOKEN", "test-token")

	cfg, err := Load(&appconfig.Config{})
	require.NoError(t, err)
	require.Equal(t, "provider", cfg.RecoveryDriver)
	require.Equal(t, "kubernetes", cfg.RecoveryProvider.Kind)
	require.Equal(t, "https://k8s.example", cfg.RecoveryProvider.Endpoint)
	require.Equal(t, "vault:dr/k8s", cfg.RecoveryProvider.CredentialRef)
	require.Equal(t, "prod-dr", cfg.RecoveryProvider.Cluster)
	require.Equal(t, "dr", cfg.RecoveryProvider.Settings["namespace"])
	require.Equal(t, "registry.example/recover:1", cfg.RecoveryProvider.Settings["image"])
	require.Equal(t, "test-token", cfg.RecoveryProvider.Settings["token"])
}

func TestLoadRegulatedProfileSwitches(t *testing.T) {
	t.Setenv("DR_DEPLOYMENT_PROFILE", "regulated")

	cfg, err := Load(&appconfig.Config{})
	require.NoError(t, err)
	require.True(t, cfg.Regulated())

	t.Setenv("DR_DEPLOYMENT_PROFILE", "")
	t.Setenv("DR_REGULATED_MODE", "true")

	cfg, err = Load(&appconfig.Config{})
	require.NoError(t, err)
	require.True(t, cfg.Regulated())
}

func TestLoadRejectsInvalidRegulatedModeFlag(t *testing.T) {
	t.Setenv("DR_REGULATED_MODE", "maybe")

	_, err := Load(&appconfig.Config{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "DR_REGULATED_MODE")
}

func TestValidateRuntimeNonRegulatedSkipsFailClosedChecks(t *testing.T) {
	result := ValidateRuntime(Default(), &appconfig.Config{})

	require.True(t, result.Valid)
	require.False(t, result.Regulated)
	require.NotEmpty(t, result.Checks)
	for _, check := range result.Checks {
		require.False(t, check.Required)
		require.Equal(t, "skipped", check.Status)
	}
}

func TestValidateRuntimeRegulatedFailsClosedOnMissingDependencies(t *testing.T) {
	cfg := Default()
	cfg.DeploymentProfile = "regulated"

	result := ValidateRuntime(cfg, &appconfig.Config{})

	require.False(t, result.Valid)
	require.True(t, result.Regulated)
	require.Contains(t, result.Error(), "regulated DR deployment profile")
	requireCheckStatus(t, result, "vault_transit", "fail")
	requireCheckStatus(t, result, "minio_worm_store", "fail")
	requireCheckStatus(t, result, "mtls_ingest_enabled", "fail")
	requireCheckStatus(t, result, "failover_driver_enabled", "fail")
	requireCheckStatus(t, result, "integrations_encryption_key", "fail")
	requireCheckStatus(t, result, "recovery_driver", "fail")
}

func TestValidateRuntimeRegulatedAcceptsLockedCommandProfile(t *testing.T) {
	t.Setenv("DR_MTLS_INGEST_ENABLED", "true")
	t.Setenv("DR_FAILOVER_DRIVER_ENABLED", "true")
	t.Setenv("DR_INTEGRATIONS_ENC_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))

	cfg := Default()
	cfg.DeploymentProfile = "regulated"
	cfg.KafkaBrokers = []string{"kafka:9092"}
	cfg.MTLSCABundlePath = "/etc/clario-dr/mtls/ca.crt"
	cfg.MTLSServerCertPath = "/etc/clario-dr/mtls/tls.crt"
	cfg.MTLSServerKeyPath = "/etc/clario-dr/mtls/tls.key"
	cfg.MinIOEndpoint = "minio:9000"
	cfg.MinIOAccessKey = "dr"
	cfg.MinIOSecretKey = "secret"
	// Wave 1: a fully-configured regulated profile must bind data-residency —
	// a region, explicit-region enforcement, and an in-jurisdiction bucket region.
	cfg.ResidencyRegion = "me-central-1"
	cfg.WORMRequireExplicitRegion = true
	cfg.MinIORegion = "me-central-1"
	cfg.VaultAddr = "https://vault:8200"
	cfg.VaultAuthMethod = "approle"
	cfg.VaultAppRoleRoleID = "role-id"
	cfg.VaultAppRoleSecretID = "secret-id"
	cfg.RecoveryDriver = "command"
	cfg.RecoveryEnsureCommand = []string{"/opt/clario/dr-provisioner", "ensure"}
	cfg.RecoveryTeardownCommand = []string{"/opt/clario/dr-provisioner", "teardown"}

	base := &appconfig.Config{}
	base.Redis.Host = "redis"
	base.Redis.Port = 6379

	result := ValidateRuntime(cfg, base)

	require.True(t, result.Valid)
	require.True(t, result.Regulated)
	require.Empty(t, result.Error())
	for _, check := range result.Checks {
		require.True(t, check.Required)
		require.Equal(t, "pass", check.Status, check.Name)
	}
}

// TestValidateRuntimeRegulatedFailsClosedOnEmptyResidencyRegion proves the
// regulated profile REFUSES to validate when no data-residency region is
// configured — a regulated deployment must never boot with residency
// enforcement off. This is the config-side half of the Wave 1 residency gate.
func TestValidateRuntimeRegulatedFailsClosedOnEmptyResidencyRegion(t *testing.T) {
	cfg := Default()
	cfg.DeploymentProfile = "regulated"
	// Everything else may be present, but the residency region is empty.
	cfg.ResidencyRegion = ""
	cfg.WORMRequireExplicitRegion = true

	result := ValidateRuntime(cfg, &appconfig.Config{})

	require.False(t, result.Valid, "regulated profile must be invalid with an empty residency region")
	require.True(t, result.Regulated)
	requireCheckStatus(t, result, "data_residency", "fail")
	require.Contains(t, result.Error(), "data_residency")
	require.Contains(t, result.Error(), "residency region is required")
}

// TestValidateRuntimeRegulatedRequiresExplicitWORMRegion proves that even with a
// residency region set, the regulated profile fails closed unless
// DR_WORM_REQUIRE_EXPLICIT_REGION is on (so the object-store region can never be
// implicitly defaulted).
func TestValidateRuntimeRegulatedRequiresExplicitWORMRegion(t *testing.T) {
	cfg := Default()
	cfg.DeploymentProfile = "regulated"
	cfg.ResidencyRegion = "me-central-1"
	cfg.WORMRequireExplicitRegion = false // the gap

	result := ValidateRuntime(cfg, &appconfig.Config{})

	require.False(t, result.Valid)
	requireCheckStatus(t, result, "data_residency", "fail")
	require.Contains(t, result.Error(), "DR_WORM_REQUIRE_EXPLICIT_REGION")
}

// TestValidateRuntimeRegulatedRejectsBucketRegionMismatch proves that a WORM
// bucket region that differs from the residency region is rejected — recovery
// bytes must land in-jurisdiction.
func TestValidateRuntimeRegulatedRejectsBucketRegionMismatch(t *testing.T) {
	cfg := Default()
	cfg.DeploymentProfile = "regulated"
	cfg.ResidencyRegion = "me-central-1"
	cfg.WORMRequireExplicitRegion = true
	cfg.MinIORegion = "eu-west-1" // out-of-jurisdiction bucket

	result := ValidateRuntime(cfg, &appconfig.Config{})

	require.False(t, result.Valid)
	requireCheckStatus(t, result, "data_residency", "fail")
	require.Contains(t, result.Error(), "in-jurisdiction")
}

// TestValidateRuntimeRegulatedPassesWithResidencyConfigured proves the
// data_residency gate PASSES once a region, explicit-region enforcement, and a
// matching bucket region are all configured — the gate is not merely always-fail.
func TestValidateRuntimeRegulatedPassesWithResidencyConfigured(t *testing.T) {
	cfg := Default()
	cfg.DeploymentProfile = "regulated"
	cfg.ResidencyRegion = "me-central-1"
	cfg.WORMRequireExplicitRegion = true
	cfg.MinIORegion = "me-central-1"

	result := ValidateRuntime(cfg, &appconfig.Config{})

	// Other regulated checks (vault/minio/etc) are still unmet here, so overall
	// Valid stays false — but the data_residency check itself must PASS.
	requireCheckStatus(t, result, "data_residency", "pass")
}

// TestLoadResidencyRegionEnvAliases proves the residency region is read from the
// DOCUMENTED env names (DR_RESIDENCY preferred, then RESIDENCY) and falls back to
// SERVICE_REGION — closing the runbook-vs-code naming mismatch.
func TestLoadResidencyRegionEnvAliases(t *testing.T) {
	t.Run("DR_RESIDENCY preferred", func(t *testing.T) {
		t.Setenv("DR_RESIDENCY", "me-central-1")
		t.Setenv("RESIDENCY", "should-be-ignored")
		cfg, err := Load(&appconfig.Config{})
		require.NoError(t, err)
		require.Equal(t, "me-central-1", cfg.ResidencyRegion)
		require.Equal(t, "DR_RESIDENCY", cfg.ResidencyRegionSource)
	})

	t.Run("RESIDENCY fallback", func(t *testing.T) {
		t.Setenv("RESIDENCY", "me-central-1")
		cfg, err := Load(&appconfig.Config{})
		require.NoError(t, err)
		require.Equal(t, "me-central-1", cfg.ResidencyRegion)
		require.Equal(t, "RESIDENCY", cfg.ResidencyRegionSource)
	})

	t.Run("SERVICE_REGION legacy fallback", func(t *testing.T) {
		base := &appconfig.Config{}
		base.Residency.ServiceRegion = "ksa-central"
		cfg, err := Load(base)
		require.NoError(t, err)
		require.Equal(t, "ksa-central", cfg.ResidencyRegion)
		require.Equal(t, "SERVICE_REGION", cfg.ResidencyRegionSource)
	})

	t.Run("unset disables (empty region)", func(t *testing.T) {
		cfg, err := Load(&appconfig.Config{})
		require.NoError(t, err)
		require.Empty(t, cfg.ResidencyRegion)
	})
}

// --- Wave 3 vendor-transit config gate ---------------------------------------

func TestLoadRecoveryProviderTransitPEMEnv(t *testing.T) {
	t.Setenv("DR_RECOVERY_DRIVER", "provider")
	t.Setenv("DR_RECOVERY_PROVIDER", "vsphere")
	t.Setenv("DR_RECOVERY_PROVIDER_ENDPOINT", "https://gw.internal")
	t.Setenv("DR_RECOVERY_PROVIDER_CA_PEM", "-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----")
	t.Setenv("DR_RECOVERY_PROVIDER_CLIENT_CERT_PEM", "-----BEGIN CERTIFICATE-----\nCLI\n-----END CERTIFICATE-----")
	t.Setenv("DR_RECOVERY_PROVIDER_CLIENT_KEY_PEM", "-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----")
	t.Setenv("DR_RECOVERY_PROVIDER_MIN_TLS", "1.3")
	t.Setenv("DR_RECOVERY_PROVIDER_SIGNING_KEY_PEM", "-----BEGIN PRIVATE KEY-----\nSIGN\n-----END PRIVATE KEY-----")
	t.Setenv("DR_RECOVERY_PROVIDER_SIGNING_KEY_ID", "dr-key-1")

	cfg, err := Load(&appconfig.Config{})
	require.NoError(t, err)
	require.Contains(t, cfg.RecoveryProvider.CABundlePEM, "CA")
	require.Contains(t, cfg.RecoveryProvider.ClientCertPEM, "CLI")
	require.Contains(t, cfg.RecoveryProvider.ClientKeyPEM, "KEY")
	require.Equal(t, "1.3", cfg.RecoveryProvider.MinTLSVersion)
	require.Contains(t, cfg.RecoveryProvider.SigningKeyPEM, "SIGN")
	require.Equal(t, "dr-key-1", cfg.RecoveryProvider.SigningKeyID)
}

// regulatedProviderBase returns a regulated config whose non-transit gates are
// all satisfied, with the recovery driver delegating to a provider gateway, so a
// test can isolate the provider_transit_hardening check.
func regulatedProviderBase() (*Config, *appconfig.Config) {
	cfg := Default()
	cfg.DeploymentProfile = "regulated"
	cfg.KafkaBrokers = []string{"kafka:9092"}
	cfg.MTLSCABundlePath = "/etc/dr/ca.crt"
	cfg.MTLSServerCertPath = "/etc/dr/tls.crt"
	cfg.MTLSServerKeyPath = "/etc/dr/tls.key"
	cfg.MinIOEndpoint = "minio:9000"
	cfg.MinIOAccessKey = "dr"
	cfg.MinIOSecretKey = "secret"
	cfg.ResidencyRegion = "me-central-1"
	cfg.WORMRequireExplicitRegion = true
	cfg.MinIORegion = "me-central-1"
	cfg.VaultAddr = "https://vault:8200"
	cfg.VaultAuthMethod = "approle"
	cfg.VaultAppRoleRoleID = "role-id"
	cfg.VaultAppRoleSecretID = "secret-id"
	cfg.RecoveryDriver = "provider"
	cfg.RecoveryProvider.Kind = "vsphere"
	base := &appconfig.Config{}
	base.Redis.Host = "redis"
	base.Redis.Port = 6379
	return cfg, base
}

func TestValidateRuntimeRegulatedProviderTransitFailsClosed(t *testing.T) {
	t.Setenv("DR_MTLS_INGEST_ENABLED", "true")
	t.Setenv("DR_FAILOVER_DRIVER_ENABLED", "true")
	t.Setenv("DR_INTEGRATIONS_ENC_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))

	t.Run("plaintext endpoint fails", func(t *testing.T) {
		cfg, base := regulatedProviderBase()
		cfg.RecoveryProvider.Endpoint = "http://gw.internal"
		cfg.RecoveryProvider.CABundlePEM = "ca"
		cfg.RecoveryProvider.SigningKeyPEM = "sign"
		result := ValidateRuntime(cfg, base)
		require.False(t, result.Valid)
		requireCheckStatus(t, result, "provider_transit_hardening", "fail")
		require.Contains(t, result.Error(), "https")
	})

	t.Run("missing pinned CA fails", func(t *testing.T) {
		cfg, base := regulatedProviderBase()
		cfg.RecoveryProvider.Endpoint = "https://gw.internal"
		cfg.RecoveryProvider.SigningKeyPEM = "sign"
		result := ValidateRuntime(cfg, base)
		require.False(t, result.Valid)
		requireCheckStatus(t, result, "provider_transit_hardening", "fail")
		require.Contains(t, result.Error(), "pinned CA")
	})

	t.Run("missing signing key fails", func(t *testing.T) {
		cfg, base := regulatedProviderBase()
		cfg.RecoveryProvider.Endpoint = "https://gw.internal"
		cfg.RecoveryProvider.CABundlePEM = "ca"
		result := ValidateRuntime(cfg, base)
		require.False(t, result.Valid)
		requireCheckStatus(t, result, "provider_transit_hardening", "fail")
		require.Contains(t, result.Error(), "signing")
	})

	t.Run("incoherent mTLS pair fails", func(t *testing.T) {
		cfg, base := regulatedProviderBase()
		cfg.RecoveryProvider.Endpoint = "https://gw.internal"
		cfg.RecoveryProvider.CABundlePEM = "ca"
		cfg.RecoveryProvider.SigningKeyPEM = "sign"
		cfg.RecoveryProvider.ClientCertPEM = "cert" // key missing
		result := ValidateRuntime(cfg, base)
		require.False(t, result.Valid)
		requireCheckStatus(t, result, "provider_transit_hardening", "fail")
		require.Contains(t, result.Error(), "mTLS")
	})
}

func TestValidateRuntimeRegulatedProviderTransitPasses(t *testing.T) {
	t.Setenv("DR_MTLS_INGEST_ENABLED", "true")
	t.Setenv("DR_FAILOVER_DRIVER_ENABLED", "true")
	t.Setenv("DR_INTEGRATIONS_ENC_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))

	cfg, base := regulatedProviderBase()
	cfg.RecoveryProvider.Endpoint = "https://gw.internal"
	cfg.RecoveryProvider.CABundlePEM = "ca"
	cfg.RecoveryProvider.SigningKeyPEM = "sign"
	cfg.RecoveryProvider.ClientCertPEM = "cert"
	cfg.RecoveryProvider.ClientKeyPEM = "key"
	cfg.RecoveryProvider.MinTLSVersion = "1.3"

	result := ValidateRuntime(cfg, base)
	require.True(t, result.Valid, result.Error())
	require.True(t, result.Regulated)
	requireCheckStatus(t, result, "provider_transit_hardening", "pass")
}

// A non-gateway driver (command) must NOT introduce the provider_transit check.
func TestValidateRuntimeCommandDriverSkipsProviderTransit(t *testing.T) {
	cfg, base := regulatedProviderBase()
	cfg.RecoveryDriver = "command"
	cfg.RecoveryProvider.Kind = ""
	result := ValidateRuntime(cfg, base)
	for _, c := range result.Checks {
		if c.Name == "provider_transit_hardening" {
			t.Fatalf("provider_transit_hardening must not apply to the command driver")
		}
	}
}

func requireCheckStatus(t *testing.T, result ValidationResult, name string, status string) {
	t.Helper()
	for _, check := range result.Checks {
		if check.Name == name {
			require.Equal(t, status, check.Status)
			return
		}
	}
	t.Fatalf("check %q not found", name)
}
