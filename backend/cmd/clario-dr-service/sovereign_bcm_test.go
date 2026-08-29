package main

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/dr/model"
)

func TestSovereignBCMEvidenceSourcesReadTenantScopedLiveTables(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()
	groupID := uuid.New()
	runID := uuid.New()
	now := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)

	mock, err := pgxmock.NewPool()
	require.NoError(t, err)
	defer mock.Close()

	mock.ExpectQuery(`FROM dr_drill_result[\s\S]+WHERE tenant_id = \$1 AND group_id = \$2`).
		WithArgs(tenantID, groupID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "group_id", "passed", "rto_achieved_seconds", "rto_objective_seconds",
			"rpo_achieved_seconds", "observed_at",
		}).AddRow(uuid.New(), groupID, true, 210, 300, 25, now))
	drills, err := (bcmDrillSource{}).DrillEvidence(ctx, mock, tenantID, groupID)
	require.NoError(t, err)
	require.Len(t, drills, 1)
	require.True(t, drills[0].Passed)
	require.Equal(t, 25, drills[0].RPOSeconds)

	mock.ExpectQuery(`FROM failover_run[\s\S]+WHERE tenant_id = \$1 AND group_id = \$2 AND status = \$3 AND completed_at IS NOT NULL`).
		WithArgs(tenantID, groupID, model.StatusCompleted).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "group_id", "mode", "status", "rto_actual_seconds",
			"rto_objective_seconds", "completed_at",
		}).AddRow(runID, groupID, model.ModeDrill, model.StatusCompleted, 240, 300, now))
	failovers, err := (bcmFailoverSource{}).FailoverEvidence(ctx, mock, tenantID, groupID)
	require.NoError(t, err)
	require.Len(t, failovers, 1)
	require.Equal(t, model.StatusCompleted, failovers[0].Status)
	require.Equal(t, 240, failovers[0].RTOActualSeconds)

	retention := now.Add(30 * 24 * time.Hour)
	mock.ExpectQuery(`COALESCE\(validation_ratio, 0\)[\s\S]+FROM recovery_point[\s\S]+WHERE tenant_id = \$1 AND group_id = \$2`).
		WithArgs(tenantID, groupID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "group_id", "rpo_seconds", "validation_ratio", "is_validated",
			"immutable", "sealed_at", "retention_until",
		}).AddRow(uuid.New(), groupID, 18, 0.9999, true, true, now, retention))
	rps, err := (bcmRecoveryPointSource{}).RecoveryPointEvidence(ctx, mock, tenantID, groupID)
	require.NoError(t, err)
	require.Len(t, rps, 1)
	require.True(t, rps[0].IsValidated)
	require.True(t, rps[0].Immutable)
	require.Equal(t, retention, rps[0].RetentionUntil)

	mock.ExpectQuery(`FROM attestation a[\s\S]+JOIN failover_run r ON r\.id = a\.run_id AND r\.tenant_id = a\.tenant_id[\s\S]+WHERE a\.tenant_id = \$1 AND r\.group_id = \$2`).
		WithArgs(tenantID, groupID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "group_id", "run_id", "rto_objective_seconds", "rto_actual_seconds",
			"rpo_seconds", "validation_ratio", "created_at",
		}).AddRow(uuid.New(), groupID, runID, 300, 240, 18, 0.9999, now))
	atts, err := (bcmAttestationSource{}).AttestationEvidence(ctx, mock, tenantID, groupID)
	require.NoError(t, err)
	require.Len(t, atts, 1)
	require.Equal(t, runID, atts[0].RunID)

	mock.ExpectQuery(`FROM dr_cleanroom_scan[\s\S]+WHERE tenant_id = \$1 AND group_id = \$2`).
		WithArgs(tenantID, groupID).
		WillReturnRows(pgxmock.NewRows([]string{"id", "group_id", "verdict", "clean", "finished_at"}).
			AddRow(uuid.New(), groupID, "clean", true, now))
	scans, err := (bcmCleanRoomSource{}).CleanRoomEvidence(ctx, mock, tenantID, groupID)
	require.NoError(t, err)
	require.Len(t, scans, 1)
	require.True(t, scans[0].Clean)

	mock.ExpectQuery(`LEFT JOIN protected_site ps ON ps\.id = m\.site_id AND ps\.tenant_id = g\.tenant_id[\s\S]+LEFT JOIN replication_stream s ON s\.tenant_id = g\.tenant_id AND s\.site_id = ps\.id[\s\S]+WHERE g\.tenant_id = \$1 AND g\.id = \$2`).
		WithArgs(tenantID, groupID).
		WillReturnRows(pgxmock.NewRows([]string{"name", "member_count", "has_stream"}).
			AddRow("payments", 3, true))
	topo, err := (bcmTopologySource{}).GroupTopology(ctx, mock, tenantID, groupID)
	require.NoError(t, err)
	require.True(t, topo.Exists)
	require.Equal(t, "payments", topo.Name)
	require.Equal(t, 3, topo.MemberCount)
	require.True(t, topo.HasStream)

	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSovereignBCMTopologyMissingIsNonFatal(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()
	groupID := uuid.New()

	mock, err := pgxmock.NewPool()
	require.NoError(t, err)
	defer mock.Close()

	mock.ExpectQuery(`WHERE g\.tenant_id = \$1 AND g\.id = \$2`).
		WithArgs(tenantID, groupID).
		WillReturnError(pgx.ErrNoRows)

	topo, err := (bcmTopologySource{}).GroupTopology(ctx, mock, tenantID, groupID)
	require.NoError(t, err)
	require.False(t, topo.Exists)
	require.Equal(t, groupID, topo.GroupID)
	require.NoError(t, mock.ExpectationsWereMet())
}
