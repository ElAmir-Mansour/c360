package service

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// Health-probe types (DESIGN_DataStream_DR.md §15.2 — the distinct workload-up
// probe, NOT the data-fidelity Validator).
const (
	ProbeTypeHTTP     = "http"
	ProbeTypeTCP      = "tcp"
	ProbeTypeSQL      = "sql"
	ProbeTypeK8sReady = "k8s_ready"
)

const (
	defaultProbeTimeout    = 5 * time.Second
	defaultProbeRetries    = 1
	defaultProbeRetryDelay = 250 * time.Millisecond
)

// ProbeResult is the outcome of one workload health probe against a recovery
// target. It is recorded into failover_step.detail so an operator (and the
// attestation) can see what was checked and what came back.
type ProbeResult struct {
	SiteID   string `json:"site_id"`
	Type     string `json:"type"`
	Target   string `json:"target"`
	Healthy  bool   `json:"healthy"`
	Attempts int    `json:"attempts"`
	// Detail carries the green/why-not signal: the HTTP status, the matched
	// body fragment, the dial result, or the SQL row, plus the error on failure.
	Detail string `json:"detail"`
	// LatencyMS is the wall-clock the successful (or final) attempt took.
	LatencyMS int64 `json:"latency_ms"`
}

// HealthProber runs a single workload health probe. The default
// netHealthProber does REAL network I/O (HTTP GET, TCP dial, pgx SELECT 1);
// tests can substitute a deterministic prober without changing the executor.
type HealthProber interface {
	Probe(ctx context.Context, probe model.HealthProbe) (ProbeResult, error)
}

// netHealthProber is the production prober: it performs real network I/O. It
// holds no state beyond an HTTP client so it is safe for concurrent use.
type netHealthProber struct {
	httpClient *http.Client
	// dial is the TCP dialer, injectable so a test can point it at a listener.
	dial func(ctx context.Context, network, address string, timeout time.Duration) (net.Conn, error)
	// sqlPing opens a short-lived pgx connection and runs SELECT 1, injectable
	// so a unit test need not stand up Postgres while the integration test does.
	sqlPing func(ctx context.Context, dsn string) error
}

// NewHealthProber builds the production HealthProber doing real network I/O.
func NewHealthProber() HealthProber {
	return &netHealthProber{
		httpClient: &http.Client{},
		dial: func(ctx context.Context, network, address string, timeout time.Duration) (net.Conn, error) {
			d := net.Dialer{Timeout: timeout}
			return d.DialContext(ctx, network, address)
		},
		sqlPing: defaultSQLPing,
	}
}

// defaultSQLPing opens a real pgx connection to dsn and runs SELECT 1.
func defaultSQLPing(ctx context.Context, dsn string) error {
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer func() { _ = conn.Close(ctx) }()
	var one int
	if err := conn.QueryRow(ctx, "SELECT 1").Scan(&one); err != nil {
		return fmt.Errorf("select 1: %w", err)
	}
	if one != 1 {
		return fmt.Errorf("select 1 returned %d", one)
	}
	return nil
}

// Probe runs the probe with its configured timeout and retries, returning the
// final result. A probe is healthy when ALL of: the transport succeeds AND any
// configured Expected match is satisfied. err is non-nil only on a programming
// error (unknown probe type / empty target); a transport/expectation failure is
// reported as ProbeResult.Healthy=false with no error so the caller can decide
// to keep retrying within the executor deadline.
func (p *netHealthProber) Probe(ctx context.Context, probe model.HealthProbe) (ProbeResult, error) {
	ptype := strings.TrimSpace(strings.ToLower(probe.Type))
	target := strings.TrimSpace(probe.Target)
	if target == "" {
		return ProbeResult{}, fmt.Errorf("health probe %q: target is required", ptype)
	}
	timeout := defaultProbeTimeout
	if probe.Timeout != "" {
		if d, err := time.ParseDuration(probe.Timeout); err == nil && d > 0 {
			timeout = d
		} else if err != nil {
			return ProbeResult{}, fmt.Errorf("health probe %q: invalid timeout %q: %w", ptype, probe.Timeout, err)
		}
	}
	retries := probe.Retries
	if retries <= 0 {
		retries = defaultProbeRetries
	}

	var (
		last     ProbeResult
		attempts int
	)
	for attempts < retries {
		attempts++
		start := time.Now()
		var (
			healthy bool
			detail  string
			err     error
		)
		switch ptype {
		case ProbeTypeHTTP, ProbeTypeK8sReady:
			healthy, detail, err = p.probeHTTP(ctx, target, probe.Expected, timeout)
		case ProbeTypeTCP:
			healthy, detail, err = p.probeTCP(ctx, target, timeout)
		case ProbeTypeSQL:
			healthy, detail, err = p.probeSQL(ctx, target, timeout)
		default:
			return ProbeResult{}, fmt.Errorf("health probe: unknown type %q (want http|tcp|sql|k8s_ready)", probe.Type)
		}
		last = ProbeResult{
			Type:      ptype,
			Target:    target,
			Healthy:   healthy,
			Attempts:  attempts,
			Detail:    detail,
			LatencyMS: time.Since(start).Milliseconds(),
		}
		if err != nil {
			last.Detail = err.Error()
		}
		if healthy {
			return last, nil
		}
		if attempts < retries {
			select {
			case <-ctx.Done():
				return last, nil
			case <-time.After(defaultProbeRetryDelay):
			}
		}
	}
	return last, nil
}

// probeHTTP issues a real HTTP GET and checks 2xx (and an optional Expected
// substring or "status:NNN"/"contains:..." directive in the body/status).
func (p *netHealthProber) probeHTTP(ctx context.Context, target, expected string, timeout time.Duration) (bool, string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, target, nil)
	if err != nil {
		return false, "", fmt.Errorf("build http request: %w", err)
	}
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return false, "", fmt.Errorf("http get: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	buf := make([]byte, 4096)
	n, _ := resp.Body.Read(buf)
	body := string(buf[:n])

	wantStatus, wantContains := parseExpected(expected)
	if wantStatus != 0 {
		ok := resp.StatusCode == wantStatus
		return ok, fmt.Sprintf("status=%d want=%d", resp.StatusCode, wantStatus), nil
	}
	statusOK := resp.StatusCode >= 200 && resp.StatusCode < 300
	if wantContains != "" {
		ok := statusOK && strings.Contains(body, wantContains)
		return ok, fmt.Sprintf("status=%d contains(%q)=%t", resp.StatusCode, wantContains, strings.Contains(body, wantContains)), nil
	}
	return statusOK, fmt.Sprintf("status=%d", resp.StatusCode), nil
}

// probeTCP performs a real TCP dial.
func (p *netHealthProber) probeTCP(ctx context.Context, target string, timeout time.Duration) (bool, string, error) {
	conn, err := p.dial(ctx, "tcp", target, timeout)
	if err != nil {
		return false, "", fmt.Errorf("tcp dial %s: %w", target, err)
	}
	_ = conn.Close()
	return true, fmt.Sprintf("dialed %s", target), nil
}

// probeSQL opens a real pgx connection and runs SELECT 1.
func (p *netHealthProber) probeSQL(ctx context.Context, dsn string, timeout time.Duration) (bool, string, error) {
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	if err := p.sqlPing(reqCtx, dsn); err != nil {
		return false, "", fmt.Errorf("sql probe: %w", err)
	}
	return true, "select 1 = 1", nil
}

// parseExpected interprets a HealthProbe.Expected directive. Forms:
//
//	"status:200"      -> require exact HTTP status
//	"contains:READY"  -> require the body to contain "READY"
//	"READY"           -> shorthand for contains:READY
//	""                -> any 2xx is healthy
func parseExpected(expected string) (status int, contains string) {
	e := strings.TrimSpace(expected)
	if e == "" {
		return 0, ""
	}
	switch {
	case strings.HasPrefix(e, "status:"):
		var n int
		if _, err := fmt.Sscanf(strings.TrimPrefix(e, "status:"), "%d", &n); err == nil {
			return n, ""
		}
		return 0, ""
	case strings.HasPrefix(e, "contains:"):
		return 0, strings.TrimPrefix(e, "contains:")
	default:
		return 0, e
	}
}

// WorkloadHealthValidator implements the failover.HealthValidator gate (§15.2):
// it runs EVERY consistency-group member's configured health probe and reports
// green/not-green for the VALIDATING->ATTESTED transition. It is DISTINCT from
// the data Validator: this proves the workload is up, not that the data matches.
//
// It is real and re-runnable: each call re-reads the group's recovery targets
// and re-probes them; a member with no configured probe is treated as healthy
// (nothing to prove) but recorded so the attestation timeline is explicit.
type WorkloadHealthValidator struct {
	repo        recoveryTargetReader
	runner      systemTxRunner
	prober      HealthProber
	appPlanner  AppVerificationPlanner
	appVerifier AppVerifier
	// deadline bounds how long ValidateRecoveredWorkloads waits for all members
	// to go green before reporting the failing members back to the driver
	// (which then drives ROLLED_BACK). Zero uses the default.
	deadline time.Duration
	now      func() time.Time
}

// recoveryTargetReader is the read surface the health validator needs.
type recoveryTargetReader interface {
	SystemListRecoveryTargetsByGroup(ctx context.Context, db repository.DBTX, groupID string) ([]*model.RecoveryTarget, error)
}

// AppVerificationPlanner resolves a recovery target into an executable
// application-aware verification plan. ok=false means the target has no app
// verification configured and the validator records it as skipped.
type AppVerificationPlanner interface {
	PlanAppVerification(ctx context.Context, run *model.FailoverRun, target *model.RecoveryTarget) (plan appverify.CheckPlan, ok bool, err error)
}

// AppVerifier executes an application-aware verification plan.
type AppVerifier interface {
	Execute(ctx context.Context, plan appverify.CheckPlan) (appverify.Result, error)
}

// AppVerificationPlannerFunc adapts a function to AppVerificationPlanner.
type AppVerificationPlannerFunc func(ctx context.Context, run *model.FailoverRun, target *model.RecoveryTarget) (appverify.CheckPlan, bool, error)

// PlanAppVerification implements AppVerificationPlanner.
func (f AppVerificationPlannerFunc) PlanAppVerification(ctx context.Context, run *model.FailoverRun, target *model.RecoveryTarget) (appverify.CheckPlan, bool, error) {
	return f(ctx, run, target)
}

// systemTxRunner runs a read against the pool without a tenant filter (the
// driver claims runs across tenants; §7 system path).
type systemTxRunner interface {
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

const defaultHealthDeadline = 2 * time.Minute

// NewWorkloadHealthValidator constructs the health gate.
func NewWorkloadHealthValidator(repo recoveryTargetReader, runner systemTxRunner, prober HealthProber, deadline time.Duration) *WorkloadHealthValidator {
	if prober == nil {
		prober = NewHealthProber()
	}
	if deadline <= 0 {
		deadline = defaultHealthDeadline
	}
	return &WorkloadHealthValidator{
		repo:     repo,
		runner:   runner,
		prober:   prober,
		deadline: deadline,
		now:      func() time.Time { return time.Now().UTC() },
	}
}

// WithAppVerification makes app-level verification part of the same
// VALIDATING->ATTESTED gate as workload health. When configured, every target
// with a planned app verification must pass the plan before attestation.
func (v *WorkloadHealthValidator) WithAppVerification(planner AppVerificationPlanner, verifier AppVerifier) *WorkloadHealthValidator {
	v.appPlanner = planner
	if verifier == nil {
		verifier = appverify.NewExecutor(appverify.ExecutorConfig{})
	}
	v.appVerifier = verifier
	return v
}

// ErrWorkloadUnhealthy is returned by ValidateRecoveredWorkloads when at least
// one member's health probe never went green within the deadline. The driver
// maps this to a failed gate (which rolls the run back).
var ErrWorkloadUnhealthy = errors.New("dr: recovered workload health probe not green")

// ErrAppVerificationFailed is returned by ValidateRecoveredWorkloads when the
// app-level verification plan for at least one recovered workload fails. The
// failover driver treats it as a gate failure and does not attest the run.
var ErrAppVerificationFailed = errors.New("dr: recovered application verification failed")

// ValidateRecoveredWorkloads runs every member's probe until all are green or
// the deadline trips. It returns the per-member probe results in detail; on a
// member that never goes green it returns ErrWorkloadUnhealthy so the driver
// fails the gate and rolls back (§6.3, §15.2).
func (v *WorkloadHealthValidator) ValidateRecoveredWorkloads(ctx context.Context, run *model.FailoverRun) (map[string]any, error) {
	var targets []*model.RecoveryTarget
	if err := v.runner.RunSystemRead(ctx, func(tx repository.DBTX) error {
		var err error
		targets, err = v.repo.SystemListRecoveryTargetsByGroup(ctx, tx, run.GroupID)
		return err
	}); err != nil {
		return nil, fmt.Errorf("loading recovery targets for health gate: %w", err)
	}

	deadline := v.now().Add(v.deadline)
	results := make([]ProbeResult, 0, len(targets))
	allHealthy := true
	var unhealthy []string

	for _, t := range targets {
		if strings.TrimSpace(t.HealthProbe.Type) == "" {
			// No probe configured for this member — nothing to prove; record it.
			results = append(results, ProbeResult{SiteID: t.SiteID, Type: "none", Healthy: true, Detail: "no health probe configured"})
			continue
		}
		res, healthy := v.probeUntilGreen(ctx, t, deadline)
		res.SiteID = t.SiteID
		results = append(results, res)
		if !healthy {
			allHealthy = false
			unhealthy = append(unhealthy, t.SiteID)
		}
	}

	detail := map[string]any{
		"members_probed": len(targets),
		"all_healthy":    allHealthy,
		"probes":         results,
	}
	if !allHealthy {
		detail["unhealthy_members"] = unhealthy
		return detail, fmt.Errorf("%w: members %v", ErrWorkloadUnhealthy, unhealthy)
	}

	appDetail, err := v.validateApplications(ctx, run, targets)
	if appDetail != nil {
		detail["app_verification"] = appDetail
	}
	if err != nil {
		return detail, err
	}
	return detail, nil
}

func (v *WorkloadHealthValidator) validateApplications(ctx context.Context, run *model.FailoverRun, targets []*model.RecoveryTarget) (map[string]any, error) {
	if v.appPlanner == nil || v.appVerifier == nil {
		return nil, nil
	}
	results := make([]map[string]any, 0, len(targets))
	failed := make([]string, 0)
	planned := 0
	for _, t := range targets {
		plan, ok, err := v.appPlanner.PlanAppVerification(ctx, run, t)
		if err != nil {
			failed = append(failed, t.SiteID)
			results = append(results, map[string]any{
				"site_id": t.SiteID,
				"planned": false,
				"passed":  false,
				"error":   err.Error(),
			})
			continue
		}
		if !ok {
			results = append(results, map[string]any{
				"site_id": t.SiteID,
				"planned": false,
				"passed":  true,
				"detail":  "no app verification configured",
			})
			continue
		}
		planned++
		result, err := v.appVerifier.Execute(ctx, plan)
		row := map[string]any{
			"site_id": t.SiteID,
			"planned": true,
			"passed":  result.Passed,
			"result":  result,
		}
		if err != nil {
			row["error"] = err.Error()
		}
		results = append(results, row)
		if err != nil || !result.Passed {
			failed = append(failed, t.SiteID)
		}
	}
	detail := map[string]any{
		"enabled":           true,
		"workloads_planned": planned,
		"all_passed":        len(failed) == 0,
		"results":           results,
	}
	if len(failed) > 0 {
		detail["failed_members"] = failed
		return detail, fmt.Errorf("%w: members %v", ErrAppVerificationFailed, failed)
	}
	return detail, nil
}

// probeUntilGreen retries a member's probe until green, the deadline, or ctx
// cancellation. Each Probe call already honours its own per-attempt
// timeout/retries; this adds the executor-level deadline so a permanently-down
// workload trips ROLLED_BACK rather than hanging.
func (v *WorkloadHealthValidator) probeUntilGreen(ctx context.Context, t *model.RecoveryTarget, deadline time.Time) (ProbeResult, bool) {
	var last ProbeResult
	for {
		res, err := v.prober.Probe(ctx, t.HealthProbe)
		if err != nil {
			// Programming/config error (unknown type, empty target): surface it
			// as an unhealthy result; retrying will not fix it.
			return ProbeResult{Type: t.HealthProbe.Type, Target: t.HealthProbe.Target, Healthy: false, Detail: err.Error()}, false
		}
		last = res
		if res.Healthy {
			return res, true
		}
		if v.now().After(deadline) || ctx.Err() != nil {
			return last, false
		}
		select {
		case <-ctx.Done():
			return last, false
		case <-time.After(defaultProbeRetryDelay):
		}
	}
}
