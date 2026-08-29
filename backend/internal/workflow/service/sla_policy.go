package service

import (
	"sort"
	"time"

	"github.com/clario360/platform/internal/workflow/model"
)

// WP-5 — multi-level SLA / escalation policy (Design §3.4).
//
// A task's deadline is no longer a single timestamp; a definition can carry a
// tiered escalation policy: a series of tiers, each firing a configured action
// (notify / reassign / escalate) at a cumulative *business-time* offset from the
// task's creation, plus a reminder cadence that fires before the final breach.
// EvaluateSLA is a pure function — it reads (now, task, policy, calendar) and
// returns the actions that are due as of `now`. It performs NO side effects; the
// scheduler SLA loop (scheduler_service.go:216, owned by the INTEGRATE phase)
// calls this and then persists / publishes. Keeping it pure makes it directly
// table-testable with an injected clock and calendar.

// SLA tier action constants. These mirror Design §3.4's
// {notify | reassign | escalate} action vocabulary.
const (
	// SLAActionNotify pings a target (role/user) without changing assignment.
	SLAActionNotify = "notify"
	// SLAActionReassign moves the task to a new assignee/role.
	SLAActionReassign = "reassign"
	// SLAActionEscalate escalates the task up the chain (and marks it breached
	// at the final tier).
	SLAActionEscalate = "escalate"
)

// validSLAActions is the allow-set for tier actions.
var validSLAActions = map[string]bool{
	SLAActionNotify:   true,
	SLAActionReassign: true,
	SLAActionEscalate: true,
}

// SLATier is one level of a tiered escalation policy. After `After` business
// time has elapsed since the task was created, `Action` fires targeting
// `Notify`. Example: {After: 4h, Notify: "role:lead", Action: notify}.
type SLATier struct {
	// After is the cumulative business-time offset from task creation at which
	// this tier becomes due.
	After time.Duration
	// Notify is the target of the action, e.g. "role:lead" or "user:<id>".
	Notify string
	// Action is one of notify | reassign | escalate. Empty defaults to notify.
	Action string
}

// effectiveAction returns the tier's action, defaulting to notify.
func (t SLATier) effectiveAction() string {
	if t.Action == "" {
		return SLAActionNotify
	}
	return t.Action
}

// IsValid reports whether the tier is well-formed: non-negative offset, a
// recognised action, and a non-empty target.
func (t SLATier) IsValid() bool {
	if t.After < 0 {
		return false
	}
	if !validSLAActions[t.effectiveAction()] {
		return false
	}
	return t.Notify != ""
}

// SLAPolicy is a definition-level escalation policy: an ordered set of tiers and
// a list of "remind me this long before the final breach" offsets.
type SLAPolicy struct {
	// Tiers are the escalation levels. They need not be pre-sorted; EvaluateSLA
	// sorts a copy by After ascending.
	Tiers []SLATier
	// RemindBefore lists durations *before the final (breach) tier* at which a
	// reminder should be sent. e.g. [1h, 15m] reminds 1h and 15m before breach.
	RemindBefore []time.Duration
}

// HasTiers reports whether the policy declares any tiers.
func (p SLAPolicy) HasTiers() bool {
	return len(p.Tiers) > 0
}

// sortedTiers returns the policy's valid tiers sorted by After ascending. The
// input slice is not mutated.
func (p SLAPolicy) sortedTiers() []SLATier {
	out := make([]SLATier, 0, len(p.Tiers))
	for _, t := range p.Tiers {
		if t.IsValid() {
			out = append(out, t)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].After < out[j].After
	})
	return out
}

// BreachTier returns the last (largest-offset) valid tier, which represents the
// final breach point, and whether one exists.
func (p SLAPolicy) BreachTier() (SLATier, bool) {
	tiers := p.sortedTiers()
	if len(tiers) == 0 {
		return SLATier{}, false
	}
	return tiers[len(tiers)-1], true
}

// SLAAction is a single due action emitted by EvaluateSLA.
type SLAAction struct {
	// TierIndex is the index of the tier in the policy's sorted order.
	TierIndex int
	// Action is one of notify | reassign | escalate.
	Action string
	// Notify is the target (role/user) of the action.
	Notify string
	// DueAt is the wall-clock instant this tier became due (business-time
	// adjusted). It is always <= now for an emitted action.
	DueAt time.Time
	// Breach is true when this action corresponds to the final tier (the task is
	// considered SLA-breached at this point).
	Breach bool
}

// SLAReminder is a pre-breach reminder emitted by EvaluateSLA.
type SLAReminder struct {
	// Before is the configured lead time before breach.
	Before time.Duration
	// FireAt is the wall-clock instant the reminder became due.
	FireAt time.Time
}

// SLAEvaluation is the result of EvaluateSLA: the actions and reminders that are
// due as of `now`, plus the computed breach deadline for reference.
type SLAEvaluation struct {
	// DueActions are tier actions whose business-time offset has elapsed.
	DueActions []SLAAction
	// DueReminders are reminders whose fire time has elapsed (and that precede
	// the breach, which has not yet occurred).
	DueReminders []SLAReminder
	// Breached is true if the final tier is due (task has breached its SLA).
	Breached bool
	// AtRisk is true when the task is APPROACHING breach: at least one pre-breach
	// reminder is due but the breach itself has not yet occurred. This is the
	// signal the scheduler uses to stamp the row-level at_risk marker and to emit
	// the pre-breach at_risk event so users are warned BEFORE the deadline passes
	// (the log-only reminder branch left this structurally unreachable).
	AtRisk bool
	// BreachDeadline is the wall-clock instant of the final tier, if the policy
	// has tiers. Zero otherwise.
	BreachDeadline time.Time
}

// EvaluateSLA computes which tier actions and reminders are due for `task` as of
// `now`, interpreting each tier's offset in *business time* via `calendar`.
//
// Semantics:
//   - Each tier's DueAt = BusinessDeadline(task.CreatedAt, tier.After).
//   - A tier is "due" when now >= DueAt.
//   - The largest-offset tier is the breach tier; when it is due, Breached=true.
//   - Reminders fire at (breachDeadline - before) in wall-clock terms and are
//     only emitted while the task has not yet breached (a reminder after breach
//     is pointless — the breach action covers it).
//   - If the task is already in a terminal state (completed/rejected/cancelled)
//     no actions or reminders are returned.
//
// The function is pure and deterministic for a fixed (now, task, policy,
// calendar); it never mutates its inputs.
func EvaluateSLA(now time.Time, task *model.HumanTask, policy SLAPolicy, calendar Calendar) SLAEvaluation {
	eval := SLAEvaluation{}
	if task == nil {
		return eval
	}
	// Do not evaluate SLA for tasks that are no longer actionable.
	switch task.Status {
	case model.TaskStatusCompleted, model.TaskStatusRejected, model.TaskStatusCancelled:
		return eval
	}

	tiers := policy.sortedTiers()
	if len(tiers) == 0 {
		return eval
	}

	created := task.CreatedAt
	lastIdx := len(tiers) - 1

	// Compute the breach deadline (final tier) up front; reminders key off it.
	breachDue, breachErr := calendar.BusinessDeadline(created, tiers[lastIdx].After)
	if breachErr == nil {
		eval.BreachDeadline = breachDue
	}

	for i, tier := range tiers {
		dueAt, err := calendar.BusinessDeadline(created, tier.After)
		if err != nil {
			// A calendar that can't produce a deadline (no working hours)
			// cannot fire time-based tiers; skip silently rather than fabricate.
			continue
		}
		if now.Before(dueAt) {
			continue
		}
		isBreach := i == lastIdx
		eval.DueActions = append(eval.DueActions, SLAAction{
			TierIndex: i,
			Action:    tier.effectiveAction(),
			Notify:    tier.Notify,
			DueAt:     dueAt,
			Breach:    isBreach,
		})
		if isBreach {
			eval.Breached = true
		}
	}

	// Reminders only make sense before the breach and when we have a deadline.
	if !eval.Breached && breachErr == nil {
		for _, before := range policy.RemindBefore {
			if before <= 0 {
				continue
			}
			fireAt := breachDue.Add(-before)
			// A reminder is due when now has passed its fire time but the breach
			// itself has not yet occurred (guaranteed by !eval.Breached above).
			if !now.Before(fireAt) && now.Before(breachDue) {
				eval.DueReminders = append(eval.DueReminders, SLAReminder{
					Before: before,
					FireAt: fireAt,
				})
			}
		}
		// Emit reminders in fire-time order for deterministic processing.
		sort.SliceStable(eval.DueReminders, func(i, j int) bool {
			return eval.DueReminders[i].FireAt.Before(eval.DueReminders[j].FireAt)
		})
	}

	// The task is at risk when a pre-breach reminder has fired but the breach has
	// not yet occurred — i.e. the deadline is approaching. This is only ever true
	// on the !Breached path (reminders are not collected after breach), so the
	// two flags are mutually exclusive by construction.
	eval.AtRisk = !eval.Breached && len(eval.DueReminders) > 0

	return eval
}

// HighestDueTier returns the most severe (largest-offset) action that is due in
// an evaluation, which is the one the scheduler should act on when collapsing
// multiple due tiers into a single state transition. ok is false when nothing is
// due.
func (e SLAEvaluation) HighestDueTier() (SLAAction, bool) {
	if len(e.DueActions) == 0 {
		return SLAAction{}, false
	}
	best := e.DueActions[0]
	for _, a := range e.DueActions[1:] {
		if a.TierIndex > best.TierIndex {
			best = a
		}
	}
	return best, true
}
