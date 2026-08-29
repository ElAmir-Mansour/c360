package recover

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// ErrITDRNotEntitled is returned when a tenant requests the IT DR workspace
// overview without the recover.it_dr entitlement. The router maps it to HTTP 402
// (payment required / upgrade), matching the gateway's suite-denial semantics.
var ErrITDRNotEntitled = errors.New("recover: tenant is not entitled to IT Disaster Recovery")

// ---------------------------------------------------------------------------
// Overview payload types (the GET /api/recover/it-dr/overview shape).
// ---------------------------------------------------------------------------

// RunbookSummary is one row of the IT DR runbook inventory: identity, authoring
// status/source, task count, and how many runs are currently active over it.
type RunbookSummary struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Status     string    `json:"status"`
	Source     string    `json:"source"`
	GroupID    *string   `json:"group_id,omitempty"`
	TaskCount  int       `json:"task_count"`
	ActiveRuns int       `json:"active_runs"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// RunbookInventory is the tenant's runbook inventory: a bounded page of runbooks
// (newest first), the total across the estate, and the per-status breakdown over
// ALL of the tenant's runbooks (not just the page).
type RunbookInventory struct {
	Total    int              `json:"total"`
	Page     int              `json:"page"`
	PerPage  int              `json:"per_page"`
	ByStatus map[string]int   `json:"by_status"`
	Items    []RunbookSummary `json:"items"`
}

// RehearsalRun is the tenant's most recent rehearsal-mode run.
type RehearsalRun struct {
	RunID                      string     `json:"run_id"`
	RunbookID                  string     `json:"runbook_id"`
	RunbookName                string     `json:"runbook_name"`
	Status                     string     `json:"status"`
	StartedAt                  time.Time  `json:"started_at"`
	CompletedAt                *time.Time `json:"completed_at,omitempty"`
	ActualDurationSeconds      *int       `json:"actual_duration_seconds,omitempty"`
	PlannedCriticalPathSeconds int        `json:"planned_critical_path_seconds"`
}

// UpcomingRehearsal is the soonest future scheduled drill (the next rehearsal
// cadence to fire) for the tenant.
type UpcomingRehearsal struct {
	ScheduleID string    `json:"schedule_id"`
	Name       string    `json:"name"`
	GroupID    string    `json:"group_id"`
	Profile    string    `json:"profile"`
	NextRun    time.Time `json:"next_run"`
}

// ApprovalItem is one approval-gate task awaiting sign-off on an active run.
type ApprovalItem struct {
	RunID              string    `json:"run_id"`
	RunbookID          string    `json:"runbook_id"`
	RunbookName        string    `json:"runbook_name"`
	TaskID             string    `json:"task_id"`
	TaskName           string    `json:"task_name"`
	RunMode            string    `json:"run_mode"`
	RequiredPermission string    `json:"required_permission,omitempty"`
	AwaitingSince      time.Time `json:"awaiting_since"`
}

// OpenApprovals is the set of approval gates currently blocking active runs: the
// exact total plus a bounded surfaced list.
type OpenApprovals struct {
	Total int            `json:"total"`
	Items []ApprovalItem `json:"items"`
}

// RehearsalStats are rehearsal-run outcome counts over the readiness window.
type RehearsalStats struct {
	Total     int `json:"total"`
	Completed int `json:"completed"`
}

// ReadinessScore is the IT DR readiness computed from real persisted state, with
// its component breakdown surfaced so the score is explainable (never a canned
// number). Score is 0..100.
type ReadinessScore struct {
	Score      int                  `json:"score"`
	Components []ReadinessComponent `json:"components"`
}

// ReadinessComponent is one weighted contributor to the readiness score, with
// the human-readable basis for the value.
type ReadinessComponent struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Weight float64 `json:"weight"`
	Value  float64 `json:"value"` // 0..1 attainment of this component
	Detail string  `json:"detail"`
}

// ITDROverview is the full GET /api/recover/it-dr/overview payload: the runbook
// inventory, the readiness score computed from real state, the upcoming and last
// rehearsal, and the open approval gates blocking active runs.
type ITDROverview struct {
	SubSolution       string             `json:"sub_solution"`
	Readiness         ReadinessScore     `json:"readiness"`
	Inventory         RunbookInventory   `json:"inventory"`
	LastRehearsal     *RehearsalRun      `json:"last_rehearsal,omitempty"`
	UpcomingRehearsal *UpcomingRehearsal `json:"upcoming_rehearsal,omitempty"`
	OpenApprovals     OpenApprovals      `json:"open_approvals"`
	GeneratedAt       time.Time          `json:"generated_at"`
}

// ---------------------------------------------------------------------------
// Readiness weights / windows (documented, deterministic; no magic in the SQL).
// ---------------------------------------------------------------------------

const (
	// readinessWindow is the trailing window over which rehearsal recency and
	// success feed the readiness score. A rehearsal older than this contributes
	// nothing to the recency component.
	readinessWindow = 90 * 24 * time.Hour

	// readinessWeightPublished rewards having executable (published) runbooks
	// rather than drafts.
	readinessWeightPublished = 0.40
	// readinessWeightRehearsal rewards a recent, successful rehearsal cadence.
	readinessWeightRehearsal = 0.40
	// readinessWeightApprovals rewards an empty approval backlog on active runs.
	readinessWeightApprovals = 0.20

	// approvalBacklogFloor is the open-approval count at which the approval
	// component reaches zero (a fully saturated backlog). Between 0 and this it
	// degrades linearly.
	approvalBacklogFloor = 5
)

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

// ITDRConfig wires the ITDRService.
type ITDRConfig struct {
	// Runner runs tenant-scoped read transactions (RLS-isolated).
	Runner TenantRunner
	// Store reads the composed IT-DR state from the dr/* tables.
	Store ITDROverviewStore
	// Entitlements resolves the recover.it_dr key per tenant via the existing
	// licensing engine — the same resolver the product view uses.
	Entitlements EntitlementResolver
	// Logger is required.
	Logger zerolog.Logger
	// Now is injectable for deterministic tests; defaults to time.Now().UTC().
	Now func() time.Time
}

// ITDRService composes the existing IT DR capabilities (runbook studio, drill
// scheduler) into one product-surface overview for the Recover IT DR
// sub-solution. It owns NO recovery logic — it reads real persisted state via
// the read-only overview store and derives the readiness score. Every request
// is gated on the recover.it_dr entitlement server-side before any data is read.
type ITDRService struct {
	runner       TenantRunner
	store        ITDROverviewStore
	entitlements EntitlementResolver
	logger       zerolog.Logger
	now          func() time.Time
}

// NewITDRService validates the config and constructs the service.
func NewITDRService(cfg ITDRConfig) (*ITDRService, error) {
	if cfg.Runner == nil {
		return nil, errors.New("recover it-dr service: runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("recover it-dr service: store is required")
	}
	if cfg.Entitlements == nil {
		return nil, errors.New("recover it-dr service: entitlement resolver is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &ITDRService{
		runner:       cfg.Runner,
		store:        cfg.Store,
		entitlements: cfg.Entitlements,
		logger:       cfg.Logger.With().Str("service", "recover-it-dr").Logger(),
		now:          now,
	}, nil
}

// Overview resolves the IT DR sub-solution overview for a tenant: it first gates
// on the recover.it_dr entitlement (server-side, never UI-only), then reads the
// runbook inventory, the last/upcoming rehearsal, and the open approval gates in
// ONE read transaction (no N+1 — each is a single bounded/aggregate query), and
// computes the readiness score from that real state. authorization is the
// caller's bearer header, forwarded to the licensing engine.
func (s *ITDRService) Overview(ctx context.Context, tenantID uuid.UUID, authorization string, page, perPage int) (*ITDROverview, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover: tenant id is required")
	}

	active, _, err := s.entitlements.Resolve(ctx, tenantID.String(), authorization, EntitlementITDR)
	if err != nil {
		return nil, err // ErrEntitlementUnavailable bubbles to a 503
	}
	if !active {
		return nil, ErrITDRNotEntitled
	}

	now := s.now()
	var (
		inventory RunbookInventory
		last      *RehearsalRun
		upcoming  *UpcomingRehearsal
		approvals OpenApprovals
		stats     RehearsalStats
	)
	err = s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		if inventory, rerr = s.store.RunbookInventory(ctx, db, page, perPage); rerr != nil {
			return rerr
		}
		if last, rerr = s.store.LastRehearsal(ctx, db); rerr != nil {
			return rerr
		}
		if upcoming, rerr = s.store.UpcomingRehearsal(ctx, db, now); rerr != nil {
			return rerr
		}
		if approvals, rerr = s.store.OpenApprovals(ctx, db, defaultApprovalListLimit); rerr != nil {
			return rerr
		}
		if stats, rerr = s.store.RehearsalStats(ctx, db, now.Add(-readinessWindow)); rerr != nil {
			return rerr
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	inventory.Page = page
	inventory.PerPage = perPage
	readiness := computeReadiness(inventory, last, stats, approvals, now)

	s.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Int("runbooks", inventory.Total).
		Int("readiness", readiness.Score).
		Int("open_approvals", approvals.Total).
		Msg("resolved recover it-dr overview")

	return &ITDROverview{
		SubSolution:       SubSolutionITDR,
		Readiness:         readiness,
		Inventory:         inventory,
		LastRehearsal:     last,
		UpcomingRehearsal: upcoming,
		OpenApprovals:     approvals,
		GeneratedAt:       now,
	}, nil
}

// defaultApprovalListLimit bounds the surfaced open-approval list; the total is
// always exact.
const defaultApprovalListLimit = 25

// computeReadiness derives the IT DR readiness score (0..100) from real state.
// It is a pure function of the inventory, the last rehearsal, the trailing
// rehearsal stats, the open-approval backlog, and now — no hidden inputs, so the
// score is fully explainable via its component breakdown.
func computeReadiness(inv RunbookInventory, last *RehearsalRun, stats RehearsalStats, approvals OpenApprovals, now time.Time) ReadinessScore {
	// An estate with no authored runbooks is not recovery-ready at all — there is
	// nothing to execute — so readiness is zero regardless of the (vacuously clean)
	// approval backlog. The components are still surfaced so the dashboard explains
	// the zero rather than presenting a bare number.
	if inv.Total == 0 {
		return ReadinessScore{
			Score: 0,
			Components: []ReadinessComponent{
				{Key: "published_coverage", Label: "Published runbook coverage", Weight: readinessWeightPublished, Value: 0, Detail: "no runbooks authored yet"},
				{Key: "rehearsal_freshness", Label: "Rehearsal freshness & success", Weight: readinessWeightRehearsal, Value: 0, Detail: "no rehearsal in the last 90 days"},
				{Key: "approval_backlog", Label: "Approval-gate backlog", Weight: readinessWeightApprovals, Value: 0, Detail: "no runbooks to recover"},
			},
		}
	}

	// 1. Published coverage: fraction of runbooks that are executable (published).
	// inv.Total > 0 here (the empty estate returned above).
	publishedValue := float64(inv.ByStatus[publishedStatus]) / float64(inv.Total)
	publishedDetail := pluralizeRunbooks(inv.ByStatus[publishedStatus], inv.Total)

	// 2. Rehearsal recency & success. Recency decays linearly across the window;
	// success is the trailing completed-ratio. The two are averaged so a stale but
	// historically successful estate still scores below a freshly-rehearsed one.
	recency := 0.0
	rehearsalDetail := "no rehearsal in the last 90 days"
	if last != nil {
		age := now.Sub(last.StartedAt)
		if age < 0 {
			age = 0
		}
		if age < readinessWindow {
			recency = 1 - (float64(age) / float64(readinessWindow))
		}
		rehearsalDetail = "last rehearsal " + humanizeAge(age) + " ago"
	}
	successRatio := 0.0
	if stats.Total > 0 {
		successRatio = float64(stats.Completed) / float64(stats.Total)
	}
	rehearsalValue := (recency + successRatio) / 2

	// 3. Approval backlog: full marks at zero open gates, decaying to zero at the
	// saturation floor.
	backlog := approvals.Total
	approvalValue := 1.0
	approvalDetail := "no approval gates blocking active runs"
	if backlog > 0 {
		approvalValue = 1 - math.Min(1, float64(backlog)/float64(approvalBacklogFloor))
		approvalDetail = pluralizeApprovals(backlog)
	}

	components := []ReadinessComponent{
		{Key: "published_coverage", Label: "Published runbook coverage", Weight: readinessWeightPublished, Value: publishedValue, Detail: publishedDetail},
		{Key: "rehearsal_freshness", Label: "Rehearsal freshness & success", Weight: readinessWeightRehearsal, Value: rehearsalValue, Detail: rehearsalDetail},
		{Key: "approval_backlog", Label: "Approval-gate backlog", Weight: readinessWeightApprovals, Value: approvalValue, Detail: approvalDetail},
	}

	weighted := 0.0
	for _, c := range components {
		weighted += c.Weight * c.Value
	}
	score := int(math.Round(weighted * 100))
	if score < 0 {
		score = 0
	} else if score > 100 {
		score = 100
	}
	return ReadinessScore{Score: score, Components: components}
}

const publishedStatus = "published"

// humanizeAge renders a duration as a coarse human label for the readiness
// detail text (deterministic; used only for display, never for the score math).
func humanizeAge(d time.Duration) string {
	switch {
	case d < time.Hour:
		return "under an hour"
	case d < 24*time.Hour:
		return plural(int(d.Hours()), "hour")
	default:
		return plural(int(d.Hours()/24), "day")
	}
}

func plural(n int, unit string) string {
	s := itoa(n) + " " + unit
	if n != 1 {
		s += "s"
	}
	return s
}

func pluralizeRunbooks(published, total int) string {
	return itoa(published) + " of " + itoa(total) + " runbooks published"
}

func pluralizeApprovals(n int) string {
	return plural(n, "approval gate") + " awaiting sign-off"
}

// itoa is a tiny integer formatter kept local so the readiness detail strings do
// not pull in fmt for a single conversion.
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
