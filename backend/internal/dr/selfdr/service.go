package selfdr

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
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// eventSource is the CloudEvents source attribute for self-DR events.
const eventSource = "clario-dr/selfdr"

// Lifecycle event types emitted to the DR events topic.
const (
	// EventAssessed is emitted when a self-DR readiness assessment completes.
	EventAssessed = "datastream.dr.selfdr.assessed"
	// EventArtifactSealed is emitted when a control-plane backup or offline
	// restore bundle is sealed to immutable storage.
	EventArtifactSealed = "datastream.dr.selfdr.artifact_sealed"
)

// storeAPI is the persistence surface the service needs. *Store satisfies it;
// tests substitute an in-memory fake.
type storeAPI interface {
	SaveAssessment(ctx context.Context, db DBTX, a *StoredAssessment) error
	GetAssessment(ctx context.Context, db DBTX, id uuid.UUID) (*StoredAssessment, error)
	LatestAssessment(ctx context.Context, db DBTX) (*StoredAssessment, error)
	SaveArtifact(ctx context.Context, db DBTX, art *StoredArtifact) error
	ListArtifacts(ctx context.Context, db DBTX, limit int) ([]StoredArtifact, error)
	LatestBackupEvidence(ctx context.Context, db DBTX, componentID string) (BackupEvidence, bool, error)
	LatestBundleEvidence(ctx context.Context, db DBTX) (OfflineRestoreBundle, bool, error)
}

// backupCapturer captures and seals a control-plane backup. *BackupManager
// satisfies it; it is nil when sealing is not configured.
type backupCapturer interface {
	Capture(ctx context.Context, req BackupRequest) (BackupResult, error)
}

// bundleGenerator renders and seals an offline restore bundle.
// *OfflineBundleGenerator satisfies it; it is nil when sealing is not configured.
type bundleGenerator interface {
	Generate(ctx context.Context, req OfflineBundleRequest) (OfflineBundleResult, error)
}

// txRunner runs a function inside a tenant-scoped transaction.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant
// transaction helpers (SET LOCAL app.current_tenant_id; RLS backstop).
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

// Service is the request-path orchestration for control-plane self-DR. It
// (1) assesses readiness by overlaying the real WORM-sealed evidence it holds
// onto an operator-described (or baseline) profile and scoring it with the
// evaluator, and (2) performs the two operational capabilities — capturing an
// immutable control-plane backup and generating a sealed offline restore bundle —
// recording each as a durable artifact that future assessments read back. The
// evaluator/planner (pure) and the backup/bundle managers (I/O) live elsewhere;
// this owns wiring, enrichment, and persistence.
type Service struct {
	store     storeAPI
	runner    txRunner
	evaluator *Evaluator
	backup    backupCapturer
	bundle    bundleGenerator
	metrics   *Metrics
	topic     string
	now       func() time.Time
	logger    zerolog.Logger
}

// Config configures a Service. Backup and Bundle may be nil (Vault/WORM not
// configured): readiness assessment still works, but the operational seal paths
// return ErrSealingNotConfigured. Clock defaults to time.Now.
type Config struct {
	Store   storeAPI
	Runner  txRunner
	Backup  backupCapturer
	Bundle  bundleGenerator
	Metrics *Metrics
	Topic   string
	Clock   func() time.Time
	Logger  zerolog.Logger
}

// NewService constructs a Service. The clock is shared with the evaluator so the
// service and every freshness-windowed check evaluate against the same instant.
func NewService(cfg Config) *Service {
	clock := cfg.Clock
	if clock == nil {
		clock = time.Now
	}
	topic := cfg.Topic
	if topic == "" {
		topic = "datastream.dr.events"
	}
	return &Service{
		store:     cfg.Store,
		runner:    cfg.Runner,
		evaluator: NewEvaluator(clock),
		backup:    cfg.Backup,
		bundle:    cfg.Bundle,
		metrics:   cfg.Metrics,
		topic:     topic,
		now:       clock,
		logger:    cfg.Logger.With().Str("component", "dr-selfdr").Logger(),
	}
}

// RequiredComponents returns the built-in control-plane component baseline.
func (s *Service) RequiredComponents() []ComponentKind { return RequiredComponentKinds() }

// SealingEnabled reports whether the operational backup / bundle paths are wired.
func (s *Service) SealingEnabled() bool { return s.backup != nil || s.bundle != nil }

// Assess overlays the real sealed-artifact evidence the tenant holds onto the
// supplied profile (or the built-in baseline when profile is nil), evaluates
// readiness, and persists the assessment with its lifecycle event in one tenant
// transaction. The scored assessment is returned with the persisted header id.
func (s *Service) Assess(ctx context.Context, tenantID, actor uuid.UUID, profile *SelfDRProfile) (*StoredAssessment, *ReadinessAssessment, error) {
	resolved := s.resolveProfile(profile)
	if len(resolved.Components) == 0 {
		return nil, nil, ErrEmptyProfile
	}

	var hdr *StoredAssessment
	var scored ReadinessAssessment

	err := s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		enriched, eErr := s.enrich(ctx, db, resolved)
		if eErr != nil {
			return fmt.Errorf("enrich profile: %w", eErr)
		}
		scored = s.evaluator.Evaluate(enriched)
		hdr = toStoredAssessment(scored, tenantID, actor)
		if sErr := s.store.SaveAssessment(ctx, db, hdr); sErr != nil {
			return fmt.Errorf("save assessment: %w", sErr)
		}
		return s.stageAssessedEvent(ctx, db, tenantID, hdr)
	})
	if err != nil {
		return nil, nil, err
	}

	s.metrics.ObserveAssessment(scored)
	s.logger.Info().
		Str("profile", hdr.ProfileID).
		Str("verdict", string(hdr.Verdict)).
		Int("critical", hdr.Critical).
		Int("warning", hdr.Warning).
		Msg("selfdr readiness assessed")
	return hdr, &scored, nil
}

// resolveProfile returns the supplied profile or the built-in baseline.
func (s *Service) resolveProfile(profile *SelfDRProfile) SelfDRProfile {
	if profile != nil && len(profile.Components) > 0 {
		return *profile
	}
	if profile != nil && profile.ID != "" {
		return BaselineProfile(profile.ID)
	}
	return BaselineProfile("")
}

// enrich overlays each component's latest sealed backup evidence and the latest
// sealed offline-bundle evidence onto the profile. Real sealed evidence is
// authoritative: it is what the platform actually holds, so it overrides any
// evidence the operator described. Components with no sealed backup keep whatever
// the operator supplied (often empty -> a backup_missing finding).
func (s *Service) enrich(ctx context.Context, db DBTX, profile SelfDRProfile) (SelfDRProfile, error) {
	for i := range profile.Components {
		c := &profile.Components[i]
		ev, ok, err := s.store.LatestBackupEvidence(ctx, db, c.ID)
		if err != nil {
			return SelfDRProfile{}, err
		}
		if ok {
			c.Backup = ev
		}
	}
	bundleEv, ok, err := s.store.LatestBundleEvidence(ctx, db)
	if err != nil {
		return SelfDRProfile{}, err
	}
	if ok {
		profile.OfflineBundle = bundleEv
	}
	return profile, nil
}

// CaptureBackup captures a control-plane component backup, seals it to immutable
// storage, and records the durable artifact. The capture+seal (slow, shells out
// + WORM I/O) runs outside any transaction; only the artifact write is
// transactional with its lifecycle event. Returns ErrSealingNotConfigured when no
// sealer is wired.
func (s *Service) CaptureBackup(ctx context.Context, tenantID, actor uuid.UUID, req BackupRequest) (*StoredArtifact, error) {
	if s.backup == nil {
		return nil, ErrSealingNotConfigured
	}
	req.TenantID = tenantID.String()
	result, err := s.backup.Capture(ctx, req)
	if err != nil {
		return nil, err
	}
	art := artifactFromBackup(result, req, tenantID, actor)
	if err := s.persistArtifact(ctx, tenantID, art); err != nil {
		return nil, err
	}
	s.metrics.ObserveArtifact(ArtifactKindControlPlaneBackup)
	s.logger.Info().
		Str("component", req.ComponentID).
		Str("key", art.Key).
		Str("sha256", art.SHA256).
		Msg("selfdr control-plane backup sealed")
	return art, nil
}

// GenerateBundle renders and seals an offline restore bundle for the resolved
// (enriched) profile, then records the durable artifact. Returns
// ErrSealingNotConfigured when no generator is wired.
func (s *Service) GenerateBundle(ctx context.Context, tenantID, actor uuid.UUID, req OfflineBundleRequest) (*StoredArtifact, error) {
	if s.bundle == nil {
		return nil, ErrSealingNotConfigured
	}
	resolved := s.resolveProfile(&req.Profile)
	if len(resolved.Components) == 0 {
		return nil, ErrEmptyProfile
	}
	// Enrich the profile (and assess it) so the bundle carries the real evidence
	// and an up-to-date readiness assessment.
	var enriched SelfDRProfile
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		e, eErr := s.enrich(ctx, db, resolved)
		if eErr != nil {
			return eErr
		}
		enriched = e
		return nil
	}); err != nil {
		return nil, fmt.Errorf("enrich profile: %w", err)
	}
	assessment := s.evaluator.Evaluate(enriched)
	req.TenantID = tenantID.String()
	req.Profile = enriched
	req.Assessment = &assessment

	result, err := s.bundle.Generate(ctx, req)
	if err != nil {
		return nil, err
	}
	art := artifactFromBundle(result, tenantID, actor)
	if err := s.persistArtifact(ctx, tenantID, art); err != nil {
		return nil, err
	}
	s.metrics.ObserveArtifact(ArtifactKindOfflineBundle)
	s.logger.Info().
		Str("profile", enriched.ID).
		Str("key", art.Key).
		Str("sha256", art.SHA256).
		Msg("selfdr offline restore bundle sealed")
	return art, nil
}

// persistArtifact records a sealed artifact and stages its lifecycle event in one
// tenant transaction.
func (s *Service) persistArtifact(ctx context.Context, tenantID uuid.UUID, art *StoredArtifact) error {
	return s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		if err := s.store.SaveArtifact(ctx, db, art); err != nil {
			return fmt.Errorf("save artifact: %w", err)
		}
		return s.stageArtifactEvent(ctx, db, tenantID, art)
	})
}

// GetReport reconstructs a stored assessment into a report. Returns
// ErrAssessmentNotFound when the id is not in the tenant's scope.
func (s *Service) GetReport(ctx context.Context, tenantID, id uuid.UUID) (*AssessmentReport, error) {
	return s.report(ctx, tenantID, func(db DBTX) (*StoredAssessment, error) {
		return s.store.GetAssessment(ctx, db, id)
	})
}

// GetLatest reconstructs the most recent assessment into a report.
func (s *Service) GetLatest(ctx context.Context, tenantID uuid.UUID) (*AssessmentReport, error) {
	return s.report(ctx, tenantID, func(db DBTX) (*StoredAssessment, error) {
		return s.store.LatestAssessment(ctx, db)
	})
}

func (s *Service) report(ctx context.Context, tenantID uuid.UUID, load func(DBTX) (*StoredAssessment, error)) (*AssessmentReport, error) {
	var report *AssessmentReport
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		hdr, hErr := load(db)
		if hErr != nil {
			return hErr
		}
		artifacts, aErr := s.store.ListArtifacts(ctx, db, 50)
		if aErr != nil {
			return aErr
		}
		report = &AssessmentReport{Assessment: *hdr, Artifacts: artifacts}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrAssessmentNotFound) {
			return nil, ErrAssessmentNotFound
		}
		return nil, err
	}
	return report, nil
}

// ListArtifacts returns the most recent sealed artifacts for the tenant.
func (s *Service) ListArtifacts(ctx context.Context, tenantID uuid.UUID, limit int) ([]StoredArtifact, error) {
	var out []StoredArtifact
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		artifacts, aErr := s.store.ListArtifacts(ctx, db, limit)
		if aErr != nil {
			return aErr
		}
		out = artifacts
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func artifactFromBackup(result BackupResult, req BackupRequest, tenantID, actor uuid.UUID) *StoredArtifact {
	a := result.Artifact
	return &StoredArtifact{
		TenantID:      tenantID,
		Kind:          ArtifactKindControlPlaneBackup,
		ComponentID:   req.ComponentID,
		ComponentKind: req.ComponentKind,
		Key:           a.Key,
		URI:           a.URI,
		VersionID:     a.VersionID,
		SHA256:        a.SHA256,
		SizeBytes:     a.SizeBytes,
		CapturedAt:    a.CapturedAt,
		RetainUntil:   a.RetainUntil,
		LocationID:    result.Evidence.LocationID,
		Immutable:     result.Evidence.Immutable,
		Encrypted:     result.Evidence.Encrypted,
		Evidence:      result.Evidence,
		CreatedBy:     actor,
	}
}

func artifactFromBundle(result OfflineBundleResult, tenantID, actor uuid.UUID) *StoredArtifact {
	a := result.Artifact
	return &StoredArtifact{
		TenantID:    tenantID,
		Kind:        ArtifactKindOfflineBundle,
		Key:         a.Key,
		URI:         a.URI,
		VersionID:   a.VersionID,
		SHA256:      a.SHA256,
		SizeBytes:   a.SizeBytes,
		CapturedAt:  a.CapturedAt,
		RetainUntil: a.RetainUntil,
		LocationID:  result.Evidence.LocationID,
		Immutable:   true,
		Encrypted:   true,
		Evidence:    result.Evidence,
		CreatedBy:   actor,
	}
}

func (s *Service) stageAssessedEvent(ctx context.Context, db DBTX, tenantID uuid.UUID, hdr *StoredAssessment) error {
	payload := assessedEventPayload{
		AssessmentID: hdr.ID.String(),
		ProfileID:    hdr.ProfileID,
		Verdict:      string(hdr.Verdict),
		Critical:     hdr.Critical,
		Warning:      hdr.Warning,
		Info:         hdr.Info,
		EvaluatedAt:  hdr.CreatedAt,
	}
	return s.stage(ctx, db, EventAssessed, tenantID, payload, "selfdr assessed")
}

func (s *Service) stageArtifactEvent(ctx context.Context, db DBTX, tenantID uuid.UUID, art *StoredArtifact) error {
	payload := artifactEventPayload{
		ArtifactID:  art.ID.String(),
		Kind:        string(art.Kind),
		ComponentID: art.ComponentID,
		Key:         art.Key,
		SHA256:      art.SHA256,
		SizeBytes:   art.SizeBytes,
		Immutable:   art.Immutable,
		Encrypted:   art.Encrypted,
		CapturedAt:  art.CapturedAt,
	}
	return s.stage(ctx, db, EventArtifactSealed, tenantID, payload, "selfdr artifact sealed")
}

func (s *Service) stage(ctx context.Context, db DBTX, eventType string, tenantID uuid.UUID, payload any, what string) error {
	evt, err := events.NewEvent(eventType, eventSource, tenantID.String(), payload)
	if err != nil {
		return fmt.Errorf("build %s event: %w", what, err)
	}
	if err := outbox.Write(ctx, db, s.topic, evt); err != nil {
		return fmt.Errorf("stage %s event: %w", what, err)
	}
	return nil
}

type assessedEventPayload struct {
	AssessmentID string    `json:"assessment_id"`
	ProfileID    string    `json:"profile_id"`
	Verdict      string    `json:"verdict"`
	Critical     int       `json:"critical"`
	Warning      int       `json:"warning"`
	Info         int       `json:"info"`
	EvaluatedAt  time.Time `json:"evaluated_at"`
}

type artifactEventPayload struct {
	ArtifactID  string    `json:"artifact_id"`
	Kind        string    `json:"kind"`
	ComponentID string    `json:"component_id,omitempty"`
	Key         string    `json:"key,omitempty"`
	SHA256      string    `json:"sha256"`
	SizeBytes   int64     `json:"size_bytes"`
	Immutable   bool      `json:"immutable"`
	Encrypted   bool      `json:"encrypted"`
	CapturedAt  time.Time `json:"captured_at"`
}
