package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	drmodel "github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/runbookstudio"
	drservice "github.com/clario360/platform/internal/dr/service"
)

type fakeFailoverControl struct {
	createInput  drservice.CreateFailoverRunInput
	createTenant uuid.UUID
	approveArgs  []uuid.UUID
	cancelArgs   []uuid.UUID
	statusArgs   []uuid.UUID
	err          error
}

func (f *fakeFailoverControl) CreateFailoverRun(_ context.Context, tenantID uuid.UUID, in drservice.CreateFailoverRunInput) (*drmodel.FailoverRun, error) {
	f.createTenant = tenantID
	f.createInput = in
	if f.err != nil {
		return nil, f.err
	}
	return &drmodel.FailoverRun{
		ID:                  uuid.NewString(),
		TenantID:            tenantID.String(),
		GroupID:             in.GroupID.String(),
		Mode:                in.Mode,
		Status:              drmodel.StatusInitiated,
		RTOObjectiveSeconds: in.RTOObjectiveSeconds,
		InitiatedBy:         in.InitiatedBy.String(),
		InitiatedAt:         time.Now().UTC(),
		UpdatedAt:           time.Now().UTC(),
	}, nil
}

func (f *fakeFailoverControl) ApproveFailoverRun(_ context.Context, tenantID, runID, approvedBy uuid.UUID, _ ...drservice.ApproveFailoverRunInput) (*drmodel.FailoverRun, error) {
	f.approveArgs = []uuid.UUID{tenantID, runID, approvedBy}
	if f.err != nil {
		return nil, f.err
	}
	return failoverRunForTest(tenantID, runID, drmodel.StatusApproved), nil
}

func (f *fakeFailoverControl) CancelFailoverRun(_ context.Context, tenantID, runID, cancelledBy uuid.UUID) (*drmodel.FailoverRun, error) {
	f.cancelArgs = []uuid.UUID{tenantID, runID, cancelledBy}
	if f.err != nil {
		return nil, f.err
	}
	return failoverRunForTest(tenantID, runID, drmodel.StatusCancelled), nil
}

func (f *fakeFailoverControl) GetFailoverRun(_ context.Context, tenantID, runID uuid.UUID) (*drmodel.FailoverRun, error) {
	f.statusArgs = []uuid.UUID{tenantID, runID}
	if f.err != nil {
		return nil, f.err
	}
	return failoverRunForTest(tenantID, runID, drmodel.StatusExecuting), nil
}

func failoverRunForTest(tenantID, runID uuid.UUID, status string) *drmodel.FailoverRun {
	return &drmodel.FailoverRun{
		ID:          runID.String(),
		TenantID:    tenantID.String(),
		GroupID:     uuid.NewString(),
		Mode:        drmodel.ModeReal,
		Status:      status,
		InitiatedBy: uuid.NewString(),
		InitiatedAt: time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
}

func TestRunbookActionExecutor_FailoverCreate(t *testing.T) {
	dr := &fakeFailoverControl{}
	exec := newRunbookActionExecutor(dr, time.Second, zerolog.Nop())
	tenantID := uuid.New()
	groupID := uuid.New()
	actorID := uuid.NewString()
	recoveryPointID := uuid.New()

	out, err := exec.Run(context.Background(), "dr.failover.create", runbookstudio.ExecutorInput{
		TenantID: tenantID.String(),
		GroupID:  groupID.String(),
		RunMode:  runbookstudio.RunModeRehearsal,
		ActedBy:  &actorID,
		Params: map[string]any{
			"recovery_point_id":     recoveryPointID.String(),
			"rto_objective_seconds": float64(120),
		},
	})
	require.NoError(t, err)
	require.NotEmpty(t, out.ExternalID)
	require.Equal(t, tenantID, dr.createTenant)
	require.Equal(t, groupID, dr.createInput.GroupID)
	require.Equal(t, drmodel.ModeDrill, dr.createInput.Mode)
	require.Equal(t, recoveryPointID, *dr.createInput.RecoveryPointID)
	require.Equal(t, 120, dr.createInput.RTOObjectiveSeconds)
	require.Equal(t, actorID, dr.createInput.InitiatedBy.String())
	require.Equal(t, drmodel.StatusInitiated, out.Data["status"])
}

func TestRunbookActionExecutor_FailoverCreateRequiresActor(t *testing.T) {
	exec := newRunbookActionExecutor(&fakeFailoverControl{}, time.Second, zerolog.Nop())
	_, err := exec.Run(context.Background(), "dr.failover.create", runbookstudio.ExecutorInput{
		TenantID: uuid.NewString(),
		GroupID:  uuid.NewString(),
	})
	require.Error(t, err)
}

func TestRunbookActionExecutor_FailoverApproveCancelStatus(t *testing.T) {
	dr := &fakeFailoverControl{}
	exec := newRunbookActionExecutor(dr, time.Second, zerolog.Nop())
	tenantID := uuid.New()
	runID := uuid.New()
	actorID := uuid.New()
	input := runbookstudio.ExecutorInput{
		TenantID: tenantID.String(),
		ActedBy:  ptrString(actorID.String()),
		Params: map[string]any{
			"failover_run_id": runID.String(),
		},
	}

	out, err := exec.Run(context.Background(), "dr.failover.approve", input)
	require.NoError(t, err)
	require.Equal(t, []uuid.UUID{tenantID, runID, actorID}, dr.approveArgs)
	require.Equal(t, drmodel.StatusApproved, out.Data["status"])

	out, err = exec.Run(context.Background(), "dr.failover.cancel", input)
	require.NoError(t, err)
	require.Equal(t, []uuid.UUID{tenantID, runID, actorID}, dr.cancelArgs)
	require.Equal(t, drmodel.StatusCancelled, out.Data["status"])

	out, err = exec.Run(context.Background(), "dr.failover.status", input)
	require.NoError(t, err)
	require.Equal(t, []uuid.UUID{tenantID, runID}, dr.statusArgs)
	require.Equal(t, drmodel.StatusExecuting, out.Data["status"])
}

func TestRunbookActionExecutor_PropagatesDRControlErrors(t *testing.T) {
	want := errors.New("dr unavailable")
	exec := newRunbookActionExecutor(&fakeFailoverControl{err: want}, time.Second, zerolog.Nop())
	actorID := uuid.NewString()
	_, err := exec.Run(context.Background(), "dr.failover.create", runbookstudio.ExecutorInput{
		TenantID: uuid.NewString(),
		GroupID:  uuid.NewString(),
		ActedBy:  &actorID,
	})
	require.ErrorIs(t, err, want)
}

func ptrString(s string) *string { return &s }
