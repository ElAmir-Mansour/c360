package recover

import (
	"context"
	"errors"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/recover/metastore"
)

// ErrAnalyticsNotEntitled is returned when a tenant requests the cross-sub-solution
// analytics without ANY Recover entitlement. The analytics surface is the
// product-wide portfolio view, so a tenant entitled to any one of the three
// sub-solutions may read it; a tenant entitled to none is denied. The router maps
// this to HTTP 402 (upgrade), matching the gateway's suite-denial semantics.
var ErrAnalyticsNotEntitled = errors.New("recover: tenant is not entitled to any Recover sub-solution")

// ---------------------------------------------------------------------------
// Analytics payload types (the GET /api/recover/analytics shape).
// ---------------------------------------------------------------------------

// RecoveryEvent is one real recovery/rehearsal execution captured against an
// application: the source record kind, its outcome, and the RTA it achieved
// (seconds, completed_at - started_at). It is the per-event grain the contract
// promises. Source is one of the AnalyticsSource* constants; the RTA is only
// populated once the event reached a terminal, completed state.
type RecoveryEvent struct {
	EventID         string     `json:"event_id"`
	Source          string     `json:"source"`
	RunbookID       string     `json:"runbook_id,omitempty"`
	Mode            string     `json:"mode"`
	Status          string     `json:"status"`
	Succeeded       bool       `json:"succeeded"`
	RTAActualSecond *int       `json:"rta_actual_seconds,omitempty"`
	StartedAt       time.Time  `json:"started_at"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
}

// ApplicationAnalytics is the per-application RTO-vs-RTA view: the RTO target
// resolved from the Metastore seam, the latest captured RTA from real execution
// records, whether that RTA breaches the target, the application's readiness
// score, and the recovery events the metrics were derived from (newest first,
// bounded).
type ApplicationAnalytics struct {
	ApplicationID    string `json:"application_id"`
	AppKey           string `json:"app_key"`
	Name             string `json:"name"`
	RecoveryTier     string `json:"recovery_tier"`
	RTOTargetSeconds int    `json:"rto_target_seconds"`
	// LatestRTASeconds is the RTA of the most recent COMPLETED recovery event for
	// the application, or nil when the application has no completed execution yet.
	LatestRTASeconds *int `json:"latest_rta_seconds,omitempty"`
	// RTABreach is true when LatestRTASeconds exceeds RTOTargetSeconds (a missed
	// objective). False when within target or when there is no captured RTA.
	RTABreach bool `json:"rta_breach"`
	// BreachSeconds is how far the latest RTA exceeded the target (seconds), 0 when
	// within target or uncaptured.
	BreachSeconds int `json:"breach_seconds"`
	// ExecutionCount is the total number of recovery events captured for the app.
	ExecutionCount int `json:"execution_count"`
	// SuccessCount is how many of those events completed successfully.
	SuccessCount int `json:"success_count"`
	// Readiness is the per-application readiness score (0..100) derived from its
	// real execution history and RTO attainment.
	Readiness int `json:"readiness"`
	// Events is a bounded, newest-first window of the real recovery events.
	Events []RecoveryEvent `json:"events"`
}

// RecoveryProgress is the multi-application recovery progress: how many of the
// tenant's applications have a current, in-target recovery posture versus how
// many are lagging or untested, with the in-progress (live, non-terminal) count.
type RecoveryProgress struct {
	TotalApplications int `json:"total_applications"`
	// Recovered is the count of applications whose latest completed event was a
	// success within the RTO target.
	Recovered int `json:"recovered"`
	// AtRisk is the count whose latest completed event breached the RTO target.
	AtRisk int `json:"at_risk"`
	// Untested is the count with no completed recovery event yet.
	Untested int `json:"untested"`
	// InProgress is the count with a live (running/pending) execution right now.
	InProgress int `json:"in_progress"`
	// CompletionRatio is Recovered / TotalApplications (0..1), the portfolio
	// recovery-readiness fraction.
	CompletionRatio float64 `json:"completion_ratio"`
}

// Bottleneck is one flagged problem area across the portfolio: an application
// (or recovery scope) whose recovery posture warrants attention, ranked by
// severity so the dashboard surfaces the worst first.
type Bottleneck struct {
	Kind          string `json:"kind"`
	ApplicationID string `json:"application_id,omitempty"`
	AppKey        string `json:"app_key,omitempty"`
	Label         string `json:"label"`
	Detail        string `json:"detail"`
	// Severity is a 0..1 ranking weight (higher = worse) used to sort the list.
	Severity float64 `json:"severity"`
}

// ReadinessTrendPoint is one historical portfolio-readiness capture, for plotting
// the readiness trend over time.
type ReadinessTrendPoint struct {
	Score            int       `json:"score"`
	ApplicationCount int       `json:"application_count"`
	BreachingCount   int       `json:"breaching_count"`
	CapturedAt       time.Time `json:"captured_at"`
}

// AnalyticsView is the full GET /api/recover/analytics payload: per-application
// RTO-vs-RTA, the portfolio readiness score, multi-application recovery progress,
// the readiness trend, and the top flagged bottlenecks. Every metric is computed
// from real persisted execution records and the Metastore RTO seam.
type AnalyticsView struct {
	PortfolioReadiness int                    `json:"portfolio_readiness"`
	Progress           RecoveryProgress       `json:"progress"`
	Applications       []ApplicationAnalytics `json:"applications"`
	Bottlenecks        []Bottleneck           `json:"bottlenecks"`
	ReadinessTrend     []ReadinessTrendPoint  `json:"readiness_trend"`
	GeneratedAt        time.Time              `json:"generated_at"`
}

// ---------------------------------------------------------------------------
// Source/kind constants and tuning.
// ---------------------------------------------------------------------------

const (
	// AnalyticsSourceRunbookRun is a runbookstudio run (the RTA grain joined to an
	// application via the Metastore runbook link).
	AnalyticsSourceRunbookRun = "runbook_run"
	// AnalyticsSourceDrill is a scheduled-drill result (drillsched).
	AnalyticsSourceDrill = "drill"
	// AnalyticsSourceFailover is a failover-run history record.
	AnalyticsSourceFailover = "failover"

	bottleneckBreach   = "rto_breach"
	bottleneckUntested = "untested_application"
	bottleneckFailing  = "failing_recovery"
)

const (
	// analyticsEventWindow bounds the per-application event list returned in the
	// payload so a long-lived application never returns its full history inline.
	analyticsEventWindow = 10
	// analyticsTopBottlenecks bounds the surfaced bottleneck list (worst first).
	analyticsTopBottlenecks = 10
	// analyticsTrendWindow is the trailing window over which the readiness trend
	// is read.
	analyticsTrendWindow = 180 * 24 * time.Hour
	// analyticsTrendLimit bounds the number of trend points returned.
	analyticsTrendLimit = 60
	// analyticsAppScanLimit bounds how many applications a single analytics
	// computation scans (enterprise estates paginate via the contract's `page`).
	analyticsAppScanLimit = 200

	// Per-application readiness weights (documented; no magic in the math).
	appReadinessWeightTested = 0.50 // has been recovery-tested at all
	appReadinessWeightTarget = 0.30 // latest RTA met the RTO target
	appReadinessWeightSucces = 0.20 // historical success ratio
)

// ---------------------------------------------------------------------------
// Service dependencies.
// ---------------------------------------------------------------------------

// AnalyticsMetastore is the read seam the analytics layer sources the RTO TARGET
// (and the application universe) from — the Metastore seam (Prompt 7). It is the
// MetastoreClient interface narrowed to the reads analytics needs, so the
// analytics service never depends on the concrete registry and a future Metastore
// product swaps in transparently. RTO is ALWAYS resolved here, never hardcoded.
type AnalyticsMetastore interface {
	ListApplications(ctx context.Context, tenantID uuid.UUID, limit, offset int) (metastore.ListPage, error)
}

// AnalyticsStore is the read-only persistence surface the analytics layer reads
// the captured RTA from: the EXISTING execution records owned by the dr/* and
// runbookstudio services (dr_studio_run joined to applications via the Metastore
// runbook link; dr_drill_result; failover_run) plus the readiness-trend snapshot
// it appends. It never writes to the dr/* tables and never reimplements their
// orchestration. Every read is RLS-scoped to the tenant via the caller's
// transaction (the DBTX).
type AnalyticsStore interface {
	// RecoveryEventsForApplications returns the recovery/rehearsal execution
	// records for the given application ids, keyed by application id, newest first.
	// The join from application to runbook run is the Metastore runbook link; the
	// per-application list is bounded to `perApp` events (no N+1 — one query over
	// all ids). appRunbookLinks maps application id → its linked runbook ids.
	RecoveryEventsForApplications(ctx context.Context, db repository.DBTX, appRunbookLinks map[string][]string, perApp int) (map[string][]RecoveryEvent, error)
	// AppendReadinessSnapshot appends one immutable portfolio-readiness snapshot
	// (append-only; the store has no update/delete path).
	AppendReadinessSnapshot(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, snap ReadinessSnapshot, now time.Time) error
	// ReadinessTrend returns the tenant's readiness snapshots over the window
	// ending at now, newest first, bounded to limit points.
	ReadinessTrend(ctx context.Context, db repository.DBTX, since time.Time, limit int) ([]ReadinessTrendPoint, error)
}

// ReadinessSnapshot is the value AppendReadinessSnapshot persists: the computed
// portfolio score, the denominators, and the component breakdown that produced
// it (key→fraction).
type ReadinessSnapshot struct {
	Score            int
	ApplicationCount int
	BreachingCount   int
	Components       map[string]float64
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

// AnalyticsConfig wires the AnalyticsService.
type AnalyticsConfig struct {
	// Runner runs tenant-scoped transactions (read for the events/trend read;
	// write to append the readiness snapshot).
	Runner TenantRunner
	// Metastore is the RTO seam (Prompt 7) the analytics layer sources the RTO
	// target and the application universe from.
	Metastore AnalyticsMetastore
	// Store reads the captured RTA from the execution records and persists the
	// readiness-trend snapshot.
	Store AnalyticsStore
	// Entitlements resolves the recover.* keys per tenant via the existing
	// licensing engine — the same resolver the product view uses.
	Entitlements EntitlementResolver
	// Metrics is the per-instance analytics metrics; nil is safe (unmetered).
	Metrics *AnalyticsMetrics
	// Logger is required.
	Logger zerolog.Logger
	// Now is injectable for deterministic tests; defaults to time.Now().UTC().
	Now func() time.Time
}

// AnalyticsService is the cross-sub-solution RTO/RTA & recovery analytics layer.
// It COMPOSES the Metastore seam (RTO target + application universe) and the
// EXISTING execution records (runbookstudio runs, drill results, failover-run
// history) into the portfolio analytics the landing page and every sub-solution
// overview consume. It owns no recovery logic and never reimplements the dr/*
// services; the only state it persists is the append-only readiness-trend
// snapshot. Every request is gated server-side on a Recover entitlement before
// any data is read.
type AnalyticsService struct {
	runner       TenantRunner
	metastore    AnalyticsMetastore
	store        AnalyticsStore
	entitlements EntitlementResolver
	metrics      *AnalyticsMetrics
	logger       zerolog.Logger
	now          func() time.Time
}

// NewAnalyticsService validates the config and constructs the service.
func NewAnalyticsService(cfg AnalyticsConfig) (*AnalyticsService, error) {
	if cfg.Runner == nil {
		return nil, errors.New("recover analytics service: runner is required")
	}
	if cfg.Metastore == nil {
		return nil, errors.New("recover analytics service: metastore is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("recover analytics service: store is required")
	}
	if cfg.Entitlements == nil {
		return nil, errors.New("recover analytics service: entitlement resolver is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &AnalyticsService{
		runner:       cfg.Runner,
		metastore:    cfg.Metastore,
		store:        cfg.Store,
		entitlements: cfg.Entitlements,
		metrics:      cfg.Metrics,
		logger:       cfg.Logger.With().Str("service", "recover-analytics").Logger(),
		now:          now,
	}, nil
}

// Analytics resolves the cross-sub-solution analytics for a tenant. It first
// gates on a Recover entitlement (any of the three sub-solution keys grants the
// portfolio view; none denies it — server-side, never UI-only). It then sources
// the RTO target + application universe from the Metastore seam, reads the
// captured RTA from the real execution records (one bounded query, no N+1),
// derives per-application RTO-vs-RTA + readiness, the multi-application progress,
// the top bottlenecks, and the readiness trend, and appends an immutable
// readiness snapshot so the trend grows. authorization is the caller's bearer
// header, forwarded to the licensing engine.
func (s *AnalyticsService) Analytics(ctx context.Context, tenantID uuid.UUID, authorization string) (*AnalyticsView, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover: tenant id is required")
	}

	entitled, err := s.anyEntitlement(ctx, tenantID, authorization)
	if err != nil {
		return nil, err // ErrEntitlementUnavailable bubbles to a 503
	}
	if !entitled {
		return nil, ErrAnalyticsNotEntitled
	}

	// 1. RTO source: the Metastore seam supplies the application universe and the
	// RTO target per application (never hardcoded).
	page, err := s.metastore.ListApplications(ctx, tenantID, analyticsAppScanLimit, 0)
	if err != nil {
		return nil, err
	}

	now := s.now()

	// Build the application→runbook-link map (the join the RTA read uses) and the
	// app id → metadata map in one pass over the resolved applications.
	linkMap := make(map[string][]string, len(page.Applications))
	for i := range page.Applications {
		app := &page.Applications[i]
		ids := make([]string, 0, len(app.LinkedRunbooks))
		for _, l := range app.LinkedRunbooks {
			ids = append(ids, l.RunbookID)
		}
		linkMap[app.ID] = ids
	}

	// 2. RTA source: the real execution records, plus the readiness trend, in ONE
	// read transaction.
	var (
		eventsByApp map[string][]RecoveryEvent
		trend       []ReadinessTrendPoint
	)
	err = s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		if eventsByApp, rerr = s.store.RecoveryEventsForApplications(ctx, db, linkMap, analyticsEventWindow); rerr != nil {
			return rerr
		}
		if trend, rerr = s.store.ReadinessTrend(ctx, db, now.Add(-analyticsTrendWindow), analyticsTrendLimit); rerr != nil {
			return rerr
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	// 3. Derive the per-application analytics, progress, portfolio readiness, and
	// bottlenecks from the joined RTO (Metastore) + RTA (execution records).
	apps := make([]ApplicationAnalytics, 0, len(page.Applications))
	for i := range page.Applications {
		apps = append(apps, deriveApplicationAnalytics(&page.Applications[i], eventsByApp[page.Applications[i].ID]))
	}
	sort.SliceStable(apps, func(i, j int) bool { return apps[i].Readiness < apps[j].Readiness })

	progress := deriveProgress(apps)
	portfolio, components := derivePortfolioReadiness(apps)
	bottlenecks := deriveBottlenecks(apps)

	// 4. Append the readiness snapshot (append-only) so the trend grows, then put
	// the just-captured point at the head of the returned trend so the dashboard
	// reflects the live value immediately.
	snap := ReadinessSnapshot{
		Score:            portfolio,
		ApplicationCount: len(apps),
		BreachingCount:   progress.AtRisk,
		Components:       components,
	}
	if err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		return s.store.AppendReadinessSnapshot(ctx, db, tenantID, snap, now)
	}); err != nil {
		return nil, err
	}
	trend = prependTrendPoint(trend, ReadinessTrendPoint{
		Score:            portfolio,
		ApplicationCount: len(apps),
		BreachingCount:   progress.AtRisk,
		CapturedAt:       now,
	}, analyticsTrendLimit)

	s.metrics.observeAnalytics(len(apps), progress.AtRisk, portfolio)
	s.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Int("applications", len(apps)).
		Int("portfolio_readiness", portfolio).
		Int("at_risk", progress.AtRisk).
		Msg("resolved recover analytics")

	return &AnalyticsView{
		PortfolioReadiness: portfolio,
		Progress:           progress,
		Applications:       apps,
		Bottlenecks:        bottlenecks,
		ReadinessTrend:     trend,
		GeneratedAt:        now,
	}, nil
}

// anyEntitlement reports whether the tenant is entitled to ANY Recover
// sub-solution. The portfolio analytics is a product-wide view, so any single
// sub-solution grant authorizes it. A licensing outage on the FIRST key bubbles
// as ErrEntitlementUnavailable (fail-closed); a clean "not licensed" is checked
// against the remaining keys before denying.
func (s *AnalyticsService) anyEntitlement(ctx context.Context, tenantID uuid.UUID, authorization string) (bool, error) {
	for _, key := range []string{EntitlementITDR, EntitlementCloudDR, EntitlementCyberRecovery} {
		active, _, err := s.entitlements.Resolve(ctx, tenantID.String(), authorization, key)
		if err != nil {
			return false, err
		}
		if active {
			return true, nil
		}
	}
	return false, nil
}

// ---------------------------------------------------------------------------
// Pure derivation functions (fully explainable; no hidden inputs).
// ---------------------------------------------------------------------------

// deriveApplicationAnalytics computes one application's RTO-vs-RTA view from its
// Metastore metadata (the RTO target) and its real recovery events (the RTA). It
// is a pure function of those two inputs.
func deriveApplicationAnalytics(app *metastore.Application, events []RecoveryEvent) ApplicationAnalytics {
	out := ApplicationAnalytics{
		ApplicationID:    app.ID,
		AppKey:           app.AppKey,
		Name:             app.Name,
		RecoveryTier:     app.RecoveryTier,
		RTOTargetSeconds: app.RTOTargetSeconds,
		Events:           events,
	}
	if out.Events == nil {
		out.Events = []RecoveryEvent{}
	}

	var latestCompleted *RecoveryEvent
	for i := range events {
		ev := &events[i]
		out.ExecutionCount++
		if ev.Succeeded {
			out.SuccessCount++
		}
		// Events are newest-first; the first one with a captured RTA is the latest
		// completed execution.
		if latestCompleted == nil && ev.RTAActualSecond != nil {
			latestCompleted = ev
		}
	}

	if latestCompleted != nil && latestCompleted.RTAActualSecond != nil {
		rta := *latestCompleted.RTAActualSecond
		out.LatestRTASeconds = &rta
		if app.RTOTargetSeconds > 0 && rta > app.RTOTargetSeconds {
			out.RTABreach = true
			out.BreachSeconds = rta - app.RTOTargetSeconds
		}
	}

	out.Readiness = appReadiness(out)
	return out
}

// appReadiness derives the per-application readiness score (0..100): tested at all
// (weight 0.50), latest RTA within target (0.30), historical success ratio (0.20).
func appReadiness(a ApplicationAnalytics) int {
	tested := 0.0
	if a.ExecutionCount > 0 {
		tested = 1.0
	}
	target := 0.0
	if a.LatestRTASeconds != nil && !a.RTABreach {
		target = 1.0
	}
	success := 0.0
	if a.ExecutionCount > 0 {
		success = float64(a.SuccessCount) / float64(a.ExecutionCount)
	}
	weighted := appReadinessWeightTested*tested + appReadinessWeightTarget*target + appReadinessWeightSucces*success
	return clampScore(int(math.Round(weighted * 100)))
}

// deriveProgress computes the multi-application recovery progress over the derived
// per-application views.
func deriveProgress(apps []ApplicationAnalytics) RecoveryProgress {
	p := RecoveryProgress{TotalApplications: len(apps)}
	for i := range apps {
		a := &apps[i]
		hasLive := false
		for j := range a.Events {
			if !isTerminalAnalyticsStatus(a.Events[j].Status) {
				hasLive = true
				break
			}
		}
		if hasLive {
			p.InProgress++
		}
		switch {
		case a.LatestRTASeconds == nil:
			p.Untested++
		case a.RTABreach:
			p.AtRisk++
		default:
			p.Recovered++
		}
	}
	if p.TotalApplications > 0 {
		p.CompletionRatio = roundFraction(float64(p.Recovered) / float64(p.TotalApplications))
	}
	return p
}

// derivePortfolioReadiness averages the per-application readiness into a portfolio
// score and returns the component breakdown that produced it (for the snapshot).
// An empty estate scores zero with explained components.
func derivePortfolioReadiness(apps []ApplicationAnalytics) (int, map[string]float64) {
	if len(apps) == 0 {
		return 0, map[string]float64{"tested_coverage": 0, "rto_attainment": 0, "success_ratio": 0}
	}
	var testedSum, targetSum, successSum float64
	for i := range apps {
		a := &apps[i]
		if a.ExecutionCount > 0 {
			testedSum++
			successSum += float64(a.SuccessCount) / float64(a.ExecutionCount)
		}
		if a.LatestRTASeconds != nil && !a.RTABreach {
			targetSum++
		}
	}
	n := float64(len(apps))
	components := map[string]float64{
		"tested_coverage": roundFraction(testedSum / n),
		"rto_attainment":  roundFraction(targetSum / n),
		"success_ratio":   roundFraction(successSum / n),
	}
	weighted := appReadinessWeightTested*components["tested_coverage"] +
		appReadinessWeightTarget*components["rto_attainment"] +
		appReadinessWeightSucces*components["success_ratio"]
	return clampScore(int(math.Round(weighted * 100))), components
}

// deriveBottlenecks flags the portfolio's worst recovery problem areas, ranked by
// severity (worst first), bounded to the top N. The three kinds: an RTO breach
// (latest RTA over target), a failing recovery (a completed event that failed),
// and an untested mission-critical/tier-1 application.
func deriveBottlenecks(apps []ApplicationAnalytics) []Bottleneck {
	var out []Bottleneck
	for i := range apps {
		a := &apps[i]
		switch {
		case a.RTABreach && a.LatestRTASeconds != nil:
			over := float64(a.BreachSeconds)
			target := math.Max(1, float64(a.RTOTargetSeconds))
			sev := math.Min(1, over/target)
			out = append(out, Bottleneck{
				Kind:          bottleneckBreach,
				ApplicationID: a.ApplicationID,
				AppKey:        a.AppKey,
				Label:         a.Name + " missed its RTO target",
				Detail:        "latest recovery took " + itoa(*a.LatestRTASeconds) + "s vs a " + itoa(a.RTOTargetSeconds) + "s target (" + itoa(a.BreachSeconds) + "s over)",
				Severity:      roundFraction(0.6 + 0.4*sev),
			})
		case a.ExecutionCount > 0 && a.SuccessCount == 0:
			out = append(out, Bottleneck{
				Kind:          bottleneckFailing,
				ApplicationID: a.ApplicationID,
				AppKey:        a.AppKey,
				Label:         a.Name + " has no successful recovery",
				Detail:        "every captured recovery event for this application failed",
				Severity:      0.8,
			})
		case a.ExecutionCount == 0 && isCriticalTier(a.RecoveryTier):
			out = append(out, Bottleneck{
				Kind:          bottleneckUntested,
				ApplicationID: a.ApplicationID,
				AppKey:        a.AppKey,
				Label:         a.Name + " is untested",
				Detail:        "a " + a.RecoveryTier + " application with no recovery rehearsal or execution on record",
				Severity:      0.5,
			})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Severity > out[j].Severity })
	if len(out) > analyticsTopBottlenecks {
		out = out[:analyticsTopBottlenecks]
	}
	if out == nil {
		out = []Bottleneck{}
	}
	return out
}

// prependTrendPoint puts the just-captured readiness point at the head of the
// trend (so the dashboard shows the live value immediately) and bounds the slice.
func prependTrendPoint(trend []ReadinessTrendPoint, head ReadinessTrendPoint, limit int) []ReadinessTrendPoint {
	out := make([]ReadinessTrendPoint, 0, len(trend)+1)
	out = append(out, head)
	out = append(out, trend...)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func isCriticalTier(tier string) bool {
	return tier == metastore.TierMissionCritical || tier == metastore.TierOne
}

// isTerminalAnalyticsStatus reports whether an execution-record status is a final
// state (so a run not in a terminal state is "in progress"). It recognises both
// the runbookstudio and failover/drill vocabularies.
func isTerminalAnalyticsStatus(status string) bool {
	switch status {
	case "completed", "failed", "aborted", "passed",
		"COMPLETED", "FAILED", "CANCELLED", "ROLLED_BACK":
		return true
	default:
		return false
	}
}

func clampScore(n int) int {
	if n < 0 {
		return 0
	}
	if n > 100 {
		return 100
	}
	return n
}

// roundFraction rounds a 0..1 fraction to 4 decimals so JSON payloads are stable.
func roundFraction(f float64) float64 {
	return math.Round(f*10000) / 10000
}
