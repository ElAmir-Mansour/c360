package attestledger

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// Event types emitted to the DR events topic.
const (
	// EventTypeEntryAppended is emitted when an attestation is appended.
	EventTypeEntryAppended = "dr.attestation_ledger.appended"
	// EventTypeAnchored is emitted when a Merkle checkpoint is sealed to WORM.
	EventTypeAnchored = "dr.attestation_ledger.anchored"
	// EventTypeTamperDetected is emitted when a chain verification finds a break —
	// a high-severity audit signal that an attestation was altered or deleted.
	EventTypeTamperDetected = "dr.attestation_ledger.tamper_detected"

	eventSource = "clario-dr-service/attestledger"
)

// ErrInvalid is returned for malformed append/anchor inputs.
var ErrInvalid = errors.New("attestledger: invalid request")

// TenantRunner runs a function inside a tenant-scoped transaction (RLS set).
// *pgxpool.Pool is adapted by PGXRunner; tests supply an in-memory fake.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// SystemRunner runs a function in a system-context transaction (bypass RLS) for
// the leader-singleton anchor loop's cross-tenant scan.
type SystemRunner interface {
	RunSystem(ctx context.Context, fn func(repository.DBTX) error) error
}

// PGXRunner adapts a pgx pool to TenantRunner + SystemRunner using the shared
// tenant-context helpers (SET LOCAL app.current_tenant_id / app.bypass_rls).
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a tenant-scoped read-write transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("attestledger: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a tenant-scoped read transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("attestledger: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunSystem runs fn in a system-context (RLS-bypassing) read-write transaction.
func (r PGXRunner) RunSystem(ctx context.Context, fn func(repository.DBTX) error) error {
	if r.Pool == nil {
		return errors.New("attestledger: nil transaction pool")
	}
	return database.RunSystemTx(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// EventStager stages a ledger event in the caller's transaction. OutboxStager is
// the production implementation; tests supply a recorder.
type EventStager interface {
	Stage(ctx context.Context, db repository.DBTX, eventType, tenantID string, data map[string]any) error
}

// OutboxStager writes ledger events to the transactional outbox on the DR events
// topic.
type OutboxStager struct{}

// Stage builds a CloudEvent and writes it to the outbox in the caller's tx.
func (OutboxStager) Stage(ctx context.Context, db repository.DBTX, eventType, tenantID string, data map[string]any) error {
	event, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("attestledger: building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, db, events.Topics.DREvents, event)
}

// Sealer seals a checkpoint payload to GOVERNANCE WORM and returns the object
// key + version. It is satisfied by an adapter over internal/dr/worm.Client (see
// WORMSealer) so this package does not import the heavy MinIO client directly
// and stays unit-testable. A nil Sealer means "DB-only anchoring": the
// checkpoint root is still recorded and verifiable, just not sealed to object
// storage.
type Sealer interface {
	SealCheckpoint(ctx context.Context, tenantID uuid.UUID, key string, payload []byte) (objectKey, versionID string, err error)
}

// LedgerStore is the persistence surface the recorder depends on. The real
// *Store (DB-backed, advisory-lock serialized) is the production implementation;
// unit tests supply an in-memory store that exercises the same chain/Merkle
// logic without Postgres.
type LedgerStore interface {
	LockTenant(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) error
	AppendEntry(ctx context.Context, db repository.DBTX, e *Entry, payload any) error
	ListEntries(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, f ListFilter) ([]*Entry, error)
	EntriesInRange(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, from, to int64) ([]*Entry, error)
	HeadSeq(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (int64, error)
	LastAnchoredSeq(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (int64, error)
	CreateCheckpoint(ctx context.Context, db repository.DBTX, c *Checkpoint) error
	MarkAnchored(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, from, to int64, root string) error
	LatestCheckpointCovering(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, seq int64) (*Checkpoint, error)
	PendingAnchors(ctx context.Context, db repository.DBTX, limit int) ([]PendingTenant, error)
}

// Recorder is the append + verify + anchor API other DR components call. It is
// the public surface wired in integrate to consume attest / cleanroom / drill
// outcomes.
type Recorder struct {
	tx      TenantRunner
	sys     SystemRunner
	store   LedgerStore
	stager  EventStager
	sealer  Sealer
	keys    KeyProvider
	metrics *Metrics
	logger  zerolog.Logger
	now     func() time.Time
}

// Config wires a Recorder.
type Config struct {
	TX     TenantRunner
	System SystemRunner
	Store  LedgerStore
	Stager EventStager
	// Sealer is optional; nil means DB-only anchoring (root recorded, not sealed).
	Sealer Sealer
	// Keys is optional; when set, checkpoint payloads are envelope-encrypted with
	// the tenant KEK before sealing (BYOK). nil seals plaintext canonical JSON.
	Keys    KeyProvider
	Metrics *Metrics
	Logger  zerolog.Logger
	Now     func() time.Time
}

// NewRecorder constructs the ledger recorder. TX is required; a nil Store falls
// back to the DB-backed *Store, a nil stager to OutboxStager, and a nil metrics
// is a no-op.
func NewRecorder(cfg Config) (*Recorder, error) {
	if cfg.TX == nil {
		return nil, errors.New("attestledger: tenant runner is required")
	}
	var store LedgerStore = cfg.Store
	if store == nil {
		store = NewStore()
	}
	stager := cfg.Stager
	if stager == nil {
		stager = OutboxStager{}
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Recorder{
		tx:      cfg.TX,
		sys:     cfg.System,
		store:   store,
		stager:  stager,
		sealer:  cfg.Sealer,
		keys:    cfg.Keys,
		metrics: cfg.Metrics,
		logger:  cfg.Logger.With().Str("service", "dr-attestledger").Logger(),
		now:     now,
	}, nil
}

// validEntryType reports whether t is a recognized ledger entry type.
func validEntryType(t string) bool {
	switch t {
	case EntryTypeFailoverAttestation, EntryTypeDrillAttestation,
		EntryTypeRecoveryPointValidation, EntryTypeCleanroomVerdict,
		EntryTypeRecoverEvidenceReport, EntryTypeAnchorCheckpoint:
		return true
	default:
		return false
	}
}

// Append adds an attestation to the tenant's chain atomically: it allocates the
// next monotonic seq under a row lock (so concurrent appends serialize and the
// chain cannot fork), links the entry to the current head, inserts it, and
// stages the lifecycle event — all in one tenant-scoped transaction so the entry
// and its event commit together. It returns the linked, persisted Entry.
func (r *Recorder) Append(ctx context.Context, req AppendRequest) (*Entry, error) {
	if req.TenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	if !validEntryType(req.EntryType) {
		return nil, fmt.Errorf("%w: unknown entry_type %q", ErrInvalid, req.EntryType)
	}
	if req.SubjectID == "" {
		return nil, fmt.Errorf("%w: subject id is required", ErrInvalid)
	}

	entry := &Entry{
		TenantID:  req.TenantID,
		EntryType: req.EntryType,
		SubjectID: req.SubjectID,
	}

	err := r.tx.RunWithTenant(ctx, req.TenantID, func(db repository.DBTX) error {
		// AppendEntry allocates the next monotonic seq under a per-tenant advisory
		// lock, links the entry to the locked head, and inserts it — so concurrent
		// appends serialize and the chain cannot fork.
		if err := r.store.AppendEntry(ctx, db, entry, req.Payload); err != nil {
			return err
		}
		return r.stager.Stage(ctx, db, EventTypeEntryAppended, req.TenantID.String(), map[string]any{
			"seq":          entry.Seq,
			"entry_type":   entry.EntryType,
			"subject_id":   entry.SubjectID,
			"entry_hash":   entry.EntryHash,
			"payload_hash": entry.PayloadHash,
		})
	})
	if err != nil {
		return nil, err
	}
	r.metrics.IncAppended(entry.EntryType)
	r.logger.Debug().
		Str("tenant_id", req.TenantID.String()).
		Int64("seq", entry.Seq).
		Str("entry_type", entry.EntryType).
		Str("entry_hash", entry.EntryHash).
		Msg("attestation appended to ledger")
	return entry, nil
}

// ListEntries returns a tenant's entries (genesis-first), optionally filtered by
// entry_type / subject_id, for the GET /attestation-ledger endpoint.
func (r *Recorder) ListEntries(ctx context.Context, tenantID uuid.UUID, f ListFilter) ([]*Entry, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	var out []*Entry
	err := r.tx.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var err error
		out, err = r.store.ListEntries(ctx, db, tenantID, f)
		return err
	})
	return out, err
}

// Verify walks the tenant's entire chain (genesis→head) and reports whether it
// is intact or the first broken seq. On a detected break it stages a
// high-severity tamper event so the audit trail records the discovery. The walk
// uses real SHA-256 recomputation, so a mutated payload, a spliced entry, or a
// deleted middle entry are all caught.
func (r *Recorder) Verify(ctx context.Context, tenantID uuid.UUID) (VerifyResult, error) {
	if tenantID == uuid.Nil {
		return VerifyResult{}, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	var entries []*Entry
	if err := r.tx.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var err error
		entries, err = r.store.ListEntries(ctx, db, tenantID, ListFilter{})
		return err
	}); err != nil {
		return VerifyResult{}, err
	}

	result := VerifyChain(entries)
	r.metrics.IncVerify(result.Intact)
	if !result.Intact {
		r.logger.Error().
			Str("tenant_id", tenantID.String()).
			Int64("first_broken_seq", result.FirstBrokenSeq).
			Str("reason", result.Reason).
			Msg("attestation ledger TAMPER DETECTED")
		// Best-effort: record the discovery in the audit trail. A staging failure
		// must not hide the verdict, so it is logged, not returned.
		if err := r.tx.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
			return r.stager.Stage(ctx, db, EventTypeTamperDetected, tenantID.String(), map[string]any{
				"first_broken_seq": result.FirstBrokenSeq,
				"reason":           result.Reason,
				"entries_checked":  result.EntriesChecked,
			})
		}); err != nil {
			r.logger.Error().Err(err).Msg("failed to stage tamper-detected event")
		}
	}
	return result, nil
}

// Anchor seals a Merkle checkpoint over the next unanchored range
// [lastAnchored+1, head] of the tenant's chain to WORM, producing a tamper-proof
// checkpoint. It:
//
//  1. reads the unanchored entries (tenant tx),
//  2. computes the Merkle root over their entry_hash leaves (real Merkle tree),
//  3. optionally envelope-encrypts the checkpoint payload with the tenant KEK,
//  4. seals the payload to GOVERNANCE WORM (when a Sealer is wired),
//  5. records the checkpoint row, stamps the entries anchored, and stages the
//     anchored event — atomically in one tenant tx.
//
// It returns the created Checkpoint. When the chain has no unanchored entries it
// returns ErrInvalid (nothing to anchor).
func (r *Recorder) Anchor(ctx context.Context, tenantID uuid.UUID) (*Checkpoint, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}

	// Phase 1: determine the unanchored range and load its entries.
	var entries []*Entry
	var from int64
	if err := r.tx.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		head, err := r.store.HeadSeq(ctx, db, tenantID)
		if err != nil {
			return err
		}
		if head == 0 {
			return fmt.Errorf("%w: empty chain, nothing to anchor", ErrInvalid)
		}
		lastAnchored, err := r.store.LastAnchoredSeq(ctx, db, tenantID)
		if err != nil {
			return err
		}
		if head <= lastAnchored {
			return fmt.Errorf("%w: no unanchored entries (head=%d, anchored=%d)", ErrInvalid, head, lastAnchored)
		}
		from = lastAnchored + 1
		entries, err = r.store.EntriesInRange(ctx, db, tenantID, from, head)
		return err
	}); err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("%w: no unanchored entries", ErrInvalid)
	}

	to := entries[len(entries)-1].Seq
	leaves := make([]string, len(entries))
	for i, e := range entries {
		leaves[i] = e.EntryHash
	}
	root := MerkleRoot(leaves)

	checkpoint := &Checkpoint{
		TenantID:   tenantID,
		FromSeq:    from,
		ToSeq:      to,
		MerkleRoot: root,
		EntryCount: len(entries),
		CreatedAt:  r.now(),
	}

	// Phase 2: seal the checkpoint payload to WORM (outside the DB tx — object
	// I/O must not hold a transaction open).
	if r.sealer != nil {
		payload, err := r.checkpointPayload(tenantID, checkpoint, leaves)
		if err != nil {
			return nil, err
		}
		key := checkpointObjectKey(tenantID, from, to)
		objKey, versionID, err := r.sealer.SealCheckpoint(ctx, tenantID, key, payload)
		if err != nil {
			return nil, fmt.Errorf("attestledger: sealing checkpoint to WORM: %w", err)
		}
		checkpoint.WORMObjectKey = objKey
		checkpoint.WORMVersionID = versionID
	}

	// Phase 3: record the checkpoint, stamp the entries, and emit the event.
	if err := r.tx.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		if err := r.store.LockTenant(ctx, db, tenantID); err != nil {
			return err
		}
		lastAnchored, err := r.store.LastAnchoredSeq(ctx, db, tenantID)
		if err != nil {
			return err
		}
		if lastAnchored >= to {
			return fmt.Errorf("%w: checkpoint range [%d,%d] already anchored through seq %d", ErrInvalid, from, to, lastAnchored)
		}
		if lastAnchored >= from {
			return fmt.Errorf("%w: checkpoint range [%d,%d] overlaps anchored seq %d", ErrInvalid, from, to, lastAnchored)
		}
		if err := r.store.CreateCheckpoint(ctx, db, checkpoint); err != nil {
			return err
		}
		if err := r.store.MarkAnchored(ctx, db, tenantID, from, to, root); err != nil {
			return err
		}
		return r.stager.Stage(ctx, db, EventTypeAnchored, tenantID.String(), map[string]any{
			"from_seq":        from,
			"to_seq":          to,
			"merkle_root":     root,
			"entry_count":     len(entries),
			"worm_object_key": checkpoint.WORMObjectKey,
		})
	}); err != nil {
		return nil, err
	}
	r.metrics.IncAnchored(len(entries))
	r.logger.Info().
		Str("tenant_id", tenantID.String()).
		Int64("from_seq", from).Int64("to_seq", to).
		Str("merkle_root", root).
		Str("worm_object_key", checkpoint.WORMObjectKey).
		Msg("attestation ledger anchored to WORM")
	return checkpoint, nil
}

// checkpointPayload builds the canonical bytes sealed to WORM. When a
// KeyProvider is configured the canonical JSON is envelope-encrypted with the
// tenant KEK (BYOK) and the SealedPayload JSON is what lands in WORM; otherwise
// the plaintext canonical JSON is sealed (WORM still gives immutability).
func (r *Recorder) checkpointPayload(tenantID uuid.UUID, c *Checkpoint, leaves []string) ([]byte, error) {
	doc := map[string]any{
		"tenant_id":   tenantID.String(),
		"from_seq":    c.FromSeq,
		"to_seq":      c.ToSeq,
		"merkle_root": c.MerkleRoot,
		"entry_count": c.EntryCount,
		"leaves":      leaves,
		"anchored_at": c.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
	canon, err := canonicalJSON(doc)
	if err != nil {
		return nil, fmt.Errorf("attestledger: canonicalizing checkpoint: %w", err)
	}
	if r.keys == nil {
		return canon, nil
	}
	sealed, err := EnvelopeSeal(r.keys, tenantID, canon)
	if err != nil {
		return nil, err
	}
	return marshalSealed(sealed)
}

// BuildInclusionProofFor produces a Merkle inclusion proof for the entry at seq,
// against the checkpoint that covers it. It rebuilds the leaves from the chain
// (so the proof is independent of any cached tree), verifies the rebuilt root
// matches the recorded checkpoint root (a self-check that the chain has not
// drifted from what was anchored), then computes the authentication path.
func (r *Recorder) BuildInclusionProofFor(ctx context.Context, tenantID uuid.UUID, seq int64) (*InclusionProof, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalid)
	}
	var proof *InclusionProof
	err := r.tx.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		cp, err := r.store.LatestCheckpointCovering(ctx, db, tenantID, seq)
		if err != nil {
			return err
		}
		entries, err := r.store.EntriesInRange(ctx, db, tenantID, cp.FromSeq, cp.ToSeq)
		if err != nil {
			return err
		}
		if len(entries) != cp.EntryCount {
			return fmt.Errorf("attestledger: checkpoint entry count %d != %d entries in range",
				cp.EntryCount, len(entries))
		}
		leaves := make([]string, len(entries))
		index := -1
		var leafHash string
		for i, e := range entries {
			leaves[i] = e.EntryHash
			if e.Seq == seq {
				index = i
				leafHash = e.EntryHash
			}
		}
		if index < 0 {
			return fmt.Errorf("seq %d: %w", seq, ErrNotFound)
		}
		// Self-check: the chain's current leaves must reproduce the anchored root.
		if got := MerkleRoot(leaves); got != cp.MerkleRoot {
			return fmt.Errorf("attestledger: chain root %s != anchored root %s (chain tampered after anchor)",
				got, cp.MerkleRoot)
		}
		path, root, err := BuildInclusionProof(leaves, index)
		if err != nil {
			return err
		}
		proof = &InclusionProof{
			Seq:       seq,
			LeafIndex: index,
			LeafHash:  leafHash,
			Path:      path,
			Root:      root,
			FromSeq:   cp.FromSeq,
			ToSeq:     cp.ToSeq,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return proof, nil
}

// AnchorAll runs Anchor for every tenant with unanchored entries in one pass.
// It is the work the leader-singleton loop performs each tick. It uses a
// system-context read to discover pending tenants (cross-tenant), then anchors
// each in its own tenant transaction. A failure on one tenant is logged and the
// pass continues. Returns how many tenants were anchored.
func (r *Recorder) AnchorAll(ctx context.Context, limit int) (int, error) {
	if r.sys == nil {
		return 0, errors.New("attestledger: system runner required for AnchorAll")
	}
	var pending []PendingTenant
	if err := r.sys.RunSystem(ctx, func(db repository.DBTX) error {
		var err error
		pending, err = r.store.PendingAnchors(ctx, db, limit)
		return err
	}); err != nil {
		return 0, err
	}
	anchored := 0
	for _, p := range pending {
		if ctx.Err() != nil {
			return anchored, ctx.Err()
		}
		if _, err := r.Anchor(ctx, p.TenantID); err != nil {
			if errors.Is(err, ErrInvalid) {
				continue // raced with another anchor; nothing to do
			}
			r.logger.Error().Err(err).
				Str("tenant_id", p.TenantID.String()).
				Msg("anchoring tenant failed")
			continue
		}
		anchored++
	}
	return anchored, nil
}

// checkpointObjectKey builds a deterministic WORM key for a checkpoint.
func checkpointObjectKey(tenantID uuid.UUID, from, to int64) string {
	return fmt.Sprintf("%s/attestation-checkpoints/%012d-%012d.json", tenantID.String(), from, to)
}
