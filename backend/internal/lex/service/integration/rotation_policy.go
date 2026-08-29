package integration

import (
	"strconv"
	"strings"
	"time"

	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// Rotation policy (#14 — secret rotation reminder / auto-rotate + expiry alert).
//
// A per-endpoint NON-secret config field, rotate_every_days, declares how often the
// endpoint's secrets should be rotated (0 / unset = no policy). The registry already
// stamps metadata last_rotated.<field>=RFC3339(now) on every RotateSecret (feature
// 5). This file turns those two facts into a rotation POLICY:
//
//   - RotationPolicy.DueFor reports which secret fields are past their rotation
//     deadline (now - last_rotated >= rotate_every_days), and which are approaching
//     it (within the reminder window) so the monitor can warn ahead of expiry.
//   - ExpiryReporter (the registry's masked-config seam, feature 10) surfaces the
//     approaching/overdue secret fields as ExpiryWarnings on the masked endpoint, so
//     the console badges the endpoint without a separate call. The reporter reads
//     non-sensitive config/metadata ONLY and never echoes a secret value.
//
// A secret field with NO recorded last_rotated falls back to created_at (the
// endpoint's age) so a never-rotated long-lived secret still trips the policy.
// =============================================================================

// RotateEveryDaysKey is the per-endpoint NON-secret config field (a plain number)
// that holds the rotation cadence in days. 0 / unset / non-positive disables the
// rotation policy for the endpoint (secrets are then only rotated on demand).
const RotateEveryDaysKey = "rotate_every_days"

// DefaultRotationReminderDays is how many days BEFORE the rotation deadline the
// policy starts warning (the reminder window), so an operator (or the auto-rotate
// path) acts ahead of expiry rather than after it.
const DefaultRotationReminderDays = 7

// LastRotatedField reads metadata.last_rotated.<field> (the RFC3339 stamp the
// registry writes on RotateSecret) for a field, tolerating absence. The bool reports
// whether a stamp was found and parsed.
func LastRotatedField(endpoint model.IntegrationEndpoint, field string) (time.Time, bool) {
	if endpoint.Metadata == nil {
		return time.Time{}, false
	}
	rotated, ok := endpoint.Metadata["last_rotated"].(map[string]any)
	if !ok || rotated == nil {
		return time.Time{}, false
	}
	raw, ok := rotated[field].(string)
	if !ok || strings.TrimSpace(raw) == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return time.Time{}, false
	}
	return t.UTC(), true
}

// RotateEveryDays extracts the rotation cadence (days) from an endpoint config map,
// tolerating int / float / string encodings (the config round-trips through JSON and
// the masked-config echo). Returns (0, false) when absent, blank, unparseable, or
// non-positive — the caller treats that as "no rotation policy".
func RotateEveryDays(config map[string]any) (int, bool) {
	if config == nil {
		return 0, false
	}
	raw, present := config[RotateEveryDaysKey]
	if !present || raw == nil {
		return 0, false
	}
	days := 0.0
	switch v := raw.(type) {
	case int:
		days = float64(v)
	case int64:
		days = float64(v)
	case float64:
		days = v
	case float32:
		days = float64(v)
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return 0, false
		}
		parsed, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0, false
		}
		days = parsed
	default:
		return 0, false
	}
	if days <= 0 {
		return 0, false
	}
	return int(days), true
}

// RotationStatus classifies one secret field against the rotation policy.
type RotationStatus string

const (
	// RotationStatusOK is a secret comfortably within its rotation window.
	RotationStatusOK RotationStatus = "ok"
	// RotationStatusDueSoon is a secret approaching its rotation deadline (within the
	// reminder window) — warn ahead of expiry.
	RotationStatusDueSoon RotationStatus = "due_soon"
	// RotationStatusOverdue is a secret past its rotation deadline — rotate now.
	RotationStatusOverdue RotationStatus = "overdue"
)

// RotationField is the per-secret-field outcome of evaluating the rotation policy.
// It is strictly non-sensitive: it names the field and reports timing, never the
// secret value.
type RotationField struct {
	// Field is the secret config key (e.g. "client_secret").
	Field string `json:"field"`
	// Status is ok | due_soon | overdue.
	Status RotationStatus `json:"status"`
	// LastRotated is when the field was last rotated (or the endpoint created_at
	// fallback for a never-rotated secret).
	LastRotated time.Time `json:"last_rotated"`
	// DueAt is the rotation deadline (LastRotated + rotate_every_days).
	DueAt time.Time `json:"due_at"`
	// DaysLeft is whole days until DueAt (negative when overdue).
	DaysLeft int `json:"days_left"`
}

// RotationPolicy evaluates an endpoint's rotate_every_days cadence against the
// recorded last_rotated stamps for its secret fields. ReminderDays is the
// look-ahead window (defaulted to DefaultRotationReminderDays when non-positive).
type RotationPolicy struct {
	ReminderDays int
}

// NewRotationPolicy builds the policy with a reminder window (days). A non-positive
// window defaults to DefaultRotationReminderDays.
func NewRotationPolicy(reminderDays int) RotationPolicy {
	if reminderDays <= 0 {
		reminderDays = DefaultRotationReminderDays
	}
	return RotationPolicy{ReminderDays: reminderDays}
}

// Evaluate reports the rotation status of every SECRET field on the endpoint that
// holds a value (so an unset secret is not flagged), against the endpoint's
// rotate_every_days cadence. It returns nil when the endpoint has no rotation policy
// (rotate_every_days unset / non-positive). The result is non-sensitive: field names
// + timing only. last_rotated falls back to the endpoint created_at for a
// never-rotated secret so a stale long-lived credential still trips.
func (p RotationPolicy) Evaluate(endpoint model.IntegrationEndpoint, now time.Time) []RotationField {
	days, ok := RotateEveryDays(endpoint.Config)
	if !ok {
		return nil
	}
	reminder := p.ReminderDays
	if reminder <= 0 {
		reminder = DefaultRotationReminderDays
	}
	now = now.UTC()
	cadence := time.Duration(days) * 24 * time.Hour
	reminderWindow := time.Duration(reminder) * 24 * time.Hour

	schema, _ := SchemaFor(endpoint.Kind)
	var out []RotationField
	for _, f := range schema {
		if !f.IsSecret() {
			continue
		}
		raw, present := endpoint.Config[f.Key]
		if !present {
			continue
		}
		if s, isStr := raw.(string); isStr && strings.TrimSpace(s) == "" {
			continue
		}
		lastRotated, found := LastRotatedField(endpoint, f.Key)
		if !found {
			// Never rotated: fall back to the endpoint's age so a long-lived,
			// never-rotated secret still trips the policy.
			lastRotated = endpoint.CreatedAt.UTC()
			if lastRotated.IsZero() {
				lastRotated = now
			}
		}
		dueAt := lastRotated.Add(cadence)
		daysLeft := int(dueAt.Sub(now).Hours() / 24)
		status := RotationStatusOK
		switch {
		case !now.Before(dueAt):
			status = RotationStatusOverdue
		case dueAt.Sub(now) <= reminderWindow:
			status = RotationStatusDueSoon
		}
		out = append(out, RotationField{
			Field:       f.Key,
			Status:      status,
			LastRotated: lastRotated,
			DueAt:       dueAt,
			DaysLeft:    daysLeft,
		})
	}
	return out
}

// DueFor returns ONLY the secret fields that are OVERDUE for rotation (past their
// deadline). The rotation monitor uses this to drive a reminder / auto-rotate. An
// endpoint with no rotation policy yields nil.
func (p RotationPolicy) DueFor(endpoint model.IntegrationEndpoint, now time.Time) []RotationField {
	var due []RotationField
	for _, rf := range p.Evaluate(endpoint, now) {
		if rf.Status == RotationStatusOverdue {
			due = append(due, rf)
		}
	}
	return due
}

// =============================================================================
// ExpiryReporter — surfaces rotation-policy timing as masked-endpoint expiry
// warnings (feature 10 seam). The registry type-asserts an adapter's
// ExpiryReporter; this standalone reporter lets the rotation policy contribute
// warnings without a connector change. It reads non-sensitive config/metadata only.
// =============================================================================

// RotationExpiryReporter adapts a RotationPolicy to the ExpiryReporter capability so
// the registry's masked-config path (Expiries) surfaces approaching/overdue secret
// rotations as ExpiryWarnings (the console badge). It is a standalone reporter (not a
// connector) used by the rotation monitor and any masked-config annotation; it never
// echoes a secret value.
type RotationExpiryReporter struct {
	policy RotationPolicy
	now    func() time.Time
}

// NewRotationExpiryReporter builds the reporter over a policy. now defaults to
// time.Now (UTC) when nil.
func NewRotationExpiryReporter(policy RotationPolicy, now func() time.Time) *RotationExpiryReporter {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &RotationExpiryReporter{policy: policy, now: now}
}

// Expiries implements ExpiryReporter: it reports a warning for every secret field
// that is due-soon or overdue per the rotation policy. ExpiresAt is the rotation
// deadline (DueAt) and DaysLeft is whole days until it (negative when overdue). An
// endpoint with no rotation policy yields no warnings.
func (r *RotationExpiryReporter) Expiries(endpoint model.IntegrationEndpoint) []ExpiryWarning {
	var out []ExpiryWarning
	for _, rf := range r.policy.Evaluate(endpoint, r.now()) {
		if rf.Status == RotationStatusOK {
			continue
		}
		out = append(out, ExpiryWarning{
			Field:     rf.Field,
			ExpiresAt: rf.DueAt,
			DaysLeft:  rf.DaysLeft,
		})
	}
	return out
}

var _ ExpiryReporter = (*RotationExpiryReporter)(nil)
