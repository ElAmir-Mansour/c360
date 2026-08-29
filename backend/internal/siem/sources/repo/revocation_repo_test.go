package repo

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func TestRevocation_Insert(t *testing.T) {
	m := mustMock(t)
	r := NewRevocationRepo(m)
	rv := sources.Revocation{
		Thumbprint: "abc", SourceID: uuid.New(),
		CertSerial: "00:01", Reason: "rotate",
	}
	m.ExpectExec("INSERT INTO siem.source_cert_revocations").
		WithArgs(rv.Thumbprint, rv.SourceID, rv.CertSerial, rv.Reason).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))
	require.NoError(t, r.Insert(context.Background(), rv))
}

func TestRevocation_Get(t *testing.T) {
	m := mustMock(t)
	r := NewRevocationRepo(m)
	thumb := "deadbeef"
	now := time.Now().UTC()
	src := uuid.New()
	m.ExpectQuery("SELECT thumbprint").
		WithArgs(thumb).
		WillReturnRows(pgxmock.NewRows([]string{"thumbprint", "source_id", "cert_serial", "revoked_at", "reason"}).
			AddRow(thumb, src, "sn", now, "x"))
	rv, err := r.Get(context.Background(), thumb)
	require.NoError(t, err)
	require.Equal(t, src, rv.SourceID)
}

func TestRevocation_Get_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewRevocationRepo(m)
	m.ExpectQuery("SELECT thumbprint").
		WithArgs("missing").
		WillReturnRows(pgxmock.NewRows([]string{"thumbprint", "source_id", "cert_serial", "revoked_at", "reason"}))
	_, err := r.Get(context.Background(), "missing")
	require.ErrorIs(t, err, sources.ErrNotFound)
}

func TestRevocation_ListSince(t *testing.T) {
	m := mustMock(t)
	r := NewRevocationRepo(m)
	now := time.Now().UTC()
	m.ExpectQuery("SELECT thumbprint").
		WithArgs(pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"thumbprint", "source_id", "cert_serial", "revoked_at", "reason"}).
			AddRow("a", uuid.New(), "sn", now, "x").
			AddRow("b", uuid.New(), "sn", now, "y"))
	got, err := r.ListSince(context.Background(), time.Time{})
	require.NoError(t, err)
	require.Len(t, got, 2)
}

func TestRevocation_CountForSource(t *testing.T) {
	m := mustMock(t)
	r := NewRevocationRepo(m)
	src := uuid.New()
	m.ExpectQuery("SELECT count").
		WithArgs(src).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(2))
	n, err := r.CountForSource(context.Background(), src)
	require.NoError(t, err)
	require.Equal(t, 2, n)
}
