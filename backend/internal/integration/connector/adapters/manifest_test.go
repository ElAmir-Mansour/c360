package adapters

import (
	"context"
	"testing"

	"github.com/clario360/platform/internal/integration/connector"
	intmodel "github.com/clario360/platform/internal/integration/model"
)

// TestBuildDefaultRegistry_RegistersAllConnectors verifies the builder registers
// the five client-backed connectors (keyed by their model.IntegrationType) with
// the expected capabilities AND the three pure-SDK connectors (email/pagerduty/
// rest), so the single shared registry both dispatches and config-validates every
// connector. Every registered manifest must be internally valid.
func TestBuildDefaultRegistry_RegistersAllConnectors(t *testing.T) {
	r := BuildDefaultRegistry(Clients{})
	if r.Len() != 8 {
		t.Fatalf("expected 8 connectors, got %d (%v)", r.Len(), r.Types())
	}

	wantCaps := map[string]connector.Capability{
		string(intmodel.IntegrationTypeSlack):      connector.CapabilityNotify,
		string(intmodel.IntegrationTypeTeams):      connector.CapabilityNotify,
		string(intmodel.IntegrationTypeWebhook):    connector.CapabilityNotify,
		string(intmodel.IntegrationTypeJira):       connector.CapabilityTicket,
		string(intmodel.IntegrationTypeServiceNow): connector.CapabilityTicket,
	}
	for typ, caps := range wantCaps {
		c, ok := r.Get(typ)
		if !ok {
			t.Fatalf("connector %q not registered", typ)
		}
		m := c.Manifest()
		if m.Type != typ {
			t.Errorf("connector %q manifest.Type = %q", typ, m.Type)
		}
		if m.Capabilities != caps {
			t.Errorf("connector %q capabilities = %q, want %q", typ, m.Capabilities, caps)
		}
		if err := m.Validate(); err != nil {
			t.Errorf("connector %q manifest invalid: %v", typ, err)
		}
	}

	// The three new connectors must be registered, notify-capable, valid, and
	// self-testing — proving they are reachable through the same registry.
	for _, typ := range []string{
		string(intmodel.IntegrationTypeEmail),
		string(intmodel.IntegrationTypePagerDuty),
		string(intmodel.IntegrationTypeREST),
	} {
		c, ok := r.Get(typ)
		if !ok {
			t.Fatalf("new connector %q not registered", typ)
		}
		m := c.Manifest()
		if m.Type != typ {
			t.Errorf("new connector %q manifest.Type = %q", typ, m.Type)
		}
		if !m.Capabilities.CanNotify() {
			t.Errorf("new connector %q should be notify-capable, got %q", typ, m.Capabilities)
		}
		if err := m.Validate(); err != nil {
			t.Errorf("new connector %q manifest invalid: %v", typ, err)
		}
		if _, ok := c.(connector.Tester); !ok {
			t.Errorf("new connector %q should implement Tester", typ)
		}
	}

	// Ticket connectors must implement TicketConnector; notify ones must not.
	for _, typ := range []string{string(intmodel.IntegrationTypeJira), string(intmodel.IntegrationTypeServiceNow)} {
		c, _ := r.Get(typ)
		if _, ok := c.(connector.TicketConnector); !ok {
			t.Errorf("%q should implement TicketConnector", typ)
		}
	}
	for _, typ := range []string{string(intmodel.IntegrationTypeSlack), string(intmodel.IntegrationTypeTeams), string(intmodel.IntegrationTypeWebhook)} {
		c, _ := r.Get(typ)
		if _, ok := c.(connector.TicketConnector); ok {
			t.Errorf("%q should NOT implement TicketConnector", typ)
		}
		if _, ok := c.(connector.Tester); !ok {
			t.Errorf("%q should implement Tester", typ)
		}
	}
}

// TestSlackValidate covers the required-field and OR-rule semantics, matching the
// legacy NormalizeAndValidateConfig for Slack.
func TestSlackValidate(t *testing.T) {
	a := NewSlackAdapter(nil) // ValidateConfig never touches the client.
	cases := []struct {
		name    string
		cfg     map[string]any
		wantErr bool
	}{
		{"valid with channel", map[string]any{"bot_token": "xoxb", "channel_id": "C1"}, false},
		{"valid with webhook url", map[string]any{"bot_token": "xoxb", "incoming_webhook_url": "https://hooks"}, false},
		{"missing bot_token", map[string]any{"channel_id": "C1"}, true},
		{"missing both targets", map[string]any{"bot_token": "xoxb"}, true},
		{"blank channel and blank url", map[string]any{"bot_token": "xoxb", "channel_id": "  ", "incoming_webhook_url": ""}, true},
		{"wrong type bot_token", map[string]any{"bot_token": 123, "channel_id": "C1"}, true},
		{"unknown field tolerated", map[string]any{"bot_token": "xoxb", "channel_id": "C1", "future_flag": "x"}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := a.ValidateConfig(tc.cfg)
			if (err != nil) != tc.wantErr {
				t.Fatalf("ValidateConfig(%v) err=%v wantErr=%v", tc.cfg, err, tc.wantErr)
			}
		})
	}
}

func TestTeamsValidate(t *testing.T) {
	a := NewTeamsAdapter(nil)
	full := map[string]any{"bot_app_id": "a", "bot_password": "p", "service_url": "https://s", "conversation_id": "c"}
	if err := a.ValidateConfig(full); err != nil {
		t.Fatalf("valid teams config rejected: %v", err)
	}
	for _, missing := range []string{"bot_app_id", "bot_password", "service_url", "conversation_id"} {
		cfg := map[string]any{}
		for k, v := range full {
			if k != missing {
				cfg[k] = v
			}
		}
		if err := a.ValidateConfig(cfg); err == nil {
			t.Errorf("expected error when %q missing", missing)
		}
	}
}

func TestWebhookValidateAndDefaults(t *testing.T) {
	a := NewWebhookAdapter(nil)
	if err := a.ValidateConfig(map[string]any{"url": "https://recv"}); err != nil {
		t.Fatalf("valid webhook config rejected: %v", err)
	}
	if err := a.ValidateConfig(map[string]any{}); err == nil {
		t.Error("expected error for missing url")
	}

	// ApplyDefaults must materialize the legacy normalized shape.
	out := connector.ApplyDefaults(webhookManifest().ConfigSchema, map[string]any{"url": "https://recv"})
	if out["method"] != "POST" {
		t.Errorf("method default = %v, want POST", out["method"])
	}
	if out["content_type"] != "application/json" {
		t.Errorf("content_type default = %v, want application/json", out["content_type"])
	}
	if _, ok := out["headers"]; !ok {
		t.Error("headers default not applied")
	}
	// Existing non-empty values are preserved.
	out2 := connector.ApplyDefaults(webhookManifest().ConfigSchema, map[string]any{"url": "https://recv", "method": "PUT"})
	if out2["method"] != "PUT" {
		t.Errorf("method overwritten: %v", out2["method"])
	}
}

func TestJiraValidate(t *testing.T) {
	a := NewJiraAdapter(nil)
	cases := []struct {
		name    string
		cfg     map[string]any
		wantErr bool
	}{
		{"valid auth_token", map[string]any{"base_url": "https://j", "project_key": "SEC", "auth_token": "t"}, false},
		{"valid refresh_token", map[string]any{"base_url": "https://j", "project_key": "SEC", "refresh_token": "r"}, false},
		{"missing base_url", map[string]any{"project_key": "SEC", "auth_token": "t"}, true},
		{"missing project_key", map[string]any{"base_url": "https://j", "auth_token": "t"}, true},
		{"missing both tokens", map[string]any{"base_url": "https://j", "project_key": "SEC"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := a.ValidateConfig(tc.cfg)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err=%v wantErr=%v", err, tc.wantErr)
			}
		})
	}
}

func TestServiceNowValidate(t *testing.T) {
	a := NewServiceNowAdapter(nil)
	cases := []struct {
		name    string
		cfg     map[string]any
		wantErr bool
	}{
		{"basic valid", map[string]any{"instance_url": "https://sn", "auth_type": "basic", "username": "u", "password": "p"}, false},
		{"basic default (no auth_type)", map[string]any{"instance_url": "https://sn", "username": "u", "password": "p"}, false},
		{"oauth valid", map[string]any{"instance_url": "https://sn", "auth_type": "oauth", "oauth_token": "tok"}, false},
		{"missing instance_url", map[string]any{"auth_type": "basic", "username": "u", "password": "p"}, true},
		{"basic missing password", map[string]any{"instance_url": "https://sn", "auth_type": "basic", "username": "u"}, true},
		{"oauth missing token", map[string]any{"instance_url": "https://sn", "auth_type": "oauth"}, true},
		{"bad auth_type enum", map[string]any{"instance_url": "https://sn", "auth_type": "kerberos", "username": "u", "password": "p"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := a.ValidateConfig(tc.cfg)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err=%v wantErr=%v", err, tc.wantErr)
			}
		})
	}
}

// TestTicketAdapters_SendRejected confirms ticket connectors refuse the notify
// Send path (delivery routes them through CreateFromEntity).
func TestTicketAdapters_SendRejected(t *testing.T) {
	jiraAd := NewJiraAdapter(nil)
	if _, err := jiraAd.Send(context.Background(), map[string]any{}, nil); err == nil {
		t.Error("jira Send should be rejected")
	}
	snAd := NewServiceNowAdapter(nil)
	if _, err := snAd.Send(context.Background(), map[string]any{}, nil); err == nil {
		t.Error("servicenow Send should be rejected")
	}
}

// TestTicketAdapters_RequireIntegration confirms CreateFromEntity fails clearly
// when no integration was attached to the context (a wiring bug), rather than
// panicking or silently mis-creating a link.
func TestTicketAdapters_RequireIntegration(t *testing.T) {
	jiraAd := NewJiraAdapter(nil)
	if _, err := jiraAd.CreateFromEntity(context.Background(), map[string]any{"base_url": "x", "project_key": "K", "auth_token": "t"}, "tok", "alert", "1"); err == nil {
		t.Error("jira CreateFromEntity without integration should error")
	}
	snAd := NewServiceNowAdapter(nil)
	if _, err := snAd.CreateFromEntity(context.Background(), map[string]any{}, "tok", "alert", "1"); err == nil {
		t.Error("servicenow CreateFromEntity without integration should error")
	}
}
