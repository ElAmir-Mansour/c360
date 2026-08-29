package drafting

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

func TestRunPrompt_DecodesOutput(t *testing.T) {
	fp := &fakeProvider{args: map[string]any{"output": "Dear counterparty, we propose the following terms..."}}
	d := enabledDrafter(fp)
	out, err := d.RunPrompt(context.Background(), uuid.New(), "You are a contracts assistant.", "Draft an intro for Acme.")
	if err != nil {
		t.Fatalf("RunPrompt: %v", err)
	}
	if out.Output == "" {
		t.Fatalf("expected non-empty output")
	}
	// The emit_result tool must have been the one requested.
	if fp.lastReq == nil || len(fp.lastReq.Tools) != 1 || fp.lastReq.Tools[0].Name != "emit_result" {
		t.Fatalf("RunPrompt did not request the emit_result tool: %+v", fp.lastReq)
	}
}

func TestRunPrompt_DisabledReturnsSentinel(t *testing.T) {
	d := NewDrafter(nil, nil, Config{Enabled: false})
	if _, err := d.RunPrompt(context.Background(), uuid.New(), "", "x"); err == nil {
		t.Fatal("expected ErrDraftingDisabled")
	}
}

func TestSubstitute_ResolvesAndReportsMissing(t *testing.T) {
	out, missing := Substitute("Between {{party_a}} and {{party_b}} on {{date}}.", map[string]any{
		"party_a": "Acme", "party_b": "Globex",
	})
	if out != "Between Acme and Globex on {{date}}." {
		t.Fatalf("substitution wrong: %q", out)
	}
	if len(missing) != 1 || missing[0] != "date" {
		t.Fatalf("expected missing=[date], got %v", missing)
	}
}

func TestSubstitute_EmptyVars(t *testing.T) {
	out, missing := Substitute("no placeholders here", nil)
	if out != "no placeholders here" || len(missing) != 0 {
		t.Fatalf("unexpected: out=%q missing=%v", out, missing)
	}
}
