package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// TriggerExecutionRepository persists trigger evaluation logs for automation
// observability and replay.
type TriggerExecutionRepository struct {
	pool *pgxpool.Pool
}

// NewTriggerExecutionRepository creates a new trigger execution repository.
func NewTriggerExecutionRepository(pool *pgxpool.Pool) *TriggerExecutionRepository {
	return &TriggerExecutionRepository{pool: pool}
}

// Create inserts a trigger execution log entry and scans generated fields back
// into the model.
func (r *TriggerExecutionRepository) Create(ctx context.Context, exec *model.TriggerExecution) error {
	if exec == nil {
		return fmt.Errorf("trigger execution is required")
	}
	if !model.ValidTriggerExecutionStatuses[exec.Status] {
		return fmt.Errorf("invalid trigger execution status: %s", exec.Status)
	}

	var triggerData []byte
	if len(exec.TriggerData) > 0 {
		triggerData = []byte(exec.TriggerData)
		if !json.Valid(triggerData) {
			return fmt.Errorf("trigger_data must be valid JSON")
		}
	}

	query := `
		INSERT INTO workflow_trigger_executions (
			tenant_id, definition_id, instance_id, event_id, topic,
			status, dedupe_key, reason, trigger_data, error_message
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at`

	// Scope the INSERT to the log entry's tenant so RLS admits it.
	tx, err := beginScoped(ctx, r.pool, exec.TenantID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := tx.QueryRow(ctx, query,
		exec.TenantID,
		exec.DefinitionID,
		exec.InstanceID,
		exec.EventID,
		exec.Topic,
		exec.Status,
		emptyStringToNil(exec.DedupeKey),
		exec.Reason,
		triggerData,
		exec.ErrorMessage,
	).Scan(&exec.ID, &exec.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// GetByID retrieves a trigger execution by tenant and id.
func (r *TriggerExecutionRepository) GetByID(ctx context.Context, tenantID, id string) (*model.TriggerExecution, error) {
	query := `
		SELECT id, tenant_id, definition_id, instance_id, event_id, topic,
		       status, COALESCE(dedupe_key, ''), reason, trigger_data,
		       error_message, created_at
		FROM workflow_trigger_executions
		WHERE tenant_id = $1 AND id = $2`

	sctx := WithTenantScope(ctx, tenantID)
	return scanTriggerExecution(newScopedPool(r.pool).QueryRow(sctx, query, tenantID, id))
}

// List returns paginated trigger execution logs for a tenant.
func (r *TriggerExecutionRepository) List(
	ctx context.Context,
	tenantID, status, definitionID, eventID, topic string,
	dateFrom, dateTo *time.Time,
	limit, offset int,
) ([]*model.TriggerExecution, int, error) {
	var conditions []string
	var args []any
	argIdx := 1

	conditions = append(conditions, fmt.Sprintf("tenant_id = $%d", argIdx))
	args = append(args, tenantID)
	argIdx++

	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, status)
		argIdx++
	}
	if definitionID != "" {
		conditions = append(conditions, fmt.Sprintf("definition_id = $%d", argIdx))
		args = append(args, definitionID)
		argIdx++
	}
	if eventID != "" {
		conditions = append(conditions, fmt.Sprintf("event_id = $%d", argIdx))
		args = append(args, eventID)
		argIdx++
	}
	if topic != "" {
		conditions = append(conditions, fmt.Sprintf("topic = $%d", argIdx))
		args = append(args, topic)
		argIdx++
	}
	if dateFrom != nil {
		conditions = append(conditions, fmt.Sprintf("created_at >= $%d", argIdx))
		args = append(args, *dateFrom)
		argIdx++
	}
	if dateTo != nil {
		conditions = append(conditions, fmt.Sprintf("created_at <= $%d", argIdx))
		args = append(args, *dateTo)
		argIdx++
	}

	where := strings.Join(conditions, " AND ")

	// Count + page under ONE tenant-scoped transaction so RLS filters both.
	tx, err := beginScoped(ctx, r.pool, tenantID)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	countQuery := "SELECT COUNT(*) FROM workflow_trigger_executions WHERE " + where
	var total int
	if err := tx.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting trigger executions: %w", err)
	}

	query := `
		SELECT id, tenant_id, definition_id, instance_id, event_id, topic,
		       status, COALESCE(dedupe_key, ''), reason, trigger_data,
		       error_message, created_at
		FROM workflow_trigger_executions
		WHERE ` + where + `
		ORDER BY created_at DESC
		LIMIT $` + fmt.Sprint(argIdx) + ` OFFSET $` + fmt.Sprint(argIdx+1)

	args = append(args, limit, offset)

	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing trigger executions: %w", err)
	}
	executions, err := scanTriggerExecutions(rows)
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, fmt.Errorf("committing trigger-execution list: %w", err)
	}

	return executions, total, nil
}

func scanTriggerExecution(row pgx.Row) (*model.TriggerExecution, error) {
	var exec model.TriggerExecution
	var triggerData []byte

	err := row.Scan(
		&exec.ID,
		&exec.TenantID,
		&exec.DefinitionID,
		&exec.InstanceID,
		&exec.EventID,
		&exec.Topic,
		&exec.Status,
		&exec.DedupeKey,
		&exec.Reason,
		&triggerData,
		&exec.ErrorMessage,
		&exec.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("trigger execution: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning trigger execution: %w", err)
	}
	if triggerData != nil {
		exec.TriggerData = json.RawMessage(triggerData)
	}

	return &exec, nil
}

func scanTriggerExecutions(rows pgx.Rows) ([]*model.TriggerExecution, error) {
	var executions []*model.TriggerExecution
	for rows.Next() {
		exec, err := scanTriggerExecution(rows)
		if err != nil {
			return nil, err
		}
		executions = append(executions, exec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating trigger executions: %w", err)
	}
	return executions, nil
}

func emptyStringToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}
