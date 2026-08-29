package bootgraph

import (
	"context"
	"errors"
	"net"
	"sync"
	"testing"
	"time"
)

// recordingSink is an in-memory statusSink that records every transition AND the
// global order in which transitions happened, so a test can assert tier-by-tier
// sequencing (a later tier's service never goes booting before an earlier tier's
// service is healthy).
type recordingSink struct {
	mu     sync.Mutex
	events []sinkEvent
	// healthyAt records, per service, the global event index at which it became
	// healthy (for cross-tier ordering assertions).
	healthyAt map[string]int
	bootingAt map[string]int
	statuses  map[string]string
}

type sinkEvent struct {
	kind      string // booting|healthy|unhealthy|rolledback
	serviceID string
	tier      int
}

func newRecordingSink() *recordingSink {
	return &recordingSink{
		healthyAt: map[string]int{},
		bootingAt: map[string]int{},
		statuses:  map[string]string{},
	}
}

func (s *recordingSink) record(e sinkEvent) {
	s.mu.Lock()
	defer s.mu.Unlock()
	idx := len(s.events)
	s.events = append(s.events, e)
	switch e.kind {
	case "booting":
		if _, ok := s.bootingAt[e.serviceID]; !ok {
			s.bootingAt[e.serviceID] = idx
		}
		s.statuses[e.serviceID] = SvcBooting
	case "healthy":
		s.healthyAt[e.serviceID] = idx
		s.statuses[e.serviceID] = SvcHealthy
	case "unhealthy":
		s.statuses[e.serviceID] = SvcUnhealthy
	case "rolledback":
		s.statuses[e.serviceID] = SvcRolledBack
	}
}

func (s *recordingSink) MarkServiceBooting(_ context.Context, _ string, serviceID string, tier, _ int) error {
	s.record(sinkEvent{kind: "booting", serviceID: serviceID, tier: tier})
	return nil
}

func (s *recordingSink) MarkServiceHealthy(_ context.Context, _ string, serviceID string, _ int, _ time.Time) error {
	s.record(sinkEvent{kind: "healthy", serviceID: serviceID})
	return nil
}

func (s *recordingSink) MarkServiceUnhealthy(_ context.Context, _ string, serviceID string, _ int, _ string) error {
	s.record(sinkEvent{kind: "unhealthy", serviceID: serviceID})
	return nil
}

func (s *recordingSink) MarkServiceRolledBack(_ context.Context, _ string, serviceID string) error {
	s.record(sinkEvent{kind: "rolledback", serviceID: serviceID})
	return nil
}

func (s *recordingSink) status(serviceID string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.statuses[serviceID]
}

// scriptedChecker returns a HealthChecker per service from a map of service-ID ->
// health result. A missing entry defaults to healthy.
type scriptedChecker struct {
	results map[string]error
}

func (c scriptedChecker) Check(_ context.Context, svc Service) error {
	return c.results[svc.ID]
}

// recordingBooter records boot/teardown calls so a test can assert teardown
// order during rollback.
type recordingBooter struct {
	mu        sync.Mutex
	booted    []string
	teardowns []string
	bootErr   map[string]error
}

func (b *recordingBooter) Boot(_ context.Context, svc Service) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.booted = append(b.booted, svc.ID)
	return b.bootErr[svc.ID]
}

func (b *recordingBooter) TearDown(_ context.Context, svc Service) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.teardowns = append(b.teardowns, svc.ID)
	return nil
}

// threeTierPlan builds the [[db,cache],[api],[web]] plan used across tests.
func threeTierPlan() BootPlan {
	return BootPlan{
		GroupID: "g",
		Tiers: [][]Service{
			{svc("s-cache", "cache"), svc("s-db", "db")},
			{svc("s-api", "api")},
			{svc("s-web", "web")},
		},
	}
}

func newTestOrchestrator(t *testing.T, sink statusSink, checker func(Service) HealthChecker, booter Booter) *Orchestrator {
	t.Helper()
	o, err := NewOrchestrator(OrchestratorConfig{
		Booter:       booter,
		CheckerFor:   checker,
		Sink:         sink,
		RetryBackoff: time.Millisecond, // keep retries fast
	})
	if err != nil {
		t.Fatalf("NewOrchestrator: %v", err)
	}
	return o
}

func TestOrchestrator_BootsTierByTier_AdvancesOnlyWhenHealthy(t *testing.T) {
	sink := newRecordingSink()
	checker := func(Service) HealthChecker { return scriptedChecker{} } // all healthy
	o := newTestOrchestrator(t, sink, checker, NoopBooter{})

	outcome, err := o.Execute(context.Background(), "run-1", threeTierPlan(), PolicyHalt)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if outcome.Status != RunStatusCompleted {
		t.Fatalf("status = %q, want completed", outcome.Status)
	}
	if outcome.TiersBooted != 3 {
		t.Fatalf("tiers booted = %d, want 3", outcome.TiersBooted)
	}

	// Cross-tier ordering: api must not start booting until BOTH db and cache are
	// healthy; web must not start booting until api is healthy.
	sink.mu.Lock()
	defer sink.mu.Unlock()
	apiBoot := sink.bootingAt["s-api"]
	webBoot := sink.bootingAt["s-web"]
	if apiBoot <= sink.healthyAt["s-db"] || apiBoot <= sink.healthyAt["s-cache"] {
		t.Fatalf("api began booting (idx %d) before db (%d)/cache (%d) healthy",
			apiBoot, sink.healthyAt["s-db"], sink.healthyAt["s-cache"])
	}
	if webBoot <= sink.healthyAt["s-api"] {
		t.Fatalf("web began booting (idx %d) before api healthy (%d)", webBoot, sink.healthyAt["s-api"])
	}
}

func TestOrchestrator_ParallelWithinTier(t *testing.T) {
	// Both tier-0 services must boot concurrently. Use a checker that blocks each
	// service until BOTH have entered the probe, proving parallelism (a serial
	// orchestrator would deadlock and time out).
	entered := make(chan string, 2)
	release := make(chan struct{})
	checker := func(Service) HealthChecker {
		return checkFunc(func(_ context.Context, svc Service) error {
			entered <- svc.ID
			<-release
			return nil
		})
	}
	sink := newRecordingSink()
	o := newTestOrchestrator(t, sink, checker, NoopBooter{})

	plan := BootPlan{GroupID: "g", Tiers: [][]Service{{svc("a", "a"), svc("b", "b")}}}

	done := make(chan RunOutcome, 1)
	go func() {
		oc, _ := o.Execute(context.Background(), "run-par", plan, PolicyHalt)
		done <- oc
	}()

	// Both must enter their probe before any is released -> they run in parallel.
	deadline := time.After(2 * time.Second)
	got := map[string]bool{}
	for len(got) < 2 {
		select {
		case id := <-entered:
			got[id] = true
		case <-deadline:
			t.Fatalf("only %d of 2 services entered probe concurrently; not parallel", len(got))
		}
	}
	close(release)

	select {
	case oc := <-done:
		if oc.Status != RunStatusCompleted {
			t.Fatalf("status = %q, want completed", oc.Status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Execute did not finish")
	}
}

// checkFunc adapts a function to a HealthChecker.
type checkFunc func(context.Context, Service) error

func (f checkFunc) Check(ctx context.Context, svc Service) error { return f(ctx, svc) }

func TestOrchestrator_TierNeverHealthy_HaltsAndLeavesEarlierTiersUp(t *testing.T) {
	sink := newRecordingSink()
	// api (tier 1) never goes healthy; the run must HALT at tier 1, with tier 0
	// (db, cache) healthy and web (tier 2) never started.
	checker := func(Service) HealthChecker {
		return scriptedChecker{results: map[string]error{
			"s-api": errors.New("api down"),
		}}
	}
	booter := &recordingBooter{}
	o := newTestOrchestrator(t, sink, checker, booter)

	outcome, err := o.Execute(context.Background(), "run-halt", threeTierPlan(), PolicyHalt)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if outcome.Status != RunStatusFailed {
		t.Fatalf("status = %q, want failed (halt)", outcome.Status)
	}
	if outcome.FailedTier != 1 {
		t.Fatalf("failed tier = %d, want 1", outcome.FailedTier)
	}
	if outcome.TiersBooted != 1 {
		t.Fatalf("tiers booted = %d, want 1 (tier 0 only)", outcome.TiersBooted)
	}
	if got := outcome.FailedServices; len(got) != 1 || got[0] != "api" {
		t.Fatalf("failed services = %v, want [api]", got)
	}
	// Halt leaves earlier tiers UP — no teardown should have happened.
	if len(booter.teardowns) != 0 {
		t.Fatalf("halt policy tore down %v; want none", booter.teardowns)
	}
	if sink.status("s-db") != SvcHealthy || sink.status("s-cache") != SvcHealthy {
		t.Fatalf("tier 0 not healthy: db=%s cache=%s", sink.status("s-db"), sink.status("s-cache"))
	}
	if sink.status("s-web") == SvcBooting || sink.status("s-web") == SvcHealthy {
		t.Fatalf("web (tier 2) should never have started; status=%s", sink.status("s-web"))
	}
}

func TestOrchestrator_TierNeverHealthy_RollsBackInReverse(t *testing.T) {
	sink := newRecordingSink()
	checker := func(Service) HealthChecker {
		return scriptedChecker{results: map[string]error{
			"s-api": errors.New("api down"),
		}}
	}
	booter := &recordingBooter{}
	o := newTestOrchestrator(t, sink, checker, booter)

	outcome, err := o.Execute(context.Background(), "run-rb", threeTierPlan(), PolicyRollback)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if outcome.Status != RunStatusRolledBack {
		t.Fatalf("status = %q, want rolled_back", outcome.Status)
	}
	// Rollback tears down the failed tier (api) then tier 0 (db,cache) in REVERSE.
	// Teardown order: tier1 first (api), then tier0 reverse-name (db before cache).
	want := []string{"s-api", "s-db", "s-cache"}
	if !equalStrings(booter.teardowns, want) {
		t.Fatalf("teardown order = %v, want %v (reverse tier, reverse name)", booter.teardowns, want)
	}
	// Every torn-down service is recorded rolled_back.
	for _, id := range want {
		if sink.status(id) != SvcRolledBack {
			t.Errorf("%s status = %s, want rolled_back", id, sink.status(id))
		}
	}
}

func TestOrchestrator_RetriesThenSucceeds(t *testing.T) {
	// A service that is unhealthy on its first attempt but healthy on the second,
	// with HealthRetries=1, must end healthy (the retry budget covers it).
	var attempts int
	var mu sync.Mutex
	checker := func(Service) HealthChecker {
		return checkFunc(func(_ context.Context, _ Service) error {
			mu.Lock()
			defer mu.Unlock()
			attempts++
			if attempts == 1 {
				return errors.New("not ready yet")
			}
			return nil
		})
	}
	sink := newRecordingSink()
	o := newTestOrchestrator(t, sink, checker, NoopBooter{})

	plan := BootPlan{GroupID: "g", Tiers: [][]Service{{Service{ID: "s", Name: "s", HealthRetries: 1}}}}
	outcome, err := o.Execute(context.Background(), "run-retry", plan, PolicyHalt)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if outcome.Status != RunStatusCompleted {
		t.Fatalf("status = %q, want completed after retry", outcome.Status)
	}
	if attempts < 2 {
		t.Fatalf("attempts = %d, want >= 2 (a retry occurred)", attempts)
	}
}

func TestOrchestrator_RealTCPProbe_GatesTierAdvance(t *testing.T) {
	// End-to-end through the orchestrator with the REAL TCP probe: tier 0 is an
	// open listener (healthy), tier 1 is a closed port (never healthy) -> the run
	// halts at tier 1 with tier 0 booted.
	upLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer upLn.Close()
	go func() {
		for {
			c, e := upLn.Accept()
			if e != nil {
				return
			}
			_ = c.Close()
		}
	}()
	upAddr := upLn.Addr().String()

	downLn, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	downAddr := downLn.Addr().String()
	_ = downLn.Close() // closed -> probe fails

	plan := BootPlan{
		GroupID: "g",
		Tiers: [][]Service{
			{Service{ID: "s-db", Name: "db", ProbeKind: ProbeTCP, ProbeTarget: upAddr, BootTimeoutSeconds: 2}},
			{Service{ID: "s-api", Name: "api", ProbeKind: ProbeTCP, ProbeTarget: downAddr, BootTimeoutSeconds: 1, HealthRetries: 0}},
		},
	}

	sink := newRecordingSink()
	// Use the REAL CheckerFor (nil CheckerFor in config -> production probes).
	o, err := NewOrchestrator(OrchestratorConfig{Sink: sink, RetryBackoff: time.Millisecond})
	if err != nil {
		t.Fatalf("NewOrchestrator: %v", err)
	}

	outcome, err := o.Execute(context.Background(), "run-tcp", plan, PolicyHalt)
	if err != nil {
		t.Fatalf("Execute error: %v", err)
	}
	if outcome.Status != RunStatusFailed {
		t.Fatalf("status = %q, want failed (tier 1 closed port)", outcome.Status)
	}
	if outcome.FailedTier != 1 {
		t.Fatalf("failed tier = %d, want 1", outcome.FailedTier)
	}
	if sink.status("s-db") != SvcHealthy {
		t.Fatalf("db (open listener) status = %s, want healthy", sink.status("s-db"))
	}
	if sink.status("s-api") != SvcUnhealthy {
		t.Fatalf("api (closed port) status = %s, want unhealthy", sink.status("s-api"))
	}
}

func TestOrchestrator_RejectsInvalidPolicy(t *testing.T) {
	o := newTestOrchestrator(t, newRecordingSink(), func(Service) HealthChecker { return scriptedChecker{} }, NoopBooter{})
	if _, err := o.Execute(context.Background(), "r", threeTierPlan(), "bogus"); !errors.Is(err, ErrInvalidPolicy) {
		t.Fatalf("err = %v, want ErrInvalidPolicy", err)
	}
}

func TestNewOrchestrator_RequiresSink(t *testing.T) {
	if _, err := NewOrchestrator(OrchestratorConfig{}); err == nil {
		t.Fatal("expected error when sink is nil")
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
