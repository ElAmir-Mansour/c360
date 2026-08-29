package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/pricing/model"
)

// quoteColumns is the full column list in a stable order used by every scan.
const quoteColumns = `id, quote_number, model, pricing_config_id, pricing_version,
	tenant_id, lead_id, account_name, inputs, computed_tiers, selected_tier,
	status, below_floor, floor_override_by, floor_override_at, valid_until,
	created_by, created_at, updated_at`

// scanQuote reads one quotes row, unmarshalling the JSONB columns into the typed
// domain structs. Nullable columns are read through *string / *time.Time.
func scanQuote(row pgx.Row) (*model.StoredQuote, error) {
	var (
		q            model.StoredQuote
		inputsJSON   []byte
		tiersJSON    []byte
		selectedTier *string
	)
	if err := row.Scan(
		&q.ID, &q.QuoteNumber, &q.Model, &q.PricingConfigID, &q.PricingVersion,
		&q.TenantID, &q.LeadID, &q.AccountName, &inputsJSON, &tiersJSON, &selectedTier,
		&q.Status, &q.BelowFloor, &q.FloorOverrideBy, &q.FloorOverrideAt, &q.ValidUntil,
		&q.CreatedBy, &q.CreatedAt, &q.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(inputsJSON, &q.Inputs); err != nil {
		return nil, fmt.Errorf("decoding quote inputs (%s): %w", q.QuoteNumber, err)
	}
	if err := json.Unmarshal(tiersJSON, &q.ComputedTiers); err != nil {
		return nil, fmt.Errorf("decoding quote computed_tiers (%s): %w", q.QuoteNumber, err)
	}
	if selectedTier != nil {
		t := model.Tier(*selectedTier)
		q.SelectedTier = &t
	}
	return &q, nil
}

// NextQuoteNumberSeq returns the next value of the quote-number sequence. Called
// inside the insert transaction so the number is atomic with the row.
const nextQuoteSeqSQL = `SELECT nextval('quote_number_seq')`

func (r *Repository) NextQuoteNumberSeq(ctx context.Context, db DBTX) (int64, error) {
	var n int64
	if err := db.QueryRow(ctx, nextQuoteSeqSQL).Scan(&n); err != nil {
		return 0, fmt.Errorf("reading next quote number sequence: %w", err)
	}
	return n, nil
}

const insertQuoteSQL = `
INSERT INTO quotes (
	quote_number, model, pricing_config_id, pricing_version,
	tenant_id, lead_id, account_name, inputs, computed_tiers, selected_tier,
	status, below_floor, valid_until, created_by
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING ` + quoteColumns

// InsertQuote persists a new quote. computed_tiers is stored WITH the internal
// block (this row is internal-only). Returns the round-tripped row.
func (r *Repository) InsertQuote(ctx context.Context, db DBTX, q *model.StoredQuote) (*model.StoredQuote, error) {
	inputsJSON, err := json.Marshal(q.Inputs)
	if err != nil {
		return nil, fmt.Errorf("encoding quote inputs: %w", err)
	}
	tiersJSON, err := json.Marshal(q.ComputedTiers)
	if err != nil {
		return nil, fmt.Errorf("encoding quote computed_tiers: %w", err)
	}
	var selectedTier *string
	if q.SelectedTier != nil {
		s := string(*q.SelectedTier)
		selectedTier = &s
	}
	out, err := scanQuote(db.QueryRow(ctx, insertQuoteSQL,
		q.QuoteNumber, q.Model, q.PricingConfigID, q.PricingVersion,
		q.TenantID, q.LeadID, q.AccountName, inputsJSON, tiersJSON, selectedTier,
		q.Status, q.BelowFloor, q.ValidUntil, q.CreatedBy,
	))
	if err != nil {
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("quote number %s: %w", q.QuoteNumber, model.ErrAlreadyExists)
		}
		return nil, fmt.Errorf("inserting quote: %w", err)
	}
	return out, nil
}

const getQuoteByIDSQL = `SELECT ` + quoteColumns + ` FROM quotes WHERE id = $1`

// GetQuoteByID loads one quote, or model.ErrNotFound.
func (r *Repository) GetQuoteByID(ctx context.Context, db DBTX, id string) (*model.StoredQuote, error) {
	q, err := scanQuote(db.QueryRow(ctx, getQuoteByIDSQL, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("quote %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading quote %s: %w", id, err)
	}
	return q, nil
}

// QuoteFilter narrows a list query. Empty fields are ignored.
type QuoteFilter struct {
	Status   string
	TenantID string
	Model    string
	Limit    int
	Offset   int
}

// ListQuotes returns quotes matching the filter (newest first) plus the total
// count for the same filter (for pagination). The two queries share the WHERE.
func (r *Repository) ListQuotes(ctx context.Context, db DBTX, f QuoteFilter) ([]*model.StoredQuote, int, error) {
	var (
		where []string
		args  []any
	)
	add := func(clause string, val any) {
		args = append(args, val)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if f.Status != "" {
		add("status = $%d", f.Status)
	}
	if f.TenantID != "" {
		add("tenant_id = $%d", f.TenantID)
	}
	if f.Model != "" {
		add("model = $%d", f.Model)
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}

	var total int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM quotes"+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("counting quotes: %w", err)
	}

	limit := f.Limit
	if limit <= 0 {
		limit = 25
	}
	listArgs := append(append([]any{}, args...), limit, f.Offset)
	listSQL := "SELECT " + quoteColumns + " FROM quotes" + whereSQL +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)

	rows, err := db.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("listing quotes: %w", err)
	}
	defer rows.Close()

	var out []*model.StoredQuote
	for rows.Next() {
		q, err := scanQuote(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scanning quote: %w", err)
		}
		out = append(out, q)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("reading quotes: %w", err)
	}
	return out, total, nil
}

const updateQuoteStatusSQL = `
UPDATE quotes SET status = $2, updated_at = now()
WHERE id = $1
RETURNING ` + quoteColumns

// UpdateQuoteStatus transitions a quote to a new status.
func (r *Repository) UpdateQuoteStatus(ctx context.Context, db DBTX, id, status string) (*model.StoredQuote, error) {
	out, err := scanQuote(db.QueryRow(ctx, updateQuoteStatusSQL, id, status))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("quote %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("updating quote %s status: %w", id, err)
	}
	return out, nil
}

const recordFloorOverrideSQL = `
UPDATE quotes SET floor_override_by = $2, floor_override_at = now(), updated_at = now()
WHERE id = $1
RETURNING ` + quoteColumns

// RecordFloorOverride stamps floor_override_by/at on a quote.
func (r *Repository) RecordFloorOverride(ctx context.Context, db DBTX, id, overrideBy string) (*model.StoredQuote, error) {
	out, err := scanQuote(db.QueryRow(ctx, recordFloorOverrideSQL, id, overrideBy))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("quote %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("recording floor override on quote %s: %w", id, err)
	}
	return out, nil
}
