package service

import (
	"testing"
	"time"

	"github.com/clario360/platform/internal/workflow/model"
)

func slaTask(created time.Time, status string) *model.HumanTask {
	return &model.HumanTask{
		ID:        "task-1",
		TenantID:  "aaaaaaaa-0000-0000-0000-000000000001",
		Status:    status,
		CreatedAt: created,
	}
}

func TestEvaluateSLA_TiersFireAtElapsedTime(t *testing.T) {
	cal := Default24x7Calendar() // wall-clock, deterministic
	created := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	policy := SLAPolicy{
		Tiers: []SLATier{
			{After: 4 * time.Hour, Notify: "role:lead", Action: SLAActionNotify},
			{After: 8 * time.Hour, Notify: "role:manager", Action: SLAActionReassign},
			{After: 12 * time.Hour, Notify: "role:director", Action: SLAActionEscalate},
		},
	}

	tests := []struct {
		name          string
		now           time.Time
		wantDueCount  int
		wantBreached  bool
		wantHighestTI int // tier index of highest due action; -1 when none
	}{
		{
			name:          "before first tier nothing due",
			now:           created.Add(3 * time.Hour),
			wantDueCount:  0,
			wantBreached:  false,
			wantHighestTI: -1,
		},
		{
			name:          "first tier due",
			now:           created.Add(4*time.Hour + time.Minute),
			wantDueCount:  1,
			wantBreached:  false,
			wantHighestTI: 0,
		},
		{
			name:          "two tiers due",
			now:           created.Add(9 * time.Hour),
			wantDueCount:  2,
			wantBreached:  false,
			wantHighestTI: 1,
		},
		{
			name:          "all tiers due breach at final",
			now:           created.Add(13 * time.Hour),
			wantDueCount:  3,
			wantBreached:  true,
			wantHighestTI: 2,
		},
		{
			name:          "exactly at tier boundary is due",
			now:           created.Add(4 * time.Hour),
			wantDueCount:  1,
			wantBreached:  false,
			wantHighestTI: 0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			eval := EvaluateSLA(tc.now, slaTask(created, model.TaskStatusPending), policy, cal)
			if len(eval.DueActions) != tc.wantDueCount {
				t.Fatalf("due actions = %d, want %d (%+v)", len(eval.DueActions), tc.wantDueCount, eval.DueActions)
			}
			if eval.Breached != tc.wantBreached {
				t.Errorf("Breached = %v, want %v", eval.Breached, tc.wantBreached)
			}
			top, ok := eval.HighestDueTier()
			if tc.wantHighestTI == -1 {
				if ok {
					t.Errorf("HighestDueTier ok = true, want none")
				}
			} else {
				if !ok {
					t.Fatal("HighestDueTier ok = false, want a tier")
				}
				if top.TierIndex != tc.wantHighestTI {
					t.Errorf("highest tier index = %d, want %d", top.TierIndex, tc.wantHighestTI)
				}
			}
		})
	}
}

func TestEvaluateSLA_ActionAndTargetPropagation(t *testing.T) {
	cal := Default24x7Calendar()
	created := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	policy := SLAPolicy{
		Tiers: []SLATier{
			{After: 1 * time.Hour, Notify: "role:lead", Action: SLAActionNotify},
			{After: 2 * time.Hour, Notify: "role:manager", Action: SLAActionEscalate},
		},
	}
	eval := EvaluateSLA(created.Add(3*time.Hour), slaTask(created, model.TaskStatusClaimed), policy, cal)
	if len(eval.DueActions) != 2 {
		t.Fatalf("due actions = %d, want 2", len(eval.DueActions))
	}
	if eval.DueActions[0].Action != SLAActionNotify || eval.DueActions[0].Notify != "role:lead" {
		t.Errorf("tier 0 = %+v, want notify/role:lead", eval.DueActions[0])
	}
	if eval.DueActions[1].Action != SLAActionEscalate || eval.DueActions[1].Notify != "role:manager" {
		t.Errorf("tier 1 = %+v, want escalate/role:manager", eval.DueActions[1])
	}
	if !eval.DueActions[1].Breach {
		t.Error("final tier should be marked as breach")
	}
}

func TestEvaluateSLA_RemindersBeforeBreach(t *testing.T) {
	cal := Default24x7Calendar()
	created := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	// Single breach tier at 8h; remind 2h and 1h before breach (i.e. at 6h, 7h).
	policy := SLAPolicy{
		Tiers:        []SLATier{{After: 8 * time.Hour, Notify: "role:manager", Action: SLAActionEscalate}},
		RemindBefore: []time.Duration{2 * time.Hour, 1 * time.Hour},
	}

	tests := []struct {
		name            string
		now             time.Time
		wantReminders   int
		wantBreached    bool
		wantFirstFireAt time.Time
	}{
		{
			name:          "before any reminder",
			now:           created.Add(5 * time.Hour),
			wantReminders: 0,
		},
		{
			name:            "first reminder due (6h)",
			now:             created.Add(6*time.Hour + time.Minute),
			wantReminders:   1,
			wantFirstFireAt: created.Add(6 * time.Hour),
		},
		{
			name:          "both reminders due (7h+)",
			now:           created.Add(7*time.Hour + time.Minute),
			wantReminders: 2,
		},
		{
			name:          "after breach no reminders",
			now:           created.Add(9 * time.Hour),
			wantReminders: 0,
			wantBreached:  true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			eval := EvaluateSLA(tc.now, slaTask(created, model.TaskStatusPending), policy, cal)
			if len(eval.DueReminders) != tc.wantReminders {
				t.Fatalf("reminders = %d, want %d (%+v)", len(eval.DueReminders), tc.wantReminders, eval.DueReminders)
			}
			if eval.Breached != tc.wantBreached {
				t.Errorf("Breached = %v, want %v", eval.Breached, tc.wantBreached)
			}
			if tc.wantReminders > 0 && !tc.wantFirstFireAt.IsZero() {
				if !eval.DueReminders[0].FireAt.Equal(tc.wantFirstFireAt) {
					t.Errorf("first reminder fireAt = %s, want %s", eval.DueReminders[0].FireAt, tc.wantFirstFireAt)
				}
			}
		})
	}
}

func TestEvaluateSLA_BusinessHoursAware(t *testing.T) {
	utc := time.UTC
	cal := businessWeekCalendar(utc) // Sun–Thu 09:00–17:00
	// Task created Thursday 16:00; a "2h" SLA in business time crosses the
	// weekend: 1h to Thu close (17:00), then resume Sunday 09:00 + 1h = 10:00.
	created := mustTime(t, utc, "2026-06-18 16:00") // Thursday
	policy := SLAPolicy{
		Tiers: []SLATier{{After: 2 * time.Hour, Notify: "role:lead", Action: SLAActionEscalate}},
	}

	wantBreach := mustTime(t, utc, "2026-06-21 10:00") // Sunday 10:00

	// Wall-clock 2h later (Thursday 18:00) is NOT yet due because business hours
	// skip the weekend.
	notYet := EvaluateSLA(mustTime(t, utc, "2026-06-18 18:00"), slaTask(created, model.TaskStatusPending), policy, cal)
	if notYet.Breached {
		t.Error("should not breach on wall-clock; business hours skip weekend")
	}
	if !notYet.BreachDeadline.Equal(wantBreach) {
		t.Errorf("breach deadline = %s, want %s (business hours)", notYet.BreachDeadline.Format("2006-01-02 15:04"), wantBreach.Format("2006-01-02 15:04"))
	}

	// At Sunday 10:01 it has breached.
	due := EvaluateSLA(mustTime(t, utc, "2026-06-21 10:01"), slaTask(created, model.TaskStatusPending), policy, cal)
	if !due.Breached {
		t.Error("should breach after business deadline on Sunday")
	}
}

func TestEvaluateSLA_TerminalTaskNoActions(t *testing.T) {
	cal := Default24x7Calendar()
	created := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	policy := SLAPolicy{Tiers: []SLATier{{After: time.Hour, Notify: "role:lead", Action: SLAActionEscalate}}}
	for _, status := range []string{model.TaskStatusCompleted, model.TaskStatusRejected, model.TaskStatusCancelled} {
		eval := EvaluateSLA(created.Add(10*time.Hour), slaTask(created, status), policy, cal)
		if len(eval.DueActions) != 0 || eval.Breached {
			t.Errorf("status %q: expected no actions, got %+v breached=%v", status, eval.DueActions, eval.Breached)
		}
	}
}

func TestEvaluateSLA_EmptyPolicyAndNilTask(t *testing.T) {
	cal := Default24x7Calendar()
	created := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	if eval := EvaluateSLA(created, slaTask(created, model.TaskStatusPending), SLAPolicy{}, cal); len(eval.DueActions) != 0 {
		t.Errorf("empty policy: want no actions, got %+v", eval.DueActions)
	}
	if eval := EvaluateSLA(created, nil, SLAPolicy{Tiers: []SLATier{{After: time.Hour, Notify: "x", Action: SLAActionNotify}}}, cal); len(eval.DueActions) != 0 {
		t.Errorf("nil task: want no actions, got %+v", eval.DueActions)
	}
}

func TestEvaluateSLA_UnsortedTiersAreSorted(t *testing.T) {
	cal := Default24x7Calendar()
	created := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	// Intentionally out of order — EvaluateSLA must sort and treat the largest as breach.
	policy := SLAPolicy{
		Tiers: []SLATier{
			{After: 8 * time.Hour, Notify: "role:manager", Action: SLAActionEscalate},
			{After: 4 * time.Hour, Notify: "role:lead", Action: SLAActionNotify},
		},
	}
	eval := EvaluateSLA(created.Add(9*time.Hour), slaTask(created, model.TaskStatusPending), policy, cal)
	if len(eval.DueActions) != 2 {
		t.Fatalf("due = %d, want 2", len(eval.DueActions))
	}
	// Sorted: index 0 = 4h notify, index 1 = 8h escalate (breach).
	if eval.DueActions[0].Action != SLAActionNotify {
		t.Errorf("first sorted tier action = %s, want notify", eval.DueActions[0].Action)
	}
	if !eval.DueActions[1].Breach {
		t.Error("8h tier must be the breach tier after sorting")
	}
}

func TestSLATier_IsValid(t *testing.T) {
	tests := []struct {
		name string
		tier SLATier
		want bool
	}{
		{"valid notify", SLATier{After: time.Hour, Notify: "role:lead", Action: SLAActionNotify}, true},
		{"valid default action", SLATier{After: time.Hour, Notify: "role:lead"}, true},
		{"negative offset", SLATier{After: -time.Hour, Notify: "role:lead", Action: SLAActionNotify}, false},
		{"empty target", SLATier{After: time.Hour, Action: SLAActionNotify}, false},
		{"bad action", SLATier{After: time.Hour, Notify: "role:lead", Action: "ignore"}, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.tier.IsValid(); got != tc.want {
				t.Errorf("IsValid() = %v, want %v", got, tc.want)
			}
		})
	}
}
