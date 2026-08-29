package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// WorkingCalendarRepository owns persistence for the working-calendar aggregate:
// the calendar header (legal_working_calendars), its weekly working-hours rows
// (legal_working_hours), and its holidays (legal_calendar_holidays). All reads are
// tenant-scoped via a leading tenant_id = $1 predicate (RLS additionally enforces
// isolation at the database).
type WorkingCalendarRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewWorkingCalendarRepository(db *pgxpool.Pool, logger zerolog.Logger) *WorkingCalendarRepository {
	return &WorkingCalendarRepository{db: db, logger: logger}
}

// --- calendar header -------------------------------------------------------

func (r *WorkingCalendarRepository) Create(ctx context.Context, q Queryer, cal *model.WorkingCalendar) error {
	query := `
		INSERT INTO legal_working_calendars (
			id, tenant_id, name, description, timezone, is_default,
			ramadan_start, ramadan_end, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		cal.ID, cal.TenantID, cal.Name, cal.Description, cal.Timezone, cal.IsDefault,
		lexDatePtr(cal.RamadanStart), lexDatePtr(cal.RamadanEnd), cal.Metadata, cal.CreatedBy,
	).Scan(&cal.CreatedAt, &cal.UpdatedAt)
}

func (r *WorkingCalendarRepository) Update(ctx context.Context, q Queryer, cal *model.WorkingCalendar) error {
	query := `
		UPDATE legal_working_calendars
		SET name = $3,
		    description = $4,
		    timezone = $5,
		    is_default = $6,
		    ramadan_start = $7,
		    ramadan_end = $8,
		    metadata = $9,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		cal.TenantID, cal.ID, cal.Name, cal.Description, cal.Timezone, cal.IsDefault,
		lexDatePtr(cal.RamadanStart), lexDatePtr(cal.RamadanEnd), cal.Metadata,
	).Scan(&cal.UpdatedAt)
}

// ClearDefault drops the is_default flag on every other calendar for the tenant so
// the partial-unique index (one default per tenant) is never violated. Run inside
// the same tx as the create/update that sets a new default.
func (r *WorkingCalendarRepository) ClearDefault(ctx context.Context, q Queryer, tenantID, exceptID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE legal_working_calendars
		SET is_default = false, updated_at = now()
		WHERE tenant_id = $1 AND id <> $2 AND is_default = true AND deleted_at IS NULL`,
		tenantID, exceptID,
	)
	return err
}

func (r *WorkingCalendarRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.WorkingCalendar, error) {
	query := workingCalendarJSONSelect(`c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`)
	return queryRowJSON[model.WorkingCalendar](ctx, r.db, query, tenantID, id)
}

// GetDefault returns the tenant's default calendar, or pgx.ErrNoRows when none is
// configured. Consumers (SLA/Execution) call this to resolve the calculator.
func (r *WorkingCalendarRepository) GetDefault(ctx context.Context, tenantID uuid.UUID) (*model.WorkingCalendar, error) {
	query := workingCalendarJSONSelect(`c.tenant_id = $1 AND c.is_default = true AND c.deleted_at IS NULL`)
	return queryRowJSON[model.WorkingCalendar](ctx, r.db, query, tenantID)
}

func (r *WorkingCalendarRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.WorkingCalendarListFilters) ([]model.WorkingCalendar, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"c.tenant_id = $1", "c.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(c.name ILIKE '%%' || $%d || '%%' OR c.description ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.IsDefault != nil {
		conditions = append(conditions, fmt.Sprintf("c.is_default = $%d", arg))
		args = append(args, *filters.IsDefault)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_working_calendars c WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.WorkingCalendar{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := workingCalendarSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := workingCalendarJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.WorkingCalendar](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *WorkingCalendarRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_working_calendars SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- working hours ---------------------------------------------------------

func (r *WorkingCalendarRepository) ReplaceWorkingHours(ctx context.Context, q Queryer, tenantID, calendarID uuid.UUID, hours []model.WorkingHours) error {
	if _, err := q.Exec(ctx, `DELETE FROM legal_working_hours WHERE tenant_id = $1 AND calendar_id = $2`, tenantID, calendarID); err != nil {
		return err
	}
	for i := range hours {
		h := &hours[i]
		query := `
			INSERT INTO legal_working_hours (
				id, tenant_id, calendar_id, profile, day_of_week, segment_index, start_minute, end_minute
			) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			RETURNING created_at, updated_at`
		if err := q.QueryRow(ctx, query,
			h.ID, tenantID, calendarID, h.Profile, h.DayOfWeek, h.SegmentIndex, h.StartMinute, h.EndMinute,
		).Scan(&h.CreatedAt, &h.UpdatedAt); err != nil {
			return err
		}
	}
	return nil
}

func (r *WorkingCalendarRepository) ListWorkingHours(ctx context.Context, tenantID, calendarID uuid.UUID) ([]model.WorkingHours, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT h.id, h.tenant_id, h.calendar_id, h.profile, h.day_of_week,
			       h.segment_index, h.start_minute, h.end_minute, h.created_at, h.updated_at
			FROM legal_working_hours h
			WHERE h.tenant_id = $1 AND h.calendar_id = $2
			ORDER BY h.profile, h.day_of_week, h.segment_index
		) t`
	return queryListJSON[model.WorkingHours](ctx, r.db, query, tenantID, calendarID)
}

// --- holidays --------------------------------------------------------------

func (r *WorkingCalendarRepository) AddHoliday(ctx context.Context, q Queryer, holiday *model.CalendarHoliday) error {
	nameJSON, err := json.Marshal(holiday.Name)
	if err != nil {
		return fmt.Errorf("marshal holiday name: %w", err)
	}
	query := `
		INSERT INTO legal_calendar_holidays (
			id, tenant_id, calendar_id, holiday_date, kind, name, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		holiday.ID, holiday.TenantID, holiday.CalendarID, lexDatePtr(&holiday.Date), holiday.Kind, nameJSON, holiday.CreatedBy,
	).Scan(&holiday.CreatedAt, &holiday.UpdatedAt)
}

func (r *WorkingCalendarRepository) DeleteHoliday(ctx context.Context, tenantID, calendarID, holidayID uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `DELETE FROM legal_calendar_holidays WHERE tenant_id = $1 AND calendar_id = $2 AND id = $3`, tenantID, calendarID, holidayID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *WorkingCalendarRepository) ListHolidays(ctx context.Context, tenantID, calendarID uuid.UUID) ([]model.CalendarHoliday, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT h.id, h.tenant_id, h.calendar_id, h.holiday_date::timestamptz AS date,
			       h.kind, COALESCE(h.name, '{}'::jsonb) AS name,
			       h.created_by, h.created_at, h.updated_at
			FROM legal_calendar_holidays h
			WHERE h.tenant_id = $1 AND h.calendar_id = $2
			ORDER BY h.holiday_date
		) t`
	return queryListJSON[model.CalendarHoliday](ctx, r.db, query, tenantID, calendarID)
}

// --- query builders --------------------------------------------------------

func workingCalendarJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT c.id, c.tenant_id, c.name, c.description, c.timezone, c.is_default,
			       c.ramadan_start::timestamptz AS ramadan_start,
			       c.ramadan_end::timestamptz AS ramadan_end,
			       COALESCE(c.metadata, '{}'::jsonb) AS metadata,
			       c.created_by, c.created_at, c.updated_at, c.deleted_at
			FROM legal_working_calendars c
			WHERE ` + where + `
		) t`
}

func workingCalendarSortColumn(column string) (string, bool) {
	switch column {
	case "c.name":
		return "t.name", true
	case "c.is_default":
		return "t.is_default", true
	case "c.updated_at":
		return "t.updated_at", true
	case "c.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
