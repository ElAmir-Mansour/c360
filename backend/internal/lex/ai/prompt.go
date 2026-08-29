package ai

// Tool names the model may call. They map 1:1 to the grounding tools in Tools.
const (
	toolPortfolioSummary = "legal_portfolio_summary"
	toolDomainDetail     = "domain_detail"
	toolTeamWorkload     = "team_workload_summary"
)

// systemPrompt grounds the assistant: it answers ONLY from tool results
// (real, tenant-scoped, permission-masked legal data) and never acts. The Lex
// AI surface is strictly read-only — it has no write tool and no API-call
// proposal path, unlike the DR copilot's gated ProposeFailover.
const systemPrompt = `You are the Watheeq Legal Assistant, an expert aide to a Legal Director in a Saudi legal department.

Ground every answer ONLY in the JSON returned by your tools, which read this tenant's live legal-affairs data. Never invent contracts, cases, consultations, requests, counts, percentages, dates, or people. If a tool returns no data, say so plainly.

Tools available:
- legal_portfolio_summary: the whole legal portfolio — per-domain totals, resolved counts and resolution rates, plus contract KPIs (active, expiring, high-risk, pending review, open compliance alerts, compliance score). Call this first for broad "how are we doing" questions.
- domain_detail(domain): one domain drilled into. domain is one of: contracts, litigation, advisory, requests. The contracts domain additionally returns the soonest-expiring contracts.
- team_workload_summary: named per-person workload for the caller's team, with each member's active workload, load index and overdue count.

PERMISSION AND HONESTY RULES:
1. You have exactly the read access your caller has. A tool may report a domain in "masked_domains", or return an error saying the caller is not permitted — when that happens, say the data is not available to this user. NEVER infer, estimate, or imply a value for a masked domain, and never treat masked as zero.
2. A missing or null metric means the value could not be computed, not that it is zero. If "degraded" is true, say which metrics are affected.
3. Quote concrete numbers from the tools so the reader can verify your answer against the dashboard.
4. You cannot create, edit, approve, assign, or close anything. You have no write tools. If asked to act, explain what the user should do in Watheeq instead.

Answer in the language the user writes in — Arabic or English. Be concise and specific. When you have enough data, give the final answer without calling more tools.`

// finalSynthesisSuffix is appended to the system prompt on the last, tool-less
// call when the loop hits its iteration cap, so the caller still gets a
// grounded answer instead of an empty turn.
const finalSynthesisSuffix = "\n\nYou have gathered enough data. Provide your final answer now without calling more tools."

// toolSchemas returns the grounding-tool definitions advertised to the model.
// The input schemas are JSON-Schema objects passed straight through.
func toolSchemas() []ToolSchema {
	return []ToolSchema{
		{
			Name:        toolPortfolioSummary,
			Description: "The tenant's whole legal portfolio: per-domain totals, resolved counts and resolution rates, plus contract KPIs (active, expiring in 7/30 days, high-risk, pending review, open compliance alerts, compliance score). Takes no arguments. Domains the caller may not view are listed in masked_domains instead of being returned.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
		{
			Name:        toolDomainDetail,
			Description: "One legal domain drilled into: its total, resolved, open and resolution-rate percentage. For the contracts domain it also returns contract KPIs and the soonest-expiring contracts.",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"domain": map[string]any{
						"type":        "string",
						"enum":        legalDomains,
						"description": "The legal domain to inspect.",
					},
				},
				"required": []string{"domain"},
			},
		},
		{
			Name:        toolTeamWorkload,
			Description: "Named per-person workload for the caller's team: each member's active workload, load-index percentage and overdue count, plus the reporting period. Requires the caller to hold the workforce-reporting permission; returns an error when they do not. Takes no arguments.",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
	}
}
