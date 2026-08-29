package service

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/repository"
)

// fakeSLAWriteStore records the records it is handed and can be primed to fail.
type fakeSLAWriteStore struct {
	createdPolicy *repository.SLAPolicyRecord
	updatedPolicy *repository.SLAPolicyRecord
	getPolicy     *repository.SLAPolicyRecord
	listPolicies  []*repository.SLAPolicyRecord

	createdCalendar *repository.CalendarRecord
	getCalendar     *repository.CalendarRecord
	listCalendars   []*repository.CalendarRecord

	createPolicyErr, deletePolicyErr error

	deletedPolicyID string
}

func (f *fakeSLAWriteStore) CreatePolicy(_ context.Context, _ repository.PromotionDBTX, p *repository.SLAPolicyRecord) error {
	if f.createPolicyErr != nil {
		return f.createPolicyErr
	}
	p.ID = "policy-1"
	f.createdPolicy = p
	return nil
}
func (f *fakeSLAWriteStore) GetPolicy(_ context.Context, _ repository.PromotionDBTX, _, _ string) (*repository.SLAPolicyRecord, error) {
	return f.getPolicy, nil
}
func (f *fakeSLAWriteStore) UpdatePolicy(_ context.Context, _ repository.PromotionDBTX, p *repository.SLAPolicyRecord) error {
	f.updatedPolicy = p
	return nil
}
func (f *fakeSLAWriteStore) DeletePolicy(_ context.Context, _ repository.PromotionDBTX, _, id string) error {
	f.deletedPolicyID = id
	return f.deletePolicyErr
}
func (f *fakeSLAWriteStore) ListPolicies(_ context.Context, _ repository.PromotionDBTX, _ string) ([]*repository.SLAPolicyRecord, error) {
	return f.listPolicies, nil
}
func (f *fakeSLAWriteStore) CreateCalendar(_ context.Context, _ repository.PromotionDBTX, c *repository.CalendarRecord) error {
	c.ID = "cal-1"
	f.createdCalendar = c
	return nil
}
func (f *fakeSLAWriteStore) GetCalendar(_ context.Context, _ repository.PromotionDBTX, _, _ string) (*repository.CalendarRecord, error) {
	return f.getCalendar, nil
}
func (f *fakeSLAWriteStore) UpdateCalendar(_ context.Context, _ repository.PromotionDBTX, _ *repository.CalendarRecord) error {
	return nil
}
func (f *fakeSLAWriteStore) DeleteCalendar(_ context.Context, _ repository.PromotionDBTX, _, _ string) error {
	return nil
}
func (f *fakeSLAWriteStore) ListCalendars(_ context.Context, _ repository.PromotionDBTX, _ string) ([]*repository.CalendarRecord, error) {
	return f.listCalendars, nil
}

// fakeSLATxRunner runs fn with a nil handle and counts read/write calls.
type fakeSLATxRunner struct {
	writes, reads int
}

func (f *fakeSLATxRunner) RunWrite(_ context.Context, _ string, fn func(db repository.PromotionDBTX) error) error {
	f.writes++
	return fn(nil)
}
func (f *fakeSLATxRunner) RunRead(_ context.Context, _ string, fn func(db repository.PromotionDBTX) error) error {
	f.reads++
	return fn(nil)
}

func newTestSLAService(store slaWriteStore, runner slaTxRunner) *SLAService {
	return newSLAService(store, runner, zerolog.Nop())
}

func validPolicyRecord() *repository.SLAPolicyRecord {
	return &repository.SLAPolicyRecord{
		Name: "Approval SLA",
		Tiers: []repository.SLATierJSON{
			{AfterSeconds: 3600, Notify: "role:lead", Action: "notify"},
		},
		RemindBefore: []int64{900},
	}
}

func validCalendarRecord() *repository.CalendarRecord {
	return &repository.CalendarRecord{
		Name:        "Riyadh",
		Timezone:    "Asia/Riyadh",
		WorkingDays: map[string]repository.WorkingDayJSON{"0": {StartMinute: 540, EndMinute: 1020}},
		Holidays:    []string{"2026-09-23"},
	}
}

func TestSLAService_CreatePolicy_StampsTenantAndUser(t *testing.T) {
	store := &fakeSLAWriteStore{}
	runner := &fakeSLATxRunner{}
	svc := newTestSLAService(store, runner)

	out, err := svc.CreatePolicy(context.Background(), "tenant-1", "user-1", validPolicyRecord())
	if err != nil {
		t.Fatalf("CreatePolicy: %v", err)
	}
	if out.ID != "policy-1" {
		t.Fatalf("expected id policy-1, got %q", out.ID)
	}
	if store.createdPolicy.TenantID != "tenant-1" || store.createdPolicy.CreatedBy != "user-1" {
		t.Fatalf("tenant/user not stamped: %+v", store.createdPolicy)
	}
	if runner.writes != 1 {
		t.Fatalf("expected one write tx, got %d", runner.writes)
	}
}

func TestSLAService_CreatePolicy_RejectsEmptyTiers(t *testing.T) {
	svc := newTestSLAService(&fakeSLAWriteStore{}, &fakeSLATxRunner{})
	p := validPolicyRecord()
	p.Tiers = nil
	_, err := svc.CreatePolicy(context.Background(), "tenant-1", "user-1", p)
	if err == nil {
		t.Fatalf("expected validation error for empty tiers")
	}
}

func TestSLAService_CreatePolicy_RejectsBadAction(t *testing.T) {
	svc := newTestSLAService(&fakeSLAWriteStore{}, &fakeSLATxRunner{})
	p := validPolicyRecord()
	p.Tiers[0].Action = "delete-everything"
	_, err := svc.CreatePolicy(context.Background(), "tenant-1", "user-1", p)
	if err == nil {
		t.Fatalf("expected validation error for bad action")
	}
}

func TestSLAService_CreatePolicy_RejectsMissingNotify(t *testing.T) {
	svc := newTestSLAService(&fakeSLAWriteStore{}, &fakeSLATxRunner{})
	p := validPolicyRecord()
	p.Tiers[0].Notify = ""
	_, err := svc.CreatePolicy(context.Background(), "tenant-1", "user-1", p)
	if err == nil {
		t.Fatalf("expected validation error for missing notify target")
	}
}

func TestSLAService_CreatePolicy_PropagatesConflict(t *testing.T) {
	store := &fakeSLAWriteStore{createPolicyErr: ErrConflict}
	svc := newTestSLAService(store, &fakeSLATxRunner{})
	_, err := svc.CreatePolicy(context.Background(), "tenant-1", "user-1", validPolicyRecord())
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("expected conflict error, got %v", err)
	}
}

func TestSLAService_DeletePolicy(t *testing.T) {
	store := &fakeSLAWriteStore{}
	runner := &fakeSLATxRunner{}
	svc := newTestSLAService(store, runner)
	if err := svc.DeletePolicy(context.Background(), "tenant-1", "p9"); err != nil {
		t.Fatalf("DeletePolicy: %v", err)
	}
	if store.deletedPolicyID != "p9" {
		t.Fatalf("expected delete of p9, got %q", store.deletedPolicyID)
	}
	if runner.writes != 1 {
		t.Fatalf("expected one write tx, got %d", runner.writes)
	}
}

func TestSLAService_ListPolicies_UsesReadTx(t *testing.T) {
	store := &fakeSLAWriteStore{listPolicies: []*repository.SLAPolicyRecord{{ID: "p1"}}}
	runner := &fakeSLATxRunner{}
	svc := newTestSLAService(store, runner)
	recs, err := svc.ListPolicies(context.Background(), "tenant-1")
	if err != nil {
		t.Fatalf("ListPolicies: %v", err)
	}
	if len(recs) != 1 {
		t.Fatalf("expected 1 policy, got %d", len(recs))
	}
	if runner.reads != 1 || runner.writes != 0 {
		t.Fatalf("expected read tx only, got reads=%d writes=%d", runner.reads, runner.writes)
	}
}

func TestSLAService_CreateCalendar_Valid(t *testing.T) {
	store := &fakeSLAWriteStore{}
	runner := &fakeSLATxRunner{}
	svc := newTestSLAService(store, runner)
	out, err := svc.CreateCalendar(context.Background(), "tenant-1", "user-1", validCalendarRecord())
	if err != nil {
		t.Fatalf("CreateCalendar: %v", err)
	}
	if out.ID != "cal-1" {
		t.Fatalf("expected id cal-1, got %q", out.ID)
	}
	if store.createdCalendar.TenantID != "tenant-1" {
		t.Fatalf("tenant not stamped")
	}
}

func TestSLAService_CreateCalendar_RejectsBadTimezone(t *testing.T) {
	svc := newTestSLAService(&fakeSLAWriteStore{}, &fakeSLATxRunner{})
	c := validCalendarRecord()
	c.Timezone = "Not/AZone"
	if _, err := svc.CreateCalendar(context.Background(), "tenant-1", "user-1", c); err == nil {
		t.Fatalf("expected validation error for bad timezone")
	}
}

func TestSLAService_CreateCalendar_RejectsEmptyWorkingDays(t *testing.T) {
	svc := newTestSLAService(&fakeSLAWriteStore{}, &fakeSLATxRunner{})
	c := validCalendarRecord()
	c.WorkingDays = map[string]repository.WorkingDayJSON{}
	if _, err := svc.CreateCalendar(context.Background(), "tenant-1", "user-1", c); err == nil {
		t.Fatalf("expected validation error for empty working_days")
	}
}

func TestSLAService_CreateCalendar_RejectsAllClosed(t *testing.T) {
	svc := newTestSLAService(&fakeSLAWriteStore{}, &fakeSLATxRunner{})
	c := validCalendarRecord()
	c.WorkingDays = map[string]repository.WorkingDayJSON{"0": {StartMinute: 600, EndMinute: 600}}
	if _, err := svc.CreateCalendar(context.Background(), "tenant-1", "user-1", c); err == nil {
		t.Fatalf("expected validation error when every window is closed")
	}
}

func TestSLAService_CreateCalendar_RejectsBadHoliday(t *testing.T) {
	svc := newTestSLAService(&fakeSLAWriteStore{}, &fakeSLATxRunner{})
	c := validCalendarRecord()
	c.Holidays = []string{"not-a-date"}
	if _, err := svc.CreateCalendar(context.Background(), "tenant-1", "user-1", c); err == nil {
		t.Fatalf("expected validation error for bad holiday")
	}
}
