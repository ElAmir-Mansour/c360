package dto

import (
	"encoding/json"
	"time"
)

type DashboardPreferenceRequest struct {
	Preferences json.RawMessage `json:"preferences"`
}

type DashboardPreferenceResponse struct {
	Preferences json.RawMessage `json:"preferences"`
	UpdatedAt   *time.Time      `json:"updated_at,omitempty"`
}
