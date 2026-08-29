package service

import (
	"context"
	"reflect"
	"sync"
	"testing"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// fakeTierSource is a scripted BootTierSource returning a fixed site->tier map.
type fakeTierSource struct {
	tiers map[string]int
	ok    bool
	err   error
}

func (s fakeTierSource) TierBySite(_ context.Context, _ repository.DBTX, _ string) (map[string]int, bool, error) {
	return s.tiers, s.ok, s.err
}

// fakeProber is a scripted HealthProber keyed by probe target; default healthy.
type fakeProber struct {
	mu      sync.Mutex
	healthy map[string]bool // probe.Target -> healthy
	probed  []string        // probe.Target order
}

func (p *fakeProber) Probe(_ context.Context, probe model.HealthProbe) (ProbeResult, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.probed = append(p.probed, probe.Target)
	h := true
	if v, ok := p.healthy[probe.Target]; ok {
		h = v
	}
	return ProbeResult{Type: probe.Type, Target: probe.Target, Healthy: h}, nil
}

// withProbes gives every target a tcp health probe targeting "probe-<site>" so
// the inter-tier health gate actually invokes the prober (the base fixture leaves
// HealthProbe empty, which the gate treats as "nothing to probe").
func withProbes(repo *fakeExecRepo) {
	for _, t := range repo.targets {
		t.HealthProbe = model.HealthProbe{Type: "tcp", Target: "probe-" + t.SiteID}
	}
}

func tierRun() *model.FailoverRun {
	return &model.FailoverRun{ID: "run-tier", TenantID: "11111111-1111-1111-1111-111111111111", GroupID: "g1", Mode: model.ModeReal, Status: model.StatusExecuting, RecoveryPointID: ptr("rp-1")}
}

func tierReader() uuidChunkReader {
	return uuidChunkReader{bytesByStream: map[string][]byte{
		"stream-a": []byte("data-a"), "stream-b": []byte("data-b"), "stream-c": []byte("data-c"),
	}}
}

// TestRecoveryExecutor_TieredBootOrderAndHealthGate proves the bootgraph DAG
// tiers OVERRIDE the flat boot_order and that each booted member is health-gated
// before the next tier boots. boot_order is a<b<c, but the tiers put site-b in
// tier 0, so site-b boots FIRST despite its higher boot_order.
func TestRecoveryExecutor_TieredBootOrderAndHealthGate(t *testing.T) {
	repo := newExecFixture()
	withProbes(repo)
	driver := newRecordingDriver()
	prober := &fakeProber{}
	tiers := fakeTierSource{ok: true, tiers: map[string]int{"site-b": 0, "site-a": 1, "site-c": 1}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, tierReader(), driver).WithBootTiers(tiers, prober)

	detail, err := exec.ExecuteWithDetail(context.Background(), tierRun())
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	// tier 0 = {site-b}; tier 1 = {site-a, site-c} ordered by boot_order (10 < 30).
	wantBoot := []string{"site-b", "site-a", "site-c"}
	if !reflect.DeepEqual(driver.bootOrder, wantBoot) {
		t.Fatalf("boot order = %v, want %v (tiers must override flat boot_order)", driver.bootOrder, wantBoot)
	}
	wantProbe := []string{"probe-site-b", "probe-site-a", "probe-site-c"}
	if !reflect.DeepEqual(prober.probed, wantProbe) {
		t.Fatalf("health-gate probe order = %v, want %v", prober.probed, wantProbe)
	}
	if detail["boot_tiered"] != true {
		t.Fatalf("boot_tiered = %v, want true", detail["boot_tiered"])
	}
}

// TestRecoveryExecutor_HealthGateFailureRollsBack proves a member that fails its
// health gate stops the boot (later tiers never boot) and rolls back everything
// booted so far.
func TestRecoveryExecutor_HealthGateFailureRollsBack(t *testing.T) {
	repo := newExecFixture()
	withProbes(repo)
	driver := newRecordingDriver()
	prober := &fakeProber{healthy: map[string]bool{"probe-site-b": false}} // tier-0 member unhealthy
	tiers := fakeTierSource{ok: true, tiers: map[string]int{"site-b": 0, "site-a": 1, "site-c": 1}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, tierReader(), driver).WithBootTiers(tiers, prober)

	if _, err := exec.ExecuteWithDetail(context.Background(), tierRun()); err == nil {
		t.Fatal("expected health-gate failure to surface (drives ROLLED_BACK)")
	}
	// Only the tier-0 member booted before the gate failed; tier 1 never boots.
	if !reflect.DeepEqual(driver.bootOrder, []string{"site-b"}) {
		t.Fatalf("boot order = %v, want [site-b] (gate must stop before tier 1)", driver.bootOrder)
	}
	if !reflect.DeepEqual(driver.teardowns, []string{"site-b"}) {
		t.Fatalf("teardowns = %v, want [site-b] (rollback of the booted member)", driver.teardowns)
	}
}

// TestRecoveryExecutor_IncompleteTierMappingFallsBackToFlat proves the strict
// all-or-nothing fallback: if any target is unmapped, the executor boots in the
// flat boot_order with NO health gate (historic behaviour preserved).
func TestRecoveryExecutor_IncompleteTierMappingFallsBackToFlat(t *testing.T) {
	repo := newExecFixture()
	withProbes(repo)
	driver := newRecordingDriver()
	prober := &fakeProber{}
	// site-c is missing -> incomplete mapping -> fall back to flat boot_order.
	tiers := fakeTierSource{ok: true, tiers: map[string]int{"site-a": 0, "site-b": 1}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, tierReader(), driver).WithBootTiers(tiers, prober)

	detail, err := exec.ExecuteWithDetail(context.Background(), tierRun())
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if !reflect.DeepEqual(driver.bootOrder, []string{"site-a", "site-b", "site-c"}) {
		t.Fatalf("boot order = %v, want flat [site-a site-b site-c]", driver.bootOrder)
	}
	if len(prober.probed) != 0 {
		t.Fatalf("health gate probed %v in fallback mode, want none", prober.probed)
	}
	if detail["boot_tiered"] != false {
		t.Fatalf("boot_tiered = %v, want false (flat fallback)", detail["boot_tiered"])
	}
}

// TestRecoveryExecutor_NoTierSourceBootsFlat proves that without a BootTierSource
// (the default) the executor boots in flat boot_order with no health gate.
func TestRecoveryExecutor_NoTierSourceBootsFlat(t *testing.T) {
	repo := newExecFixture()
	withProbes(repo)
	driver := newRecordingDriver()
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, tierReader(), driver)

	detail, err := exec.ExecuteWithDetail(context.Background(), tierRun())
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if !reflect.DeepEqual(driver.bootOrder, []string{"site-a", "site-b", "site-c"}) {
		t.Fatalf("boot order = %v, want flat [site-a site-b site-c]", driver.bootOrder)
	}
	if detail["boot_tiered"] != false {
		t.Fatalf("boot_tiered = %v, want false", detail["boot_tiered"])
	}
}
