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

func TestEnrollmentTokens_Insert(t *testing.T) {
	m := mustMock(t)
	r := NewEnrollmentTokensRepo(m)
	rec := sources.EnrollmentTokenRecord{
		JTI: uuid.New(), SourceID: uuid.New(), TenantID: uuid.New(),
		Purpose: sources.PurposeEnroll, ExpiresAt: time.Now().Add(15 * time.Minute),
		IssuedBy: uuid.New(),
	}
	m.ExpectExec("INSERT INTO siem.enrollment_tokens").
		WithArgs(rec.JTI, rec.SourceID, rec.TenantID, "enroll", rec.ExpiresAt, rec.IssuedBy).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))
	require.NoError(t, r.Insert(context.Background(), rec))
}

func TestEnrollmentTokens_MarkConsumed(t *testing.T) {
	m := mustMock(t)
	r := NewEnrollmentTokensRepo(m)
	jti := uuid.New()
	tenant := uuid.New()
	src := uuid.New()
	issuer := uuid.New()
	now := time.Now().UTC()
	consumed := now

	m.ExpectQuery("UPDATE siem.enrollment_tokens").
		WithArgs(jti, now, any("10.0.0.1")).
		WillReturnRows(pgxmock.NewRows([]string{
			"jti", "source_id", "tenant_id", "purpose", "issued_at", "expires_at",
			"consumed_at", "consumed_from_ip", "issued_by",
		}).AddRow(jti, src, tenant, "enroll", now, now.Add(15*time.Minute), &consumed, strPtr("10.0.0.1"), issuer))

	rec, err := r.MarkConsumed(context.Background(), jti, "10.0.0.1", now)
	require.NoError(t, err)
	require.Equal(t, sources.PurposeEnroll, rec.Purpose)
	require.NotNil(t, rec.ConsumedAt)
}

func strPtr(s string) *string { return &s }

func TestEnrollmentTokens_MarkConsumed_Replay(t *testing.T) {
	m := mustMock(t)
	r := NewEnrollmentTokensRepo(m)
	jti := uuid.New()
	m.ExpectQuery("UPDATE siem.enrollment_tokens").
		WithArgs(jti, pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{
			"jti", "source_id", "tenant_id", "purpose", "issued_at", "expires_at",
			"consumed_at", "consumed_from_ip", "issued_by",
		}))
	_, err := r.MarkConsumed(context.Background(), jti, "10.0.0.1", time.Now())
	require.ErrorIs(t, err, sources.ErrTokenConsumed)
}

func TestEnrollmentTokens_Get_NotFound(t *testing.T) {
	m := mustMock(t)
	r := NewEnrollmentTokensRepo(m)
	jti := uuid.New()
	m.ExpectQuery("SELECT").
		WithArgs(jti).
		WillReturnRows(pgxmock.NewRows([]string{
			"jti", "source_id", "tenant_id", "purpose", "issued_at", "expires_at",
			"consumed_at", "consumed_from_ip", "issued_by",
		}))
	_, err := r.Get(context.Background(), jti)
	require.ErrorIs(t, err, sources.ErrNotFound)
}
