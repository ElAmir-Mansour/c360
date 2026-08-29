package service

import (
	"context"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

type recordingDefinitionRepo struct {
	created       []*model.WorkflowDefinition
	updated       []*model.WorkflowDefinition
	byID          map[string]*model.WorkflowDefinition
	maxVersion    int
	maxVersionKey string
}

func (r *recordingDefinitionRepo) Create(_ context.Context, def *model.WorkflowDefinition) error {
	cp := *def
	r.created = append(r.created, &cp)
	return nil
}

func (r *recordingDefinitionRepo) GetByID(_ context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	def, ok := r.byID[id]
	if !ok || def.TenantID != tenantID {
		return nil, model.ErrNotFound
	}
	cp := *def
	return &cp, nil
}

func (r *recordingDefinitionRepo) GetActiveByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	return r.GetByID(ctx, tenantID, id)
}

func (r *recordingDefinitionRepo) List(context.Context, string, string, string, string, string, string, int, int) ([]*model.WorkflowDefinition, int, error) {
	return nil, 0, nil
}

func (r *recordingDefinitionRepo) ListVersions(context.Context, string, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

func (r *recordingDefinitionRepo) Update(_ context.Context, def *model.WorkflowDefinition) error {
	cp := *def
	r.updated = append(r.updated, &cp)
	return nil
}

func (r *recordingDefinitionRepo) SoftDelete(context.Context, string, string) error {
	return nil
}

func (r *recordingDefinitionRepo) GetMaxVersion(_ context.Context, _ string, definitionKey string) (int, error) {
	r.maxVersionKey = definitionKey
	return r.maxVersion, nil
}

func (r *recordingDefinitionRepo) GetActiveByTriggerTopic(context.Context, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

func validCreateDefinitionRequest(name string) dto.CreateDefinitionRequest {
	return dto.CreateDefinitionRequest{
		Name:          name,
		Category:      model.CategoryCustom,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Variables:     map[string]model.VariableDef{},
		Steps: []model.StepDefinition{
			{ID: "start", Type: model.StepTypeHumanTask, Name: "Start", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

func TestDefinitionServiceCreateAssignsDefinitionKey(t *testing.T) {
	repo := &recordingDefinitionRepo{}
	svc := NewDefinitionService(repo, zerolog.Nop())

	def, err := svc.Create(context.Background(), "tenant-1", "user-1", validCreateDefinitionRequest("Untitled Workflow"))
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if def.DefinitionKey == "" {
		t.Fatal("Create() DefinitionKey is empty")
	}
	if len(repo.created) != 1 || repo.created[0].DefinitionKey != def.DefinitionKey {
		t.Fatalf("repo Create() captured DefinitionKey %q, want %q", repo.created[0].DefinitionKey, def.DefinitionKey)
	}
}

func TestDefinitionServiceUpdatePreservesDefinitionKeyAcrossNewVersion(t *testing.T) {
	const key = "dddddddd-0000-0000-0000-000000000004"
	repo := &recordingDefinitionRepo{
		byID: map[string]*model.WorkflowDefinition{
			"def-1": {
				ID:            "def-1",
				TenantID:      "tenant-1",
				Name:          "Original",
				Category:      model.CategoryCustom,
				Version:       1,
				Status:        model.DefinitionStatusDraft,
				DefinitionKey: key,
				TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
				Variables:     map[string]model.VariableDef{},
				Steps:         []model.StepDefinition{{ID: "end", Type: model.StepTypeEnd, Name: "End"}},
				CreatedBy:     "user-1",
			},
		},
		maxVersion: 1,
	}
	svc := NewDefinitionService(repo, zerolog.Nop())

	name := "Renamed"
	def, err := svc.Update(context.Background(), "tenant-1", "def-1", "user-2", dto.UpdateDefinitionRequest{Name: &name})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if repo.maxVersionKey != key {
		t.Fatalf("GetMaxVersion key = %q, want %q", repo.maxVersionKey, key)
	}
	if def.DefinitionKey != key {
		t.Fatalf("new version DefinitionKey = %q, want %q", def.DefinitionKey, key)
	}
	if def.Version != 2 {
		t.Fatalf("new version = %d, want 2", def.Version)
	}
}

func TestDefinitionServiceCloneStartsNewDefinitionKey(t *testing.T) {
	const sourceKey = "dddddddd-0000-0000-0000-000000000004"
	repo := &recordingDefinitionRepo{
		byID: map[string]*model.WorkflowDefinition{
			"def-1": {
				ID:            "def-1",
				TenantID:      "tenant-1",
				Name:          "Source",
				Category:      model.CategoryApproval,
				Version:       1,
				Status:        model.DefinitionStatusDraft,
				DefinitionKey: sourceKey,
				TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
				Variables:     map[string]model.VariableDef{},
				Steps:         []model.StepDefinition{{ID: "end", Type: model.StepTypeEnd, Name: "End"}},
				CreatedBy:     "user-1",
			},
		},
	}
	svc := NewDefinitionService(repo, zerolog.Nop())

	clone, err := svc.Clone(context.Background(), "tenant-1", "def-1", "user-2")
	if err != nil {
		t.Fatalf("Clone() error = %v", err)
	}
	if clone.DefinitionKey == "" {
		t.Fatal("Clone() DefinitionKey is empty")
	}
	if clone.DefinitionKey == sourceKey {
		t.Fatalf("Clone() reused source DefinitionKey %q", sourceKey)
	}
	if clone.Category != model.CategoryApproval {
		t.Fatalf("Clone() Category = %q, want %q", clone.Category, model.CategoryApproval)
	}
}

func TestTemplateServiceInstantiateAssignsDefinitionKey(t *testing.T) {
	repo := &recordingDefinitionRepo{}
	svc := NewTemplateService(repo, zerolog.Nop())

	def, err := svc.InstantiateTemplate(context.Background(), "tenant-1", "user-1", "tmpl-alert-remediation", "", "")
	if err != nil {
		t.Fatalf("InstantiateTemplate() error = %v", err)
	}
	if def.DefinitionKey == "" {
		t.Fatal("InstantiateTemplate() DefinitionKey is empty")
	}
	if len(repo.created) != 1 || repo.created[0].DefinitionKey != def.DefinitionKey {
		t.Fatalf("repo Create() captured DefinitionKey %q, want %q", repo.created[0].DefinitionKey, def.DefinitionKey)
	}
	if def.Category != "cybersecurity" {
		t.Fatalf("InstantiateTemplate() Category = %q, want cybersecurity", def.Category)
	}
}
