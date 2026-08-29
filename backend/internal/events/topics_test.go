package events

import (
	"testing"
)

func TestAllTopics(t *testing.T) {
	topics := AllTopics()
	if len(topics) != 37 {
		t.Errorf("expected 37 topics, got %d", len(topics))
	}

	// Verify no duplicates
	seen := make(map[string]struct{})
	for _, topic := range topics {
		if _, ok := seen[topic]; ok {
			t.Errorf("duplicate topic: %s", topic)
		}
		seen[topic] = struct{}{}
	}

	// Verify required platform topics are included.
	foundDeadLetter := false
	foundLicense := false
	foundDR := false
	foundMigrate := false
	for _, topic := range topics {
		if topic == Topics.DeadLetter {
			foundDeadLetter = true
		}
		if topic == Topics.LicenseEvents {
			foundLicense = true
		}
		if topic == Topics.DREvents {
			foundDR = true
		}
		if topic == Topics.MigrateEvents {
			foundMigrate = true
		}
	}
	if !foundDeadLetter {
		t.Error("expected dead letter topic in AllTopics")
	}
	if !foundLicense {
		t.Error("expected license topic in AllTopics")
	}
	if !foundDR {
		t.Error("expected datastream.dr topic in AllTopics")
	}
	if !foundMigrate {
		t.Error("expected migrate.events topic in AllTopics")
	}
	if Topics.MigrateEvents != "migrate.events" {
		t.Errorf("unexpected MigrateEvents: %s", Topics.MigrateEvents)
	}
}

func TestTopicConstants(t *testing.T) {
	if Topics.IAMEvents != "platform.iam.events" {
		t.Errorf("unexpected IAMEvents: %s", Topics.IAMEvents)
	}
	if Topics.DeadLetter != "platform.dead-letter" {
		t.Errorf("unexpected DeadLetter: %s", Topics.DeadLetter)
	}
	if Topics.AIEvents != "platform.ai.events" {
		t.Errorf("unexpected AIEvents: %s", Topics.AIEvents)
	}
	if Topics.LicenseEvents != "platform.license.events" {
		t.Errorf("unexpected LicenseEvents: %s", Topics.LicenseEvents)
	}
	if Topics.AutomationEvents != "platform.automation.events" {
		t.Errorf("unexpected AutomationEvents: %s", Topics.AutomationEvents)
	}
	if Topics.AlertEvents != "cyber.alert.events" {
		t.Errorf("unexpected AlertEvents: %s", Topics.AlertEvents)
	}
	if Topics.RuleEvents != "cyber.rule.events" {
		t.Errorf("unexpected RuleEvents: %s", Topics.RuleEvents)
	}
	if Topics.DSPMEvents != "cyber.dspm.events" {
		t.Errorf("unexpected DSPMEvents: %s", Topics.DSPMEvents)
	}
	if Topics.DarkDataEvents != "data.darkdata.events" {
		t.Errorf("unexpected DarkDataEvents: %s", Topics.DarkDataEvents)
	}
	if Topics.VCISOEvents != "cyber.vciso.events" {
		t.Errorf("unexpected VCISOEvents: %s", Topics.VCISOEvents)
	}
}

func TestLegacyTopicConstants(t *testing.T) {
	// Legacy constants should map to new topic names
	if TopicAuditLog != Topics.AuditEvents {
		t.Errorf("TopicAuditLog should equal Topics.AuditEvents: %s != %s", TopicAuditLog, Topics.AuditEvents)
	}
	if TopicUserCreated != Topics.IAMEvents {
		t.Errorf("TopicUserCreated should equal Topics.IAMEvents: %s != %s", TopicUserCreated, Topics.IAMEvents)
	}
	if TopicCyberAlert != Topics.AlertEvents {
		t.Errorf("TopicCyberAlert should equal Topics.AlertEvents: %s != %s", TopicCyberAlert, Topics.AlertEvents)
	}
	if TopicCyberRule != Topics.RuleEvents {
		t.Errorf("TopicCyberRule should equal Topics.RuleEvents: %s != %s", TopicCyberRule, Topics.RuleEvents)
	}
}

func TestDefaultTopicConfigs(t *testing.T) {
	configs := DefaultTopicConfigs()
	if len(configs) != 37 {
		t.Errorf("expected 37 topic configs, got %d", len(configs))
	}

	// Verify DLQ has 30-day retention
	for _, cfg := range configs {
		if cfg.Name == Topics.DeadLetter {
			expected := int64(30 * 24 * 60 * 60 * 1000)
			if cfg.RetentionMs != expected {
				t.Errorf("DLQ retention expected %d, got %d", expected, cfg.RetentionMs)
			}
			if cfg.NumPartitions != 3 {
				t.Errorf("DLQ partitions expected 3, got %d", cfg.NumPartitions)
			}
		}
		if cfg.Name == Topics.AuditEvents {
			expected := int64(90 * 24 * 60 * 60 * 1000)
			if cfg.RetentionMs != expected {
				t.Errorf("Audit retention expected %d, got %d", expected, cfg.RetentionMs)
			}
		}
		if cfg.Name == Topics.MigrateEvents {
			// Migrate lifecycle events: default 6 partitions / RF 3 / 7-day retention.
			if cfg.NumPartitions != 6 {
				t.Errorf("Migrate partitions expected 6, got %d", cfg.NumPartitions)
			}
			if cfg.ReplicationFactor != 3 {
				t.Errorf("Migrate replication factor expected 3, got %d", cfg.ReplicationFactor)
			}
			expected := int64(7 * 24 * 60 * 60 * 1000)
			if cfg.RetentionMs != expected {
				t.Errorf("Migrate retention expected %d, got %d", expected, cfg.RetentionMs)
			}
		}
	}
}
