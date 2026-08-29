package respond

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestTemplateStepValidationRejectsCycles(t *testing.T) {
	templateID := uuid.New()
	steps := []IncidentTaskTemplateStep{
		{
			ID:           uuid.New(),
			TemplateID:   templateID,
			StepKey:      "a",
			Title:        "A",
			TaskType:     TaskTypeManual,
			Required:     true,
			Predecessors: []string{"b"},
		},
		{
			ID:           uuid.New(),
			TemplateID:   templateID,
			StepKey:      "b",
			Title:        "B",
			TaskType:     TaskTypeManual,
			Required:     true,
			Predecessors: []string{"a"},
		},
	}
	if err := validateTemplateSteps(steps); !errors.Is(err, ErrTaskDependencyCycle) {
		t.Fatalf("validateTemplateSteps error = %v, want ErrTaskDependencyCycle", err)
	}
}

func TestTemplateStepValidationRejectsUnknownPredecessors(t *testing.T) {
	steps := []IncidentTaskTemplateStep{
		{
			ID:           uuid.New(),
			TemplateID:   uuid.New(),
			StepKey:      "a",
			Title:        "A",
			TaskType:     TaskTypeManual,
			Required:     true,
			Predecessors: []string{"missing"},
		},
	}
	if err := validateTemplateSteps(steps); !errors.Is(err, ErrTaskDependencyUnknown) {
		t.Fatalf("validateTemplateSteps error = %v, want ErrTaskDependencyUnknown", err)
	}
}
