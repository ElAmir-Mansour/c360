package repository

import (
	"context"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// federatedTaskStore is the FULL human-task read+write surface the
// FederatedTaskReader wraps as its PRIMARY store. It mirrors the workflow task
// service's repository dependency exactly, so *FederatedTaskReader is a drop-in
// for service.NewTaskService's taskRepo argument. *TaskRepository satisfies it.
type federatedTaskStore interface {
	Create(ctx context.Context, task *model.HumanTask) error
	GetByID(ctx context.Context, tenantID, id string) (*model.HumanTask, error)
	ListForUser(ctx context.Context, tenantID, userID string, roles []string, statuses []string, sortBy, sortOrder string, limit, offset int) ([]*model.HumanTask, int, error)
	ListMyQueues(ctx context.Context, tenantID, userID string, roles []string, limit, offset int) ([]*model.HumanTask, int, error)
	ClaimTask(ctx context.Context, tenantID, taskID, userID string) error
	UnclaimTask(ctx context.Context, tenantID, taskID, userID string) error
	CompleteTask(ctx context.Context, tenantID, taskID string, formData map[string]interface{}, sensitive map[string]bool) error
	CompleteTaskWithLateJustification(ctx context.Context, tenantID, taskID string, formData map[string]interface{}, sensitive map[string]bool, justification, submittedBy, managerRole string, submittedAt time.Time) error
	DelegateTask(ctx context.Context, tenantID, taskID, fromUserID, toUserID, reason string) error
	RejectTask(ctx context.Context, tenantID, taskID, userID, reason string) error
	RejectTaskWithLateJustification(ctx context.Context, tenantID, taskID, userID, reason, justification, managerRole string, submittedAt time.Time) error
	CountByStatus(ctx context.Context, tenantID, userID string, roles []string) (map[string]int, error)
	ListByInstanceStep(ctx context.Context, tenantID, instanceID, stepID string) ([]*model.HumanTask, error)
	GetOverdueTasks(ctx context.Context, limit int) ([]*model.HumanTask, error)
	MarkSLABreached(ctx context.Context, taskID string) error
	EscalateTask(ctx context.Context, taskID, escalationRole string) error
	CancelByInstance(ctx context.Context, instanceID string) error
	CancelOpenByInstanceStep(ctx context.Context, instanceID, stepID string) error
	UpdateMetadata(ctx context.Context, tenantID, taskID string, metadata map[string]interface{}) error
	DailyCreatedCounts(ctx context.Context, tenantID string, days int) ([]int, error)
}

// taskFederatedReadSource is the READ-ONLY surface the FederatedTaskReader fans
// out over on each suite store. Only the user-visible task read paths are
// federated; every write/lifecycle method targets the primary. *TaskRepository
// satisfies it.
type taskFederatedReadSource interface {
	GetByID(ctx context.Context, tenantID, id string) (*model.HumanTask, error)
	ListForUser(ctx context.Context, tenantID, userID string, roles []string, statuses []string, sortBy, sortOrder string, limit, offset int) ([]*model.HumanTask, int, error)
	ListMyQueues(ctx context.Context, tenantID, userID string, roles []string, limit, offset int) ([]*model.HumanTask, int, error)
	CountByStatus(ctx context.Context, tenantID, userID string, roles []string) (map[string]int, error)
	ListByInstanceStep(ctx context.Context, tenantID, instanceID, stepID string) ([]*model.HumanTask, error)
}

// FederatedTaskReader wraps a PRIMARY task store plus zero or more READ-ONLY suite
// stores, merging the user-visible task READ paths so a human task a suite's
// embedded engine writes to its OWN database (e.g. a Lex settlement-approval task
// written to lex_db) is surfaced through the shared engine's task list — even
// though the engine's primary store is a different database. It is the task-side
// companion to FederatedInstanceReader (docs/workflow-instance-visibility.md):
// reads (ListForUser / ListMyQueues / CountByStatus / GetByID / ListByInstanceStep)
// are federated; EVERY write and lifecycle method (Create / Claim / Complete /
// Delegate / Reject / SLA / Cancel / …) targets the PRIMARY only, so a suite-owned
// task is view-only through this bridge — acting on it belongs to the owning suite.
// It never touches the engine's write/execution paths. With no federated sources
// added it behaves exactly like the primary store.
type FederatedTaskReader struct {
	primary   federatedTaskStore
	federated []taskFederatedReadSource
	logger    zerolog.Logger
}

// NewFederatedTaskReader builds a reader over the primary task store. Suite stores
// are attached with AddSource.
func NewFederatedTaskReader(primary federatedTaskStore, logger zerolog.Logger) *FederatedTaskReader {
	return &FederatedTaskReader{primary: primary, logger: logger}
}

// AddSource registers a read-only suite task store to federate reads over. Nil is a no-op.
func (r *FederatedTaskReader) AddSource(src taskFederatedReadSource) {
	if src != nil {
		r.federated = append(r.federated, src)
	}
}

// ListForUser merges the primary store with every federated suite store. It pulls
// the top (offset+limit) matching rows from each (each already tenant/user/role/
// status-filtered), globally sorts + slices for correct cross-store pagination,
// and SUMS per-store totals. A failing suite store degrades gracefully — logged
// and skipped, never breaking the primary view.
func (r *FederatedTaskReader) ListForUser(ctx context.Context, tenantID, userID string, roles []string, statuses []string, sortBy, sortOrder string, limit, offset int) ([]*model.HumanTask, int, error) {
	if len(r.federated) == 0 {
		return r.primary.ListForUser(ctx, tenantID, userID, roles, statuses, sortBy, sortOrder, limit, offset)
	}
	fetch := offset + limit
	merged, total, err := r.primary.ListForUser(ctx, tenantID, userID, roles, statuses, sortBy, sortOrder, fetch, 0)
	if err != nil {
		return nil, 0, err
	}
	for _, src := range r.federated {
		rows, cnt, ferr := src.ListForUser(ctx, tenantID, userID, roles, statuses, sortBy, sortOrder, fetch, 0)
		if ferr != nil {
			r.logger.Warn().Err(ferr).Msg("federated task list failed; skipping source")
			continue
		}
		merged = append(merged, rows...)
		total += cnt
	}
	mergeSortTasks(merged, sortBy, sortOrder)
	return pageTasks(merged, total, limit, offset)
}

// ListMyQueues merges the primary and federated stores' "my queue" listings. The
// per-store order is fixed (priority DESC, created_at ASC), so the merge re-sorts
// on the same key before paginating.
func (r *FederatedTaskReader) ListMyQueues(ctx context.Context, tenantID, userID string, roles []string, limit, offset int) ([]*model.HumanTask, int, error) {
	if len(r.federated) == 0 {
		return r.primary.ListMyQueues(ctx, tenantID, userID, roles, limit, offset)
	}
	fetch := offset + limit
	merged, total, err := r.primary.ListMyQueues(ctx, tenantID, userID, roles, fetch, 0)
	if err != nil {
		return nil, 0, err
	}
	for _, src := range r.federated {
		rows, cnt, ferr := src.ListMyQueues(ctx, tenantID, userID, roles, fetch, 0)
		if ferr != nil {
			r.logger.Warn().Err(ferr).Msg("federated task queue list failed; skipping source")
			continue
		}
		merged = append(merged, rows...)
		total += cnt
	}
	mergeSortTasks(merged, "", "") // fixed default order: priority DESC, created_at ASC
	return pageTasks(merged, total, limit, offset)
}

// CountByStatus sums the per-status task counts across the primary and every
// federated store, so the count cards reflect suite-owned tasks too. A failing
// suite store is logged and skipped.
func (r *FederatedTaskReader) CountByStatus(ctx context.Context, tenantID, userID string, roles []string) (map[string]int, error) {
	counts, err := r.primary.CountByStatus(ctx, tenantID, userID, roles)
	if err != nil {
		return nil, err
	}
	if len(r.federated) == 0 {
		return counts, nil
	}
	merged := make(map[string]int, len(counts))
	for k, v := range counts {
		merged[k] = v
	}
	for _, src := range r.federated {
		fc, ferr := src.CountByStatus(ctx, tenantID, userID, roles)
		if ferr != nil {
			r.logger.Warn().Err(ferr).Msg("federated task count failed; skipping source")
			continue
		}
		for k, v := range fc {
			merged[k] += v
		}
	}
	return merged, nil
}

// GetByID returns the task from the primary store, falling back to the federated
// suite stores when it is not present in the primary (task UUIDs are unique across
// stores, so probing each is safe).
func (r *FederatedTaskReader) GetByID(ctx context.Context, tenantID, id string) (*model.HumanTask, error) {
	task, err := r.primary.GetByID(ctx, tenantID, id)
	if err == nil {
		return task, nil
	}
	for _, src := range r.federated {
		if ft, ferr := src.GetByID(ctx, tenantID, id); ferr == nil && ft != nil {
			return ft, nil
		}
	}
	return nil, err
}

// ListByInstanceStep returns the tasks for an instance/step from whichever store
// owns the instance (an instance lives in exactly one store; UUIDs are unique
// across stores, so probing each is safe).
func (r *FederatedTaskReader) ListByInstanceStep(ctx context.Context, tenantID, instanceID, stepID string) ([]*model.HumanTask, error) {
	tasks, err := r.primary.ListByInstanceStep(ctx, tenantID, instanceID, stepID)
	if err == nil && len(tasks) > 0 {
		return tasks, nil
	}
	for _, src := range r.federated {
		if ft, ferr := src.ListByInstanceStep(ctx, tenantID, instanceID, stepID); ferr == nil && len(ft) > 0 {
			return ft, nil
		}
	}
	return tasks, err
}

// --- write / lifecycle methods: PRIMARY only ------------------------------- //
// A suite-owned task is view-only through this read-model bridge; acting on it is
// the owning suite's own path. These delegate unchanged to the primary store so
// the engine's write/execution behaviour is byte-for-byte identical to the raw
// *TaskRepository.

func (r *FederatedTaskReader) Create(ctx context.Context, task *model.HumanTask) error {
	return r.primary.Create(ctx, task)
}

func (r *FederatedTaskReader) ClaimTask(ctx context.Context, tenantID, taskID, userID string) error {
	return r.primary.ClaimTask(ctx, tenantID, taskID, userID)
}

func (r *FederatedTaskReader) UnclaimTask(ctx context.Context, tenantID, taskID, userID string) error {
	return r.primary.UnclaimTask(ctx, tenantID, taskID, userID)
}

func (r *FederatedTaskReader) CompleteTask(ctx context.Context, tenantID, taskID string, formData map[string]interface{}, sensitive map[string]bool) error {
	return r.primary.CompleteTask(ctx, tenantID, taskID, formData, sensitive)
}

func (r *FederatedTaskReader) CompleteTaskWithLateJustification(ctx context.Context, tenantID, taskID string, formData map[string]interface{}, sensitive map[string]bool, justification, submittedBy, managerRole string, submittedAt time.Time) error {
	return r.primary.CompleteTaskWithLateJustification(ctx, tenantID, taskID, formData, sensitive, justification, submittedBy, managerRole, submittedAt)
}

func (r *FederatedTaskReader) DelegateTask(ctx context.Context, tenantID, taskID, fromUserID, toUserID, reason string) error {
	return r.primary.DelegateTask(ctx, tenantID, taskID, fromUserID, toUserID, reason)
}

func (r *FederatedTaskReader) RejectTask(ctx context.Context, tenantID, taskID, userID, reason string) error {
	return r.primary.RejectTask(ctx, tenantID, taskID, userID, reason)
}

func (r *FederatedTaskReader) RejectTaskWithLateJustification(ctx context.Context, tenantID, taskID, userID, reason, justification, managerRole string, submittedAt time.Time) error {
	return r.primary.RejectTaskWithLateJustification(ctx, tenantID, taskID, userID, reason, justification, managerRole, submittedAt)
}

func (r *FederatedTaskReader) GetOverdueTasks(ctx context.Context, limit int) ([]*model.HumanTask, error) {
	return r.primary.GetOverdueTasks(ctx, limit)
}

func (r *FederatedTaskReader) MarkSLABreached(ctx context.Context, taskID string) error {
	return r.primary.MarkSLABreached(ctx, taskID)
}

func (r *FederatedTaskReader) EscalateTask(ctx context.Context, taskID, escalationRole string) error {
	return r.primary.EscalateTask(ctx, taskID, escalationRole)
}

func (r *FederatedTaskReader) CancelByInstance(ctx context.Context, instanceID string) error {
	return r.primary.CancelByInstance(ctx, instanceID)
}

func (r *FederatedTaskReader) CancelOpenByInstanceStep(ctx context.Context, instanceID, stepID string) error {
	return r.primary.CancelOpenByInstanceStep(ctx, instanceID, stepID)
}

func (r *FederatedTaskReader) UpdateMetadata(ctx context.Context, tenantID, taskID string, metadata map[string]interface{}) error {
	return r.primary.UpdateMetadata(ctx, tenantID, taskID, metadata)
}

func (r *FederatedTaskReader) DailyCreatedCounts(ctx context.Context, tenantID string, days int) ([]int, error) {
	return r.primary.DailyCreatedCounts(ctx, tenantID, days)
}

// --- merge helpers --------------------------------------------------------- //

// pageTasks applies the global offset/limit window to an already-merged+sorted
// task slice and returns it alongside the summed total.
func pageTasks(tasks []*model.HumanTask, total, limit, offset int) ([]*model.HumanTask, int, error) {
	if offset >= len(tasks) {
		return []*model.HumanTask{}, total, nil
	}
	end := offset + limit
	if end > len(tasks) {
		end = len(tasks)
	}
	return tasks[offset:end], total, nil
}

// taskSortComparators mirrors the TaskRepository ListForUser ORDER BY allowlist so
// a federated merge across stores preserves the ordering the endpoint returns.
var taskSortComparators = map[string]func(a, b *model.HumanTask) int{
	"priority":     func(a, b *model.HumanTask) int { return a.Priority - b.Priority },
	"created_at":   func(a, b *model.HumanTask) int { return a.CreatedAt.Compare(b.CreatedAt) },
	"updated_at":   func(a, b *model.HumanTask) int { return a.UpdatedAt.Compare(b.UpdatedAt) },
	"status":       func(a, b *model.HumanTask) int { return strings.Compare(a.Status, b.Status) },
	"sla_deadline": func(a, b *model.HumanTask) int { return compareTaskDeadline(a.SLADeadline, b.SLADeadline) },
}

// mergeSortTasks orders tasks in place to mirror TaskRepository's SQL ORDER BY: an
// allowlisted single column (priority | created_at | sla_deadline | updated_at |
// status) with the requested direction, or the repository default compound order
// (priority DESC, created_at ASC) for an unknown/empty sort key — the same
// fallback ListForUser/ListMyQueues apply.
func mergeSortTasks(tasks []*model.HumanTask, sortBy, sortOrder string) {
	cmp, ok := taskSortComparators[sortBy]
	if !ok {
		sort.SliceStable(tasks, func(i, j int) bool {
			a, b := tasks[i], tasks[j]
			if a.Priority != b.Priority {
				return a.Priority > b.Priority // priority DESC
			}
			if c := a.CreatedAt.Compare(b.CreatedAt); c != 0 {
				return c < 0 // created_at ASC
			}
			return a.ID < b.ID // stable, deterministic tiebreak
		})
		return
	}
	asc := sortOrder == "asc"
	sort.SliceStable(tasks, func(i, j int) bool {
		a, b := tasks[i], tasks[j]
		c := cmp(a, b)
		if c == 0 {
			c = strings.Compare(a.ID, b.ID) // stable, deterministic tiebreak
		}
		if asc {
			return c < 0
		}
		return c > 0
	})
}

// compareTaskDeadline orders nullable SLA deadlines with NULLs last (matching
// Postgres's default NULLS LAST for an ascending order).
func compareTaskDeadline(a, b *time.Time) int {
	switch {
	case a == nil && b == nil:
		return 0
	case a == nil:
		return 1
	case b == nil:
		return -1
	default:
		return a.Compare(*b)
	}
}
