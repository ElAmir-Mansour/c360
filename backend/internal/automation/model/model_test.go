package model

import (
	"errors"
	"testing"
	"time"
)

func TestTriggerConfig_Validate(t *testing.T) {
	tests := []struct {
		name    string
		tc      TriggerConfig
		wantErr bool
	}{
		{"event ok", TriggerConfig{Type: TriggerTypeEvent, Topic: "platform.iam.events"}, false},
		{"event missing topic", TriggerConfig{Type: TriggerTypeEvent}, true},
		{"schedule ok", TriggerConfig{Type: TriggerTypeSchedule, Cron: "0 * * * *"}, false},
		{"schedule missing cron", TriggerConfig{Type: TriggerTypeSchedule}, true},
		{"threshold ok", TriggerConfig{Type: TriggerTypeThreshold, Topic: "cyber.alert.events", ThresholdField: "data.severity_score", ThresholdOp: ThresholdOpGTE, ThresholdValue: 8}, false},
		{"threshold missing topic", TriggerConfig{Type: TriggerTypeThreshold, ThresholdField: "x", ThresholdOp: ThresholdOpGT}, true},
		{"threshold missing field", TriggerConfig{Type: TriggerTypeThreshold, Topic: "t", ThresholdOp: ThresholdOpGT}, true},
		{"threshold bad op", TriggerConfig{Type: TriggerTypeThreshold, Topic: "t", ThresholdField: "f", ThresholdOp: "approx"}, true},
		{"webhook ok", TriggerConfig{Type: TriggerTypeWebhook, WebhookToken: "tok"}, false},
		{"webhook missing token", TriggerConfig{Type: TriggerTypeWebhook}, true},
		{"manual ok", TriggerConfig{Type: TriggerTypeManual}, false},
		{"unknown type", TriggerConfig{Type: "magic"}, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.tc.Validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
			if err != nil && !errors.Is(err, ErrInvalidConfig) {
				t.Fatalf("Validate() error %v should wrap ErrInvalidConfig", err)
			}
		})
	}
}

func TestActionRef_Validate(t *testing.T) {
	tests := []struct {
		name    string
		kind    string
		wantErr bool
	}{
		{"start_workflow", ActionStartWorkflow, false},
		{"integration", ActionIntegration, false},
		{"notification", ActionNotification, false},
		{"dr_runbook", ActionDRRunbook, false},
		{"http_call", ActionHTTPCall, false},
		{"unknown", "delete_everything", true},
		{"empty", "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ActionRef{Kind: tt.kind}.Validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestRun_IsTerminal(t *testing.T) {
	terminal := []string{RunStatusCompleted, RunStatusFailed, RunStatusAborted, RunStatusCancelled}
	for _, s := range terminal {
		if !(&Run{Status: s}).IsTerminal() {
			t.Errorf("status %s should be terminal", s)
		}
	}
	nonTerminal := []string{RunStatusPending, RunStatusRunning, RunStatusAwaitingApproval, RunStatusEscalated}
	for _, s := range nonTerminal {
		if (&Run{Status: s}).IsTerminal() {
			t.Errorf("status %s should not be terminal", s)
		}
	}
}

func TestRun_IsRunnable(t *testing.T) {
	runnable := []string{RunStatusPending, RunStatusRunning}
	for _, s := range runnable {
		if !(&Run{Status: s}).IsRunnable() {
			t.Errorf("status %s should be runnable", s)
		}
	}
	// The gate-parked and terminal states must NOT be runnable — the driver's
	// claim query excludes them (§6: the gate never auto-advances).
	notRunnable := []string{
		RunStatusAwaitingApproval, RunStatusEscalated,
		RunStatusCompleted, RunStatusFailed, RunStatusAborted, RunStatusCancelled,
	}
	for _, s := range notRunnable {
		if (&Run{Status: s}).IsRunnable() {
			t.Errorf("status %s should not be runnable", s)
		}
	}
}

func TestRun_IsReplayable(t *testing.T) {
	replayable := []string{RunStatusCompleted, RunStatusFailed, RunStatusAborted}
	for _, s := range replayable {
		if !(&Run{Status: s}).IsReplayable() {
			t.Errorf("status %s should be replayable", s)
		}
	}
	notReplayable := []string{RunStatusPending, RunStatusRunning, RunStatusAwaitingApproval, RunStatusCancelled}
	for _, s := range notReplayable {
		if (&Run{Status: s}).IsReplayable() {
			t.Errorf("status %s should not be replayable", s)
		}
	}
}

func TestApprovalGate_Quorum(t *testing.T) {
	now := time.Now()
	g := &ApprovalGate{
		Quorum: 2,
		Decisions: []Decision{
			{UserID: "u1", Approved: true, DecidedAt: now},
			{UserID: "u2", Approved: true, DecidedAt: now},
		},
	}
	if got := g.Approvals(); got != 2 {
		t.Fatalf("Approvals() = %d, want 2", got)
	}
	if !g.QuorumMet() {
		t.Fatal("QuorumMet() = false, want true")
	}
	if g.HasRejection() {
		t.Fatal("HasRejection() = true, want false")
	}

	// One approval short of quorum.
	g2 := &ApprovalGate{Quorum: 3, Decisions: []Decision{{UserID: "u1", Approved: true}}}
	if g2.QuorumMet() {
		t.Fatal("QuorumMet() = true with 1/3, want false")
	}

	// A rejection is detected.
	g3 := &ApprovalGate{Quorum: 1, Decisions: []Decision{{UserID: "u1", Approved: false}}}
	if !g3.HasRejection() {
		t.Fatal("HasRejection() = false, want true")
	}
	if g3.QuorumMet() {
		t.Fatal("QuorumMet() = true with only a rejection, want false")
	}

	// Quorum of 0 is treated as 1.
	g4 := &ApprovalGate{Quorum: 0, Decisions: []Decision{{UserID: "u1", Approved: true}}}
	if !g4.QuorumMet() {
		t.Fatal("QuorumMet() = false for quorum 0 with 1 approval, want true")
	}
}

func TestValidTimeoutActions(t *testing.T) {
	for _, a := range []string{TimeoutActionAbort, TimeoutActionEscalate, TimeoutActionAutoApprove} {
		if !ValidTimeoutActions[a] {
			t.Errorf("timeout action %s should be valid", a)
		}
	}
	if ValidTimeoutActions["ignore"] {
		t.Error("unknown timeout action should not be valid")
	}
}
