package service

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

// WP-5 INTEGRATE — DB-backed SLAPolicyResolver.
//
// This is the resolver the scheduler seam (scheduler_service.go's
// SetSLAPolicyResolver) was built for. For an overdue task it loads the
// applicable tiered policy + business calendar from workflow_sla_policies /
// workflow_calendars (migration 000004) and returns them to EvaluateSLA. When no
// policy is configured for the task's definition it returns ok=false, so the
// scheduler loop falls back to the legacy single-tier behavior — the default is
// fully preserved.
//
// A task carries only its instance id, so resolution is two-hop: task →
// instance.definition_id → policy. Both reads go through the SLA tables' RLS,
// driven inside a read-only tenant transaction (database.RunReadWithTenant),
// which SET LOCAL app.current_tenant_id; the resolver never touches the bare pool
// for the RLS-forced SLA tables.
//
// A small TTL cache keyed by (tenant, definition) avoids re-querying the policy
// on every SLA poll cycle for the same definition. Resolution is best-effort: any
// error (bad tenant id, DB hiccup) degrades to ok=false rather than failing the
// SLA loop, so a transient policy-store problem can never wedge breach handling.

// slaStore is the persistence surface the resolver needs. It mirrors the subset
// of repository.SLARepository used here so tests can substitute an in-memory
// store. The db handle is a repository.PromotionDBTX (the shared pgx subset).
type slaStore interface {
	GetPolicyForDefinition(ctx context.Context, db repository.PromotionDBTX, tenantID, definitionID string) (*repository.SLAPolicyRecord, error)
	GetPolicy(ctx context.Context, db repository.PromotionDBTX, tenantID, id string) (*repository.SLAPolicyRecord, error)
	GetCalendar(ctx context.Context, db repository.PromotionDBTX, tenantID, id string) (*repository.CalendarRecord, error)
	GetDefaultCalendar(ctx context.Context, db repository.PromotionDBTX, tenantID string) (*repository.CalendarRecord, error)
}

// instanceLookup resolves a task's instance to its definition id. It mirrors the
// single repository.InstanceRepository method the resolver needs.
type instanceLookup interface {
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowInstance, error)
}

// slaReadRunner abstracts "run fn inside one read-only tenant transaction, giving
// it a repository.PromotionDBTX handle". Production uses poolSLAReadRunner (a real
// RunReadWithTenant transaction); tests inject a fake that hands fn a recording
// handle, so resolution can be exercised without a database.
type slaReadRunner interface {
	RunRead(ctx context.Context, tenantID string, fn func(db repository.PromotionDBTX) error) error
}

// poolSLAReadRunner is the production slaReadRunner backed by a pgx pool. It runs
// fn under database.RunReadWithTenant so the SLA tables' RLS resolves
// app.current_tenant_id.
type poolSLAReadRunner struct {
	pool *pgxpool.Pool
}

// NewPoolSLAReadRunner adapts a pgx pool to the read runner the resolver needs.
func NewPoolSLAReadRunner(pool *pgxpool.Pool) slaReadRunner {
	return &poolSLAReadRunner{pool: pool}
}

func (r *poolSLAReadRunner) RunRead(ctx context.Context, tenantID string, fn func(db repository.PromotionDBTX) error) error {
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		return err
	}
	return database.RunReadWithTenant(ctx, r.pool, tid, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// cacheTTL is the default lifetime of a cached policy resolution. SLA polls run
// on the order of a minute; a short TTL keeps authored policy edits visible
// quickly while sparing the store one query per overdue task per cycle.
const cacheTTL = 30 * time.Second

// resolvedEntry is a cached resolution for one (tenant, definition).
type resolvedEntry struct {
	policy   SLAPolicy
	calendar Calendar
	ok       bool
	expires  time.Time
}

// DBSLAPolicyResolver is the production SLAPolicyResolver. It satisfies the
// scheduler seam (ResolvePolicy) and is wired in cmd/workflow-engine/main.go.
type DBSLAPolicyResolver struct {
	store     slaStore
	instances instanceLookup
	runner    slaReadRunner
	now       func() time.Time
	logger    zerolog.Logger

	mu    sync.Mutex
	cache map[string]resolvedEntry
}

// NewDBSLAPolicyResolver constructs the DB-backed resolver from a pgx pool. It
// builds the concrete SLA + instance repositories and the read runner internally
// so the call site (main.go) stays a one-liner.
func NewDBSLAPolicyResolver(pool *pgxpool.Pool, logger zerolog.Logger) *DBSLAPolicyResolver {
	return newDBSLAPolicyResolver(
		repository.NewSLARepository(),
		repository.NewInstanceRepository(pool),
		NewPoolSLAReadRunner(pool),
		logger,
	)
}

// newDBSLAPolicyResolver is the dependency-injected constructor used by tests.
func newDBSLAPolicyResolver(store slaStore, instances instanceLookup, runner slaReadRunner, logger zerolog.Logger) *DBSLAPolicyResolver {
	return &DBSLAPolicyResolver{
		store:     store,
		instances: instances,
		runner:    runner,
		now:       time.Now,
		logger:    logger.With().Str("component", "workflow-sla-resolver").Logger(),
		cache:     make(map[string]resolvedEntry),
	}
}

// clock returns the resolver's current time (injected for tests), in UTC.
func (r *DBSLAPolicyResolver) clock() time.Time {
	if r.now != nil {
		return r.now().UTC()
	}
	return time.Now().UTC()
}

// ResolvePolicy implements SLAPolicyResolver. It returns the tiered policy +
// calendar for a task, or ok=false when none is configured (or on any error), so
// the caller uses the single-tier path. A policy with no tiers is returned as
// ok=false too — the scheduler's resolveSLAPolicy guard would discard it anyway,
// and treating it as a miss keeps the cache semantics simple.
func (r *DBSLAPolicyResolver) ResolvePolicy(ctx context.Context, task *model.HumanTask) (SLAPolicy, Calendar, bool) {
	if task == nil || task.TenantID == "" || task.InstanceID == "" {
		return SLAPolicy{}, Calendar{}, false
	}

	// Resolve the task's definition id (two-hop: task -> instance -> definition).
	inst, err := r.instances.GetByID(ctx, task.TenantID, task.InstanceID)
	if err != nil || inst == nil || inst.DefinitionID == "" {
		if err != nil {
			r.logger.Debug().Err(err).
				Str("task_id", task.ID).
				Str("instance_id", task.InstanceID).
				Msg("sla resolver: instance lookup failed; using single-tier fallback")
		}
		return SLAPolicy{}, Calendar{}, false
	}

	cacheKey := task.TenantID + "|" + inst.DefinitionID
	if entry, ok := r.lookupCache(cacheKey); ok {
		return entry.policy, entry.calendar, entry.ok
	}

	policy, calendar, ok := r.load(ctx, task.TenantID, inst.DefinitionID)
	r.storeCache(cacheKey, resolvedEntry{policy: policy, calendar: calendar, ok: ok})
	return policy, calendar, ok
}

// load performs the actual store reads inside one read-only tenant transaction
// and converts the persisted records to the in-memory SLAPolicy + Calendar that
// EvaluateSLA consumes.
func (r *DBSLAPolicyResolver) load(ctx context.Context, tenantID, definitionID string) (SLAPolicy, Calendar, bool) {
	var (
		policyRec *repository.SLAPolicyRecord
		calRec    *repository.CalendarRecord
	)

	err := r.runner.RunRead(ctx, tenantID, func(db repository.PromotionDBTX) error {
		p, err := r.store.GetPolicyForDefinition(ctx, db, tenantID, definitionID)
		if err != nil {
			return err
		}
		policyRec = p

		// Resolve the calendar: the policy's explicit calendar pin wins; otherwise
		// the tenant default; otherwise none (24x7). A missing/absent calendar is
		// not an error — it degrades to wall-clock interpretation.
		if p.CalendarID != nil && *p.CalendarID != "" {
			c, cerr := r.store.GetCalendar(ctx, db, tenantID, *p.CalendarID)
			if cerr == nil {
				calRec = c
			}
		} else {
			if c, cerr := r.store.GetDefaultCalendar(ctx, db, tenantID); cerr == nil {
				calRec = c
			}
		}
		return nil
	})
	if err != nil {
		// model.ErrNotFound here means "no policy for this definition" — the
		// expected miss path. Anything else is logged at debug (still a miss).
		return SLAPolicy{}, Calendar{}, false
	}

	policy := policyRecordToSLAPolicy(policyRec)
	if !policy.HasTiers() {
		return SLAPolicy{}, Calendar{}, false
	}

	calendar := Default24x7Calendar()
	if calRec != nil {
		if c, ok := calendarRecordToCalendar(calRec); ok {
			calendar = c
		}
	}
	return policy, calendar, true
}

// lookupCache returns a non-expired cached entry, if any.
func (r *DBSLAPolicyResolver) lookupCache(key string) (resolvedEntry, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	entry, ok := r.cache[key]
	if !ok || r.clock().After(entry.expires) {
		return resolvedEntry{}, false
	}
	return entry, true
}

// storeCache records an entry with a fresh TTL.
func (r *DBSLAPolicyResolver) storeCache(key string, entry resolvedEntry) {
	entry.expires = r.clock().Add(cacheTTL)
	r.mu.Lock()
	r.cache[key] = entry
	r.mu.Unlock()
}

// ---------------------------------------------------------------------------
// Record -> in-memory model conversion.
// ---------------------------------------------------------------------------

// policyRecordToSLAPolicy converts a persisted SLAPolicyRecord into the
// SLAPolicy EvaluateSLA consumes: seconds become durations, and only well-formed
// tiers are kept (EvaluateSLA re-validates, but filtering here keeps the policy
// clean). RemindBefore seconds become durations.
func policyRecordToSLAPolicy(rec *repository.SLAPolicyRecord) SLAPolicy {
	if rec == nil {
		return SLAPolicy{}
	}
	policy := SLAPolicy{}
	for _, t := range rec.Tiers {
		policy.Tiers = append(policy.Tiers, SLATier{
			After:  time.Duration(t.AfterSeconds) * time.Second,
			Notify: t.Notify,
			Action: t.Action,
		})
	}
	for _, sec := range rec.RemindBefore {
		if sec > 0 {
			policy.RemindBefore = append(policy.RemindBefore, time.Duration(sec)*time.Second)
		}
	}
	return policy
}

// calendarRecordToCalendar converts a persisted CalendarRecord into the in-memory
// Calendar BusinessDeadline uses. ok is false when the calendar yields no working
// time (so the caller keeps the 24x7 default instead of an unusable calendar). A
// bad timezone falls back to UTC rather than failing.
func calendarRecordToCalendar(rec *repository.CalendarRecord) (Calendar, bool) {
	loc, err := time.LoadLocation(rec.Timezone)
	if err != nil || loc == nil {
		loc = time.UTC
	}

	days := make(map[time.Weekday]WorkingDay, len(rec.WorkingDays))
	for key, wd := range rec.WorkingDays {
		n, perr := strconv.Atoi(key)
		if perr != nil || n < 0 || n > 6 {
			continue
		}
		day := WorkingDay{StartMinute: wd.StartMinute, EndMinute: wd.EndMinute}
		if day.Duration() <= 0 {
			continue
		}
		days[time.Weekday(n)] = day
	}
	if len(days) == 0 {
		return Calendar{}, false
	}

	holidays := make(map[string]bool, len(rec.Holidays))
	for _, h := range rec.Holidays {
		if h != "" {
			holidays[h] = true
		}
	}

	return Calendar{Location: loc, Days: days, Holidays: holidays}, true
}
