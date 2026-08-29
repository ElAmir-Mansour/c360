package model

import "time"

// Substitution is a core OUT-OF-OFFICE / deputy record: within [FromTime, ToTime]
// a user (UserID) is out of office and their in-tray work is handed off to a
// deputy (DeputyID). It is the tenant-scoped registry the human-task
// assignment/create path consults so a task that WOULD be routed to an
// out-of-office approver is instead auto-reassigned to their active deputy —
// closing the gap where an approver on vacation silently BLOCKS every workflow
// routed to them.
//
// This is distinct from the existing per-decision, single-hop Lex delegation
// metadata: it is a standing, date-windowed, calendar-aware substitution held at
// the engine core, and the resolver that consumes it applies a DEPTH LIMIT and
// LOOP DETECTION so a chain A→B→C is bounded and a cycle A→B→A cannot loop.
//
// BACKWARD COMPAT: a user with no active window has NO row (or an inactive one),
// so the resolver fast-paths to a no-op and the task is assigned exactly as
// before. Single-assignee tasks routed to non-OOO users are wholly unaffected.
type Substitution struct {
	ID       string `json:"id" db:"id"`
	TenantID string `json:"tenant_id" db:"tenant_id"`
	// UserID is the out-of-office principal whose work is handed off.
	UserID string `json:"user_id" db:"user_id"`
	// DeputyID is the substitute the work is handed off to during the window.
	DeputyID string `json:"deputy_id" db:"deputy_id"`
	// FromTime / ToTime bound the out-of-office window (inclusive). They are
	// stored/compared in UTC; the calendar's timezone governs how "now" is
	// interpreted for working-hours-aware callers, but the window itself is an
	// absolute instant range.
	FromTime time.Time `json:"from_time" db:"from_time"`
	ToTime   time.Time `json:"to_time" db:"to_time"`
	// Active is the operator-controlled kill switch. A row that is not Active is
	// ignored even inside its window, so a substitution can be paused without
	// deleting it.
	Active bool `json:"active" db:"active"`
	// Reason is an optional operator note (audited on hand-off).
	Reason string `json:"reason" db:"reason"`
	// CreatedBy is the principal that set the substitution.
	CreatedBy string    `json:"created_by,omitempty" db:"created_by"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// IsActiveAt reports whether the substitution is active AND the instant t falls
// inside its [FromTime, ToTime] window (inclusive on both ends). This is the
// single predicate the resolver uses to decide whether a hand-off applies, so
// "outside the window" and "paused" both fall through to the no-op fast path.
func (s *Substitution) IsActiveAt(t time.Time) bool {
	if s == nil || !s.Active {
		return false
	}
	tu := t.UTC()
	return !tu.Before(s.FromTime.UTC()) && !tu.After(s.ToTime.UTC())
}

// MaxSubstitutionDepth bounds a deputy chain (A out → B, B out → C, ...). Once
// this many hops have been followed the resolver stops and keeps the last
// resolvable assignee, so an unusually long chain cannot blow the stack or hang.
// It is a defense-in-depth backstop; loop detection already terminates cycles.
const MaxSubstitutionDepth = 16
