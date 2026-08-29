package service

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

func TestService_Get(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	mock.ExpectQuery("SELECT").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "n", sources.StatusActive, 1)...))
	got, err := svc.Get(context.Background(), tenant, id)
	require.NoError(t, err)
	require.Equal(t, id, got.ID)
}

func TestService_List(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	mock.ExpectQuery("SELECT").
		WithArgs(tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).
			AddRow(sourceRow(tenant, uuid.New(), "a", sources.StatusActive, 1)...))
	got, err := svc.List(context.Background(), tenant, sources.ListQuery{Limit: 50})
	require.NoError(t, err)
	require.Len(t, got.Items, 1)
}

func TestService_Enable_FromDisabled(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	mock.ExpectQuery("SELECT").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "n", sources.StatusDisabled, 1)...))
	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(id, tenant, int64(1), "active").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "n", sources.StatusActive, 2)...))
	got, err := svc.Enable(context.Background(), tenant, id, 1)
	require.NoError(t, err)
	require.Equal(t, sources.StatusActive, got.Status)
}

func TestService_Enable_Idempotent(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	mock.ExpectQuery("SELECT").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "n", sources.StatusActive, 1)...))
	got, err := svc.Enable(context.Background(), tenant, id, 1)
	require.NoError(t, err)
	require.Equal(t, sources.StatusActive, got.Status)
}

func TestService_Update_OK(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	addr := "10.0.0.5:514"
	mock.ExpectQuery("SELECT").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusActive, 1)...))
	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(id, tenant, int64(1), addr).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusActive, 2)...))
	got, err := svc.Update(context.Background(), tenant, id, sources.UpdateInput{Address: &addr}, 1)
	require.NoError(t, err)
	require.NotNil(t, got)
}

func TestService_Update_ValidationFails(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	bad := "not-a-host"
	mock.ExpectQuery("SELECT").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusActive, 1)...))
	_, err := svc.Update(context.Background(), tenant, id, sources.UpdateInput{Address: &bad}, 1)
	require.ErrorIs(t, err, sources.ErrValidation)
}

func TestService_RotateCert_Provisioning_Rejected(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	mock.ExpectQuery("SELECT").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusProvisioning, 1)...))
	_, err := svc.RotateCert(context.Background(), tenant, id, false, 1)
	require.ErrorIs(t, err, sources.ErrInvalidState)
}

func TestService_RotateCert_InWindow(t *testing.T) {
	svc, mock, _ := makeSvc(t)
	tenant := uuid.New()
	id := uuid.New()
	row := sourceRow(tenant, id, "fw", sources.StatusActive, 1)
	expires := time.Now().Add(7 * 24 * time.Hour) // within 30d window
	row[17] = &expires
	mock.ExpectQuery("SELECT").
		WithArgs(id, tenant).
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	mock.ExpectQuery("UPDATE siem.sources").
		WithArgs(id, tenant, int64(1), "rotating").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(sourceRow(tenant, id, "fw", sources.StatusRotating, 2)...))
	mock.ExpectExec("INSERT INTO siem.enrollment_tokens").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))

	tok, err := svc.RotateCert(context.Background(), tenant, id, false, 1)
	require.NoError(t, err)
	require.Equal(t, sources.PurposeRotate, tok.Purpose)
}
