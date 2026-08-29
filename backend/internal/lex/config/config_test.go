package config

import (
	"strings"
	"testing"
	"time"

	appconfig "github.com/clario360/platform/internal/config"
)

func TestSupportExpiryIntervalDefaultsToFiveMinutes(t *testing.T) {
	t.Parallel()

	if got := Default().SupportExpiryInterval; got != 5*time.Minute {
		t.Fatalf("SupportExpiryInterval = %s, want 5m", got)
	}
}

func TestLoadReadsSupportExpiryInterval(t *testing.T) {
	t.Setenv("LEX_ENVIRONMENT", "development")
	t.Setenv("LEX_SUPPORT_EXPIRY_INTERVAL", "7m")

	base := &appconfig.Config{
		Database: appconfig.DatabaseConfig{
			Host: "localhost", Port: 5432, User: "test", Password: "test",
			SSLMode: "disable", MaxOpenConns: 20, MaxIdleConns: 5,
		},
		Redis: appconfig.RedisConfig{Host: "localhost", Port: 6379},
	}
	cfg, err := Load(base)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.SupportExpiryInterval != 7*time.Minute {
		t.Fatalf("SupportExpiryInterval = %s, want 7m", cfg.SupportExpiryInterval)
	}
}

func TestLoadRejectsNonPositiveSupportExpiryInterval(t *testing.T) {
	t.Setenv("LEX_ENVIRONMENT", "development")
	t.Setenv("LEX_SUPPORT_EXPIRY_INTERVAL", "0s")

	base := &appconfig.Config{
		Database: appconfig.DatabaseConfig{
			Host: "localhost", Port: 5432, User: "test", Password: "test",
			SSLMode: "disable", MaxOpenConns: 20, MaxIdleConns: 5,
		},
		Redis: appconfig.RedisConfig{Host: "localhost", Port: 6379},
	}
	_, err := Load(base)
	if err == nil || !strings.Contains(err.Error(), "scheduler intervals") {
		t.Fatalf("Load() error = %v, want scheduler interval validation error", err)
	}
}

func TestValidateRequiresApprovalAuthorityRootsInProtectedProfiles(t *testing.T) {
	t.Parallel()

	for _, environment := range []string{"production", "staging", "uat", "prodution"} {
		environment := environment
		t.Run(environment, func(t *testing.T) {
			t.Parallel()

			cfg := Default()
			cfg.Environment = environment
			cfg.ContractFieldEncryptionKeyB64 = "configured-by-secret-store"

			err := cfg.Validate()
			if err == nil {
				t.Fatal("Validate() error = nil, want missing approval authority roots error")
			}
			if !strings.Contains(err.Error(), "LEX_APPROVAL_AUTHORITY_TRUSTED_ROOTS") {
				t.Fatalf("Validate() error = %q, want approval authority roots error", err)
			}
		})
	}
}

func TestLoadRejectsNonPositiveIntegrationRotationInterval(t *testing.T) {
	t.Setenv("LEX_ENVIRONMENT", "development")
	t.Setenv("LEX_INTEGRATION_ROTATION_INTERVAL", "-1s")

	base := &appconfig.Config{
		Database: appconfig.DatabaseConfig{
			Host: "localhost", Port: 5432, User: "test", Password: "test",
			SSLMode: "disable", MaxOpenConns: 20, MaxIdleConns: 5,
		},
		Redis: appconfig.RedisConfig{Host: "localhost", Port: 6379},
	}

	_, err := Load(base)
	if err == nil || !strings.Contains(err.Error(), "scheduler intervals") {
		t.Fatalf("Load() error = %v, want scheduler interval validation error", err)
	}
}

func TestValidateAllowsMissingApprovalAuthorityRootsInDevelopment(t *testing.T) {
	t.Parallel()

	cfg := Default()
	cfg.Environment = "development"
	cfg.ContractFieldEncryptionKeyB64 = ""

	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
	if cfg.ContractFieldEncryptionMode != "off" {
		t.Fatalf("ContractFieldEncryptionMode = %q, want off for keyless development", cfg.ContractFieldEncryptionMode)
	}
}

func TestValidateAllowsConfiguredSecurityControlsInProduction(t *testing.T) {
	t.Parallel()

	cfg := Default()
	cfg.Environment = "production"
	cfg.ContractFieldEncryptionKeyB64 = "configured-by-secret-store"
	cfg.ApprovalAuthorityTrustedRootsPEM = "configured-by-secret-store"

	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
}

func TestDefaultSeparatesInteractiveDraftingModelFromProviderDefault(t *testing.T) {
	t.Parallel()

	cfg := Default()
	if cfg.LLMInteractiveDraftingModel != "claude-sonnet-5" {
		t.Fatalf("LLMInteractiveDraftingModel = %q, want claude-sonnet-5", cfg.LLMInteractiveDraftingModel)
	}
	if cfg.LLMMaxTokens != 4096 {
		t.Fatalf("LLMMaxTokens = %d, want unchanged review budget 4096", cfg.LLMMaxTokens)
	}
}
