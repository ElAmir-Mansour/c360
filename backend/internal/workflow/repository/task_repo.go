package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// TimerRecord represents a row from the workflow_timers table.
type TimerRecord struct {
	ID         string
	InstanceID string
	StepID     string
	FireAt     time.Time
}

// taskSelectCols is the canonical column projection for a workflow_tasks row, in
// the exact order scanTask / scanTasks scan. Centralising it keeps every SELECT
// (GetByID / ListForUser / ListByInstanceStep / ListMyQueues / GetOverdueTasks)
// aligned with the scan order after the candidate_groups / candidate_users
// columns were added.
const taskSelectCols = `id, tenant_id, instance_id, step_id, step_exec_id,
	       name, description, status,
	       assignee_id, assignee_role,
	       candidate_groups, candidate_users,
	       claimed_by, claimed_at,
	       form_schema, form_data,
	       sla_deadline, sla_breached,
	       escalated_to, escalation_role,
	       delegated_by, delegated_at,
	       priority, metadata,
	       completed_at,
	       late_justification, late_justification_submitted_by,
	       late_justification_submitted_at, late_justification_manager_role,
	       created_at, updated_at`

// buildTaskVisibility builds the WHERE predicate (and its positional args,
// starting at startIdx) that decides which tasks a user may SEE. It is the ONE
// place the visibility rule lives so ListForUser and CountByStatus stay in lock
// step. Visibility = directly assigned/escalated to the user OR claimed by the
// user OR claimable via one of the user's assignee/escalation roles OR OFFERED
// FROM A SHARED WORK QUEUE: an unclaimed pending task whose candidate_users
// includes the user or whose candidate_groups overlaps the user's roles. A
// claimed group task is therefore only visible to assignee_id/claimed_by, never
// to other candidates.
// Returns the assembled "(... AND (...))" predicate, the args, and the next free
// positional index.
func buildTaskVisibility(tenantID, userID string, roles []string, startIdx int) (string, []any, int) {
	return buildTaskVisibilityFor("", tenantID, userID, roles, startIdx)
}

// buildTaskVisibilityFor is buildTaskVisibility with an optional table alias, so
// the SAME rule can be embedded in a correlated subquery over workflow_tasks
// (see InstanceRepository.ListForViewer, which scopes the instance list to the
// instances a viewer has a visible task on). An empty alias emits the exact
// unqualified predicate the task queries have always used. Keeping this one
// builder is the point: instance visibility must not drift from task
// visibility, or a user would see an instance whose tasks are all invisible to
// them (or the reverse).
func buildTaskVisibilityFor(alias, tenantID, userID string, roles []string, startIdx int) (string, []any, int) {
	var args []any
	argIdx := startIdx

	col := func(name string) string {
		if alias == "" {
			return name
		}
		return alias + "." + name
	}

	tenantIdx := argIdx
	args = append(args, tenantID)
	argIdx++

	userIdx := argIdx
	args = append(args, userID)
	argIdx++

	// Directly assigned to, or already claimed by, this user (owner view — holds
	// for any status, so a user always sees the tasks they own).
	visibilityParts := []string{
		fmt.Sprintf("%s = $%d", col("assignee_id"), userIdx),
		fmt.Sprintf("%s = $%d", col("claimed_by"), userIdx),
		fmt.Sprintf("%s = $%d", col("escalated_to"), userIdx),
	}

	if len(roles) > 0 {
		placeholders := make([]string, len(roles))
		for i, role := range roles {
			placeholders[i] = fmt.Sprintf("$%d", argIdx)
			args = append(args, role)
			argIdx++
		}
		roleList := strings.Join(placeholders, ", ")
		// Legacy single-role claimable pool (unchanged).
		visibilityParts = append(visibilityParts,
			fmt.Sprintf("(%s IN (%s) AND %s = 'pending')", col("assignee_role"), roleList, col("status")),
			fmt.Sprintf("(%s IN (%s) AND %s = 'escalated')", col("escalation_role"), roleList, col("status")),
		)
		// Candidate-GROUP work queue: an UNCLAIMED pending task whose
		// candidate_groups overlaps one of the user's roles. The && array-overlap
		// operator is backed by idx_workflow_tasks_candidate_groups.
		visibilityParts = append(visibilityParts,
			fmt.Sprintf("(%s && ARRAY[%s]::text[] AND %s = 'pending' AND %s IS NULL)",
				col("candidate_groups"), roleList, col("status"), col("claimed_by")),
		)
	}

	// Candidate-USER work queue: an UNCLAIMED pending task that names this user as
	// a candidate. Reuses the same $userIdx placeholder; cast to uuid so the
	// comparison against the uuid[] element type resolves.
	visibilityParts = append(visibilityParts,
		fmt.Sprintf("($%d::uuid = ANY(%s) AND %s = 'pending' AND %s IS NULL)",
			userIdx, col("candidate_users"), col("status"), col("claimed_by")),
	)

	where := fmt.Sprintf("%s = $%d AND (%s)", col("tenant_id"), tenantIdx, strings.Join(visibilityParts, " OR "))
	return where, args, argIdx
}

// taskDBTX is the pool capability the TaskRepository needs: open RLS-scoped
// transactions (Begin) plus the direct pool-level Exec/Query/QueryRow the
// timer/scan helpers use. Both the production *pgxpool.Pool and the unit-test
// pgxmock pool satisfy it, so the candidate-group visibility, claim-from-pool,
// and unclaim paths can be exercised against a mock while production wires the
// real pool. NewTaskRepository's signature is unchanged (it still takes a
// *pgxpool.Pool), so every existing caller and the engine wiring compile
// unchanged; only the internal field type widened to the seam.
type taskDBTX interface {
	txBeginner
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// TaskRepository handles all database operations for human tasks, SLA
// management, and workflow timers.
type TaskRepository struct {
	pool taskDBTX

	// payloadCodec is the OPTIONAL at-rest encryption seam (nil == legacy
	// plaintext) for the form_data JSONB, satisfied by the SAME PayloadCodec
	// interface the InstanceRepository uses (see instance_repo.go). Set via
	// WithPayloadCodec at wiring time. When nil, every form_data read/write is a
	// plain json.Marshal / json.Unmarshal — byte-for-byte identical to the
	// pre-encryption behavior — so existing rows and test doubles are unaffected.
	payloadCodec PayloadCodec
}

// TaskMetadataMatch is one exact workflow-task metadata predicate. A filtered
// list requires every supplied key/value pair to match. Both key and value are
// bound as SQL parameters (never interpolated), so callers can safely narrow a
// task inbox without weakening the repository's tenant/user visibility rules.
type TaskMetadataMatch struct {
	Key   string
	Value string
}

// NewTaskRepository creates a new TaskRepository backed by the provided
// connection pool. No payload codec is wired by default, so form_data is stored
// in plaintext exactly as before; call WithPayloadCodec to enable field-level
// encryption at rest for a task's classified form fields.
func NewTaskRepository(pool *pgxpool.Pool) *TaskRepository {
	return &TaskRepository{pool: pool}
}

// WithPayloadCodec wires an OPTIONAL payload-encryption codec and returns the
// repository for chaining. When set, the values of a task's CLASSIFIED form
// fields (derived from the task's FormSchema sensitivity tags) are encrypted at
// rest in the form_data JSONB and transparently decrypted on read. A nil codec
// (or never calling this) preserves the legacy plaintext behavior. It is a
// wiring-time setter (not concurrent-safe with live reads/writes).
func (r *TaskRepository) WithPayloadCodec(codec PayloadCodec) *TaskRepository {
	r.payloadCodec = codec
	return r
}

// newTaskRepositoryWithDB is the unit-test seam: it injects a pgxmock pool (or
// any taskDBTX) directly, mirroring newActivityExecutionRepositoryWithDB. It is
// intentionally unexported — production always goes through NewTaskRepository.
func newTaskRepositoryWithDB(db taskDBTX) *TaskRepository {
	return &TaskRepository{pool: db}
}

// marshalFormData JSON-encodes a task's submitted form_data for persistence,
// encrypting the values of its CLASSIFIED fields first when a codec is wired.
// sensitive is the set of classified field names (from the task's FormSchema).
// When no codec is wired (or no fields are classified) this is exactly
// json.Marshal of the plaintext map. Fails closed: an encryption error aborts the
// write (never persists plaintext when encryption was requested). A nil formData
// is marshaled by json.Marshal exactly as the legacy path did (to the JSON
// literal null), so the completion path's at-rest bytes are unchanged.
func (r *TaskRepository) marshalFormData(formData map[string]interface{}, sensitive map[string]bool) ([]byte, error) {
	toStore := formData
	if r.payloadCodec != nil && len(sensitive) > 0 {
		enc, err := r.payloadCodec.EncryptMap(sensitive, formData)
		if err != nil {
			return nil, fmt.Errorf("encrypting task form_data: %w", err)
		}
		toStore = enc
	}
	b, err := json.Marshal(toStore)
	if err != nil {
		return nil, fmt.Errorf("marshaling form_data: %w", err)
	}
	return b, nil
}

// decryptTaskFormData transparently decrypts any "enc:v1:" envelope values in a
// freshly-scanned task's FormData. No-op when no codec is wired / no envelopes
// present. The envelope is self-describing, so no classification set is needed
// and legacy plaintext rows round-trip unchanged. Fails closed on a corrupt
// envelope so ciphertext can never surface as plaintext.
func (r *TaskRepository) decryptTaskFormData(task *model.HumanTask) error {
	if r.payloadCodec == nil || task == nil || task.FormData == nil {
		return nil
	}
	dec, err := r.payloadCodec.DecryptMap(task.FormData)
	if err != nil {
		return fmt.Errorf("decrypting task form_data: %w", err)
	}
	task.FormData = dec
	return nil
}

// Create inserts a new human task. JSONB fields (form_schema, form_data,
// metadata) are marshaled before insertion. The generated ID and timestamps
// are scanned back into the struct.
func (r *TaskRepository) Create(ctx context.Context, task *model.HumanTask) error {
	formSchemaJSON, err := json.Marshal(task.FormSchema)
	if err != nil {
		return fmt.Errorf("marshaling form_schema: %w", err)
	}

	// Encrypt the values of any CLASSIFIED form fields (derived from the task's
	// own FormSchema sensitivity tags) at rest when a codec is wired; otherwise a
	// plain json.Marshal (legacy plaintext). form_data is keyed by field name, so
	// the classified field names ARE the top-level keys to envelope. Preserve the
	// legacy nil-guard: a task created with no form_data stores SQL NULL, not the
	// JSON literal null.
	var formDataJSON []byte
	if task.FormData != nil {
		formDataJSON, err = r.marshalFormData(task.FormData, model.SensitiveFormFieldKeys(task.FormSchema))
		if err != nil {
			return err
		}
	}

	metadataJSON, err := json.Marshal(task.Metadata)
	if err != nil {
		return fmt.Errorf("marshaling task metadata: %w", err)
	}

	query := `
		INSERT INTO workflow_tasks (
			tenant_id, instance_id, step_id, step_exec_id,
			name, description, status,
			assignee_id, assignee_role,
			candidate_groups, candidate_users,
			form_schema, form_data,
			sla_deadline, priority, metadata,
			delegated_by, delegated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11::uuid[], $12, $13, $14, $15, $16, $17, $18)
		RETURNING id, created_at, updated_at`

	tx, err := beginScoped(ctx, r.pool, task.TenantID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := tx.QueryRow(ctx, query,
		task.TenantID,
		task.InstanceID,
		task.StepID,
		task.StepExecID,
		task.Name,
		task.Description,
		task.Status,
		task.AssigneeID,
		task.AssigneeRole,
		nonNilStrings(task.CandidateGroups),
		nonNilStrings(task.CandidateUsers),
		formSchemaJSON,
		formDataJSON,
		task.SLADeadline,
		task.Priority,
		metadataJSON,
		task.DelegatedBy,
		task.DelegatedAt,
	).Scan(&task.ID, &task.CreatedAt, &task.UpdatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// nonNilStrings returns a non-nil empty slice for a nil input so the TEXT[]/
// UUID[] columns receive '{}' (their NOT NULL DEFAULT) rather than SQL NULL,
// keeping every task's candidate arrays well-formed and the legacy no-candidate
// task an empty pool.
func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// GetByID retrieves a task by ID and tenant. Returns model.ErrNotFound when
// the row does not exist.
func (r *TaskRepository) GetByID(ctx context.Context, tenantID, id string) (*model.HumanTask, error) {
	query := `
		SELECT ` + taskSelectCols + `
		FROM workflow_tasks
		WHERE id = $1 AND tenant_id = $2`

	sctx := WithTenantScope(ctx, tenantID)
	return r.scanTask(newScopedPool(r.pool).QueryRow(sctx, query, id, tenantID))
}

// ListByInstanceStep returns all human tasks created for a workflow instance
// step. Approval-chain resume uses this to evaluate parallel/quorum decisions
// from sibling approver tasks.
func (r *TaskRepository) ListByInstanceStep(ctx context.Context, tenantID, instanceID, stepID string) ([]*model.HumanTask, error) {
	query := `
		SELECT ` + taskSelectCols + `
		FROM workflow_tasks
		WHERE tenant_id = $1 AND instance_id = $2 AND step_id = $3
		ORDER BY created_at ASC`

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := newScopedPool(r.pool).Query(sctx, query, tenantID, instanceID, stepID)
	if err != nil {
		return nil, fmt.Errorf("listing tasks by instance step: %w", err)
	}
	defer rows.Close()

	return r.scanTasks(rows)
}

// ListForUser returns tasks that are visible to a user: either directly
// assigned (assignee_id = userID), claimed by the user, claimable by the user's
// roles (assignee_role IN roles AND status = 'pending'), OR offered to the user
// from a shared work queue — an UNCLAIMED pending task whose candidate_users
// includes the user OR whose candidate_groups overlaps the user's roles (the
// "group inbox"). Once a group task is claimed it drops out of every other
// candidate's list and is visible only to its owner (assignee_id/claimed_by),
// exactly like a claimed single-role task. An optional status filter can further
// restrict results. Returns the matching tasks and the total count.
func (r *TaskRepository) ListForUser(ctx context.Context, tenantID, userID string, roles []string, statuses []string, sortBy, sortOrder string, limit, offset int) ([]*model.HumanTask, int, error) {
	return r.listForUser(ctx, tenantID, userID, roles, statuses, nil, sortBy, sortOrder, limit, offset)
}

// ListForUserMatchingMetadata is ListForUser with an additional AND-ed set
// of exact JSONB metadata predicates. The metadata filter is applied in SQL
// before COUNT/LIMIT/OFFSET, so pagination and totals describe the requested
// task family rather than an in-memory subset of a mixed workflow page.
func (r *TaskRepository) ListForUserMatchingMetadata(
	ctx context.Context,
	tenantID, userID string,
	roles, statuses []string,
	matches []TaskMetadataMatch,
	sortBy, sortOrder string,
	limit, offset int,
) ([]*model.HumanTask, int, error) {
	return r.listForUser(ctx, tenantID, userID, roles, statuses, matches, sortBy, sortOrder, limit, offset)
}

func (r *TaskRepository) listForUser(
	ctx context.Context,
	tenantID, userID string,
	roles, statuses []string,
	metadataMatches []TaskMetadataMatch,
	sortBy, sortOrder string,
	limit, offset int,
) ([]*model.HumanTask, int, error) {
	where, args, argIdx := buildTaskVisibility(tenantID, userID, roles, 1)

	if len(statuses) > 0 {
		where = fmt.Sprintf("%s AND status = ANY($%d)", where, argIdx)
		args = append(args, statuses)
		argIdx++
	}

	if len(metadataMatches) > 0 {
		metadataParts := make([]string, 0, len(metadataMatches))
		for _, match := range metadataMatches {
			metadataParts = append(metadataParts, fmt.Sprintf("metadata ->> $%d = $%d", argIdx, argIdx+1))
			args = append(args, match.Key, match.Value)
			argIdx += 2
		}
		where = fmt.Sprintf("%s AND (%s)", where, strings.Join(metadataParts, " AND "))
	}

	// Build ORDER BY clause from allowlisted columns.
	taskSortAllowlist := map[string]string{
		"priority":     "priority",
		"created_at":   "created_at",
		"sla_deadline": "sla_deadline",
		"updated_at":   "updated_at",
		"status":       "status",
	}
	var orderBy string
	if col, ok := taskSortAllowlist[sortBy]; ok {
		dir := "ASC"
		if sortOrder == "desc" {
			dir = "DESC"
		}
		orderBy = col + " " + dir
	} else {
		orderBy = "priority DESC, created_at ASC"
	}

	// Count + page under ONE tenant-scoped transaction so RLS filters both.
	tx, err := beginScoped(ctx, r.pool, tenantID)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM workflow_tasks WHERE %s", where)
	var total int
	if err := tx.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting tasks for user: %w", err)
	}

	if total == 0 {
		return []*model.HumanTask{}, 0, nil
	}

	// Paginated data.
	dataQuery := fmt.Sprintf(`
		SELECT `+taskSelectCols+`
		FROM workflow_tasks
		WHERE %s
		ORDER BY %s
		LIMIT $%d OFFSET $%d`, where, orderBy, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := tx.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing tasks for user: %w", err)
	}
	tasks, err := r.scanTasks(rows)
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, fmt.Errorf("committing task list: %w", err)
	}

	return tasks, total, nil
}

// ClaimTask atomically claims a pending task using SELECT FOR UPDATE SKIP
// LOCKED inside a transaction. If the task is not in 'pending' status or has
// already been locked by another concurrent claim, a conflict error is returned.
//
// This is the SAME exactly-one-winner path for a legacy single-role task AND a
// candidate-group / work-queue (pool) task: the row lock + status='pending'
// guard guarantee that when N candidates race to pull the same group task, only
// ONE wins the SKIP LOCKED lock and flips it to claimed; the others get zero rows
// (ErrTaskNotClaimable). On claim the winner becomes the durable OWNER
// (assignee_id + claimed_by), so the task immediately drops out of every other
// candidate's group inbox (their pool predicate requires claimed_by IS NULL).
// Eligibility (is this user a candidate?) is authorised by the service layer
// before this call; the repository enforces the atomic single-winner guarantee.
func (r *TaskRepository) ClaimTask(ctx context.Context, tenantID, taskID, userID string) error {
	tx, err := beginScoped(ctx, r.pool, tenantID)
	if err != nil {
		return fmt.Errorf("beginning claim transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Attempt to lock the row. SKIP LOCKED means if another transaction holds
	// the lock we get zero rows instead of blocking.
	var lockedID string
	err = tx.QueryRow(ctx,
		`SELECT id FROM workflow_tasks
		 WHERE id = $1 AND tenant_id = $2 AND status = 'pending'
		 FOR UPDATE SKIP LOCKED`,
		taskID, tenantID,
	).Scan(&lockedID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return fmt.Errorf("task %s: %w", taskID, model.ErrTaskNotClaimable)
		}
		return fmt.Errorf("locking task for claim: %w", err)
	}

	_, err = tx.Exec(ctx,
		`UPDATE workflow_tasks
		 SET status = 'claimed', claimed_by = $2, assignee_id = $2, claimed_at = now(), updated_at = now()
		 WHERE id = $1`,
		taskID, userID,
	)
	if err != nil {
		return fmt.Errorf("updating task claim: %w", err)
	}

	return tx.Commit(ctx)
}

// UnclaimTask returns a task the user has claimed BACK TO ITS POOL: it clears the
// owner (claimed_by/assignee_id/claimed_at) and flips the status to 'pending', so
// the task re-appears in the group inbox of every candidate. It is the inverse of
// claim-from-pool and only applies to a POOL task (candidate_groups or
// candidate_users non-empty) that the requesting user currently owns — a legacy
// single-assignee task with no candidates cannot be unclaimed back to a pool that
// does not exist (RowsAffected 0 -> ErrTaskNotOwned). Only the current claimant
// may unclaim (claimed_by = $3 guard).
func (r *TaskRepository) UnclaimTask(ctx context.Context, tenantID, taskID, userID string) error {
	query := `
		UPDATE workflow_tasks
		SET status = 'pending',
		    claimed_by = NULL,
		    assignee_id = NULL,
		    claimed_at = NULL,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2
		  AND status = 'claimed'
		  AND claimed_by = $3
		  AND (cardinality(candidate_groups) > 0 OR cardinality(candidate_users) > 0)`

	ct, err := rlsExec(ctx, r.pool, tenantID, query, taskID, tenantID, userID)
	if err != nil {
		return fmt.Errorf("unclaiming task: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("task %s: %w", taskID, model.ErrTaskNotOwned)
	}
	return nil
}

// CompleteTask marks a claimed task as completed and stores the submitted form
// data. Only tasks in 'claimed' status can be completed. sensitive is the set of
// CLASSIFIED form-field names (derived by the caller from the task's FormSchema
// via model.SensitiveFormFieldKeys); when a payload codec is wired those field
// values are encrypted at rest in the form_data JSONB, otherwise the write is a
// plain json.Marshal (legacy plaintext). Passing a nil/empty set, or wiring no
// codec, is the exact pre-encryption behavior.
func (r *TaskRepository) CompleteTask(ctx context.Context, tenantID, taskID string, formData map[string]interface{}, sensitive map[string]bool) error {
	return r.CompleteTaskWithLateJustification(ctx, tenantID, taskID, formData, sensitive, "", "", "", time.Time{})
}

// CompleteTaskWithLateJustification atomically records the private SLA-breach
// explanation with the terminal task transition. Empty justification preserves
// the legacy on-time path and clears no existing data.
func (r *TaskRepository) CompleteTaskWithLateJustification(ctx context.Context, tenantID, taskID string, formData map[string]interface{}, sensitive map[string]bool, justification, submittedBy, managerRole string, submittedAt time.Time) error {
	formDataJSON, err := r.marshalFormData(formData, sensitive)
	if err != nil {
		return err
	}

	query := `
		UPDATE workflow_tasks
		SET status = 'completed',
		    form_data = $3,
		    completed_at = CASE WHEN $7::timestamptz IS NULL THEN now() ELSE $7 END,
		    late_justification = CASE WHEN $4::text = '' THEN NULL ELSE $4 END,
		    late_justification_submitted_by = CASE WHEN $4::text = '' THEN NULL ELSE $5::uuid END,
		    late_justification_manager_role = CASE WHEN $4::text = '' THEN NULL ELSE $6 END,
		    late_justification_submitted_at = $7,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND status = 'claimed'`

	var submittedAtArg any
	if !submittedAt.IsZero() {
		submittedAtArg = submittedAt
	}
	ct, err := rlsExec(ctx, r.pool, tenantID, query, taskID, tenantID, formDataJSON, justification, submittedBy, managerRole, submittedAtArg)
	if err != nil {
		return fmt.Errorf("completing task: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("task %s: %w", taskID, model.ErrNotFound)
	}
	return nil
}

// DelegateTask transfers a pending or claimed task from one user to another.
// The delegating user becomes delegated_by, and the task goes to 'pending' with
// the new assignee. An optional reason is stored in the metadata JSONB.
func (r *TaskRepository) DelegateTask(ctx context.Context, tenantID, taskID, fromUserID, toUserID, reason string) error {
	query := `
		UPDATE workflow_tasks
		SET assignee_id = $3,
		    status = 'pending',
		    claimed_by = NULL,
		    claimed_at = NULL,
		    delegated_by = $4,
		    delegated_at = now(),
		    metadata = CASE WHEN $5::text = '' THEN metadata
		                    ELSE metadata || jsonb_build_object('delegation_reason', $5::text)
		               END,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2
		  AND (
		    (status = 'claimed' AND claimed_by = $4)
		    OR status = 'pending'
		  )`

	ct, err := rlsExec(ctx, r.pool, tenantID, query, taskID, tenantID, toUserID, fromUserID, reason)
	if err != nil {
		return fmt.Errorf("delegating task: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("task %s: %w", taskID, model.ErrTaskNotOwned)
	}
	return nil
}

// RejectTask rejects a claimed task, returning it to 'pending' status and
// clearing the claim fields. The reason is stored in the metadata for audit
// purposes.
func (r *TaskRepository) RejectTask(ctx context.Context, tenantID, taskID, userID, reason string) error {
	return r.RejectTaskWithLateJustification(ctx, tenantID, taskID, userID, reason, "", "", time.Time{})
}

// RejectTaskWithLateJustification records the private explanation when rejection
// is the terminal action taken after the task SLA deadline.
func (r *TaskRepository) RejectTaskWithLateJustification(ctx context.Context, tenantID, taskID, userID, reason, justification, managerRole string, submittedAt time.Time) error {
	query := `
		UPDATE workflow_tasks
		SET status = 'rejected',
		    metadata = metadata || jsonb_build_object('rejection_reason', $4::text, 'rejected_by', $3::text),
		    late_justification = CASE WHEN $5::text = '' THEN NULL ELSE $5 END,
		    late_justification_submitted_by = CASE WHEN $5::text = '' THEN NULL ELSE $3::uuid END,
		    late_justification_manager_role = CASE WHEN $5::text = '' THEN NULL ELSE $6 END,
		    late_justification_submitted_at = $7,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND status = 'claimed' AND claimed_by = $3`

	var submittedAtArg any
	if !submittedAt.IsZero() {
		submittedAtArg = submittedAt
	}
	ct, err := rlsExec(ctx, r.pool, tenantID, query, taskID, tenantID, userID, reason, justification, managerRole, submittedAtArg)
	if err != nil {
		return fmt.Errorf("rejecting task: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("task %s: %w", taskID, model.ErrTaskNotOwned)
	}
	return nil
}

// CountByStatus returns task counts grouped by status for tasks visible to the
// given user (by direct assignment, role-based claimability, OR shared work
// queue candidacy). It reuses the exact ListForUser visibility predicate so the
// dashboard counts match the inbox contents.
func (r *TaskRepository) CountByStatus(ctx context.Context, tenantID, userID string, roles []string) (map[string]int, error) {
	where, args, _ := buildTaskVisibility(tenantID, userID, roles, 1)

	query := fmt.Sprintf(`
		SELECT status, COUNT(*) FROM workflow_tasks
		WHERE %s
		GROUP BY status`, where)

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := newScopedPool(r.pool).Query(sctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("counting tasks by status: %w", err)
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, fmt.Errorf("scanning task count row: %w", err)
		}
		counts[status] = count
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating task count rows: %w", err)
	}

	return counts, nil
}

// ListMyQueues returns the UNCLAIMED pending POOL tasks the user is eligible to
// claim from a shared work queue — i.e. tasks whose candidate_users names the
// user OR whose candidate_groups overlaps the user's roles. Unlike ListForUser
// (which also returns the user's owned/claimed/single-role work), this is the
// pure "group inbox" view: only pullable pool work, never the caller's already-
// owned tasks. It deliberately excludes tasks already assigned to a specific
// user (assignee_id IS NULL) so a directly-assigned task never leaks into a
// queue. Ordered highest priority / oldest first (FIFO within a priority) so the
// queue drains fairly.
func (r *TaskRepository) ListMyQueues(ctx context.Context, tenantID, userID string, roles []string, limit, offset int) ([]*model.HumanTask, int, error) {
	if limit <= 0 {
		limit = 50
	}

	var poolParts []string
	var args []any
	argIdx := 1

	tenantIdx := argIdx
	args = append(args, tenantID)
	argIdx++

	userIdx := argIdx
	args = append(args, userID)
	argIdx++

	// Candidate-USER pool (cast to uuid to match the uuid[] element type).
	poolParts = append(poolParts, fmt.Sprintf("$%d::uuid = ANY(candidate_users)", userIdx))

	// Candidate-GROUP pool (only when the user carries roles/groups).
	if len(roles) > 0 {
		placeholders := make([]string, len(roles))
		for i, role := range roles {
			placeholders[i] = fmt.Sprintf("$%d", argIdx)
			args = append(args, role)
			argIdx++
		}
		poolParts = append(poolParts,
			fmt.Sprintf("candidate_groups && ARRAY[%s]::text[]", strings.Join(placeholders, ", ")),
		)
	}

	// A pool task offered to this user: pending, unclaimed, NOT already assigned
	// to a specific user, and matching one of the candidate predicates.
	where := fmt.Sprintf(`tenant_id = $%d
		  AND status = 'pending'
		  AND claimed_by IS NULL
		  AND assignee_id IS NULL
		  AND (%s)`, tenantIdx, strings.Join(poolParts, " OR "))

	tx, err := beginScoped(ctx, r.pool, tenantID)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var total int
	if err := tx.QueryRow(ctx,
		fmt.Sprintf("SELECT COUNT(*) FROM workflow_tasks WHERE %s", where),
		args...,
	).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting queue tasks: %w", err)
	}
	if total == 0 {
		return []*model.HumanTask{}, 0, nil
	}

	dataQuery := fmt.Sprintf(`
		SELECT `+taskSelectCols+`
		FROM workflow_tasks
		WHERE %s
		ORDER BY priority DESC, created_at ASC
		LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := tx.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing queue tasks: %w", err)
	}
	tasks, err := r.scanTasks(rows)
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, fmt.Errorf("committing queue list: %w", err)
	}
	return tasks, total, nil
}

// DailyCreatedCounts returns tenant-wide task creation volume for analytics.
// It is intentionally NOT returned by the user-scoped task-count endpoint: a
// creation-volume series is not a historical comparison for a pending backlog.
func (r *TaskRepository) DailyCreatedCounts(ctx context.Context, tenantID string, days int) ([]int, error) {
	if days <= 0 {
		days = 12
	}
	sctx := WithTenantScope(ctx, tenantID)
	rows, err := newScopedPool(r.pool).Query(sctx, `
		WITH days AS (
			SELECT generate_series(
				DATE_TRUNC('day', NOW()) - ($2::int - 1) * INTERVAL '1 day',
				DATE_TRUNC('day', NOW()),
				INTERVAL '1 day'
			) AS day
		)
		SELECT COALESCE(a.cnt, 0)::int
		FROM days d
		LEFT JOIN (
			SELECT DATE_TRUNC('day', created_at) AS day, COUNT(*) AS cnt
			FROM workflow_tasks
			WHERE tenant_id = $1
			  AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
			GROUP BY DATE_TRUNC('day', created_at)
		) a ON a.day = d.day
		ORDER BY d.day ASC`,
		tenantID, days,
	)
	if err != nil {
		return nil, fmt.Errorf("query daily task counts: %w", err)
	}
	defer rows.Close()

	counts := make([]int, 0, days)
	for rows.Next() {
		var c int
		if err := rows.Scan(&c); err != nil {
			return nil, fmt.Errorf("scan daily task count: %w", err)
		}
		counts = append(counts, c)
	}
	return counts, rows.Err()
}

// GetOverdueTasks returns tasks that have passed their SLA deadline but have
// not yet been marked as breached. Only pending and claimed tasks are
// considered.
func (r *TaskRepository) GetOverdueTasks(ctx context.Context, limit int) ([]*model.HumanTask, error) {
	query := `
		SELECT ` + taskSelectCols + `
		FROM workflow_tasks
		WHERE sla_deadline IS NOT NULL
		  AND sla_deadline < now()
		  AND sla_breached = false
		  AND status IN ('pending', 'claimed')
		ORDER BY sla_deadline ASC
		LIMIT $1`

	// The SLA monitor scans overdue tasks ACROSS ALL TENANTS, so this runs under
	// the cross-tenant bypass scope (SET LOCAL app.bypass_rls = 'on').
	sctx := WithSystemScope(ctx)
	rows, err := newScopedPool(r.pool).Query(sctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("getting overdue tasks: %w", err)
	}
	defer rows.Close()

	return r.scanTasks(rows)
}

// MarkSLABreached sets sla_breached = true for a task.
func (r *TaskRepository) MarkSLABreached(ctx context.Context, taskID string) error {
	query := `
		UPDATE workflow_tasks
		SET sla_breached = true, updated_at = now()
		WHERE id = $1`

	// Called by the cross-tenant SLA monitor with only a task id (no tenant);
	// runs under the bypass scope.
	ct, err := rlsExec(ctx, r.pool, "", query, taskID)
	if err != nil {
		return fmt.Errorf("marking SLA breached: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("task %s: %w", taskID, model.ErrNotFound)
	}
	return nil
}

// EscalateTask updates a task with escalation information, setting the
// escalation_role and changing status to 'escalated'.
func (r *TaskRepository) EscalateTask(ctx context.Context, taskID, escalationRole string) error {
	query := `
		UPDATE workflow_tasks
		SET status = 'escalated',
		    escalation_role = $2,
		    updated_at = now()
		WHERE id = $1 AND status IN ('pending', 'claimed')`

	// Called by the cross-tenant SLA monitor with only a task id; bypass scope.
	ct, err := rlsExec(ctx, r.pool, "", query, taskID, escalationRole)
	if err != nil {
		return fmt.Errorf("escalating task: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("task %s: %w", taskID, model.ErrNotFound)
	}
	return nil
}

// UpdateMetadata replaces the metadata JSONB column for a task. Used to persist
// comment additions and other metadata changes.
func (r *TaskRepository) UpdateMetadata(ctx context.Context, tenantID, taskID string, metadata map[string]interface{}) error {
	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshaling task metadata: %w", err)
	}

	query := `
		UPDATE workflow_tasks
		SET metadata = $3, updated_at = now()
		WHERE id = $1 AND tenant_id = $2`

	ct, err := rlsExec(ctx, r.pool, tenantID, query, taskID, tenantID, metadataJSON)
	if err != nil {
		return fmt.Errorf("updating task metadata: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("task %s: %w", taskID, model.ErrNotFound)
	}
	return nil
}

// CancelByInstance cancels all non-terminal tasks (pending and claimed) for a
// given workflow instance. This is called when a workflow is cancelled or
// fails.
func (r *TaskRepository) CancelByInstance(ctx context.Context, instanceID string) error {
	query := `
		UPDATE workflow_tasks
		SET status = 'cancelled', updated_at = now()
		WHERE instance_id = $1 AND status IN ('pending', 'claimed')`

	// Engine-internal cancel keyed on instance id (no tenant arg); bypass scope.
	_, err := rlsExec(ctx, r.pool, "", query, instanceID)
	if err != nil {
		return fmt.Errorf("cancelling tasks for instance %s: %w", instanceID, err)
	}
	return nil
}

// CancelOpenByInstanceStep cancels unresolved tasks for a specific workflow
// instance step. It leaves already completed/rejected approver evidence intact.
func (r *TaskRepository) CancelOpenByInstanceStep(ctx context.Context, instanceID, stepID string) error {
	query := `
		UPDATE workflow_tasks
		SET status = 'cancelled',
		    claimed_by = NULL,
		    claimed_at = NULL,
		    updated_at = now()
		WHERE instance_id = $1
		  AND step_id = $2
		  AND status IN ('pending', 'claimed', 'escalated')`

	// Engine-internal cancel keyed on instance+step (no tenant arg); bypass scope.
	_, err := rlsExec(ctx, r.pool, "", query, instanceID, stepID)
	if err != nil {
		return fmt.Errorf("cancelling open tasks for instance %s step %s: %w", instanceID, stepID, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Timer operations
// ---------------------------------------------------------------------------

// CreateTimer inserts a timer record and returns its generated ID.
func (r *TaskRepository) CreateTimer(ctx context.Context, instanceID, stepID string, fireAt time.Time) (string, error) {
	query := `
		INSERT INTO workflow_timers (instance_id, step_id, fire_at)
		VALUES ($1, $2, $3)
		RETURNING id`

	var id string
	err := r.pool.QueryRow(ctx, query, instanceID, stepID, fireAt).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("creating timer: %w", err)
	}
	return id, nil
}

// GetUnfiredTimers returns timers whose fire_at has passed but have not been
// marked as fired. Used during recovery to catch timers that should have
// triggered while the engine was down.
func (r *TaskRepository) GetUnfiredTimers(ctx context.Context) ([]TimerRecord, error) {
	query := `
		SELECT id, instance_id, step_id, fire_at
		FROM workflow_timers
		WHERE fired = false AND fire_at <= now()
		ORDER BY fire_at ASC`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("getting unfired timers: %w", err)
	}
	defer rows.Close()

	var timers []TimerRecord
	for rows.Next() {
		var t TimerRecord
		if err := rows.Scan(&t.ID, &t.InstanceID, &t.StepID, &t.FireAt); err != nil {
			return nil, fmt.Errorf("scanning timer row: %w", err)
		}
		timers = append(timers, t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating timer rows: %w", err)
	}
	return timers, nil
}

// MarkTimerFired sets fired = true for a timer.
func (r *TaskRepository) MarkTimerFired(ctx context.Context, timerID string) error {
	query := `UPDATE workflow_timers SET fired = true WHERE id = $1`

	ct, err := r.pool.Exec(ctx, query, timerID)
	if err != nil {
		return fmt.Errorf("marking timer fired: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("timer %s: %w", timerID, model.ErrNotFound)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// scanTask scans a single pgx.Row into a HumanTask, handling JSONB
// deserialization of form_schema, form_data, and metadata.
func (r *TaskRepository) scanTask(row pgx.Row) (*model.HumanTask, error) {
	var (
		task            model.HumanTask
		formSchemaJSON  []byte
		formDataJSON    []byte
		metadataJSON    []byte
		candidateGroups []string
		candidateUsers  []string
	)

	err := row.Scan(
		&task.ID,
		&task.TenantID,
		&task.InstanceID,
		&task.StepID,
		&task.StepExecID,
		&task.Name,
		&task.Description,
		&task.Status,
		&task.AssigneeID,
		&task.AssigneeRole,
		&candidateGroups,
		&candidateUsers,
		&task.ClaimedBy,
		&task.ClaimedAt,
		&formSchemaJSON,
		&formDataJSON,
		&task.SLADeadline,
		&task.SLABreached,
		&task.EscalatedTo,
		&task.EscalationRole,
		&task.DelegatedBy,
		&task.DelegatedAt,
		&task.Priority,
		&metadataJSON,
		&task.CompletedAt,
		&task.LateJustification,
		&task.LateJustificationSubmittedBy,
		&task.LateJustificationSubmittedAt,
		&task.LateJustificationManagerRole,
		&task.CreatedAt,
		&task.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("task: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning task: %w", err)
	}
	task.CandidateGroups = candidateGroups
	task.CandidateUsers = candidateUsers

	if err := json.Unmarshal(formSchemaJSON, &task.FormSchema); err != nil {
		return nil, fmt.Errorf("unmarshaling form_schema: %w", err)
	}
	if formDataJSON != nil {
		if err := json.Unmarshal(formDataJSON, &task.FormData); err != nil {
			return nil, fmt.Errorf("unmarshaling form_data: %w", err)
		}
	}
	if err := json.Unmarshal(metadataJSON, &task.Metadata); err != nil {
		return nil, fmt.Errorf("unmarshaling task metadata: %w", err)
	}

	// Transparently decrypt any at-rest envelopes in form_data (no-op when no
	// codec is wired / no envelopes present). Fails closed on a corrupt envelope.
	if err := r.decryptTaskFormData(&task); err != nil {
		return nil, err
	}

	return &task, nil
}

// scanTasks iterates over pgx.Rows and returns a slice of tasks.
func (r *TaskRepository) scanTasks(rows pgx.Rows) ([]*model.HumanTask, error) {
	var tasks []*model.HumanTask
	for rows.Next() {
		var (
			task            model.HumanTask
			formSchemaJSON  []byte
			formDataJSON    []byte
			metadataJSON    []byte
			candidateGroups []string
			candidateUsers  []string
		)

		if err := rows.Scan(
			&task.ID,
			&task.TenantID,
			&task.InstanceID,
			&task.StepID,
			&task.StepExecID,
			&task.Name,
			&task.Description,
			&task.Status,
			&task.AssigneeID,
			&task.AssigneeRole,
			&candidateGroups,
			&candidateUsers,
			&task.ClaimedBy,
			&task.ClaimedAt,
			&formSchemaJSON,
			&formDataJSON,
			&task.SLADeadline,
			&task.SLABreached,
			&task.EscalatedTo,
			&task.EscalationRole,
			&task.DelegatedBy,
			&task.DelegatedAt,
			&task.Priority,
			&metadataJSON,
			&task.CompletedAt,
			&task.LateJustification,
			&task.LateJustificationSubmittedBy,
			&task.LateJustificationSubmittedAt,
			&task.LateJustificationManagerRole,
			&task.CreatedAt,
			&task.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning task row: %w", err)
		}
		task.CandidateGroups = candidateGroups
		task.CandidateUsers = candidateUsers

		if err := json.Unmarshal(formSchemaJSON, &task.FormSchema); err != nil {
			return nil, fmt.Errorf("unmarshaling form_schema: %w", err)
		}
		if formDataJSON != nil {
			if err := json.Unmarshal(formDataJSON, &task.FormData); err != nil {
				return nil, fmt.Errorf("unmarshaling form_data: %w", err)
			}
		}
		if err := json.Unmarshal(metadataJSON, &task.Metadata); err != nil {
			return nil, fmt.Errorf("unmarshaling task metadata: %w", err)
		}

		// Transparently decrypt any at-rest envelopes in form_data (no-op when no
		// codec is wired). Fails closed on a corrupt envelope.
		if err := r.decryptTaskFormData(&task); err != nil {
			return nil, err
		}

		tasks = append(tasks, &task)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating task rows: %w", err)
	}
	return tasks, nil
}
