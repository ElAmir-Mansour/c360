package model

import "time"

// NotificationPreference stores per-user per-tenant channel preferences.
type NotificationPreference struct {
	UserID       string                                 `json:"user_id" db:"user_id"`
	TenantID     string                                 `json:"tenant_id" db:"tenant_id"`
	GlobalPrefs  ChannelPreference                      `json:"global_prefs" db:"global_prefs"`
	PerTypePrefs map[NotificationType]ChannelPreference `json:"per_type_prefs" db:"per_type_prefs"`
	QuietHours   *QuietHours                            `json:"quiet_hours,omitempty" db:"quiet_hours"`
	DigestConfig DigestConfig                           `json:"digest_config" db:"digest_config"`
	// OptedOut is the global kill-switch (#17). When true the user has opted out
	// of ALL notifications; ResolveChannels returns AllChannelsOff for every type
	// regardless of the per-channel/per-type settings above. Additive column
	// (migration 000009); defaults false so existing users are unaffected.
	OptedOut  bool      `json:"opted_out" db:"opted_out"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// ChannelPreference controls which channels are enabled.
type ChannelPreference struct {
	InApp     bool `json:"in_app"`
	Email     bool `json:"email"`
	WebSocket bool `json:"websocket"`
	Webhook   bool `json:"webhook"`
}

// QuietHours defines a time range during which non-critical notifications are deferred.
type QuietHours struct {
	Enabled   bool   `json:"enabled"`
	StartTime string `json:"start_time"` // HH:MM in user's timezone
	EndTime   string `json:"end_time"`   // HH:MM
	Timezone  string `json:"timezone"`   // IANA timezone
}

// DigestConfig controls digest delivery frequency.
type DigestConfig struct {
	Daily  bool `json:"daily"`
	Weekly bool `json:"weekly"`
}

// DefaultPreferences returns sensible defaults when no user preferences exist.
var DefaultPreferences = ChannelPreference{
	InApp:     true,
	Email:     true,
	WebSocket: true,
	Webhook:   false,
}

// AllChannelsOff suppresses every channel. Returned by ResolveChannels when a
// user has set the global opt-out (#17).
var AllChannelsOff = ChannelPreference{
	InApp:     false,
	Email:     false,
	WebSocket: false,
	Webhook:   false,
}
