package service

import (
	"context"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var allowedCalendarProfiles = map[model.CalendarProfile]struct{}{
	model.CalendarProfileStandard: {},
	model.CalendarProfileRamadan:  {},
}

var allowedCalendarHolidayKinds = map[model.CalendarHolidayKind]struct{}{
	model.CalendarHolidayKindWeekly:    {},
	model.CalendarHolidayKindOfficial:  {},
	model.CalendarHolidayKindReligious: {},
}

// WorkingCalendarService owns CRUD for working calendars and is the single place
// that assembles a calendar.WorkingCalendarSnapshot from persisted rows and hands
// it to calendar.NewCalculator. SLA/Execution/Reporting obtain a frozen
// calendar.Calculator through CalculatorFor / DefaultCalculator — they never touch
// the repository directly.
type WorkingCalendarService struct {
	db            *pgxpool.Pool
	repo          *repository.WorkingCalendarRepository
	publisher     Publisher
	metrics       *metrics.Metrics
	domainMetrics *LexDomainMetrics
	topic         string
	logger        zerolog.Logger
	now           func() time.Time
}

func NewWorkingCalendarService(db *pgxpool.Pool, repo *repository.WorkingCalendarRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *WorkingCalendarService {
	return &WorkingCalendarService{
		db:        db,
		repo:      repo,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-working-calendar").Logger(),
		now:       time.Now,
	}
}

// SetDomainMetrics installs the WS7 runtime collectors so calendar CRUD records
// mutations_total{operation}, fallback_calendar_used_total (no tenant default) and
// the snapshot-load latency histogram. A nil value is ignored; the record helpers
// are nil-safe so an unwired calendar service behaves exactly as before (pure
// observability, no behavioural change).
func (s *WorkingCalendarService) SetDomainMetrics(m *LexDomainMetrics) {
	if m != nil {
		s.domainMetrics = m
	}
}

func (s *WorkingCalendarService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateWorkingCalendarRequest) (*model.WorkingCalendar, error) {
	req.Normalize()
	if err := validateCalendarCreate(req); err != nil {
		return nil, err
	}
	cal := &model.WorkingCalendar{
		ID:           uuid.New(),
		TenantID:     tenantID,
		Name:         req.Name,
		Description:  req.Description,
		Timezone:     req.Timezone,
		IsDefault:    req.IsDefault,
		RamadanStart: normalizeDatePtr(req.RamadanStart),
		RamadanEnd:   normalizeDatePtr(req.RamadanEnd),
		Metadata:     req.Metadata,
		CreatedBy:    userID,
	}
	hours := workingHoursFromInputs(tenantID, cal.ID, req.WorkingHours)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start working calendar transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.repo.Create(ctx, tx, cal); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a default working calendar already exists for this tenant")
		}
		return nil, internalError("create working calendar", err)
	}
	if cal.IsDefault {
		if err := s.repo.ClearDefault(ctx, tx, tenantID, cal.ID); err != nil {
			return nil, internalError("clear previous default calendar", err)
		}
	}
	if err := s.repo.ReplaceWorkingHours(ctx, tx, tenantID, cal.ID, hours); err != nil {
		return nil, internalError("set working hours", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit working calendar create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.working_calendar.created", tenantID, &userID, map[string]any{
		"id":         cal.ID,
		"name":       cal.Name,
		"timezone":   cal.Timezone,
		"is_default": cal.IsDefault,
	}, s.logger)
	s.domainMetrics.RecordCalendarMutation("create")
	return s.Get(ctx, tenantID, cal.ID)
}

func (s *WorkingCalendarService) List(ctx context.Context, tenantID uuid.UUID, filters model.WorkingCalendarListFilters) ([]model.WorkingCalendar, int, error) {
	return s.repo.List(ctx, tenantID, filters)
}

func (s *WorkingCalendarService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.WorkingCalendar, error) {
	cal, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("working calendar not found")
		}
		return nil, internalError("load working calendar", err)
	}
	if err := s.hydrate(ctx, tenantID, cal); err != nil {
		return nil, err
	}
	return cal, nil
}

func (s *WorkingCalendarService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateWorkingCalendarRequest) (*model.WorkingCalendar, error) {
	req.Normalize()
	cal, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("working calendar not found")
		}
		return nil, internalError("load working calendar", err)
	}
	applyCalendarUpdate(cal, req)
	if err := validateCalendar(cal); err != nil {
		return nil, err
	}
	var hours []model.WorkingHours
	replaceHours := req.WorkingHours != nil
	if replaceHours {
		if err := validateWorkingHoursInputs(req.WorkingHours); err != nil {
			return nil, err
		}
		hours = workingHoursFromInputs(tenantID, cal.ID, req.WorkingHours)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start working calendar transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.repo.Update(ctx, tx, cal); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a default working calendar already exists for this tenant")
		}
		return nil, internalError("update working calendar", err)
	}
	if cal.IsDefault {
		if err := s.repo.ClearDefault(ctx, tx, tenantID, cal.ID); err != nil {
			return nil, internalError("clear previous default calendar", err)
		}
	}
	if replaceHours {
		if err := s.repo.ReplaceWorkingHours(ctx, tx, tenantID, cal.ID, hours); err != nil {
			return nil, internalError("set working hours", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit working calendar update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.working_calendar.updated", tenantID, &userID, map[string]any{
		"id":         cal.ID,
		"is_default": cal.IsDefault,
	}, s.logger)
	s.domainMetrics.RecordCalendarMutation("update")
	return s.Get(ctx, tenantID, id)
}

func (s *WorkingCalendarService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.repo.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("working calendar not found")
		}
		return internalError("delete working calendar", err)
	}
	s.domainMetrics.RecordCalendarMutation("delete")
	return nil
}

func (s *WorkingCalendarService) AddHoliday(ctx context.Context, tenantID, userID, calendarID uuid.UUID, req dto.AddCalendarHolidayRequest) (*model.WorkingCalendar, error) {
	req.Normalize()
	if err := validateHoliday(req); err != nil {
		return nil, err
	}
	if _, err := s.repo.Get(ctx, tenantID, calendarID); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("working calendar not found")
		}
		return nil, internalError("load working calendar", err)
	}
	holiday := &model.CalendarHoliday{
		ID:         uuid.New(),
		TenantID:   tenantID,
		CalendarID: calendarID,
		Date:       normalizeDate(req.Date),
		Kind:       req.Kind,
		Name:       req.Name,
		CreatedBy:  userID,
	}
	if err := s.repo.AddHoliday(ctx, s.db, holiday); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a holiday already exists for that date and kind")
		}
		return nil, internalError("add calendar holiday", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.working_calendar.holiday_added", tenantID, &userID, map[string]any{
		"id":          calendarID,
		"calendar_id": calendarID,
		"holiday_id":  holiday.ID,
		"kind":        holiday.Kind,
	}, s.logger)
	s.domainMetrics.RecordCalendarMutation("holiday_added")
	return s.Get(ctx, tenantID, calendarID)
}

func (s *WorkingCalendarService) DeleteHoliday(ctx context.Context, tenantID, calendarID, holidayID uuid.UUID) error {
	if err := s.repo.DeleteHoliday(ctx, tenantID, calendarID, holidayID); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("calendar holiday not found")
		}
		return internalError("delete calendar holiday", err)
	}
	s.domainMetrics.RecordCalendarMutation("holiday_deleted")
	return nil
}

// CalculatorFor loads the named calendar and returns its frozen working-time
// Calculator (contract C-1). This is the entry point SLA/Execution use when a
// specific calendar is referenced.
func (s *WorkingCalendarService) CalculatorFor(ctx context.Context, tenantID, id uuid.UUID) (calendar.Calculator, error) {
	cal, err := s.Get(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	return s.buildCalculator(cal)
}

// DefaultCalculator returns the Calculator for the tenant's default calendar.
func (s *WorkingCalendarService) DefaultCalculator(ctx context.Context, tenantID uuid.UUID) (calendar.Calculator, error) {
	cal, err := s.repo.GetDefault(ctx, tenantID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// No tenant default calendar: fall back to the built-in KSA business-hours
			// Calculator so SLA/execution/KPI working-time math always resolves rather
			// than failing the request. Record the miss so the gap is observable and a
			// tenant can configure its own calendar to override.
			s.domainMetrics.RecordCalendarFallbackUsed()
			return calendar.DefaultCalculator(), nil
		}
		return nil, internalError("load default working calendar", err)
	}
	if err := s.hydrate(ctx, tenantID, cal); err != nil {
		return nil, err
	}
	return s.buildCalculator(cal)
}

// hydrate fills WorkingHours and Holidays onto a loaded calendar header.
func (s *WorkingCalendarService) hydrate(ctx context.Context, tenantID uuid.UUID, cal *model.WorkingCalendar) error {
	hours, err := s.repo.ListWorkingHours(ctx, tenantID, cal.ID)
	if err != nil {
		return internalError("load working hours", err)
	}
	holidays, err := s.repo.ListHolidays(ctx, tenantID, cal.ID)
	if err != nil {
		return internalError("load calendar holidays", err)
	}
	cal.WorkingHours = hours
	cal.Holidays = holidays
	return nil
}

// nowFn returns the service clock, defaulting to time.Now when the service was
// built via a bare struct literal (e.g. focused unit tests that call
// buildCalculator directly) rather than the constructor.
func (s *WorkingCalendarService) nowFn() time.Time {
	if s.now == nil {
		return time.Now()
	}
	return s.now()
}

// buildCalculator translates a fully-hydrated calendar into an immutable snapshot
// and returns the frozen Calculator built from it.
func (s *WorkingCalendarService) buildCalculator(cal *model.WorkingCalendar) (calendar.Calculator, error) {
	start := s.nowFn()
	defer func() {
		s.domainMetrics.ObserveCalendarSnapshotLoad(s.nowFn().Sub(start).Seconds())
	}()
	loc, err := time.LoadLocation(cal.Timezone)
	if err != nil {
		return nil, validationError("invalid calendar timezone", map[string]string{"timezone": "invalid"})
	}
	snapshot := calendar.WorkingCalendarSnapshot{
		Location:     loc,
		Standard:     map[time.Weekday][]calendar.WorkingSegment{},
		Ramadan:      map[time.Weekday][]calendar.WorkingSegment{},
		RamadanStart: cal.RamadanStart,
		RamadanEnd:   cal.RamadanEnd,
	}
	for _, h := range cal.WorkingHours {
		seg := calendar.WorkingSegment{Start: h.StartMinute, End: h.EndMinute}
		wd := time.Weekday(h.DayOfWeek)
		switch h.Profile {
		case model.CalendarProfileRamadan:
			snapshot.Ramadan[wd] = append(snapshot.Ramadan[wd], seg)
		default:
			snapshot.Standard[wd] = append(snapshot.Standard[wd], seg)
		}
	}
	for _, h := range cal.Holidays {
		snapshot.Holidays = append(snapshot.Holidays, calendar.Holiday{Date: h.Date})
	}
	return calendar.NewCalculator(snapshot), nil
}

// --- validation & mapping --------------------------------------------------

func validateCalendarCreate(req dto.CreateWorkingCalendarRequest) error {
	if req.Name == "" {
		return validationError("name is required", map[string]string{"name": "required"})
	}
	if _, err := time.LoadLocation(req.Timezone); err != nil {
		return validationError("invalid timezone", map[string]string{"timezone": "invalid"})
	}
	if err := validateRamadanWindow(req.RamadanStart, req.RamadanEnd); err != nil {
		return err
	}
	return validateWorkingHoursInputs(req.WorkingHours)
}

func validateCalendar(cal *model.WorkingCalendar) error {
	if cal.Name == "" {
		return validationError("name is required", map[string]string{"name": "required"})
	}
	if _, err := time.LoadLocation(cal.Timezone); err != nil {
		return validationError("invalid timezone", map[string]string{"timezone": "invalid"})
	}
	return validateRamadanWindow(cal.RamadanStart, cal.RamadanEnd)
}

func validateRamadanWindow(start, end *time.Time) error {
	if (start == nil) != (end == nil) {
		return validationError("ramadan window requires both start and end", map[string]string{"ramadan_start": "required_with_end"})
	}
	if start != nil && end != nil && end.Before(*start) {
		return validationError("ramadan_end must not precede ramadan_start", map[string]string{"ramadan_end": "before_start"})
	}
	return nil
}

func validateWorkingHoursInputs(inputs []dto.WorkingHoursInput) error {
	for _, in := range inputs {
		if _, ok := allowedCalendarProfiles[in.Profile]; !ok {
			return validationError("invalid working-hours profile", map[string]string{"profile": "invalid"})
		}
		if in.DayOfWeek < 0 || in.DayOfWeek > 6 {
			return validationError("day_of_week must be 0..6", map[string]string{"day_of_week": "out_of_range"})
		}
		if in.SegmentIndex < 0 {
			return validationError("segment_index must be >= 0", map[string]string{"segment_index": "out_of_range"})
		}
		if in.StartMinute < 0 || in.EndMinute > 24*60 {
			return validationError("working minutes must be within 0..1440", map[string]string{"start_minute": "out_of_range"})
		}
		if in.EndMinute <= in.StartMinute {
			return validationError("end_minute must be after start_minute", map[string]string{"end_minute": "before_start"})
		}
	}
	return nil
}

func validateHoliday(req dto.AddCalendarHolidayRequest) error {
	if req.Date.IsZero() {
		return validationError("date is required", map[string]string{"date": "required"})
	}
	if _, ok := allowedCalendarHolidayKinds[req.Kind]; !ok {
		return validationError("invalid holiday kind", map[string]string{"kind": "invalid"})
	}
	if req.Name.IsEmpty() {
		return validationError("holiday name is required (ar and/or en)", map[string]string{"name": "required"})
	}
	return nil
}

func applyCalendarUpdate(cal *model.WorkingCalendar, req dto.UpdateWorkingCalendarRequest) {
	if req.Name != nil {
		cal.Name = *req.Name
	}
	if req.Description != nil {
		cal.Description = *req.Description
	}
	if req.Timezone != nil {
		cal.Timezone = *req.Timezone
	}
	if req.IsDefault != nil {
		cal.IsDefault = *req.IsDefault
	}
	if req.RamadanStart != nil {
		cal.RamadanStart = normalizeDatePtr(req.RamadanStart)
	}
	if req.RamadanEnd != nil {
		cal.RamadanEnd = normalizeDatePtr(req.RamadanEnd)
	}
	if req.Metadata != nil {
		cal.Metadata = req.Metadata
	}
}

func workingHoursFromInputs(tenantID, calendarID uuid.UUID, inputs []dto.WorkingHoursInput) []model.WorkingHours {
	hours := make([]model.WorkingHours, 0, len(inputs))
	for _, in := range inputs {
		hours = append(hours, model.WorkingHours{
			ID:           uuid.New(),
			TenantID:     tenantID,
			CalendarID:   calendarID,
			Profile:      in.Profile,
			DayOfWeek:    in.DayOfWeek,
			SegmentIndex: in.SegmentIndex,
			StartMinute:  in.StartMinute,
			EndMinute:    in.EndMinute,
		})
	}
	// Deterministic ordering so a (profile, day, segment) collision surfaces as a
	// stable unique-violation rather than depending on map iteration order.
	sort.SliceStable(hours, func(i, j int) bool {
		if hours[i].Profile != hours[j].Profile {
			return hours[i].Profile < hours[j].Profile
		}
		if hours[i].DayOfWeek != hours[j].DayOfWeek {
			return hours[i].DayOfWeek < hours[j].DayOfWeek
		}
		return hours[i].SegmentIndex < hours[j].SegmentIndex
	})
	return hours
}

func normalizeDatePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	normalized := normalizeDate(*value)
	return &normalized
}
