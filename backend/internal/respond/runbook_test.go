package respond

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestIncidentTaskProgressUsesRunbookFrontierAndCriticalPath(t *testing.T) {
	tenantID := uuid.New()
	incidentID := uuid.New()
	now := time.Date(2026, 6, 28, 10, 0, 0, 0, time.UTC)
	a := IncidentTask{
		ID:                     uuid.New(),
		TenantID:               tenantID,
		IncidentID:             incidentID,
		TaskKey:                "a",
		Title:                  "A",
		TaskType:               TaskTypeManual,
		Status:                 TaskStatusRunnable,
		Required:               true,
		PlannedDurationSeconds: 30,
		CreatedAt:              now,
	}
	b := IncidentTask{
		ID:                     uuid.New(),
		TenantID:               tenantID,
		IncidentID:             incidentID,
		TaskKey:                "b",
		Title:                  "B",
		TaskType:               TaskTypeManual,
		Status:                 TaskStatusPending,
		Required:               true,
		PlannedDurationSeconds: 60,
		Dependencies:           []uuid.UUID{a.ID},
		CreatedAt:              now,
	}

	progress := taskProgress([]IncidentTask{a, b})
	if progress.PlannedCriticalPathSeconds != 90 {
		t.Fatalf("critical path = %d, want 90", progress.PlannedCriticalPathSeconds)
	}
	if len(progress.Frontier) != 1 || progress.Frontier[0] != a.ID {
		t.Fatalf("frontier = %v, want root task", progress.Frontier)
	}

	a.Status = TaskStatusFailed
	b.Status = TaskStatusPending
	derived := recomputeDerivedTaskStatuses([]IncidentTask{a, b})
	if derived[b.ID] != TaskStatusBlocked {
		t.Fatalf("derived b status = %s, want blocked after failed predecessor", derived[b.ID])
	}
}
