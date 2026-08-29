package drafting

import (
	"context"
	"fmt"
	"sort"

	"github.com/google/uuid"
)

// AID-09 prompt-library run + variable substitution.

// PromptRunResult is the output of running a saved prompt template.
type PromptRunResult struct {
	Output string         `json:"output"`
	Meta   map[string]any `json:"meta,omitempty"`
}

// RunPrompt executes a fully-substituted prompt against the governed per-tenant
// LLM and returns the generated text. It uses a single structured "emit_result"
// tool so the output is reliably captured.
func (d *Drafter) RunPrompt(ctx context.Context, tenantID uuid.UUID, systemPrompt, userPrompt string) (*PromptRunResult, error) {
	t := tool("emit_result", "Emit the completed output for the prompt.",
		map[string]any{"output": strProp("the full generated output text")}, "output")
	sys := systemPrompt
	if sys == "" {
		sys = baseDraftingSystem
	}
	res, err := d.generate(ctx, tenantID, "lex-drafting-prompt", "prompt_library_run", nil,
		map[string]any{"has_system": systemPrompt != ""}, sys, userPrompt, t)
	if err != nil {
		return nil, err
	}
	var out struct {
		Output string `json:"output"`
	}
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode prompt result: %w", err)
	}
	return &PromptRunResult{Output: out.Output, Meta: res.meta}, nil
}

// Substitute replaces {{placeholder}} tokens in text using vars and returns the
// result plus the sorted list of placeholders that had no binding. It reuses the
// same deterministic substitution as template assembly (AID-08).
func Substitute(text string, vars map[string]any) (string, []string) {
	if vars == nil {
		vars = map[string]any{}
	}
	unresolved := map[string]struct{}{}
	out := substitute(text, vars, unresolved)
	keys := make([]string, 0, len(unresolved))
	for k := range unresolved {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return out, keys
}
