package integration

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Integration EXTENSIBILITY #20 — conflict-resolution queue + mass-change guard.
//
// CONFLICT QUEUE. A Reconcile pass surfaces field-level divergences between a source
// record and its lex counterpart (ReconciliationReport.Conflicts). ConflictService
// PERSISTS those as OPEN rows an operator can list and resolve. Resolve applies the
// operator's choice (merge | override | ignore) to the org/identity map and closes
// the row. Rows are tenant-scoped, secret-free.
//
// MASS-CHANGE GUARD. A sync that would deactivate MORE than a configured percentage
// (mass_change_threshold_pct, default 20) of an endpoint's currently-mapped org
// entities is almost certainly a bad upstream feed (a truncated export, an auth
// glitch returning an empty roster), not a real org reorganisation. The guard runs a
// read-only PREVIEW, counts the would-be deactivations against the current active
// mapped count, and BLOCKS the live sync (the registry returns 409 with a guard
// summary) unless the operator passes ?force=true. This is the safety rail that stops
// one bad sync from silently de-provisioning an entire org tree.
// =============================================================================

// Conflict resolution choices (Conflict.Resolution domain).
const (
	// ResolutionMerge keeps the lex value but records that the source diverged (the
	// operator reconciled by hand / accepts the lex side as canonical with a note).
	ResolutionMerge = "merge"
	// ResolutionOverride writes the SOURCE value onto the lex record (source wins).
	ResolutionOverride = "override"
	// ResolutionIgnore dismisses the conflict with no data change (false positive /
	// intentional divergence).
	ResolutionIgnore = "ignore"
)

// MassChangeThresholdKey is the config key (non-secret number) holding the
// deactivation guard threshold as a PERCENT of mapped entities. Declared in
// schema.go and read from decrypted config.
const MassChangeThresholdKey = "mass_change_threshold_pct"

// DefaultMassChangeThresholdPct is the guard threshold when the endpoint does not
// set one: a sync deactivating more than 20% of mapped entities is blocked.
const DefaultMassChangeThresholdPct = 20.0

// SyncReportDeactivatedKey is the SyncReport.Metadata key carrying the count of
// records a sync (or preview) deactivated. The HR connector populates it so the
// guard reads a PRECISE deactivation count rather than inferring it from Updated.
const SyncReportDeactivatedKey = "deactivated"

// Conflict is one open/resolved field-level divergence between a source record and
// its lex counterpart. It is non-sensitive: identifiers + the diverging values + a
// suggested resolution. Secrets never land here.
type Conflict struct {
	ID          uuid.UUID  `json:"id"`
	EndpointID  uuid.UUID  `json:"endpoint_id"`
	ExternalID  string     `json:"external_id"`
	Field       string     `json:"field"`
	SourceValue string     `json:"source_value"`
	LexValue    string     `json:"lex_value"`
	Status      string     `json:"status"` // open | resolved
	Resolution  string     `json:"resolution,omitempty"`
	Suggested   string     `json:"suggested,omitempty"`
	DetectedAt  time.Time  `json:"detected_at"`
	ResolvedAt  *time.Time `json:"resolved_at,omitempty"`
	ResolvedBy  *uuid.UUID `json:"resolved_by,omitempty"`
}

// ConflictService persists + manages the conflict queue. It owns the conflict repo
// and the HR identity-map pool (to apply an override/ignore resolution to a mapping).
type ConflictService struct {
	repo   *repository.IntegrationConflictRepository
	idMap  *repository.HRIdentityMapRepository
	logger zerolog.Logger
	now    func() time.Time
}

// NewConflictService builds the service. idMap may be nil (Resolve then applies only
// the queue-row state change; the org/identity write is skipped with a logged note).
func NewConflictService(repo *repository.IntegrationConflictRepository, idMap *repository.HRIdentityMapRepository, logger zerolog.Logger) *ConflictService {
	return &ConflictService{
		repo:   repo,
		idMap:  idMap,
		logger: logger.With().Str("component", "lex-integration-conflicts").Logger(),
		now:    time.Now,
	}
}

// RecordFromReconcile persists one OPEN conflict per ReconItem of issue=conflict in a
// reconciliation report. It is idempotent: a re-reconcile refreshes still-open rows
// and leaves resolved rows untouched (the repo Upsert enforces this). It returns the
// number of conflict rows written/refreshed. Gaps (unmatched/orphan) are NOT
// conflicts and are skipped here.
func (s *ConflictService) RecordFromReconcile(ctx context.Context, tenantID, endpointID uuid.UUID, report ReconciliationReport) (int, error) {
	if s == nil || s.repo == nil {
		return 0, nil
	}
	written := 0
	for _, item := range report.Conflicts {
		if item.Issue != ReconIssueConflict {
			continue
		}
		field, sourceVal, lexVal := splitConflictDetail(item)
		row := &repository.IntegrationConflictRow{
			TenantID:    tenantID,
			EndpointID:  endpointID,
			ExternalID:  item.ExternalID,
			Field:       field,
			SourceValue: sourceVal,
			LexValue:    lexVal,
			Status:      repository.ConflictStatusOpen,
			Suggested:   item.Suggested,
			DetectedAt:  s.now().UTC(),
		}
		if _, err := s.repo.Upsert(ctx, row); err != nil {
			return written, fmt.Errorf("lex/integration: record conflict: %w", err)
		}
		written++
	}
	return written, nil
}

// List returns the endpoint's conflicts (tenant-scoped), optionally filtered by
// status (open|resolved); an empty status returns all.
func (s *ConflictService) List(ctx context.Context, tenantID, endpointID uuid.UUID, status string, limit int) ([]Conflict, error) {
	if s == nil || s.repo == nil {
		return []Conflict{}, nil
	}
	rows, err := s.repo.List(ctx, tenantID, endpointID, strings.TrimSpace(strings.ToLower(status)), limit)
	if err != nil {
		return nil, err
	}
	out := make([]Conflict, 0, len(rows))
	for i := range rows {
		out = append(out, conflictFromRow(rows[i]))
	}
	return out, nil
}

// Resolve applies the operator's choice to a conflict and closes it. For override it
// writes the source value onto the lex/identity map's mapping (best-effort: the
// queue row is always closed, and a failed downstream write is returned so the
// caller can surface it). merge/ignore are state-only (no data write). It is
// tenant-scoped; an unknown or already-resolved conflict yields ErrConflictNotOpen.
func (s *ConflictService) Resolve(ctx context.Context, tenantID, userID, conflictID uuid.UUID, resolution string) (*Conflict, error) {
	if s == nil || s.repo == nil {
		return nil, ErrConflictNotOpen
	}
	resolution = strings.ToLower(strings.TrimSpace(resolution))
	switch resolution {
	case ResolutionMerge, ResolutionOverride, ResolutionIgnore:
	default:
		return nil, fmt.Errorf("%w: %q (merge|override|ignore)", ErrInvalidResolution, resolution)
	}
	row, err := s.repo.Get(ctx, tenantID, conflictID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrConflictNotOpen
		}
		return nil, err
	}
	if row.Status != repository.ConflictStatusOpen {
		return nil, ErrConflictNotOpen
	}

	// Apply the choice to the org/identity map. override pushes the source value onto
	// the mapping; merge/ignore leave the lex side untouched.
	if resolution == ResolutionOverride {
		if err := s.applyOverride(ctx, tenantID, *row); err != nil {
			// Surface the downstream failure but DO NOT close the row — the operator
			// must retry once the underlying write can succeed.
			return nil, fmt.Errorf("lex/integration: apply override: %w", err)
		}
	}

	now := s.now().UTC()
	if err := s.repo.Resolve(ctx, tenantID, conflictID, resolution, userID, now); err != nil {
		if err == pgx.ErrNoRows {
			return nil, ErrConflictNotOpen
		}
		return nil, err
	}
	resolved, err := s.repo.Get(ctx, tenantID, conflictID)
	if err != nil {
		return nil, err
	}
	out := conflictFromRow(*resolved)
	return &out, nil
}

// applyOverride writes the source value of a conflict onto its identity mapping. The
// generic case stamps the override onto the mapping metadata (a precise per-field
// projection back onto the lex domain object is connector-specific; recording the
// accepted source value on the map row keeps the override auditable and idempotent
// without fabricating a write the connector cannot define). Best-effort when no
// identity map is wired.
func (s *ConflictService) applyOverride(ctx context.Context, tenantID uuid.UUID, row repository.IntegrationConflictRow) error {
	if s.idMap == nil {
		s.logger.Warn().Str("conflict_id", row.ID.String()).Msg("override resolution: no identity map wired; queue row closed without downstream write")
		return nil
	}
	existing, err := s.idMap.GetMapping(ctx, s.idMap.Pool(), tenantID, row.EndpointID, row.ExternalID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// No mapping to write the override onto; the override is recorded only on
			// the (closed) queue row. Not an error.
			return nil
		}
		return err
	}
	if existing.Metadata == nil {
		existing.Metadata = map[string]any{}
	}
	overrides, _ := existing.Metadata["field_overrides"].(map[string]any)
	if overrides == nil {
		overrides = map[string]any{}
	}
	overrides[row.Field] = row.SourceValue
	existing.Metadata["field_overrides"] = overrides
	_, err = s.idMap.UpsertMapping(ctx, s.idMap.Pool(), existing)
	return err
}

// =============================================================================
// Mass-change guard.
// =============================================================================

// MassChangeGuard blocks a sync that would deactivate too large a fraction of an
// endpoint's currently-mapped org entities. It reads the active mapped count from
// lex_hr_identity_map and the would-be deactivation count from a sync/preview report.
type MassChangeGuard struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

// NewMassChangeGuard builds the guard over the shared pool. A nil pool disables the
// guard (Check always passes) so it is safe to wire optionally.
func NewMassChangeGuard(db *pgxpool.Pool, logger zerolog.Logger) *MassChangeGuard {
	return &MassChangeGuard{db: db, logger: logger.With().Str("component", "lex-mass-change-guard").Logger()}
}

// MassChangeSummary is the non-sensitive breakdown returned when the guard trips, so
// the console can explain WHY the sync was blocked.
type MassChangeSummary struct {
	MappedEntities  int     `json:"mapped_entities"`
	WouldDeactivate int     `json:"would_deactivate"`
	ThresholdPct    float64 `json:"threshold_pct"`
	ChangePct       float64 `json:"change_pct"`
}

// MassChangeError is the typed error the guard returns when a sync exceeds the
// deactivation threshold. It carries the summary so the registry can render a 409
// body the operator understands.
type MassChangeError struct {
	Summary MassChangeSummary
}

func (e *MassChangeError) Error() string {
	return fmt.Sprintf("mass-change guard: sync would deactivate %d of %d mapped entities (%.1f%% > %.1f%% threshold)",
		e.Summary.WouldDeactivate, e.Summary.MappedEntities, e.Summary.ChangePct, e.Summary.ThresholdPct)
}

// Check inspects a sync/preview report against the endpoint's deactivation threshold.
// It returns a *MassChangeError when the would-be deactivations exceed the threshold
// percent of currently-mapped (active) entities, and nil otherwise. A guard with no
// pool, an endpoint with no mapped entities, or zero deactivations always passes.
func (g *MassChangeGuard) Check(ctx context.Context, endpoint model.IntegrationEndpoint, report SyncReport) error {
	if g == nil || g.db == nil {
		return nil
	}
	deactivations := reportDeactivations(report)
	if deactivations <= 0 {
		return nil
	}
	mapped, err := g.countActiveMappings(ctx, endpoint.TenantID, endpoint.ID)
	if err != nil {
		// Fail OPEN on a counting error (do not block a legitimate sync because the
		// guard could not read the denominator) but log it.
		g.logger.Error().Err(err).Str("endpoint_id", endpoint.ID.String()).Msg("mass-change guard: count mapped entities failed; allowing sync")
		return nil
	}
	if mapped <= 0 {
		return nil
	}
	threshold := MassChangeThresholdPct(endpoint.Config)
	changePct := (float64(deactivations) / float64(mapped)) * 100.0
	if changePct <= threshold {
		return nil
	}
	return &MassChangeError{Summary: MassChangeSummary{
		MappedEntities:  mapped,
		WouldDeactivate: deactivations,
		ThresholdPct:    threshold,
		ChangePct:       changePct,
	}}
}

// countActiveMappings counts the endpoint's currently-active identity-map rows — the
// denominator for the mass-change percentage. Tenant-scoped (tenant_id FIRST; RLS is
// a backstop on the pool).
func (g *MassChangeGuard) countActiveMappings(ctx context.Context, tenantID, endpointID uuid.UUID) (int, error) {
	var n int
	err := g.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM lex_hr_identity_map WHERE tenant_id = $1 AND endpoint_id = $2 AND active = true`,
		tenantID, endpointID).Scan(&n)
	return n, err
}

// MassChangeThresholdPct reads the endpoint's deactivation-guard threshold percent
// from config, defaulting to DefaultMassChangeThresholdPct when unset/blank/invalid.
// A non-positive configured value disables the guard (returns a huge threshold so no
// sync ever trips it).
func MassChangeThresholdPct(config map[string]any) float64 {
	raw := internalCfgFloat(config, MassChangeThresholdKey)
	if raw <= 0 {
		if _, present := config[MassChangeThresholdKey]; present {
			// Explicitly set to 0/blank/negative → operator disabled the guard.
			return 100_000
		}
		return DefaultMassChangeThresholdPct
	}
	return raw
}

// reportDeactivations reads the precise deactivation count a connector recorded on
// the report metadata (SyncReportDeactivatedKey). Connectors that do not record it
// contribute 0 (the guard then passes — it never GUESSES a deactivation count from
// the coarse Updated field, which would risk a false block).
func reportDeactivations(report SyncReport) int {
	if report.Metadata == nil {
		return 0
	}
	switch v := report.Metadata[SyncReportDeactivatedKey].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	default:
		return 0
	}
}

// =============================================================================
// Errors + mappers
// =============================================================================

// ErrConflictNotOpen is returned by Resolve when the target conflict does not exist
// (tenant-scoped) or is already resolved.
var ErrConflictNotOpen = fmt.Errorf("lex/integration: conflict not found or already resolved")

// ErrInvalidResolution is returned by Resolve for an unrecognised resolution choice.
var ErrInvalidResolution = fmt.Errorf("lex/integration: invalid resolution")

func conflictFromRow(row repository.IntegrationConflictRow) Conflict {
	return Conflict{
		ID:          row.ID,
		EndpointID:  row.EndpointID,
		ExternalID:  row.ExternalID,
		Field:       row.Field,
		SourceValue: row.SourceValue,
		LexValue:    row.LexValue,
		Status:      row.Status,
		Resolution:  row.Resolution,
		Suggested:   row.Suggested,
		DetectedAt:  row.DetectedAt,
		ResolvedAt:  row.ResolvedAt,
		ResolvedBy:  row.ResolvedBy,
	}
}

// splitConflictDetail derives (field, source_value, lex_value) from a ReconItem. The
// reconciler may populate the structured triple via the item's Detail in the form
// "field=X source=Y lex=Z"; when it does not, the whole Detail is recorded as the
// field-less divergence note so no information is lost.
func splitConflictDetail(item ReconItem) (field, sourceVal, lexVal string) {
	detail := item.Detail
	field = parseTagged(detail, "field")
	sourceVal = parseTagged(detail, "source")
	lexVal = parseTagged(detail, "lex")
	if field == "" {
		field = strings.TrimSpace(detail)
	}
	return field, sourceVal, lexVal
}

// parseTagged extracts the value following "<tag>=" up to the next " <word>=" token
// or end of string. It is a tolerant parser for the optional structured conflict
// detail; an absent tag yields "".
func parseTagged(s, tag string) string {
	prefix := tag + "="
	idx := strings.Index(s, prefix)
	if idx < 0 {
		return ""
	}
	rest := s[idx+len(prefix):]
	// Stop at the next " word=" delimiter.
	for _, other := range []string{" field=", " source=", " lex=", " suggested="} {
		if j := strings.Index(rest, other); j >= 0 {
			rest = rest[:j]
		}
	}
	return strings.TrimSpace(rest)
}

// internalCfgFloat reads a config value as a float, tolerating int/float/string
// encodings (the config round-trips through JSON + the masked-config echo).
func internalCfgFloat(config map[string]any, key string) float64 {
	v, ok := config[key]
	if !ok || v == nil {
		return 0
	}
	switch n := v.(type) {
	case int:
		return float64(n)
	case int64:
		return float64(n)
	case float64:
		return n
	case float32:
		return float64(n)
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		if err != nil {
			return 0
		}
		return f
	default:
		return 0
	}
}
