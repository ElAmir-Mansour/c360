package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

// ---------------------------------------------------------------------------
// Fakes for the resolver's seams.
// ---------------------------------------------------------------------------

// fakeSLAStore is an in-memory slaStore. Records are keyed for the lookups the
// resolver performs; absent keys return model.ErrNotFound.
type fakeSLAStore struct {
	policyForDef map[string]*repository.SLAPolicyRecord // key: tenant|def
	calendars    map[string]*repository.CalendarRecord  // key: tenant|id
	defaultCal   map[string]*repository.CalendarRecord  // key: tenant

	policyForDefCalls int
}

func (f *fakeSLAStore) GetPolicyForDefinition(_ context.Context, _ repository.PromotionDBTX, tenantID, definitionID string) (*repository.SLAPolicyRecord, error) {
	f.policyForDefCalls++
	if p, ok := f.policyForDef[tenantID+"|"+definitionID]; ok {
		return p, nil
	}
	return nil, model.ErrNotFound
}

func (f *fakeSLAStore) GetPolicy(_ context.Context, _ repository.PromotionDBTX, _, _ string) (*repository.SLAPolicyRecord, error) {
	return nil, model.ErrNotFound
}

func (f *fakeSLAStore) GetCalendar(_ context.Context, _ repository.PromotionDBTX, tenantID, id string) (*repository.CalendarRecord, error) {
	if c, ok := f.calendars[tenantID+"|"+id]; ok {
		return c, nil
	}
	return nil, model.ErrNotFound
}

func (f *fakeSLAStore) GetDefaultCalendar(_ context.Context, _ repository.PromotionDBTX, tenantID string) (*repository.CalendarRecord, error) {
	if c, ok := f.defaultCal[tenantID]; ok {
		return c, nil
	}
	return nil, model.ErrNotFound
}

// fakeInstanceLookup maps instance id -> definition id.
type fakeInstanceLookup struct {
	byID map[string]*model.WorkflowInstance
	err  error
}

func (f *fakeInstanceLookup) GetByID(_ context.Context, _, id string) (*model.WorkflowInstance, error) {
	if f.err != nil {
		return nil, f.err
	}
	if inst, ok := f.byID[id]; ok {
		return inst, nil
	}
	return nil, model.ErrNotFound
}

// fakeReadRunner runs fn with a nil handle (the fakes ignore the db handle).
type fakeReadRunner struct {
	calls int
}

func (f *fakeReadRunner) RunRead(ctx context.Context, _ string, fn func(db repository.PromotionDBTX) error) error {
	f.calls++
	return fn(nil)
}

const (
	resTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	resInst   = "11111111-0000-0000-0000-000000000010"
	resDef    = "22222222-0000-0000-0000-000000000020"
	resCal    = "33333333-0000-0000-0000-000000000030"
)

func newResolverFor(t *testing.T, store slaStore, inst instanceLookup, runner slaReadRunner) *DBSLAPolicyResolver {
	t.Helper()
	r := newDBSLAPolicyResolver(store, inst, runner, zerolog.Nop())
	r.now = func() time.Time { return time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC) }
	return r
}

func overdueTask() *model.HumanTask {
	return &model.HumanTask{
		ID:         "task-1",
		TenantID:   resTenant,
		InstanceID: resInst,
		Status:     model.TaskStatusPending,
		CreatedAt:  time.Date(2026, 6, 14, 8, 0, 0, 0, time.UTC),
	}
}

// ---------------------------------------------------------------------------
// Resolution HIT
// ---------------------------------------------------------------------------

func TestDBSLAPolicyResolver_Hit_WithExplicitCalendar(t *testing.T) {
	store := &fakeSLAStore{
		policyForDef: map[string]*repository.SLAPolicyRecord{
			resTenant + "|" + resDef: {
				ID:           "policy-1",
				TenantID:     resTenant,
				Name:         "Approval SLA",
				DefinitionID: strptr(resDef),
				Tiers: []repository.SLATierJSON{
					{AfterSeconds: 3600, Notify: "role:lead", Action: "notify"},
					{AfterSeconds: 7200, Notify: "role:manager", Action: "escalate"},
				},
				RemindBefore: []int64{900},
				CalendarID:   strptr(resCal),
			},
		},
		calendars: map[string]*repository.CalendarRecord{
			resTenant + "|" + resCal: {
				ID:       resCal,
				TenantID: resTenant,
				Name:     "Riyadh",
				Timezone: "Asia/Riyadh",
				WorkingDays: map[string]repository.WorkingDayJSON{
					"0": {StartMinute: 540, EndMinute: 1020},
					"1": {StartMinute: 540, EndMinute: 1020},
					"2": {StartMinute: 540, EndMinute: 1020},
					"3": {StartMinute: 540, EndMinute: 1020},
					"4": {StartMinute: 540, EndMinute: 1020},
				},
				Holidays: []string{"2026-09-23"},
			},
		},
	}
	inst := &fakeInstanceLookup{byID: map[string]*model.WorkflowInstance{
		resInst: {ID: resInst, TenantID: resTenant, DefinitionID: resDef, Status: model.InstanceStatusRunning},
	}}
	runner := &fakeReadRunner{}
	r := newResolverFor(t, store, inst, runner)

	policy, cal, ok := r.ResolvePolicy(context.Background(), overdueTask())
	if !ok {
		t.Fatalf("expected resolution hit, got miss")
	}
	if !policy.HasTiers() {
		t.Fatalf("expected policy to have tiers")
	}
	if len(policy.Tiers) != 2 {
		t.Fatalf("expected 2 tiers, got %d", len(policy.Tiers))
	}
	if policy.Tiers[0].After != time.Hour {
		t.Fatalf("tier[0].After = %v, want 1h", policy.Tiers[0].After)
	}
	if policy.Tiers[1].Action != SLAActionEscalate {
		t.Fatalf("tier[1].Action = %q, want escalate", policy.Tiers[1].Action)
	}
	if len(policy.RemindBefore) != 1 || policy.RemindBefore[0] != 15*time.Minute {
		t.Fatalf("RemindBefore = %v, want [15m]", policy.RemindBefore)
	}
	// Calendar resolved from the explicit pin, with the configured timezone.
	if cal.Location == nil || cal.Location.String() != "Asia/Riyadh" {
		t.Fatalf("calendar location = %v, want Asia/Riyadh", cal.Location)
	}
	if !cal.IsHoliday(time.Date(2026, 9, 23, 12, 0, 0, 0, cal.Location)) {
		t.Fatalf("expected 2026-09-23 to be a holiday")
	}

	// The resolved policy + calendar feed EvaluateSLA end-to-end. As of noon
	// (task created 08:00) at least the first business tier is due.
	eval := EvaluateSLA(r.now(), overdueTask(), policy, cal)
	if len(eval.DueActions) == 0 {
		t.Fatalf("expected at least one due action from EvaluateSLA")
	}
}

func TestDBSLAPolicyResolver_Hit_DefaultCalendarWhenNoPin(t *testing.T) {
	store := &fakeSLAStore{
		policyForDef: map[string]*repository.SLAPolicyRecord{
			resTenant + "|" + resDef: {
				ID:           "policy-2",
				TenantID:     resTenant,
				Name:         "Tenant-wide SLA",
				DefinitionID: nil, // tenant-wide
				Tiers:        []repository.SLATierJSON{{AfterSeconds: 3600, Notify: "role:lead", Action: "notify"}},
				CalendarID:   nil, // no pin -> default calendar
			},
		},
		defaultCal: map[string]*repository.CalendarRecord{
			resTenant: {
				ID:          "default-cal",
				TenantID:    resTenant,
				Name:        "Default",
				Timezone:    "UTC",
				WorkingDays: map[string]repository.WorkingDayJSON{"6": {StartMinute: 0, EndMinute: 1440}},
				IsDefault:   true,
			},
		},
	}
	inst := &fakeInstanceLookup{byID: map[string]*model.WorkflowInstance{
		resInst: {ID: resInst, TenantID: resTenant, DefinitionID: resDef},
	}}
	r := newResolverFor(t, store, inst, &fakeReadRunner{})

	policy, cal, ok := r.ResolvePolicy(context.Background(), overdueTask())
	if !ok {
		t.Fatalf("expected resolution hit")
	}
	if len(policy.Tiers) != 1 {
		t.Fatalf("expected 1 tier")
	}
	// Default calendar has exactly Saturday open.
	if _, has := cal.Days[time.Saturday]; !has {
		t.Fatalf("expected default calendar to have Saturday configured")
	}
}

func TestDBSLAPolicyResolver_Hit_NoCalendarFallsBackTo24x7(t *testing.T) {
	store := &fakeSLAStore{
		policyForDef: map[string]*repository.SLAPolicyRecord{
			resTenant + "|" + resDef: {
				ID:       "policy-3",
				TenantID: resTenant,
				Name:     "No-calendar SLA",
				Tiers:    []repository.SLATierJSON{{AfterSeconds: 3600, Notify: "role:lead", Action: "notify"}},
			},
		},
		// No default calendar configured.
	}
	inst := &fakeInstanceLookup{byID: map[string]*model.WorkflowInstance{
		resInst: {ID: resInst, TenantID: resTenant, DefinitionID: resDef},
	}}
	r := newResolverFor(t, store, inst, &fakeReadRunner{})

	policy, cal, ok := r.ResolvePolicy(context.Background(), overdueTask())
	if !ok {
		t.Fatalf("expected resolution hit")
	}
	if !policy.HasTiers() {
		t.Fatalf("expected tiers")
	}
	// Falls back to 24x7: every weekday open.
	for d := time.Sunday; d <= time.Saturday; d++ {
		if _, has := cal.Days[d]; !has {
			t.Fatalf("expected 24x7 calendar to have weekday %v", d)
		}
	}
}

// ---------------------------------------------------------------------------
// Resolution MISS — each must yield ok=false so the single-tier fallback runs.
// ---------------------------------------------------------------------------

func TestDBSLAPolicyResolver_Miss_NoPolicyForDefinition(t *testing.T) {
	store := &fakeSLAStore{} // empty -> GetPolicyForDefinition returns ErrNotFound
	inst := &fakeInstanceLookup{byID: map[string]*model.WorkflowInstance{
		resInst: {ID: resInst, TenantID: resTenant, DefinitionID: resDef},
	}}
	r := newResolverFor(t, store, inst, &fakeReadRunner{})

	_, _, ok := r.ResolvePolicy(context.Background(), overdueTask())
	if ok {
		t.Fatalf("expected miss when no policy configured")
	}
}

func TestDBSLAPolicyResolver_Miss_PolicyHasNoTiers(t *testing.T) {
	store := &fakeSLAStore{
		policyForDef: map[string]*repository.SLAPolicyRecord{
			resTenant + "|" + resDef: {
				ID:       "policy-empty",
				TenantID: resTenant,
				Name:     "Empty",
				Tiers:    []repository.SLATierJSON{}, // no tiers
			},
		},
	}
	inst := &fakeInstanceLookup{byID: map[string]*model.WorkflowInstance{
		resInst: {ID: resInst, TenantID: resTenant, DefinitionID: resDef},
	}}
	r := newResolverFor(t, store, inst, &fakeReadRunner{})

	_, _, ok := r.ResolvePolicy(context.Background(), overdueTask())
	if ok {
		t.Fatalf("expected miss when policy has no tiers")
	}
}

func TestDBSLAPolicyResolver_Miss_InstanceLookupFails(t *testing.T) {
	store := &fakeSLAStore{}
	inst := &fakeInstanceLookup{err: errors.New("db down")}
	r := newResolverFor(t, store, inst, &fakeReadRunner{})

	_, _, ok := r.ResolvePolicy(context.Background(), overdueTask())
	if ok {
		t.Fatalf("expected miss when instance lookup fails")
	}
	if store.policyForDefCalls != 0 {
		t.Fatalf("policy store should not be queried when instance lookup fails")
	}
}

func TestDBSLAPolicyResolver_Miss_NilOrIncompleteTask(t *testing.T) {
	r := newResolverFor(t, &fakeSLAStore{}, &fakeInstanceLookup{}, &fakeReadRunner{})

	if _, _, ok := r.ResolvePolicy(context.Background(), nil); ok {
		t.Fatalf("nil task must be a miss")
	}
	if _, _, ok := r.ResolvePolicy(context.Background(), &model.HumanTask{InstanceID: resInst}); ok {
		t.Fatalf("task with no tenant must be a miss")
	}
	if _, _, ok := r.ResolvePolicy(context.Background(), &model.HumanTask{TenantID: resTenant}); ok {
		t.Fatalf("task with no instance must be a miss")
	}
}

// ---------------------------------------------------------------------------
// Caching — a second resolve within the TTL must not re-query the store.
// ---------------------------------------------------------------------------

func TestDBSLAPolicyResolver_CachesResolution(t *testing.T) {
	store := &fakeSLAStore{
		policyForDef: map[string]*repository.SLAPolicyRecord{
			resTenant + "|" + resDef: {
				ID:       "policy-cache",
				TenantID: resTenant,
				Name:     "Cached",
				Tiers:    []repository.SLATierJSON{{AfterSeconds: 3600, Notify: "role:lead", Action: "notify"}},
			},
		},
	}
	inst := &fakeInstanceLookup{byID: map[string]*model.WorkflowInstance{
		resInst: {ID: resInst, TenantID: resTenant, DefinitionID: resDef},
	}}
	runner := &fakeReadRunner{}
	r := newResolverFor(t, store, inst, runner)

	if _, _, ok := r.ResolvePolicy(context.Background(), overdueTask()); !ok {
		t.Fatalf("first resolve should hit")
	}
	if _, _, ok := r.ResolvePolicy(context.Background(), overdueTask()); !ok {
		t.Fatalf("second resolve should hit (from cache)")
	}
	if runner.calls != 1 {
		t.Fatalf("expected store to be queried once (cached second time), got %d runs", runner.calls)
	}
	if store.policyForDefCalls != 1 {
		t.Fatalf("expected policy store queried once, got %d", store.policyForDefCalls)
	}

	// After the TTL elapses, the next resolve re-queries the store.
	r.now = func() time.Time { return time.Date(2026, 6, 14, 12, 1, 0, 0, time.UTC) } // +60s > 30s TTL
	if _, _, ok := r.ResolvePolicy(context.Background(), overdueTask()); !ok {
		t.Fatalf("post-TTL resolve should hit")
	}
	if runner.calls != 2 {
		t.Fatalf("expected store re-queried after TTL, got %d runs", runner.calls)
	}
}

// ---------------------------------------------------------------------------
// Record conversion helpers.
// ---------------------------------------------------------------------------

func TestCalendarRecordToCalendar_BadTimezoneFallsBackToUTC(t *testing.T) {
	rec := &repository.CalendarRecord{
		Timezone:    "Not/AZone",
		WorkingDays: map[string]repository.WorkingDayJSON{"1": {StartMinute: 540, EndMinute: 1020}},
	}
	cal, ok := calendarRecordToCalendar(rec)
	if !ok {
		t.Fatalf("expected ok calendar")
	}
	if cal.Location != time.UTC {
		t.Fatalf("expected UTC fallback, got %v", cal.Location)
	}
}

func TestCalendarRecordToCalendar_NoWorkingDaysIsNotOK(t *testing.T) {
	rec := &repository.CalendarRecord{Timezone: "UTC", WorkingDays: map[string]repository.WorkingDayJSON{}}
	if _, ok := calendarRecordToCalendar(rec); ok {
		t.Fatalf("expected not-ok for a calendar with no working days")
	}
}

// strptr is local to the service test package.
func strptr(s string) *string { return &s }
