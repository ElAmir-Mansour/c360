//go:build integration

package sources

import (
	"os"
	"testing"
)

// Integration tests are gated by both the `integration` build tag and
// the SIEM_INTEGRATION_SOURCES=1 environment variable so they don't
// run by accident on a developer laptop missing Postgres / Redis /
// Vault. Phase 4 will run these live against the dev stack.
func skipUnlessIntegration(t *testing.T) {
	t.Helper()
	if os.Getenv("SIEM_INTEGRATION_SOURCES") != "1" {
		t.Skip("set SIEM_INTEGRATION_SOURCES=1 to run integration tests")
	}
}

// The actual test bodies live below. Each is intentionally a
// scaffold that Phase 4 fleshes out against a testcontainers stack
// (Postgres + Redis + Kafka + Vault dev + IAM stub + WS subscriber).
// The function signatures and names are part of the contract; do
// NOT rename them without updating REGRESSION.md.

func TestIntegration_FullOnboardingFlow(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}

func TestIntegration_ReplayAttack(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}

func TestIntegration_CrossTenantAttack(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}

func TestIntegration_RotationOverlap(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}

func TestIntegration_SilentDetection(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}

func TestIntegration_Recovery(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}

func TestIntegration_CertExpiry(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}

func TestIntegration_SoftDeleteRevokes(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}

func TestIntegration_LeaderElection(t *testing.T) {
	skipUnlessIntegration(t)
	t.Skip("Phase 4 runs this against the dev stack")
}
