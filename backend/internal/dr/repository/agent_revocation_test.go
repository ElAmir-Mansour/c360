package repository_test

import (
	"context"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

const revocationTenantA = "aaaaaaaa-0000-0000-0000-000000000001"

func newRevocationMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func TestInsertAgentCertRevocation(t *testing.T) {
	t.Parallel()
	mock := newRevocationMock(t)
	repo := repository.New()
	agentID := "aaaaaaaa-0000-0000-0000-000000000010"
	revokedAt := time.Unix(100, 0).UTC()

	mock.ExpectExec(`INSERT INTO dr_agent_cert_revocation`).
		WithArgs("thumb-1", agentID, "serial-1", revokedAt, "rotation-overlap-elapsed").
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	err := repo.InsertAgentCertRevocation(context.Background(), mock, model.AgentCertRevocation{
		Thumbprint: " thumb-1 ",
		AgentID:    agentID,
		CertSerial: " serial-1 ",
		RevokedAt:  revokedAt,
		Reason:     " rotation-overlap-elapsed ",
	})
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestListAgentCertRevocationsSince(t *testing.T) {
	t.Parallel()
	mock := newRevocationMock(t)
	repo := repository.New()
	since := time.Unix(50, 0).UTC()
	revokedAt := time.Unix(100, 0).UTC()
	agentID := "aaaaaaaa-0000-0000-0000-000000000010"

	mock.ExpectQuery(`SELECT thumbprint, agent_id, tenant_id, cert_serial, revoked_at, reason`).
		WithArgs(since).
		WillReturnRows(pgxmock.NewRows([]string{"thumbprint", "agent_id", "tenant_id", "cert_serial", "revoked_at", "reason"}).
			AddRow("thumb-1", agentID, revocationTenantA, "serial-1", revokedAt, "rotation"))

	got, err := repo.ListAgentCertRevocationsSince(context.Background(), mock, since)
	require.NoError(t, err)
	require.Equal(t, []model.AgentCertRevocation{{
		Thumbprint: "thumb-1",
		AgentID:    agentID,
		TenantID:   revocationTenantA,
		CertSerial: "serial-1",
		RevokedAt:  revokedAt,
		Reason:     "rotation",
	}}, got)
	require.NoError(t, mock.ExpectationsWereMet())
}
