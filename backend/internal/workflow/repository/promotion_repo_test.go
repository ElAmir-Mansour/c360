package repository_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

const (
	promoTenantA = "aaaaaaaa-0000-0000-0000-000000000001"
	promoDefID   = "bbbbbbbb-0000-0000-0000-000000000002"
	promoKey     = "cccccccc-0000-0000-0000-000000000003"
)

func newPromoMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

// promotionCols matches the SELECT projection used by the repository.
var promotionCols = []string{
	"id", "tenant_id", "name", "version", "status",
	"definition_key", "stage", "immutable", "promoted_at", "promoted_by",
}

// strptr returns a *string so AddRow's promoted_by value matches the *string
// scan destination the repository uses for that nullable column.
func strptr(s string) *string { return &s }

func TestPromotionRepository_GetByID(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()
	promotedAt := time.Unix(1000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_definitions\s+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL`).
		WithArgs(promoDefID, promoTenantA).
		WillReturnRows(pgxmock.NewRows(promotionCols).
			AddRow(promoDefID, promoTenantA, "Onboarding", 3, "active",
				promoKey, repository.StageStaging, true, &promotedAt, strptr("user-7")))

	rec, err := repo.GetByID(context.Background(), mock, promoTenantA, promoDefID)
	require.NoError(t, err)
	require.Equal(t, promoDefID, rec.ID)
	require.Equal(t, promoKey, rec.DefinitionKey)
	require.Equal(t, repository.StageStaging, rec.Stage)
	require.True(t, rec.Immutable)
	require.Equal(t, "user-7", rec.PromotedBy)
	require.NotNil(t, rec.PromotedAt)
	require.Equal(t, promotedAt, *rec.PromotedAt)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_GetByID_NotFound(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()

	mock.ExpectQuery(`SELECT .* FROM workflow_definitions`).
		WithArgs(promoDefID, promoTenantA).
		WillReturnRows(pgxmock.NewRows(promotionCols)) // empty -> ErrNoRows on QueryRow.Scan

	_, err := repo.GetByID(context.Background(), mock, promoTenantA, promoDefID)
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_GetByID_NullPromotedBy(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()

	mock.ExpectQuery(`SELECT .* FROM workflow_definitions`).
		WithArgs(promoDefID, promoTenantA).
		WillReturnRows(pgxmock.NewRows(promotionCols).
			AddRow(promoDefID, promoTenantA, "Onboarding", 1, "draft",
				promoKey, repository.StageDev, false, nil, nil))

	rec, err := repo.GetByID(context.Background(), mock, promoTenantA, promoDefID)
	require.NoError(t, err)
	require.Equal(t, "", rec.PromotedBy)
	require.Nil(t, rec.PromotedAt)
	require.False(t, rec.Immutable)
	require.Equal(t, repository.StageDev, rec.Stage)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_GetLineageKey(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()

	mock.ExpectQuery(`SELECT definition_key\s+FROM workflow_definitions\s+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL`).
		WithArgs(promoDefID, promoTenantA).
		WillReturnRows(pgxmock.NewRows([]string{"definition_key"}).AddRow(promoKey))

	key, err := repo.GetLineageKey(context.Background(), mock, promoTenantA, promoDefID)
	require.NoError(t, err)
	require.Equal(t, promoKey, key)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_GetLineageKey_NotFound(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()

	mock.ExpectQuery(`SELECT definition_key`).
		WithArgs(promoDefID, promoTenantA).
		WillReturnRows(pgxmock.NewRows([]string{"definition_key"})) // empty

	_, err := repo.GetLineageKey(context.Background(), mock, promoTenantA, promoDefID)
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_SetStage(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()

	mock.ExpectExec(`UPDATE workflow_definitions\s+SET stage = \$3, updated_at = now\(\)\s+WHERE id = \$1 AND tenant_id = \$2 AND deleted_at IS NULL`).
		WithArgs(promoDefID, promoTenantA, repository.StageStaging).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.SetStage(context.Background(), mock, promoTenantA, promoDefID, repository.StageStaging)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_SetStage_NotFound(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()

	mock.ExpectExec(`UPDATE workflow_definitions`).
		WithArgs(promoDefID, promoTenantA, repository.StageStaging).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0)) // no rows affected

	err := repo.SetStage(context.Background(), mock, promoTenantA, promoDefID, repository.StageStaging)
	require.Error(t, err)
	require.True(t, errors.Is(err, model.ErrNotFound))
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_SetImmutable(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()

	mock.ExpectExec(`UPDATE workflow_definitions\s+SET immutable = \$3, updated_at = now\(\)`).
		WithArgs(promoDefID, promoTenantA, true).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.SetImmutable(context.Background(), mock, promoTenantA, promoDefID, true)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_StampPromotion(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()
	at := time.Unix(2000, 0).UTC()

	mock.ExpectExec(`UPDATE workflow_definitions\s+SET promoted_at = \$3, promoted_by = \$4, updated_at = now\(\)`).
		WithArgs(promoDefID, promoTenantA, at, strptr("user-9")).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.StampPromotion(context.Background(), mock, promoTenantA, promoDefID, "user-9", at)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_StampPromotion_EmptyUserStoredAsNull(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()
	at := time.Unix(2000, 0).UTC()

	// nilIfEmpty turns "" into a typed (*string)(nil) bind so promoted_by stays
	// NULL; the expectation must use the same typed nil to match.
	mock.ExpectExec(`UPDATE workflow_definitions\s+SET promoted_at = \$3, promoted_by = \$4`).
		WithArgs(promoDefID, promoTenantA, at, (*string)(nil)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	err := repo.StampPromotion(context.Background(), mock, promoTenantA, promoDefID, "", at)
	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_ListByLineage(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()
	promotedAt := time.Unix(3000, 0).UTC()

	mock.ExpectQuery(`SELECT .* FROM workflow_definitions\s+WHERE tenant_id = \$1 AND definition_key = \$2 AND deleted_at IS NULL\s+ORDER BY version DESC`).
		WithArgs(promoTenantA, promoKey).
		WillReturnRows(pgxmock.NewRows(promotionCols).
			AddRow("v3", promoTenantA, "Onboarding", 3, "draft", promoKey, repository.StageDev, false, nil, nil).
			AddRow("v2", promoTenantA, "Onboarding", 2, "active", promoKey, repository.StageProd, true, &promotedAt, strptr("user-1")).
			AddRow("v1", promoTenantA, "Onboarding", 1, "deprecated", promoKey, repository.StageStaging, true, &promotedAt, strptr("user-1")))

	recs, err := repo.ListByLineage(context.Background(), mock, promoTenantA, promoKey)
	require.NoError(t, err)
	require.Len(t, recs, 3)
	require.Equal(t, 3, recs[0].Version)
	require.Equal(t, repository.StageDev, recs[0].Stage)
	require.Equal(t, repository.StageProd, recs[1].Stage)
	require.True(t, recs[1].Immutable)
	require.Equal(t, repository.StageStaging, recs[2].Stage)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestPromotionRepository_ListByLineage_Empty(t *testing.T) {
	t.Parallel()
	mock := newPromoMock(t)
	repo := repository.NewPromotionRepository()

	mock.ExpectQuery(`SELECT .* FROM workflow_definitions`).
		WithArgs(promoTenantA, promoKey).
		WillReturnRows(pgxmock.NewRows(promotionCols))

	recs, err := repo.ListByLineage(context.Background(), mock, promoTenantA, promoKey)
	require.NoError(t, err)
	require.NotNil(t, recs)
	require.Len(t, recs, 0)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestErrPromotionConflict_WrapsModelConflict(t *testing.T) {
	t.Parallel()
	require.True(t, errors.Is(repository.ErrPromotionConflict, model.ErrConflict))
}
