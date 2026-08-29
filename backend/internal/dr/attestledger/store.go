package attestledger

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// ErrNotFound is returned when no ledger entry or checkpoint matches a query.
var ErrNotFound = errors.New("attestledger: not found")

// Store persists dr_attestation_ledger + dr_attestation_checkpoint rows. It
// holds no state and takes a repository.DBTX on every method so callers pick the
// execution context: the recorder's open transaction makes the append atomic
// with its outbox event and serializes the per-tenant seq under a row lock,
// while a pool serves single reads. It never touches the shared repository.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

// nextSeqAndHead allocates the next per-tenant seq AND returns the current chain
// head atomically. It is the linchpin of fork-prevention: it takes an advisory
// xact lock keyed on the tenant so two concurrent appends serialize — the second
// blocks until the first commits, then sees the first's entry as the head. The
// lock is transaction-scoped (pg_advisory_xact_lock) so it releases on commit or
// rollback automatically.
//
// It returns the next seq (max(seq)+1, or 1 for an empty chain) and the head
// entry's entry_hash (GenesisPrevHash when the chain is empty).
func (s Store) nextSeqAndHead(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (nextSeq int64, headHash string, err error) {
	if err := s.LockTenant(ctx, db, tenantID); err != nil {
		return 0, "", err
	}

	const headSQL = `
SELECT seq, entry_hash
FROM dr_attestation_ledger
WHERE tenant_id = $1
ORDER BY seq DESC
LIMIT 1`
	var lastSeq int64
	var lastHash string
	row := db.QueryRow(ctx, headSQL, tenantID)
	switch err := row.Scan(&lastSeq, &lastHash); {
	case err == nil:
		return lastSeq + 1, lastHash, nil
	case errors.Is(err, pgx.ErrNoRows):
		return 1, GenesisPrevHash, nil
	default:
		return 0, "", fmt.Errorf("attestledger: reading chain head: %w", err)
	}
}

// LockTenant takes the transaction-scoped per-tenant advisory lock used by
// chain appends and checkpoint finalization. Sharing one lock ensures a
// checkpoint cannot race another checkpoint or an append while it is deciding
// which range to mark anchored.
func (Store) LockTenant(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) error {
	// Lock on a stable per-tenant key derived from the tenant UUID. Two int4
	// keys give a 64-bit lock space; using the tenant's first 8 bytes is
	// collision-resistant enough for a per-tenant append serializer.
	hi, lo := tenantLockKeys(tenantID)
	if _, err := db.Exec(ctx, "SELECT pg_advisory_xact_lock($1, $2)", hi, lo); err != nil {
		return fmt.Errorf("attestledger: acquiring tenant lock: %w", err)
	}
	return nil
}

const insertEntrySQL = `
INSERT INTO dr_attestation_ledger
    (tenant_id, seq, entry_type, subject_id, payload, payload_hash, prev_hash, entry_hash)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, created_at`

// insertEntry writes a fully-linked entry. It MUST be called after
// nextSeqAndHead within the same transaction so the (tenant_id, seq) unique
// constraint and the advisory lock together guarantee a contiguous, fork-free
// chain.
func (Store) insertEntry(ctx context.Context, db repository.DBTX, e *Entry) error {
	err := db.QueryRow(ctx, insertEntrySQL,
		e.TenantID, e.Seq, e.EntryType, e.SubjectID, []byte(e.Payload),
		e.PayloadHash, e.PrevHash, e.EntryHash,
	).Scan(&e.ID, &e.CreatedAt)
	if err != nil {
		return fmt.Errorf("attestledger: inserting ledger entry: %w", err)
	}
	return nil
}

// AppendEntry is the atomic chain-append the recorder calls inside a tenant
// transaction: it allocates the next monotonic seq under a per-tenant advisory
// lock, links the entry to the locked chain head (prev_hash = head entry_hash),
// computes the entry_hash, and inserts the row. The advisory lock + the
// (tenant_id, seq) UNIQUE constraint together guarantee a contiguous, fork-free
// chain even under concurrent appends. The entry's TenantID, EntryType, and
// SubjectID must be set; Seq/Payload/hashes/ID/CreatedAt are filled here.
func (s Store) AppendEntry(ctx context.Context, db repository.DBTX, e *Entry, payload any) error {
	nextSeq, headHash, err := s.nextSeqAndHead(ctx, db, e.TenantID)
	if err != nil {
		return err
	}
	canon, payloadHash, err := HashPayload(payload)
	if err != nil {
		return err
	}
	e.Seq = nextSeq
	e.Payload = canon
	e.PayloadHash = payloadHash
	e.PrevHash = headHash
	e.EntryHash = ComputeEntryHash(nextSeq, e.EntryType, e.SubjectID, payloadHash, headHash)
	return s.insertEntry(ctx, db, e)
}

const entryColumns = `
id, tenant_id, seq, entry_type, subject_id, payload, payload_hash,
prev_hash, entry_hash, COALESCE(anchored_root, ''), created_at`

func scanEntry(row pgx.Row) (*Entry, error) {
	var e Entry
	var payload []byte
	if err := row.Scan(
		&e.ID, &e.TenantID, &e.Seq, &e.EntryType, &e.SubjectID, &payload,
		&e.PayloadHash, &e.PrevHash, &e.EntryHash, &e.AnchoredRoot, &e.CreatedAt,
	); err != nil {
		return nil, err
	}
	e.Payload = payload
	return &e, nil
}

// GetEntry loads a single entry by seq.
func (Store) GetEntry(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, seq int64) (*Entry, error) {
	const q = `SELECT ` + entryColumns + ` FROM dr_attestation_ledger WHERE tenant_id = $1 AND seq = $2`
	e, err := scanEntry(db.QueryRow(ctx, q, tenantID, seq))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("seq %d: %w", seq, ErrNotFound)
		}
		return nil, fmt.Errorf("attestledger: loading entry: %w", err)
	}
	return e, nil
}

// ListFilter narrows a ListEntries query. Zero values mean "no filter".
type ListFilter struct {
	EntryType string
	SubjectID string
	Limit     int
}

// ListEntries returns a tenant's entries ordered by ascending seq (genesis
// first), optionally filtered by entry_type and subject_id. Ascending order is
// what the verifier needs; the HTTP list handler reverses for display if it
// wants newest-first.
func (Store) ListEntries(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, f ListFilter) ([]*Entry, error) {
	q := `SELECT ` + entryColumns + ` FROM dr_attestation_ledger WHERE tenant_id = $1`
	args := []any{tenantID}
	if f.EntryType != "" {
		args = append(args, f.EntryType)
		q += fmt.Sprintf(" AND entry_type = $%d", len(args))
	}
	if f.SubjectID != "" {
		args = append(args, f.SubjectID)
		q += fmt.Sprintf(" AND subject_id = $%d", len(args))
	}
	q += " ORDER BY seq ASC"
	if f.Limit > 0 {
		args = append(args, f.Limit)
		q += fmt.Sprintf(" LIMIT $%d", len(args))
	}

	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("attestledger: listing entries: %w", err)
	}
	defer rows.Close()

	var out []*Entry
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("attestledger: scanning entry: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("attestledger: reading entries: %w", err)
	}
	return out, nil
}

// EntriesInRange returns a tenant's entries with seq in [from,to] inclusive,
// ascending. Used to (re)build a Merkle tree / inclusion proof over a checkpoint
// range.
func (Store) EntriesInRange(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, from, to int64) ([]*Entry, error) {
	const q = `SELECT ` + entryColumns + `
FROM dr_attestation_ledger
WHERE tenant_id = $1 AND seq >= $2 AND seq <= $3
ORDER BY seq ASC`
	rows, err := db.Query(ctx, q, tenantID, from, to)
	if err != nil {
		return nil, fmt.Errorf("attestledger: listing entry range: %w", err)
	}
	defer rows.Close()
	var out []*Entry
	for rows.Next() {
		e, err := scanEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("attestledger: scanning entry range: %w", err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("attestledger: reading entry range: %w", err)
	}
	return out, nil
}

// HeadSeq returns the highest seq for a tenant (0 when the chain is empty).
func (Store) HeadSeq(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (int64, error) {
	const q = `SELECT COALESCE(MAX(seq), 0) FROM dr_attestation_ledger WHERE tenant_id = $1`
	var seq int64
	if err := db.QueryRow(ctx, q, tenantID).Scan(&seq); err != nil {
		return 0, fmt.Errorf("attestledger: reading head seq: %w", err)
	}
	return seq, nil
}

const insertCheckpointSQL = `
INSERT INTO dr_attestation_checkpoint
    (tenant_id, from_seq, to_seq, merkle_root, entry_count, worm_object_key, worm_version_id)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id, created_at`

// CreateCheckpoint persists an anchored Merkle checkpoint.
func (Store) CreateCheckpoint(ctx context.Context, db repository.DBTX, c *Checkpoint) error {
	err := db.QueryRow(ctx, insertCheckpointSQL,
		c.TenantID, c.FromSeq, c.ToSeq, c.MerkleRoot, c.EntryCount,
		nullable(c.WORMObjectKey), nullable(c.WORMVersionID),
	).Scan(&c.ID, &c.CreatedAt)
	if err != nil {
		return fmt.Errorf("attestledger: inserting checkpoint: %w", err)
	}
	return nil
}

// MarkAnchored stamps anchored_root on every entry in [from,to] so a later
// inclusion-proof request knows which checkpoint covers the entry.
func (Store) MarkAnchored(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, from, to int64, root string) error {
	const q = `
UPDATE dr_attestation_ledger
SET anchored_root = $4
WHERE tenant_id = $1 AND seq >= $2 AND seq <= $3`
	if _, err := db.Exec(ctx, q, tenantID, from, to, root); err != nil {
		return fmt.Errorf("attestledger: marking entries anchored: %w", err)
	}
	return nil
}

const checkpointColumns = `
id, tenant_id, from_seq, to_seq, merkle_root, entry_count,
COALESCE(worm_object_key, ''), COALESCE(worm_version_id, ''), created_at`

func scanCheckpoint(row pgx.Row) (*Checkpoint, error) {
	var c Checkpoint
	if err := row.Scan(
		&c.ID, &c.TenantID, &c.FromSeq, &c.ToSeq, &c.MerkleRoot, &c.EntryCount,
		&c.WORMObjectKey, &c.WORMVersionID, &c.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &c, nil
}

// LatestCheckpointCovering returns the most recent checkpoint whose range
// includes seq, or ErrNotFound when the entry has not been anchored yet.
func (Store) LatestCheckpointCovering(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, seq int64) (*Checkpoint, error) {
	const q = `SELECT ` + checkpointColumns + `
FROM dr_attestation_checkpoint
WHERE tenant_id = $1 AND from_seq <= $2 AND to_seq >= $2
ORDER BY created_at DESC, id DESC
LIMIT 1`
	c, err := scanCheckpoint(db.QueryRow(ctx, q, tenantID, seq))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("seq %d: %w", seq, ErrNotFound)
		}
		return nil, fmt.Errorf("attestledger: loading checkpoint: %w", err)
	}
	return c, nil
}

// LastAnchoredSeq returns the highest to_seq across a tenant's checkpoints
// (0 when none), so the anchor job knows where the next checkpoint should start.
func (Store) LastAnchoredSeq(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (int64, error) {
	const q = `SELECT COALESCE(MAX(to_seq), 0) FROM dr_attestation_checkpoint WHERE tenant_id = $1`
	var seq int64
	if err := db.QueryRow(ctx, q, tenantID).Scan(&seq); err != nil {
		return 0, fmt.Errorf("attestledger: reading last anchored seq: %w", err)
	}
	return seq, nil
}

// ListCheckpoints returns a tenant's checkpoints, newest first.
func (Store) ListCheckpoints(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, limit int) ([]*Checkpoint, error) {
	q := `SELECT ` + checkpointColumns + `
FROM dr_attestation_checkpoint
WHERE tenant_id = $1
ORDER BY created_at DESC, id DESC`
	args := []any{tenantID}
	if limit > 0 {
		args = append(args, limit)
		q += fmt.Sprintf(" LIMIT $%d", len(args))
	}
	rows, err := db.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("attestledger: listing checkpoints: %w", err)
	}
	defer rows.Close()
	var out []*Checkpoint
	for rows.Next() {
		c, err := scanCheckpoint(rows)
		if err != nil {
			return nil, fmt.Errorf("attestledger: scanning checkpoint: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("attestledger: reading checkpoints: %w", err)
	}
	return out, nil
}

// tenantLockKeys derives two int32 advisory-lock keys from a tenant UUID, so the
// per-tenant append serializer keys on a stable, collision-resistant value.
func tenantLockKeys(tenantID uuid.UUID) (int32, int32) {
	b := tenantID[:]
	hi := int32(uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3]))
	lo := int32(uint32(b[4])<<24 | uint32(b[5])<<16 | uint32(b[6])<<8 | uint32(b[7]))
	return hi, lo
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// PendingTenant identifies a tenant whose chain has entries beyond the last
// anchored checkpoint — the work the anchor loop picks up.
type PendingTenant struct {
	TenantID     uuid.UUID
	HeadSeq      int64
	LastAnchored int64
}

// PendingAnchors returns tenants with unanchored entries (HeadSeq > LastAnchored)
// across all tenants. It is a system-context (bypass RLS) query used only by the
// leader-singleton anchor loop, mirroring repository.systemQuery* conventions.
func (Store) PendingAnchors(ctx context.Context, db repository.DBTX, limit int) ([]PendingTenant, error) {
	const q = `
SELECT l.tenant_id,
       MAX(l.seq) AS head_seq,
       COALESCE(c.last_anchored, 0) AS last_anchored
FROM dr_attestation_ledger l
LEFT JOIN (
    SELECT tenant_id, MAX(to_seq) AS last_anchored
    FROM dr_attestation_checkpoint
    GROUP BY tenant_id
) c ON c.tenant_id = l.tenant_id
GROUP BY l.tenant_id, c.last_anchored
HAVING MAX(l.seq) > COALESCE(c.last_anchored, 0)
ORDER BY (MAX(l.seq) - COALESCE(c.last_anchored, 0)) DESC
LIMIT $1`
	n := limit
	if n <= 0 {
		n = 16
	}
	rows, err := db.Query(ctx, q, n)
	if err != nil {
		return nil, fmt.Errorf("attestledger: listing pending anchors: %w", err)
	}
	defer rows.Close()
	var out []PendingTenant
	for rows.Next() {
		var p PendingTenant
		if err := rows.Scan(&p.TenantID, &p.HeadSeq, &p.LastAnchored); err != nil {
			return nil, fmt.Errorf("attestledger: scanning pending anchor: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("attestledger: reading pending anchors: %w", err)
	}
	return out, nil
}
