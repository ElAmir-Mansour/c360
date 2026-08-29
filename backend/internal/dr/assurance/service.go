package assurance

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

// eventSource is the CloudEvents source attribute for assurance events.
const eventSource = "clario-dr/assurance"

// EventEvaluated is the lifecycle event type emitted (to the DR events topic)
// when a recovery-assurance evaluation completes.
const EventEvaluated = "datastream.dr.assurance.evaluated"

// storeAPI is the persistence surface the service needs. *Store satisfies it;
// tests substitute an in-memory fake so the service's collect/score/persist
// orchestration is exercised without a database.
type storeAPI interface {
	GroupExists(ctx context.Context, db DBTX, groupID uuid.UUID) (string, bool, error)
	SaveAssessment(ctx context.Context, db DBTX, hdr *StoredAssessment, results []StoredResult) error
	GetAssessment(ctx context.Context, db DBTX, id uuid.UUID) (*StoredAssessment, error)
	LatestForGroup(ctx context.Context, db DBTX, groupID uuid.UUID) (*StoredAssessment, error)
	ListResults(ctx context.Context, db DBTX, assessmentID uuid.UUID) ([]StoredResult, error)
}

// evidenceCollector is the evidence-collection surface. *Collector satisfies it.
type evidenceCollector interface {
	Collect(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) (AssuranceEvidence, error)
}

// txRunner runs a function inside a tenant-scoped transaction. An evaluation
// commits the assessment header, its control results and its outbox event under
// one read-write tenant transaction; a report read uses the read-only path so RLS
// filters by tenant.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant
// transaction helpers, so every query runs under SET LOCAL app.current_tenant_id
// (RLS backstop).
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

// Service is the request-path orchestration for continuous recovery assurance: it
// lists the static control catalog, runs an evaluation (collect real evidence ->
// deterministic weighted score -> persist header+results+event atomically), and
// reconstructs a stored evaluation into a report with findings. The scoring
// algorithm lives in the Evaluator (evaluator.go); this owns wiring and
// persistence only.
type Service struct {
	store     storeAPI
	collector evidenceCollector
	runner    txRunner
	metrics   *Metrics
	topic     string
	now       func() time.Time
	logger    zerolog.Logger
}

// Config configures a Service. Topic is the DR events topic the evaluation event
// is staged to (datastream.dr.events); Clock defaults to time.Now (tests inject a
// fixed clock for deterministic date-window evaluation).
type Config struct {
	Store     storeAPI
	Collector evidenceCollector
	Runner    txRunner
	Metrics   *Metrics
	Topic     string
	Clock     func() time.Time
	Logger    zerolog.Logger
}

// NewService constructs a Service. The clock is shared with the evaluator so the
// service and every time-windowed control evaluate against the same instant.
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
		collector: cfg.Collector,
		runner:    cfg.Runner,
		metrics:   cfg.Metrics,
		topic:     topic,
		now:       clock,
		logger:    cfg.Logger.With().Str("component", "dr-assurance").Logger(),
	}
}

// ListControls returns the static assurance control catalog (deterministic
// evaluation order).
func (s *Service) ListControls() []ControlInfo { return Controls() }

func (s *Service) ensureWriteReady() error {
	if s == nil || s.runner == nil || s.store == nil || s.collector == nil {
		return ErrServiceUnavailable
	}
	return nil
}

func (s *Service) ensureReadReady() error {
	if s == nil || s.runner == nil || s.store == nil {
		return ErrServiceUnavailable
	}
	return nil
}

// Evaluate scores the group's continuous recovery assurance against its real
// evidence and persists the result. It (1) verifies the group exists in the
// tenant's scope, (2) collects evidence through the wired sources, (3) scores
// deterministically with the shared clock, then (4) persists the header, the
// per-control rows, and the lifecycle event in one tenant transaction. The
// persisted header is returned with its generated id.
func (s *Service) Evaluate(ctx context.Context, tenantID, groupID, actor uuid.UUID) (*StoredAssessment, *AssuranceAssessment, error) {
	if err := s.ensureWriteReady(); err != nil {
		return nil, nil, err
	}

	var hdr *StoredAssessment
	var scored AssuranceAssessment

	err := s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		// Group must exist in the tenant's scope; otherwise the evaluation would
		// score against empty evidence for a group the tenant does not own.
		if _, exists, gErr := s.store.GroupExists(ctx, db, groupID); gErr != nil {
			return gErr
		} else if !exists {
			return ErrGroupNotFound
		}

		ev, cErr := s.collector.Collect(ctx, db, tenantID, groupID)
		if cErr != nil {
			return fmt.Errorf("collect evidence: %w", cErr)
		}

		profile := AssuranceProfile{TenantID: tenantID.String(), GroupID: groupID.String()}
		scored = Evaluate(profile, ev, s.now())

		hdr = &StoredAssessment{
			TenantID:         tenantID,
			GroupID:          groupID,
			ProfileID:        scored.ProfileID,
			WorkloadID:       scored.WorkloadID,
			Score:            scored.Score,
			Verdict:          scored.Verdict,
			TotalChecks:      scored.TotalChecks,
			Satisfied:        scored.Satisfied,
			Partial:          scored.Partial,
			Failed:           scored.Failed,
			EvidenceSnapshot: ev,
			CreatedBy:        actor,
		}
		results := toStoredResults(scored.Results)

		if sErr := s.store.SaveAssessment(ctx, db, hdr, results); sErr != nil {
			return fmt.Errorf("save assessment: %w", sErr)
		}

		return s.stageEvent(ctx, db, tenantID, hdr, scored)
	})
	if err != nil {
		return nil, nil, err
	}

	s.metrics.ObserveEvaluation(groupID.String(), scored)
	s.logger.Info().
		Str("group", groupID.String()).
		Float64("score", scored.Score).
		Str("verdict", string(scored.Verdict)).
		Int("findings", len(scored.Findings)).
		Msg("assurance evaluation completed")

	return hdr, &scored, nil
}

// stageEvent stages the evaluation lifecycle event in the same transaction as the
// assessment write (exactly-once via the outbox).
func (s *Service) stageEvent(ctx context.Context, db DBTX, tenantID uuid.UUID, hdr *StoredAssessment, scored AssuranceAssessment) error {
	payload := evaluationEventPayload{
		AssessmentID: hdr.ID.String(),
		GroupID:      hdr.GroupID.String(),
		Score:        scored.Score,
		Verdict:      string(scored.Verdict),
		TotalChecks:  scored.TotalChecks,
		Satisfied:    scored.Satisfied,
		Partial:      scored.Partial,
		Failed:       scored.Failed,
		FindingCount: len(scored.Findings),
		EvaluatedAt:  scored.EvaluatedAt,
	}
	evt, err := events.NewEvent(EventEvaluated, eventSource, tenantID.String(), payload)
	if err != nil {
		return fmt.Errorf("build assurance evaluated event: %w", err)
	}
	if err := outbox.Write(ctx, db, s.topic, evt); err != nil {
		return fmt.Errorf("stage assurance evaluated event: %w", err)
	}
	return nil
}

// evaluationEventPayload is the data of the evaluation lifecycle event.
type evaluationEventPayload struct {
	AssessmentID string    `json:"assessment_id"`
	GroupID      string    `json:"group_id"`
	Score        float64   `json:"score"`
	Verdict      string    `json:"verdict"`
	TotalChecks  int       `json:"total_checks"`
	Satisfied    int       `json:"satisfied"`
	Partial      int       `json:"partial"`
	Failed       int       `json:"failed"`
	FindingCount int       `json:"finding_count"`
	EvaluatedAt  time.Time `json:"evaluated_at"`
}

// GetReport reconstructs a stored evaluation into a report: the header, every
// control result, and the derived findings + recommendations. Returns
// ErrAssessmentNotFound when the id is not in the tenant's scope.
func (s *Service) GetReport(ctx context.Context, tenantID, id uuid.UUID) (*AssessmentReport, error) {
	if err := s.ensureReadReady(); err != nil {
		return nil, err
	}

	var report *AssessmentReport
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		hdr, hErr := s.store.GetAssessment(ctx, db, id)
		if hErr != nil {
			return hErr
		}
		results, rErr := s.store.ListResults(ctx, db, id)
		if rErr != nil {
			return rErr
		}
		report = buildReport(hdr, results)
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

// GetLatest reconstructs the most recent evaluation for a group into a report.
// Returns ErrAssessmentNotFound when the group has no recorded evaluation.
func (s *Service) GetLatest(ctx context.Context, tenantID, groupID uuid.UUID) (*AssessmentReport, error) {
	if err := s.ensureReadReady(); err != nil {
		return nil, err
	}

	var report *AssessmentReport
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		hdr, hErr := s.store.LatestForGroup(ctx, db, groupID)
		if hErr != nil {
			return hErr
		}
		results, rErr := s.store.ListResults(ctx, db, hdr.ID)
		if rErr != nil {
			return rErr
		}
		report = buildReport(hdr, results)
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

// buildReport assembles the header + results into a report, deriving findings and
// recommendations from the stored rows alone.
func buildReport(hdr *StoredAssessment, results []StoredResult) *AssessmentReport {
	findings, recommendations := findingsFromResults(results)
	return &AssessmentReport{
		Assessment:      *hdr,
		Results:         results,
		Findings:        findings,
		Recommendations: recommendations,
	}
}
