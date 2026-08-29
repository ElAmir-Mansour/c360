package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

type definitionDBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// DefinitionRepository handles all database operations for workflow definitions.
type DefinitionRepository struct {
	db definitionDBTX
}

// NewDefinitionRepository creates a new DefinitionRepository backed by the
// provided connection pool. The pool is wrapped in a scopedPool so every
// Exec/Query/QueryRow runs inside an RLS-scoped transaction (SET LOCAL
// app.current_tenant_id or app.bypass_rls) — the scope is carried on the context
// each method sets via WithTenantScope / WithSystemScope. Unit tests inject a raw
// pgxmock DBTX via the &DefinitionRepository{db: mock} literal and never hit the
// scopedPool, so their recorded expectations (bare Exec/Query/QueryRow) are
// unaffected.
func NewDefinitionRepository(pool *pgxpool.Pool) *DefinitionRepository {
	return &DefinitionRepository{db: newScopedPool(pool)}
}

// Create inserts a new workflow definition. JSONB fields (trigger_config,
// variables, steps) are marshaled to JSON before insertion. The generated ID
// and timestamps are scanned back into the struct.
func (r *DefinitionRepository) Create(ctx context.Context, def *model.WorkflowDefinition) error {
	triggerJSON, err := json.Marshal(def.TriggerConfig)
	if err != nil {
		return fmt.Errorf("marshaling trigger_config: %w", err)
	}
	variablesJSON, err := json.Marshal(def.Variables)
	if err != nil {
		return fmt.Errorf("marshaling variables: %w", err)
	}
	stepsJSON, err := json.Marshal(def.Steps)
	if err != nil {
		return fmt.Errorf("marshaling steps: %w", err)
	}

	query := `
		INSERT INTO workflow_definitions (
			tenant_id, name, description, category, version, status,
			definition_key, trigger_config, variables, steps, created_by, updated_by, published_at
		) VALUES ($1, $2, $3, $4, $5, $6, COALESCE(NULLIF($7, '')::uuid, gen_random_uuid()), $8, $9, $10, $11, $12, $13)
		RETURNING id, definition_key, created_at, updated_at`

	ctx = WithTenantScope(ctx, def.TenantID)
	err = r.db.QueryRow(ctx, query,
		def.TenantID,
		def.Name,
		def.Description,
		def.Category,
		def.Version,
		def.Status,
		def.DefinitionKey,
		triggerJSON,
		variablesJSON,
		stepsJSON,
		def.CreatedBy,
		nilIfEmpty(def.UpdatedBy),
		def.PublishedAt,
	).Scan(&def.ID, &def.DefinitionKey, &def.CreatedAt, &def.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("workflow definition %q version %d: %w", def.Name, def.Version, model.ErrConflict)
		}
		return err
	}
	return nil
}

// StampMarketplaceProvenance records the marketplace origin (item VERSION) on an
// already-created definition (Phase 5 marketplace provenance, migration 000016).
// It is a SEPARATE, additive write kept OUT of Create so the pinned Create
// insert (and its unit test) is unchanged: the marketplace install calls this
// after instantiating the definition. Nullable columns — a no-op stamp of empty
// values is harmless. Scoped by tenant under the RLS transaction.
func (r *DefinitionRepository) StampMarketplaceProvenance(ctx context.Context, tenantID, defID, marketplaceItemID, marketplaceItemVersion string) error {
	query := `
		UPDATE workflow_definitions
		SET marketplace_item_id = NULLIF($3, '')::uuid,
		    marketplace_item_version = NULLIF($4, ''),
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ctx = WithTenantScope(ctx, tenantID)
	if _, err := r.db.Exec(ctx, query, defID, tenantID, marketplaceItemID, marketplaceItemVersion); err != nil {
		return fmt.Errorf("stamping marketplace provenance on definition %s: %w", defID, err)
	}
	return nil
}

// GetByID retrieves a definition by ID and tenant. Returns a wrapped
// model.ErrNotFound if the row does not exist or has been soft-deleted.
func (r *DefinitionRepository) GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	query := `
		SELECT id, tenant_id, name, description, category, version, status,
		       definition_key, trigger_config, variables, steps,
		       created_by, updated_by, created_at, updated_at, published_at, deleted_at,
		       (SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id) AS instance_count
		FROM workflow_definitions
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ctx = WithTenantScope(ctx, tenantID)
	return r.scanDefinition(ctx, r.db.QueryRow(ctx, query, id, tenantID))
}

// GetActiveByID retrieves a definition only when its status is 'active' and it
// has not been soft-deleted.
func (r *DefinitionRepository) GetActiveByID(ctx context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	query := `
		SELECT id, tenant_id, name, description, category, version, status,
		       definition_key, trigger_config, variables, steps,
		       created_by, updated_by, created_at, updated_at, published_at, deleted_at,
		       (SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id) AS instance_count
		FROM workflow_definitions
		WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND deleted_at IS NULL`

	ctx = WithTenantScope(ctx, tenantID)
	return r.scanDefinition(ctx, r.db.QueryRow(ctx, query, id, tenantID))
}

// stageRankSQL is the SQL expression that ranks a definition's promotion stage
// for RUNTIME-ACTIVE selection: prod (3) > staging (2) > dev/anything (1). It is
// the exact mirror of model.StageRank so the repository ORDER BY and the service
// ambiguity check agree on the single winning version of a lineage. Kept as one
// constant so every deterministic selection query orders identically.
const stageRankSQL = `(CASE stage WHEN 'prod' THEN 3 WHEN 'staging' THEN 2 ELSE 1 END)`

// GetActiveByDefinitionKey retrieves the RUNTIME-SELECTED active definition for a
// stable lineage key. Previously this returned the highest-VERSION active row,
// which is UNDER-SPECIFIED once a lineage has more than one active version across
// stages: a staging-active v3 could shadow the prod-promoted v2 that running
// events should actually use. It now selects DETERMINISTICALLY the prod-promoted
// active version — highest stage rank (prod>staging>dev), tie-broken by version
// DESC — never by name. This is how a call-activity / multi_instance parent
// resolves its CHILD definition by definition_key, and how event/lineage starts
// pick the single canonical version. Returns model.ErrNotFound when no active
// version exists for the key.
func (r *DefinitionRepository) GetActiveByDefinitionKey(ctx context.Context, tenantID, definitionKey string) (*model.WorkflowDefinition, error) {
	def, err := r.GetRuntimeActiveByDefinitionKey(ctx, tenantID, definitionKey)
	if err != nil {
		return nil, err
	}
	return def, nil
}

// GetRuntimeActiveByDefinitionKey returns the single RUNTIME-SELECTED active
// version of a lineage (prod-promoted active, tie-break version DESC) AND scans
// its stage/immutable so the caller can reason about promotion. It fails closed
// on AMBIGUITY: if two active rows tie at the TOP on both stage rank AND version
// (a data-integrity violation the Activate/Promote cross-checks now prevent), it
// returns model.ErrConflict rather than silently picking one. Returns
// model.ErrNotFound when the lineage has no active version.
func (r *DefinitionRepository) GetRuntimeActiveByDefinitionKey(ctx context.Context, tenantID, definitionKey string) (*model.WorkflowDefinition, error) {
	query := `
		SELECT id, tenant_id, name, description, category, version, status,
		       definition_key, trigger_config, variables, steps,
		       created_by, updated_by, created_at, updated_at, published_at, deleted_at,
		       stage, immutable,
		       (SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id) AS instance_count
		FROM workflow_definitions
		WHERE tenant_id = $1 AND definition_key = $2 AND status = 'active' AND deleted_at IS NULL
		ORDER BY ` + stageRankSQL + ` DESC, version DESC
		LIMIT 2`

	ctx = WithTenantScope(ctx, tenantID)
	rows, err := r.db.Query(ctx, query, tenantID, definitionKey)
	if err != nil {
		return nil, fmt.Errorf("selecting runtime-active version for key %q: %w", definitionKey, err)
	}
	defs, err := r.scanRuntimeDefinitions(rows)
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(defs) == 0 {
		return nil, fmt.Errorf("no active version for definition key %q: %w", definitionKey, model.ErrNotFound)
	}
	// Fail closed on a genuine tie at the top (same stage rank AND version). The
	// LIMIT 2 lets us detect it cheaply without scanning the whole lineage.
	if len(defs) == 2 &&
		model.StageRank(defs[0].Stage) == model.StageRank(defs[1].Stage) &&
		defs[0].Version == defs[1].Version {
		return nil, fmt.Errorf("ambiguous runtime-active version for definition key %q (two active rows tie at stage %q version %d): %w",
			definitionKey, defs[0].Stage, defs[0].Version, model.ErrConflict)
	}
	return defs[0], nil
}

// GetByIDAndVersion retrieves a specific version of a definition.
func (r *DefinitionRepository) GetByIDAndVersion(ctx context.Context, tenantID, id string, version int) (*model.WorkflowDefinition, error) {
	query := `
		SELECT id, tenant_id, name, description, category, version, status,
		       definition_key, trigger_config, variables, steps,
		       created_by, updated_by, created_at, updated_at, published_at, deleted_at,
		       (SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id) AS instance_count
		FROM workflow_definitions
		WHERE id = $1 AND tenant_id = $2 AND version = $3 AND deleted_at IS NULL`

	ctx = WithTenantScope(ctx, tenantID)
	return r.scanDefinition(ctx, r.db.QueryRow(ctx, query, id, tenantID, version))
}

// validSortColumns defines the allowed sort columns to prevent SQL injection.
var validSortColumns = map[string]string{
	"name":           "name",
	"category":       "category",
	"status":         "status",
	"version":        "version",
	"created_at":     "created_at",
	"updated_at":     "updated_at",
	"published_at":   "published_at",
	"instance_count": "(SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id)",
}

// List returns paginated definitions filtered by tenant, optional status
// (comma-separated for multiple values), optional category, and optional
// name search (case-insensitive ILIKE). Supports sort column and direction.
// The second return value is the total count for pagination metadata.
func (r *DefinitionRepository) List(ctx context.Context, tenantID, status, nameFilter, category, sortBy, sortOrder string, limit, offset int) ([]*model.WorkflowDefinition, int, error) {
	ctx = WithTenantScope(ctx, tenantID)
	var conditions []string
	var args []any
	argIdx := 1

	conditions = append(conditions, fmt.Sprintf("tenant_id = $%d", argIdx))
	args = append(args, tenantID)
	argIdx++

	conditions = append(conditions, "deleted_at IS NULL")

	if status != "" {
		statuses := strings.Split(status, ",")
		if len(statuses) == 1 {
			conditions = append(conditions, fmt.Sprintf("status = $%d", argIdx))
			args = append(args, strings.TrimSpace(statuses[0]))
			argIdx++
		} else {
			placeholders := make([]string, len(statuses))
			for i, s := range statuses {
				placeholders[i] = fmt.Sprintf("$%d", argIdx)
				args = append(args, strings.TrimSpace(s))
				argIdx++
			}
			conditions = append(conditions, fmt.Sprintf("status IN (%s)", strings.Join(placeholders, ",")))
		}
	}
	if category != "" {
		categories := strings.Split(category, ",")
		if len(categories) == 1 {
			conditions = append(conditions, fmt.Sprintf("category = $%d", argIdx))
			args = append(args, strings.TrimSpace(categories[0]))
			argIdx++
		} else {
			placeholders := make([]string, len(categories))
			for i, c := range categories {
				placeholders[i] = fmt.Sprintf("$%d", argIdx)
				args = append(args, strings.TrimSpace(c))
				argIdx++
			}
			conditions = append(conditions, fmt.Sprintf("category IN (%s)", strings.Join(placeholders, ",")))
		}
	}
	if nameFilter != "" {
		conditions = append(conditions, fmt.Sprintf("name ILIKE $%d", argIdx))
		args = append(args, "%"+nameFilter+"%")
		argIdx++
	}

	where := strings.Join(conditions, " AND ")

	// Total count with the same filters.
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM workflow_definitions WHERE %s", where)
	var total int
	if err := r.db.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting workflow definitions: %w", err)
	}

	if total == 0 {
		return []*model.WorkflowDefinition{}, 0, nil
	}

	// Resolve sort column with whitelist; default to updated_at DESC.
	orderCol := "updated_at"
	if col, ok := validSortColumns[sortBy]; ok {
		orderCol = col
	}
	orderDir := "DESC"
	if strings.EqualFold(sortOrder, "asc") {
		orderDir = "ASC"
	}

	// Paginated data query.
	dataQuery := fmt.Sprintf(`
		SELECT id, tenant_id, name, description, category, version, status,
		       definition_key, trigger_config, variables, steps,
		       created_by, updated_by, created_at, updated_at, published_at, deleted_at,
		       (SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id) AS instance_count
		FROM workflow_definitions
		WHERE %s
		ORDER BY %s %s
		LIMIT $%d OFFSET $%d`, where, orderCol, orderDir, argIdx, argIdx+1)
	args = append(args, limit, offset)

	rows, err := r.db.Query(ctx, dataQuery, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing workflow definitions: %w", err)
	}
	defer rows.Close()

	defs, err := r.scanDefinitions(rows)
	if err != nil {
		return nil, 0, err
	}

	return defs, total, nil
}

// ListVersions returns all versions of definitions that share the same base
// definition ID, ordered by version descending.
func (r *DefinitionRepository) ListVersions(ctx context.Context, tenantID, id string) ([]*model.WorkflowDefinition, error) {
	ctx = WithTenantScope(ctx, tenantID)
	// First look up the stable lineage key for this definition ID so version
	// history survives future display-name edits.
	var definitionKey string
	err := r.db.QueryRow(ctx,
		`SELECT definition_key FROM workflow_definitions WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
		id, tenantID,
	).Scan(&definitionKey)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("definition %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("looking up definition key: %w", err)
	}

	query := `
		SELECT id, tenant_id, name, description, category, version, status,
		       definition_key, trigger_config, variables, steps,
		       created_by, updated_by, created_at, updated_at, published_at, deleted_at,
		       (SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id) AS instance_count
		FROM workflow_definitions
		WHERE tenant_id = $1 AND definition_key = $2 AND deleted_at IS NULL
		ORDER BY version DESC`

	rows, err := r.db.Query(ctx, query, tenantID, definitionKey)
	if err != nil {
		return nil, fmt.Errorf("listing definition versions: %w", err)
	}
	defer rows.Close()

	return r.scanDefinitions(rows)
}

// Update updates a definition's mutable fields: description, status, trigger
// config, variables, steps, and updated_by. The ID and tenant_id are used in
// the WHERE clause. Returns model.ErrNotFound when no matching row exists.
func (r *DefinitionRepository) Update(ctx context.Context, def *model.WorkflowDefinition) error {
	triggerJSON, err := json.Marshal(def.TriggerConfig)
	if err != nil {
		return fmt.Errorf("marshaling trigger_config: %w", err)
	}
	variablesJSON, err := json.Marshal(def.Variables)
	if err != nil {
		return fmt.Errorf("marshaling variables: %w", err)
	}
	stepsJSON, err := json.Marshal(def.Steps)
	if err != nil {
		return fmt.Errorf("marshaling steps: %w", err)
	}

	query := `
		UPDATE workflow_definitions
		SET description = $3,
		    category = $4,
		    status = $5,
		    trigger_config = $6,
		    variables = $7,
		    steps = $8,
		    updated_by = $9,
		    published_at = $10,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ctx = WithTenantScope(ctx, def.TenantID)
	ct, err := r.db.Exec(ctx, query,
		def.ID,
		def.TenantID,
		def.Description,
		def.Category,
		def.Status,
		triggerJSON,
		variablesJSON,
		stepsJSON,
		nilIfEmpty(def.UpdatedBy),
		def.PublishedAt,
	)
	if err != nil {
		return fmt.Errorf("updating workflow definition: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("definition %s: %w", def.ID, model.ErrNotFound)
	}
	return nil
}

// SoftDelete sets deleted_at on a definition. Returns model.ErrNotFound if the
// definition does not exist or is already deleted.
func (r *DefinitionRepository) SoftDelete(ctx context.Context, tenantID, id string) error {
	query := `
		UPDATE workflow_definitions
		SET deleted_at = now(), updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ctx = WithTenantScope(ctx, tenantID)
	ct, err := r.db.Exec(ctx, query, id, tenantID)
	if err != nil {
		return fmt.Errorf("soft-deleting workflow definition: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("definition %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// GetMaxVersion returns the highest version number for a definition lineage key
// within a tenant. Returns 0 if no versions exist.
func (r *DefinitionRepository) GetMaxVersion(ctx context.Context, tenantID, definitionKey string) (int, error) {
	query := `
		SELECT COALESCE(MAX(version), 0)
		FROM workflow_definitions
		WHERE tenant_id = $1 AND definition_key = $2 AND deleted_at IS NULL`

	ctx = WithTenantScope(ctx, tenantID)
	var maxVer int
	err := r.db.QueryRow(ctx, query, tenantID, definitionKey).Scan(&maxVer)
	if err != nil {
		return 0, fmt.Errorf("getting max version for %q: %w", definitionKey, err)
	}
	return maxVer, nil
}

// GetActiveByTriggerTopic returns, for an event topic, exactly ONE active
// definition PER (tenant_id, definition_key) LINEAGE — the RUNTIME-SELECTED
// (prod-promoted) active version, tie-broken by version DESC, NEVER by name.
//
// Previously this returned EVERY active row matching the topic ordered by name,
// so a lineage that had more than one active version (e.g. a staging-active v3
// alongside the prod-promoted v2) would fire the SAME logical workflow more than
// once for a single event — the exact under-specification this wave closes. The
// DISTINCT ON collapses each lineage to its single canonical version using the
// same stage-rank/version ordering as GetRuntimeActiveByDefinitionKey, so which
// version an event starts is now deterministic and unique.
func (r *DefinitionRepository) GetActiveByTriggerTopic(ctx context.Context, topic string) ([]*model.WorkflowDefinition, error) {
	// DISTINCT ON (tenant_id, definition_key) with the deterministic ORDER BY picks
	// the top-ranked active version of each lineage. The outer ORDER BY gives the
	// consumer a stable (tenant, key, version) iteration order — still never name.
	query := `
		SELECT id, tenant_id, name, description, category, version, status,
		       definition_key, trigger_config, variables, steps,
		       created_by, updated_by, created_at, updated_at, published_at, deleted_at,
		       stage, immutable,
		       (SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id) AS instance_count
		FROM (
		    SELECT DISTINCT ON (tenant_id, definition_key) *
		    FROM workflow_definitions
		    WHERE status = 'active'
		      AND deleted_at IS NULL
		      AND trigger_config->>'type' = 'event'
		      AND trigger_config->>'topic' = $1
		    ORDER BY tenant_id, definition_key, ` + stageRankSQL + ` DESC, version DESC
		) workflow_definitions
		ORDER BY tenant_id, definition_key, version DESC`

	// The event-trigger consumer matches active definitions ACROSS ALL TENANTS;
	// bypass scope.
	ctx = WithSystemScope(ctx)
	rows, err := r.db.Query(ctx, query, topic)
	if err != nil {
		return nil, fmt.Errorf("querying definitions by trigger topic: %w", err)
	}
	defer rows.Close()

	return r.scanRuntimeDefinitions(rows)
}

// ListActive returns every active, non-deleted workflow definition across all
// tenants. The parallel-gateway step lookup uses it to resolve the branch
// sub-step IDs declared inside a definition's parallel_gateway config. Steps
// are scoped to their own definition, so callers index by (tenant, definition)
// or rely on the engine only ever executing a gateway from within its owning
// definition.
func (r *DefinitionRepository) ListActive(ctx context.Context) ([]*model.WorkflowDefinition, error) {
	query := `
		SELECT id, tenant_id, name, description, category, version, status,
		       definition_key, trigger_config, variables, steps,
		       created_by, updated_by, created_at, updated_at, published_at, deleted_at,
		       (SELECT COUNT(*) FROM workflow_instances WHERE definition_id = workflow_definitions.id) AS instance_count
		FROM workflow_definitions
		WHERE status = 'active'
		  AND deleted_at IS NULL
		ORDER BY tenant_id, name, version`

	// Cross-tenant scan (cron trigger scheduler / parallel-gateway lookup); bypass.
	ctx = WithSystemScope(ctx)
	rows, err := r.db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("listing active workflow definitions: %w", err)
	}
	defer rows.Close()

	return r.scanDefinitions(rows)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// scanDefinition scans a single pgx.Row into a WorkflowDefinition, handling
// JSONB deserialization of trigger_config, variables, and steps.
func (r *DefinitionRepository) scanDefinition(_ context.Context, row pgx.Row) (*model.WorkflowDefinition, error) {
	var (
		def               model.WorkflowDefinition
		triggerJSON       []byte
		variablesJSON     []byte
		stepsJSON         []byte
		updatedByNullable *string
	)

	err := row.Scan(
		&def.ID,
		&def.TenantID,
		&def.Name,
		&def.Description,
		&def.Category,
		&def.Version,
		&def.Status,
		&def.DefinitionKey,
		&triggerJSON,
		&variablesJSON,
		&stepsJSON,
		&def.CreatedBy,
		&updatedByNullable,
		&def.CreatedAt,
		&def.UpdatedAt,
		&def.PublishedAt,
		&def.DeletedAt,
		&def.InstanceCount,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("definition: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning workflow definition: %w", err)
	}

	if updatedByNullable != nil {
		def.UpdatedBy = *updatedByNullable
	}

	if err := json.Unmarshal(triggerJSON, &def.TriggerConfig); err != nil {
		return nil, fmt.Errorf("unmarshaling trigger_config: %w", err)
	}
	if err := json.Unmarshal(variablesJSON, &def.Variables); err != nil {
		return nil, fmt.Errorf("unmarshaling variables: %w", err)
	}
	if err := json.Unmarshal(stepsJSON, &def.Steps); err != nil {
		return nil, fmt.Errorf("unmarshaling steps: %w", err)
	}

	return &def, nil
}

// scanDefinitions iterates over pgx.Rows and returns a slice of definitions.
func (r *DefinitionRepository) scanDefinitions(rows pgx.Rows) ([]*model.WorkflowDefinition, error) {
	var defs []*model.WorkflowDefinition
	for rows.Next() {
		var (
			def               model.WorkflowDefinition
			triggerJSON       []byte
			variablesJSON     []byte
			stepsJSON         []byte
			updatedByNullable *string
		)

		if err := rows.Scan(
			&def.ID,
			&def.TenantID,
			&def.Name,
			&def.Description,
			&def.Category,
			&def.Version,
			&def.Status,
			&def.DefinitionKey,
			&triggerJSON,
			&variablesJSON,
			&stepsJSON,
			&def.CreatedBy,
			&updatedByNullable,
			&def.CreatedAt,
			&def.UpdatedAt,
			&def.PublishedAt,
			&def.DeletedAt,
			&def.InstanceCount,
		); err != nil {
			return nil, fmt.Errorf("scanning workflow definition row: %w", err)
		}

		if updatedByNullable != nil {
			def.UpdatedBy = *updatedByNullable
		}

		if err := json.Unmarshal(triggerJSON, &def.TriggerConfig); err != nil {
			return nil, fmt.Errorf("unmarshaling trigger_config: %w", err)
		}
		if err := json.Unmarshal(variablesJSON, &def.Variables); err != nil {
			return nil, fmt.Errorf("unmarshaling variables: %w", err)
		}
		if err := json.Unmarshal(stepsJSON, &def.Steps); err != nil {
			return nil, fmt.Errorf("unmarshaling steps: %w", err)
		}

		defs = append(defs, &def)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating workflow definition rows: %w", err)
	}
	return defs, nil
}

// scanRuntimeDefinitions iterates rows produced by the RUNTIME-ACTIVE selection
// queries, which additionally project stage + immutable so the caller can reason
// about promotion. It is a distinct scanner (not scanDefinitions) precisely so the
// legacy scan column list — pinned by the existing repository unit tests — stays
// byte-for-byte unchanged; only the stage-aware queries opt into the two extra
// columns.
func (r *DefinitionRepository) scanRuntimeDefinitions(rows pgx.Rows) ([]*model.WorkflowDefinition, error) {
	var defs []*model.WorkflowDefinition
	for rows.Next() {
		var (
			def               model.WorkflowDefinition
			triggerJSON       []byte
			variablesJSON     []byte
			stepsJSON         []byte
			updatedByNullable *string
		)

		if err := rows.Scan(
			&def.ID,
			&def.TenantID,
			&def.Name,
			&def.Description,
			&def.Category,
			&def.Version,
			&def.Status,
			&def.DefinitionKey,
			&triggerJSON,
			&variablesJSON,
			&stepsJSON,
			&def.CreatedBy,
			&updatedByNullable,
			&def.CreatedAt,
			&def.UpdatedAt,
			&def.PublishedAt,
			&def.DeletedAt,
			&def.Stage,
			&def.Immutable,
			&def.InstanceCount,
		); err != nil {
			return nil, fmt.Errorf("scanning runtime-active definition row: %w", err)
		}

		if updatedByNullable != nil {
			def.UpdatedBy = *updatedByNullable
		}

		if err := json.Unmarshal(triggerJSON, &def.TriggerConfig); err != nil {
			return nil, fmt.Errorf("unmarshaling trigger_config: %w", err)
		}
		if err := json.Unmarshal(variablesJSON, &def.Variables); err != nil {
			return nil, fmt.Errorf("unmarshaling variables: %w", err)
		}
		if err := json.Unmarshal(stepsJSON, &def.Steps); err != nil {
			return nil, fmt.Errorf("unmarshaling steps: %w", err)
		}

		defs = append(defs, &def)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating runtime-active definition rows: %w", err)
	}
	return defs, nil
}

// nilIfEmpty returns nil when s is empty; otherwise returns a pointer to s.
// Used to store optional UUID fields as NULL rather than empty strings.
func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
