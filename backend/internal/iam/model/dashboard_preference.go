package model

import (
	"encoding/json"
	"time"
)

// DashboardPreference stores a user's cross-suite dashboard configuration.
// Preferences remains JSON so the UI can add widgets and breakpoint layouts
// without requiring a database migration for every presentation-only field.
type DashboardPreference struct {
	TenantID    string
	UserID      string
	Preferences json.RawMessage
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
