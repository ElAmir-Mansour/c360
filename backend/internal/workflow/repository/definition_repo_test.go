package repository

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/workflow/model"
)

const (
	defRepoTenantID = "aaaaaaaa-0000-0000-0000-000000000001"
	defRepoUserID   = "bbbbbbbb-0000-0000-0000-000000000002"
	defRepoID       = "cccccccc-0000-0000-0000-000000000003"
	defRepoKey      = "dddddddd-0000-0000-0000-000000000004"
)

func newDefinitionRepoMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func testWorkflowDefinition() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		TenantID:      defRepoTenantID,
		Name:          "Untitled Workflow",
		Description:   "",
		Category:      model.CategoryCustom,
		Version:       1,
		Status:        model.DefinitionStatusDraft,
		DefinitionKey: defRepoKey,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Variables:     map[string]model.VariableDef{},
		Steps: []model.StepDefinition{
			{ID: "end", Type: model.StepTypeEnd, Name: "End"},
		},
		CreatedBy: defRepoUserID,
	}
}

func TestDefinitionRepositoryCreatePersistsDefinitionKey(t *testing.T) {
	mock := newDefinitionRepoMock(t)
	repo := &DefinitionRepository{db: mock}
	def := testWorkflowDefinition()
	now := time.Date(2026, 6, 27, 17, 45, 0, 0, time.UTC)

	mock.ExpectQuery(`(?s)INSERT INTO workflow_definitions.*definition_key.*RETURNING id, definition_key, created_at, updated_at`).
		WithArgs(
			def.TenantID,
			def.Name,
			def.Description,
			def.Category,
			def.Version,
			def.Status,
			def.DefinitionKey,
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			def.CreatedBy,
			(*string)(nil),
			(*time.Time)(nil),
		).
		WillReturnRows(pgxmock.NewRows([]string{"id", "definition_key", "created_at", "updated_at"}).
			AddRow(defRepoID, defRepoKey, now, now))

	if err := repo.Create(context.Background(), def); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if def.ID != defRepoID {
		t.Fatalf("Create() ID = %q, want %q", def.ID, defRepoID)
	}
	if def.DefinitionKey != defRepoKey {
		t.Fatalf("Create() DefinitionKey = %q, want %q", def.DefinitionKey, defRepoKey)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestDefinitionRepositoryCreateMapsDuplicateNameVersionToConflict(t *testing.T) {
	mock := newDefinitionRepoMock(t)
	repo := &DefinitionRepository{db: mock}

	mock.ExpectQuery(`INSERT INTO workflow_definitions`).
		WithArgs(
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
		).
		WillReturnError(&pgconn.PgError{Code: "23505", Message: "duplicate key"})

	err := repo.Create(context.Background(), testWorkflowDefinition())
	if !errors.Is(err, model.ErrConflict) {
		t.Fatalf("Create() error = %v, want model.ErrConflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
