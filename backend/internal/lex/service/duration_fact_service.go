package service

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// DurationFactService maintains the processing-time fact store. Facts are
// idempotently upserted from lifecycle transitions. The reporting consumer calls
// UpsertFromTransition when the event carries both bounds, or UpsertFromSource
// when only a terminal subject ID is present. All working-minute math flows
// through the working-calendar Calculator obtained via the ReportingCalendarPort,
// so durations are on the CAP working-day basis. Request-processing facts also
// carry the terminal SLA outcome consumed by the flagship compliance KPI.
type DurationFactService struct {
	repo     *repository.DurationFactRepository
	calendar ReportingCalendarPort
	logger   zerolog.Logger
}

func NewDurationFactService(repo *repository.DurationFactRepository, calendarPort ReportingCalendarPort, logger zerolog.Logger) *DurationFactService {
	return &DurationFactService{
		repo:     repo,
		calendar: calendarPort,
		logger:   logger.With().Str("service", "lex-duration-fact").Logger(),
	}
}

// UpsertFromTransition records (or refreshes) the processing-time fact for one
// subject. It validates the request, computes both wall-clock and working
// minutes, and writes the row keyed by (tenant, kind, subject). Out-of-order
// events are absorbed by the repository's occurred_at guard.
func (s *DurationFactService) UpsertFromTransition(ctx context.Context, tenantID uuid.UUID, req dto.UpsertDurationFactRequest) (*model.DurationFact, error) {
	if !model.ValidDurationFactKind(req.Kind) {
		return nil, validationError("invalid duration fact kind", map[string]string{"kind": "invalid"})
	}
	if req.SubjectID == uuid.Nil {
		return nil, validationError("subject_id is required", map[string]string{"subject_id": "required"})
	}
	if req.StartedAt.IsZero() || req.EndedAt.IsZero() {
		return nil, validationError("started_at and ended_at are required", map[string]string{"started_at": "required"})
	}
	if req.EndedAt.Before(req.StartedAt) {
		return nil, validationError("ended_at must not precede started_at", map[string]string{"ended_at": "before_start"})
	}
	if req.SLATargetMinutes != nil && *req.SLATargetMinutes < 0 {
		return nil, validationError("sla_target_minutes must be non-negative", map[string]string{"sla_target_minutes": "invalid"})
	}
	if req.SLAOutcome != nil && !req.SLAOutcome.Valid() {
		return nil, validationError("sla_outcome is invalid", map[string]string{"sla_outcome": "invalid"})
	}
	occurredAt := req.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = req.EndedAt
	}

	wallMinutes := int(req.EndedAt.Sub(req.StartedAt) / time.Minute)
	if wallMinutes < 0 {
		wallMinutes = 0
	}
	workingMinutes := wallMinutes
	if s.calendar != nil {
		if calc, err := s.calendar.CalculatorFor(ctx, tenantID); err == nil && calc != nil {
			workingMinutes = calc.WorkingMinutesBetween(req.StartedAt, req.EndedAt)
		}
	}
	slaOutcome := req.SLAOutcome
	if req.Kind == model.DurationFactRequestProcessing && req.SLATargetMinutes != nil && (slaOutcome == nil || *slaOutcome == model.SLAClockOutcomePending) {
		computed := model.SLAClockOutcomeBreached
		if workingMinutes <= *req.SLATargetMinutes {
			computed = model.SLAClockOutcomeOnTime
		}
		slaOutcome = &computed
	}

	fact := &model.DurationFact{
		ID:               uuid.New(),
		TenantID:         tenantID,
		Kind:             req.Kind,
		SubjectID:        req.SubjectID,
		Department:       normalizeOptionalString(req.Department),
		Category:         normalizeOptionalString(req.Category),
		StartedAt:        req.StartedAt.UTC(),
		EndedAt:          req.EndedAt.UTC(),
		DurationMinutes:  wallMinutes,
		WorkingMinutes:   workingMinutes,
		SLATargetMinutes: req.SLATargetMinutes,
		SLAOutcome:       slaOutcome,
		OccurredAt:       occurredAt.UTC(),
	}
	if err := s.repo.Upsert(ctx, fact); err != nil {
		return nil, internalError("upsert duration fact", err)
	}
	return fact, nil
}

// UpsertFromSource reconstructs the transition bounds from canonical source
// tables and then writes the same duration fact as UpsertFromTransition. It is
// used for terminal events that intentionally publish only IDs.
func (s *DurationFactService) UpsertFromSource(ctx context.Context, tenantID uuid.UUID, kind model.DurationFactKind, subjectID uuid.UUID, occurredAt time.Time) (*model.DurationFact, error) {
	if !model.ValidDurationFactKind(kind) {
		return nil, validationError("invalid duration fact kind", map[string]string{"kind": "invalid"})
	}
	if subjectID == uuid.Nil {
		return nil, validationError("subject_id is required", map[string]string{"subject_id": "required"})
	}
	source, err := s.repo.LoadTransitionSource(ctx, tenantID, kind, subjectID)
	if err != nil {
		return nil, internalError("load duration fact source", err)
	}
	if occurredAt.IsZero() {
		occurredAt = source.EndedAt
	}
	return s.UpsertFromTransition(ctx, tenantID, dto.UpsertDurationFactRequest{
		Kind:             kind,
		SubjectID:        subjectID,
		Department:       source.Department,
		Category:         source.Category,
		StartedAt:        source.StartedAt,
		EndedAt:          source.EndedAt,
		OccurredAt:       occurredAt,
		SLATargetMinutes: targetMinutesFromSeconds(source.SLATargetSeconds),
		SLAOutcome:       source.SLAOutcome,
	})
}

func targetMinutesFromSeconds(seconds *int64) *int {
	if seconds == nil {
		return nil
	}
	minutes := int((*seconds + 59) / 60)
	if minutes < 0 {
		minutes = 0
	}
	return &minutes
}

// AverageWorkingHours returns the average working hours and sample size for a kind
// across the window, reading the fact store. A zero sample means no facts exist.
func (s *DurationFactService) AverageWorkingHours(ctx context.Context, tenantID uuid.UUID, kind model.DurationFactKind, filters model.ReportFilters) (avgHours float64, sample int, err error) {
	rf := repository.NewReportFilter(filters)
	avgMinutes, sample, err := s.repo.AvgWorkingMinutes(ctx, tenantID, kind, rf)
	if err != nil {
		return 0, 0, internalError("read duration facts", err)
	}
	return avgMinutes / 60.0, sample, nil
}
