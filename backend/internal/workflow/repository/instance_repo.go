package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/workflow/model"
)

// PayloadCodec is the OPTIONAL type-assertion seam through which the repository
// encrypts the values of classified keys before persisting the variables /
// step_outputs JSONB, and decrypts them on read. It is satisfied by
// *internal/workflow/payloadcrypto.Codec. When the repository's codec is nil (the
// default), every JSONB read/write is a plain json.Marshal / json.Unmarshal —
// byte-for-byte identical to the pre-encryption behavior — so existing rows,
// deployments, and test doubles are unaffected.
//
// EncryptMap returns a copy of m with the values of the keys in sensitive
// replaced by "enc:v1:" envelopes; DecryptMap returns a copy with any envelope
// value decrypted, failing closed on a corrupt envelope. Both are pass-throughs
// on a nil receiver.
type PayloadCodec interface {
	EncryptMap(sensitive map[string]bool, m map[string]interface{}) (map[string]interface{}, error)
	DecryptMap(m map[string]interface{}) (map[string]interface{}, error)
}

// InstanceRepository handles all database operations for workflow instances
// and their associated step executions.
type InstanceRepository struct {
	pool *pgxpool.Pool

	// payloadCodec is the optional at-rest encryption seam (nil == legacy
	// plaintext). Set via WithPayloadCodec at wiring time.
	payloadCodec PayloadCodec
}

// NewInstanceRepository creates a new InstanceRepository backed by the
// provided connection pool. No payload codec is wired by default, so JSONB is
// stored in plaintext exactly as before; call WithPayloadCodec to enable
// field-level encryption at rest.
func NewInstanceRepository(pool *pgxpool.Pool) *InstanceRepository {
	return &InstanceRepository{pool: pool}
}

// WithPayloadCodec wires an OPTIONAL payload-encryption codec and returns the
// repository for chaining. When set, the values of an instance's SensitiveKeys
// are encrypted at rest in the variables / step_outputs JSONB and transparently
// decrypted on read. A nil codec (or never calling this) preserves the legacy
// plaintext behavior. It is a wiring-time setter (not concurrent-safe with live
// reads/writes) — call it before the repository is used.
func (r *InstanceRepository) WithPayloadCodec(codec PayloadCodec) *InstanceRepository {
	r.payloadCodec = codec
	return r
}

// marshalVariables JSON-encodes an instance's Variables for persistence,
// encrypting the values of its SensitiveKeys first when a codec is wired. When no
// codec is wired (or no keys are classified) this is exactly json.Marshal of the
// plaintext map. Fails closed: an encryption error aborts the write (never
// persists plaintext when encryption was requested).
func (r *InstanceRepository) marshalVariables(inst *model.WorkflowInstance) ([]byte, error) {
	toStore := inst.Variables
	if r.payloadCodec != nil && len(inst.SensitiveKeys) > 0 {
		enc, err := r.payloadCodec.EncryptMap(inst.SensitiveKeys, inst.Variables)
		if err != nil {
			return nil, fmt.Errorf("encrypting instance variables: %w", err)
		}
		toStore = enc
	}
	b, err := json.Marshal(toStore)
	if err != nil {
		return nil, fmt.Errorf("marshaling instance variables: %w", err)
	}
	return b, nil
}

// marshalStepOutputs mirrors marshalVariables for the step_outputs JSONB.
func (r *InstanceRepository) marshalStepOutputs(inst *model.WorkflowInstance) ([]byte, error) {
	toStore := inst.StepOutputs
	if r.payloadCodec != nil && len(inst.SensitiveKeys) > 0 {
		enc, err := r.payloadCodec.EncryptMap(inst.SensitiveKeys, inst.StepOutputs)
		if err != nil {
			return nil, fmt.Errorf("encrypting step_outputs: %w", err)
		}
		toStore = enc
	}
	b, err := json.Marshal(toStore)
	if err != nil {
		return nil, fmt.Errorf("marshaling step_outputs: %w", err)
	}
	return b, nil
}

// decryptInstancePayload transparently decrypts any "enc:v1:" envelope values in
// a freshly-scanned instance's Variables / StepOutputs. It is a no-op when no
// codec is wired. Envelopes are self-describing, so this works even for an
// instance whose definition no longer classifies a key; legacy plaintext values
// are returned unchanged. Fails closed on a corrupt envelope.
//
// It also records the set of keys that WERE encrypted at rest into
// inst.SensitiveKeys, so a repo-internal load-mutate-persist round-trip (e.g.
// UpdateVariables, which reloads under a row lock and does not consult the
// definition) re-encrypts exactly those keys and never demotes an
// already-protected value back to plaintext.
func (r *InstanceRepository) decryptInstancePayload(inst *model.WorkflowInstance) error {
	if r.payloadCodec == nil || inst == nil {
		return nil
	}
	encrypted := make(map[string]bool)
	collectEncryptedKeys(inst.Variables, encrypted)
	collectEncryptedKeys(inst.StepOutputs, encrypted)
	vars, err := r.payloadCodec.DecryptMap(inst.Variables)
	if err != nil {
		return fmt.Errorf("decrypting instance variables: %w", err)
	}
	inst.Variables = vars
	outs, err := r.payloadCodec.DecryptMap(inst.StepOutputs)
	if err != nil {
		return fmt.Errorf("decrypting step_outputs: %w", err)
	}
	inst.StepOutputs = outs
	if len(encrypted) > 0 {
		// Merge with any classification the caller already stamped so both the
		// definition-declared keys and the historically-encrypted keys are honored
		// on the next write.
		if inst.SensitiveKeys == nil {
			inst.SensitiveKeys = encrypted
		} else {
			for k := range encrypted {
				inst.SensitiveKeys[k] = true
			}
		}
	}
	return nil
}

// payloadIsEnvelope reports whether a scanned string value is an at-rest
// encryption envelope. It mirrors payloadcrypto.IsEncrypted without importing
// that package into the repository's hot scan path's type set (the codec seam is
// an interface; this is a cheap prefix check on the raw scanned string).
func payloadIsEnvelope(s string) bool {
	const prefix = "enc:v1:"
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// collectEncryptedKeys records into dst the name of every key whose value is (or,
// for a nested object, CONTAINS at any depth) an at-rest envelope. It mirrors the
// recursive descent EncryptMap/DecryptMap perform, so the set of keys that were
// encrypted at rest is recovered even for the real step_outputs shape
// {stepID:{"output":{field:envelope}}} where the classified FIELD name is nested
// two levels below the (non-sensitive) step id. Recording the FIELD name here is
// what lets a repo-internal load-mutate-persist round-trip re-encrypt exactly the
// same keys via the recursive EncryptMap and never demote a protected value back
// to plaintext.
func collectEncryptedKeys(m map[string]interface{}, dst map[string]bool) {
	for k, v := range m {
		switch tv := v.(type) {
		case string:
			if payloadIsEnvelope(tv) {
				dst[k] = true
			}
		case map[string]interface{}:
			collectEncryptedKeys(tv, dst)
		}
	}
}

// Create inserts a new workflow instance. JSONB fields (variables,
// step_outputs, trigger_data) are marshaled before insertion. The generated
// ID and timestamps are scanned back into the struct.
//
// The INSERT runs inside a transaction scoped to inst.TenantID (SET LOCAL
// app.current_tenant_id) so the RLS WITH CHECK policy admits the row for the
// owning tenant only. The RETURNING scan must happen inside the same tx, so the
// method opens the tx explicitly rather than using the single-statement helper.
func (r *InstanceRepository) Create(ctx context.Context, inst *model.WorkflowInstance) error {
	variablesJSON, err := r.marshalVariables(inst)
	if err != nil {
		return err
	}
	stepOutputsJSON, err := r.marshalStepOutputs(inst)
	if err != nil {
		return err
	}

	// trigger_data is already json.RawMessage; use nil for empty.
	var triggerData []byte
	if len(inst.TriggerData) > 0 {
		triggerData = []byte(inst.TriggerData)
	}

	query := `
		INSERT INTO workflow_instances (
			tenant_id, definition_id, definition_ver, status,
			current_step_id, variables, step_outputs, trigger_data,
			error_message, started_by, parent_instance_id, parent_step_id
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, started_at, updated_at, lock_version`

	tx, err := beginScoped(ctx, r.pool, inst.TenantID)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := tx.QueryRow(ctx, query,
		inst.TenantID,
		inst.DefinitionID,
		inst.DefinitionVer,
		inst.Status,
		inst.CurrentStepID,
		variablesJSON,
		stepOutputsJSON,
		triggerData,
		inst.ErrorMessage,
		inst.StartedBy,
		inst.ParentInstanceID,
		inst.ParentStepID,
	).Scan(&inst.ID, &inst.StartedAt, &inst.UpdatedAt, &inst.LockVersion); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// GetByID retrieves an instance by ID and tenant. Returns model.ErrNotFound
// when the row does not exist.
//
// A non-empty tenantID scopes the read to that tenant (RLS + the explicit WHERE);
// an empty tenantID is an INTERNAL, already-authorized re-entry read (the engine
// loads an instance mid-advance without re-passing the tenant) and runs under the
// bypass scope, then the WHERE clause omits the tenant predicate. Both paths are
// unchanged for callers.
func (r *InstanceRepository) GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowInstance, error) {
	tx, err := beginScoped(ctx, r.pool, tenantID)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var row pgx.Row
	if tenantID == "" {
		row = tx.QueryRow(ctx, `
			SELECT id, tenant_id, definition_id, definition_ver, status,
			       current_step_id, variables, step_outputs, trigger_data,
			       error_message, started_by, started_at, completed_at,
			       updated_at, lock_version, parent_instance_id, parent_step_id
			FROM workflow_instances
			WHERE id = $1`, id)
	} else {
		row = tx.QueryRow(ctx, `
			SELECT id, tenant_id, definition_id, definition_ver, status,
			       current_step_id, variables, step_outputs, trigger_data,
			       error_message, started_by, started_at, completed_at,
			       updated_at, lock_version, parent_instance_id, parent_step_id
			FROM workflow_instances
			WHERE id = $1 AND tenant_id = $2`, id, tenantID)
	}
	inst, err := r.scanInstance(row)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("committing GetByID: %w", err)
	}
	return inst, nil
}

// GetByIDForUpdate retrieves an instance using a row-level lock inside the
// provided transaction (SELECT ... FOR UPDATE). This must be called within a
// transaction obtained from pool.Begin() so the lock is held until commit.
func (r *InstanceRepository) GetByIDForUpdate(ctx context.Context, tx pgx.Tx, id string) (*model.WorkflowInstance, error) {
	query := `
		SELECT id, tenant_id, definition_id, definition_ver, status,
		       current_step_id, variables, step_outputs, trigger_data,
		       error_message, started_by, started_at, completed_at,
		       updated_at, lock_version, parent_instance_id, parent_step_id
		FROM workflow_instances
		WHERE id = $1
		FOR UPDATE`

	return r.scanInstance(tx.QueryRow(ctx, query, id))
}

// UpdateWithLock performs an optimistic-locking update. The caller must supply
// the current lock_version read during the preceding SELECT. If the version in
// the database no longer matches, no rows are affected and
// model.ErrConcurrencyConfl is returned.
func (r *InstanceRepository) UpdateWithLock(ctx context.Context, inst *model.WorkflowInstance) error {
	variablesJSON, err := r.marshalVariables(inst)
	if err != nil {
		return err
	}
	stepOutputsJSON, err := r.marshalStepOutputs(inst)
	if err != nil {
		return err
	}

	var triggerData []byte
	if len(inst.TriggerData) > 0 {
		triggerData = []byte(inst.TriggerData)
	}

	query := `
		UPDATE workflow_instances
		SET status = $2,
		    current_step_id = $3,
		    variables = $4,
		    step_outputs = $5,
		    trigger_data = $6,
		    error_message = $7,
		    completed_at = $8,
		    lock_version = lock_version + 1,
		    updated_at = now()
		WHERE id = $1 AND lock_version = $9`

	// Scope to the instance's own tenant so the RLS UPDATE policy admits the row.
	// inst.TenantID is always populated (set at Create or hydrated by a prior
	// GetByID scan), including for engine-internal advances that loaded the
	// instance with an empty tenant.
	ct, err := rlsExec(ctx, r.pool, inst.TenantID, query,
		inst.ID,
		inst.Status,
		inst.CurrentStepID,
		variablesJSON,
		stepOutputsJSON,
		triggerData,
		inst.ErrorMessage,
		inst.CompletedAt,
		inst.LockVersion,
	)
	if err != nil {
		return fmt.Errorf("updating workflow instance: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("instance %s: %w", inst.ID, model.ErrConcurrencyConfl)
	}

	// Reflect the new lock version in the caller's struct.
	inst.LockVersion++
	return nil
}

// updateWithLockTx is the transaction-scoped body of UpdateWithLock. It performs
// the optimistic-locking UPDATE using the supplied pgx.Tx so the write commits
// atomically with the rest of the caller's transaction. On success the caller's
// struct lock_version is bumped to match.
func (r *InstanceRepository) updateWithLockTx(ctx context.Context, tx pgx.Tx, inst *model.WorkflowInstance) error {
	variablesJSON, err := r.marshalVariables(inst)
	if err != nil {
		return err
	}
	stepOutputsJSON, err := r.marshalStepOutputs(inst)
	if err != nil {
		return err
	}

	var triggerData []byte
	if len(inst.TriggerData) > 0 {
		triggerData = []byte(inst.TriggerData)
	}

	ct, err := tx.Exec(ctx, `
		UPDATE workflow_instances
		SET status = $2,
		    current_step_id = $3,
		    variables = $4,
		    step_outputs = $5,
		    trigger_data = $6,
		    error_message = $7,
		    completed_at = $8,
		    lock_version = lock_version + 1,
		    updated_at = now()
		WHERE id = $1 AND lock_version = $9`,
		inst.ID,
		inst.Status,
		inst.CurrentStepID,
		variablesJSON,
		stepOutputsJSON,
		triggerData,
		inst.ErrorMessage,
		inst.CompletedAt,
		inst.LockVersion,
	)
	if err != nil {
		return fmt.Errorf("updating workflow instance: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("instance %s: %w", inst.ID, model.ErrConcurrencyConfl)
	}
	inst.LockVersion++
	return nil
}

// createStepExecutionTx is the transaction-scoped body of CreateStepExecution.
func (r *InstanceRepository) createStepExecutionTx(ctx context.Context, tx pgx.Tx, exec *model.StepExecution) error {
	var inputData []byte
	if len(exec.InputData) > 0 {
		inputData = []byte(exec.InputData)
	}
	var outputData []byte
	if len(exec.OutputData) > 0 {
		outputData = []byte(exec.OutputData)
	}

	return tx.QueryRow(ctx, `
		INSERT INTO workflow_step_executions (
			instance_id, step_id, step_type, status,
			input_data, output_data, error_message, attempt,
			started_at, completed_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at`,
		exec.InstanceID,
		exec.StepID,
		exec.StepType,
		exec.Status,
		inputData,
		outputData,
		exec.ErrorMessage,
		exec.Attempt,
		exec.StartedAt,
		exec.CompletedAt,
	).Scan(&exec.ID, &exec.CreatedAt)
}

// CommitStepTransition atomically commits a single workflow advance: it locks the
// instance row (SELECT ... FOR UPDATE — serializing concurrent re-entries such as
// a timer fire racing a task resume), creates the step-execution record, and
// applies the instance state transition (status / current_step_id / step_outputs)
// under the optimistic lock — ALL in ONE transaction. Either the whole transition
// commits or none of it does, so a crash mid-advance can no longer tear state
// across the previous three autocommit writes.
//
// The caller supplies inst with its lock_version as last read; the row-lock read
// re-checks that the version still matches (a concurrent committer would have
// bumped it, yielding model.ErrConcurrencyConfl). On success inst.LockVersion is
// advanced to reflect the committed row.
//
// stepExec may be nil (a bare state transition with no new step-execution row,
// e.g. storing partial output). When non-nil its ID/CreatedAt are populated.
func (r *InstanceRepository) CommitStepTransition(ctx context.Context, inst *model.WorkflowInstance, stepExec *model.StepExecution) error {
	// Scope the whole atomic transition to the instance's tenant so the RLS
	// policies on workflow_instances (UPDATE) and workflow_step_executions
	// (INSERT, keyed on the parent instance's tenant) both admit the writes.
	tx, err := beginScoped(ctx, r.pool, inst.TenantID)
	if err != nil {
		return fmt.Errorf("beginning step-transition transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the instance row for the duration of the transaction. This serializes
	// the transition against any other in-flight advance for the same instance.
	locked, err := r.GetByIDForUpdate(ctx, tx, inst.ID)
	if err != nil {
		return fmt.Errorf("locking instance for step transition: %w", err)
	}
	// The locked read reflects the authoritative committed lock_version; align the
	// update predicate to it so a stale in-memory version does not spuriously
	// conflict, while a genuine concurrent commit (version already advanced past
	// what we based this transition on) is still rejected.
	if locked.LockVersion != inst.LockVersion {
		return fmt.Errorf("instance %s: %w", inst.ID, model.ErrConcurrencyConfl)
	}

	if stepExec != nil {
		if err := r.createStepExecutionTx(ctx, tx, stepExec); err != nil {
			return fmt.Errorf("creating step execution in transition: %w", err)
		}
	}

	if err := r.updateWithLockTx(ctx, tx, inst); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// CommitInstanceStateWithEvent atomically commits an instance LIFECYCLE state
// transition (complete / fail / cancel / suspend / resume / retry) AND stages its
// workflow.* audit event into the transactional outbox in the SAME database
// transaction. Either both the state change and the audit event commit, or
// neither does — closing the historical loss window where a committed transition
// could lose its best-effort direct-Kafka audit emit if the broker was down.
//
// The state write is the same optimistic-locked UPDATE as UpdateWithLock (status
// / current_step_id / variables / step_outputs / error_message / completed_at),
// so payload encryption at rest is honored identically. An OPTIONAL endStepExec
// (the end-step audit row completeInstance writes) is inserted in the same tx when
// non-nil. The event is staged via outbox.Write against the SAME workflow-db pool
// on which the relay drains platform.workflow.events, so the platform hash-chain
// audit subsystem receives it exactly-once (dedup on the stable event ID) with no
// separate audit system introduced here.
//
// topic is normally events.Topics.WorkflowEvents; evt is a fully-built
// *events.Event whose Type/Data the audit-service consumer already maps — the
// caller MUST build it with the same events.NewEvent shape the legacy publishEvent
// path used, so event names/shapes are unchanged and there is no double-emit
// (this REPLACES the direct publish for the same event).
//
// On a lock conflict (a concurrent committer already advanced the row) NOTHING is
// written — neither the state change nor the audit event — and
// model.ErrConcurrencyConfl is returned. On success inst.LockVersion is advanced.
func (r *InstanceRepository) CommitInstanceStateWithEvent(ctx context.Context, inst *model.WorkflowInstance, endStepExec *model.StepExecution, topic string, evt *events.Event) error {
	if evt == nil {
		return fmt.Errorf("commit-with-event requires a non-nil event")
	}

	tx, err := beginScoped(ctx, r.pool, inst.TenantID)
	if err != nil {
		return fmt.Errorf("beginning lifecycle-transition transaction: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := r.commitInstanceStateWithEventTx(ctx, tx, inst, endStepExec, topic, evt); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// commitInstanceStateWithEventTx is the transaction-scoped body of
// CommitInstanceStateWithEvent: within the SUPPLIED transaction it writes an
// optional end-step audit row, applies the optimistic-locked instance UPDATE, and
// stages the audit event via outbox.Write — in that order, so the event's INSERT
// shares the caller's tx and is delivered iff that tx commits. It performs NO
// begin/commit/rollback of its own (the caller owns the tx lifecycle), which is
// what lets a unit test drive it against a fake pgx.Tx and observe that the audit
// event is staged on the SAME transaction as the state change (and, when the
// UPDATE conflicts, that the event is never staged). This is the atomicity seam
// that makes the non-promotion audit emit LOSSLESS.
func (r *InstanceRepository) commitInstanceStateWithEventTx(ctx context.Context, tx pgx.Tx, inst *model.WorkflowInstance, endStepExec *model.StepExecution, topic string, evt *events.Event) error {
	// Optional end-step audit row (completeInstance) committed in the same tx as
	// the state change and the outbox event.
	if endStepExec != nil {
		if err := r.createStepExecutionTx(ctx, tx, endStepExec); err != nil {
			return fmt.Errorf("creating lifecycle step execution: %w", err)
		}
	}

	// State transition under the optimistic lock. updateWithLockTx returns
	// model.ErrConcurrencyConfl (rolling the whole tx back) when the row moved —
	// and because we return BEFORE staging, no audit event is written on conflict.
	if err := r.updateWithLockTx(ctx, tx, inst); err != nil {
		return err
	}

	// Stage the audit event in the SAME transaction: it is delivered iff the state
	// change commits. This is what makes the non-promotion audit emit LOSSLESS.
	if err := outbox.Write(ctx, tx, topic, evt); err != nil {
		return fmt.Errorf("staging lifecycle audit event: %w", err)
	}

	return nil
}

// MigrateInstanceVersion atomically re-pins a RUNNING/SUSPENDED/INCIDENT instance
// from its current definition version to a target version, remapping its current
// step and (optionally) its variables/step outputs — ALL in ONE transaction with
// the instance row locked FOR UPDATE, so the migration cannot race a concurrent
// advance (a racing committer would find the lock_version already bumped and lose
// with model.ErrConcurrencyConfl; this migrate would find a changed version and
// fail closed the same way).
//
// The caller supplies inst with:
//   - DefinitionID / DefinitionVer already set to the TARGET version,
//   - CurrentStepID set to the REMAPPED step in the target,
//   - Variables / StepOutputs carrying any remapped state,
//   - LockVersion as last read (the row lock re-checks it).
//
// It re-reads the locked row to (a) re-verify lock_version and (b) re-verify the
// instance is still in a migratable (non-terminal, runnable/suspended/incident)
// state under the lock, rejecting a terminal instance fail-closed even if it went
// terminal between the caller's read and the lock. An optional stepExec (a
// step_type='migration' audit row) is written in the same transaction.
func (r *InstanceRepository) MigrateInstanceVersion(ctx context.Context, inst *model.WorkflowInstance, stepExec *model.StepExecution) error {
	tx, err := beginScoped(ctx, r.pool, inst.TenantID)
	if err != nil {
		return fmt.Errorf("beginning migration transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	locked, err := r.GetByIDForUpdate(ctx, tx, inst.ID)
	if err != nil {
		return fmt.Errorf("locking instance for migration: %w", err)
	}
	if locked.LockVersion != inst.LockVersion {
		return fmt.Errorf("instance %s: %w", inst.ID, model.ErrConcurrencyConfl)
	}
	// Re-verify migratability under the lock: a terminal instance is never
	// migratable (belt-and-suspenders against a status flip between the caller's
	// read and this lock).
	if locked.IsTerminal() {
		return fmt.Errorf("instance %s is in terminal state %q and cannot be migrated: %w", inst.ID, locked.Status, model.ErrConflict)
	}

	if stepExec != nil {
		if err := r.createStepExecutionTx(ctx, tx, stepExec); err != nil {
			return fmt.Errorf("creating migration audit step execution: %w", err)
		}
	}

	variablesJSON, err := r.marshalVariables(inst)
	if err != nil {
		return fmt.Errorf("marshaling migrated variables: %w", err)
	}
	stepOutputsJSON, err := r.marshalStepOutputs(inst)
	if err != nil {
		return fmt.Errorf("marshaling migrated step_outputs: %w", err)
	}

	ct, err := tx.Exec(ctx, `
		UPDATE workflow_instances
		SET definition_id = $2,
		    definition_ver = $3,
		    current_step_id = $4,
		    variables = $5,
		    step_outputs = $6,
		    lock_version = lock_version + 1,
		    updated_at = now()
		WHERE id = $1 AND lock_version = $7`,
		inst.ID,
		inst.DefinitionID,
		inst.DefinitionVer,
		inst.CurrentStepID,
		variablesJSON,
		stepOutputsJSON,
		inst.LockVersion,
	)
	if err != nil {
		return fmt.Errorf("migrating instance %s: %w", inst.ID, err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("instance %s: %w", inst.ID, model.ErrConcurrencyConfl)
	}
	inst.LockVersion++

	return tx.Commit(ctx)
}

// ListByDefinitionAndStatus returns instances (paginated) pinned to a SPECIFIC
// definition version id and optionally filtered by status, for a tenant. It
// powers BULK in-flight migration: select every running/suspended/incident
// instance still on an old version and migrate them together. status == "" means
// any status. Ordered by started_at ASC for stable batch processing.
func (r *InstanceRepository) ListByDefinitionAndStatus(ctx context.Context, tenantID, definitionID, status string, limit, offset int) ([]*model.WorkflowInstance, error) {
	var conditions []string
	var args []any
	argIdx := 1

	conditions = append(conditions, fmt.Sprintf("tenant_id = $%d", argIdx))
	args = append(args, tenantID)
	argIdx++
	conditions = append(conditions, fmt.Sprintf("definition_id = $%d", argIdx))
	args = append(args, definitionID)
	argIdx++
	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
		args = append(args, status)
		argIdx++
	}

	where := strings.Join(conditions, " AND ")
	query := fmt.Sprintf(`
		SELECT id, tenant_id, definition_id, definition_ver, status,
		       current_step_id, variables, step_outputs, trigger_data,
		       error_message, started_by, started_at, completed_at,
		       updated_at, lock_version, parent_instance_id, parent_step_id
		FROM workflow_instances
		WHERE %s
		ORDER BY started_at ASC
		LIMIT $%d OFFSET $%d`, where, argIdx, argIdx+1)
	args = append(args, limit, offset)

	tx, err := beginScoped(ctx, r.pool, tenantID)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("listing instances by definition+status: %w", err)
	}
	instances, err := r.scanInstances(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("committing instances-by-definition list: %w", err)
	}
	return instances, nil
}

// SerializeInstance provides the per-instance critical section for the hot
// execute/advance ENTRY so concurrent re-entries (a timer fire racing a task
// resume, or parallel forks) do not double-advance.
//
// WAVE-2 REFINEMENT (lock scope over I/O). The previous implementation held a
// transaction-scoped advisory lock — and therefore a POOLED CONNECTION, idle in
// transaction — across the ENTIRE fn dispatch, which includes the executor's
// outbound I/O (e.g. a service-task HTTP call). Under load or a slow endpoint that
// pinned a pool connection for the whole request, starving the pool.
//
// fn is now run WITHOUT holding a connection across its I/O window. The
// no-double-advance guarantee is preserved by the three narrower mechanisms that
// already gate the actual state mutation, none of which spans external I/O:
//
//  1. the engine's in-process keyed mutex (service/instance_lock.go), which
//     serializes re-entries within a process, held by serializeTransition;
//  2. the SELECT ... FOR UPDATE row lock + optimistic lock_version re-check
//     inside CommitStepTransition, which serializes the atomic commit ACROSS
//     processes/replicas and rejects a stale concurrent committer with
//     model.ErrConcurrencyConfl (the losing re-entry no-ops, it cannot
//     double-advance);
//  3. the persisted activity idempotency ledger (workflow_activity_executions),
//     which gives double-effect safety for any outbound call replayed by a
//     racing re-entry or a crash-recovery.
//
// The cross-process serialization that used to sit in this advisory lock is thus
// folded into the commit's row lock, which is where the ONLY durable mutation
// happens — the connection is held solely for the brief commit, never across the
// dispatch. fn opens its own scoped transactions (CommitStepTransition), so no
// connection is retained here.
func (r *InstanceRepository) SerializeInstance(_ context.Context, _ string, fn func() error) error {
	return fn()
}

// withInstanceAdvisoryLock runs fn while holding a SESSION-level Postgres advisory
// lock keyed on instanceID on a DEDICATED, immediately-released connection. Unlike
// the removed transaction-scoped variant it does NOT keep a transaction open, but
// it DOES hold the acquiring connection for fn's duration, so it is reserved for
// the short critical sections that do NO external I/O (the atomic commit). It is
// provided for callers that want belt-and-suspenders cross-replica exclusion
// around a specific mutation; the engine's default path relies on the commit row
// lock (see SerializeInstance) and does not use it.
func (r *InstanceRepository) withInstanceAdvisoryLock(ctx context.Context, instanceID string, fn func() error) error {
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquiring connection for advisory lock: %w", err)
	}
	defer conn.Release()

	// hashtextextended gives a stable 64-bit key from the instance id; the second
	// argument is a fixed seed. Session-level lock: explicitly unlocked below.
	if _, err := conn.Exec(ctx,
		`SELECT pg_advisory_lock(hashtextextended($1, 0))`, instanceID,
	); err != nil {
		return fmt.Errorf("acquiring advisory lock for instance %s: %w", instanceID, err)
	}
	defer func() {
		//nolint:errcheck
		_, _ = conn.Exec(ctx, `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, instanceID)
	}()

	return fn()
}

// UpdateVariables merges the provided key-value pairs into the instance's
// variables map and persists the result inside a transaction with a row-level
// lock (SELECT FOR UPDATE) to prevent concurrent variable overwrites.
func (r *InstanceRepository) UpdateVariables(ctx context.Context, tenantID, instanceID string, variables map[string]interface{}) error {
	tx, err := beginScoped(ctx, r.pool, tenantID)
	if err != nil {
		return fmt.Errorf("beginning update-variables transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Lock the row for the duration of the transaction.
	inst, err := r.GetByIDForUpdate(ctx, tx, instanceID)
	if err != nil {
		return err
	}
	if inst.TenantID != tenantID {
		return fmt.Errorf("instance: %w", model.ErrNotFound)
	}

	if inst.Variables == nil {
		inst.Variables = make(map[string]interface{})
	}
	for k, v := range variables {
		inst.Variables[k] = v
	}

	variablesJSON, err := r.marshalVariables(inst)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx,
		`UPDATE workflow_instances SET variables = $2, updated_at = now() WHERE id = $1`,
		instanceID, variablesJSON,
	)
	if err != nil {
		return fmt.Errorf("updating instance variables: %w", err)
	}

	return tx.Commit(ctx)
}

// InstanceViewer identifies the user a listing is scoped TO. A non-nil viewer
// narrows the result set to the instances that user is involved in — the ones
// they started, plus the ones carrying a task visible to them under the shared
// task-visibility rule (assigned / claimed / escalated / claimable from one of
// their role or candidate pools).
//
// WHY this exists: /api/v1/workflows/instances is an authenticated baseline
// read (any tenant user, no workflow:* grant — see cmd/workflow-engine/rbac.go)
// because every user needs the workspace to find their own work. Without a
// viewer scope, that same endpoint hands a business user the ENTIRE tenant's
// process log: every department's approvals, their actor ids and failure
// states. Operators (workflow:admin / workflow:incident) still list unscoped —
// running the engine requires seeing all of it.
type InstanceViewer struct {
	UserID string
	Roles  []string
}

// List returns paginated instances filtered by tenant and optional criteria:
// status, definition_id, started_by, and date range. The second return value
// is the total count matching the filters. The listing is tenant-wide; callers
// serving an end user should use ListForViewer instead.
func (r *InstanceRepository) List(ctx context.Context, tenantID, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error) {
	return r.ListForViewer(ctx, tenantID, nil, status, definitionID, startedBy, dateFrom, dateTo, sortBy, sortOrder, limit, offset)
}

// ListForViewer is List narrowed to one viewer's involvement (see
// InstanceViewer). A nil viewer is the unscoped tenant-wide listing.
func (r *InstanceRepository) ListForViewer(ctx context.Context, tenantID string, viewer *InstanceViewer, status, definitionID, startedBy string, dateFrom, dateTo *time.Time, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowInstance, int, error) {
	var conditions []string
	var args []any
	argIdx := 1

	conditions = append(conditions, fmt.Sprintf("tenant_id = $%d", argIdx))
	args = append(args, tenantID)
	argIdx++

	if viewer != nil && viewer.UserID != "" {
		startedByViewerIdx := argIdx
		args = append(args, viewer.UserID)
		argIdx++

		// The instance carries a task this viewer can see. Built from the SAME
		// rule the task inbox uses, aliased onto the correlated subquery, so
		// instance visibility can never drift from task visibility.
		taskWhere, taskArgs, nextIdx := buildTaskVisibilityFor("t", tenantID, viewer.UserID, viewer.Roles, argIdx)
		args = append(args, taskArgs...)
		argIdx = nextIdx

		conditions = append(conditions, fmt.Sprintf(
			`(started_by = $%d OR EXISTS (
				SELECT 1 FROM workflow_tasks t
				WHERE t.instance_id = workflow_instances.id AND %s
			))`, startedByViewerIdx, taskWhere))
	}

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
	if startedBy != "" {
		conditions = append(conditions, fmt.Sprintf("started_by = $%d", argIdx))
		args = append(args, startedBy)
		argIdx++
	}
	if dateFrom != nil {
		conditions = append(conditions, fmt.Sprintf("started_at >= $%d", argIdx))
		args = append(args, *dateFrom)
		argIdx++
	}
	if dateTo != nil {
		conditions = append(conditions, fmt.Sprintf("started_at <= $%d", argIdx))
		args = append(args, *dateTo)
		argIdx++
	}

	where := strings.Join(conditions, " AND ")

	// Build ORDER BY clause from allowlisted columns.
	instanceSortAllowlist := map[string]string{
		"started_at": "started_at",
		"updated_at": "updated_at",
		"status":     "status",
	}
	var orderBy string
	if col, ok := instanceSortAllowlist[sortBy]; ok {
		dir := "DESC"
		if sortOrder == "asc" {
			dir = "ASC"
		}
		orderBy = col + " " + dir
	} else {
		orderBy = "started_at DESC"
	}

	// Count and page under ONE tenant-scoped transaction (SET LOCAL
	// app.current_tenant_id) so RLS filters both queries consistently.
	tx, err := beginScoped(ctx, r.pool, tenantID)
	if err != nil {
		return nil, 0, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM workflow_instances WHERE %s", where)
	var total int
	if err := tx.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting workflow instances: %w", err)
	}

	if total == 0 {
		return []*model.WorkflowInstance{}, 0, nil
	}

	// Paginated data.
	dataQuery := fmt.Sprintf(`
		SELECT id, tenant_id, definition_id, definition_ver, status,
		       current_step_id, variables, step_outputs, trigger_data,
		       error_message, started_by, started_at, completed_at,
		       updated_at, lock_version, parent_instance_id, parent_step_id
		FROM workflow_instances
		WHERE %s
		ORDER BY %s
		LIMIT $%d OFFSET $%d`, where, orderBy, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := tx.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing workflow instances: %w", err)
	}
	instances, err := r.scanInstances(rows)
	rows.Close()
	if err != nil {
		return nil, 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, 0, fmt.Errorf("committing instance list: %w", err)
	}

	return instances, total, nil
}

// ListRunning returns all instances with status 'running', paginated. This is
// used during engine recovery to resume in-flight workflows.
func (r *InstanceRepository) ListRunning(ctx context.Context, limit, offset int) ([]*model.WorkflowInstance, error) {
	query := `
		SELECT id, tenant_id, definition_id, definition_ver, status,
		       current_step_id, variables, step_outputs, trigger_data,
		       error_message, started_by, started_at, completed_at,
		       updated_at, lock_version, parent_instance_id, parent_step_id
		FROM workflow_instances
		WHERE status = 'running'
		ORDER BY started_at ASC
		LIMIT $1 OFFSET $2`

	// Recovery/timer-recovery scan RUNNING instances ACROSS ALL TENANTS, so this
	// runs under the cross-tenant bypass scope (SET LOCAL app.bypass_rls = 'on').
	tx, err := beginScoped(ctx, r.pool, "")
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, query, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("listing running instances: %w", err)
	}
	instances, err := r.scanInstances(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("committing running-instance list: %w", err)
	}
	return instances, nil
}

// ---------------------------------------------------------------------------
// Step Execution operations
// ---------------------------------------------------------------------------

// CreateStepExecution inserts a step execution record. The generated ID and
// created_at are scanned back into the struct.
func (r *InstanceRepository) CreateStepExecution(ctx context.Context, exec *model.StepExecution) error {
	var inputData []byte
	if len(exec.InputData) > 0 {
		inputData = []byte(exec.InputData)
	}
	var outputData []byte
	if len(exec.OutputData) > 0 {
		outputData = []byte(exec.OutputData)
	}

	query := `
		INSERT INTO workflow_step_executions (
			instance_id, step_id, step_type, status,
			input_data, output_data, error_message, attempt,
			started_at, completed_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, created_at`

	// Engine-internal, post-authorization write; step-executions have no tenant_id
	// column and their RLS is keyed on the parent instance's tenant. This path runs
	// under the bypass scope, then the INSERT's parent-instance EXISTS check is
	// satisfied via the bypass backstop.
	tx, err := beginScoped(ctx, r.pool, "")
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := tx.QueryRow(ctx, query,
		exec.InstanceID,
		exec.StepID,
		exec.StepType,
		exec.Status,
		inputData,
		outputData,
		exec.ErrorMessage,
		exec.Attempt,
		exec.StartedAt,
		exec.CompletedAt,
	).Scan(&exec.ID, &exec.CreatedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpdateStepExecution updates a step execution's mutable fields: status,
// output_data, error_message, started_at, and completed_at.
func (r *InstanceRepository) UpdateStepExecution(ctx context.Context, exec *model.StepExecution) error {
	var outputData []byte
	if len(exec.OutputData) > 0 {
		outputData = []byte(exec.OutputData)
	}

	query := `
		UPDATE workflow_step_executions
		SET status = $2,
		    output_data = $3,
		    error_message = $4,
		    started_at = $5,
		    completed_at = $6
		WHERE id = $1`

	// Engine-internal update under the bypass scope (see CreateStepExecution).
	ct, err := rlsExec(ctx, r.pool, "", query,
		exec.ID,
		exec.Status,
		outputData,
		exec.ErrorMessage,
		exec.StartedAt,
		exec.CompletedAt,
	)
	if err != nil {
		return fmt.Errorf("updating step execution: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("step execution %s: %w", exec.ID, model.ErrNotFound)
	}
	return nil
}

// GetStepExecutions returns all step executions for an instance, ordered by
// created_at ascending so they appear in execution order.
func (r *InstanceRepository) GetStepExecutions(ctx context.Context, instanceID string) ([]*model.StepExecution, error) {
	query := `
		SELECT id, instance_id, step_id, step_type, status,
		       input_data, output_data, error_message, attempt,
		       started_at, completed_at, created_at
		FROM workflow_step_executions
		WHERE instance_id = $1
		ORDER BY created_at ASC`

	// Engine-internal read under the bypass scope (see CreateStepExecution).
	tx, err := beginScoped(ctx, r.pool, "")
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, query, instanceID)
	if err != nil {
		return nil, fmt.Errorf("getting step executions: %w", err)
	}
	execs, err := r.scanStepExecutions(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("committing step-executions read: %w", err)
	}
	return execs, nil
}

// GetLastFailedStep returns the most recent failed step execution for an
// instance, or nil if none exist.
func (r *InstanceRepository) GetLastFailedStep(ctx context.Context, instanceID string) (*model.StepExecution, error) {
	query := `
		SELECT id, instance_id, step_id, step_type, status,
		       input_data, output_data, error_message, attempt,
		       started_at, completed_at, created_at
		FROM workflow_step_executions
		WHERE instance_id = $1 AND status = 'failed'
		ORDER BY created_at DESC
		LIMIT 1`

	// Engine-internal read under the bypass scope (see CreateStepExecution). The
	// scopedPool reads the scope from the context, so a system-scoped context
	// drives the SET LOCAL app.bypass_rls = 'on'.
	sctx := WithSystemScope(ctx)
	exec, err := r.scanStepExecution(newScopedPool(r.pool).QueryRow(sctx, query, instanceID))
	if err != nil {
		// No failed step is a valid state, not an error.
		if isNotFound(err) {
			return nil, nil
		}
		return nil, err
	}
	return exec, nil
}

// CheckTriggerDedup checks whether an instance already exists for the given
// definition with matching trigger_data->>'event_id'. Returns true if a
// duplicate exists.
func (r *InstanceRepository) CheckTriggerDedup(ctx context.Context, definitionID, eventID string) (bool, error) {
	query := `
		SELECT EXISTS(
			SELECT 1 FROM workflow_instances
			WHERE definition_id = $1
			  AND trigger_data->>'event_id' = $2
		)`

	// Dedup is keyed on (definition, event) not tenant; runs under the bypass
	// scope so the check is not narrowed by an unset tenant context.
	sctx := WithSystemScope(ctx)
	var exists bool
	err := newScopedPool(r.pool).QueryRow(sctx, query, definitionID, eventID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("checking trigger dedup: %w", err)
	}
	return exists, nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// scanInstance scans a single pgx.Row into a WorkflowInstance, handling JSONB
// deserialization.
func (r *InstanceRepository) scanInstance(row pgx.Row) (*model.WorkflowInstance, error) {
	var (
		inst            model.WorkflowInstance
		variablesJSON   []byte
		stepOutputsJSON []byte
		triggerData     []byte
	)

	err := row.Scan(
		&inst.ID,
		&inst.TenantID,
		&inst.DefinitionID,
		&inst.DefinitionVer,
		&inst.Status,
		&inst.CurrentStepID,
		&variablesJSON,
		&stepOutputsJSON,
		&triggerData,
		&inst.ErrorMessage,
		&inst.StartedBy,
		&inst.StartedAt,
		&inst.CompletedAt,
		&inst.UpdatedAt,
		&inst.LockVersion,
		&inst.ParentInstanceID,
		&inst.ParentStepID,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("instance: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning workflow instance: %w", err)
	}

	if err := json.Unmarshal(variablesJSON, &inst.Variables); err != nil {
		return nil, fmt.Errorf("unmarshaling instance variables: %w", err)
	}
	if err := json.Unmarshal(stepOutputsJSON, &inst.StepOutputs); err != nil {
		return nil, fmt.Errorf("unmarshaling step_outputs: %w", err)
	}
	if triggerData != nil {
		inst.TriggerData = json.RawMessage(triggerData)
	}

	// Transparently decrypt any at-rest envelopes (no-op when no codec is wired /
	// no envelopes present). Fails closed on a corrupt envelope.
	if err := r.decryptInstancePayload(&inst); err != nil {
		return nil, err
	}

	return &inst, nil
}

// scanInstances iterates over pgx.Rows and returns a slice of instances.
func (r *InstanceRepository) scanInstances(rows pgx.Rows) ([]*model.WorkflowInstance, error) {
	var instances []*model.WorkflowInstance
	for rows.Next() {
		var (
			inst            model.WorkflowInstance
			variablesJSON   []byte
			stepOutputsJSON []byte
			triggerData     []byte
		)

		if err := rows.Scan(
			&inst.ID,
			&inst.TenantID,
			&inst.DefinitionID,
			&inst.DefinitionVer,
			&inst.Status,
			&inst.CurrentStepID,
			&variablesJSON,
			&stepOutputsJSON,
			&triggerData,
			&inst.ErrorMessage,
			&inst.StartedBy,
			&inst.StartedAt,
			&inst.CompletedAt,
			&inst.UpdatedAt,
			&inst.LockVersion,
			&inst.ParentInstanceID,
			&inst.ParentStepID,
		); err != nil {
			return nil, fmt.Errorf("scanning workflow instance row: %w", err)
		}

		if err := json.Unmarshal(variablesJSON, &inst.Variables); err != nil {
			return nil, fmt.Errorf("unmarshaling instance variables: %w", err)
		}
		if err := json.Unmarshal(stepOutputsJSON, &inst.StepOutputs); err != nil {
			return nil, fmt.Errorf("unmarshaling step_outputs: %w", err)
		}
		if triggerData != nil {
			inst.TriggerData = json.RawMessage(triggerData)
		}

		// Transparently decrypt any at-rest envelopes (no-op when no codec is
		// wired). Fails closed on a corrupt envelope.
		if err := r.decryptInstancePayload(&inst); err != nil {
			return nil, err
		}

		instances = append(instances, &inst)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating workflow instance rows: %w", err)
	}
	return instances, nil
}

// scanStepExecution scans a single pgx.Row into a StepExecution.
func (r *InstanceRepository) scanStepExecution(row pgx.Row) (*model.StepExecution, error) {
	var (
		exec      model.StepExecution
		inputData []byte
		outData   []byte
	)

	err := row.Scan(
		&exec.ID,
		&exec.InstanceID,
		&exec.StepID,
		&exec.StepType,
		&exec.Status,
		&inputData,
		&outData,
		&exec.ErrorMessage,
		&exec.Attempt,
		&exec.StartedAt,
		&exec.CompletedAt,
		&exec.CreatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("step execution: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning step execution: %w", err)
	}

	if inputData != nil {
		exec.InputData = json.RawMessage(inputData)
	}
	if outData != nil {
		exec.OutputData = json.RawMessage(outData)
	}

	return &exec, nil
}

// scanStepExecutions iterates over pgx.Rows and returns a slice of step executions.
func (r *InstanceRepository) scanStepExecutions(rows pgx.Rows) ([]*model.StepExecution, error) {
	var executions []*model.StepExecution
	for rows.Next() {
		var (
			exec      model.StepExecution
			inputData []byte
			outData   []byte
		)

		if err := rows.Scan(
			&exec.ID,
			&exec.InstanceID,
			&exec.StepID,
			&exec.StepType,
			&exec.Status,
			&inputData,
			&outData,
			&exec.ErrorMessage,
			&exec.Attempt,
			&exec.StartedAt,
			&exec.CompletedAt,
			&exec.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning step execution row: %w", err)
		}

		if inputData != nil {
			exec.InputData = json.RawMessage(inputData)
		}
		if outData != nil {
			exec.OutputData = json.RawMessage(outData)
		}

		executions = append(executions, &exec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating step execution rows: %w", err)
	}
	return executions, nil
}

// isNotFound returns true when the error wraps model.ErrNotFound.
func isNotFound(err error) bool {
	return err != nil && strings.Contains(err.Error(), model.ErrNotFound.Error())
}
