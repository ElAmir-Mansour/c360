package vmcapture

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// Store persists the workload-capture domain over a repository.DBTX. It holds
// no state and takes a DBTX on every method so the caller chooses the execution
// context: the service's open tenant transaction makes a source write atomic
// with its outbox event, and a capture pass persists its block map + epoch in
// one transaction. This mirrors internal/dr/journal.Store.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

// isUniqueViolation reports whether err is a PostgreSQL unique constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// --- sources ----------------------------------------------------------------

const insertSourceSQL = `
INSERT INTO dr_workload_capture_source
    (tenant_id, stream_id, name, source_kind, binding_kind, block_size_bytes, config, enabled)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, epoch_count, last_seq, created_at, updated_at`

// CreateSource inserts a capture source and populates its generated fields. A
// reused (tenant, name) returns ErrAlreadyExists.
func (Store) CreateSource(ctx context.Context, db repository.DBTX, s *Source) error {
	if s.StreamID == "" {
		return fmt.Errorf("%w: stream id is required", ErrInvalid)
	}
	if s.Name == "" {
		return fmt.Errorf("%w: name is required", ErrInvalid)
	}
	cfg, err := json.Marshal(orEmptyMap(s.Config))
	if err != nil {
		return fmt.Errorf("vmcapture: marshal source config: %w", err)
	}
	err = db.QueryRow(ctx, insertSourceSQL,
		s.TenantID, s.StreamID, s.Name, s.SourceKind, s.BindingKind, s.BlockSizeBytes, cfg, s.Enabled,
	).Scan(&s.ID, &s.EpochCount, &s.LastSeq, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("source %q: %w", s.Name, ErrAlreadyExists)
		}
		return fmt.Errorf("vmcapture: insert source %q: %w", s.Name, err)
	}
	return nil
}

const sourceColumns = `
id, tenant_id, stream_id, name, source_kind, binding_kind, block_size_bytes,
config, enabled, epoch_count, last_run_at, last_seq, created_at, updated_at`

func scanSource(row pgx.Row) (*Source, error) {
	var (
		s         Source
		cfg       []byte
		lastRunAt *time.Time
	)
	if err := row.Scan(
		&s.ID, &s.TenantID, &s.StreamID, &s.Name, &s.SourceKind, &s.BindingKind, &s.BlockSizeBytes,
		&cfg, &s.Enabled, &s.EpochCount, &lastRunAt, &s.LastSeq, &s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(cfg) > 0 {
		if err := json.Unmarshal(cfg, &s.Config); err != nil {
			return nil, fmt.Errorf("vmcapture: unmarshal source config: %w", err)
		}
	}
	if s.Config == nil {
		s.Config = map[string]any{}
	}
	s.LastRunAt = lastRunAt
	return &s, nil
}

const getSourceSQL = `SELECT ` + sourceColumns + `
FROM dr_workload_capture_source
WHERE tenant_id = $1 AND id = $2`

// GetSource loads one source scoped to the tenant.
func (Store) GetSource(ctx context.Context, db repository.DBTX, tenantID, id string) (*Source, error) {
	s, err := scanSource(db.QueryRow(ctx, getSourceSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("source %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("vmcapture: load source %s: %w", id, err)
	}
	return s, nil
}

const listSourcesSQL = `SELECT ` + sourceColumns + `
FROM dr_workload_capture_source
WHERE tenant_id = $1
ORDER BY created_at, name`

// ListSources returns a tenant's capture sources, oldest first.
func (Store) ListSources(ctx context.Context, db repository.DBTX, tenantID string) ([]Source, error) {
	rows, err := db.Query(ctx, listSourcesSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("vmcapture: list sources: %w", err)
	}
	defer rows.Close()

	var out []Source
	for rows.Next() {
		s, err := scanSource(rows)
		if err != nil {
			return nil, fmt.Errorf("vmcapture: scan source: %w", err)
		}
		out = append(out, *s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("vmcapture: read sources: %w", err)
	}
	return out, nil
}

const advanceSourceSQL = `
UPDATE dr_workload_capture_source
SET epoch_count = $3, last_seq = $4, last_run_at = $5, updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// AdvanceSource records the outcome of a capture pass on the source row: the new
// epoch count, the highest emitted Seq, and the run wall-clock.
func (Store) AdvanceSource(ctx context.Context, db repository.DBTX, tenantID, id string, epochCount int, lastSeq int64, runAt time.Time) error {
	tag, err := db.Exec(ctx, advanceSourceSQL, tenantID, id, epochCount, lastSeq, runAt)
	if err != nil {
		return fmt.Errorf("vmcapture: advance source %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("source %s: %w", id, ErrNotFound)
	}
	return nil
}

// --- epochs -----------------------------------------------------------------

const insertEpochSQL = `
INSERT INTO dr_workload_capture_epoch
    (tenant_id, source_id, stream_id, epoch, epoch_kind, from_seq, to_seq,
     frame_count, changed_units, total_units, payload_bytes, content_hash, source_marker, set_summary)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING id, captured_at`

// InsertEpoch records one capture pass. A replayed (tenant, source, epoch)
// returns ErrAlreadyExists so a re-run is an idempotent no-op rather than a
// duplicate epoch.
func (Store) InsertEpoch(ctx context.Context, db repository.DBTX, e *Epoch) error {
	if e.SourceID == "" || e.StreamID == "" {
		return fmt.Errorf("%w: source and stream id are required", ErrInvalid)
	}
	if e.Epoch <= 0 {
		return fmt.Errorf("%w: epoch must be positive", ErrInvalid)
	}
	summary, err := json.Marshal(orEmptyHeaders(e.SetSummary))
	if err != nil {
		return fmt.Errorf("vmcapture: marshal set summary: %w", err)
	}
	err = db.QueryRow(ctx, insertEpochSQL,
		e.TenantID, e.SourceID, e.StreamID, e.Epoch, e.EpochKind, e.FromSeq, e.ToSeq,
		e.FrameCount, e.ChangedUnits, e.TotalUnits, e.PayloadBytes, e.ContentHash, e.SourceMarker, summary,
	).Scan(&e.ID, &e.CapturedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("source %s epoch %d: %w", e.SourceID, e.Epoch, ErrAlreadyExists)
		}
		return fmt.Errorf("vmcapture: insert epoch source=%s epoch=%d: %w", e.SourceID, e.Epoch, err)
	}
	return nil
}

const epochColumns = `
id, tenant_id, source_id, stream_id, epoch, epoch_kind, from_seq, to_seq,
frame_count, changed_units, total_units, payload_bytes, content_hash, source_marker, set_summary, captured_at`

func scanEpoch(row pgx.Row) (*Epoch, error) {
	var (
		e       Epoch
		summary []byte
	)
	if err := row.Scan(
		&e.ID, &e.TenantID, &e.SourceID, &e.StreamID, &e.Epoch, &e.EpochKind, &e.FromSeq, &e.ToSeq,
		&e.FrameCount, &e.ChangedUnits, &e.TotalUnits, &e.PayloadBytes, &e.ContentHash, &e.SourceMarker, &summary, &e.CapturedAt,
	); err != nil {
		return nil, err
	}
	if len(summary) > 0 {
		if err := json.Unmarshal(summary, &e.SetSummary); err != nil {
			return nil, fmt.Errorf("vmcapture: unmarshal set summary: %w", err)
		}
	}
	return &e, nil
}

const listEpochsSQL = `SELECT ` + epochColumns + `
FROM dr_workload_capture_epoch
WHERE tenant_id = $1 AND source_id = $2
ORDER BY epoch`

// ListEpochs returns a source's capture passes in epoch order.
func (Store) ListEpochs(ctx context.Context, db repository.DBTX, tenantID, sourceID string) ([]Epoch, error) {
	rows, err := db.Query(ctx, listEpochsSQL, tenantID, sourceID)
	if err != nil {
		return nil, fmt.Errorf("vmcapture: list epochs source=%s: %w", sourceID, err)
	}
	defer rows.Close()

	var out []Epoch
	for rows.Next() {
		e, err := scanEpoch(rows)
		if err != nil {
			return nil, fmt.Errorf("vmcapture: scan epoch: %w", err)
		}
		out = append(out, *e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("vmcapture: read epochs source=%s: %w", sourceID, err)
	}
	return out, nil
}

const latestEpochSQL = `SELECT ` + epochColumns + `
FROM dr_workload_capture_epoch
WHERE tenant_id = $1 AND source_id = $2
ORDER BY epoch DESC
LIMIT 1`

// LatestEpoch returns the most recent capture pass for a source, or ErrNotFound
// when the source has never run.
func (Store) LatestEpoch(ctx context.Context, db repository.DBTX, tenantID, sourceID string) (*Epoch, error) {
	e, err := scanEpoch(db.QueryRow(ctx, latestEpochSQL, tenantID, sourceID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("vmcapture: latest epoch source=%s: %w", sourceID, err)
	}
	return e, nil
}

// --- VM CBT state -----------------------------------------------------------

const getVMStateSQL = `
SELECT id, tenant_id, source_id, block_size_bytes, image_bytes, block_count, epoch, block_hashes, updated_at
FROM dr_vm_capture_state
WHERE tenant_id = $1 AND source_id = $2`

// GetVMState loads the changed-block map for a source. A missing row returns a
// zero-value VMState (Epoch 0, nil BlockHashes) and a nil error, so a base pass
// proceeds with no prior map.
func (Store) GetVMState(ctx context.Context, db repository.DBTX, tenantID, sourceID string) (VMState, error) {
	var (
		st     VMState
		hashes []byte
	)
	err := db.QueryRow(ctx, getVMStateSQL, tenantID, sourceID).Scan(
		&st.ID, &st.TenantID, &st.SourceID, &st.BlockSizeBytes, &st.ImageBytes, &st.BlockCount, &st.Epoch, &hashes, &st.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return VMState{TenantID: tenantID, SourceID: sourceID}, nil
		}
		return VMState{}, fmt.Errorf("vmcapture: load vm state source=%s: %w", sourceID, err)
	}
	if len(hashes) > 0 {
		if err := json.Unmarshal(hashes, &st.BlockHashes); err != nil {
			return VMState{}, fmt.Errorf("vmcapture: unmarshal block hashes: %w", err)
		}
	}
	return st, nil
}

const upsertVMStateSQL = `
INSERT INTO dr_vm_capture_state
    (tenant_id, source_id, block_size_bytes, image_bytes, block_count, epoch, block_hashes, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, now())
ON CONFLICT (source_id) DO UPDATE
SET block_size_bytes = EXCLUDED.block_size_bytes,
    image_bytes      = EXCLUDED.image_bytes,
    block_count      = EXCLUDED.block_count,
    epoch            = EXCLUDED.epoch,
    block_hashes     = EXCLUDED.block_hashes,
    updated_at       = now()`

// UpsertVMState writes the new changed-block map for a source (insert or update
// in place). The block map is rewritten each epoch; the epoch history lives in
// dr_workload_capture_epoch.
func (Store) UpsertVMState(ctx context.Context, db repository.DBTX, st VMState) error {
	if st.BlockSizeBytes <= 0 {
		return fmt.Errorf("%w: block size must be positive", ErrInvalid)
	}
	hashes, err := json.Marshal(orEmptySlice(st.BlockHashes))
	if err != nil {
		return fmt.Errorf("vmcapture: marshal block hashes: %w", err)
	}
	if _, err := db.Exec(ctx, upsertVMStateSQL,
		st.TenantID, st.SourceID, st.BlockSizeBytes, st.ImageBytes, st.BlockCount, st.Epoch, hashes,
	); err != nil {
		return fmt.Errorf("vmcapture: upsert vm state source=%s: %w", st.SourceID, err)
	}
	return nil
}

func orEmptyMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func orEmptySlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func orEmptyHeaders(h []ResourceHeader) []ResourceHeader {
	if h == nil {
		return []ResourceHeader{}
	}
	return h
}
