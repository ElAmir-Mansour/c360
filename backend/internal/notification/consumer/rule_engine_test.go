package consumer

import (
	"encoding/json"
	"testing"

	"github.com/clario360/platform/internal/cyber/cti"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/notification/model"
)

func makeTestEvent(eventType, tenantID string, data map[string]interface{}) *events.Event {
	dataBytes, _ := json.Marshal(data)
	return &events.Event{
		ID:       "evt-123",
		Source:   "clario360/test-service",
		Type:     eventType,
		TenantID: tenantID,
		UserID:   "user-456",
		Data:     dataBytes,
	}
}

func TestRuleEngine_MatchAlertCreated_Critical(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.cyber.alert.created", "tenant-1", map[string]interface{}{
		"severity": "critical",
		"title":    "Ransomware detected",
		"id":       "alert-789",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Rule.NotifType != model.NotifAlertCreated {
		t.Fatalf("expected alert created notification, got %s", matches[0].Rule.NotifType)
	}
	if priority := ResolvePriority(matches[0].Rule, matches[0].Data); priority != model.PriorityCritical {
		t.Fatalf("expected critical priority, got %s", priority)
	}
}

func TestRuleEngine_MatchAlertCreated_High(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.cyber.alert.created", "tenant-1", map[string]interface{}{
		"severity": "high",
		"title":    "Privilege escalation",
		"id":       "alert-001",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Rule.RecipientMode != RecipientRoleBased {
		t.Fatalf("expected role based rule, got %s", matches[0].Rule.RecipientMode)
	}
	if matches[0].Rule.Roles[0] != "security-analyst" {
		t.Fatalf("expected security-analyst recipient, got %v", matches[0].Rule.Roles)
	}
}

func TestRuleEngine_MatchAlertCreated_LowSeverity_NoMatch(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.cyber.alert.created", "tenant-1", map[string]interface{}{
		"severity": "low",
		"title":    "Minor scan",
	})

	if matches := re.Match(event); len(matches) != 0 {
		t.Fatalf("expected 0 matches for low severity alert, got %d", len(matches))
	}
}

func TestRuleEngine_MatchCTICriticalThreatAlert(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360."+cti.EventCriticalThreatAlert, "tenant-1", map[string]interface{}{
		"title":       "CTI Critical Threat",
		"description": "APT campaign targeting the tenant",
		"action_url":  "/cyber/cti/events/event-1",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Rule.Topic != cti.TopicCTIAlerts {
		t.Fatalf("expected CTI alerts topic, got %s", matches[0].Rule.Topic)
	}
	if matches[0].Rule.NotifType != model.NotifSecurityIncident {
		t.Fatalf("expected security incident notification, got %s", matches[0].Rule.NotifType)
	}
	if priority := ResolvePriority(matches[0].Rule, matches[0].Data); priority != model.PriorityCritical {
		t.Fatalf("expected critical priority, got %s", priority)
	}
}

func TestRuleEngine_ContractExpiringPriority(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.lex.contract.expiring", "tenant-1", map[string]interface{}{
		"id":                "contract-1",
		"title":             "Master Services Agreement",
		"days_until_expiry": 7,
		"owner_user_id":     "user-owner",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Rule.RecipientMode != RecipientMixed {
		t.Fatalf("expected mixed recipient mode, got %s", matches[0].Rule.RecipientMode)
	}
	if priority := ResolvePriority(matches[0].Rule, matches[0].Data); priority != model.PriorityCritical {
		t.Fatalf("expected critical priority, got %s", priority)
	}
}

// TestRuleEngine_MatchMatterTimelineEvents covers #19: every matter-timeline
// CloudEvent matches exactly one rule that produces an in-app notification.new,
// routed to the actor, category legal, with matter_id/event_type/actor_id present
// in the matched payload (which becomes message.data.data on the WS).
func TestRuleEngine_MatchMatterTimelineEvents(t *testing.T) {
	matterTimelineTypes := []string{
		"com.clario360.lex.matter.timeline_updated",
		"com.clario360.lex.matter.external_hold_set",
		"com.clario360.lex.matter.external_hold_cleared",
		"com.clario360.lex.matter.delay_recorded",
		"com.clario360.lex.matter.delay_resolved",
		"com.clario360.lex.matter.delay_updated",
		"com.clario360.lex.matter.delay_reopened",
		"com.clario360.lex.matter.deadline_obligation_created",
	}
	re := NewRuleEngine()
	for _, evType := range matterTimelineTypes {
		t.Run(evType, func(t *testing.T) {
			event := makeTestEvent(evType, "tenant-1", map[string]interface{}{
				"matter_id": "matter-1",
				"category":  "court",
			})
			matches := re.Match(event)
			if len(matches) != 1 {
				t.Fatalf("expected 1 match, got %d", len(matches))
			}
			rule := matches[0].Rule
			if rule.NotifType != model.NotifMatterTimeline {
				t.Fatalf("NotifType = %s, want %s", rule.NotifType, model.NotifMatterTimeline)
			}
			if rule.Category != model.CategoryLegal {
				t.Fatalf("Category = %s, want %s (case is not a valid notification DB category)", rule.Category, model.CategoryLegal)
			}
			if rule.RecipientMode != RecipientDirect {
				t.Fatalf("RecipientMode = %s, want direct", rule.RecipientMode)
			}
			if len(rule.Channels) != 1 || rule.Channels[0] != "in_app" {
				t.Fatalf("Channels = %v, want [in_app]", rule.Channels)
			}
			// MatchData enrichment must inject the FE-facing routing keys.
			data := matches[0].Data
			if data["event_type"] != evType {
				t.Fatalf("data event_type = %v, want %s", data["event_type"], evType)
			}
			if data["actor_id"] != "user-456" {
				t.Fatalf("data actor_id = %v, want user-456", data["actor_id"])
			}
			if data["matter_id"] != "matter-1" {
				t.Fatalf("data matter_id = %v, want matter-1", data["matter_id"])
			}
			// Recipient resolves to the actor.
			recipients := ResolveDirectUserIDs(rule, data)
			if len(recipients) != 1 || recipients[0] != "user-456" {
				t.Fatalf("direct recipients = %v, want [user-456]", recipients)
			}
		})
	}
}

// TestRuleEngine_MatchDataEnrichmentDoesNotClobber confirms the additive event_type
// / actor_id enrichment never overwrites a payload that already carries those keys
// (so other suites' events are unaffected).
func TestRuleEngine_MatchDataEnrichmentDoesNotClobber(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.lex.matter.delay_recorded", "tenant-1", map[string]interface{}{
		"matter_id":  "matter-1",
		"event_type": "custom-supplied",
		"actor_id":   "explicit-actor",
	})
	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	data := matches[0].Data
	if data["event_type"] != "custom-supplied" {
		t.Fatalf("event_type was clobbered: %v", data["event_type"])
	}
	if data["actor_id"] != "explicit-actor" {
		t.Fatalf("actor_id was clobbered: %v", data["actor_id"])
	}
}

func TestRuleEngine_WorkflowTaskCreated_MixedRecipients(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.workflow.task.created", "tenant-1", map[string]interface{}{
		"task_id":       "task-1",
		"task_name":     "Review contract",
		"assignee_id":   "user-123",
		"assignee_role": "legal-manager",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Rule.RecipientMode != RecipientMixed {
		t.Fatalf("expected mixed recipient mode, got %s", matches[0].Rule.RecipientMode)
	}
	roles := ResolveRoles(matches[0].Rule, matches[0].Data)
	if len(roles) != 1 || roles[0] != "legal-manager" {
		t.Fatalf("expected dynamic role resolution, got %v", roles)
	}
}

func TestRuleEngine_PipelineFailed_UsesComputedRecipients(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.data.pipeline.run.failed", "tenant-1", map[string]interface{}{
		"pipeline_id": "pipe-1",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Rule.RecipientMode != RecipientComputed {
		t.Fatalf("expected computed recipient mode, got %s", matches[0].Rule.RecipientMode)
	}
	if matches[0].Rule.ComputedRecipient != "pipeline_owner_from_event" {
		t.Fatalf("expected pipeline owner computation, got %s", matches[0].Rule.ComputedRecipient)
	}
}

func TestRuleEngine_MeetingScheduled_UsesCommitteeComputation(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.acta.meeting.scheduled", "tenant-1", map[string]interface{}{
		"committee_id": "committee-1",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Rule.RecipientMode != RecipientComputed {
		t.Fatalf("expected computed recipient mode, got %s", matches[0].Rule.RecipientMode)
	}
	if matches[0].Rule.ComputedRecipient != "committee_members_from_event" {
		t.Fatalf("expected committee members computation, got %s", matches[0].Rule.ComputedRecipient)
	}
}

func TestRuleEngine_SystemMaintenance_Broadcast(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.platform.system.maintenance", "tenant-1", map[string]interface{}{
		"title":       "Database upgrade",
		"description": "Upgrading PostgreSQL",
	})

	matches := re.Match(event)
	if len(matches) != 1 {
		t.Fatalf("expected 1 match, got %d", len(matches))
	}
	if matches[0].Rule.RecipientMode != RecipientTenantBroadcast {
		t.Fatalf("expected tenant broadcast, got %s", matches[0].Rule.RecipientMode)
	}
}

func TestRuleEngine_NoMatch(t *testing.T) {
	re := NewRuleEngine()
	event := makeTestEvent("com.clario360.unknown.event", "tenant-1", nil)

	if matches := re.Match(event); len(matches) != 0 {
		t.Fatalf("expected 0 matches for unknown event, got %d", len(matches))
	}
}

func TestResolvePriority_Dynamic(t *testing.T) {
	rule := &NotificationRule{
		PriorityFunc: func(data map[string]interface{}) string {
			if data["severity"] == "critical" {
				return model.PriorityCritical
			}
			return model.PriorityMedium
		},
	}
	data := map[string]interface{}{"severity": "critical"}
	if p := ResolvePriority(rule, data); p != model.PriorityCritical {
		t.Fatalf("expected critical, got %s", p)
	}
}

func TestResolveDirectUserIDs_MultiFieldDedup(t *testing.T) {
	rule := &NotificationRule{DirectFields: []string{"assigned_to", "attendee_ids"}}
	data := map[string]interface{}{
		"assigned_to":  "user-1",
		"attendee_ids": []interface{}{"user-1", "user-2", "user-3"},
	}

	ids := ResolveDirectUserIDs(rule, data)
	if len(ids) != 3 {
		t.Fatalf("expected 3 unique user IDs, got %v", ids)
	}
}

func TestExtractEventTopics(t *testing.T) {
	topics := ExtractEventTopics()
	required := map[string]bool{
		events.Topics.AlertEvents:    false,
		events.Topics.FileEvents:     false,
		events.Topics.WorkflowEvents: false,
		events.Topics.ActaEvents:     false,
		events.Topics.LexEvents:      false,
		cti.TopicCTIAlerts:           false,
	}
	for _, topic := range topics {
		if _, ok := required[topic]; ok {
			required[topic] = true
		}
	}
	for topic, found := range required {
		if !found {
			t.Fatalf("expected topic %s to be subscribed", topic)
		}
	}
}

// TestRuleEngine_PlaybookDeviation covers WTQ-RSK-02 #10: the playbook
// deviations_detected rule fires on high/critical max severity or a missing required
// clause, and does NOT fire when the report is benign.
func TestRuleEngine_PlaybookDeviation(t *testing.T) {
	re := NewRuleEngine()

	t.Run("fires on critical max severity", func(t *testing.T) {
		event := makeTestEvent("com.clario360.lex.playbook.deviations_detected", "tenant-1", map[string]interface{}{
			"contract_id":            "c-1",
			"playbook_id":            "p-1",
			"playbook_name":          "NDA Playbook",
			"max_severity":           "critical",
			"missing_required_count": float64(0),
			"missing_count":          float64(0),
			"altered_count":          float64(1),
			"extra_count":            float64(0),
		})
		matches := re.Match(event)
		if len(matches) != 1 {
			t.Fatalf("expected 1 match, got %d", len(matches))
		}
		if matches[0].Rule.NotifType != model.NotifPlaybookDeviation {
			t.Fatalf("expected playbook.deviation, got %s", matches[0].Rule.NotifType)
		}
		if matches[0].Rule.Category != model.CategoryLegal {
			t.Fatalf("expected legal category, got %s", matches[0].Rule.Category)
		}
		if priority := ResolvePriority(matches[0].Rule, matches[0].Data); priority != model.PriorityCritical {
			t.Fatalf("expected critical priority, got %s", priority)
		}
		// contract_id and playbook_id must travel in the notification data.
		if matches[0].Data["contract_id"] != "c-1" || matches[0].Data["playbook_id"] != "p-1" {
			t.Fatalf("expected contract_id/playbook_id in data, got %v", matches[0].Data)
		}
	})

	t.Run("fires on missing required clause with low severity", func(t *testing.T) {
		event := makeTestEvent("com.clario360.lex.playbook.deviations_detected", "tenant-1", map[string]interface{}{
			"contract_id":            "c-2",
			"playbook_name":          "Vendor Playbook",
			"max_severity":           "low",
			"missing_required_count": float64(2),
		})
		matches := re.Match(event)
		if len(matches) != 1 {
			t.Fatalf("expected 1 match, got %d", len(matches))
		}
		if priority := ResolvePriority(matches[0].Rule, matches[0].Data); priority != model.PriorityHigh {
			t.Fatalf("expected high priority, got %s", priority)
		}
	})

	t.Run("does not fire on benign report", func(t *testing.T) {
		event := makeTestEvent("com.clario360.lex.playbook.deviations_detected", "tenant-1", map[string]interface{}{
			"contract_id":            "c-3",
			"max_severity":           "low",
			"missing_required_count": float64(0),
		})
		if matches := re.Match(event); len(matches) != 0 {
			t.Fatalf("expected no match for benign report, got %d", len(matches))
		}
	})
}
