package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

// Drive the "query returns error" path in each public method so the
// non-not-found error branches are covered.

func TestSourcesRepo_QueryErrors(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	id := uuid.New()
	tenant := uuid.New()
	boom := errors.New("boom")

	// List
	m.ExpectQuery("SELECT .*FROM siem.sources").WithArgs(tenant).WillReturnError(boom)
	_, err := r.List(context.Background(), tenant, sources.ListQuery{})
	require.Error(t, err)

	// ListActive
	m.ExpectQuery("SELECT .*FROM siem.sources").WillReturnError(boom)
	_, err = r.ListActive(context.Background())
	require.Error(t, err)

	// CountByTenantStatus
	m.ExpectQuery("SELECT tenant_id::text").WillReturnError(boom)
	_, err = r.CountByTenantStatus(context.Background())
	require.Error(t, err)
	_ = id
}

func TestEPSRepo_QueryErrors(t *testing.T) {
	m := mustMock(t)
	r := NewEPSRepo(m)
	boom := errors.New("boom")
	id := uuid.New()

	m.ExpectExec("INSERT INTO siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(boom)
	require.Error(t, r.Insert(context.Background(), sources.EPSSample{SourceID: id}))

	m.ExpectQuery("SELECT COALESCE\\(SUM").WithArgs(id).WillReturnError(boom)
	_, _, err := r.AggregateLastHour(context.Background(), id)
	require.Error(t, err)

	m.ExpectExec("DELETE FROM siem.source_eps_samples").WithArgs(pgxmock.AnyArg()).WillReturnError(boom)
	_, err = r.PruneOlderThan(context.Background(), time.Now())
	require.Error(t, err)
}

func TestRevocationRepo_QueryErrors(t *testing.T) {
	m := mustMock(t)
	r := NewRevocationRepo(m)
	boom := errors.New("boom")

	m.ExpectExec("INSERT INTO siem.source_cert_revocations").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(boom)
	require.Error(t, r.Insert(context.Background(), sources.Revocation{Thumbprint: "x"}))

	m.ExpectQuery("SELECT thumbprint").WithArgs("x").WillReturnError(boom)
	_, err := r.Get(context.Background(), "x")
	require.Error(t, err)

	m.ExpectQuery("SELECT thumbprint").WithArgs(pgxmock.AnyArg()).WillReturnError(boom)
	_, err = r.ListSince(context.Background(), time.Time{})
	require.Error(t, err)

	m.ExpectQuery("SELECT count").WithArgs(pgxmock.AnyArg()).WillReturnError(boom)
	_, err = r.CountForSource(context.Background(), uuid.New())
	require.Error(t, err)
}

func TestEnrollmentTokens_InsertError(t *testing.T) {
	m := mustMock(t)
	r := NewEnrollmentTokensRepo(m)
	m.ExpectExec("INSERT INTO siem.enrollment_tokens").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("boom"))
	require.Error(t, r.Insert(context.Background(), sources.EnrollmentTokenRecord{}))
}

func TestRevocation_All(t *testing.T) {
	m := mustMock(t)
	r := NewRevocationRepo(m)
	m.ExpectQuery("SELECT thumbprint").WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"thumbprint", "source_id", "cert_serial", "revoked_at", "reason"}))
	got, err := r.All(context.Background())
	require.NoError(t, err)
	require.Empty(t, got)
}

func TestEPSRepo_Insert_NoCollectorVersion(t *testing.T) {
	m := mustMock(t)
	r := NewEPSRepo(m)
	m.ExpectExec("INSERT INTO siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errors.New("retryable"))
	err := r.Insert(context.Background(), sources.EPSSample{
		SourceID: uuid.New(), TS: time.Now(),
		CollectorVersion: "vector",
	})
	require.Error(t, err)
}

// nullableString returns nil for "" and otherwise returns the string.
// We test it indirectly to push coverage.
func TestNullableString(t *testing.T) {
	require.Nil(t, nullableString(""))
	require.NotNil(t, nullableString("x"))
}

func TestSourcesRepo_GetByName_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	tenant := uuid.New()
	m.ExpectQuery("SELECT .*FROM siem.sources").
		WithArgs(tenant, "miss").
		WillReturnRows(pgxmock.NewRows(sourceCols()))
	_, err := r.GetByName(context.Background(), tenant, "miss")
	require.ErrorIs(t, err, sources.ErrNotFound)
}

func TestSourcesRepo_GetByThumbprint_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	m.ExpectQuery("SELECT .*FROM siem.sources").
		WithArgs("missing").
		WillReturnRows(pgxmock.NewRows(sourceCols()))
	_, err := r.GetByThumbprint(context.Background(), "missing")
	require.ErrorIs(t, err, sources.ErrNotFound)
}

func TestSourcesRepo_SetStatus_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	tenant := uuid.New()
	id := uuid.New()
	m.ExpectQuery("UPDATE siem.sources").
		WithArgs(id, tenant, int64(1), "active").
		WillReturnRows(pgxmock.NewRows(sourceCols()))
	m.ExpectQuery("SELECT version FROM siem.sources").
		WithArgs(id, tenant).
		WillReturnError(errors.New("no row"))
	_, err := r.SetStatus(context.Background(), tenant, id, sources.StatusActive, 1)
	require.Error(t, err)
}

func TestSourcesRepo_AttachCert_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	tenant := uuid.New()
	id := uuid.New()
	now := time.Now()
	m.ExpectQuery("UPDATE siem.sources").
		WithArgs(id, tenant, "t", "sn", now, now.Add(time.Hour), "active").
		WillReturnRows(pgxmock.NewRows(sourceCols()))
	_, err := r.AttachCert(context.Background(), tenant, id, "t", "sn", now, now.Add(time.Hour), sources.StatusActive)
	require.ErrorIs(t, err, sources.ErrNotFound)
}
