package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/workflow/model"
)

// isUniqueViolation reports whether err is a PostgreSQL unique-constraint
// violation (SQLSTATE 23505), used to translate a UNIQUE(tenant_id, name)
// collision into model.ErrConflict.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// WP-5 — DB-backed store over workflow_sla_policies + workflow_calendars (migration
// 000004_approval_sla). Both tables are RLS-FORCED, so every method takes a
// PromotionDBTX (the same pgx subset PromotionRepository uses) that the caller
// supplies from inside a tenant transaction (database.RunReadWithTenant /
// RunWithTenant), which SET LOCAL app.current_tenant_id. The store never holds a
// pool itself — keeping it a pure DBTX receiver lets the DB-backed SLA resolver
// drive reads inside a read-only tenant tx and lets the CRUD handler drive writes
// inside a read-write tenant tx, while pgxmock drives both in tests.
//
// JSONB shapes match the 000004 column comments:
//   - tiers:         [{after_seconds, notify, action}, ...]
//   - remind_before: [seconds, ...]
//   - working_days:  {"<weekday 0..6>": {start_minute, end_minute}, ...}
//   - holidays:      ["YYYY-MM-DD", ...]

// SLAPolicyRecord is the persisted form of a tiered SLA policy. The tier and
// reminder cadence are stored as JSONB; CalendarID/DefinitionID are nullable so a
// policy can be tenant-wide (no definition pin) and use the tenant's default
// calendar (no explicit calendar pin).
type SLAPolicyRecord struct {
	ID           string        `json:"id"`
	TenantID     string        `json:"tenant_id"`
	Name         string        `json:"name"`
	Description  string        `json:"description"`
	DefinitionID *string       `json:"definition_id,omitempty"`
	Tiers        []SLATierJSON `json:"tiers"`
	RemindBefore []int64       `json:"remind_before"`
	CalendarID   *string       `json:"calendar_id,omitempty"`
	CreatedBy    string        `json:"created_by"`
	CreatedAt    time.Time     `json:"created_at"`
	UpdatedAt    time.Time     `json:"updated_at"`
}

// SLATierJSON is one tier as stored in the tiers JSONB array. AfterSeconds is the
// cumulative business-time offset from task creation; Action ∈ notify | reassign
// | escalate; Notify is the target (e.g. "role:lead").
type SLATierJSON struct {
	AfterSeconds int64  `json:"after_seconds"`
	Notify       string `json:"notify"`
	Action       string `json:"action"`
}

// WorkingDayJSON is one weekday's open window as stored in the working_days JSONB
// object, in minutes since local midnight.
type WorkingDayJSON struct {
	StartMinute int `json:"start_minute"`
	EndMinute   int `json:"end_minute"`
}

// CalendarRecord is the persisted form of a per-tenant business calendar.
type CalendarRecord struct {
	ID          string                    `json:"id"`
	TenantID    string                    `json:"tenant_id"`
	Name        string                    `json:"name"`
	Description string                    `json:"description"`
	Timezone    string                    `json:"timezone"`
	WorkingDays map[string]WorkingDayJSON `json:"working_days"`
	Holidays    []string                  `json:"holidays"`
	IsDefault   bool                      `json:"is_default"`
	CreatedBy   string                    `json:"created_by"`
	CreatedAt   time.Time                 `json:"created_at"`
	UpdatedAt   time.Time                 `json:"updated_at"`
}

// SLARepository persists SLA policies and business calendars. Like
// PromotionRepository it holds no connection; every method takes a PromotionDBTX
// so the caller chooses the (tenant-scoped) execution context.
type SLARepository struct{}

// NewSLARepository constructs an SLARepository.
func NewSLARepository() *SLARepository {
	return &SLARepository{}
}

const slaPolicySelectCols = `id, tenant_id, name, description, definition_id,
	tiers, remind_before, calendar_id, created_by, created_at, updated_at`

const calendarSelectCols = `id, tenant_id, name, description, timezone,
	working_days, holidays, is_default, created_by, created_at, updated_at`

// ---------------------------------------------------------------------------
// SLA policy CRUD
// ---------------------------------------------------------------------------

// CreatePolicy inserts a new SLA policy. The tiers and remind_before slices are
// marshaled to JSONB. The generated id + timestamps are scanned back. A
// UNIQUE(tenant_id, name) collision surfaces as model.ErrConflict.
func (r *SLARepository) CreatePolicy(ctx context.Context, db PromotionDBTX, p *SLAPolicyRecord) error {
	tiersJSON, err := marshalTiers(p.Tiers)
	if err != nil {
		return err
	}
	remindJSON, err := marshalReminders(p.RemindBefore)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO workflow_sla_policies (
			tenant_id, name, description, definition_id, tiers, remind_before, calendar_id, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at`

	err = db.QueryRow(ctx, query,
		p.TenantID,
		p.Name,
		p.Description,
		p.DefinitionID,
		tiersJSON,
		remindJSON,
		p.CalendarID,
		p.CreatedBy,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("sla policy %q: %w", p.Name, model.ErrConflict)
		}
		return fmt.Errorf("creating sla policy: %w", err)
	}
	return nil
}

// GetPolicy loads one live SLA policy by id within a tenant. Returns
// model.ErrNotFound when no matching live row exists.
func (r *SLARepository) GetPolicy(ctx context.Context, db PromotionDBTX, tenantID, id string) (*SLAPolicyRecord, error) {
	query := `
		SELECT ` + slaPolicySelectCols + `
		FROM workflow_sla_policies
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	rec, err := scanSLAPolicy(db.QueryRow(ctx, query, id, tenantID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("sla policy %s: %w", id, model.ErrNotFound)
		}
		return nil, err
	}
	return rec, nil
}

// UpdatePolicy updates a policy's mutable fields (name, description, definition
// pin, tiers, reminders, calendar pin). Returns model.ErrNotFound when no live
// row matches, and model.ErrConflict on a name collision.
func (r *SLARepository) UpdatePolicy(ctx context.Context, db PromotionDBTX, p *SLAPolicyRecord) error {
	tiersJSON, err := marshalTiers(p.Tiers)
	if err != nil {
		return err
	}
	remindJSON, err := marshalReminders(p.RemindBefore)
	if err != nil {
		return err
	}

	query := `
		UPDATE workflow_sla_policies
		SET name = $3,
		    description = $4,
		    definition_id = $5,
		    tiers = $6,
		    remind_before = $7,
		    calendar_id = $8,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ct, err := db.Exec(ctx, query,
		p.ID,
		p.TenantID,
		p.Name,
		p.Description,
		p.DefinitionID,
		tiersJSON,
		remindJSON,
		p.CalendarID,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("sla policy %q: %w", p.Name, model.ErrConflict)
		}
		return fmt.Errorf("updating sla policy %s: %w", p.ID, err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("sla policy %s: %w", p.ID, model.ErrNotFound)
	}
	return nil
}

// DeletePolicy soft-deletes an SLA policy. Returns model.ErrNotFound when no
// live row matches.
func (r *SLARepository) DeletePolicy(ctx context.Context, db PromotionDBTX, tenantID, id string) error {
	query := `
		UPDATE workflow_sla_policies
		SET deleted_at = now(), updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ct, err := db.Exec(ctx, query, id, tenantID)
	if err != nil {
		return fmt.Errorf("deleting sla policy %s: %w", id, err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("sla policy %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// ListPolicies returns every live SLA policy for a tenant, newest first.
// Returns an empty slice (not nil) when none exist.
func (r *SLARepository) ListPolicies(ctx context.Context, db PromotionDBTX, tenantID string) ([]*SLAPolicyRecord, error) {
	query := `
		SELECT ` + slaPolicySelectCols + `
		FROM workflow_sla_policies
		WHERE tenant_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC`

	rows, err := db.Query(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing sla policies: %w", err)
	}
	defer rows.Close()

	out := []*SLAPolicyRecord{}
	for rows.Next() {
		rec, err := scanSLAPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating sla policy rows: %w", err)
	}
	return out, nil
}

// GetPolicyForDefinition resolves the most applicable live policy for a task's
// definition: a policy pinned to definitionID wins; otherwise the most recent
// tenant-wide policy (definition_id IS NULL) is used. Returns model.ErrNotFound
// when neither exists, which the resolver translates to "no tiered policy" so the
// scheduler falls back to single-tier behavior.
func (r *SLARepository) GetPolicyForDefinition(ctx context.Context, db PromotionDBTX, tenantID, definitionID string) (*SLAPolicyRecord, error) {
	// ORDER BY puts definition-pinned rows first (definition_id matches), then
	// tenant-wide rows, newest within each band. LIMIT 1 returns the winner.
	query := `
		SELECT ` + slaPolicySelectCols + `
		FROM workflow_sla_policies
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND (definition_id = $2 OR definition_id IS NULL)
		ORDER BY (definition_id = $2) DESC NULLS LAST, created_at DESC
		LIMIT 1`

	rec, err := scanSLAPolicy(db.QueryRow(ctx, query, tenantID, definitionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("sla policy for definition %s: %w", definitionID, model.ErrNotFound)
		}
		return nil, err
	}
	return rec, nil
}

// ---------------------------------------------------------------------------
// Calendar CRUD
// ---------------------------------------------------------------------------

// CreateCalendar inserts a new business calendar. working_days/holidays are
// marshaled to JSONB. A UNIQUE(tenant_id, name) collision surfaces as
// model.ErrConflict.
func (r *SLARepository) CreateCalendar(ctx context.Context, db PromotionDBTX, c *CalendarRecord) error {
	daysJSON, err := marshalWorkingDays(c.WorkingDays)
	if err != nil {
		return err
	}
	holidaysJSON, err := marshalHolidays(c.Holidays)
	if err != nil {
		return err
	}

	query := `
		INSERT INTO workflow_calendars (
			tenant_id, name, description, timezone, working_days, holidays, is_default, created_by
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at`

	err = db.QueryRow(ctx, query,
		c.TenantID,
		c.Name,
		c.Description,
		defaultTimezone(c.Timezone),
		daysJSON,
		holidaysJSON,
		c.IsDefault,
		c.CreatedBy,
	).Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("calendar %q: %w", c.Name, model.ErrConflict)
		}
		return fmt.Errorf("creating calendar: %w", err)
	}
	return nil
}

// GetCalendar loads one live calendar by id within a tenant.
func (r *SLARepository) GetCalendar(ctx context.Context, db PromotionDBTX, tenantID, id string) (*CalendarRecord, error) {
	query := `
		SELECT ` + calendarSelectCols + `
		FROM workflow_calendars
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	rec, err := scanCalendar(db.QueryRow(ctx, query, id, tenantID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("calendar %s: %w", id, model.ErrNotFound)
		}
		return nil, err
	}
	return rec, nil
}

// GetDefaultCalendar returns the tenant's default calendar (is_default = true),
// or model.ErrNotFound when none is configured.
func (r *SLARepository) GetDefaultCalendar(ctx context.Context, db PromotionDBTX, tenantID string) (*CalendarRecord, error) {
	query := `
		SELECT ` + calendarSelectCols + `
		FROM workflow_calendars
		WHERE tenant_id = $1 AND is_default = true AND deleted_at IS NULL
		LIMIT 1`

	rec, err := scanCalendar(db.QueryRow(ctx, query, tenantID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("default calendar: %w", model.ErrNotFound)
		}
		return nil, err
	}
	return rec, nil
}

// UpdateCalendar updates a calendar's mutable fields. Returns model.ErrNotFound
// when no live row matches, model.ErrConflict on a name collision.
func (r *SLARepository) UpdateCalendar(ctx context.Context, db PromotionDBTX, c *CalendarRecord) error {
	daysJSON, err := marshalWorkingDays(c.WorkingDays)
	if err != nil {
		return err
	}
	holidaysJSON, err := marshalHolidays(c.Holidays)
	if err != nil {
		return err
	}

	query := `
		UPDATE workflow_calendars
		SET name = $3,
		    description = $4,
		    timezone = $5,
		    working_days = $6,
		    holidays = $7,
		    is_default = $8,
		    updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ct, err := db.Exec(ctx, query,
		c.ID,
		c.TenantID,
		c.Name,
		c.Description,
		defaultTimezone(c.Timezone),
		daysJSON,
		holidaysJSON,
		c.IsDefault,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("calendar %q: %w", c.Name, model.ErrConflict)
		}
		return fmt.Errorf("updating calendar %s: %w", c.ID, err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("calendar %s: %w", c.ID, model.ErrNotFound)
	}
	return nil
}

// DeleteCalendar soft-deletes a calendar. Returns model.ErrNotFound when no live
// row matches.
func (r *SLARepository) DeleteCalendar(ctx context.Context, db PromotionDBTX, tenantID, id string) error {
	query := `
		UPDATE workflow_calendars
		SET deleted_at = now(), updated_at = now()
		WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`

	ct, err := db.Exec(ctx, query, id, tenantID)
	if err != nil {
		return fmt.Errorf("deleting calendar %s: %w", id, err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("calendar %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// ListCalendars returns every live calendar for a tenant, newest first.
func (r *SLARepository) ListCalendars(ctx context.Context, db PromotionDBTX, tenantID string) ([]*CalendarRecord, error) {
	query := `
		SELECT ` + calendarSelectCols + `
		FROM workflow_calendars
		WHERE tenant_id = $1 AND deleted_at IS NULL
		ORDER BY created_at DESC`

	rows, err := db.Query(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing calendars: %w", err)
	}
	defer rows.Close()

	out := []*CalendarRecord{}
	for rows.Next() {
		rec, err := scanCalendar(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating calendar rows: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

// scanSLAPolicy maps slaPolicySelectCols onto an SLAPolicyRecord, unmarshaling
// the tiers/remind_before JSONB columns. The error is returned raw (including
// pgx.ErrNoRows) so single-row callers can translate it.
func scanSLAPolicy(s rowScanner) (*SLAPolicyRecord, error) {
	var (
		rec        SLAPolicyRecord
		tiersJSON  []byte
		remindJSON []byte
	)
	if err := s.Scan(
		&rec.ID,
		&rec.TenantID,
		&rec.Name,
		&rec.Description,
		&rec.DefinitionID,
		&tiersJSON,
		&remindJSON,
		&rec.CalendarID,
		&rec.CreatedBy,
		&rec.CreatedAt,
		&rec.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if err := unmarshalJSON(tiersJSON, &rec.Tiers); err != nil {
		return nil, fmt.Errorf("unmarshaling tiers for policy %s: %w", rec.ID, err)
	}
	if err := unmarshalJSON(remindJSON, &rec.RemindBefore); err != nil {
		return nil, fmt.Errorf("unmarshaling remind_before for policy %s: %w", rec.ID, err)
	}
	if rec.Tiers == nil {
		rec.Tiers = []SLATierJSON{}
	}
	if rec.RemindBefore == nil {
		rec.RemindBefore = []int64{}
	}
	return &rec, nil
}

// scanCalendar maps calendarSelectCols onto a CalendarRecord, unmarshaling the
// working_days/holidays JSONB columns.
func scanCalendar(s rowScanner) (*CalendarRecord, error) {
	var (
		rec          CalendarRecord
		daysJSON     []byte
		holidaysJSON []byte
	)
	if err := s.Scan(
		&rec.ID,
		&rec.TenantID,
		&rec.Name,
		&rec.Description,
		&rec.Timezone,
		&daysJSON,
		&holidaysJSON,
		&rec.IsDefault,
		&rec.CreatedBy,
		&rec.CreatedAt,
		&rec.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if err := unmarshalJSON(daysJSON, &rec.WorkingDays); err != nil {
		return nil, fmt.Errorf("unmarshaling working_days for calendar %s: %w", rec.ID, err)
	}
	if err := unmarshalJSON(holidaysJSON, &rec.Holidays); err != nil {
		return nil, fmt.Errorf("unmarshaling holidays for calendar %s: %w", rec.ID, err)
	}
	if rec.WorkingDays == nil {
		rec.WorkingDays = map[string]WorkingDayJSON{}
	}
	if rec.Holidays == nil {
		rec.Holidays = []string{}
	}
	return &rec, nil
}

// ---------------------------------------------------------------------------
// JSON marshal helpers — normalize nil -> empty literal so a NOT NULL JSONB
// column is never sent a SQL NULL.
// ---------------------------------------------------------------------------

func marshalTiers(tiers []SLATierJSON) ([]byte, error) {
	if tiers == nil {
		tiers = []SLATierJSON{}
	}
	b, err := json.Marshal(tiers)
	if err != nil {
		return nil, fmt.Errorf("marshaling tiers: %w", err)
	}
	return b, nil
}

func marshalReminders(reminders []int64) ([]byte, error) {
	if reminders == nil {
		reminders = []int64{}
	}
	b, err := json.Marshal(reminders)
	if err != nil {
		return nil, fmt.Errorf("marshaling remind_before: %w", err)
	}
	return b, nil
}

func marshalWorkingDays(days map[string]WorkingDayJSON) ([]byte, error) {
	if days == nil {
		days = map[string]WorkingDayJSON{}
	}
	b, err := json.Marshal(days)
	if err != nil {
		return nil, fmt.Errorf("marshaling working_days: %w", err)
	}
	return b, nil
}

func marshalHolidays(holidays []string) ([]byte, error) {
	if holidays == nil {
		holidays = []string{}
	}
	b, err := json.Marshal(holidays)
	if err != nil {
		return nil, fmt.Errorf("marshaling holidays: %w", err)
	}
	return b, nil
}

// unmarshalJSON tolerates empty/NULL JSONB bytes by treating them as a no-op so
// the caller's zero value (later normalized to an empty literal) survives.
func unmarshalJSON(data []byte, dst any) error {
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, dst)
}

// defaultTimezone normalizes an empty timezone to UTC, matching the column
// default so a calendar always interprets windows in a concrete zone.
func defaultTimezone(tz string) string {
	if strings.TrimSpace(tz) == "" {
		return "UTC"
	}
	return tz
}
