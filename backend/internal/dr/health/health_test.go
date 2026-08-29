package health

import (
	"context"
	"errors"
	"testing"
	"time"

	drconfig "github.com/clario360/platform/internal/dr/config"
	obshealth "github.com/clario360/platform/internal/observability/health"
)

func TestReadinessCompositeIncludesRecoveryPointDependencies(t *testing.T) {
	vault := stubChecker{name: "vault_transit"}
	store := &stubWORMStore{bucket: "dr-recovery-points"}
	checkers := append(Checkers(nil, nil), RecoveryPointCheckers(store, "minio:9000", vault)...)

	result := obshealth.NewCompositeHealthChecker(time.Second, checkers...).CheckAll(context.Background())

	if result.Status != "healthy" {
		t.Fatalf("status = %q, want healthy: %+v", result.Status, result)
	}
	if _, ok := result.Checks["vault_transit"]; !ok {
		t.Fatalf("checks = %+v, want vault_transit", result.Checks)
	}
	if _, ok := result.Checks["minio_object_lock"]; !ok {
		t.Fatalf("checks = %+v, want minio_object_lock", result.Checks)
	}
	if store.ensureCalls != 1 {
		t.Fatalf("EnsureBucket calls = %d, want 1", store.ensureCalls)
	}
}

func TestRecoveryPointCheckersIncludeVaultAndWORM(t *testing.T) {
	t.Parallel()
	vault := stubChecker{name: "vault_transit"}
	store := &stubWORMStore{bucket: "dr-recovery-points"}

	checkers := RecoveryPointCheckers(store, "minio:9000", vault)
	if len(checkers) != 2 {
		t.Fatalf("checkers = %d, want 2", len(checkers))
	}
	if checkers[0].Name() != "vault_transit" {
		t.Fatalf("first checker = %q, want vault_transit", checkers[0].Name())
	}
	if checkers[1].Name() != "minio_object_lock" {
		t.Fatalf("second checker = %q, want minio_object_lock", checkers[1].Name())
	}
}

func TestWORMBucketHealthChecker(t *testing.T) {
	t.Parallel()
	store := &stubWORMStore{bucket: "dr-recovery-points"}
	checker := NewWORMBucketHealthChecker(store, "minio:9000")

	result := checker.Check(context.Background())
	if result.Status != "healthy" {
		t.Fatalf("status = %q, want healthy: %+v", result.Status, result)
	}
	if store.ensureCalls != 1 {
		t.Fatalf("EnsureBucket calls = %d, want 1", store.ensureCalls)
	}
	if result.Details["bucket"] != "dr-recovery-points" || result.Details["endpoint"] != "minio:9000" {
		t.Fatalf("details = %+v", result.Details)
	}
}

func TestWORMBucketHealthCheckerReportsFailure(t *testing.T) {
	t.Parallel()
	store := &stubWORMStore{bucket: "dr-recovery-points", err: errors.New("access denied")}
	checker := NewWORMBucketHealthChecker(store, "minio:9000")

	result := checker.Check(context.Background())
	if result.Status != "unhealthy" {
		t.Fatalf("status = %q, want unhealthy", result.Status)
	}
	if result.Error != "access denied" {
		t.Fatalf("error = %q", result.Error)
	}
}

func TestRuntimeConfigHealthCheckerReportsStructuredValidation(t *testing.T) {
	t.Parallel()
	checker := NewRuntimeConfigHealthChecker(drconfig.ValidationResult{
		Profile:   "regulated",
		Regulated: true,
		Valid:     false,
		Checks: []drconfig.ValidationCheck{{
			Name:     "vault_transit",
			Status:   "fail",
			Required: true,
			Message:  "missing Vault transit",
		}},
	})

	result := checker.Check(context.Background())

	if result.Status != "unhealthy" {
		t.Fatalf("status = %q, want unhealthy", result.Status)
	}
	if result.Details["profile"] != "regulated" || result.Details["regulated"] != true || result.Details["valid"] != false {
		t.Fatalf("details = %+v", result.Details)
	}
	if result.Error == "" {
		t.Fatal("expected validation error")
	}
}

type stubWORMStore struct {
	bucket      string
	err         error
	ensureCalls int
}

func (s *stubWORMStore) EnsureBucket(context.Context) error {
	s.ensureCalls++
	return s.err
}

func (s *stubWORMStore) Bucket() string { return s.bucket }

type stubChecker struct {
	name string
}

func (s stubChecker) Name() string { return s.name }

func (s stubChecker) Check(context.Context) obshealth.HealthResult {
	return obshealth.HealthResult{Status: "healthy"}
}
