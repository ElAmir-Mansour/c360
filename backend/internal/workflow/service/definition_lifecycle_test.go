package service

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// fakeDefinitionRepo is a minimal in-memory definitionRepo for lifecycle-guard tests.
type fakeDefinitionRepo struct {
	def *model.WorkflowDefinition
}

func (f *fakeDefinitionRepo) Create(context.Context, *model.WorkflowDefinition) error { return nil }
func (f *fakeDefinitionRepo) GetByID(context.Context, string, string) (*model.WorkflowDefinition, error) {
	return f.def, nil
}
func (f *fakeDefinitionRepo) GetActiveByID(context.Context, string, string) (*model.WorkflowDefinition, error) {
	return f.def, nil
}
func (f *fakeDefinitionRepo) List(context.Context, string, string, string, string, string, string, int, int) ([]*model.WorkflowDefinition, int, error) {
	return nil, 0, nil
}
func (f *fakeDefinitionRepo) ListVersions(context.Context, string, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}
func (f *fakeDefinitionRepo) Update(context.Context, *model.WorkflowDefinition) error { return nil }
func (f *fakeDefinitionRepo) SoftDelete(context.Context, string, string) error        { return nil }
func (f *fakeDefinitionRepo) GetMaxVersion(context.Context, string, string) (int, error) {
	return 1, nil
}
func (f *fakeDefinitionRepo) GetActiveByTriggerTopic(context.Context, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

func TestActivate_NonDraftReturnsConflict(t *testing.T) {
	repo := &fakeDefinitionRepo{def: &model.WorkflowDefinition{
		ID:     "def-1",
		Status: model.DefinitionStatusActive,
	}}
	svc := NewDefinitionService(repo, zerolog.Nop())

	err := svc.Activate(context.Background(), "tenant-1", "def-1")
	if err == nil {
		t.Fatal("expected error activating a non-draft definition, got nil")
	}
	if !errors.Is(err, model.ErrConflict) {
		t.Fatalf("expected ErrConflict (maps to HTTP 409), got: %v", err)
	}
}

func TestArchive_NonActiveReturnsConflict(t *testing.T) {
	repo := &fakeDefinitionRepo{def: &model.WorkflowDefinition{
		ID:     "def-1",
		Status: model.DefinitionStatusDraft,
	}}
	svc := NewDefinitionService(repo, zerolog.Nop())

	err := svc.Archive(context.Background(), "tenant-1", "def-1")
	if err == nil {
		t.Fatal("expected error archiving a non-active definition, got nil")
	}
	if !errors.Is(err, model.ErrConflict) {
		t.Fatalf("expected ErrConflict (maps to HTTP 409), got: %v", err)
	}
}
