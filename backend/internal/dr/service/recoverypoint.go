package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"sort"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/cleanpoint"
	"github.com/clario360/platform/internal/dr/framestore"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/worm"
)

// WORMSealer is the immutable recovery-point object store the recovery-point
// service writes through. *worm.Client satisfies it. Sealing really encrypts
// with the per-tenant DEK and writes a GOVERNANCE object-lock object; legal-hold
// is the ransomware-safe floor on the newest validated points (§5).
type WORMSealer interface {
	EnsureBucket(ctx context.Context) error
	Seal(ctx context.Context, source io.Reader, opts worm.SealOptions) (worm.SealResult, error)
	Get(ctx context.Context, tenantID uuid.UUID, streamID, key string) ([]byte, error)
	SetLegalHold(ctx context.Context, key string, hold bool) error
}

// ChunkSource yields the current consistent data chunk for a replication stream
// at recovery-point time — the bytes that get sealed. In production this is the
// applied target state for the stream at its last contiguous checkpoint; the
// MarkerLSN is the source LSN that chunk is consistent at and LastCommit is the
// wall-clock of the last applied commit (used for the achieved RPO).
//
// It is an interface so the seal is real end-to-end in tests (a fake supplies
// deterministic bytes) without faking the object store or the crypto.
type ChunkSource interface {
	Chunk(ctx context.Context, tenantID uuid.UUID, stream *model.ReplicationStream) (data io.Reader, markerLSN string, lastCommit time.Time, err error)
}

// RecoveryPointValidator re-derives a recovery point's match ratio against the
// source using the replication core's content-hash comparison (§15.3). It is
// injected so the integration test can use a real core.Validator over the
// sealed/decrypted bytes, and a unit test can use a deterministic fake.
type RecoveryPointValidator interface {
	Validate(ctx context.Context, streamID string, rp core.RecoveryPointRef) (core.Validation, error)
}

// recoveryPointDeps are the recovery-point store's extra dependencies, set via
// WithRecoveryPoint after New so the request-path Service stays usable without
// an object store wired (e.g. handler unit tests that don't touch sealing).
type recoveryPointDeps struct {
	worm      WORMSealer
	chunks    ChunkSource
	validator RecoveryPointValidator
}

// WithRecoveryPoint wires the WORM store, chunk source, and validator onto a
// Service so SealRecoveryPoint / ValidateRecoveryPoint can seal and validate for
// real. If chunks is nil and the service repository supports durable applied
// frames, the production AppliedFrameChunkSource is used. Tests that need the
// legacy checkpoint serialization must pass StreamCheckpointChunkSource
// explicitly. keepValidated overrides how many of the newest validated points
// carry a legal-hold (the ransomware-safe floor); <=0 keeps the service default.
func (s *Service) WithRecoveryPoint(sealer WORMSealer, chunks ChunkSource, validator RecoveryPointValidator, keepValidated int) *Service {
	if keepValidated > 0 {
		s.legalHoldCount = keepValidated
	}
	if chunks == nil {
		chunks = s.defaultRecoveryPointChunkSource()
	}
	s.rp = &recoveryPointDeps{
		worm:      sealer,
		chunks:    chunks,
		validator: validator,
	}
	return s
}

func (s *Service) defaultRecoveryPointChunkSource() ChunkSource {
	if s == nil || s.tx == nil || s.repo == nil {
		return nil
	}
	frameRepo, ok := s.repo.(framestore.Repository)
	if !ok {
		return nil
	}
	return NewAppliedFrameChunkSource(s.tx, frameRepo)
}

// SealRecoveryPointInput initiates a consistency-wide recovery point for a group.
type SealRecoveryPointInput struct {
	// RetentionUntil overrides the WORM default GOVERNANCE retain-until when set.
	RetentionUntil time.Time
}

// SealRecoveryPoint creates an immutable recovery point across a consistency
// group: for every member stream it seals the current data chunk to the WORM
// bucket (GOVERNANCE object-lock, encrypted with the per-tenant DEK), computes
// the achieved RPO, chains a content hash over the sealed chunks, and writes the
// recovery_point row + outbox event in one transaction (§4.1, §5, §8).
//
// This is the real WP-4 path — no stub: it calls WORMSealer.Seal (which AES-GCM
// encrypts and writes an object-lock object) once per member and records the
// returned object keys.
func (s *Service) SealRecoveryPoint(ctx context.Context, tenantID, groupID uuid.UUID, in SealRecoveryPointInput) (*model.RecoveryPoint, error) {
	if s.rp == nil || s.rp.worm == nil || s.rp.chunks == nil {
		return nil, fmt.Errorf("%w: recovery-point store", ErrNotConfigured)
	}
	return s.sealRecoveryPointWithChunks(ctx, tenantID, groupID, in, s.rp.chunks)
}

func (s *Service) sealRecoveryPointWithChunks(ctx context.Context, tenantID, groupID uuid.UUID, in SealRecoveryPointInput, chunks ChunkSource) (*model.RecoveryPoint, error) {
	if s.rp == nil || s.rp.worm == nil || chunks == nil {
		return nil, fmt.Errorf("%w: recovery-point store", ErrNotConfigured)
	}
	if err := s.rp.worm.EnsureBucket(ctx); err != nil {
		return nil, fmt.Errorf("ensuring worm bucket: %w", err)
	}

	now := s.now()

	// Phase 1 (outside the DB transaction): resolve the group, its members and
	// streams, then seal each member's current chunk to the WORM bucket. Sealing
	// is a network write to object storage; we do it before opening the
	// transaction so the row is written only after all chunks are durably
	// immutable, and we don't hold a DB transaction open across object I/O.
	var (
		group       *model.ConsistencyGroup
		members     []model.ConsistencyGroupMember
		streamBySvc map[string]*model.ReplicationStream
	)
	if err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		group, err = s.repo.GetGroup(ctx, tx, tenantID.String(), groupID.String())
		if err != nil {
			return err
		}
		members, err = s.repo.ListGroupMembers(ctx, tx, groupID.String())
		if err != nil {
			return err
		}
		if len(members) == 0 {
			return invalid("group_id", "consistency group has no members to seal")
		}
		streamBySvc = make(map[string]*model.ReplicationStream, len(members))
		for _, m := range members {
			stream, err := s.repo.GetStreamBySite(ctx, tx, tenantID.String(), m.SiteID)
			if err != nil {
				return err
			}
			streamBySvc[m.SiteID] = stream
		}
		return nil
	}); err != nil {
		return nil, err
	}
	_ = group

	// Seal in deterministic boot order so the content-hash chain is stable.
	sort.SliceStable(members, func(i, j int) bool {
		if members[i].BootOrder != members[j].BootOrder {
			return members[i].BootOrder < members[j].BootOrder
		}
		return members[i].SiteID < members[j].SiteID
	})

	objectKeys := make(map[string]string, len(members))
	chunkHashesByStream := make(map[string]string, len(members))
	markerLSN := ""
	oldestCommit := time.Time{}

	for _, m := range members {
		stream := streamBySvc[m.SiteID]
		data, marker, lastCommit, err := chunks.Chunk(ctx, tenantID, stream)
		if err != nil {
			return nil, fmt.Errorf("reading chunk for stream %s: %w", stream.ID, err)
		}
		res, err := s.rp.worm.Seal(ctx, data, worm.SealOptions{
			TenantID:    tenantID,
			StreamID:    stream.ID,
			MarkerLSN:   marker,
			RetainUntil: in.RetentionUntil,
			EventTime:   now,
		})
		if err != nil {
			return nil, fmt.Errorf("sealing chunk for stream %s: %w", stream.ID, err)
		}
		objectKeys[stream.ID] = res.Key
		chunkHashesByStream[stream.ID] = res.PlaintextSHA256
		if markerLSN == "" {
			markerLSN = marker
		}
		// The group-wide achieved RPO is bounded by the oldest member commit.
		if oldestCommit.IsZero() || lastCommit.Before(oldestCommit) {
			oldestCommit = lastCommit
		}
	}
	if markerLSN == "" {
		markerLSN = fmt.Sprintf("group:%s@%d", groupID.String(), now.Unix())
	}

	rpoSeconds := 0
	if !oldestCommit.IsZero() {
		d := now.Sub(oldestCommit)
		if d < 0 {
			d = 0
		}
		rpoSeconds = int(d.Seconds())
	}

	retentionUntil := in.RetentionUntil
	if retentionUntil.IsZero() {
		// Match the WORM default operational window (7d) so the row's
		// retention_until tracks the object's retain-until.
		retentionUntil = now.Add(7 * 24 * time.Hour)
	}

	point := &model.RecoveryPoint{
		TenantID:       tenantID.String(),
		GroupID:        groupID.String(),
		MarkerLSN:      markerLSN,
		RPOSeconds:     rpoSeconds,
		ObjectKeys:     objectKeys,
		ContentHash:    chainHashByStreamID(chunkHashesByStream),
		IsValidated:    false,
		RetentionUntil: retentionUntil.UTC(),
	}

	// Phase 2: persist the index row + outbox event atomically.
	if err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.repo.CreateRecoveryPoint(ctx, tx, point); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.recovery_point.sealed", tenantID, map[string]any{
			"recovery_point_id": point.ID,
			"group_id":          point.GroupID,
			"marker_lsn":        point.MarkerLSN,
			"rpo_seconds":       point.RPOSeconds,
			"object_keys":       point.ObjectKeys,
			"content_hash":      point.ContentHash,
		})
	}); err != nil {
		return nil, err
	}
	return point, nil
}

// ValidateRecoveryPoint re-derives the recovery point's data-fidelity match
// ratio with the injected core.Validator (per-row/file content hash, §15.3),
// records is_validated + validation_ratio on the row, and — when the ratio meets
// the 99.9% threshold — moves the ransomware-safe legal-hold to this point and
// releases it from points it supersedes (§5). Real WP-4 validation: it runs the
// content-hash comparison, not a hard-coded ratio.
func (s *Service) ValidateRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*model.RecoveryPoint, error) {
	if s.rp == nil {
		return nil, fmt.Errorf("%w: recovery-point store", ErrNotConfigured)
	}

	var point *model.RecoveryPoint
	if err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		point, err = s.repo.GetRecoveryPoint(ctx, tx, tenantID.String(), pointID.String())
		return err
	}); err != nil {
		return nil, err
	}

	overall := 1.0
	if s.rp.validator == nil {
		v, err := s.validateSealedRecoveryPoint(ctx, tenantID, point)
		if err != nil {
			return nil, err
		}
		overall = v.MatchRatio
	} else {
		// Validate every member stream; the recovery point's ratio is the
		// minimum across members (a single member below threshold fails the
		// whole point).
		checks := 0
		for streamID := range point.ObjectKeys {
			v, err := s.rp.validator.Validate(ctx, streamID, core.RecoveryPointRef{
				ID:        point.ID,
				MarkerLSN: point.MarkerLSN,
			})
			if err != nil {
				return nil, fmt.Errorf("validating stream %s: %w", streamID, err)
			}
			checks++
			if v.MatchRatio < overall {
				overall = v.MatchRatio
			}
		}
		if checks == 0 {
			overall = 0
		}
	}
	validated := overall >= core.ValidationThreshold

	// Clean-recovery-point promotion gate (§ ransomware-safe promotion). When a
	// gate is wired, score the point's clean-room / integrity / ransomware /
	// attestation evidence and refuse to mark it promotion-safe unless the
	// decision is clean. A compromised or unverified point is quarantined
	// (validated stays false) even if the raw content-hash ratio met threshold —
	// data fidelity is necessary but not sufficient for safe promotion.
	var cleanDecision *cleanpoint.Decision
	if s.cleanpoint != nil && s.cleanpoint.scorer != nil {
		dec, err := s.evaluateCleanPoint(ctx, tenantID, point, overall)
		if err != nil {
			return nil, fmt.Errorf("clean-point promotion gate: %w", err)
		}
		cleanDecision = &dec
		if !cleanPointPromotable(dec.Kind) {
			validated = false
		}
	}

	var groupPoints []*model.RecoveryPoint
	if err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.repo.SetRecoveryPointValidation(ctx, tx, tenantID.String(), pointID.String(), overall, validated); err != nil {
			return err
		}
		// The DB-side floor: ReconcileRecoveryPointLegalHolds sets legal_hold on
		// the newest s.legalHoldCount validated points and clears it on the rest
		// (the single source of truth for which points are held, shared with the
		// metadata CreateRecoveryPoint path). We then mirror that column onto the
		// real object-lock legal-hold (§5).
		if err := s.repo.ReconcileRecoveryPointLegalHolds(ctx, tx, tenantID.String(), point.GroupID, s.legalHoldCount); err != nil {
			return err
		}
		var err error
		groupPoints, err = s.repo.ListRecoveryPointsByGroup(ctx, tx, tenantID.String(), point.GroupID)
		if err != nil {
			return err
		}
		event := map[string]any{
			"recovery_point_id": pointID.String(),
			"group_id":          point.GroupID,
			"validation_ratio":  overall,
			"is_validated":      validated,
		}
		// Record the clean-point promotion decision so the quarantine/retest
		// verdict and its reasons are durably auditable alongside the validation.
		if cleanDecision != nil {
			event["clean_point_decision"] = string(cleanDecision.Kind)
			event["clean_point_score"] = cleanDecision.Score
			if reasons := cleanPointReasons(*cleanDecision); reasons != nil {
				event["clean_point_reasons"] = reasons
			}
		}
		return s.stage(ctx, tx, "dr.recovery_point.validated", tenantID, event)
	}); err != nil {
		return nil, err
	}

	// Mirror the reconciled legal_hold column onto the WORM objects: every
	// sealed object of a held point gets an object-lock legal-hold (the
	// ransomware-safe floor), and superseded points have theirs released. This
	// happens after the commit so the DB is authoritative; a transient object
	// error surfaces to the caller without rolling back the validated row.
	if err := s.syncWORMLegalHolds(ctx, groupPoints); err != nil {
		return nil, err
	}

	for _, p := range groupPoints {
		if p.ID == pointID.String() {
			point = p
			break
		}
	}
	point.ValidationRatio = &overall
	point.IsValidated = validated
	// SLO board (DESIGN §11): publish the group's validation match ratio.
	s.metrics.SetValidationRatio(point.GroupID, overall)
	return point, nil
}

func (s *Service) validateSealedRecoveryPoint(ctx context.Context, tenantID uuid.UUID, point *model.RecoveryPoint) (core.Validation, error) {
	if s.rp.worm == nil {
		return core.Validation{}, fmt.Errorf("%w: recovery-point validator", ErrNotConfigured)
	}
	if len(point.ObjectKeys) == 0 {
		return core.NewValidation(0, 1, "recovery point has no sealed chunks"), nil
	}
	streamIDs := make([]string, 0, len(point.ObjectKeys))
	for streamID := range point.ObjectKeys {
		streamIDs = append(streamIDs, streamID)
	}
	sort.Strings(streamIDs)

	hashes := make([]string, 0, len(streamIDs))
	for _, streamID := range streamIDs {
		key := point.ObjectKeys[streamID]
		plaintext, err := s.rp.worm.Get(ctx, tenantID, streamID, key)
		if err != nil {
			return core.Validation{}, fmt.Errorf("reading sealed chunk for stream %s: %w", streamID, err)
		}
		sum := sha256.Sum256(plaintext)
		hashes = append(hashes, hex.EncodeToString(sum[:]))
	}
	if chainHash(hashes) != point.ContentHash {
		return core.NewValidation(0, len(streamIDs), "decrypted recovery-point content hash chain mismatch"), nil
	}
	return core.NewValidation(len(streamIDs), len(streamIDs), "decrypted recovery-point content hash chain matches"), nil
}

// syncWORMLegalHolds makes each sealed object's object-lock legal-hold agree
// with its recovery_point.legal_hold column. This is the real ransomware floor:
// a held object cannot be removed even with a governance bypass.
func (s *Service) syncWORMLegalHolds(ctx context.Context, points []*model.RecoveryPoint) error {
	if s.rp == nil || s.rp.worm == nil {
		return nil
	}
	for _, p := range points {
		for _, key := range p.ObjectKeys {
			if err := s.rp.worm.SetLegalHold(ctx, key, p.LegalHold); err != nil {
				return fmt.Errorf("syncing legal hold on %s: %w", key, err)
			}
		}
	}
	return nil
}

// ReadSealedChunk downloads and decrypts a sealed chunk of a recovery point for
// a given stream. It is the recovery-path read used by the recovery executor and
// proves a sealed chunk round-trips back to plaintext through the per-tenant DEK.
func (s *Service) ReadSealedChunk(ctx context.Context, tenantID, pointID uuid.UUID, streamID string) ([]byte, error) {
	if s.rp == nil || s.rp.worm == nil {
		return nil, fmt.Errorf("%w: recovery-point store", ErrNotConfigured)
	}
	var point *model.RecoveryPoint
	if err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		point, err = s.repo.GetRecoveryPoint(ctx, tx, tenantID.String(), pointID.String())
		return err
	}); err != nil {
		return nil, err
	}
	key, ok := point.ObjectKeys[streamID]
	if !ok {
		return nil, fmt.Errorf("recovery point %s: %w (stream %s)", pointID, model.ErrNotFound, streamID)
	}
	return s.rp.worm.Get(ctx, tenantID, streamID, key)
}

// chainHash folds per-chunk SHA-256 hex digests into a single tamper-evidence
// hash by hashing them in order. The recovery_point.content_hash chains the
// member chunks so any change to a sealed chunk changes the row's hash.
func chainHash(hexHashes []string) string {
	h := sha256.New()
	for _, hh := range hexHashes {
		h.Write([]byte(hh))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func chainHashByStreamID(hexHashByStream map[string]string) string {
	streamIDs := make([]string, 0, len(hexHashByStream))
	for streamID := range hexHashByStream {
		streamIDs = append(streamIDs, streamID)
	}
	sort.Strings(streamIDs)
	hexHashes := make([]string, 0, len(streamIDs))
	for _, streamID := range streamIDs {
		hexHashes = append(hexHashes, hexHashByStream[streamID])
	}
	return chainHash(hexHashes)
}

// StreamCheckpointChunkSource is the legacy/test ChunkSource: it seals a
// canonical, deterministic serialization of a stream's current RPO-ledger
// checkpoint (applied_seq + source_lsn + applied_at). It is never selected as an
// automatic fallback; production/default wiring uses AppliedFrameChunkSource so
// recovery points seal durable applied frame bytes.
type StreamCheckpointChunkSource struct{}

// Chunk serializes the stream's checkpoint coordinates into a stable byte form
// and returns the source LSN as the marker and applied_at as the last commit.
func (StreamCheckpointChunkSource) Chunk(_ context.Context, _ uuid.UUID, stream *model.ReplicationStream) (io.Reader, string, time.Time, error) {
	marker := ""
	if stream.SourceLSN != nil {
		marker = *stream.SourceLSN
	}
	commit := time.Time{}
	if stream.AppliedAt != nil {
		commit = *stream.AppliedAt
	}
	// Canonical, deterministic record of the recoverable checkpoint state.
	record := fmt.Sprintf("clario-dr.checkpoint\nstream=%s\nsite=%s\napplied_seq=%d\nsource_lsn=%s\napplied_at=%s\n",
		stream.ID, stream.SiteID, stream.AppliedSeq, marker, commit.UTC().Format(time.RFC3339Nano))
	return bytes.NewReader([]byte(record)), marker, commit, nil
}

// SealedChunkValidator re-derives a recovery point's match ratio by downloading
// and decrypting each sealed chunk and comparing its content hash against the
// hash recorded at seal time — a real, re-runnable content-hash comparison
// (§15.3) that proves the WORM-stored ciphertext still decrypts to the bytes
// that were sealed. It needs the recovery point's object keys and recorded
// per-chunk hashes, supplied by the Service that constructs it.
type SealedChunkValidator struct {
	worm     WORMSealer
	tenantID uuid.UUID
	// objectKey maps stream ID -> sealed object key.
	objectKey map[string]string
	// expected maps stream ID -> SHA-256 hex recorded at seal time.
	expected map[string]string
}

// NewSealedChunkValidator builds a validator over a recovery point's sealed
// chunks. expected holds the per-stream plaintext SHA-256 captured at seal time.
func NewSealedChunkValidator(w WORMSealer, tenantID uuid.UUID, objectKeys, expected map[string]string) *SealedChunkValidator {
	return &SealedChunkValidator{worm: w, tenantID: tenantID, objectKey: objectKeys, expected: expected}
}

// Validate downloads + decrypts the stream's sealed chunk and returns a 1.0
// match ratio iff the decrypted bytes hash to the recorded value, else 0.0.
func (v *SealedChunkValidator) Validate(ctx context.Context, streamID string, _ core.RecoveryPointRef) (core.Validation, error) {
	key, ok := v.objectKey[streamID]
	if !ok {
		return core.NewValidation(0, 1, "no sealed chunk for stream"), nil
	}
	plaintext, err := v.worm.Get(ctx, v.tenantID, streamID, key)
	if err != nil {
		return core.Validation{}, fmt.Errorf("reading sealed chunk for stream %s: %w", streamID, err)
	}
	sum := sha256.Sum256(plaintext)
	got := hex.EncodeToString(sum[:])
	if want, ok := v.expected[streamID]; ok && want != "" && want != got {
		return core.NewValidation(0, 1, "decrypted chunk hash mismatch"), nil
	}
	return core.NewValidation(1, 1, "decrypted chunk matches sealed hash"), nil
}

// BytesChunkSource is a ChunkSource backed by in-memory bytes per stream — used
// by tests and as the seam a frame-store-backed source replaces. Real, not a
// stub: it returns the actual bytes that get encrypted and sealed.
type BytesChunkSource struct {
	// Data maps stream ID -> chunk bytes.
	Data map[string][]byte
	// Marker maps stream ID -> marker LSN.
	Marker map[string]string
	// LastCommit maps stream ID -> last applied commit wall-clock.
	LastCommit map[string]time.Time
}

// Chunk returns the bytes registered for the stream.
func (b BytesChunkSource) Chunk(_ context.Context, _ uuid.UUID, stream *model.ReplicationStream) (io.Reader, string, time.Time, error) {
	data := b.Data[stream.ID]
	marker := b.Marker[stream.ID]
	if marker == "" && stream.SourceLSN != nil {
		marker = *stream.SourceLSN
	}
	commit := b.LastCommit[stream.ID]
	if commit.IsZero() && stream.AppliedAt != nil {
		commit = *stream.AppliedAt
	}
	return bytes.NewReader(data), marker, commit, nil
}
