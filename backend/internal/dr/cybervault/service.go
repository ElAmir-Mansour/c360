package cybervault

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
)

var (
	// ErrInvalidRequest is returned when a caller supplies malformed posture or
	// identifier data.
	ErrInvalidRequest = errors.New("cybervault: invalid request")
	// ErrVaultNotFound is returned when a vault posture cannot be found.
	ErrVaultNotFound = errors.New("cybervault: vault not found")
	// ErrAssessmentNotFound is returned when no assessment exists for a vault.
	ErrAssessmentNotFound = errors.New("cybervault: assessment not found")
	// ErrSourceUnavailable is returned when an external posture source cannot be
	// queried.
	ErrSourceUnavailable = errors.New("cybervault: posture source unavailable")
)

// PostureStore is the persistence surface the service needs. *Store satisfies
// it; tests use an in-memory fake.
type PostureStore interface {
	UpsertVault(ctx context.Context, db DBTX, v *RegisteredVault) error
	UpdateVault(ctx context.Context, db DBTX, v *RegisteredVault) error
	GetVault(ctx context.Context, db DBTX, tenantID, vaultID string) (*RegisteredVault, error)
	ListVaults(ctx context.Context, db DBTX, tenantID, groupID string) ([]RegisteredVault, error)
	SaveAssessment(ctx context.Context, db DBTX, tenantID, groupID string, posture VaultPosture, assessment PostureAssessment) (*StoredPostureAssessment, error)
	ListLatestAssessments(ctx context.Context, db DBTX, tenantID, groupID string) ([]StoredPostureAssessment, error)
	GetLatestAssessment(ctx context.Context, db DBTX, tenantID, vaultID string) (*StoredPostureAssessment, error)
}

// PostureSource supplies live vault posture. When it is configured,
// EvaluateVault refreshes posture from the source before scoring it.
type PostureSource interface {
	GetVaultPosture(ctx context.Context, tenantID, vaultID uuid.UUID) (VaultPosture, error)
}

// PostureEvaluator is satisfied by *Evaluator and keeps the service testable.
type PostureEvaluator interface {
	Evaluate(posture VaultPosture) PostureAssessment
}

// txRunner runs a function inside a tenant-scoped transaction.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
}

// PGXRunner adapts a pgx pool to the package txRunner with tenant RLS applied.
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a read-write tenant transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a read-only tenant transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// Config wires the cyber vault service.
type Config struct {
	Store     PostureStore
	Runner    txRunner
	Source    PostureSource
	Evaluator PostureEvaluator
	Logger    zerolog.Logger
	Now       func() time.Time
}

// Service coordinates cyber vault posture registration, live refresh,
// evaluation, latest-assessment lookups, and controlled sync-window planning.
type Service struct {
	store       PostureStore
	runner      txRunner
	source      PostureSource
	evaluator   PostureEvaluator
	syncPlanner *SyncPlanner
	logger      zerolog.Logger
}

// NewService constructs a cyber vault service. Store and Runner are required;
// Source and Evaluator are optional. A missing evaluator defaults to the package
// evaluator.
func NewService(cfg Config) (*Service, error) {
	if cfg.Store == nil {
		return nil, errors.New("cybervault service: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("cybervault service: runner is required")
	}
	evaluator := cfg.Evaluator
	if evaluator == nil {
		evaluator = NewEvaluator(cfg.Now)
	}
	return &Service{
		store:       cfg.Store,
		runner:      cfg.Runner,
		source:      cfg.Source,
		evaluator:   evaluator,
		syncPlanner: NewSyncPlanner(cfg.Now),
		logger:      cfg.Logger.With().Str("service", "dr-cybervault").Logger(),
	}, nil
}

// UpsertVaultPosture registers or refreshes a tenant/group cyber vault posture
// by its provider/external identity.
func (s *Service) UpsertVaultPosture(ctx context.Context, tenantID, groupID uuid.UUID, posture VaultPosture) (RegisteredVault, error) {
	if err := validateVaultScope(tenantID, groupID); err != nil {
		return RegisteredVault{}, err
	}
	normalized, err := normalizePosture(posture, uuid.Nil, true)
	if err != nil {
		return RegisteredVault{}, err
	}
	record := vaultRecordFromPosture(tenantID, groupID, normalized)

	err = s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		return mapVaultStoreError(s.store.UpsertVault(ctx, db, &record))
	})
	if err != nil {
		return RegisteredVault{}, err
	}
	return record, nil
}

// UpdateVaultPosture refreshes one registered vault by its database id.
func (s *Service) UpdateVaultPosture(ctx context.Context, tenantID, groupID, vaultID uuid.UUID, posture VaultPosture) (RegisteredVault, error) {
	if err := validateVaultScope(tenantID, groupID); err != nil {
		return RegisteredVault{}, err
	}
	if vaultID == uuid.Nil {
		return RegisteredVault{}, fmt.Errorf("%w: vault id is required", ErrInvalidRequest)
	}

	var record RegisteredVault
	err := s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		existing, err := s.store.GetVault(ctx, db, tenantID.String(), vaultID.String())
		if err != nil {
			return mapVaultStoreError(err)
		}
		if existing.GroupID != groupID.String() {
			return ErrVaultNotFound
		}

		if posture.ID == "" {
			posture.ID = firstNonEmpty(existing.Posture.ID, existing.ExternalID)
		}
		if posture.Provider == "" {
			posture.Provider = existing.Provider
		}
		if posture.Name == "" {
			posture.Name = existing.Name
		}
		normalized, nerr := normalizePosture(posture, fallbackPostureID(existing, vaultID), true)
		if nerr != nil {
			return nerr
		}

		record = vaultRecordFromPosture(tenantID, groupID, normalized)
		record.ID = vaultID.String()
		record.ExternalID = firstNonEmpty(record.ExternalID, existing.ExternalID)
		return mapVaultStoreError(s.store.UpdateVault(ctx, db, &record))
	})
	if err != nil {
		return RegisteredVault{}, err
	}
	return record, nil
}

// ListVaultPostures returns registered vault posture for a tenant/group.
func (s *Service) ListVaultPostures(ctx context.Context, tenantID, groupID uuid.UUID) ([]RegisteredVault, error) {
	if err := validateVaultScope(tenantID, groupID); err != nil {
		return nil, err
	}
	var vaults []RegisteredVault
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var lerr error
		vaults, lerr = s.store.ListVaults(ctx, db, tenantID.String(), groupID.String())
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return vaults, nil
}

// EvaluateVault evaluates the latest known posture for a vault, records the
// resulting assessment, and returns the stored assessment row.
func (s *Service) EvaluateVault(ctx context.Context, tenantID, groupID, vaultID uuid.UUID) (*StoredPostureAssessment, error) {
	if err := validateVaultScope(tenantID, groupID); err != nil {
		return nil, err
	}
	if vaultID == uuid.Nil {
		return nil, fmt.Errorf("%w: vault id is required", ErrInvalidRequest)
	}

	var stored *StoredPostureAssessment
	err := s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		vault, err := s.store.GetVault(ctx, db, tenantID.String(), vaultID.String())
		if err != nil {
			return mapVaultStoreError(err)
		}
		if vault.GroupID != groupID.String() {
			return ErrVaultNotFound
		}

		posture, err := s.postureForEvaluation(ctx, db, tenantID, vaultID, vault)
		if err != nil {
			return err
		}
		assessment := s.evaluator.Evaluate(posture)
		assessment.VaultID = vault.ID
		if assessment.Provider == "" {
			assessment.Provider = vault.Provider
		}

		stored, err = s.store.SaveAssessment(ctx, db, tenantID.String(), groupID.String(), posture, assessment)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Str("group_id", groupID.String()).
		Str("vault_id", vaultID.String()).
		Float64("score", stored.Score).
		Str("verdict", string(stored.Verdict)).
		Msg("cyber vault posture evaluated")
	return stored, nil
}

// PlanSync evaluates a controlled cyber-vault sync request against an approved
// window and returns a deterministic, side-effect-free policy decision (allowed
// or blocked with findings). It first loads the vault in the tenant/group scope so
// a plan can only be produced for a registered vault the tenant owns; the plan
// itself performs no cloud API work — it is the policy gate operators consult
// before running an operation inside a sync window. Returns ErrVaultNotFound when
// the vault is not in the tenant's scope.
func (s *Service) PlanSync(ctx context.Context, tenantID, groupID, vaultID uuid.UUID, window SyncWindow, request SyncRequest) (SyncPlan, error) {
	if err := validateVaultScope(tenantID, groupID); err != nil {
		return SyncPlan{}, err
	}
	if vaultID == uuid.Nil {
		return SyncPlan{}, fmt.Errorf("%w: vault id is required", ErrInvalidRequest)
	}

	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		vault, gerr := s.store.GetVault(ctx, db, tenantID.String(), vaultID.String())
		if gerr != nil {
			return mapVaultStoreError(gerr)
		}
		if vault.GroupID != groupID.String() {
			return ErrVaultNotFound
		}
		return nil
	})
	if err != nil {
		return SyncPlan{}, err
	}

	request.VaultID = vaultID.String()
	plan := s.syncPlanner.Plan(window, request)
	plan.VaultID = vaultID.String()
	s.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Str("group_id", groupID.String()).
		Str("vault_id", vaultID.String()).
		Str("verdict", string(plan.Decision.Verdict)).
		Int("findings", len(plan.Decision.Findings)).
		Msg("cyber vault sync planned")
	return plan, nil
}

// ListLatestAssessments returns the latest assessment for each assessed vault in
// a tenant/group.
func (s *Service) ListLatestAssessments(ctx context.Context, tenantID, groupID uuid.UUID) ([]StoredPostureAssessment, error) {
	if err := validateVaultScope(tenantID, groupID); err != nil {
		return nil, err
	}
	var assessments []StoredPostureAssessment
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var lerr error
		assessments, lerr = s.store.ListLatestAssessments(ctx, db, tenantID.String(), groupID.String())
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return assessments, nil
}

// LatestAssessmentByVault returns the most recent assessment for one vault.
func (s *Service) LatestAssessmentByVault(ctx context.Context, tenantID, vaultID uuid.UUID) (*StoredPostureAssessment, error) {
	if tenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant id is required", ErrInvalidRequest)
	}
	if vaultID == uuid.Nil {
		return nil, fmt.Errorf("%w: vault id is required", ErrInvalidRequest)
	}
	var assessment *StoredPostureAssessment
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		var gerr error
		assessment, gerr = s.store.GetLatestAssessment(ctx, db, tenantID.String(), vaultID.String())
		return mapAssessmentStoreError(gerr)
	})
	if err != nil {
		return nil, err
	}
	return assessment, nil
}

func (s *Service) postureForEvaluation(ctx context.Context, db DBTX, tenantID, vaultID uuid.UUID, vault *RegisteredVault) (VaultPosture, error) {
	posture := vault.Posture
	if posture.Provider == "" {
		posture.Provider = vault.Provider
	}
	if posture.Name == "" {
		posture.Name = vault.Name
	}

	if s.source == nil {
		return normalizePosture(posture, fallbackPostureID(vault, vaultID), false)
	}

	refreshed, err := s.source.GetVaultPosture(ctx, tenantID, vaultID)
	if err != nil {
		return VaultPosture{}, err
	}
	record, err := refreshedVaultRecord(vault, refreshed, vaultID)
	if err != nil {
		return VaultPosture{}, err
	}
	if err := s.store.UpdateVault(ctx, db, &record); err != nil {
		return VaultPosture{}, mapVaultStoreError(err)
	}
	*vault = record
	return record.Posture, nil
}

func validateVaultScope(tenantID, groupID uuid.UUID) error {
	if tenantID == uuid.Nil {
		return fmt.Errorf("%w: tenant id is required", ErrInvalidRequest)
	}
	if groupID == uuid.Nil {
		return fmt.Errorf("%w: group id is required", ErrInvalidRequest)
	}
	return nil
}

func vaultRecordFromPosture(tenantID, groupID uuid.UUID, posture VaultPosture) RegisteredVault {
	return RegisteredVault{
		TenantID:   tenantID.String(),
		GroupID:    groupID.String(),
		Provider:   posture.Provider,
		Name:       posture.Name,
		ExternalID: firstNonEmpty(posture.ID, posture.Name),
		Posture:    posture,
	}
}

func refreshedVaultRecord(existing *RegisteredVault, posture VaultPosture, vaultID uuid.UUID) (RegisteredVault, error) {
	if posture.Provider == "" {
		posture.Provider = existing.Provider
	}
	if posture.Name == "" {
		posture.Name = existing.Name
	}
	normalized, err := normalizePosture(posture, fallbackPostureID(existing, vaultID), false)
	if err != nil {
		return RegisteredVault{}, err
	}
	if normalized.Name == "" {
		normalized.Name = existing.Name
	}
	record := *existing
	record.Provider = firstNonEmptyProvider(normalized.Provider, existing.Provider)
	record.Name = firstNonEmpty(normalized.Name, existing.Name, vaultID.String())
	record.ExternalID = firstNonEmpty(existing.ExternalID, normalized.ID, record.Name)
	record.Posture = normalized
	return record, nil
}

func fallbackPostureID(v *RegisteredVault, fallback uuid.UUID) uuid.UUID {
	for _, candidate := range []string{v.Posture.ID, v.ExternalID, v.ID} {
		if id, err := uuid.Parse(strings.TrimSpace(candidate)); err == nil {
			return id
		}
	}
	return fallback
}

func normalizePosture(posture VaultPosture, fallbackID uuid.UUID, requireName bool) (VaultPosture, error) {
	posture.ID = strings.TrimSpace(posture.ID)
	if posture.ID == "" {
		if fallbackID == uuid.Nil {
			fallbackID = uuid.New()
		}
		posture.ID = fallbackID.String()
	}
	if _, err := uuid.Parse(posture.ID); err != nil {
		return VaultPosture{}, fmt.Errorf("%w: vault id must be a valid UUID", ErrInvalidRequest)
	}

	posture.Name = strings.TrimSpace(posture.Name)
	if requireName && posture.Name == "" {
		return VaultPosture{}, fmt.Errorf("%w: name is required", ErrInvalidRequest)
	}
	if posture.Provider == "" {
		posture.Provider = VaultProviderGeneric
	}
	posture.PrimaryRegion = strings.TrimSpace(posture.PrimaryRegion)
	posture.ReplicaRegions = compactStrings(posture.ReplicaRegions)
	return posture, nil
}

func compactStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			out = append(out, value)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func firstNonEmptyProvider(values ...VaultProvider) VaultProvider {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return VaultProviderGeneric
}

func mapVaultStoreError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrNotFound) {
		return ErrVaultNotFound
	}
	return err
}

func mapAssessmentStoreError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, ErrNotFound) {
		return ErrAssessmentNotFound
	}
	return err
}

var _ PostureStore = (*Store)(nil)
var _ PostureEvaluator = (*Evaluator)(nil)
