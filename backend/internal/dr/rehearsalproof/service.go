package rehearsalproof

import (
	"context"
	"errors"
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/gameday"
	drmodel "github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/runbookstudio"
)

var (
	ErrUnsupportedRunType = errors.New("rehearsal proof: unsupported run type")
	ErrRunNotRehearsal    = errors.New("rehearsal proof: failover run is not a drill/rehearsal")
)

type GameDayReader interface {
	GetScorecard(ctx context.Context, tenantID uuid.UUID, runID string) (*gameday.Scorecard, error)
}

type RunbookReader interface {
	GetRun(ctx context.Context, tenantID uuid.UUID, runID string) (runbookstudio.LiveState, error)
}

type FailoverReader interface {
	GetFailoverRun(ctx context.Context, tenantID, runID uuid.UUID) (*drmodel.FailoverRun, error)
	ListFailoverSteps(ctx context.Context, tenantID, runID uuid.UUID) ([]*drmodel.FailoverStep, error)
	GetAttestationByRun(ctx context.Context, tenantID, runID uuid.UUID) (*drmodel.Attestation, error)
}

type Service struct {
	assembler *Assembler
	gameday   GameDayReader
	runbooks  RunbookReader
	failover  FailoverReader

	// sealer, store and tx are optional persistence dependencies. When sealer is
	// nil the service is compute-only (backward-compat GET path); when wired, the
	// service can sign+seal+anchor+persist proofs and serve the persisted copy.
	sealer *Sealer
	store  *Store
	tx     TenantRunner
}

// NewService constructs a compute-only proof service (backward-compatible GET
// path). Persistence/sealing is disabled; use NewSealingService to enable it.
func NewService(gameday GameDayReader, runbooks RunbookReader, failover FailoverReader) *Service {
	return &Service{
		assembler: New(nil),
		gameday:   gameday,
		runbooks:  runbooks,
		failover:  failover,
	}
}

// SealingConfig wires the persistence/sealing dependencies onto a Service.
type SealingConfig struct {
	GameDay  GameDayReader
	Runbooks RunbookReader
	Failover FailoverReader
	// Sealer signs+WORM-seals+anchors+persists proofs; required.
	Sealer *Sealer
	// TX runs the persisted-proof read transaction; required.
	TX TenantRunner
	// Store reads persisted proofs; defaults to NewStore() when nil.
	Store *Store
}

// NewSealingService constructs a proof service that also signs, seals, anchors
// and persists proofs. The compute path (GameDayProof/RunbookProof/
// FailoverDrillProof) keeps working unchanged; the Generate*/GetPersisted*
// methods drive the sealed-and-persisted flow.
func NewSealingService(cfg SealingConfig) (*Service, error) {
	if cfg.Sealer == nil {
		return nil, errors.New("rehearsal proof: sealer is required for a sealing service")
	}
	if cfg.TX == nil {
		return nil, errors.New("rehearsal proof: tenant runner is required for a sealing service")
	}
	store := cfg.Store
	if store == nil {
		store = NewStore()
	}
	return &Service{
		assembler: New(nil),
		gameday:   cfg.GameDay,
		runbooks:  cfg.Runbooks,
		failover:  cfg.Failover,
		sealer:    cfg.Sealer,
		store:     store,
		tx:        cfg.TX,
	}, nil
}

// SealingEnabled reports whether the service can sign/seal/anchor/persist.
func (s *Service) SealingEnabled() bool { return s.sealer != nil && s.tx != nil }

func (s *Service) GameDayProof(ctx context.Context, tenantID uuid.UUID, runID string) (*ProofRecord, error) {
	if s.gameday == nil {
		return nil, ErrUnsupportedRunType
	}
	card, err := s.gameday.GetScorecard(ctx, tenantID, strings.TrimSpace(runID))
	if err != nil {
		return nil, err
	}
	if card == nil {
		return nil, gameday.ErrRunNotFound
	}
	return s.assembler.FromGameDayScorecard(*card, GameDayOptions{
		Provenance: Provenance{Source: SourceLiveRun, CapturedFrom: RunTypeGameDay},
	})
}

func (s *Service) RunbookProof(ctx context.Context, tenantID uuid.UUID, runID string) (*ProofRecord, error) {
	if s.runbooks == nil {
		return nil, ErrUnsupportedRunType
	}
	state, err := s.runbooks.GetRun(ctx, tenantID, strings.TrimSpace(runID))
	if err != nil {
		return nil, err
	}
	return s.assembler.FromRunbookStudioState(state, RunbookOptions{
		Scope:      Scope{Name: state.Run.Mode, Environment: state.Run.Mode},
		Provenance: Provenance{Source: SourceLiveRun, CapturedFrom: RunTypeRunbookStudio},
	})
}

func (s *Service) FailoverDrillProof(ctx context.Context, tenantID, runID uuid.UUID) (*ProofRecord, error) {
	if s.failover == nil {
		return nil, ErrUnsupportedRunType
	}
	run, err := s.failover.GetFailoverRun(ctx, tenantID, runID)
	if err != nil {
		return nil, err
	}
	if run == nil {
		return nil, drmodel.ErrNotFound
	}
	if strings.ToLower(run.Mode) != drmodel.ModeDrill {
		return nil, ErrRunNotRehearsal
	}
	steps, err := s.failover.ListFailoverSteps(ctx, tenantID, runID)
	if err != nil {
		return nil, err
	}
	evidence, err := s.failoverEvidence(ctx, tenantID, runID)
	if err != nil {
		return nil, err
	}
	input := FromFailoverRun(*run, FailoverOptions{
		HealthChecks:   failoverStepChecks(steps),
		EvidenceReport: evidence,
		Provenance:     Provenance{Source: SourceLiveRun, CapturedFrom: RunTypeFailoverDrill},
	})
	return s.assembler.Build(input)
}

func (s *Service) failoverEvidence(ctx context.Context, tenantID, runID uuid.UUID) (*EvidenceReportRef, error) {
	att, err := s.failover.GetAttestationByRun(ctx, tenantID, runID)
	if err != nil {
		if errors.Is(err, drmodel.ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	if att == nil {
		return nil, nil
	}
	return &EvidenceReportRef{
		ID:          att.ID,
		Hash:        att.ContentHash,
		Algorithm:   "sha256",
		GeneratedAt: att.CreatedAt,
		Source:      "dr_attestation",
	}, nil
}

func failoverStepChecks(steps []*drmodel.FailoverStep) []HealthCheck {
	checks := make([]HealthCheck, 0, len(steps))
	for _, step := range steps {
		if step == nil {
			continue
		}
		checkedAt := step.StartedAt
		if step.FinishedAt != nil {
			checkedAt = *step.FinishedAt
		}
		passed := step.Status == drmodel.StepStatusPassed
		checks = append(checks, HealthCheck{
			Name:       step.Step,
			Status:     verdictFromFailoverStepStatus(step.Status),
			Passed:     passed,
			CheckedAt:  checkedAt,
			EvidenceID: step.ID,
			FinishedAt: utcPtr(step.FinishedAt),
		})
	}
	return checks
}

// ErrSealingDisabled is returned by the persist/generate methods when the
// service was constructed without sealing dependencies.
var ErrSealingDisabled = errors.New("rehearsal proof: sealing is not configured on this deployment")

// GenerateGameDayProof assembles the game-day proof, then signs, WORM-seals,
// anchors it into the attestation-ledger Merkle chain, and persists the row.
func (s *Service) GenerateGameDayProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error) {
	record, err := s.GameDayProof(ctx, tenantID, runID)
	if err != nil {
		return nil, err
	}
	return s.seal(ctx, SubjectKindGameDay, record)
}

// GenerateRunbookProof assembles the runbook-studio proof and seals+persists it.
func (s *Service) GenerateRunbookProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error) {
	record, err := s.RunbookProof(ctx, tenantID, runID)
	if err != nil {
		return nil, err
	}
	return s.seal(ctx, SubjectKindRunbookStudio, record)
}

// GenerateFailoverDrillProof assembles the failover-drill proof and
// seals+persists it.
func (s *Service) GenerateFailoverDrillProof(ctx context.Context, tenantID, runID uuid.UUID) (*SealedProof, error) {
	record, err := s.FailoverDrillProof(ctx, tenantID, runID)
	if err != nil {
		return nil, err
	}
	return s.seal(ctx, SubjectKindFailoverDrill, record)
}

func (s *Service) seal(ctx context.Context, kind string, record *ProofRecord) (*SealedProof, error) {
	if !s.SealingEnabled() {
		return nil, ErrSealingDisabled
	}
	return s.sealer.Seal(ctx, kind, record)
}

// GetPersistedGameDayProof returns the most recent persisted, signed, sealed
// game-day proof for a run, or ErrProofNotFound when none is stored.
func (s *Service) GetPersistedGameDayProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error) {
	return s.getPersisted(ctx, tenantID, SubjectKindGameDay, runID)
}

// GetPersistedRunbookProof returns the most recent persisted runbook-studio proof.
func (s *Service) GetPersistedRunbookProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error) {
	return s.getPersisted(ctx, tenantID, SubjectKindRunbookStudio, runID)
}

// GetPersistedFailoverDrillProof returns the most recent persisted failover-drill proof.
func (s *Service) GetPersistedFailoverDrillProof(ctx context.Context, tenantID uuid.UUID, runID string) (*SealedProof, error) {
	return s.getPersisted(ctx, tenantID, SubjectKindFailoverDrill, runID)
}

func (s *Service) getPersisted(ctx context.Context, tenantID uuid.UUID, kind, runID string) (*SealedProof, error) {
	if !s.SealingEnabled() {
		return nil, ErrSealingDisabled
	}
	runID = strings.TrimSpace(runID)
	var proof *SealedProof
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var e error
		proof, e = s.store.GetLatestBySubject(ctx, db, tenantID, kind, runID)
		return e
	})
	if err != nil {
		return nil, err
	}
	return proof, nil
}

func verdictFromFailoverStepStatus(status string) string {
	switch status {
	case drmodel.StepStatusPassed:
		return VerdictPassed
	case drmodel.StepStatusFailed:
		return VerdictFailed
	default:
		return VerdictUnknown
	}
}
