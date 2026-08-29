package consumer

import (
	"testing"

	"github.com/clario360/platform/internal/notification/model"
)

// These tests cover the pre-breach SLA reminder / at-risk / OOO-reassignment
// notification rules added alongside the workflow scheduler's pre-breach
// reminders. They mirror the existing sla_breached rule coverage.

func TestRuleEngine_MatchSLAReminder(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.workflow.task.sla_reminder", "tenant-1", map[string]interface{}{
		"task_id":       "task-1",
		"task_name":     "Approve invoice",
		"assignee_id":   "user-1",
		"assignee_role": "approver",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match for sla_reminder, got %d", len(matches))
	}
	m := matches[0]
	if m.Rule.NotifType != model.NotifTaskSLAReminder {
		t.Fatalf("expected task.sla_reminder notif type, got %s", m.Rule.NotifType)
	}
	if m.Rule.Category != model.CategoryWorkflow {
		t.Fatalf("expected workflow category, got %s", m.Rule.Category)
	}
	// Must fan out to email + in-app so the assignee is warned in time.
	if !hasChannel(m.Rule.Channels, "email") || !hasChannel(m.Rule.Channels, "in_app") {
		t.Fatalf("expected email + in_app channels, got %v", m.Rule.Channels)
	}
	ids := ResolveDirectUserIDs(m.Rule, m.Data)
	if !contains(ids, "user-1") {
		t.Fatalf("expected assignee user-1 as a direct recipient, got %v", ids)
	}
	roles := ResolveRoles(m.Rule, m.Data)
	if !contains(roles, "approver") {
		t.Fatalf("expected assignee_role approver resolved via RoleField, got %v", roles)
	}
}

func TestRuleEngine_MatchTaskAtRisk(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.workflow.task.at_risk", "tenant-1", map[string]interface{}{
		"task_id":    "task-2",
		"task_name":  "Sign contract",
		"claimed_by": "user-9",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match for at_risk, got %d", len(matches))
	}
	m := matches[0]
	if m.Rule.NotifType != model.NotifTaskAtRisk {
		t.Fatalf("expected task.at_risk notif type, got %s", m.Rule.NotifType)
	}
	if p := ResolvePriority(m.Rule, m.Data); p != model.PriorityHigh {
		t.Fatalf("expected high priority for at_risk, got %s", p)
	}
	ids := ResolveDirectUserIDs(m.Rule, m.Data)
	if !contains(ids, "user-9") {
		t.Fatalf("expected claimant user-9 as a direct recipient, got %v", ids)
	}
}

func TestRuleEngine_MatchReassignedOOO(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.workflow.task.reassigned_ooo", "tenant-1", map[string]interface{}{
		"task_id":           "task-3",
		"original_assignee": "user-out",
		"deputy_assignee":   "user-deputy",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match for reassigned_ooo, got %d", len(matches))
	}
	m := matches[0]
	if m.Rule.NotifType != model.NotifTaskReassigned {
		t.Fatalf("expected task.reassigned_ooo notif type, got %s", m.Rule.NotifType)
	}
	// The DEPUTY (not the out-of-office user) must be notified.
	ids := ResolveDirectUserIDs(m.Rule, m.Data)
	if !contains(ids, "user-deputy") {
		t.Fatalf("expected deputy user-deputy notified, got %v", ids)
	}
	if contains(ids, "user-out") {
		t.Fatalf("out-of-office user must NOT be a recipient, got %v", ids)
	}
}

func TestRuleEngine_SLABreached_StillMatchesAlone(t *testing.T) {
	// Backward-compat: adding the reminder/at_risk rules must not cause a breach
	// event to also match them (distinct EventType keys).
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.workflow.task.sla_breached", "tenant-1", map[string]interface{}{
		"task_id":   "task-4",
		"task_name": "Late task",
	})
	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected exactly 1 match for sla_breached, got %d", len(matches))
	}
	if matches[0].Rule.NotifType != model.NotifTaskOverdue {
		t.Fatalf("expected task.overdue for breach, got %s", matches[0].Rule.NotifType)
	}
}

func hasChannel(channels []string, want string) bool { return contains(channels, want) }

func contains(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}
