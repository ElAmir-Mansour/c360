package dto

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

// AdminQueryParams holds validated query parameters for a cross-tenant
// (platform-wide) audit log search. It is parsed only on the audit:read:all
// gated admin route. When AllTenants is true the tenant_id predicate is dropped;
// otherwise the optional TenantIDs slice restricts the result set. When neither
// is supplied the caller's own tenant should be applied by the handler (the same
// tenant-scoped default the non-admin path uses).
type AdminQueryParams struct {
	AllTenants   bool
	TenantIDs    []string
	UserID       string
	Service      string
	Action       string
	ResourceType string
	ResourceID   string
	Severity     string
	Search       string
	DateFrom     time.Time
	DateTo       time.Time
	Sort         string
	Order        string
	Page         int
	PerPage      int
}

// ParseAdminQueryParams extracts and validates the cross-tenant query
// parameters. It reuses the same bounds as the tenant-scoped path (93-day max
// range, per_page cap of 200, allowed sort fields) so the admin path cannot be
// used to bypass those limits.
func ParseAdminQueryParams(r *http.Request) (*AdminQueryParams, error) {
	q := r.URL.Query()

	ap := &AdminQueryParams{
		AllTenants:   strings.EqualFold(q.Get("all_tenants"), "true"),
		TenantIDs:    q["tenant_id"], // repeatable
		UserID:       q.Get("actor"), // actor is the cross-tenant alias for user_id
		Service:      q.Get("service"),
		Action:       q.Get("action"),
		ResourceType: q.Get("resource_type"),
		ResourceID:   q.Get("resource_id"),
		Severity:     q.Get("severity"),
		Search:       q.Get("search"),
		Sort:         q.Get("sort"),
		Order:        q.Get("order"),
	}
	// Accept user_id as an alias if actor is not provided.
	if ap.UserID == "" {
		ap.UserID = q.Get("user_id")
	}

	dateFromStr := q.Get("date_from")
	if dateFromStr == "" {
		return nil, fmt.Errorf("date_from is required for audit log queries")
	}
	dateFrom, err := time.Parse(time.RFC3339, dateFromStr)
	if err != nil {
		return nil, fmt.Errorf("invalid date_from format, expected RFC3339: %w", err)
	}
	ap.DateFrom = dateFrom

	if dateToStr := q.Get("date_to"); dateToStr != "" {
		dateTo, err := time.Parse(time.RFC3339, dateToStr)
		if err != nil {
			return nil, fmt.Errorf("invalid date_to format, expected RFC3339: %w", err)
		}
		ap.DateTo = dateTo
	} else {
		ap.DateTo = time.Now().UTC()
	}

	if pageStr := q.Get("page"); pageStr != "" {
		if page, err := strconv.Atoi(pageStr); err == nil && page >= 1 {
			ap.Page = page
		} else {
			ap.Page = 1
		}
	} else {
		ap.Page = 1
	}

	if ppStr := q.Get("per_page"); ppStr != "" {
		if pp, err := strconv.Atoi(ppStr); err == nil && pp >= 1 {
			ap.PerPage = pp
		} else {
			ap.PerPage = defaultPerPage
		}
	} else {
		ap.PerPage = defaultPerPage
	}

	return ap, ap.Validate()
}

// Validate enforces the same bounds as the tenant-scoped query path.
func (ap *AdminQueryParams) Validate() error {
	if ap.DateTo.Sub(ap.DateFrom) > maxDateRange {
		return fmt.Errorf("date range must not exceed 93 days")
	}
	if ap.DateTo.Before(ap.DateFrom) {
		return fmt.Errorf("date_to must be after date_from")
	}

	if ap.Sort == "" {
		ap.Sort = "created_at"
	}
	if !AllowedSortFields[ap.Sort] {
		return fmt.Errorf("invalid sort field %q; allowed: created_at, action, severity, service", ap.Sort)
	}

	if ap.Order == "" {
		ap.Order = "desc"
	}
	ap.Order = strings.ToLower(ap.Order)
	if ap.Order != "asc" && ap.Order != "desc" {
		return fmt.Errorf("invalid order %q; allowed: asc, desc", ap.Order)
	}

	if ap.PerPage > maxPerPage {
		ap.PerPage = maxPerPage
	}
	if ap.PerPage < 1 {
		ap.PerPage = defaultPerPage
	}

	if ap.Action != "" && strings.Contains(ap.Action, "*") {
		if !strings.HasSuffix(ap.Action, "*") || strings.Count(ap.Action, "*") > 1 {
			return fmt.Errorf("action wildcard only supports trailing *")
		}
	}

	if ap.Severity != "" {
		validSeverities := map[string]bool{"info": true, "warning": true, "high": true, "critical": true}
		if !validSeverities[ap.Severity] {
			return fmt.Errorf("invalid severity %q; allowed: info, warning, high, critical", ap.Severity)
		}
	}

	for _, tenantID := range ap.TenantIDs {
		if tenantID == "" {
			continue
		}
		if _, err := uuid.Parse(tenantID); err != nil {
			return fmt.Errorf("invalid tenant_id %q; expected UUID", tenantID)
		}
	}
	if ap.UserID != "" {
		if _, err := uuid.Parse(ap.UserID); err != nil {
			return fmt.Errorf("invalid user_id %q; expected UUID", ap.UserID)
		}
	}

	if ap.Search != "" {
		ap.Search = sanitizeSearch(ap.Search)
	}

	return nil
}

// Offset computes the SQL OFFSET from page and per_page.
func (ap *AdminQueryParams) Offset() int {
	return (ap.Page - 1) * ap.PerPage
}

// AdminAuditRow is a cross-tenant audit row enriched with the tenant display
// name. Field names match the platform console's expectations: it is the core
// audit entry plus a tenant_name resolved best-effort by the repository.
type AdminAuditRow struct {
	ID            string    `json:"id"`
	TenantID      string    `json:"tenant_id"`
	TenantName    string    `json:"tenant_name"`
	UserID        *string   `json:"user_id,omitempty"`
	UserEmail     string    `json:"user_email"`
	Service       string    `json:"service"`
	Action        string    `json:"action"`
	Severity      string    `json:"severity"`
	ResourceType  string    `json:"resource_type"`
	ResourceID    string    `json:"resource_id"`
	IPAddress     string    `json:"ip_address"`
	UserAgent     string    `json:"user_agent"`
	EventID       string    `json:"event_id"`
	CorrelationID string    `json:"correlation_id"`
	PreviousHash  string    `json:"previous_hash"`
	EntryHash     string    `json:"entry_hash"`
	CreatedAt     time.Time `json:"created_at"`
}

// AdminVerifyRequest is the body for the cross-tenant integrity verify endpoint.
type AdminVerifyRequest struct {
	DateFrom  string   `json:"date_from"`
	DateTo    string   `json:"date_to"`
	TenantIDs []string `json:"tenant_ids,omitempty"`
}

// AdminVerifyResult is a per-tenant verification result for the cross-tenant
// integrity response. It embeds the same fields the single-tenant result
// exposes plus the tenant_id the result belongs to.
type AdminVerifyResult struct {
	TenantID         string  `json:"tenant_id"`
	Verified         bool    `json:"verified"`
	TotalRecords     int64   `json:"total_records"`
	VerifiedRecords  int64   `json:"verified_records"`
	BrokenChainAt    *string `json:"broken_chain_at"`
	FirstRecord      string  `json:"first_record"`
	LastRecord       string  `json:"last_record"`
	VerificationHash string  `json:"verification_hash"`
	VerifiedAt       string  `json:"verified_at"`
	Error            string  `json:"error,omitempty"`
}

// AdminVerifyResponse wraps the per-tenant verification results.
type AdminVerifyResponse struct {
	Results   []AdminVerifyResult `json:"results"`
	CheckedAt string              `json:"checked_at"`
}

// IntegrityStatusResponse is the last-known result of the periodic integrity
// runner, exposed via GET /integrity/status.
type IntegrityStatusResponse struct {
	LastRunAt    string              `json:"last_run_at"`
	WindowFrom   string              `json:"window_from"`
	WindowTo     string              `json:"window_to"`
	TenantsTotal int                 `json:"tenants_total"`
	BrokenCount  int                 `json:"broken_count"`
	Results      []AdminVerifyResult `json:"results"`
}
