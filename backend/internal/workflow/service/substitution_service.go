package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

// HUMAN-SCALE — OUT-OF-OFFICE / SUBSTITUTE (DEPUTY) ENGINE.
//
// PROBLEM this closes: delegation today is single-hop, per-decision Lex metadata
// with no depth limit or loop detection; an approver on vacation silently BLOCKS
// every workflow routed to them. This service is the core OOO registry + resolver:
//
//   * SetSubstitution / ClearSubstitution — a user sets/clears a deputy for a
//     date window (the registry write path).
//   * ResolveAssignee — the human-task assignment/create path CONSULTS this: a
//     task that WOULD be assigned to an out-of-office user during their window is
//     handed off to the deputy. It WALKS the deputy chain (B is out too -> C)
//     with a DEPTH LIMIT + LOOP DETECTION (A->B->A must not loop; chains bounded
//     by model.MaxSubstitutionDepth), reuses the business Calendar for the
//     window/timezone "now", and reports every hop so the executor can emit the
//     reassigned_ooo audit event.
//
// BACKWARD COMPAT: a user with no active window has no active row, so
// ResolveAssignee fast-paths to (same user, not substituted) with a single store
// lookup. Non-OOO users and single-assignee tasks are wholly unaffected.

// substitutionStore is the persistence surface the resolver needs — the subset of
// repository.SubstitutionRepository consumed here. Kept as an interface so tests
// substitute an in-memory store (the established test-double technique).
type substitutionStore interface {
	GetActiveDeputy(ctx context.Context, tenantID, userID string, at time.Time) (*model.Substitution, error)
	SetSubstitution(ctx context.Context, sub *model.Substitution) error
	ClearSubstitution(ctx context.Context, tenantID, userID string) error
	ListForUser(ctx context.Context, tenantID, userID string) ([]*model.Substitution, error)
}

// calendarProvider optionally supplies the tenant business calendar used to
// interpret "now" for the window check (so an OOO window can be reasoned about in
// the tenant's timezone). It mirrors the single method the resolver needs and is
// satisfied by a thin adapter over the SLA calendar store; when nil the resolver
// interprets the window against wall-clock UTC (Default24x7Calendar), preserving
// correct behaviour without a calendar configured.
type calendarProvider interface {
	// CalendarFor returns the tenant business calendar and ok=true, or ok=false to
	// fall back to 24x7 UTC. It must never fail the resolve path (best-effort).
	CalendarFor(ctx context.Context, tenantID string) (Calendar, bool)
}

// SubstitutionDecision is the outcome of resolving an assignee through the OOO
// registry. When Substituted is false the assignee is unchanged (the fast-path
// no-op). When true, Assignee is the resolved deputy at the end of the chain and
// Chain records each hop (out-of-office user -> deputy) in order, so the caller
// can emit a tamper-evident reassigned_ooo audit event with the full path.
type SubstitutionDecision struct {
	// OriginalAssignee is the user the task would have been assigned to.
	OriginalAssignee string
	// Assignee is the effective assignee after applying any active substitution.
	Assignee string
	// Substituted reports whether at least one hand-off was applied.
	Substituted bool
	// Chain is the ordered list of hops taken (each: From out-of-office -> To
	// deputy), used for the audit payload. Empty when Substituted is false.
	Chain []SubstitutionHop
	// Truncated is true when the depth limit was hit before a non-OOO deputy was
	// found (the last resolvable deputy is used). Loops are reported via Chain's
	// terminal hop and never set Truncated.
	Truncated bool
}

// SubstitutionHop is one resolved hand-off in a deputy chain.
type SubstitutionHop struct {
	From   string `json:"from"`
	To     string `json:"to"`
	Reason string `json:"reason,omitempty"`
}

// SubstitutionService is the core OOO/substitute engine. It implements the
// executor.SubstitutionResolver seam (ResolveAssignee) that the human-task
// assignment/create path consults, plus the registry write path.
type SubstitutionService struct {
	store    substitutionStore
	calendar calendarProvider
	now      func() time.Time
	logger   zerolog.Logger
}

// NewSubstitutionService constructs the service. The calendar provider is
// optional (nil => interpret windows in wall-clock UTC) and installed separately
// via WithCalendarProvider so this constructor's signature stays minimal.
func NewSubstitutionService(store substitutionStore, logger zerolog.Logger) *SubstitutionService {
	return &SubstitutionService{
		store:  store,
		now:    time.Now,
		logger: logger.With().Str("service", "workflow-substitution").Logger(),
	}
}

// WithCalendarProvider installs the optional tenant-calendar provider and returns
// the receiver for chaining.
func (s *SubstitutionService) WithCalendarProvider(p calendarProvider) *SubstitutionService {
	s.calendar = p
	return s
}

// clock returns the resolver's current instant (injectable for tests), in UTC.
func (s *SubstitutionService) clock() time.Time {
	if s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

// SetSubstitution records the active out-of-office window: within [from, to] the
// user's in-tray work is handed off to deputy. A new window supersedes any prior
// active one for the same user (the repository upsert deactivates it first).
func (s *SubstitutionService) SetSubstitution(ctx context.Context, tenantID, userID, deputyID string, from, to time.Time, reason, createdBy string) (*model.Substitution, error) {
	sub := &model.Substitution{
		TenantID:  tenantID,
		UserID:    userID,
		DeputyID:  deputyID,
		FromTime:  from.UTC(),
		ToTime:    to.UTC(),
		Active:    true,
		Reason:    reason,
		CreatedBy: createdBy,
	}
	if err := s.store.SetSubstitution(ctx, sub); err != nil {
		return nil, err
	}
	s.logger.Info().
		Str("tenant_id", tenantID).
		Str("user_id", userID).
		Str("deputy_id", deputyID).
		Time("from", sub.FromTime).
		Time("to", sub.ToTime).
		Msg("out-of-office substitution set")
	return sub, nil
}

// ClearSubstitution deactivates a user's active out-of-office window.
func (s *SubstitutionService) ClearSubstitution(ctx context.Context, tenantID, userID string) error {
	if err := s.store.ClearSubstitution(ctx, tenantID, userID); err != nil {
		return err
	}
	s.logger.Info().Str("tenant_id", tenantID).Str("user_id", userID).Msg("out-of-office substitution cleared")
	return nil
}

// ListForUser returns a user's OOO history (active + inactive).
func (s *SubstitutionService) ListForUser(ctx context.Context, tenantID, userID string) ([]*model.Substitution, error) {
	return s.store.ListForUser(ctx, tenantID, userID)
}

// ResolveAssignee implements the executor.SubstitutionResolver seam. Given the
// user a task WOULD be assigned to, it walks the deputy chain and returns the
// effective assignee. It is best-effort and fail-open: any store error degrades
// to "no substitution" so a transient registry problem can NEVER wedge task
// creation (a wedged registry must not re-introduce the very blocking this engine
// removes). The window is evaluated against the tenant calendar's "now" when a
// calendar is available, else wall-clock UTC.
//
// DEPTH LIMIT + LOOP DETECTION: the walk follows at most MaxSubstitutionDepth
// hops and tracks every user already visited (starting with the original
// assignee). If a hop points back to an already-visited user (A->B->A, or any
// longer cycle) the walk STOPS at the current deputy — the cycle is broken and
// the last resolvable, non-cyclic deputy is used, never looping. Reaching the
// depth cap likewise stops with Truncated=true.
func (s *SubstitutionService) ResolveAssignee(ctx context.Context, tenantID, userID string) SubstitutionDecision {
	decision := SubstitutionDecision{OriginalAssignee: userID, Assignee: userID}
	if s == nil || s.store == nil || userID == "" {
		return decision
	}

	at := s.windowNow(ctx, tenantID)

	// visited tracks every user already on the chain (original + each resolved
	// deputy) so a hop back onto any of them is detected as a loop and stops.
	visited := map[string]bool{userID: true}
	current := userID

	for hop := 0; hop < model.MaxSubstitutionDepth; hop++ {
		sub, err := s.store.GetActiveDeputy(ctx, tenantID, current, at)
		if err != nil {
			// Fail-open: keep whatever we've resolved so far (no blocking).
			s.logger.Warn().Err(err).
				Str("tenant_id", tenantID).
				Str("user_id", current).
				Msg("substitution lookup failed; using current assignee (fail-open)")
			return decision
		}
		if sub == nil {
			// current is NOT out of office — terminal, this is the effective assignee.
			return decision
		}
		// Defensive re-check of the window in case a store returns a stale row.
		if !sub.IsActiveAt(at) {
			return decision
		}

		deputy := sub.DeputyID
		// LOOP DETECTION: a deputy already on the chain closes a cycle. Record the
		// hop so the audit trail shows the attempted cycle, then STOP — do not
		// follow it (that is the A->B->A must-not-loop guarantee).
		if visited[deputy] {
			decision.Chain = append(decision.Chain, SubstitutionHop{From: current, To: deputy, Reason: sub.Reason})
			decision.Substituted = true
			decision.Assignee = deputy
			s.logger.Warn().
				Str("tenant_id", tenantID).
				Str("cycle_from", current).
				Str("cycle_to", deputy).
				Msg("out-of-office deputy chain cycle detected; stopping (bounded)")
			return decision
		}

		decision.Chain = append(decision.Chain, SubstitutionHop{From: current, To: deputy, Reason: sub.Reason})
		decision.Substituted = true
		decision.Assignee = deputy
		visited[deputy] = true
		current = deputy
	}

	// Depth cap reached without terminating on a non-OOO deputy — bound it.
	decision.Truncated = true
	s.logger.Warn().
		Str("tenant_id", tenantID).
		Int("max_depth", model.MaxSubstitutionDepth).
		Str("final_assignee", decision.Assignee).
		Msg("out-of-office deputy chain hit depth limit; stopping (bounded)")
	return decision
}

// windowNow returns the instant used to evaluate OOO windows. When a calendar
// provider is wired it uses the tenant calendar's location so "now" is the same
// wall-clock instant expressed in the tenant's timezone (the window comparison in
// model.Substitution is absolute, so the location does not shift the instant — it
// exists so future working-hours-aware policies can build on the same seam). When
// no calendar is available it is plain UTC now.
func (s *SubstitutionService) windowNow(ctx context.Context, tenantID string) time.Time {
	now := s.clock()
	if s.calendar == nil {
		return now
	}
	if cal, ok := s.calendar.CalendarFor(ctx, tenantID); ok {
		return now.In(cal.loc())
	}
	return now
}

// AsExecutorResolver adapts the service to the executor.SubstitutionResolver seam
// the human-task executor consumes, translating SubstitutionDecision into the
// executor-side SubstitutionOutcome. Keeping the adapter in the service package
// (which already imports executor for the approval-chain primitives) avoids an
// import cycle — the executor package never imports service.
func (s *SubstitutionService) AsExecutorResolver() executor.SubstitutionResolver {
	return &executorSubstitutionAdapter{svc: s}
}

// executorSubstitutionAdapter implements executor.SubstitutionResolver over the
// SubstitutionService.
type executorSubstitutionAdapter struct {
	svc *SubstitutionService
}

func (a *executorSubstitutionAdapter) ResolveAssignee(ctx context.Context, tenantID, userID string) executor.SubstitutionOutcome {
	d := a.svc.ResolveAssignee(ctx, tenantID, userID)
	out := executor.SubstitutionOutcome{
		Assignee:    d.Assignee,
		Substituted: d.Substituted,
		Truncated:   d.Truncated,
	}
	if len(d.Chain) > 0 {
		out.Chain = make([]executor.SubstitutionHop, len(d.Chain))
		for i, h := range d.Chain {
			out.Chain[i] = executor.SubstitutionHop{From: h.From, To: h.To, Reason: h.Reason}
		}
	}
	return out
}

// slaCalendarProvider is the production calendarProvider: it resolves a tenant's
// DEFAULT business calendar from workflow_calendars (migration 000004) via the
// same RLS-scoped read runner + store the SLA resolver uses, so OOO windows can
// be interpreted in the tenant timezone. Best-effort: any miss/error degrades to
// ok=false (24x7 UTC), so a calendar problem never wedges the resolve path.
type slaCalendarProvider struct {
	store  slaStore
	runner slaReadRunner
}

// NewSLACalendarProvider builds a calendarProvider from a pgx pool, reusing the
// SLA repository + tenant read runner. Wired in cmd/workflow-engine/main.go.
func NewSLACalendarProvider(pool *pgxpool.Pool) *slaCalendarProvider {
	return &slaCalendarProvider{
		store:  repository.NewSLARepository(),
		runner: NewPoolSLAReadRunner(pool),
	}
}

// CalendarFor implements calendarProvider by loading the tenant's default
// calendar inside one read-only tenant transaction.
func (p *slaCalendarProvider) CalendarFor(ctx context.Context, tenantID string) (Calendar, bool) {
	if p == nil || tenantID == "" {
		return Calendar{}, false
	}
	var rec *repository.CalendarRecord
	err := p.runner.RunRead(ctx, tenantID, func(db repository.PromotionDBTX) error {
		c, cerr := p.store.GetDefaultCalendar(ctx, db, tenantID)
		if cerr != nil {
			return cerr
		}
		rec = c
		return nil
	})
	if err != nil || rec == nil {
		return Calendar{}, false
	}
	return calendarRecordToCalendar(rec)
}
