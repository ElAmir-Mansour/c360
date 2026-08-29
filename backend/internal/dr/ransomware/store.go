package ransomware

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// ErrNoCleanPoint is returned when no validated recovery point exists to curate
// as a clean restore target for a confirmed anomaly.
var ErrNoCleanPoint = errors.New("ransomware: no clean recovery point available to curate")

// Store persists ransomware baselines + signals and resolves the clean recovery
// point to curate. It holds no connection: every method takes a
// repository.DBTX so the caller chooses the execution context (pool for reads,
// the open transaction for state+event atomicity), matching the DR repository
// pattern. The store owns ONLY the dr_ransomware_* tables and reads recovery_point.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

// --- Baselines ------------------------------------------------------------

const upsertBaselineSQL = `
INSERT INTO dr_ransomware_baselines (
    tenant_id, stream_id, byte_rate_mean, byte_rate_var,
    change_rate_mean, change_rate_var, entropy_mean, entropy_var, samples, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
ON CONFLICT (tenant_id, stream_id) DO UPDATE SET
    byte_rate_mean = EXCLUDED.byte_rate_mean,
    byte_rate_var = EXCLUDED.byte_rate_var,
    change_rate_mean = EXCLUDED.change_rate_mean,
    change_rate_var = EXCLUDED.change_rate_var,
    entropy_mean = EXCLUDED.entropy_mean,
    entropy_var = EXCLUDED.entropy_var,
    samples = EXCLUDED.samples,
    updated_at = now()`

// UpsertBaseline writes (creates or replaces) a stream's learned baseline.
func (s *Store) UpsertBaseline(ctx context.Context, db repository.DBTX, b Baseline) error {
	if b.TenantID == "" || b.StreamID == "" {
		return fmt.Errorf("ransomware: baseline requires tenant_id and stream_id")
	}
	if _, err := db.Exec(ctx, upsertBaselineSQL,
		b.TenantID, b.StreamID, b.ByteRateMean, b.ByteRateVar,
		b.ChangeRateMean, b.ChangeRateVar, b.EntropyMean, b.EntropyVar, int64(b.Samples),
	); err != nil {
		return fmt.Errorf("ransomware: upserting baseline for stream %s: %w", b.StreamID, err)
	}
	return nil
}

const selectBaselineSQL = `
SELECT tenant_id, stream_id, byte_rate_mean, byte_rate_var,
       change_rate_mean, change_rate_var, entropy_mean, entropy_var, samples, updated_at
FROM dr_ransomware_baselines WHERE tenant_id = $1 AND stream_id = $2`

// GetBaseline loads a stream's persisted baseline. ok is false when none exists.
func (s *Store) GetBaseline(ctx context.Context, db repository.DBTX, tenantID, streamID string) (Baseline, bool, error) {
	var b Baseline
	var samples int64
	err := db.QueryRow(ctx, selectBaselineSQL, tenantID, streamID).Scan(
		&b.TenantID, &b.StreamID, &b.ByteRateMean, &b.ByteRateVar,
		&b.ChangeRateMean, &b.ChangeRateVar, &b.EntropyMean, &b.EntropyVar, &samples, &b.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Baseline{}, false, nil
		}
		return Baseline{}, false, fmt.Errorf("ransomware: loading baseline for stream %s: %w", streamID, err)
	}
	if samples > 0 {
		b.Samples = uint64(samples)
	}
	return b, true, nil
}

const listBaselinesSQL = `
SELECT tenant_id, stream_id, byte_rate_mean, byte_rate_var,
       change_rate_mean, change_rate_var, entropy_mean, entropy_var, samples, updated_at
FROM dr_ransomware_baselines ORDER BY stream_id`

// SystemListBaselines returns every persisted baseline ACROSS ALL TENANTS so
// the leader-singleton detector loop can warm its in-memory EWMAs on startup.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design.
func (s *Store) SystemListBaselines(ctx context.Context, db repository.DBTX) ([]Baseline, error) {
	rows, err := db.Query(ctx, listBaselinesSQL)
	if err != nil {
		return nil, fmt.Errorf("ransomware: listing baselines: %w", err)
	}
	defer rows.Close()

	var out []Baseline
	for rows.Next() {
		var b Baseline
		var samples int64
		if err := rows.Scan(
			&b.TenantID, &b.StreamID, &b.ByteRateMean, &b.ByteRateVar,
			&b.ChangeRateMean, &b.ChangeRateVar, &b.EntropyMean, &b.EntropyVar, &samples, &b.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("ransomware: scanning baseline: %w", err)
		}
		if samples > 0 {
			b.Samples = uint64(samples)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ransomware: reading baselines: %w", err)
	}
	return out, nil
}

// --- Signals --------------------------------------------------------------

const insertSignalSQL = `
INSERT INTO dr_ransomware_signals (
    tenant_id, stream_id, signal_kind, severity, observed, baseline, ratio, threshold,
    sample_seq, source_lsn, curated_recovery_point_id, detail, observed_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING id, created_at`

// InsertSignal persists one fired signal and populates its generated fields.
func (s *Store) InsertSignal(ctx context.Context, db repository.DBTX, sig *Signal) error {
	if sig.TenantID == "" || sig.StreamID == "" {
		return fmt.Errorf("ransomware: signal requires tenant_id and stream_id")
	}
	if !ValidSignalKind(sig.Kind) {
		return fmt.Errorf("ransomware: invalid signal kind %q", sig.Kind)
	}
	if sig.Severity == "" {
		sig.Severity = SeverityWarning
	}
	if sig.ObservedAt.IsZero() {
		sig.ObservedAt = time.Now().UTC()
	}
	err := db.QueryRow(ctx, insertSignalSQL,
		sig.TenantID, sig.StreamID, sig.Kind, sig.Severity, sig.Observed, sig.Baseline,
		sig.Ratio, sig.Threshold, int64(sig.SampleSeq), nullString(sig.SourceLSN),
		nullString(sig.CuratedRecoveryPointID), sig.Detail, sig.ObservedAt,
	).Scan(&sig.ID, &sig.CreatedAt)
	if err != nil {
		return fmt.Errorf("ransomware: inserting %s signal for stream %s: %w", sig.Kind, sig.StreamID, err)
	}
	return nil
}

const listSignalsByTenantSQL = `
SELECT id, tenant_id, stream_id, signal_kind, severity, observed, baseline, ratio, threshold,
       sample_seq, source_lsn, curated_recovery_point_id, detail, observed_at, created_at
FROM dr_ransomware_signals
WHERE tenant_id = $1
ORDER BY observed_at DESC, created_at DESC
LIMIT $2`

// ListSignals returns a tenant's most recent signals (newest first), capped by
// limit. Tenant-scoped for the request-path GET /ransomware/signals.
func (s *Store) ListSignals(ctx context.Context, db repository.DBTX, tenantID string, limit int) ([]Signal, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := db.Query(ctx, listSignalsByTenantSQL, tenantID, limit)
	if err != nil {
		return nil, fmt.Errorf("ransomware: listing signals: %w", err)
	}
	defer rows.Close()
	return scanSignals(rows)
}

const listSignalsByStreamSQL = `
SELECT id, tenant_id, stream_id, signal_kind, severity, observed, baseline, ratio, threshold,
       sample_seq, source_lsn, curated_recovery_point_id, detail, observed_at, created_at
FROM dr_ransomware_signals
WHERE tenant_id = $1 AND stream_id = $2
ORDER BY observed_at DESC, created_at DESC
LIMIT $3`

// ListSignalsByStream returns a stream's most recent signals (newest first).
func (s *Store) ListSignalsByStream(ctx context.Context, db repository.DBTX, tenantID, streamID string, limit int) ([]Signal, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := db.Query(ctx, listSignalsByStreamSQL, tenantID, streamID, limit)
	if err != nil {
		return nil, fmt.Errorf("ransomware: listing signals for stream %s: %w", streamID, err)
	}
	defer rows.Close()
	return scanSignals(rows)
}

func scanSignals(rows pgx.Rows) ([]Signal, error) {
	out := []Signal{}
	for rows.Next() {
		var sig Signal
		var sampleSeq int64
		var sourceLSN, curatedRP sql.NullString
		if err := rows.Scan(
			&sig.ID, &sig.TenantID, &sig.StreamID, &sig.Kind, &sig.Severity,
			&sig.Observed, &sig.Baseline, &sig.Ratio, &sig.Threshold,
			&sampleSeq, &sourceLSN, &curatedRP, &sig.Detail, &sig.ObservedAt, &sig.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("ransomware: scanning signal: %w", err)
		}
		if sampleSeq > 0 {
			sig.SampleSeq = uint64(sampleSeq)
		}
		if sourceLSN.Valid {
			sig.SourceLSN = sourceLSN.String
		}
		if curatedRP.Valid {
			sig.CuratedRecoveryPointID = curatedRP.String
		}
		out = append(out, sig)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ransomware: reading signals: %w", err)
	}
	return out, nil
}

// --- Clean recovery-point curation ----------------------------------------

// CleanPoint is the minimal recovery-point projection the curator pins. It is
// read from the shared recovery_point table (owned by the DR repository); this
// store only reads it and toggles legal_hold on it.
type CleanPoint struct {
	ID         string
	GroupID    string
	MarkerLSN  string
	SealedAt   time.Time
	ObjectKeys []byte // raw JSONB; the caller mirrors object-lock legal-holds
}

const systemLatestCleanPointSQL = `
SELECT id, group_id, marker_lsn, sealed_at, object_keys
FROM recovery_point
WHERE tenant_id = $1
  AND is_validated = true
  AND sealed_at <= $2
ORDER BY sealed_at DESC
LIMIT 1`

// SystemLatestCleanRecoveryPoint returns the newest VALIDATED recovery point
// sealed at or before notLaterThan — the last-known-clean restore target just
// prior to the anomaly window. notLaterThan is typically the start of the window
// that confirmed the anomaly, so a point sealed during the attack is excluded.
// Returns ErrNoCleanPoint when none qualifies.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (the
// detector loop runs as a leader singleton, like the RPO monitor).
func (s *Store) SystemLatestCleanRecoveryPoint(ctx context.Context, db repository.DBTX, tenantID string, notLaterThan time.Time) (*CleanPoint, error) {
	if notLaterThan.IsZero() {
		notLaterThan = time.Now().UTC()
	}
	var cp CleanPoint
	err := db.QueryRow(ctx, systemLatestCleanPointSQL, tenantID, notLaterThan.UTC()).
		Scan(&cp.ID, &cp.GroupID, &cp.MarkerLSN, &cp.SealedAt, &cp.ObjectKeys)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("tenant %s before %s: %w", tenantID, notLaterThan.Format(time.RFC3339), ErrNoCleanPoint)
		}
		return nil, fmt.Errorf("ransomware: loading clean recovery point: %w", err)
	}
	return &cp, nil
}

const pinCleanPointSQL = `
UPDATE recovery_point SET legal_hold = true
WHERE tenant_id = $1 AND id = $2`

// SystemPinCleanRecoveryPoint sets legal_hold on a recovery point so it survives
// the lifecycle thinner and break-glass governance bypass — the ransomware-safe
// floor. It mirrors repository.SetRecoveryPointLegalHold's column write but on
// the system path (no SET LOCAL tenant) for the detector loop. Returns
// model-agnostic affected-row info via ok.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design.
func (s *Store) SystemPinCleanRecoveryPoint(ctx context.Context, db repository.DBTX, tenantID, recoveryPointID string) (bool, error) {
	tag, err := db.Exec(ctx, pinCleanPointSQL, tenantID, recoveryPointID)
	if err != nil {
		return false, fmt.Errorf("ransomware: pinning clean recovery point %s: %w", recoveryPointID, err)
	}
	return tag.RowsAffected() > 0, nil
}

func nullString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
