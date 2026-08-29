package copilot

import llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"

// Tool names the LLM may call. They map 1:1 to the real DR tools in Tools.
const (
	toolDRStateSummary     = "dr_state_summary"
	toolBlastRadius        = "blast_radius"
	toolDrillSummary       = "drill_summary"
	toolAttestationSummary = "attestation_summary"
	toolProposeFailover    = "propose_failover"
)

// systemPrompt grounds the copilot: it must answer ONLY from tool results
// (real DR state) and must never claim to have executed or approved anything.
// The single hard safety rule is that propose_failover is a PROPOSAL — the
// copilot surfaces the API call the operator must run; it cannot act.
const systemPrompt = `You are the ClarioDR Recovery Copilot, an expert assistant for disaster-recovery operators.

Ground every answer ONLY in the JSON returned by your tools, which read the live DR control plane. Never invent sites, groups, streams, runs, RPO/RTO numbers, or validation ratios. If a tool returns no data, say so.

Tools available:
- dr_state_summary: system-wide posture (sites, consistency groups, replication streams, live RPO per stream, RPO SLO breaches, recent failover/drill runs). Call this first for broad "how are we doing" questions.
- blast_radius(site_id): the impact of losing one site — the consistency groups it belongs to, every co-member that fails over with it, and the dependent replication streams.
- drill_summary(run_id): the outcome of one failover or drill run — its FSM status, achieved-vs-objective RTO, step audit trail, and attestation if sealed.
- attestation_summary(run_id): the NCA-ready Gate-4 attestation for a run.
- propose_failover(group_id): build a recovery PLAN for a consistency group. This is a PROPOSAL ONLY.

CRITICAL SAFETY RULES:
1. You can NEVER execute or approve a failover. propose_failover only returns a plan plus the exact API call the operator must run. Always tell the operator that initiating the run parks it at AWAITING_APPROVAL and that a human must explicitly approve it before anything executes.
2. Surface every warning from propose_failover (e.g. no validated recovery point, degraded streams) before recommending the operator proceed.
3. Quote concrete numbers from the tools (RPO seconds, RTO seconds, validation ratio) so the operator can verify your answer.

Be concise and operational. When you have enough data, give the final answer without calling more tools.`

// toolSchemas returns the tool definitions advertised to the LLM. The parameter
// schemas are JSON-Schema objects the provider passes through to the model.
func toolSchemas() []llmmodel.ToolSchema {
	return []llmmodel.ToolSchema{
		{
			Name:        toolDRStateSummary,
			Description: "System-wide DR posture: sites, consistency groups, replication streams, live RPO per stream, RPO SLO breaches, and recent failover/drill runs. Takes no arguments.",
			Parameters: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        toolBlastRadius,
			Description: "Impact of losing one protected site: the consistency groups it belongs to, every co-member that fails over with it, and the dependent replication streams.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"site_id": map[string]any{
						"type":        "string",
						"description": "UUID of the protected site to analyse.",
					},
				},
				"required": []string{"site_id"},
			},
		},
		{
			Name:        toolDrillSummary,
			Description: "Outcome of one failover or drill run: FSM status, achieved-vs-objective RTO, step audit trail, and the attestation if one was sealed.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"run_id": map[string]any{
						"type":        "string",
						"description": "UUID of the failover_run.",
					},
				},
				"required": []string{"run_id"},
			},
		},
		{
			Name:        toolAttestationSummary,
			Description: "NCA-ready Gate-4 attestation for a run: RTO objective vs actual, RPO seconds, and validation ratio.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"run_id": map[string]any{
						"type":        "string",
						"description": "UUID of the failover_run.",
					},
				},
				"required": []string{"run_id"},
			},
		},
		{
			Name:        toolProposeFailover,
			Description: "Build a recovery PLAN for a consistency group and return the exact API call the operator must issue. PROPOSAL ONLY — it never executes or approves a failover.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"group_id": map[string]any{
						"type":        "string",
						"description": "UUID of the consistency group to fail over.",
					},
				},
				"required": []string{"group_id"},
			},
		},
	}
}
