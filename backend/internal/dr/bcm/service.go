package bcm

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

// eventSource is the CloudEvents source attribute for BCM events.
const eventSource = "clario-dr/bcm"

// EventAssessed is the lifecycle event type emitted (to the DR events topic)
// when an assessment completes.
const EventAssessed = "datastream.dr.bcm.assessed"

// storeAPI is the persistence surface the service needs. *Store satisfies it;
// tests substitute an in-memory fake so the service's collect/score/persist
// orchestration is exercised without a database.
type storeAPI interface {
	GroupExists(ctx context.Context, db DBTX, groupID uuid.UUID) (string, bool, error)
	SaveAssessment(ctx context.Context, db DBTX, hdr *StoredAssessment, results []StoredControlResult) error
	GetAssessment(ctx context.Context, db DBTX, id uuid.UUID) (*StoredAssessment, error)
	ListControlResults(ctx context.Context, db DBTX, assessmentID uuid.UUID) ([]StoredControlResult, error)
}

// collector is the evidence-collection surface. *EvidenceCollector satisfies it.
type collector interface {
	Collect(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) (*Evidence, error)
}

// txRunner runs a function inside a tenant-scoped transaction. An assess commits
// the assessment header, its control results and its outbox event under one
// read-write tenant transaction; a report read uses the read-only path so RLS
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

// Service is the request-path orchestration for BCM compliance packs: it lists
// the static catalog, runs an assessment (collect real evidence -> deterministic
// score -> persist header+results+event atomically), and reconstructs a stored
// assessment into an auditor-ready report with gaps. The scoring algorithm lives
// in the Scorer (scorer.go); this owns wiring and persistence only.
type Service struct {
	store     storeAPI
	collector collector
	scorer    *Scorer
	runner    txRunner
	metrics   *Metrics
	topic     string
	now       func() time.Time
	logger    zerolog.Logger
}

// Config configures a Service. Topic is the DR events topic the assessment event
// is staged to (datastream.dr.events); Clock defaults to time.Now (tests inject
// a fixed clock for deterministic date-window evaluation).
type Config struct {
	Store     storeAPI
	Collector collector
	Runner    txRunner
	Metrics   *Metrics
	Topic     string
	Clock     func() time.Time
	Logger    zerolog.Logger
}

// NewService constructs a Service. The scorer is built over Config.Clock so the
// service and scorer share one clock.
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
		scorer:    NewScorer(clock),
		runner:    cfg.Runner,
		metrics:   cfg.Metrics,
		topic:     topic,
		now:       clock,
		logger:    cfg.Logger.With().Str("component", "dr-bcm").Logger(),
	}
}

// ListPacks returns the static catalog (deterministic, sorted by key).
func (s *Service) ListPacks() []Pack { return Packs() }

// GetPack returns a single pack by key, or ErrPackNotFound.
func (s *Service) GetPack(key string) (Pack, error) {
	p, ok := PackByKey(key)
	if !ok {
		return Pack{}, ErrPackNotFound
	}
	return p, nil
}

// Assess runs the pack against the group's real evidence and persists the
// result. It (1) verifies the pack exists, (2) verifies the group exists in the
// tenant's scope, (3) collects evidence, (4) scores deterministically, then (5)
// persists the header, the per-control rows, and the lifecycle event in one
// tenant transaction. The persisted header is returned with its generated id.
func (s *Service) Assess(ctx context.Context, tenantID, groupID, actor uuid.UUID, packKey string) (*StoredAssessment, *Assessment, error) {
	pack, ok := PackByKey(packKey)
	if !ok {
		return nil, nil, ErrPackNotFound
	}

	var hdr *StoredAssessment
	var scored Assessment

	err := s.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		// Group must exist in the tenant's scope; otherwise the assessment would
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

		scored = s.scorer.Score(pack, ev)
		scored.GroupID = groupID.String()

		hdr = &StoredAssessment{
			TenantID:      tenantID,
			GroupID:       groupID,
			PackKey:       pack.Key,
			Standard:      pack.Standard,
			PackVersion:   pack.Version,
			Score:         scored.Score,
			Compliant:     scored.Compliant,
			TotalControls: scored.TotalControls,
			Satisfied:     scored.Satisfied,
			Partial:       scored.Partial,
			Failed:        scored.Failed,
			CreatedBy:     actor,
		}
		results := toStoredResults(scored.ControlResults)

		if sErr := s.store.SaveAssessment(ctx, db, hdr, results); sErr != nil {
			return fmt.Errorf("save assessment: %w", sErr)
		}

		return s.stageEvent(ctx, db, tenantID, hdr, scored)
	})
	if err != nil {
		return nil, nil, err
	}

	s.metrics.ObserveAssessment(pack.Key, groupID.String(), scored)
	s.logger.Info().
		Str("pack", pack.Key).
		Str("group", groupID.String()).
		Float64("score", scored.Score).
		Bool("compliant", scored.Compliant).
		Int("gaps", len(scored.Gaps)).
		Msg("bcm assessment completed")

	return hdr, &scored, nil
}

// stageEvent stages the assessment lifecycle event in the same transaction as
// the assessment write (exactly-once via the outbox).
func (s *Service) stageEvent(ctx context.Context, db DBTX, tenantID uuid.UUID, hdr *StoredAssessment, scored Assessment) error {
	payload := assessmentEventPayload{
		AssessmentID:  hdr.ID.String(),
		PackKey:       hdr.PackKey,
		Standard:      hdr.Standard,
		GroupID:       hdr.GroupID.String(),
		Score:         scored.Score,
		Compliant:     scored.Compliant,
		TotalControls: scored.TotalControls,
		Satisfied:     scored.Satisfied,
		Partial:       scored.Partial,
		Failed:        scored.Failed,
		GapCount:      len(scored.Gaps),
		EvaluatedAt:   scored.EvaluatedAt,
	}
	evt, err := events.NewEvent(EventAssessed, eventSource, tenantID.String(), payload)
	if err != nil {
		return fmt.Errorf("build bcm assessed event: %w", err)
	}
	if err := outbox.Write(ctx, db, s.topic, evt); err != nil {
		return fmt.Errorf("stage bcm assessed event: %w", err)
	}
	return nil
}

// assessmentEventPayload is the data of the assessment lifecycle event.
type assessmentEventPayload struct {
	AssessmentID  string    `json:"assessment_id"`
	PackKey       string    `json:"pack_key"`
	Standard      string    `json:"standard"`
	GroupID       string    `json:"group_id"`
	Score         float64   `json:"score"`
	Compliant     bool      `json:"compliant"`
	TotalControls int       `json:"total_controls"`
	Satisfied     int       `json:"satisfied"`
	Partial       int       `json:"partial"`
	Failed        int       `json:"failed"`
	GapCount      int       `json:"gap_count"`
	EvaluatedAt   time.Time `json:"evaluated_at"`
}

// GetReport reconstructs a stored assessment into an auditor-ready report: the
// header, every control result, and the derived gap list. Returns
// ErrAssessmentNotFound when the id is not in the tenant's scope.
func (s *Service) GetReport(ctx context.Context, tenantID, id uuid.UUID) (*AssessmentReport, error) {
	var report *AssessmentReport
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db DBTX) error {
		hdr, hErr := s.store.GetAssessment(ctx, db, id)
		if hErr != nil {
			return hErr
		}
		results, rErr := s.store.ListControlResults(ctx, db, id)
		if rErr != nil {
			return rErr
		}
		report = &AssessmentReport{
			Assessment:     *hdr,
			ControlResults: results,
			Gaps:           gapsFromResults(results),
		}
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

// toStoredResults maps the scored control results to persistence rows. The
// assessment_id and tenant_id are filled by the store at insert time.
func toStoredResults(in []ControlResult) []StoredControlResult {
	out := make([]StoredControlResult, 0, len(in))
	for _, r := range in {
		refs := r.EvidenceRefs
		if refs == nil {
			refs = []string{}
		}
		out = append(out, StoredControlResult{
			ControlCode:  r.Code,
			ControlTitle: r.Title,
			Verdict:      r.Verdict,
			Reason:       r.Reason,
			Mandatory:    r.Mandatory,
			Weight:       r.Weight,
			EvidenceRefs: refs,
		})
	}
	return out
}
