package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// LegalCourt is tenant-maintained bilingual court reference data. The table is
// intentionally unseeded until the customer supplies the approved court names.
type LegalCourt struct {
	ID        uuid.UUID           `json:"id"`
	TenantID  uuid.UUID           `json:"tenant_id"`
	Code      string              `json:"code"`
	Name      forms.LocalizedText `json:"name"`
	Active    bool                `json:"active"`
	IsSystem  bool                `json:"is_system"`
	Sort      int                 `json:"sort"`
	Metadata  map[string]any      `json:"metadata"`
	CreatedBy uuid.UUID           `json:"created_by"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
	DeletedAt *time.Time          `json:"deleted_at,omitempty"`
}

type LegalCourtListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Active        *bool
	SortColumn    string
	SortDirection string
}
