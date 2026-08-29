package repo

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func TestSourcesRepo_Update_NoFields_ReturnsCurrent(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	tenant := uuid.New()
	id := uuid.New()
	m.ExpectQuery("SELECT .*FROM siem.sources").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "x", sources.StatusActive, 1)...))

	got, err := r.Update(context.Background(), tenant, id, sources.UpdateInput{}, 1)
	require.NoError(t, err)
	require.NotNil(t, got)
}

func TestSourcesRepo_SoftDelete_VersionMismatch(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	tenant := uuid.New()
	id := uuid.New()
	m.ExpectExec("UPDATE siem.sources").
		WithArgs(id, tenant, int64(2)).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 0"))
	m.ExpectQuery("SELECT version FROM siem.sources").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows([]string{"version"}).AddRow(int64(5)))
	err := r.SoftDelete(context.Background(), tenant, id, 2)
	require.ErrorIs(t, err, sources.ErrVersionMismatch)
}

func TestSourcesRepo_SoftDelete_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	tenant := uuid.New()
	id := uuid.New()
	m.ExpectExec("UPDATE siem.sources").
		WithArgs(id, tenant, int64(2)).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 0"))
	m.ExpectQuery("SELECT version FROM siem.sources").
		WithArgs(id, tenant).
		WillReturnError(errors.New("not found"))
	err := r.SoftDelete(context.Background(), tenant, id, 2)
	require.Error(t, err)
}

func TestSourcesRepo_ListActive(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	tenant := uuid.New()
	m.ExpectQuery("SELECT .*FROM siem.sources").
		WillReturnRows(pgxmock.NewRows(sourceCols()).
			AddRow(sourceRow(tenant, uuid.New(), "a", sources.StatusActive, 1)...).
			AddRow(sourceRow(tenant, uuid.New(), "b", sources.StatusSilent, 2)...))
	got, err := r.ListActive(context.Background())
	require.NoError(t, err)
	require.Len(t, got, 2)
}

func TestSourcesRepo_GetCredentials_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	id := uuid.New()
	m.ExpectQuery("SELECT source_id").
		WithArgs(id).
		WillReturnRows(pgxmock.NewRows([]string{
			"source_id", "vault_pki_mount", "vault_key_ref", "cert_pem", "ca_chain_pem", "created_at", "rotated_at",
		}))
	_, err := r.GetCredentials(context.Background(), id)
	require.ErrorIs(t, err, sources.ErrNotFound)
}

func TestSourcesRepo_GetCredentials_OK(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	id := uuid.New()
	now := time.Now()
	m.ExpectQuery("SELECT source_id").
		WithArgs(id).
		WillReturnRows(pgxmock.NewRows([]string{
			"source_id", "vault_pki_mount", "vault_key_ref", "cert_pem", "ca_chain_pem", "created_at", "rotated_at",
		}).AddRow(id, "mount", "ref", "pem", "chain", now, nil))
	got, err := r.GetCredentials(context.Background(), id)
	require.NoError(t, err)
	require.Equal(t, "mount", got.VaultPKIMount)
}

func TestSourcesRepo_MarkCertRevoked(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	id := uuid.New()
	m.ExpectExec("UPDATE siem.sources").
		WithArgs(id, "rotation").
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	require.NoError(t, r.MarkCertRevoked(context.Background(), id, "rotation"))
}

func TestSourcesRepo_SetStatusUnchecked(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	id := uuid.New()
	m.ExpectExec("UPDATE siem.sources").
		WithArgs(id, "silent").
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	require.NoError(t, r.SetStatusUnchecked(context.Background(), id, sources.StatusSilent))
}

func TestSourcesRepo_SetStatusUnchecked_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewSourcesRepo(m)
	id := uuid.New()
	m.ExpectExec("UPDATE siem.sources").
		WithArgs(id, "active").
		WillReturnResult(pgconn.NewCommandTag("UPDATE 0"))
	err := r.SetStatusUnchecked(context.Background(), id, sources.StatusActive)
	require.ErrorIs(t, err, sources.ErrNotFound)
}

func TestEnrollmentTokens_Get_OK(t *testing.T) {
	m := mustMock(t)
	r := NewEnrollmentTokensRepo(m)
	jti := uuid.New()
	src := uuid.New()
	tenant := uuid.New()
	issuer := uuid.New()
	now := time.Now().UTC()
	m.ExpectQuery("SELECT").
		WithArgs(jti).
		WillReturnRows(pgxmock.NewRows([]string{
			"jti", "source_id", "tenant_id", "purpose", "issued_at", "expires_at",
			"consumed_at", "consumed_from_ip", "issued_by",
		}).AddRow(jti, src, tenant, "enroll", now, now.Add(time.Minute), nil, nil, issuer))
	got, err := r.Get(context.Background(), jti)
	require.NoError(t, err)
	require.Equal(t, sources.PurposeEnroll, got.Purpose)
}
