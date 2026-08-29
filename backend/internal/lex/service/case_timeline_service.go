package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// CaseTimelineService implements the Case Timelines vertical (CAP-084..088):
// per-matter duration estimates, the external-pending / delay state, and the
// classified delay-event register. It sits OVER legal_matters via the dedicated
// CaseDelayRepository (which only ever touches the timeline extension columns the
// staged ALTER adds) and the MatterRepository (existence + the LegalHold guard).
//
// CAP-085 is a NO-OP-by-design: due_date is nullable and this service never forces
// a matter closed when a deadline lapses — it records the delay instead. For an
// objection/hearing deadline reminder it creates a LINKED legal_obligation rather
// than a new timer, so the existing obligation reminder outbox + monitor fire the
// reminder with no new scheduling primitive (CAP-086/087 deadline tracking).
//
// Every mutation runs in a transaction, applies the LegalHold guard where matter
// preservation matters, and emits a CloudEvent on events.Topics.LexEvents.
type CaseTimelineService struct {
	db          *pgxpool.Pool
	delays      *repository.CaseDelayRepository
	matters     *repository.MatterRepository
	obligations *repository.ObligationRepository
	publisher   Publisher
	metrics     *metrics.Metrics
	topic       string
	logger      zerolog.Logger
	now         func() time.Time
	legalHolds  LegalHoldGuard
}

func NewCaseTimelineService(
	db *pgxpool.Pool,
	delays *repository.CaseDelayRepository,
	matters *repository.MatterRepository,
	obligations *repository.ObligationRepository,
	publisher Publisher,
	appMetrics *metrics.Metrics,
	topic string,
	logger zerolog.Logger,
) *CaseTimelineService {
	return &CaseTimelineService{
		db:          db,
		delays:      delays,
		matters:     matters,
		obligations: obligations,
		publisher:   publisherOrNoop(publisher),
		metrics:     appMetrics,
		topic:       topic,
		logger:      logger.With().Str("service", "lex-case-timelines").Logger(),
		now:         time.Now,
	}
}

// WithLegalHoldGuard wires the legal-hold enforcement guard (additive, chainable).
func (s *CaseTimelineService) WithLegalHoldGuard(guard LegalHoldGuard) *CaseTimelineService {
	s.legalHolds = guard
	return s
}

// GetTimeline returns the timeline projection of a matter with its delay-event
// register and the running open-delay-day total (CAP-084..088).
func (s *CaseTimelineService) GetTimeline(ctx context.Context, tenantID, matterID uuid.UUID) (*model.MatterTimeline, error) {
	timeline, err := s.delays.GetTimeline(ctx, s.db, tenantID, matterID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("load matter timeline", err)
	}
	events, _, err := s.delays.ListDelayEvents(ctx, tenantID, model.DelayEventListFilters{MatterID: matterID, Page: 1, PerPage: 200, SortColumn: "opened_at", SortDir: "desc"})
	if err != nil {
		return nil, internalError("load matter delay events", err)
	}
	timeline.DelayEvents = events
	timeline.OpenDelayDays = computeOpenDelayDays(events, s.now().UTC())
	return timeline, nil
}

// UpdateTimeline records the estimated duration / completion projection (CAP-084).
func (s *CaseTimelineService) UpdateTimeline(ctx context.Context, tenantID, userID, matterID uuid.UUID, req dto.UpdateMatterTimelineRequest) (*model.MatterTimeline, error) {
	if req.EstimatedDurationDays != nil && *req.EstimatedDurationDays < 0 {
		return nil, validationError("estimated_duration_days must be >= 0", map[string]string{"estimated_duration_days": "invalid"})
	}
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	durationDays := req.EstimatedDurationDays
	completionDate := req.EstimatedCompletionDate
	if req.ClearEstimate {
		durationDays = nil
		completionDate = nil
	}
	if err := s.delays.UpdateTimeline(ctx, s.db, tenantID, matterID, durationDays, completionDate); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("update matter timeline", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.timeline_updated", tenantID, &userID, map[string]any{
		"id":                        matterID,
		"matter_id":                 matterID,
		"estimated_duration_days":   durationDays,
		"estimated_completion_date": completionDate,
		"cleared":                   req.ClearEstimate,
	}, s.logger)
	return s.GetTimeline(ctx, tenantID, matterID)
}

// SetExternalHold flags or clears the external-pending state on a matter
// (CAP-087/088). Setting an external hold requires a classified category. CAP-085:
// this never forces the matter closed.
func (s *CaseTimelineService) SetExternalHold(ctx context.Context, tenantID, userID, matterID uuid.UUID, req dto.SetExternalHoldRequest) (*model.MatterTimeline, error) {
	req.Normalize()
	if req.Held {
		if req.Category == nil || !req.Category.Valid() {
			return nil, validationError("a valid category is required when flagging an external hold", map[string]string{"category": "invalid"})
		}
	}
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start external hold transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.delays.SetExternalHold(ctx, tx, tenantID, matterID, req.Held, req.Category, req.Since); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("matter not found")
		}
		return nil, internalError("set matter external hold", err)
	}
	// #12 — record the hold change in the immutable history trail within the same
	// transaction so the audit row and the legal_matters update commit atomically.
	action := "cleared"
	historyCategory := req.Category
	if !req.Held {
		historyCategory = nil
	}
	if req.Held {
		action = "set"
	}
	var historyReason *string
	if req.Reason != "" {
		reason := req.Reason
		historyReason = &reason
	}
	if err := s.delays.InsertHoldHistory(ctx, tx, &model.LegalCaseHoldHistory{
		ID:        uuid.New(),
		TenantID:  tenantID,
		MatterID:  matterID,
		Action:    action,
		Category:  historyCategory,
		Reason:    historyReason,
		CreatedBy: userID,
	}); err != nil {
		return nil, internalError("record external hold history", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit external hold", err)
	}
	verb := "external_hold_cleared"
	if req.Held {
		verb = "external_hold_set"
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter."+verb, tenantID, &userID, map[string]any{
		"id":        matterID,
		"matter_id": matterID,
		"held":      req.Held,
		"category":  req.Category,
		"reason":    req.Reason,
	}, s.logger)
	return s.GetTimeline(ctx, tenantID, matterID)
}

// RecordDelayEvent opens a classified delay window on a matter (CAP-086), optionally
// also flipping the matter into external-pending (CAP-087/088). Both writes commit
// in one transaction.
func (s *CaseTimelineService) RecordDelayEvent(ctx context.Context, tenantID, userID, matterID uuid.UUID, req dto.RecordDelayEventRequest) (*model.LegalCaseDelayEvent, error) {
	req.Normalize()
	if !req.Category.Valid() {
		return nil, validationError("invalid delay category", map[string]string{"category": "invalid"})
	}
	if req.Reason == "" {
		return nil, validationError("reason is required", map[string]string{"reason": "required"})
	}
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	openedAt := s.now().UTC()
	if req.OpenedAt != nil {
		openedAt = req.OpenedAt.UTC()
	}
	event := &model.LegalCaseDelayEvent{
		ID:        uuid.New(),
		TenantID:  tenantID,
		MatterID:  matterID,
		Category:  req.Category,
		Reason:    req.Reason,
		OpenedAt:  openedAt,
		Metadata:  req.Metadata,
		CreatedBy: userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start delay event transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.delays.CreateDelayEvent(ctx, tx, event); err != nil {
		return nil, internalError("create delay event", err)
	}
	if req.AlsoMarkExternalHold {
		category := req.Category
		if err := s.delays.SetExternalHold(ctx, tx, tenantID, matterID, true, &category, &openedAt); err != nil {
			if err == pgx.ErrNoRows {
				return nil, notFoundError("matter not found")
			}
			return nil, internalError("set matter external hold", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit delay event", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.delay_recorded", tenantID, &userID, map[string]any{
		"id":             matterID,
		"matter_id":      matterID,
		"delay_event_id": event.ID,
		"category":       event.Category,
		"reason":         event.Reason,
		"opened_at":      event.OpenedAt,
	}, s.logger)
	return event, nil
}

// ListDelayEvents returns the classified delay register for a matter (CAP-086/088).
func (s *CaseTimelineService) ListDelayEvents(ctx context.Context, tenantID uuid.UUID, filters model.DelayEventListFilters) ([]model.LegalCaseDelayEvent, int, error) {
	if err := s.ensureMatter(ctx, tenantID, filters.MatterID); err != nil {
		return nil, 0, err
	}
	return s.delays.ListDelayEvents(ctx, tenantID, filters)
}

// ResolveDelayEvent closes an open delay window (CAP-086), optionally clearing the
// matter external-pending flag when no other windows remain open.
func (s *CaseTimelineService) ResolveDelayEvent(ctx context.Context, tenantID, userID, matterID, eventID uuid.UUID, req dto.ResolveDelayEventRequest) (*model.LegalCaseDelayEvent, error) {
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	resolvedAt := s.now().UTC()
	if req.ResolvedAt != nil {
		resolvedAt = req.ResolvedAt.UTC()
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start delay resolve transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.delays.ResolveDelayEvent(ctx, tx, tenantID, matterID, eventID, resolvedAt); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("open delay event not found")
		}
		return nil, internalError("resolve delay event", err)
	}
	if req.AlsoClearExternalHold {
		// Count delay windows still open WITHIN this transaction (so the just-resolved
		// row, whose UPDATE is uncommitted, is correctly seen as closed). Only clear
		// the matter external-pending flag when none remain.
		var remaining int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*)
			FROM legal_case_delay_events
			WHERE tenant_id = $1 AND matter_id = $2 AND deleted_at IS NULL AND resolved_at IS NULL`,
			tenantID, matterID,
		).Scan(&remaining); err != nil {
			return nil, internalError("check remaining open delays", err)
		}
		if remaining == 0 {
			if err := s.delays.SetExternalHold(ctx, tx, tenantID, matterID, false, nil, nil); err != nil {
				if err == pgx.ErrNoRows {
					return nil, notFoundError("matter not found")
				}
				return nil, internalError("clear matter external hold", err)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit delay resolve", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.delay_resolved", tenantID, &userID, map[string]any{
		"id":             matterID,
		"matter_id":      matterID,
		"delay_event_id": eventID,
		"resolved_at":    resolvedAt,
	}, s.logger)
	event, err := s.delays.GetDelayEvent(ctx, tenantID, matterID, eventID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("delay event not found")
		}
		return nil, internalError("reload delay event", err)
	}
	return event, nil
}

// ListMatterTimelineSummaries returns the cross-matter (portfolio) timeline
// summary for the caller's tenant (#15), powering a manager triage dashboard.
func (s *CaseTimelineService) ListMatterTimelineSummaries(ctx context.Context, tenantID uuid.UUID, filters model.MatterTimelineSummaryFilters) ([]model.MatterTimelineSummary, int, error) {
	items, total, err := s.delays.ListMatterTimelineSummaries(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("list matter timeline summaries", err)
	}
	return items, total, nil
}

// ListHoldHistory returns the external-hold change trail for a matter, newest
// first (#12).
func (s *CaseTimelineService) ListHoldHistory(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.LegalCaseHoldHistory, error) {
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	rows, err := s.delays.ListHoldHistory(ctx, tenantID, matterID)
	if err != nil {
		return nil, internalError("list external hold history", err)
	}
	return rows, nil
}

// UpdateDelayEvent edits the category and/or reason of an existing (non-deleted)
// delay event (#13). At least one field must be provided. A provided category must
// be a valid DelayCategory; a provided reason must be non-empty.
func (s *CaseTimelineService) UpdateDelayEvent(ctx context.Context, tenantID, userID, matterID, eventID uuid.UUID, req dto.UpdateDelayEventRequest) (*model.LegalCaseDelayEvent, error) {
	req.Normalize()
	if req.Category == nil && req.Reason == nil {
		return nil, validationError("at least one of category or reason is required", map[string]string{"category": "required"})
	}
	if req.Category != nil && !req.Category.Valid() {
		return nil, validationError("invalid delay category", map[string]string{"category": "invalid"})
	}
	if req.Reason != nil && *req.Reason == "" {
		return nil, validationError("reason must not be empty", map[string]string{"reason": "required"})
	}
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	if err := s.delays.UpdateDelayEvent(ctx, s.db, tenantID, matterID, eventID, req.Category, req.Reason); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("delay event not found")
		}
		return nil, internalError("update delay event", err)
	}
	event, err := s.delays.GetDelayEvent(ctx, tenantID, matterID, eventID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("delay event not found")
		}
		return nil, internalError("reload delay event", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.delay_updated", tenantID, &userID, map[string]any{
		"id":             matterID,
		"matter_id":      matterID,
		"delay_event_id": event.ID,
		"category":       event.Category,
		"reason":         event.Reason,
	}, s.logger)
	return event, nil
}

// ReopenDelayEvent reopens a previously-resolved delay window (#13) by clearing
// resolved_at — the inverse of ResolveDelayEvent. The matter is deliberately NOT
// auto-placed back on external hold (kept simple).
func (s *CaseTimelineService) ReopenDelayEvent(ctx context.Context, tenantID, userID, matterID, eventID uuid.UUID) (*model.LegalCaseDelayEvent, error) {
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	if err := s.delays.ReopenDelayEvent(ctx, s.db, tenantID, matterID, eventID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("resolved delay event not found")
		}
		return nil, internalError("reopen delay event", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.delay_reopened", tenantID, &userID, map[string]any{
		"id":             matterID,
		"matter_id":      matterID,
		"delay_event_id": eventID,
	}, s.logger)
	event, err := s.delays.GetDelayEvent(ctx, tenantID, matterID, eventID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("delay event not found")
		}
		return nil, internalError("reload delay event", err)
	}
	return event, nil
}

// ensureMatter confirms the matter exists in the tenant (404 otherwise).
func (s *CaseTimelineService) ensureMatter(ctx context.Context, tenantID, matterID uuid.UUID) error {
	if matterID == uuid.Nil {
		return validationError("matter_id is required", map[string]string{"matter_id": "required"})
	}
	if _, err := s.matters.Get(ctx, tenantID, matterID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("matter not found")
		}
		return internalError("load matter", err)
	}
	return nil
}

// CreateDeadlineObligation creates a LINKED legal_obligation for a hearing-date /
// objection-deadline so the EXISTING obligation reminder outbox + monitor fire the
// reminder with NO new timer. It is invoked by litigation flows in this vertical
// (and is safe to call standalone). matterID is the owning matter; dueDate is the
// hearing/objection date; kind ("hearing"/"objection") is recorded in metadata.
func (s *CaseTimelineService) CreateDeadlineObligation(ctx context.Context, tenantID, userID, matterID uuid.UUID, kind, title string, ownerUserID uuid.UUID, ownerName string, dueDate time.Time, leadDays []int) (*model.Obligation, error) {
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, err
	}
	title = strings.TrimSpace(title)
	if title == "" {
		title = fmt.Sprintf("الموعد النهائي %s", deadlineKindAR(kind))
	}
	if len(leadDays) == 0 {
		leadDays = []int{7, 1}
	}
	obligation := &model.Obligation{
		ID:               uuid.New(),
		TenantID:         tenantID,
		Title:            title,
		Description:      fmt.Sprintf("موعد نهائي مُتتبَّع تلقائيًا %s ضمن الملف القانوني %s.", deadlineKindAR(kind), matterID),
		Type:             model.ObligationTypeNotice,
		Status:           model.ObligationStatusOpen,
		Priority:         model.LegalPriorityHigh,
		MatterID:         &matterID,
		OwnerUserID:      ownerUserID,
		OwnerName:        strings.TrimSpace(ownerName),
		DueDate:          normalizeDate(dueDate),
		ReminderEnabled:  true,
		ReminderLeadDays: leadDays,
		Tags:             []string{"deadline", kind},
		Metadata: map[string]any{
			"deadline_kind": kind,
			"matter_id":     matterID.String(),
			"source":        "lex_case_timeline",
		},
		CreatedBy: userID,
	}
	if err := s.obligations.Create(ctx, s.db, obligation); err != nil {
		return nil, internalError("create deadline obligation", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.matter.deadline_obligation_created", tenantID, &userID, map[string]any{
		"id":            matterID,
		"matter_id":     matterID,
		"obligation_id": obligation.ID,
		"deadline_kind": kind,
		"due_date":      obligation.DueDate,
	}, s.logger)
	return obligation, nil
}

// ListDeadlineObligations returns the deadline-type legal_obligations linked to a
// matter (the ones CreateDeadlineObligation tags with "deadline"), ordered by due
// date ascending (#10/#11). It reuses the ObligationRepository listing rather than
// raw SQL: deadline obligations are tagged ["deadline", kind] at creation, so we
// filter on matter_id + the "deadline" tag.
func (s *CaseTimelineService) ListDeadlineObligations(ctx context.Context, tenantID, matterID uuid.UUID, page, perPage int) ([]model.Obligation, int, error) {
	if err := s.ensureMatter(ctx, tenantID, matterID); err != nil {
		return nil, 0, err
	}
	matter := matterID
	filters := model.ObligationListFilters{
		MatterID:      &matter,
		Tag:           "deadline",
		Page:          page,
		PerPage:       perPage,
		SortColumn:    "o.due_date",
		SortDirection: "asc",
	}
	items, total, err := s.obligations.List(ctx, tenantID, filters)
	if err != nil {
		return nil, 0, internalError("list deadline obligations", err)
	}
	return items, total, nil
}

// deadlineKindAR maps a deadline "kind" slug (hearing/objection/…) to a Saudi
// legal-Arabic prepositional phrase used inside auto-tracked deadline obligation
// titles/descriptions (e.g. "للجلسة", "للاعتراض"). The kind slug itself is an
// internal code and stays in metadata/tags; only the human phrasing is localized.
func deadlineKindAR(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "hearing":
		return "للجلسة"
	case "objection":
		return "للاعتراض"
	case "appeal":
		return "للاستئناف"
	case "":
		return "للموعد المحدد"
	default:
		return "لـ" + strings.TrimSpace(kind)
	}
}

// computeOpenDelayDays sums the days each delay window has been (or was) open.
func computeOpenDelayDays(events []model.LegalCaseDelayEvent, now time.Time) int {
	total := 0
	for _, event := range events {
		end := now
		if event.ResolvedAt != nil {
			end = event.ResolvedAt.UTC()
		}
		days := int(end.Sub(event.OpenedAt.UTC()).Hours() / 24)
		if days > 0 {
			total += days
		}
	}
	return total
}
