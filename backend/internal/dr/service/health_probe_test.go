package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

func TestHealthProber_HTTP_Green(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("READY"))
	}))
	defer srv.Close()

	p := NewHealthProber()
	res, err := p.Probe(context.Background(), model.HealthProbe{
		Type:    ProbeTypeHTTP,
		Target:  srv.URL,
		Timeout: "2s",
		Retries: 1,
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if !res.Healthy {
		t.Fatalf("expected healthy, got %+v", res)
	}
}

func TestHealthProber_HTTP_NotReady500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	p := NewHealthProber()
	res, err := p.Probe(context.Background(), model.HealthProbe{
		Type:    ProbeTypeHTTP,
		Target:  srv.URL,
		Timeout: "2s",
		Retries: 2, // retried, still not ready
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if res.Healthy {
		t.Fatalf("expected not healthy on 500, got %+v", res)
	}
	if res.Attempts != 2 {
		t.Fatalf("expected 2 attempts, got %d", res.Attempts)
	}
}

func TestHealthProber_HTTP_ExpectedContains(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"UP"}`))
	}))
	defer srv.Close()

	p := NewHealthProber()
	// Match a body fragment.
	res, err := p.Probe(context.Background(), model.HealthProbe{
		Type:     ProbeTypeHTTP,
		Target:   srv.URL,
		Expected: "contains:UP",
		Timeout:  "2s",
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if !res.Healthy {
		t.Fatalf("expected healthy when body contains UP, got %+v", res)
	}

	// A non-matching fragment must fail even on 200.
	res, err = p.Probe(context.Background(), model.HealthProbe{
		Type:     ProbeTypeHTTP,
		Target:   srv.URL,
		Expected: "contains:DOWN",
		Timeout:  "2s",
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if res.Healthy {
		t.Fatalf("expected unhealthy when body lacks DOWN, got %+v", res)
	}
}

func TestHealthProber_HTTP_ExpectedStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent) // 204
	}))
	defer srv.Close()

	p := NewHealthProber()
	res, err := p.Probe(context.Background(), model.HealthProbe{
		Type:     ProbeTypeHTTP,
		Target:   srv.URL,
		Expected: "status:204",
		Timeout:  "2s",
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if !res.Healthy {
		t.Fatalf("expected healthy on explicit 204 match, got %+v", res)
	}
}

func TestHealthProber_HTTP_Timeout(t *testing.T) {
	// A server that blocks longer than the probe timeout.
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	defer close(release)

	p := NewHealthProber()
	start := time.Now()
	res, err := p.Probe(context.Background(), model.HealthProbe{
		Type:    ProbeTypeHTTP,
		Target:  srv.URL,
		Timeout: "200ms",
		Retries: 1,
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if res.Healthy {
		t.Fatalf("expected timeout to be unhealthy, got %+v", res)
	}
	if time.Since(start) > 5*time.Second {
		t.Fatalf("probe did not honour the 200ms timeout (took %s)", time.Since(start))
	}
}

func TestHealthProber_TCP_GreenAndClosed(t *testing.T) {
	// Real TCP listener: dialing it succeeds (green).
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			_ = conn.Close()
		}
	}()
	addr := ln.Addr().String()

	p := NewHealthProber()
	res, err := p.Probe(context.Background(), model.HealthProbe{
		Type:    ProbeTypeTCP,
		Target:  addr,
		Timeout: "2s",
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if !res.Healthy {
		t.Fatalf("expected healthy TCP dial, got %+v", res)
	}

	// Close the listener; a dial to the now-dead port must be unhealthy.
	_ = ln.Close()
	res, err = p.Probe(context.Background(), model.HealthProbe{
		Type:    ProbeTypeTCP,
		Target:  addr,
		Timeout: "500ms",
		Retries: 1,
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if res.Healthy {
		t.Fatalf("expected unhealthy TCP dial to closed port, got %+v", res)
	}
}

func TestHealthProber_DefaultsTimeoutAndRetries(t *testing.T) {
	var (
		calls      int
		gotTimeout time.Duration
	)
	prober := &netHealthProber{
		httpClient: &http.Client{},
		dial: func(_ context.Context, _, _ string, timeout time.Duration) (net.Conn, error) {
			calls++
			gotTimeout = timeout
			return nil, errors.New("dial refused")
		},
	}

	res, err := prober.Probe(context.Background(), model.HealthProbe{
		Type:   ProbeTypeTCP,
		Target: "127.0.0.1:1",
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if res.Healthy {
		t.Fatalf("expected unhealthy default TCP probe, got %+v", res)
	}
	if calls != defaultProbeRetries || res.Attempts != defaultProbeRetries {
		t.Fatalf("calls/attempts = %d/%d, want default retries %d", calls, res.Attempts, defaultProbeRetries)
	}
	if gotTimeout != defaultProbeTimeout {
		t.Fatalf("timeout = %s, want default %s", gotTimeout, defaultProbeTimeout)
	}
}

func TestHealthProber_SQL_InjectedPing(t *testing.T) {
	// The SQL transport is exercised for real (pgx SELECT 1) in the integration
	// test; here we verify the prober routes SQL to the ping and reports the
	// outcome, using an injected ping so the unit test needs no database.
	pinged := false
	prober := &netHealthProber{
		httpClient: &http.Client{},
		sqlPing: func(_ context.Context, dsn string) error {
			pinged = true
			if dsn != "postgres://x" {
				t.Fatalf("unexpected dsn %q", dsn)
			}
			return nil
		},
	}
	res, err := prober.Probe(context.Background(), model.HealthProbe{
		Type:    ProbeTypeSQL,
		Target:  "postgres://x",
		Timeout: "2s",
	})
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	if !pinged || !res.Healthy {
		t.Fatalf("expected SQL ping invoked + healthy, pinged=%v res=%+v", pinged, res)
	}
}

func TestHealthProber_UnknownType(t *testing.T) {
	p := NewHealthProber()
	_, err := p.Probe(context.Background(), model.HealthProbe{Type: "voodoo", Target: "x"})
	if err == nil {
		t.Fatal("expected error for unknown probe type")
	}
}

// --- WorkloadHealthValidator (the §15.2 distinct workload gate) ---

type fakeTargetReader struct {
	targets []*model.RecoveryTarget
}

func (f fakeTargetReader) SystemListRecoveryTargetsByGroup(_ context.Context, _ repository.DBTX, _ string) ([]*model.RecoveryTarget, error) {
	return f.targets, nil
}

type directSystemRunner struct{}

func (directSystemRunner) RunSystemRead(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}

func (directSystemRunner) RunSystemTx(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}

type scriptedProber struct {
	bySite map[string]bool // site -> healthy
}

func (s scriptedProber) Probe(_ context.Context, probe model.HealthProbe) (ProbeResult, error) {
	healthy := s.bySite[probe.Target]
	return ProbeResult{Type: probe.Type, Target: probe.Target, Healthy: healthy, Attempts: 1}, nil
}

func TestWorkloadHealthValidator_AllGreen(t *testing.T) {
	reader := fakeTargetReader{targets: []*model.RecoveryTarget{
		{SiteID: "s1", HealthProbe: model.HealthProbe{Type: "http", Target: "s1"}},
		{SiteID: "s2", HealthProbe: model.HealthProbe{Type: "tcp", Target: "s2"}},
	}}
	prober := scriptedProber{bySite: map[string]bool{"s1": true, "s2": true}}
	v := NewWorkloadHealthValidator(reader, directSystemRunner{}, prober, 2*time.Second)

	detail, err := v.ValidateRecoveredWorkloads(context.Background(), &model.FailoverRun{GroupID: "g1"})
	if err != nil {
		t.Fatalf("expected all-green, got err %v", err)
	}
	if detail["all_healthy"] != true {
		t.Fatalf("expected all_healthy, got %+v", detail)
	}
}

func TestWorkloadHealthValidator_OneRedRollsBack(t *testing.T) {
	reader := fakeTargetReader{targets: []*model.RecoveryTarget{
		{SiteID: "s1", HealthProbe: model.HealthProbe{Type: "http", Target: "s1"}},
		{SiteID: "s2", HealthProbe: model.HealthProbe{Type: "tcp", Target: "s2"}},
	}}
	prober := scriptedProber{bySite: map[string]bool{"s1": true, "s2": false}}
	// Short deadline so the never-green member trips quickly.
	v := NewWorkloadHealthValidator(reader, directSystemRunner{}, prober, 100*time.Millisecond)
	v.now = func() time.Time { return time.Now() }

	_, err := v.ValidateRecoveredWorkloads(context.Background(), &model.FailoverRun{GroupID: "g1"})
	if err == nil {
		t.Fatal("expected ErrWorkloadUnhealthy when a member never goes green")
	}
}

type scriptedAppVerifier struct {
	byWorkload map[string]appverify.Result
}

func (v scriptedAppVerifier) Execute(_ context.Context, plan appverify.CheckPlan) (appverify.Result, error) {
	result, ok := v.byWorkload[plan.WorkloadID]
	if !ok {
		result = appverify.Result{WorkloadID: plan.WorkloadID, Passed: true}
	}
	if !result.Passed {
		return result, appverify.ErrVerificationFailed
	}
	return result, nil
}

func TestWorkloadHealthValidator_AppVerificationFailureBlocksAttestation(t *testing.T) {
	reader := fakeTargetReader{targets: []*model.RecoveryTarget{
		{SiteID: "s1", HealthProbe: model.HealthProbe{Type: "http", Target: "s1"}},
		{SiteID: "s2", HealthProbe: model.HealthProbe{Type: "tcp", Target: "s2"}},
	}}
	prober := scriptedProber{bySite: map[string]bool{"s1": true, "s2": true}}
	planner := AppVerificationPlannerFunc(func(_ context.Context, _ *model.FailoverRun, target *model.RecoveryTarget) (appverify.CheckPlan, bool, error) {
		return appverify.CheckPlan{
			WorkloadID:    target.SiteID,
			WorkloadName:  target.SiteID,
			RequestedKind: appverify.WorkloadGenericHTTP,
			ProfileKind:   appverify.WorkloadGenericHTTP,
		}, true, nil
	})
	verifier := scriptedAppVerifier{byWorkload: map[string]appverify.Result{
		"s1": {WorkloadID: "s1", Passed: true, ChecksTotal: 1, ChecksPassed: 1},
		"s2": {WorkloadID: "s2", Passed: false, ChecksTotal: 1, FailedChecks: []string{"http-ready"}},
	}}
	v := NewWorkloadHealthValidator(reader, directSystemRunner{}, prober, 2*time.Second).
		WithAppVerification(planner, verifier)

	detail, err := v.ValidateRecoveredWorkloads(context.Background(), &model.FailoverRun{GroupID: "g1"})
	if !errors.Is(err, ErrAppVerificationFailed) {
		t.Fatalf("err = %v, want ErrAppVerificationFailed", err)
	}
	if detail["all_healthy"] != true {
		t.Fatalf("health should have passed before app verification failed: %+v", detail)
	}
	appDetail, ok := detail["app_verification"].(map[string]any)
	if !ok {
		t.Fatalf("missing app_verification detail: %+v", detail)
	}
	if appDetail["all_passed"] != false {
		t.Fatalf("app detail = %+v, want all_passed=false", appDetail)
	}
}

func TestWorkloadHealthValidator_AppVerificationSuccessIsPersistedInDetail(t *testing.T) {
	reader := fakeTargetReader{targets: []*model.RecoveryTarget{
		{SiteID: "s1", HealthProbe: model.HealthProbe{Type: "http", Target: "s1"}},
	}}
	prober := scriptedProber{bySite: map[string]bool{"s1": true}}
	planner := AppVerificationPlannerFunc(func(_ context.Context, _ *model.FailoverRun, target *model.RecoveryTarget) (appverify.CheckPlan, bool, error) {
		return appverify.CheckPlan{WorkloadID: target.SiteID, RequestedKind: appverify.WorkloadGenericHTTP, ProfileKind: appverify.WorkloadGenericHTTP}, true, nil
	})
	verifier := scriptedAppVerifier{byWorkload: map[string]appverify.Result{
		"s1": {WorkloadID: "s1", Passed: true, ChecksTotal: 2, ChecksPassed: 2, RequiredTotal: 2, RequiredPassed: 2},
	}}
	v := NewWorkloadHealthValidator(reader, directSystemRunner{}, prober, 2*time.Second).
		WithAppVerification(planner, verifier)

	detail, err := v.ValidateRecoveredWorkloads(context.Background(), &model.FailoverRun{GroupID: "g1"})
	if err != nil {
		t.Fatalf("ValidateRecoveredWorkloads: %v", err)
	}
	appDetail, ok := detail["app_verification"].(map[string]any)
	if !ok {
		t.Fatalf("missing app_verification detail: %+v", detail)
	}
	if appDetail["workloads_planned"] != 1 || appDetail["all_passed"] != true {
		t.Fatalf("app detail = %+v, want one planned all passed", appDetail)
	}
}
