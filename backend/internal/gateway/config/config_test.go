package config

import (
	"os"
	"strings"
	"testing"
)

func clearGatewayEnv(t *testing.T) {
	t.Helper()
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || !strings.HasPrefix(key, "GW_") {
			continue
		}
		restoreKey := key
		restoreValue := value
		if err := os.Unsetenv(key); err != nil {
			t.Fatalf("unset %s: %v", key, err)
		}
		t.Cleanup(func() {
			if err := os.Setenv(restoreKey, restoreValue); err != nil {
				t.Fatalf("restore %s: %v", restoreKey, err)
			}
		})
	}
}

func TestLoad_DefaultProductionEntitlementFailsClosed(t *testing.T) {
	clearGatewayEnv(t)

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if !cfg.IsProduction() {
		t.Fatalf("environment = %q, want production", cfg.Environment)
	}
	if !cfg.EntitlementEnabled {
		t.Fatal("entitlement enforcement must default to enabled")
	}
	if cfg.EntitlementFailOpen {
		t.Fatal("production entitlement enforcement must default to fail-closed")
	}
}

func TestLoad_DevelopmentEntitlementDefaultsFailOpen(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GW_ENVIRONMENT", "development")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.EntitlementFailOpen != true {
		t.Fatal("development entitlement enforcement should default to fail-open")
	}
}

func TestLoad_ProductionRejectsFailOpenEntitlement(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GW_ENTITLEMENT_FAIL_OPEN", "true")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want production fail-open rejection")
	}
	if !strings.Contains(err.Error(), "GW_ENTITLEMENT_FAIL_OPEN") {
		t.Fatalf("Load() error = %v, want GW_ENTITLEMENT_FAIL_OPEN validation", err)
	}
}

func TestLoad_ProdAliasRejectsFailOpenEntitlement(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GW_ENVIRONMENT", "prod")
	t.Setenv("GW_ENTITLEMENT_FAIL_OPEN", "true")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want prod fail-open rejection")
	}
	if !strings.Contains(err.Error(), "GW_ENTITLEMENT_FAIL_OPEN") {
		t.Fatalf("Load() error = %v, want GW_ENTITLEMENT_FAIL_OPEN validation", err)
	}
}

func TestLoad_StagingRejectsFailOpenEntitlement(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GW_ENVIRONMENT", "staging")
	t.Setenv("GW_ENTITLEMENT_FAIL_OPEN", "true")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want staging fail-open rejection")
	}
	if !strings.Contains(err.Error(), "GW_ENTITLEMENT_FAIL_OPEN") {
		t.Fatalf("Load() error = %v, want GW_ENTITLEMENT_FAIL_OPEN validation", err)
	}
}

func TestLoad_ProductionRejectsDisabledEntitlement(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GW_ENTITLEMENT_ENABLED", "false")

	_, err := Load()
	if err == nil {
		t.Fatal("Load() error = nil, want production disabled-entitlement rejection")
	}
	if !strings.Contains(err.Error(), "GW_ENTITLEMENT_ENABLED") {
		t.Fatalf("Load() error = %v, want GW_ENTITLEMENT_ENABLED validation", err)
	}
}

func TestLoad_LocalMayDisableEntitlementAndFailOpen(t *testing.T) {
	clearGatewayEnv(t)
	t.Setenv("GW_ENVIRONMENT", "local")
	t.Setenv("GW_ENTITLEMENT_ENABLED", "false")
	t.Setenv("GW_ENTITLEMENT_FAIL_OPEN", "true")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.EntitlementEnabled {
		t.Fatal("local config should allow disabling entitlement enforcement")
	}
	if !cfg.EntitlementFailOpen {
		t.Fatal("local config should allow fail-open entitlement enforcement")
	}
}
