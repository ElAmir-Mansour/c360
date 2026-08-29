package repository_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

const (
	slaTenantA   = "aaaaaaaa-0000-0000-0000-000000000001"
	slaPolicyID  = "dddddddd-0000-0000-0000-000000000001"
	slaDefID     = "eeeeeeee-0000-0000-0000-000000000002"
	slaCalID     = "ffffffff-0000-0000-0000-000000000003"
	slaCreatedBy = "11111111-0000-0000-0000-000000000009"
)

func newSLAMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

var slaPolicyCols = []string{
	"id", "tenant_id", "name", "description", "definition_id",
	"tiers", "remind_before", "calendar_id", "created_by", "created_at", "updated_at",
}

var calendarCols = []string{
	"id", "tenant_id", "name", "description", "timezone",
	"working_days", "holidays", "is_default", "created_by", "created_at", "updated_at",
}

// strptr is shared with promotion_repo_test.go in this package.

// ---------------------------------------------------------------------------
// SLA policy CRUD
// ---------------------------------------------------------------------------

func TestSLARepository_CreatePolicy(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	createdAt := time.Unix(1000, 0).UTC()

	rec := &repository.SLAPolicyRecord{
		TenantID:     slaTenantA,
		Name:         "Approval SLA",
		Description:  "tiered escalation",
		DefinitionID: strptr(slaDefID),
		Tiers: []repository.SLATierJSON{
			{AfterSeconds: 14400, Notify: "role:lead", Action: "notify"},
			{AfterSeconds: 28800, Notify: "role:manager", Action: "escalate"},
		},
		RemindBefore: []int64{3600, 900},
		CalendarID:   strptr(slaCalID),
		CreatedBy:    slaCreatedBy,
	}

	mock.ExpectQuery(`INSERT INTO workflow_sla_policies`).
		WithArgs(
			slaTenantA, "Approval SLA", "tiered escalation", strptr(slaDefID),
			[]byte(`[{"after_seconds":14400,"notify":"role:lead","action":"notify"},{"after_seconds":28800,"notify":"role:manager","action":"escalate"}]`),
			[]byte(`[3600,900]`), strptr(slaCalID), slaCreatedBy,
		).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
			AddRow(slaPolicyID, createdAt, createdAt))

	err := repo.CreatePolicy(context.Background(), mock, rec)
	require.NoError(t, err)
	require.Equal(t, slaPolicyID, rec.ID)
	require.Equal(t, createdAt, rec.CreatedAt)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_CreatePolicy_DuplicateName(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectQuery(`INSERT INTO workflow_sla_policies`).
		WithArgs(
			slaTenantA, "dup", "", (*string)(nil),
			[]byte(`[]`), []byte(`[]`), (*string)(nil), slaCreatedBy,
		).
		WillReturnError(&pgconn.PgError{Code: "23505", Message: "duplicate key"})

	err := repo.CreatePolicy(context.Background(), mock, &repository.SLAPolicyRecord{
		TenantID:  slaTenantA,
		Name:      "dup",
		CreatedBy: slaCreatedBy,
	})
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrConflict))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetPolicy(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(2000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_sla_policies\s+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL`).
		WithArgs(slaPolicyID, slaTenantA).
		WillReturnRows(pgxmock.NewRows(slaPolicyCols).AddRow(
			slaPolicyID, slaTenantA, "Approval SLA", "desc", strptr(slaDefID),
			[]byte(`[{"after_seconds":14400,"notify":"role:lead","action":"notify"}]`),
			[]byte(`[3600]`), strptr(slaCalID), slaCreatedBy, at, at,
		))

	rec, err := repo.GetPolicy(context.Background(), mock, slaTenantA, slaPolicyID)
	require.NoError(t, err)
	require.Equal(t, slaPolicyID, rec.ID)
	require.Len(t, rec.Tiers, 1)
	require.Equal(t, int64(14400), rec.Tiers[0].AfterSeconds)
	require.Equal(t, "role:lead", rec.Tiers[0].Notify)
	require.Equal(t, []int64{3600}, rec.RemindBefore)
	require.NotNil(t, rec.CalendarID)
	require.Equal(t, slaCalID, *rec.CalendarID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetPolicy_NotFound(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectQuery(`SELECT .* FROM workflow_sla_policies`).
		WithArgs(slaPolicyID, slaTenantA).
		WillReturnRows(pgxmock.NewRows(slaPolicyCols)) // empty -> ErrNoRows

	_, err := repo.GetPolicy(context.Background(), mock, slaTenantA, slaPolicyID)
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetPolicy_NullDefinitionAndCalendar(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(2000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_sla_policies`).
		WithArgs(slaPolicyID, slaTenantA).
		WillReturnRows(pgxmock.NewRows(slaPolicyCols).AddRow(
			slaPolicyID, slaTenantA, "Tenant-wide", "", nil,
			[]byte(`[]`), []byte(`[]`), nil, slaCreatedBy, at, at,
		))

	rec, err := repo.GetPolicy(context.Background(), mock, slaTenantA, slaPolicyID)
	require.NoError(t, err)
	require.Nil(t, rec.DefinitionID)
	require.Nil(t, rec.CalendarID)
	require.NotNil(t, rec.Tiers)
	require.Len(t, rec.Tiers, 0)
	require.NotNil(t, rec.RemindBefore)
	require.Len(t, rec.RemindBefore, 0)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_UpdatePolicy(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	rec := &repository.SLAPolicyRecord{
		ID:           slaPolicyID,
		TenantID:     slaTenantA,
		Name:         "Updated",
		Description:  "new desc",
		DefinitionID: nil,
		Tiers:        []repository.SLATierJSON{{AfterSeconds: 7200, Notify: "role:ops", Action: "reassign"}},
		RemindBefore: []int64{600},
		CalendarID:   nil,
	}

	mock.ExpectExec(`UPDATE workflow_sla_policies\s+SET name = \$3`).
		WithArgs(
			slaPolicyID, slaTenantA, "Updated", "new desc", (*string)(nil),
			[]byte(`[{"after_seconds":7200,"notify":"role:ops","action":"reassign"}]`),
			[]byte(`[600]`), (*string)(nil),
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdatePolicy(context.Background(), mock, rec)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_UpdatePolicy_NotFound(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectExec(`UPDATE workflow_sla_policies`).
		WithArgs(
			slaPolicyID, slaTenantA, "x", "", (*string)(nil),
			[]byte(`[]`), []byte(`[]`), (*string)(nil),
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	err := repo.UpdatePolicy(context.Background(), mock, &repository.SLAPolicyRecord{
		ID: slaPolicyID, TenantID: slaTenantA, Name: "x",
	})
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_DeletePolicy(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectExec(`UPDATE workflow_sla_policies\s+SET deleted_at = now\(\), updated_at = now\(\)\s+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL`).
		WithArgs(slaPolicyID, slaTenantA).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.DeletePolicy(context.Background(), mock, slaTenantA, slaPolicyID)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_DeletePolicy_NotFound(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectExec(`UPDATE workflow_sla_policies`).
		WithArgs(slaPolicyID, slaTenantA).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))

	err := repo.DeletePolicy(context.Background(), mock, slaTenantA, slaPolicyID)
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_ListPolicies(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(3000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_sla_policies\s+WHERE tenant_id = \$1 AND deleted_at IS NULL\s+ORDER BY created_at DESC`).
		WithArgs(slaTenantA).
		WillReturnRows(pgxmock.NewRows(slaPolicyCols).
			AddRow(slaPolicyID, slaTenantA, "P2", "", strptr(slaDefID), []byte(`[]`), []byte(`[]`), nil, slaCreatedBy, at, at).
			AddRow("other-id", slaTenantA, "P1", "", nil, []byte(`[]`), []byte(`[]`), nil, slaCreatedBy, at, at))

	recs, err := repo.ListPolicies(context.Background(), mock, slaTenantA)
	require.NoError(t, err)
	require.Len(t, recs, 2)
	require.Equal(t, "P2", recs[0].Name)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_ListPolicies_Empty(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectQuery(`SELECT .* FROM workflow_sla_policies`).
		WithArgs(slaTenantA).
		WillReturnRows(pgxmock.NewRows(slaPolicyCols))

	recs, err := repo.ListPolicies(context.Background(), mock, slaTenantA)
	require.NoError(t, err)
	require.NotNil(t, recs)
	require.Len(t, recs, 0)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetPolicyForDefinition(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(4000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_sla_policies\s+WHERE tenant_id = \$1\s+AND deleted_at IS NULL\s+AND \(definition_id = \$2 OR definition_id IS NULL\)`).
		WithArgs(slaTenantA, slaDefID).
		WillReturnRows(pgxmock.NewRows(slaPolicyCols).AddRow(
			slaPolicyID, slaTenantA, "Pinned", "", strptr(slaDefID),
			[]byte(`[{"after_seconds":3600,"notify":"role:lead","action":"notify"}]`),
			[]byte(`[]`), strptr(slaCalID), slaCreatedBy, at, at,
		))

	rec, err := repo.GetPolicyForDefinition(context.Background(), mock, slaTenantA, slaDefID)
	require.NoError(t, err)
	require.Equal(t, slaPolicyID, rec.ID)
	require.Equal(t, slaDefID, *rec.DefinitionID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetPolicyForDefinition_NotFound(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectQuery(`SELECT .* FROM workflow_sla_policies`).
		WithArgs(slaTenantA, slaDefID).
		WillReturnRows(pgxmock.NewRows(slaPolicyCols))

	_, err := repo.GetPolicyForDefinition(context.Background(), mock, slaTenantA, slaDefID)
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

// ---------------------------------------------------------------------------
// Calendar CRUD
// ---------------------------------------------------------------------------

func TestSLARepository_CreateCalendar(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(5000, 0).UTC()

	cal := &repository.CalendarRecord{
		TenantID:    slaTenantA,
		Name:        "Riyadh business hours",
		Description: "Sun-Thu 9-17",
		Timezone:    "Asia/Riyadh",
		WorkingDays: map[string]repository.WorkingDayJSON{
			"0": {StartMinute: 540, EndMinute: 1020},
		},
		Holidays:  []string{"2026-09-23"},
		IsDefault: true,
		CreatedBy: slaCreatedBy,
	}

	mock.ExpectQuery(`INSERT INTO workflow_calendars`).
		WithArgs(
			slaTenantA, "Riyadh business hours", "Sun-Thu 9-17", "Asia/Riyadh",
			[]byte(`{"0":{"start_minute":540,"end_minute":1020}}`),
			[]byte(`["2026-09-23"]`), true, slaCreatedBy,
		).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
			AddRow(slaCalID, at, at))

	err := repo.CreateCalendar(context.Background(), mock, cal)
	require.NoError(t, err)
	require.Equal(t, slaCalID, cal.ID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_CreateCalendar_DefaultsTimezone(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(5000, 0).UTC()

	cal := &repository.CalendarRecord{
		TenantID:  slaTenantA,
		Name:      "Default cal",
		Timezone:  "", // empty -> normalized to UTC
		CreatedBy: slaCreatedBy,
	}

	mock.ExpectQuery(`INSERT INTO workflow_calendars`).
		WithArgs(
			slaTenantA, "Default cal", "", "UTC",
			[]byte(`{}`), []byte(`[]`), false, slaCreatedBy,
		).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
			AddRow(slaCalID, at, at))

	err := repo.CreateCalendar(context.Background(), mock, cal)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetCalendar(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(6000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_calendars\s+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL`).
		WithArgs(slaCalID, slaTenantA).
		WillReturnRows(pgxmock.NewRows(calendarCols).AddRow(
			slaCalID, slaTenantA, "Riyadh", "", "Asia/Riyadh",
			[]byte(`{"0":{"start_minute":540,"end_minute":1020},"1":{"start_minute":540,"end_minute":1020}}`),
			[]byte(`["2026-09-23"]`), true, slaCreatedBy, at, at,
		))

	rec, err := repo.GetCalendar(context.Background(), mock, slaTenantA, slaCalID)
	require.NoError(t, err)
	require.Equal(t, "Asia/Riyadh", rec.Timezone)
	require.Len(t, rec.WorkingDays, 2)
	require.Equal(t, 540, rec.WorkingDays["0"].StartMinute)
	require.Equal(t, []string{"2026-09-23"}, rec.Holidays)
	require.True(t, rec.IsDefault)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetCalendar_NotFound(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectQuery(`SELECT .* FROM workflow_calendars`).
		WithArgs(slaCalID, slaTenantA).
		WillReturnRows(pgxmock.NewRows(calendarCols))

	_, err := repo.GetCalendar(context.Background(), mock, slaTenantA, slaCalID)
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetDefaultCalendar(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(6000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_calendars\s+WHERE tenant_id = \$1 AND is_default = true AND deleted_at IS NULL`).
		WithArgs(slaTenantA).
		WillReturnRows(pgxmock.NewRows(calendarCols).AddRow(
			slaCalID, slaTenantA, "Default", "", "UTC",
			[]byte(`{}`), []byte(`[]`), true, slaCreatedBy, at, at,
		))

	rec, err := repo.GetDefaultCalendar(context.Background(), mock, slaTenantA)
	require.NoError(t, err)
	require.True(t, rec.IsDefault)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_GetDefaultCalendar_NotFound(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectQuery(`SELECT .* FROM workflow_calendars`).
		WithArgs(slaTenantA).
		WillReturnRows(pgxmock.NewRows(calendarCols))

	_, err := repo.GetDefaultCalendar(context.Background(), mock, slaTenantA)
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_UpdateCalendar(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	cal := &repository.CalendarRecord{
		ID:          slaCalID,
		TenantID:    slaTenantA,
		Name:        "Updated cal",
		Description: "d",
		Timezone:    "Europe/London",
		WorkingDays: map[string]repository.WorkingDayJSON{"1": {StartMinute: 480, EndMinute: 960}},
		Holidays:    []string{"2026-12-25"},
		IsDefault:   false,
	}

	mock.ExpectExec(`UPDATE workflow_calendars\s+SET name = \$3`).
		WithArgs(
			slaCalID, slaTenantA, "Updated cal", "d", "Europe/London",
			[]byte(`{"1":{"start_minute":480,"end_minute":960}}`),
			[]byte(`["2026-12-25"]`), false,
		).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.UpdateCalendar(context.Background(), mock, cal)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_DeleteCalendar(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()

	mock.ExpectExec(`UPDATE workflow_calendars\s+SET deleted_at = now\(\)`).
		WithArgs(slaCalID, slaTenantA).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.DeleteCalendar(context.Background(), mock, slaTenantA, slaCalID)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSLARepository_ListCalendars(t *testing.T) {
	t.Parallel()
	mock := newSLAMock(t)
	repo := repository.NewSLARepository()
	at := time.Unix(7000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_calendars\s+WHERE tenant_id = \$1 AND deleted_at IS NULL\s+ORDER BY created_at DESC`).
		WithArgs(slaTenantA).
		WillReturnRows(pgxmock.NewRows(calendarCols).
			AddRow(slaCalID, slaTenantA, "C2", "", "UTC", []byte(`{}`), []byte(`[]`), false, slaCreatedBy, at, at).
			AddRow("c1", slaTenantA, "C1", "", "UTC", []byte(`{}`), []byte(`[]`), true, slaCreatedBy, at, at))

	recs, err := repo.ListCalendars(context.Background(), mock, slaTenantA)
	require.NoError(t, err)
	require.Len(t, recs, 2)
	require.Equal(t, "C2", recs[0].Name)
	require.True(t, recs[1].IsDefault)
	require.NoError(t, mock.ExpectationsWereMet())
}
