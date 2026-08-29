package migrate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Store struct{}

func NewStore() *Store { return &Store{} }

type rowScanner interface {
	Scan(dest ...any) error
}

func nextReference(ctx context.Context, db DBTX, tenantID uuid.UUID, kind, prefix string, at time.Time) (string, error) {
	var ref string
	err := db.QueryRow(ctx, `
WITH next_ref AS (
    INSERT INTO migrate_reference_counter (tenant_id, ref_year, ref_kind, last_number)
    VALUES ($1, EXTRACT(YEAR FROM $2::timestamptz)::int, $3, 1)
    ON CONFLICT (tenant_id, ref_year, ref_kind)
    DO UPDATE SET last_number = migrate_reference_counter.last_number + 1,
                  updated_at = now()
    RETURNING ref_year, last_number
)
SELECT $4 || '-' || ref_year::text || '-' || lpad(last_number::text, 4, '0')
FROM next_ref`, tenantID, at, kind, prefix).Scan(&ref)
	if err != nil {
		return "", fmt.Errorf("migrate: next %s reference: %w", kind, err)
	}
	return ref, nil
}

const programColumns = `id, tenant_id, reference, name, description, owner, status, row_version, created_at, updated_at`

func scanProgram(row rowScanner) (*Program, error) {
	var p Program
	var status string
	if err := row.Scan(&p.ID, &p.TenantID, &p.Reference, &p.Name, &p.Description, &p.Owner, &status, &p.RowVersion, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	p.Status = ProgramStatus(status)
	return &p, nil
}

func (s *Store) CreateProgram(ctx context.Context, db DBTX, p *Program, at time.Time) error {
	ref, err := nextReference(ctx, db, p.TenantID, "program", "MIG", at)
	if err != nil {
		return err
	}
	created, err := scanProgram(db.QueryRow(ctx, `
INSERT INTO migrate_program (tenant_id, reference, name, description, owner, status)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING `+programColumns,
		p.TenantID, ref, p.Name, p.Description, p.Owner, p.Status))
	if err != nil {
		return fmt.Errorf("migrate: create program: %w", err)
	}
	*p = *created
	return nil
}

func (s *Store) GetProgram(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*Program, error) {
	p, err := scanProgram(db.QueryRow(ctx, `SELECT `+programColumns+` FROM migrate_program WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get program: %w", err)
	}
	return p, nil
}

func (s *Store) ListPrograms(ctx context.Context, db DBTX, tenantID uuid.UUID, status *ProgramStatus, limit, offset int) ([]Program, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	args := []any{tenantID}
	where := []string{"tenant_id = $1"}
	if status != nil {
		args = append(args, *status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	var total int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM migrate_program WHERE `+strings.Join(where, " AND "), args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("migrate: count programs: %w", err)
	}
	args = append(args, limit, offset)
	rows, err := db.Query(ctx, `SELECT `+programColumns+` FROM migrate_program WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY updated_at DESC, id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("migrate: list programs: %w", err)
	}
	defer rows.Close()
	var out []Program
	for rows.Next() {
		p, err := scanProgram(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *p)
	}
	return out, total, rows.Err()
}

const workloadColumns = `id, tenant_id, program_id, app_key, name, source_environment, target_cloud,
target_account, strategy, owner_name, owner_contact, tier, status, readiness_score,
estimated_effort_hours, dependencies, move_group_id, row_version, created_at, updated_at`

func scanWorkload(row rowScanner) (*Workload, error) {
	var w Workload
	var strategy, status string
	var depsJSON []byte
	if err := row.Scan(
		&w.ID, &w.TenantID, &w.ProgramID, &w.AppKey, &w.Name, &w.SourceEnv, &w.TargetCloud,
		&w.TargetAccount, &strategy, &w.OwnerName, &w.OwnerContact, &w.Tier, &status,
		&w.ReadinessScore, &w.EstimatedEffortHours, &depsJSON, &w.MoveGroupID, &w.RowVersion, &w.CreatedAt, &w.UpdatedAt,
	); err != nil {
		return nil, err
	}
	w.Strategy = MigrationStrategy(strategy)
	w.Status = WorkloadStatus(status)
	if len(depsJSON) > 0 {
		if err := json.Unmarshal(depsJSON, &w.Dependencies); err != nil {
			return nil, fmt.Errorf("migrate: decode workload dependencies: %w", err)
		}
	}
	if w.Dependencies == nil {
		w.Dependencies = []WorkloadDependency{}
	}
	return &w, nil
}

func (s *Store) UpsertWorkload(ctx context.Context, db DBTX, w *Workload) error {
	deps, err := json.Marshal(w.Dependencies)
	if err != nil {
		return fmt.Errorf("migrate: marshal dependencies: %w", err)
	}
	created, err := scanWorkload(db.QueryRow(ctx, `
INSERT INTO migrate_workload (
    tenant_id, program_id, app_key, name, source_environment, target_cloud, target_account,
    strategy, owner_name, owner_contact, tier, status, readiness_score, estimated_effort_hours, dependencies
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT (tenant_id, program_id, app_key)
DO UPDATE SET
    name = EXCLUDED.name,
    source_environment = EXCLUDED.source_environment,
    target_cloud = EXCLUDED.target_cloud,
    target_account = EXCLUDED.target_account,
    strategy = EXCLUDED.strategy,
    owner_name = EXCLUDED.owner_name,
    owner_contact = EXCLUDED.owner_contact,
    tier = EXCLUDED.tier,
    dependencies = EXCLUDED.dependencies,
    readiness_score = EXCLUDED.readiness_score,
    estimated_effort_hours = EXCLUDED.estimated_effort_hours,
    row_version = migrate_workload.row_version + 1,
    updated_at = now()
RETURNING `+workloadColumns,
		w.TenantID, w.ProgramID, w.AppKey, w.Name, w.SourceEnv, w.TargetCloud, w.TargetAccount,
		w.Strategy, w.OwnerName, w.OwnerContact, w.Tier, w.Status, w.ReadinessScore, w.EstimatedEffortHours, deps))
	if err != nil {
		return fmt.Errorf("migrate: upsert workload: %w", err)
	}
	*w = *created
	return nil
}

func (s *Store) GetWorkload(ctx context.Context, db DBTX, tenantID, programID uuid.UUID, appKey string) (*Workload, error) {
	w, err := scanWorkload(db.QueryRow(ctx, `SELECT `+workloadColumns+` FROM migrate_workload WHERE tenant_id = $1 AND program_id = $2 AND app_key = $3`, tenantID, programID, appKey))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get workload: %w", err)
	}
	return w, nil
}

func (s *Store) GetWorkloadByID(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*Workload, error) {
	w, err := scanWorkload(db.QueryRow(ctx, `SELECT `+workloadColumns+` FROM migrate_workload WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get workload by id: %w", err)
	}
	return w, nil
}

// ListWorkloadsForWave returns every workload assigned to any move group in the
// given wave, ordered deterministically. It is used to drive wave-level
// lifecycle transitions (cutover start/complete/rollback) across all member
// workloads.
func (s *Store) ListWorkloadsForWave(ctx context.Context, db DBTX, tenantID, waveID uuid.UUID) ([]Workload, error) {
	rows, err := db.Query(ctx, `
SELECT `+strings.ReplaceAll(workloadColumns, ", ", ", wl.")+`
FROM migrate_workload wl
JOIN migrate_wave_move_group wmg
  ON wmg.move_group_id = wl.move_group_id AND wmg.tenant_id = wl.tenant_id
WHERE wl.tenant_id = $1 AND wmg.wave_id = $2
ORDER BY wmg.sequence ASC, wl.app_key ASC`, tenantID, waveID)
	if err != nil {
		return nil, fmt.Errorf("migrate: list workloads for wave: %w", err)
	}
	defer rows.Close()
	var out []Workload
	for rows.Next() {
		w, err := scanWorkload(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (s *Store) ListWorkloads(ctx context.Context, db DBTX, tenantID, programID uuid.UUID, query string, status *WorkloadStatus, limit, offset int) ([]Workload, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	args := []any{tenantID, programID}
	where := []string{"tenant_id = $1", "program_id = $2"}
	if query != "" {
		args = append(args, "%"+strings.ToLower(query)+"%")
		where = append(where, fmt.Sprintf("(lower(app_key) LIKE $%d OR lower(name) LIKE $%d)", len(args), len(args)))
	}
	if status != nil {
		args = append(args, *status)
		where = append(where, fmt.Sprintf("status = $%d", len(args)))
	}
	var total int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM migrate_workload WHERE `+strings.Join(where, " AND "), args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("migrate: count workloads: %w", err)
	}
	args = append(args, limit, offset)
	rows, err := db.Query(ctx, `SELECT `+workloadColumns+` FROM migrate_workload WHERE `+strings.Join(where, " AND ")+fmt.Sprintf(` ORDER BY updated_at DESC, app_key ASC LIMIT $%d OFFSET $%d`, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, fmt.Errorf("migrate: list workloads: %w", err)
	}
	defer rows.Close()
	var out []Workload
	for rows.Next() {
		w, err := scanWorkload(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *w)
	}
	return out, total, rows.Err()
}

func (s *Store) TransitionWorkload(ctx context.Context, db DBTX, tenantID, id uuid.UUID, from, to WorkloadStatus, expectedVersion int) (*Workload, error) {
	w, err := scanWorkload(db.QueryRow(ctx, `
UPDATE migrate_workload
   SET status = $4, row_version = row_version + 1, updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND status = $3 AND row_version = $5
RETURNING `+workloadColumns, tenantID, id, from, to, expectedVersion))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("migrate: transition workload: %w", err)
	}
	return w, nil
}

const moveGroupColumns = `id, tenant_id, program_id, reference, name, description, constraints_text,
status, completeness_status, completeness_findings, submitted_by, submitted_at, approved_by,
approved_at, decision_rationale, dr_topology_group_id, row_version, created_at, updated_at`

func scanMoveGroup(row rowScanner) (*MoveGroup, error) {
	var m MoveGroup
	var status string
	var findings []byte
	if err := row.Scan(
		&m.ID, &m.TenantID, &m.ProgramID, &m.Reference, &m.Name, &m.Description, &m.Constraints,
		&status, &m.CompletenessStatus, &findings, &m.SubmittedBy, &m.SubmittedAt,
		&m.ApprovedBy, &m.ApprovedAt, &m.DecisionRationale, &m.DRTopologyGroupID, &m.RowVersion, &m.CreatedAt, &m.UpdatedAt,
	); err != nil {
		return nil, err
	}
	m.Status = MoveGroupStatus(status)
	if len(findings) > 0 {
		if err := json.Unmarshal(findings, &m.CompletenessFindings); err != nil {
			return nil, err
		}
	}
	if m.CompletenessFindings == nil {
		m.CompletenessFindings = []string{}
	}
	return &m, nil
}

// scanMoveGroupWithWaveLink scans a move group row joined to its
// migrate_wave_move_group link, returning the group plus the in-wave sequence
// and planned duration (in seconds) that drive critical-path ordering.
func scanMoveGroupWithWaveLink(row rowScanner) (*MoveGroup, int, int, error) {
	var m MoveGroup
	var status string
	var findings []byte
	var seq, planned int
	if err := row.Scan(
		&m.ID, &m.TenantID, &m.ProgramID, &m.Reference, &m.Name, &m.Description, &m.Constraints,
		&status, &m.CompletenessStatus, &findings, &m.SubmittedBy, &m.SubmittedAt,
		&m.ApprovedBy, &m.ApprovedAt, &m.DecisionRationale, &m.DRTopologyGroupID, &m.RowVersion, &m.CreatedAt, &m.UpdatedAt,
		&seq, &planned,
	); err != nil {
		return nil, 0, 0, err
	}
	m.Status = MoveGroupStatus(status)
	if len(findings) > 0 {
		if err := json.Unmarshal(findings, &m.CompletenessFindings); err != nil {
			return nil, 0, 0, err
		}
	}
	if m.CompletenessFindings == nil {
		m.CompletenessFindings = []string{}
	}
	return &m, seq, planned, nil
}

func (s *Store) CreateMoveGroup(ctx context.Context, db DBTX, m *MoveGroup, at time.Time) error {
	ref, err := nextReference(ctx, db, m.TenantID, "move_group", "MG", at)
	if err != nil {
		return err
	}
	created, err := scanMoveGroup(db.QueryRow(ctx, `
INSERT INTO migrate_move_group (tenant_id, program_id, reference, name, description, constraints_text, status)
VALUES ($1,$2,$3,$4,$5,$6,$7)
RETURNING `+moveGroupColumns,
		m.TenantID, m.ProgramID, ref, m.Name, m.Description, m.Constraints, m.Status))
	if err != nil {
		return fmt.Errorf("migrate: create move group: %w", err)
	}
	*m = *created
	return nil
}

func (s *Store) GetMoveGroup(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*MoveGroup, error) {
	m, err := scanMoveGroup(db.QueryRow(ctx, `SELECT `+moveGroupColumns+` FROM migrate_move_group WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get move group: %w", err)
	}
	workloads, _, err := s.ListWorkloadsForMoveGroup(ctx, db, tenantID, id, 500, 0)
	if err != nil {
		return nil, err
	}
	m.Workloads = workloads
	return m, nil
}

func (s *Store) ListMoveGroups(ctx context.Context, db DBTX, tenantID, programID uuid.UUID, limit, offset int) ([]MoveGroup, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var total int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM migrate_move_group WHERE tenant_id = $1 AND program_id = $2`, tenantID, programID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := db.Query(ctx, `SELECT `+moveGroupColumns+` FROM migrate_move_group WHERE tenant_id = $1 AND program_id = $2 ORDER BY created_at DESC LIMIT $3 OFFSET $4`, tenantID, programID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []MoveGroup
	for rows.Next() {
		m, err := scanMoveGroup(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *m)
	}
	return out, total, rows.Err()
}

func (s *Store) ListWorkloadsForMoveGroup(ctx context.Context, db DBTX, tenantID, moveGroupID uuid.UUID, limit, offset int) ([]Workload, int, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	var total int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM migrate_workload WHERE tenant_id = $1 AND move_group_id = $2`, tenantID, moveGroupID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := db.Query(ctx, `SELECT `+workloadColumns+` FROM migrate_workload WHERE tenant_id = $1 AND move_group_id = $2 ORDER BY app_key ASC LIMIT $3 OFFSET $4`, tenantID, moveGroupID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []Workload
	for rows.Next() {
		w, err := scanWorkload(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *w)
	}
	return out, total, rows.Err()
}

func (s *Store) AssignWorkloadsToMoveGroup(ctx context.Context, db DBTX, tenantID, programID, moveGroupID uuid.UUID, appKeys []string) error {
	if len(appKeys) == 0 {
		return nil
	}
	for _, appKey := range normalizeStrings(appKeys) {
		tag, err := db.Exec(ctx, `
UPDATE migrate_workload
   SET move_group_id = $4, row_version = row_version + 1, updated_at = now()
 WHERE tenant_id = $1 AND program_id = $2 AND app_key = $3`, tenantID, programID, appKey, moveGroupID)
		if err != nil {
			return fmt.Errorf("migrate: assign workload %s: %w", appKey, err)
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("workload %s: %w", appKey, ErrNotFound)
		}
	}
	return nil
}

func (s *Store) UpdateMoveGroupCompleteness(ctx context.Context, db DBTX, tenantID, id uuid.UUID, status MoveGroupStatus, completenessStatus string, findings []string, expectedVersion int) (*MoveGroup, error) {
	findingsJSON, err := json.Marshal(findings)
	if err != nil {
		return nil, err
	}
	m, err := scanMoveGroup(db.QueryRow(ctx, `
UPDATE migrate_move_group
   SET status = $3,
       completeness_status = $4,
       completeness_findings = $5,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND row_version = $6
RETURNING `+moveGroupColumns, tenantID, id, status, completenessStatus, findingsJSON, expectedVersion))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("migrate: update move group completeness: %w", err)
	}
	return m, nil
}

func (s *Store) SubmitMoveGroup(ctx context.Context, db DBTX, tenantID, id, actorID uuid.UUID, at time.Time, expectedVersion int) (*MoveGroup, error) {
	m, err := scanMoveGroup(db.QueryRow(ctx, `
UPDATE migrate_move_group
   SET status = 'approval_pending',
       submitted_by = $3,
       submitted_at = $4,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND status = 'ready' AND row_version = $5
RETURNING `+moveGroupColumns, tenantID, id, actorID, at, expectedVersion))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("migrate: submit move group: %w", err)
	}
	return m, nil
}

func (s *Store) DecideMoveGroup(ctx context.Context, db DBTX, tenantID, id, actorID uuid.UUID, approved bool, rationale string, at time.Time, expectedVersion int) (*MoveGroup, error) {
	status := MoveGroupApproved
	if !approved {
		status = MoveGroupRejected
	}
	m, err := scanMoveGroup(db.QueryRow(ctx, `
UPDATE migrate_move_group
   SET status = $3,
       approved_by = $4,
       approved_at = $5,
       decision_rationale = $6,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND status = 'approval_pending' AND row_version = $7
RETURNING `+moveGroupColumns, tenantID, id, status, actorID, at, rationale, expectedVersion))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("migrate: decide move group: %w", err)
	}
	return m, nil
}

const waveColumns = `id, tenant_id, program_id, reference, name, description, sequence, status,
parent_runbook_id, planned_duration_seconds, actual_duration_seconds, started_at, completed_at,
dr_runbook_id, dr_topology_group_id, runbook_generated_at,
row_version, created_at, updated_at`

func scanWave(row rowScanner) (*Wave, error) {
	var w Wave
	var status string
	if err := row.Scan(&w.ID, &w.TenantID, &w.ProgramID, &w.Reference, &w.Name, &w.Description,
		&w.Sequence, &status, &w.ParentRunbookID, &w.PlannedDurationSeconds,
		&w.ActualDurationSeconds, &w.StartedAt, &w.CompletedAt,
		&w.DRRunbookID, &w.DRTopologyGroupID, &w.RunbookGeneratedAt,
		&w.RowVersion, &w.CreatedAt, &w.UpdatedAt); err != nil {
		return nil, err
	}
	w.Status = WaveStatus(status)
	return &w, nil
}

func (s *Store) CreateWave(ctx context.Context, db DBTX, w *Wave, at time.Time) error {
	ref, err := nextReference(ctx, db, w.TenantID, "wave", "WAV", at)
	if err != nil {
		return err
	}
	created, err := scanWave(db.QueryRow(ctx, `
INSERT INTO migrate_wave (tenant_id, program_id, reference, name, description, sequence, status, parent_runbook_id, planned_duration_seconds)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING `+waveColumns, w.TenantID, w.ProgramID, ref, w.Name, w.Description, w.Sequence, w.Status, w.ParentRunbookID, w.PlannedDurationSeconds))
	if err != nil {
		return fmt.Errorf("migrate: create wave: %w", err)
	}
	*w = *created
	return nil
}

func (s *Store) GetWave(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*Wave, error) {
	w, err := scanWave(db.QueryRow(ctx, `SELECT `+waveColumns+` FROM migrate_wave WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("migrate: get wave: %w", err)
	}
	groups, _, err := s.ListMoveGroupsForWave(ctx, db, tenantID, id, 200, 0)
	if err != nil {
		return nil, err
	}
	w.MoveGroups = groups
	return w, nil
}

func (s *Store) ListWaves(ctx context.Context, db DBTX, tenantID, programID uuid.UUID, limit, offset int) ([]Wave, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var total int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM migrate_wave WHERE tenant_id = $1 AND program_id = $2`, tenantID, programID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := db.Query(ctx, `SELECT `+waveColumns+` FROM migrate_wave WHERE tenant_id = $1 AND program_id = $2 ORDER BY sequence ASC LIMIT $3 OFFSET $4`, tenantID, programID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []Wave
	for rows.Next() {
		w, err := scanWave(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *w)
	}
	return out, total, rows.Err()
}

func (s *Store) AssignMoveGroupsToWave(ctx context.Context, db DBTX, tenantID, waveID uuid.UUID, moveGroupIDs []uuid.UUID, plannedSeconds int) error {
	for i, groupID := range moveGroupIDs {
		if groupID == uuid.Nil {
			continue
		}
		_, err := db.Exec(ctx, `
INSERT INTO migrate_wave_move_group (tenant_id, wave_id, move_group_id, sequence, planned_duration_seconds)
VALUES ($1,$2,$3,$4,$5)
ON CONFLICT (wave_id, move_group_id)
DO UPDATE SET sequence = EXCLUDED.sequence, planned_duration_seconds = EXCLUDED.planned_duration_seconds`,
			tenantID, waveID, groupID, i+1, plannedSeconds)
		if err != nil {
			return fmt.Errorf("migrate: assign move group to wave: %w", err)
		}
	}
	return nil
}

func (s *Store) ListMoveGroupsForWave(ctx context.Context, db DBTX, tenantID, waveID uuid.UUID, limit, offset int) ([]MoveGroup, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var total int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM migrate_wave_move_group WHERE tenant_id = $1 AND wave_id = $2`, tenantID, waveID).Scan(&total); err != nil {
		return nil, 0, err
	}
	// Carry the in-wave sequence and planned duration alongside the group so
	// the critical-path computation has the operator-defined ordering. We scan
	// the move-group columns first, then the two wave-link columns.
	rows, err := db.Query(ctx, `
SELECT mg.`+strings.ReplaceAll(moveGroupColumns, ", ", ", mg.")+`, wmg.sequence, wmg.planned_duration_seconds
FROM migrate_wave_move_group wmg
JOIN migrate_move_group mg ON mg.id = wmg.move_group_id AND mg.tenant_id = wmg.tenant_id
WHERE wmg.tenant_id = $1 AND wmg.wave_id = $2
ORDER BY wmg.sequence ASC
LIMIT $3 OFFSET $4`, tenantID, waveID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []MoveGroup
	for rows.Next() {
		m, seq, planned, err := scanMoveGroupWithWaveLink(rows)
		if err != nil {
			return nil, 0, err
		}
		m.WaveSequence = seq
		m.WavePlannedSeconds = planned
		out = append(out, *m)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	// Populate each group's workloads so the critical path can weight nodes by
	// real per-workload duration and honor dependency edges. Done after the
	// rows iterator is exhausted to avoid nesting queries on the same conn.
	for i := range out {
		workloads, _, err := s.ListWorkloadsForMoveGroup(ctx, db, tenantID, out[i].ID, 500, 0)
		if err != nil {
			return nil, 0, err
		}
		out[i].Workloads = workloads
	}
	return out, total, nil
}

// HydrateWaves populates each wave's MoveGroups (with their in-wave sequence /
// planned duration and their member workloads) for a set of waves in a BOUNDED
// number of queries — one for the move-group links and one for the workloads —
// instead of the per-wave GetWave round-trip (the N+1 the command-center audit
// flagged). It mutates the passed waves in place. Waves with no move groups get an
// empty (non-nil) MoveGroups slice.
func (s *Store) HydrateWaves(ctx context.Context, db DBTX, tenantID uuid.UUID, waves []Wave) error {
	if len(waves) == 0 {
		return nil
	}
	waveIDs := make([]uuid.UUID, 0, len(waves))
	for i := range waves {
		waveIDs = append(waveIDs, waves[i].ID)
		waves[i].MoveGroups = []MoveGroup{}
	}

	// 1. Load every move group linked to any of these waves in ONE query, carrying
	// the wave id + in-wave sequence/planned duration so we can bucket by wave and
	// order deterministically.
	rows, err := db.Query(ctx, `
SELECT wmg.wave_id, mg.`+strings.ReplaceAll(moveGroupColumns, ", ", ", mg.")+`, wmg.sequence, wmg.planned_duration_seconds
FROM migrate_wave_move_group wmg
JOIN migrate_move_group mg ON mg.id = wmg.move_group_id AND mg.tenant_id = wmg.tenant_id
WHERE wmg.tenant_id = $1 AND wmg.wave_id = ANY($2)
ORDER BY wmg.wave_id, wmg.sequence ASC`, tenantID, waveIDs)
	if err != nil {
		return fmt.Errorf("migrate: hydrate waves move groups: %w", err)
	}
	defer rows.Close()

	groupsByWave := map[uuid.UUID][]MoveGroup{}
	groupIDs := make([]uuid.UUID, 0)
	groupIndex := map[uuid.UUID]*MoveGroup{} // move_group_id -> pointer into the slices for workload attach
	for rows.Next() {
		var waveID uuid.UUID
		m, seq, planned, scanErr := scanMoveGroupWithWaveLinkPrefixed(rows, &waveID)
		if scanErr != nil {
			return scanErr
		}
		m.WaveSequence = seq
		m.WavePlannedSeconds = planned
		m.Workloads = []Workload{}
		groupsByWave[waveID] = append(groupsByWave[waveID], *m)
		groupIDs = append(groupIDs, m.ID)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	// Attach the buckets to their waves, keeping a pointer to each stored group so
	// the workload pass can fill Workloads directly.
	waveByID := map[uuid.UUID]int{}
	for i := range waves {
		waveByID[waves[i].ID] = i
	}
	for waveID, groups := range groupsByWave {
		if idx, ok := waveByID[waveID]; ok {
			waves[idx].MoveGroups = groups
			for gi := range waves[idx].MoveGroups {
				groupIndex[waves[idx].MoveGroups[gi].ID] = &waves[idx].MoveGroups[gi]
			}
		}
	}

	if len(groupIDs) == 0 {
		return nil
	}

	// 2. Load every workload for all of those move groups in ONE query and bucket
	// them onto their group by move_group_id.
	wlRows, err := db.Query(ctx, `SELECT `+workloadColumns+`
FROM migrate_workload
WHERE tenant_id = $1 AND move_group_id = ANY($2)
ORDER BY move_group_id, app_key ASC`, tenantID, groupIDs)
	if err != nil {
		return fmt.Errorf("migrate: hydrate waves workloads: %w", err)
	}
	defer wlRows.Close()
	for wlRows.Next() {
		wl, scanErr := scanWorkload(wlRows)
		if scanErr != nil {
			return scanErr
		}
		if wl.MoveGroupID == nil {
			continue
		}
		if g := groupIndex[*wl.MoveGroupID]; g != nil {
			g.Workloads = append(g.Workloads, *wl)
		}
	}
	return wlRows.Err()
}

// scanMoveGroupWithWaveLinkPrefixed scans a move-group row prefixed by the wave id
// (the HydrateWaves batch query selects wmg.wave_id first). It reuses the same
// column set as scanMoveGroupWithWaveLink.
func scanMoveGroupWithWaveLinkPrefixed(row rowScanner, waveID *uuid.UUID) (*MoveGroup, int, int, error) {
	var m MoveGroup
	var status string
	var findings []byte
	var seq, planned int
	if err := row.Scan(
		waveID,
		&m.ID, &m.TenantID, &m.ProgramID, &m.Reference, &m.Name, &m.Description, &m.Constraints,
		&status, &m.CompletenessStatus, &findings, &m.SubmittedBy, &m.SubmittedAt,
		&m.ApprovedBy, &m.ApprovedAt, &m.DecisionRationale, &m.DRTopologyGroupID, &m.RowVersion, &m.CreatedAt, &m.UpdatedAt,
		&seq, &planned,
	); err != nil {
		return nil, 0, 0, err
	}
	m.Status = MoveGroupStatus(status)
	if len(findings) > 0 {
		if err := json.Unmarshal(findings, &m.CompletenessFindings); err != nil {
			return nil, 0, 0, err
		}
	}
	if m.CompletenessFindings == nil {
		m.CompletenessFindings = []string{}
	}
	return &m, seq, planned, nil
}

func (s *Store) UpdateWaveStatus(ctx context.Context, db DBTX, tenantID, id uuid.UUID, from, to WaveStatus, expectedVersion int, at time.Time) (*Wave, error) {
	w, err := scanWave(db.QueryRow(ctx, `
UPDATE migrate_wave
   SET status = $4,
       started_at = CASE WHEN $4 = 'in_progress' THEN COALESCE(started_at, $6) ELSE started_at END,
       completed_at = CASE WHEN $4 IN ('completed','rolled_back') THEN COALESCE(completed_at, $6) ELSE completed_at END,
       actual_duration_seconds = CASE
           WHEN $4 IN ('completed','rolled_back') AND started_at IS NOT NULL THEN EXTRACT(EPOCH FROM ($6 - started_at))::int
           ELSE actual_duration_seconds
       END,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND status = $3 AND row_version = $5
RETURNING `+waveColumns, tenantID, id, from, to, expectedVersion, at))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("migrate: update wave status: %w", err)
	}
	return w, nil
}

const windowColumns = `id, tenant_id, program_id, wave_id, reference, name, window_type, starts_at,
ends_at, constraints_text, decision, decided_by, decided_at, rationale, runbook_run_id,
dr_runbook_id, dr_run_id, run_started_at, run_started_by, row_version, created_at, updated_at`

func scanWindow(row rowScanner) (*CutoverWindow, error) {
	var w CutoverWindow
	var typ, decision string
	if err := row.Scan(&w.ID, &w.TenantID, &w.ProgramID, &w.WaveID, &w.Reference, &w.Name, &typ,
		&w.StartsAt, &w.EndsAt, &w.Constraints, &decision, &w.DecidedBy, &w.DecidedAt,
		&w.Rationale, &w.RunbookRunID, &w.DRRunbookID, &w.DRRunID, &w.RunStartedAt, &w.RunStartedBy,
		&w.RowVersion, &w.CreatedAt, &w.UpdatedAt); err != nil {
		return nil, err
	}
	w.WindowType = WindowType(typ)
	w.Decision = Decision(decision)
	return &w, nil
}

func (s *Store) CreateWindow(ctx context.Context, db DBTX, w *CutoverWindow, at time.Time) error {
	ref, err := nextReference(ctx, db, w.TenantID, "cutover", "CUT", at)
	if err != nil {
		return err
	}
	created, err := scanWindow(db.QueryRow(ctx, `
INSERT INTO migrate_cutover_window (tenant_id, program_id, wave_id, reference, name, window_type, starts_at, ends_at, constraints_text)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING `+windowColumns,
		w.TenantID, w.ProgramID, w.WaveID, ref, w.Name, w.WindowType, w.StartsAt, w.EndsAt, w.Constraints))
	if err != nil {
		return fmt.Errorf("migrate: create cutover window: %w", err)
	}
	*w = *created
	return nil
}

func (s *Store) GetWindow(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*CutoverWindow, error) {
	w, err := scanWindow(db.QueryRow(ctx, `SELECT `+windowColumns+` FROM migrate_cutover_window WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return w, nil
}

// GetWindowByDRRunID resolves the cutover window that a live DR cutover run
// belongs to (via its persisted dr_run_id). It is the seam the connector-
// invocation webhook uses to attribute a run-driven connector call to its window
// when the DR engine only gives it the run id (Wave 6, P10a).
func (s *Store) GetWindowByDRRunID(ctx context.Context, db DBTX, tenantID, drRunID uuid.UUID) (*CutoverWindow, error) {
	w, err := scanWindow(db.QueryRow(ctx, `SELECT `+windowColumns+` FROM migrate_cutover_window WHERE tenant_id = $1 AND dr_run_id = $2`, tenantID, drRunID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return w, nil
}

func (s *Store) ListWindows(ctx context.Context, db DBTX, tenantID, programID uuid.UUID, limit, offset int) ([]CutoverWindow, int, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	var total int
	if err := db.QueryRow(ctx, `SELECT count(*) FROM migrate_cutover_window WHERE tenant_id = $1 AND program_id = $2`, tenantID, programID).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := db.Query(ctx, `SELECT `+windowColumns+` FROM migrate_cutover_window WHERE tenant_id = $1 AND program_id = $2 ORDER BY starts_at ASC LIMIT $3 OFFSET $4`, tenantID, programID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	var out []CutoverWindow
	for rows.Next() {
		w, err := scanWindow(rows)
		if err != nil {
			return nil, 0, err
		}
		out = append(out, *w)
	}
	return out, total, rows.Err()
}

func (s *Store) WindowConflicts(ctx context.Context, db DBTX, tenantID, programID, excludeID uuid.UUID, startsAt, endsAt time.Time) ([]CutoverWindow, error) {
	rows, err := db.Query(ctx, `
SELECT `+windowColumns+`
FROM migrate_cutover_window
WHERE tenant_id = $1
  AND program_id = $2
  AND ($3::uuid = '00000000-0000-0000-0000-000000000000'::uuid OR id <> $3)
  AND tstzrange(starts_at, ends_at, '[)') && tstzrange($4, $5, '[)')
ORDER BY starts_at ASC`, tenantID, programID, excludeID, startsAt, endsAt)
	if err != nil {
		return nil, fmt.Errorf("migrate: check window conflicts: %w", err)
	}
	defer rows.Close()
	var out []CutoverWindow
	for rows.Next() {
		w, err := scanWindow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (s *Store) DecideWindow(ctx context.Context, db DBTX, tenantID, id, actorID uuid.UUID, decision Decision, rationale string, at time.Time, expectedVersion int) (*CutoverWindow, error) {
	w, err := scanWindow(db.QueryRow(ctx, `
UPDATE migrate_cutover_window
   SET decision = $3, decided_by = $4, decided_at = $5, rationale = $6,
       row_version = row_version + 1, updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND row_version = $7
RETURNING `+windowColumns, tenantID, id, decision, actorID, at, rationale, expectedVersion))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, err
	}
	return w, nil
}

const rollbackColumns = `id, tenant_id, program_id, window_id, strategy, procedures, success_criteria,
runbook_id, decision, decided_by, decided_at, rationale, row_version, created_at, updated_at`

func scanRollbackPlan(row rowScanner) (*RollbackPlan, error) {
	var p RollbackPlan
	var decision string
	if err := row.Scan(&p.ID, &p.TenantID, &p.ProgramID, &p.WindowID, &p.Strategy, &p.Procedures,
		&p.SuccessCriteria, &p.RunbookID, &decision, &p.DecidedBy, &p.DecidedAt, &p.Rationale,
		&p.RowVersion, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	p.Decision = Decision(decision)
	return &p, nil
}

func (s *Store) UpsertRollbackPlan(ctx context.Context, db DBTX, p *RollbackPlan) error {
	created, err := scanRollbackPlan(db.QueryRow(ctx, `
INSERT INTO migrate_rollback_plan (tenant_id, program_id, window_id, strategy, procedures, success_criteria, runbook_id)
VALUES ($1,$2,$3,$4,$5,$6,$7)
ON CONFLICT (tenant_id, window_id)
DO UPDATE SET strategy = EXCLUDED.strategy,
              procedures = EXCLUDED.procedures,
              success_criteria = EXCLUDED.success_criteria,
              runbook_id = EXCLUDED.runbook_id,
              decision = 'pending',
              row_version = migrate_rollback_plan.row_version + 1,
              updated_at = now()
RETURNING `+rollbackColumns,
		p.TenantID, p.ProgramID, p.WindowID, p.Strategy, p.Procedures, p.SuccessCriteria, p.RunbookID))
	if err != nil {
		return fmt.Errorf("migrate: upsert rollback plan: %w", err)
	}
	*p = *created
	return nil
}

func (s *Store) GetRollbackPlanForWindow(ctx context.Context, db DBTX, tenantID, windowID uuid.UUID) (*RollbackPlan, error) {
	p, err := scanRollbackPlan(db.QueryRow(ctx, `SELECT `+rollbackColumns+` FROM migrate_rollback_plan WHERE tenant_id = $1 AND window_id = $2`, tenantID, windowID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return p, nil
}

func (s *Store) DecideRollbackPlan(ctx context.Context, db DBTX, tenantID, id, actorID uuid.UUID, decision Decision, rationale string, at time.Time, expectedVersion int) (*RollbackPlan, error) {
	p, err := scanRollbackPlan(db.QueryRow(ctx, `
UPDATE migrate_rollback_plan
   SET decision = $3, decided_by = $4, decided_at = $5, rationale = $6,
       row_version = row_version + 1, updated_at = now()
 WHERE tenant_id = $1 AND id = $2 AND row_version = $7
RETURNING `+rollbackColumns, tenantID, id, decision, actorID, at, rationale, expectedVersion))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, err
	}
	return p, nil
}

const gateColumns = `id, tenant_id, program_id, window_id, kind, name, check_type, status,
evidence, result, required, recorded_by, recorded_at, created_at, updated_at`

func scanGateCheck(row rowScanner) (*GateCheck, error) {
	var c GateCheck
	var kind, status string
	if err := row.Scan(&c.ID, &c.TenantID, &c.ProgramID, &c.WindowID, &kind, &c.Name, &c.CheckType,
		&status, &c.Evidence, &c.Result, &c.Required, &c.RecordedBy, &c.RecordedAt, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	c.Kind = CheckKind(kind)
	c.Status = CheckStatus(status)
	return &c, nil
}

func (s *Store) CreateGateCheck(ctx context.Context, db DBTX, c *GateCheck) error {
	created, err := scanGateCheck(db.QueryRow(ctx, `
INSERT INTO migrate_gate_check (tenant_id, program_id, window_id, kind, name, check_type, required)
VALUES ($1,$2,$3,$4,$5,$6,$7)
RETURNING `+gateColumns, c.TenantID, c.ProgramID, c.WindowID, c.Kind, c.Name, c.CheckType, c.Required))
	if err != nil {
		return fmt.Errorf("migrate: create gate check: %w", err)
	}
	*c = *created
	return nil
}

func (s *Store) ListGateChecks(ctx context.Context, db DBTX, tenantID, windowID uuid.UUID, kind *CheckKind) ([]GateCheck, error) {
	args := []any{tenantID, windowID}
	where := []string{"tenant_id = $1", "window_id = $2"}
	if kind != nil {
		args = append(args, *kind)
		where = append(where, fmt.Sprintf("kind = $%d", len(args)))
	}
	rows, err := db.Query(ctx, `SELECT `+gateColumns+` FROM migrate_gate_check WHERE `+strings.Join(where, " AND ")+` ORDER BY created_at ASC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []GateCheck
	for rows.Next() {
		c, err := scanGateCheck(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// ListReadinessBlockersForProgram returns, in ONE query, every REQUIRED readiness
// gate check across all of a program's cutover windows that has NOT passed (status
// not passed/overridden) — the set of open cutover blockers. It replaces the
// per-window ListGateChecks loop the command center used (an N+1 over windows).
func (s *Store) ListReadinessBlockersForProgram(ctx context.Context, db DBTX, tenantID, programID uuid.UUID) ([]GateCheck, error) {
	rows, err := db.Query(ctx, `SELECT `+gateColumns+`
FROM migrate_gate_check
WHERE tenant_id = $1
  AND program_id = $2
  AND kind = $3
  AND required = true
  AND status NOT IN ('passed','overridden')
ORDER BY window_id, created_at ASC`, tenantID, programID, CheckReadiness)
	if err != nil {
		return nil, fmt.Errorf("migrate: list readiness blockers: %w", err)
	}
	defer rows.Close()
	var out []GateCheck
	for rows.Next() {
		c, err := scanGateCheck(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// WaveRunStatuses returns, in ONE query, the live cutover-run status per wave for a
// program: the wave id mapped to the DR run status recorded on the runbook binding
// of the wave's most-recently-started window run. Waves with no started run are
// absent from the map. It lets the command center / exec summary show the current
// run status without a per-wave round-trip.
func (s *Store) WaveRunStatuses(ctx context.Context, db DBTX, tenantID, programID uuid.UUID) (map[uuid.UUID]WaveRunSnapshot, error) {
	rows, err := db.Query(ctx, `
SELECT DISTINCT ON (cw.wave_id)
       cw.wave_id, rb.status, cw.run_started_at
FROM migrate_cutover_window cw
JOIN migrate_runbook_binding rb
  ON rb.window_id = cw.id AND rb.tenant_id = cw.tenant_id
WHERE cw.tenant_id = $1
  AND cw.program_id = $2
  AND cw.run_started_at IS NOT NULL
  AND rb.role = 'parent'
  AND rb.status <> 'superseded'
ORDER BY cw.wave_id, cw.run_started_at DESC`, tenantID, programID)
	if err != nil {
		return nil, fmt.Errorf("migrate: wave run statuses: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]WaveRunSnapshot{}
	for rows.Next() {
		var waveID uuid.UUID
		var status string
		var startedAt *time.Time
		if err := rows.Scan(&waveID, &status, &startedAt); err != nil {
			return nil, err
		}
		out[waveID] = WaveRunSnapshot{Status: status, StartedAt: startedAt}
	}
	return out, rows.Err()
}

// WaveRunSnapshot is the per-wave live-run rollup used by the command center.
type WaveRunSnapshot struct {
	Status    string
	StartedAt *time.Time
}

func (s *Store) RecordGateCheck(ctx context.Context, db DBTX, tenantID, id, actorID uuid.UUID, status CheckStatus, evidence, result string, at time.Time) (*GateCheck, error) {
	c, err := scanGateCheck(db.QueryRow(ctx, `
UPDATE migrate_gate_check
   SET status = $3, evidence = $4, result = $5, recorded_by = $6, recorded_at = $7, updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING `+gateColumns, tenantID, id, status, evidence, result, actorID, at))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return c, nil
}

const connectorColumns = `id, tenant_id, name, provider, endpoint_url, auth_type, secret_ref,
enabled, created_by, created_at, updated_at`

func scanConnector(row rowScanner) (*ConnectorConfig, error) {
	var c ConnectorConfig
	if err := row.Scan(&c.ID, &c.TenantID, &c.Name, &c.Provider, &c.EndpointURL, &c.AuthType,
		&c.SecretRef, &c.Enabled, &c.CreatedBy, &c.CreatedAt, &c.UpdatedAt); err != nil {
		return nil, err
	}
	return &c, nil
}

func (s *Store) UpsertConnector(ctx context.Context, db DBTX, c *ConnectorConfig) error {
	created, err := scanConnector(db.QueryRow(ctx, `
INSERT INTO migrate_connector_config (tenant_id, name, provider, endpoint_url, auth_type, secret_ref, enabled, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT (tenant_id, name)
DO UPDATE SET provider = EXCLUDED.provider,
              endpoint_url = EXCLUDED.endpoint_url,
              auth_type = EXCLUDED.auth_type,
              secret_ref = EXCLUDED.secret_ref,
              enabled = EXCLUDED.enabled,
              updated_at = now()
RETURNING `+connectorColumns,
		c.TenantID, c.Name, c.Provider, c.EndpointURL, c.AuthType, c.SecretRef, c.Enabled, c.CreatedBy))
	if err != nil {
		return fmt.Errorf("migrate: upsert connector: %w", err)
	}
	*c = *created
	return nil
}

func (s *Store) GetConnector(ctx context.Context, db DBTX, tenantID, id uuid.UUID) (*ConnectorConfig, error) {
	c, err := scanConnector(db.QueryRow(ctx, `SELECT `+connectorColumns+` FROM migrate_connector_config WHERE tenant_id = $1 AND id = $2`, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return c, nil
}

func (s *Store) ListConnectors(ctx context.Context, db DBTX, tenantID uuid.UUID) ([]ConnectorConfig, error) {
	rows, err := db.Query(ctx, `SELECT `+connectorColumns+` FROM migrate_connector_config WHERE tenant_id = $1 ORDER BY name ASC`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ConnectorConfig
	for rows.Next() {
		c, err := scanConnector(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

const invocationColumns = `id, tenant_id, connector_id, window_id, idempotency_key, action,
request_body, status, http_status, response_body, error_message, source, dr_run_id, dr_task_id,
task_key, created_at, updated_at`

func scanInvocation(row rowScanner) (*ConnectorInvocation, error) {
	var inv ConnectorInvocation
	var request []byte
	var source string
	if err := row.Scan(&inv.ID, &inv.TenantID, &inv.ConnectorID, &inv.WindowID, &inv.IdempotencyKey,
		&inv.Action, &request, &inv.Status, &inv.HTTPStatus, &inv.ResponseBody, &inv.ErrorMessage,
		&source, &inv.DRRunID, &inv.DRTaskID, &inv.TaskKey, &inv.CreatedAt, &inv.UpdatedAt); err != nil {
		return nil, err
	}
	inv.Source = ConnectorInvocationSource(source)
	if len(request) > 0 {
		_ = json.Unmarshal(request, &inv.RequestBody)
	}
	return &inv, nil
}

func (s *Store) GetInvocationByKey(ctx context.Context, db DBTX, tenantID uuid.UUID, key string) (*ConnectorInvocation, error) {
	inv, err := scanInvocation(db.QueryRow(ctx, `SELECT `+invocationColumns+` FROM migrate_connector_invocation WHERE tenant_id = $1 AND idempotency_key = $2`, tenantID, key))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return inv, nil
}

func (s *Store) CreateInvocation(ctx context.Context, db DBTX, inv *ConnectorInvocation) error {
	body, err := json.Marshal(inv.RequestBody)
	if err != nil {
		return err
	}
	source := inv.Source
	if source == "" {
		source = ConnectorSourceManual
	}
	created, err := scanInvocation(db.QueryRow(ctx, `
INSERT INTO migrate_connector_invocation (tenant_id, connector_id, window_id, idempotency_key, action, request_body, status, source, dr_run_id, dr_task_id, task_key)
VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10)
RETURNING `+invocationColumns, inv.TenantID, inv.ConnectorID, inv.WindowID, inv.IdempotencyKey, inv.Action, body, source, inv.DRRunID, inv.DRTaskID, inv.TaskKey))
	if err != nil {
		return fmt.Errorf("migrate: create connector invocation: %w", err)
	}
	*inv = *created
	return nil
}

// ListInvocationsForWindow returns every connector invocation recorded against a
// cutover window, oldest first, so the evidence report can show the connector
// calls a cutover/rollback run made (Wave 6, P10b).
func (s *Store) ListInvocationsForWindow(ctx context.Context, db DBTX, tenantID, windowID uuid.UUID) ([]ConnectorInvocation, error) {
	rows, err := db.Query(ctx, `SELECT `+invocationColumns+`
FROM migrate_connector_invocation
WHERE tenant_id = $1 AND window_id = $2
ORDER BY created_at ASC`, tenantID, windowID)
	if err != nil {
		return nil, fmt.Errorf("migrate: list window invocations: %w", err)
	}
	defer rows.Close()
	var out []ConnectorInvocation
	for rows.Next() {
		inv, err := scanInvocation(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *inv)
	}
	return out, rows.Err()
}

func (s *Store) FinishInvocation(ctx context.Context, db DBTX, tenantID, id uuid.UUID, status string, httpStatus int, responseBody, errorMessage string) (*ConnectorInvocation, error) {
	inv, err := scanInvocation(db.QueryRow(ctx, `
UPDATE migrate_connector_invocation
   SET status = $3, http_status = $4, response_body = $5, error_message = $6, updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING `+invocationColumns, tenantID, id, status, httpStatus, responseBody, errorMessage))
	if err != nil {
		return nil, err
	}
	return inv, nil
}

const auditColumns = `id, tenant_id, program_id, actor_id, action, subject_id, subject_type,
summary, detail, occurred_at, recorded_at`

func scanAuditEvent(row rowScanner) (*AuditEvent, error) {
	var ev AuditEvent
	var detail []byte
	if err := row.Scan(&ev.ID, &ev.TenantID, &ev.ProgramID, &ev.ActorID, &ev.Action, &ev.SubjectID,
		&ev.SubjectType, &ev.Summary, &detail, &ev.OccurredAt, &ev.RecordedAt); err != nil {
		return nil, err
	}
	if len(detail) > 0 {
		_ = json.Unmarshal(detail, &ev.Detail)
	}
	if ev.Detail == nil {
		ev.Detail = map[string]any{}
	}
	return &ev, nil
}

func (s *Store) AppendAudit(ctx context.Context, db DBTX, ev *AuditEvent) error {
	detail, err := json.Marshal(ev.Detail)
	if err != nil {
		return err
	}
	created, err := scanAuditEvent(db.QueryRow(ctx, `
INSERT INTO migrate_audit_event (tenant_id, program_id, actor_id, action, subject_id, subject_type, summary, detail, occurred_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING `+auditColumns,
		ev.TenantID, ev.ProgramID, ev.ActorID, ev.Action, ev.SubjectID, ev.SubjectType, ev.Summary, detail, ev.OccurredAt))
	if err != nil {
		return fmt.Errorf("migrate: append audit: %w", err)
	}
	*ev = *created
	return nil
}

func (s *Store) RecentAudit(ctx context.Context, db DBTX, tenantID, programID uuid.UUID, limit int) ([]AuditEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := db.Query(ctx, `SELECT `+auditColumns+` FROM migrate_audit_event WHERE tenant_id = $1 AND program_id = $2 ORDER BY occurred_at DESC, id DESC LIMIT $3`, tenantID, programID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditEvent
	for rows.Next() {
		ev, err := scanAuditEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *ev)
	}
	return out, rows.Err()
}

func (s *Store) PortfolioSummary(ctx context.Context, db DBTX, tenantID, programID uuid.UUID) (PortfolioSummary, error) {
	summary := PortfolioSummary{
		ByStrategy: map[string]int{},
		ByStatus:   map[string]int{},
		ByTier:     map[string]int{},
	}
	rows, err := db.Query(ctx, `
SELECT strategy, status, COALESCE(NULLIF(tier, ''), 'unclassified') AS tier, readiness_score
FROM migrate_workload
WHERE tenant_id = $1 AND program_id = $2`, tenantID, programID)
	if err != nil {
		return summary, err
	}
	defer rows.Close()
	totalReadiness := 0
	for rows.Next() {
		var strategy, status, tier string
		var readiness int
		if err := rows.Scan(&strategy, &status, &tier, &readiness); err != nil {
			return summary, err
		}
		summary.TotalWorkloads++
		summary.ByStrategy[strategy]++
		summary.ByStatus[status]++
		summary.ByTier[tier]++
		totalReadiness += readiness
	}
	if err := rows.Err(); err != nil {
		return summary, err
	}
	if summary.TotalWorkloads > 0 {
		summary.ReadinessAverage = totalReadiness / summary.TotalWorkloads
	}
	return summary, nil
}
