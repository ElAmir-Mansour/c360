package service_test

import (
	"context"
	"testing"
	"time"

	auditmodel "github.com/clario360/platform/internal/audit/model"
	"github.com/clario360/platform/internal/siem/audit"
	"github.com/clario360/platform/internal/siem/internal/buildinfo"
	"github.com/clario360/platform/internal/siem/service"
)

func TestMetaService_ReadsBuildInfo(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	s := service.NewMetaService(func() time.Time { return now.Add(2 * time.Second) })

	meta := s.MetaFor("tenant-1")
	if meta.Service != "siem-service" {
		t.Errorf("Service=%q", meta.Service)
	}
	if meta.Version != buildinfo.Version {
		t.Errorf("Version=%q, want %q", meta.Version, buildinfo.Version)
	}
	if meta.Commit != buildinfo.Commit {
		t.Errorf("Commit=%q, want %q", meta.Commit, buildinfo.Commit)
	}
	if meta.BuildTime != buildinfo.BuildTime {
		t.Errorf("BuildTime=%q, want %q", meta.BuildTime, buildinfo.BuildTime)
	}
	if meta.GoVersion == "" {
		t.Error("GoVersion empty")
	}
	if meta.TenantID != "tenant-1" {
		t.Errorf("TenantID=%q", meta.TenantID)
	}
}

func TestMetaService_UptimeIsMonotonic(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	cur := now
	s := service.NewMetaService(func() time.Time { return cur })

	if got := s.UptimeSeconds(); got != 0 {
		t.Fatalf("initial uptime=%d, want 0", got)
	}
	cur = now.Add(5 * time.Second)
	if got := s.UptimeSeconds(); got != 5 {
		t.Errorf("uptime after 5s=%d, want 5", got)
	}
	cur = now.Add(60 * time.Second)
	if got := s.UptimeSeconds(); got != 60 {
		t.Errorf("uptime after 60s=%d, want 60", got)
	}
}

func TestMetaService_UptimeNonNegative(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	cur := now
	s := service.NewMetaService(func() time.Time { return cur })

	// Move clock backwards — uptime must clamp at zero.
	cur = now.Add(-1 * time.Minute)
	meta := s.MetaFor("t")
	if meta.UptimeSeconds < 0 {
		t.Errorf("UptimeSeconds=%d, want >=0", meta.UptimeSeconds)
	}
}

func TestMetaService_NilClockDefaultsToWall(t *testing.T) {
	t.Parallel()
	s := service.NewMetaService(nil)
	if s == nil {
		t.Fatal("nil service")
	}
	if s.UptimeSeconds() < 0 {
		t.Errorf("UptimeSeconds<0")
	}
}

// TestAuditEmitter_SyntheticBootstrap is the protected unit test
// required by the carry-over: a synthetic siem.bootstrap entry is
// constructed and the emitter accepts it.
func TestAuditEmitter_SyntheticBootstrap(t *testing.T) {
	t.Parallel()
	em := audit.NewInMemory()

	entry := audit.NewSyntheticBootstrapEntry("tenant-x", "ops@clario360")
	if err := em.Emit(context.Background(), entry); err != nil {
		t.Fatalf("Emit: %v", err)
	}
	entries := em.Entries()
	if len(entries) != 1 {
		t.Fatalf("entries=%d, want 1", len(entries))
	}
	got := entries[0]
	if got.Action != "siem.bootstrap" {
		t.Errorf("Action=%q, want siem.bootstrap", got.Action)
	}
	if got.TenantID != "tenant-x" {
		t.Errorf("TenantID=%q, want tenant-x", got.TenantID)
	}
	if got.Severity != auditmodel.SeverityInfo {
		t.Errorf("Severity=%s, want info", got.Severity)
	}
	if got.Service != "siem-service" {
		t.Errorf("Service=%q, want siem-service", got.Service)
	}
}
