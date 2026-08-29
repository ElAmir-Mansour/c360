package respond

import (
	"errors"
	"sort"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/runbookstudio"
)

func incidentTaskPlan(incidentID uuid.UUID, tasks []IncidentTask) runbookstudio.Plan {
	studioTasks := make([]runbookstudio.Task, 0, len(tasks))
	for _, task := range tasks {
		studioTasks = append(studioTasks, task.toRunbookTask())
	}
	return runbookstudio.Plan{
		Runbook: runbookstudio.Runbook{ID: incidentID.String()},
		Tasks:   studioTasks,
	}
}

func validateIncidentTaskGraph(incidentID uuid.UUID, tasks []IncidentTask) error {
	if err := incidentTaskPlan(incidentID, tasks).Validate(); err != nil {
		return mapRunbookGraphError(err)
	}
	return nil
}

func mapRunbookGraphError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, runbookstudio.ErrCycle):
		return ErrTaskDependencyCycle
	case errors.Is(err, runbookstudio.ErrUnknownPredecessor):
		return ErrTaskDependencyUnknown
	default:
		return err
	}
}

func taskStatusMap(tasks []IncidentTask) map[string]string {
	statuses := make(map[string]string, len(tasks))
	for _, task := range tasks {
		statuses[task.ID.String()] = string(task.Status)
	}
	return statuses
}

func recomputeDerivedTaskStatuses(tasks []IncidentTask) map[uuid.UUID]IncidentTaskStatus {
	plan := incidentTaskPlan(uuid.Nil, tasks)
	state := runbookstudio.NewRunState(plan, taskStatusMap(tasks))
	frontier := stringSet(state.Frontier())
	blocked := stringSet(state.Blocked())

	out := make(map[uuid.UUID]IncidentTaskStatus, len(tasks))
	for _, task := range tasks {
		if taskStatusTerminal(task.Status) || task.Status == TaskStatusRunning {
			out[task.ID] = task.Status
			continue
		}
		switch {
		case blocked[task.ID.String()]:
			out[task.ID] = TaskStatusBlocked
		case frontier[task.ID.String()]:
			out[task.ID] = TaskStatusRunnable
		default:
			out[task.ID] = TaskStatusPending
		}
	}
	return out
}

func taskProgress(tasks []IncidentTask) IncidentTaskProgress {
	progress := IncidentTaskProgress{Total: len(tasks)}
	plan := incidentTaskPlan(uuid.Nil, tasks)
	state := runbookstudio.NewRunState(plan, taskStatusMap(tasks))
	progress.Frontier = uuidListFromStrings(state.Frontier())
	progress.BlockedTasks = uuidListFromStrings(state.Blocked())
	cp := plan.CriticalPath()
	progress.PlannedCriticalPathSeconds = cp.TotalSeconds

	for _, task := range tasks {
		if task.Required {
			progress.RequiredTotal++
		}
		switch task.Status {
		case TaskStatusPending:
			progress.Pending++
		case TaskStatusRunnable:
			progress.Runnable++
		case TaskStatusRunning:
			progress.Running++
		case TaskStatusComplete:
			progress.Complete++
			if task.Required {
				progress.RequiredComplete++
			}
		case TaskStatusSkipped:
			progress.Skipped++
		case TaskStatusFailed:
			progress.Failed++
		case TaskStatusBlocked:
			progress.Blocked++
		}
	}
	if progress.RequiredTotal > 0 {
		progress.RequiredCompletePercent = float64(progress.RequiredComplete) / float64(progress.RequiredTotal)
	}
	return progress
}

func stringSet(values []string) map[string]bool {
	out := make(map[string]bool, len(values))
	for _, value := range values {
		out[value] = true
	}
	return out
}

func uuidListFromStrings(values []string) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(values))
	for _, value := range values {
		id, err := uuid.Parse(value)
		if err != nil {
			continue
		}
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out
}

func uuidStrings(values []uuid.UUID) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == uuid.Nil {
			continue
		}
		out = append(out, value.String())
	}
	return out
}
