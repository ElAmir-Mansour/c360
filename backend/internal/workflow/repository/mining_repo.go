package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// WorkflowMiningRepository is a READ-ONLY process-MINING read model layered on
// the SAME already-persisted event trail the WorkflowAnalyticsRepository uses
// (workflow_instances + workflow_step_executions) plus the model step graph
// (workflow_definitions.steps). It performs NO writes and never touches engine
// state. Every query is tenant-scoped through the scopedPool (RLS) — a raw-pool
// call would see ZERO rows under the 000008 FORCE-RLS policies.
//
// It mirrors WorkflowAnalyticsRepository's construction/seam pattern exactly:
// NewWorkflowMiningRepository(pool) wraps the pool in a scopedPool so each read
// runs inside a SET LOCAL app.current_tenant_id transaction (scope carried on the
// context via WithTenantScope), while the unexported *WithDB seam lets unit tests
// inject a pgxmock pool (wrapped in a scopedPool) and pin the
// Begin -> set_config -> SELECT -> Commit sequence.
type WorkflowMiningRepository struct {
	db analyticsDBTX
}

// NewWorkflowMiningRepository creates a repository backed by the provided pool,
// wrapping it in a scopedPool for RLS scoping. Mirrors
// NewWorkflowAnalyticsRepository.
func NewWorkflowMiningRepository(pool *pgxpool.Pool) *WorkflowMiningRepository {
	return &WorkflowMiningRepository{db: newScopedPool(pool)}
}

// newWorkflowMiningRepositoryWithDB is the unexported unit-test seam. Production
// always goes through NewWorkflowMiningRepository.
func newWorkflowMiningRepositoryWithDB(db analyticsDBTX) *WorkflowMiningRepository {
	return &WorkflowMiningRepository{db: db}
}

// InstancePath is one instance's reconstructed executed path: the ordered
// sequence of step_ids (start-time order within the instance), whether the
// instance completed, and its end-to-end cycle time in milliseconds (0 unless
// completed). It is the atom variant discovery groups over and the branch
// sampler weights the simulation by.
type InstancePath struct {
	InstanceID string
	Sequence   []string
	Completed  bool
	CycleMs    int64
}

// InstancePaths reconstructs the executed path of EACH instance of the given
// definition lineage over the last windowDays, as an ordered list of step_ids
// (ordered by started_at, then created_at, then id within the instance so the
// sequence is deterministic even when two steps share a start timestamp). It also
// returns each instance's terminal-completed flag and end-to-end cycle time (ms).
// This is the core process-mining primitive feeding variants, conformance, the
// heatmap edge counts, and the simulation branch weights. Runs tenant-scoped.
//
// Only step executions that actually STARTED (started_at IS NOT NULL) contribute
// to the path — a pending/never-run step execution row is not part of the
// executed trail.
func (r *WorkflowMiningRepository) InstancePaths(ctx context.Context, tenantID, definitionKey string, windowDays int) ([]InstancePath, error) {
	windowDays = clampWindowDays(windowDays)

	// array_agg over the started step executions ordered by (started_at,
	// created_at, id) gives the executed step_id sequence per instance in one row.
	// The instance's completed flag + cycle-time (ms) come from the instance row.
	// We include instances that have at least one started step in the window
	// (JOIN, not LEFT JOIN) — an instance with no started steps has no path to
	// mine.
	const query = `
		SELECT i.id::text                                                             AS instance_id,
		       (i.status = 'completed' AND i.completed_at IS NOT NULL)                AS completed,
		       CASE
		           WHEN i.status = 'completed' AND i.completed_at IS NOT NULL
		           THEN COALESCE(EXTRACT(EPOCH FROM (i.completed_at - i.started_at)) * 1000, 0)
		           ELSE 0
		       END::bigint                                                            AS cycle_ms,
		       array_agg(se.step_id ORDER BY se.started_at, se.created_at, se.id)     AS sequence
		FROM workflow_instances i
		JOIN workflow_definitions d ON d.id = i.definition_id
		JOIN workflow_step_executions se ON se.instance_id = i.id
		WHERE i.tenant_id = $1
		  AND d.definition_key = $2::uuid
		  AND se.started_at IS NOT NULL
		  AND i.started_at >= NOW() - ($3::int * INTERVAL '1 day')
		GROUP BY i.id, i.status, i.completed_at, i.started_at`

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := r.db.Query(sctx, query, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, fmt.Errorf("querying instance paths: %w", err)
	}
	defer rows.Close()

	var out []InstancePath
	for rows.Next() {
		var p InstancePath
		if err := rows.Scan(&p.InstanceID, &p.Completed, &p.CycleMs, &p.Sequence); err != nil {
			return nil, fmt.Errorf("scanning instance path row: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating instance path rows: %w", err)
	}
	return out, nil
}

// StepDurationSample is a single per-step duration observation in milliseconds.
// Multiple samples per step_id form the empirical distribution the simulation
// samples from and the heatmap medians are computed over.
type StepDurationSample struct {
	StepID     string
	StepType   string
	DurationMs int64
}

// StepDurationSamples returns EVERY completed step execution's duration (ms) for
// the definition lineage over windowDays, tagged with step_id + step_type. The
// service builds the per-step empirical distribution from these (for the
// Monte-Carlo simulation) and the per-step median (for the heatmap node tint).
// Runs tenant-scoped.
//
// The sample count is bounded by the window; the service additionally caps how
// many it retains per step so a pathological history cannot blow memory.
func (r *WorkflowMiningRepository) StepDurationSamples(ctx context.Context, tenantID, definitionKey string, windowDays int) ([]StepDurationSample, error) {
	windowDays = clampWindowDays(windowDays)

	const query = `
		SELECT se.step_id,
		       se.step_type,
		       (EXTRACT(EPOCH FROM (se.completed_at - se.started_at)) * 1000)::bigint AS duration_ms
		FROM workflow_step_executions se
		JOIN workflow_instances i ON i.id = se.instance_id
		JOIN workflow_definitions d ON d.id = i.definition_id
		WHERE i.tenant_id = $1
		  AND d.definition_key = $2::uuid
		  AND se.started_at IS NOT NULL
		  AND se.completed_at IS NOT NULL
		  AND se.completed_at >= se.started_at
		  AND i.started_at >= NOW() - ($3::int * INTERVAL '1 day')
		ORDER BY se.step_id, se.started_at`

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := r.db.Query(sctx, query, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, fmt.Errorf("querying step duration samples: %w", err)
	}
	defer rows.Close()

	var out []StepDurationSample
	for rows.Next() {
		var s StepDurationSample
		if err := rows.Scan(&s.StepID, &s.StepType, &s.DurationMs); err != nil {
			return nil, fmt.Errorf("scanning step duration sample: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating step duration samples: %w", err)
	}
	return out, nil
}

// DefinitionGraph is the MODEL step graph of the runtime-active version of a
// lineage: the declared step set (with types) and the allowed directed
// transitions between them. It is the reference model conformance checks the
// discovered variants against.
type DefinitionGraph struct {
	DefinitionKey string
	Name          string
	Version       int
	// Steps maps step_id -> step_type for every step the model declares.
	Steps map[string]string
	// StepOrder preserves the declaration order of the steps (for a stable
	// skipped-step report).
	StepOrder []string
	// AllowedTransitions is the set of directed hops (from -> {to...}) the model
	// permits.
	AllowedTransitions map[string]map[string]struct{}
}

// LoadDefinitionGraph loads the MODEL step graph for the runtime-active version
// of the lineage (prod-promoted active, tie-break version DESC — the same
// selection the engine runs), unmarshalling the steps JSONB into the declared
// step set + allowed-transition edges. Runs tenant-scoped. Returns
// model.ErrNotFound when the lineage has no active version.
func (r *WorkflowMiningRepository) LoadDefinitionGraph(ctx context.Context, tenantID, definitionKey string) (*DefinitionGraph, error) {
	// Select the single runtime-active version's step graph. We only need the
	// steps JSONB + name + version; the stage-rank ORDER BY mirrors the engine's
	// runtime-active selection so mining reasons about the SAME model the engine
	// executes. LIMIT 1 — mining is descriptive, so a benign tie just picks the
	// top-ranked (unlike the engine's fail-closed ambiguity guard).
	const query = `
		SELECT d.definition_key::text, d.name, d.version, d.steps
		FROM workflow_definitions d
		WHERE d.tenant_id = $1
		  AND d.definition_key = $2::uuid
		  AND d.status = 'active'
		  AND d.deleted_at IS NULL
		ORDER BY ` + stageRankSQL + ` DESC, d.version DESC
		LIMIT 1`

	sctx := WithTenantScope(ctx, tenantID)

	var (
		key       string
		name      string
		version   int
		stepsJSON []byte
	)
	if err := r.db.QueryRow(sctx, query, tenantID, definitionKey).Scan(&key, &name, &version, &stepsJSON); err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("no active version for definition key %q: %w", definitionKey, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading definition graph for key %q: %w", definitionKey, err)
	}

	var steps []model.StepDefinition
	if err := json.Unmarshal(stepsJSON, &steps); err != nil {
		return nil, fmt.Errorf("unmarshaling steps for key %q: %w", definitionKey, err)
	}

	g := &DefinitionGraph{
		DefinitionKey:      key,
		Name:               name,
		Version:            version,
		Steps:              make(map[string]string, len(steps)),
		StepOrder:          make([]string, 0, len(steps)),
		AllowedTransitions: make(map[string]map[string]struct{}, len(steps)),
	}
	for _, s := range steps {
		if _, seen := g.Steps[s.ID]; !seen {
			g.StepOrder = append(g.StepOrder, s.ID)
		}
		g.Steps[s.ID] = s.Type
		if _, ok := g.AllowedTransitions[s.ID]; !ok {
			g.AllowedTransitions[s.ID] = make(map[string]struct{})
		}
		for _, t := range s.Transitions {
			if t.Target == "" {
				continue
			}
			g.AllowedTransitions[s.ID][t.Target] = struct{}{}
		}
	}
	return g, nil
}
