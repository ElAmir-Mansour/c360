package integration

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Maker-checker (#13 — integration change governance / separation of duties).
//
// A configuration change to a PROTECTED integration endpoint must be PROPOSED by
// one operator (the MAKER) and APPROVED by a second (the CHECKER) before it is
// applied. An endpoint is PROTECTED when it is:
//
//   - status=active AND running against a PRODUCTION environment, OR
//   - a GOV-GATED kind (najiz / nafath_verify, or esign with provider=emdha).
//
// Propose parks a pending change (status=pending, applied=false) carrying the
// operator-submitted proposed config + a SECRET-MASKED diff; the registry does NOT
// apply it. Approve re-runs the change through the registry Update path (enforcing
// approver != requester where SoD is configured); Reject discards it. A NON-protected
// endpoint never lands a pending change — Propose signals apply-now to the registry,
// which applies immediately.
//
// SECRET CUSTODY. The diff MASKS every secret field (__redacted__ -> __redacted__),
// so a reviewer sees that a secret CHANGED without ever seeing the value. The stored
// proposed_config carries the redaction sentinel for unchanged secrets (the standard
// merge-on-update signal) and the new cleartext for a changed secret — which the repo
// re-encrypts on apply, exactly as a direct Update would. Cleartext never reaches the
// diff, an API response, or a log.
// =============================================================================

// EndpointUpdater is the seam ChangeGateService.Approve uses to apply a stored
// proposed config through the registry's normal Update path. The
// IntegrationRegistryService satisfies it (ApplyProposedConfig). Taking it as a
// narrow interface keeps this package free of an import cycle on package service,
// mirroring the DLQ ReplayRunner seam. The implementation re-runs the same
// merge/validate/encrypt/audit path a direct Update would.
type EndpointUpdater interface {
	// ApplyProposedConfig applies an approved change's proposed config to the endpoint
	// (merge-on-update semantics: a returning sentinel keeps the stored ciphertext),
	// returning the applied (masked) endpoint. tenantID/userID scope the apply.
	ApplyProposedConfig(ctx context.Context, tenantID, userID, endpointID uuid.UUID, proposedConfig map[string]any) (*model.IntegrationEndpoint, error)
}

// PendingChangeDiffItem is one before/after entry in a pending change's diff. For a
// SECRET field, Old/New are MASKED (the redaction sentinel), and Secret=true so the
// console renders a "secret changed" affordance without a value. For a non-secret
// field, Old/New carry the actual values.
type PendingChangeDiffItem struct {
	Field  string `json:"field"`
	Old    any    `json:"old"`
	New    any    `json:"new"`
	Secret bool   `json:"secret"`
}

// PendingChange is one maker-checker change record surfaced to the console (the API
// twin of repository.IntegrationPendingChangeRow). It matches the pinned API shape
// exactly. Diff is the secret-masked before/after; ProposedConfig is NOT serialised
// to the API (it can carry a changed secret's cleartext, which never leaves the
// service).
type PendingChange struct {
	ID           uuid.UUID               `json:"id"`
	EndpointID   uuid.UUID               `json:"endpoint_id"`
	EndpointName string                  `json:"endpoint_name"`
	Kind         model.IntegrationKind   `json:"kind"`
	Diff         []PendingChangeDiffItem `json:"diff"`
	RequestedBy  uuid.UUID               `json:"requested_by"`
	RequestedAt  time.Time               `json:"requested_at"`
	Status       string                  `json:"status"`
	Reviewer     *uuid.UUID              `json:"reviewer,omitempty"`
	ReviewedAt   *time.Time              `json:"reviewed_at,omitempty"`
	Note         string                  `json:"note"`
	// Applied reports whether the change was applied (true after Approve). A pending
	// or rejected change is not applied. It is NOT persisted (derived from status).
	Applied bool `json:"applied"`
	// proposedConfig is the operator-submitted config map carried internally for the
	// apply path. It is intentionally unexported so it never serialises to the API.
	proposedConfig map[string]any
}

// ProposeOutcome is the result of ChangeGateService.Propose. Exactly one of Change /
// ApplyNow is meaningful: a PROTECTED endpoint yields Change (a parked pending
// change, ApplyNow=false); a NON-protected endpoint yields ApplyNow=true (the
// registry applies immediately and returns the endpoint).
type ProposeOutcome struct {
	// ApplyNow reports the endpoint is NOT protected: the registry should apply the
	// change immediately rather than parking it.
	ApplyNow bool
	// Change is the parked pending change (nil when ApplyNow is true).
	Change *PendingChange
}

// ChangeGateService implements the maker-checker gate over the pending-changes
// repository. It is a thin service: Propose computes protection + a masked diff and
// parks (or signals apply-now); Approve re-runs the change through the EndpointUpdater
// seam under SoD; Reject discards. A nil repo makes Propose always apply-now (the gate
// is unwired) so the registry never blocks a change just because governance storage is
// absent.
type ChangeGateService struct {
	repo       *repository.IntegrationGovernanceRepository
	updater    EndpointUpdater
	logger     zerolog.Logger
	now        func() time.Time
	enforceSoD bool
}

// NewChangeGateService builds the gate over the repository. enforceSoD requires the
// approver to differ from the requester (separation of duties). The EndpointUpdater
// (the registry) is wired separately via WithUpdater (a construction cycle the setter
// resolves). now defaults to time.Now (UTC).
func NewChangeGateService(repo *repository.IntegrationGovernanceRepository, enforceSoD bool, logger zerolog.Logger) *ChangeGateService {
	return &ChangeGateService{
		repo:       repo,
		logger:     logger.With().Str("component", "lex-integration-change-gate").Logger(),
		now:        func() time.Time { return time.Now().UTC() },
		enforceSoD: enforceSoD,
	}
}

// WithUpdater wires the endpoint updater (the registry) after both are constructed.
// Returns the receiver for chaining. A nil updater disables Approve's apply (it then
// reports the updater is unwired).
func (s *ChangeGateService) WithUpdater(updater EndpointUpdater) *ChangeGateService {
	if s != nil {
		s.updater = updater
	}
	return s
}

// IsProtected reports whether an endpoint's changes must go through maker-checker:
// an active PRODUCTION endpoint, or a gov-gated kind (najiz / nafath_verify, or esign
// with provider=emdha). The console can call this (via the registry) to decide whether
// to warn the operator that a change will be parked.
func (s *ChangeGateService) IsProtected(endpoint model.IntegrationEndpoint) bool {
	return isProtected(endpoint)
}

// Propose evaluates an endpoint against the protection rule. PROTECTED ⇒ it stores a
// pending change (status=pending, applied=false) carrying the proposed config + a
// secret-masked diff against the endpoint's CURRENT (decrypted) config, and returns
// it WITHOUT applying. NON-protected (or an unwired repo) ⇒ it returns ApplyNow=true
// so the registry applies immediately. The diff masks secrets; the proposed config is
// stored verbatim (sentinel for unchanged secrets, new cleartext for a changed one).
func (s *ChangeGateService) Propose(ctx context.Context, endpoint model.IntegrationEndpoint, proposedConfig map[string]any, userID uuid.UUID) (ProposeOutcome, error) {
	if s == nil || s.repo == nil || !isProtected(endpoint) {
		// Gate unwired or endpoint not protected: apply immediately.
		return ProposeOutcome{ApplyNow: true}, nil
	}
	diff := buildMaskedDiff(endpoint.Kind, endpoint.Config, proposedConfig)
	row := &repository.IntegrationPendingChangeRow{
		TenantID:       endpoint.TenantID,
		EndpointID:     endpoint.ID,
		ProposedConfig: proposedConfig,
		Diff:           diffToRows(diff),
		RequestedBy:    userID,
		Status:         repository.PendingChangeStatusPending,
	}
	if err := s.repo.Create(ctx, row); err != nil {
		return ProposeOutcome{}, fmt.Errorf("lex/integration: create pending change: %w", err)
	}
	change := mapPendingChange(*row, endpoint)
	return ProposeOutcome{Change: &change}, nil
}

// List returns the tenant's pending changes (optionally filtered by status), newest
// first. The endpoint name/kind are resolved per row via the supplied lookup (the
// registry passes a name/kind resolver). An unwired repo yields an empty slice.
func (s *ChangeGateService) List(ctx context.Context, tenantID uuid.UUID, status string, limit int, resolve EndpointMetaLookup) ([]PendingChange, error) {
	if s == nil || s.repo == nil {
		return []PendingChange{}, nil
	}
	rows, err := s.repo.List(ctx, tenantID, nil, status, limit)
	if err != nil {
		return nil, err
	}
	out := make([]PendingChange, 0, len(rows))
	for i := range rows {
		name, kind := "", model.IntegrationKind("")
		if resolve != nil {
			name, kind = resolve(ctx, tenantID, rows[i].EndpointID)
		}
		pc := mapPendingChangeRow(rows[i], name, kind)
		out = append(out, pc)
	}
	return out, nil
}

// EndpointMetaLookup resolves an endpoint's display name + kind for a pending-change
// row (the registry supplies it so the gate never imports the endpoint repo). A
// missing endpoint yields ("", "").
type EndpointMetaLookup func(ctx context.Context, tenantID, endpointID uuid.UUID) (name string, kind model.IntegrationKind)

// Approve transitions a pending change to approved and APPLIES its proposed config
// through the EndpointUpdater (the registry Update path). It enforces SoD when
// configured (approver must differ from requester), transitions the row first (the
// repo Review guards a double-review race), then applies. The returned endpoint is the
// applied, masked endpoint. A missing/already-reviewed row maps to a not-found/conflict
// error the registry surfaces.
func (s *ChangeGateService) Approve(ctx context.Context, tenantID, changeID, userID uuid.UUID, note string) (*model.IntegrationEndpoint, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("lex/integration: change gate has no repository")
	}
	row, err := s.repo.Get(ctx, tenantID, changeID)
	if err != nil {
		return nil, err
	}
	if row.Status != repository.PendingChangeStatusPending {
		return nil, &ChangeGateError{Code: ChangeGateAlreadyReviewed, Message: "this change has already been reviewed"}
	}
	if s.enforceSoD && row.RequestedBy == userID {
		return nil, &ChangeGateError{Code: ChangeGateSoDViolation, Message: "separation of duties: the approver must differ from the requester"}
	}
	if s.updater == nil {
		return nil, fmt.Errorf("lex/integration: change gate updater is not wired")
	}
	// Mark approved FIRST (the repo guards a concurrent double-review). Then apply.
	if err := s.repo.Review(ctx, tenantID, changeID, userID, repository.PendingChangeStatusApproved, strings.TrimSpace(note), s.now()); err != nil {
		if err == pgx.ErrNoRows {
			return nil, &ChangeGateError{Code: ChangeGateAlreadyReviewed, Message: "this change has already been reviewed"}
		}
		return nil, err
	}
	endpoint, err := s.updater.ApplyProposedConfig(ctx, tenantID, userID, row.EndpointID, row.ProposedConfig)
	if err != nil {
		return nil, err
	}
	return endpoint, nil
}

// Reject transitions a pending change to rejected (no apply). A note is required so
// the maker learns WHY. A missing/already-reviewed row maps to a not-found/conflict
// error. It returns the rejected change (status=rejected).
func (s *ChangeGateService) Reject(ctx context.Context, tenantID, changeID, userID uuid.UUID, note string, resolve EndpointMetaLookup) (*PendingChange, error) {
	if s == nil || s.repo == nil {
		return nil, fmt.Errorf("lex/integration: change gate has no repository")
	}
	if strings.TrimSpace(note) == "" {
		return nil, &ChangeGateError{Code: ChangeGateNoteRequired, Message: "a rejection note is required"}
	}
	row, err := s.repo.Get(ctx, tenantID, changeID)
	if err != nil {
		return nil, err
	}
	if row.Status != repository.PendingChangeStatusPending {
		return nil, &ChangeGateError{Code: ChangeGateAlreadyReviewed, Message: "this change has already been reviewed"}
	}
	if err := s.repo.Review(ctx, tenantID, changeID, userID, repository.PendingChangeStatusRejected, strings.TrimSpace(note), s.now()); err != nil {
		if err == pgx.ErrNoRows {
			return nil, &ChangeGateError{Code: ChangeGateAlreadyReviewed, Message: "this change has already been reviewed"}
		}
		return nil, err
	}
	updated, err := s.repo.Get(ctx, tenantID, changeID)
	if err != nil {
		return nil, err
	}
	name, kind := "", model.IntegrationKind("")
	if resolve != nil {
		name, kind = resolve(ctx, tenantID, updated.EndpointID)
	}
	pc := mapPendingChangeRow(*updated, name, kind)
	return &pc, nil
}

// =============================================================================
// Protection rule + masked-diff helpers.
// =============================================================================

// isProtected reports whether an endpoint's changes must go through maker-checker:
//   - status=active AND a production environment (config.environment == production), OR
//   - a gov-gated kind: najiz / nafath_verify, or esign with provider=emdha.
func isProtected(endpoint model.IntegrationEndpoint) bool {
	if isGovGatedKind(endpoint) {
		return true
	}
	if endpoint.Status == model.IntegrationStatusActive && isProductionEnv(endpoint.Config) {
		return true
	}
	return false
}

// isGovGatedKind reports whether the endpoint is a gov-gated integration: najiz or
// nafath_verify by kind, or an esign endpoint whose provider is emdha (the KSA TSP).
func isGovGatedKind(endpoint model.IntegrationEndpoint) bool {
	switch endpoint.Kind {
	case model.IntegrationKindNajiz, model.IntegrationKindNafathVerify:
		return true
	case model.IntegrationKindEsign:
		if provider, ok := endpoint.Config["provider"].(string); ok {
			return strings.EqualFold(strings.TrimSpace(provider), "emdha")
		}
	}
	return false
}

// isProductionEnv reports whether the config declares a production environment
// (environment == production, case-insensitive).
func isProductionEnv(config map[string]any) bool {
	if config == nil {
		return false
	}
	env, ok := config["environment"].(string)
	if !ok {
		return false
	}
	return strings.EqualFold(strings.TrimSpace(env), "production")
}

// buildMaskedDiff computes the before/after diff between the endpoint's current
// (decrypted) config and the proposed config, MASKING every secret field. A secret
// field that changed (proposed value differs from the sentinel AND is non-empty)
// renders __redacted__ -> __redacted__ with Secret=true (the reviewer sees "secret
// changed" without a value); an unchanged secret (sentinel/blank proposed value) is
// omitted. Non-secret fields render their actual old/new values when they differ.
// Only fields whose value actually changes appear in the diff.
func buildMaskedDiff(kind model.IntegrationKind, current, proposed map[string]any) []PendingChangeDiffItem {
	schema, _ := SchemaFor(kind)
	secretKeys := map[string]bool{}
	for _, f := range schema {
		if f.IsSecret() {
			secretKeys[f.Key] = true
		}
	}
	if current == nil {
		current = map[string]any{}
	}
	if proposed == nil {
		proposed = map[string]any{}
	}
	// Union of keys present in proposed (a change submits the full intended config).
	keys := map[string]bool{}
	for k := range proposed {
		keys[k] = true
	}
	ordered := make([]string, 0, len(keys))
	for k := range keys {
		ordered = append(ordered, k)
	}
	sort.Strings(ordered)

	var out []PendingChangeDiffItem
	for _, key := range ordered {
		newVal, hasNew := proposed[key]
		oldVal, hasOld := current[key]
		if secretKeys[key] {
			// A secret is "changed" only when the proposed value is a real new secret
			// (non-empty and not the keep-stored sentinel).
			newStr := strings.TrimSpace(fmt.Sprint(newVal))
			if !hasNew || newStr == "" || newStr == RedactedSentinel {
				continue
			}
			out = append(out, PendingChangeDiffItem{
				Field:  key,
				Old:    RedactedSentinel,
				New:    RedactedSentinel,
				Secret: true,
			})
			continue
		}
		// Non-secret: include only when the value actually changes.
		if !hasNew {
			continue
		}
		if hasOld && fmt.Sprint(oldVal) == fmt.Sprint(newVal) {
			continue
		}
		out = append(out, PendingChangeDiffItem{
			Field:  key,
			Old:    oldVal,
			New:    newVal,
			Secret: false,
		})
	}
	return out
}

// diffToRows maps the typed diff to the JSONB-storable []map shape the repository
// persists (the diff column). Secrets are already masked.
func diffToRows(diff []PendingChangeDiffItem) []map[string]any {
	out := make([]map[string]any, 0, len(diff))
	for _, d := range diff {
		out = append(out, map[string]any{
			"field":  d.Field,
			"old":    d.Old,
			"new":    d.New,
			"secret": d.Secret,
		})
	}
	return out
}

// rowsToDiff maps a stored JSONB diff back to the typed shape for the API response.
func rowsToDiff(rows []map[string]any) []PendingChangeDiffItem {
	out := make([]PendingChangeDiffItem, 0, len(rows))
	for _, r := range rows {
		item := PendingChangeDiffItem{}
		if v, ok := r["field"].(string); ok {
			item.Field = v
		}
		item.Old = r["old"]
		item.New = r["new"]
		if v, ok := r["secret"].(bool); ok {
			item.Secret = v
		}
		out = append(out, item)
	}
	return out
}

// mapPendingChange builds the API twin from a freshly-created row + the loaded
// endpoint (so name/kind are exact).
func mapPendingChange(row repository.IntegrationPendingChangeRow, endpoint model.IntegrationEndpoint) PendingChange {
	pc := mapPendingChangeRow(row, endpoint.Name, endpoint.Kind)
	pc.proposedConfig = row.ProposedConfig
	return pc
}

// mapPendingChangeRow builds the API twin from a stored row + resolved name/kind.
func mapPendingChangeRow(row repository.IntegrationPendingChangeRow, name string, kind model.IntegrationKind) PendingChange {
	return PendingChange{
		ID:             row.ID,
		EndpointID:     row.EndpointID,
		EndpointName:   name,
		Kind:           kind,
		Diff:           rowsToDiff(row.Diff),
		RequestedBy:    row.RequestedBy,
		RequestedAt:    row.RequestedAt,
		Status:         row.Status,
		Reviewer:       row.Reviewer,
		ReviewedAt:     row.ReviewedAt,
		Note:           row.Note,
		Applied:        row.Status == repository.PendingChangeStatusApproved,
		proposedConfig: row.ProposedConfig,
	}
}

// =============================================================================
// ChangeGateError — typed gate failures the registry maps to HTTP statuses.
// =============================================================================

// ChangeGateErrorCode classifies a gate failure.
type ChangeGateErrorCode string

const (
	// ChangeGateAlreadyReviewed: the change is not pending (approved/rejected).
	ChangeGateAlreadyReviewed ChangeGateErrorCode = "already_reviewed"
	// ChangeGateSoDViolation: the approver equals the requester under enforced SoD.
	ChangeGateSoDViolation ChangeGateErrorCode = "sod_violation"
	// ChangeGateNoteRequired: a rejection note is missing.
	ChangeGateNoteRequired ChangeGateErrorCode = "note_required"
)

// ChangeGateError is a typed gate failure the registry translates to a 409/403/422.
type ChangeGateError struct {
	Code    ChangeGateErrorCode
	Message string
}

func (e *ChangeGateError) Error() string { return e.Message }

// AsChangeGateError reports whether err is a ChangeGateError (and returns it), so the
// registry can map the code to the right HTTP status.
func AsChangeGateError(err error) (*ChangeGateError, bool) {
	if err == nil {
		return nil, false
	}
	ge, ok := err.(*ChangeGateError)
	return ge, ok
}

// IsPendingChangeNotFound reports whether err is the repository's not-found sentinel
// (a missing pending change), so the handler maps it to a 404.
func IsPendingChangeNotFound(err error) bool {
	return err == pgx.ErrNoRows
}
