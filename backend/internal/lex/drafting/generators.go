package drafting

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
)

// ---- tool-schema helpers -------------------------------------------------

func tool(name, desc string, props map[string]any, required ...string) llmmodel.ToolSchema {
	return llmmodel.ToolSchema{
		Name:        name,
		Description: desc,
		Parameters: map[string]any{
			"type":       "object",
			"properties": props,
			"required":   required,
		},
	}
}

func strProp(desc string) map[string]any {
	return map[string]any{"type": "string", "description": desc}
}

func arrProp(desc string, items map[string]any) map[string]any {
	return map[string]any{"type": "array", "description": desc, "items": items}
}

func objItems(props map[string]any, required ...string) map[string]any {
	return map[string]any{"type": "object", "properties": props, "required": required}
}

const baseDraftingSystem = "You are an expert bilingual (Arabic/English) commercial contracts attorney for a Saudi-based legal-operations platform. " +
	"Draft clear, enforceable, balanced language consistent with Saudi law and common GCC commercial practice. " +
	"Be precise and conservative; never invent facts not supplied. Always answer by calling the provided tool with structured fields."

func langLine(lang string) string {
	switch cleanLang(lang) {
	case "ar":
		return "Write the output in Modern Standard Arabic."
	case "en", "":
		return "Write the output in clear English."
	default:
		return "Write the output in " + lang + "."
	}
}

// ---- AID-01: clause generation from plain-language intent -----------------

type ClauseRequest struct {
	Intent       string `json:"intent"`
	ClauseType   string `json:"clause_type,omitempty"`
	ContractType string `json:"contract_type,omitempty"`
	Language     string `json:"language,omitempty"`
	Context      string `json:"context,omitempty"`
}

type GeneratedClause struct {
	Title       string         `json:"title"`
	ClauseType  string         `json:"clause_type"`
	Text        string         `json:"text"`
	Rationale   string         `json:"rationale"`
	RiskLevel   string         `json:"risk_level"`
	Assumptions []string       `json:"assumptions"`
	Language    string         `json:"language"`
	Meta        map[string]any `json:"meta,omitempty"`
}

func (d *Drafter) GenerateClause(ctx context.Context, tenantID uuid.UUID, req ClauseRequest) (*GeneratedClause, error) {
	t := tool("emit_clause", "Emit a single drafted contract clause.",
		map[string]any{
			"title":       strProp("short clause heading"),
			"clause_type": strProp("normalized clause type, e.g. limitation_of_liability"),
			"text":        strProp("the full clause text, ready to paste into a contract"),
			"rationale":   strProp("why the clause is drafted this way"),
			"risk_level":  strProp("one of: low, medium, high"),
			"assumptions": arrProp("assumptions made while drafting", strProp("")),
		}, "title", "text", "risk_level")
	sys := baseDraftingSystem
	user := fmt.Sprintf("Draft a contract clause.\nIntent: %s\nClause type: %s\nContract type: %s\nContext: %s\n%s",
		strings.TrimSpace(req.Intent), orNA(req.ClauseType), orNA(req.ContractType), orNA(d.truncate(req.Context)), langLine(req.Language))
	res, err := d.generate(ctx, tenantID, "lex-drafting-clause", "clause_generation", nil,
		map[string]any{"intent": req.Intent, "clause_type": req.ClauseType, "contract_type": req.ContractType}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out GeneratedClause
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode clause: %w", err)
	}
	out.Language = cleanLang(req.Language)
	out.Meta = res.meta
	return &out, nil
}

// ---- AID-02: full contract auto-draft from template + deal terms ----------

type ContractDraftRequest struct {
	ContractType string         `json:"contract_type"`
	DealTerms    map[string]any `json:"deal_terms"`
	TemplateHint string         `json:"template_hint,omitempty"`
	Language     string         `json:"language,omitempty"`
}

type DraftSection struct {
	Heading string `json:"heading"`
	Body    string `json:"body"`
}

type ContractDraft struct {
	Title     string         `json:"title"`
	Sections  []DraftSection `json:"sections"`
	Summary   string         `json:"summary"`
	OpenItems []string       `json:"open_items"`
	Language  string         `json:"language"`
	Meta      map[string]any `json:"meta,omitempty"`
}

func (d *Drafter) DraftContract(ctx context.Context, tenantID uuid.UUID, req ContractDraftRequest) (*ContractDraft, error) {
	t := tool("emit_contract", "Emit a full contract draft as ordered sections.",
		map[string]any{
			"title": strProp("contract title"),
			"sections": arrProp("ordered contract sections",
				objItems(map[string]any{"heading": strProp("section heading"), "body": strProp("section body text")}, "heading", "body")),
			"summary":    strProp("one-paragraph executive summary"),
			"open_items": arrProp("items that need human/legal decision before signing", strProp("")),
		}, "title", "sections")
	sys := baseDraftingSystem
	user := fmt.Sprintf("Draft a complete %s contract from these deal terms.\nDeal terms: %s\nTemplate guidance: %s\n%s\nInclude standard protective clauses (governing law, dispute resolution, confidentiality, liability, termination) appropriate to the deal.",
		orNA(req.ContractType), jsonish(req.DealTerms), orNA(req.TemplateHint), langLine(req.Language))
	res, err := d.generate(ctx, tenantID, "lex-drafting-contract", "contract_autodraft", nil,
		map[string]any{"contract_type": req.ContractType, "term_count": len(req.DealTerms)}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out ContractDraft
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode contract draft: %w", err)
	}
	if strings.TrimSpace(out.Title) == "" {
		return nil, fmt.Errorf("%w: contract title is empty", ErrInvalidOutput)
	}
	if len(out.Sections) == 0 {
		return nil, fmt.Errorf("%w: contract sections are empty", ErrInvalidOutput)
	}
	for index, section := range out.Sections {
		if strings.TrimSpace(section.Heading) == "" || strings.TrimSpace(section.Body) == "" {
			return nil, fmt.Errorf("%w: contract section %d requires heading and body", ErrInvalidOutput, index+1)
		}
	}
	// Keep the JSON contract stable: optional empty collections are encoded as
	// [] rather than null so every client receives one canonical representation.
	if out.OpenItems == nil {
		out.OpenItems = []string{}
	}
	out.Language = cleanLang(req.Language)
	out.Meta = res.meta
	return &out, nil
}

// ---- AID-03: clause rewrite / tone & risk re-leveling ---------------------

type RewriteRequest struct {
	Text         string `json:"text"`
	TargetTone   string `json:"target_tone,omitempty"`  // e.g. plain, formal, firm
	RiskPosture  string `json:"risk_posture,omitempty"` // favor_us, balanced, favor_counterparty
	Instructions string `json:"instructions,omitempty"`
	Language     string `json:"language,omitempty"`
}

type RewriteChange struct {
	Summary string `json:"summary"`
	Reason  string `json:"reason"`
}

type ClauseRewrite struct {
	RewrittenText string          `json:"rewritten_text"`
	Changes       []RewriteChange `json:"changes"`
	RiskShift     string          `json:"risk_shift"`
	ResidualRisks []string        `json:"residual_risks"`
	Meta          map[string]any  `json:"meta,omitempty"`
}

func (d *Drafter) RewriteClause(ctx context.Context, tenantID uuid.UUID, req RewriteRequest) (*ClauseRewrite, error) {
	t := tool("emit_rewrite", "Emit a rewritten clause with a change log.",
		map[string]any{
			"rewritten_text": strProp("the rewritten clause"),
			"changes": arrProp("material changes made",
				objItems(map[string]any{"summary": strProp("what changed"), "reason": strProp("why")}, "summary")),
			"risk_shift":     strProp("how risk moved, e.g. 'reduced our liability exposure'"),
			"residual_risks": arrProp("risks that remain", strProp("")),
		}, "rewritten_text")
	sys := baseDraftingSystem
	user := fmt.Sprintf("Rewrite the following clause.\nTarget tone: %s\nRisk posture: %s\nInstructions: %s\n%s\n\nCLAUSE:\n%s",
		orDefault(req.TargetTone, "clear and professional"), orDefault(req.RiskPosture, "balanced"),
		orNA(req.Instructions), langLine(req.Language), d.truncate(req.Text))
	res, err := d.generate(ctx, tenantID, "lex-drafting-rewrite", "clause_rewrite", nil,
		map[string]any{"risk_posture": req.RiskPosture, "tone": req.TargetTone}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out ClauseRewrite
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode rewrite: %w", err)
	}
	out.Meta = res.meta
	return &out, nil
}

// ---- AID-04: fallback-clause suggestion during negotiation ----------------

type FallbackRequest struct {
	ClauseText string `json:"clause_text"`
	Position   string `json:"position,omitempty"` // our preferred posture
	Count      int    `json:"count,omitempty"`
	Language   string `json:"language,omitempty"`
}

type FallbackOption struct {
	Label           string `json:"label"`
	Text            string `json:"text"`
	ConcessionLevel string `json:"concession_level"`
	WhenToUse       string `json:"when_to_use"`
}

type FallbackSet struct {
	Fallbacks []FallbackOption `json:"fallbacks"`
	Meta      map[string]any   `json:"meta,omitempty"`
}

func (d *Drafter) SuggestFallbacks(ctx context.Context, tenantID uuid.UUID, req FallbackRequest) (*FallbackSet, error) {
	count := req.Count
	if count <= 0 || count > 6 {
		count = 3
	}
	fallbacksArr := arrProp("graduated fallback options, most-favorable first",
		objItems(map[string]any{
			"label":            strProp("short label"),
			"text":             strProp("the fallback clause text"),
			"concession_level": strProp("one of: minimal, moderate, significant"),
			"when_to_use":      strProp("negotiation context where this is appropriate"),
		}, "text", "concession_level"))
	fallbacksArr["minItems"] = 2
	t := tool("emit_fallbacks", "Emit graduated fallback clause alternatives for negotiation.",
		map[string]any{"fallbacks": fallbacksArr}, "fallbacks")
	sys := baseDraftingSystem
	user := fmt.Sprintf("Propose %d graduated fallback alternatives for the clause below (at least 2), ordered from most favorable to us to most conceding.\nOur preferred position: %s\n%s\n\nCLAUSE:\n%s",
		count, orDefault(req.Position, "balanced"), langLine(req.Language), d.truncate(req.ClauseText))
	res, err := d.generate(ctx, tenantID, "lex-drafting-fallback", "fallback_suggestion", nil,
		map[string]any{"count": count, "position": req.Position}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out FallbackSet
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode fallbacks: %w", err)
	}
	out.Meta = res.meta
	return &out, nil
}

// ---- AID-05: bilingual clause translation with legal-equivalence check -----

type TranslateRequest struct {
	Text       string `json:"text"`
	SourceLang string `json:"source_lang"`
	TargetLang string `json:"target_lang"`
}

type TranslationResult struct {
	Translation string         `json:"translation"`
	Equivalence string         `json:"equivalence"` // equivalent | partial | divergent
	Notes       []string       `json:"notes"`
	Caveats     []string       `json:"caveats"`
	SourceLang  string         `json:"source_lang"`
	TargetLang  string         `json:"target_lang"`
	Meta        map[string]any `json:"meta,omitempty"`
}

func (d *Drafter) Translate(ctx context.Context, tenantID uuid.UUID, req TranslateRequest) (*TranslationResult, error) {
	t := tool("emit_translation", "Emit a legal translation with an equivalence assessment.",
		map[string]any{
			"translation": strProp("the translated text"),
			"equivalence": map[string]any{
				"type":        "string",
				"enum":        []string{"equivalent", "partial", "divergent"},
				"description": "overall legal equivalence of the translation to the source",
			},
			"notes":   arrProp("translation/terminology notes", strProp("")),
			"caveats": arrProp("legal-equivalence caveats the reviewer must check", strProp("")),
		}, "translation", "equivalence")
	sys := baseDraftingSystem + " You are translating legal text and must flag any term whose legal effect does not map cleanly between Arabic and English."
	user := fmt.Sprintf("Translate the legal text from %s to %s and assess legal equivalence. You MUST set the equivalence field to exactly one of: equivalent, partial, divergent.\n\nTEXT:\n%s",
		orDefault(cleanLang(req.SourceLang), "auto"), orDefault(cleanLang(req.TargetLang), "en"), d.truncate(req.Text))
	res, err := d.generate(ctx, tenantID, "lex-drafting-translate", "legal_translation", nil,
		map[string]any{"source": cleanLang(req.SourceLang), "target": cleanLang(req.TargetLang)}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out TranslationResult
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode translation: %w", err)
	}
	out.SourceLang = cleanLang(req.SourceLang)
	out.TargetLang = cleanLang(req.TargetLang)
	out.Meta = res.meta
	return &out, nil
}

// ---- AID-06: auto-summary of long contracts (key-terms brief) -------------

type SummaryRequest struct {
	Text         string `json:"text"`
	ContractType string `json:"contract_type,omitempty"`
	Language     string `json:"language,omitempty"`
}

type KeyTerm struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

type ContractSummary struct {
	ExecutiveSummary string         `json:"executive_summary"`
	KeyTerms         []KeyTerm      `json:"key_terms"`
	Obligations      []string       `json:"obligations"`
	Risks            []string       `json:"risks"`
	RenewalNotes     string         `json:"renewal_notes"`
	Meta             map[string]any `json:"meta,omitempty"`
}

func (d *Drafter) Summarize(ctx context.Context, tenantID uuid.UUID, req SummaryRequest) (*ContractSummary, error) {
	t := tool("emit_summary", "Emit a key-terms brief for a long contract.",
		map[string]any{
			"executive_summary": strProp("2-4 sentence executive summary"),
			"key_terms":         arrProp("key commercial terms", objItems(map[string]any{"label": strProp(""), "value": strProp("")}, "label", "value")),
			"obligations":       arrProp("material obligations", strProp("")),
			"risks":             arrProp("notable risks", strProp("")),
			"renewal_notes":     strProp("renewal/term/expiry notes"),
		}, "executive_summary")
	sys := baseDraftingSystem
	user := fmt.Sprintf("Summarize the following %s contract into a key-terms brief.\n%s\n\nCONTRACT:\n%s",
		orNA(req.ContractType), langLine(req.Language), d.truncate(req.Text))
	res, err := d.generate(ctx, tenantID, "lex-drafting-summary", "contract_summary", nil,
		map[string]any{"contract_type": req.ContractType, "length": len([]rune(req.Text))}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out ContractSummary
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode summary: %w", err)
	}
	out.Meta = res.meta
	return &out, nil
}

// ---- AID-07: defined-term consistency & auto-glossary ---------------------

type GlossaryRequest struct {
	Text     string `json:"text"`
	Language string `json:"language,omitempty"`
}

type GlossaryEntry struct {
	Term       string `json:"term"`
	Definition string `json:"definition"`
}

type TermInconsistency struct {
	Term  string `json:"term"`
	Issue string `json:"issue"`
}

type GlossaryResult struct {
	Glossary        []GlossaryEntry     `json:"glossary"`
	Inconsistencies []TermInconsistency `json:"inconsistencies"`
	Meta            map[string]any      `json:"meta,omitempty"`
}

func (d *Drafter) Glossary(ctx context.Context, tenantID uuid.UUID, req GlossaryRequest) (*GlossaryResult, error) {
	t := tool("emit_glossary", "Emit a defined-term glossary and a list of definition inconsistencies.",
		map[string]any{
			"glossary":        arrProp("defined terms and their definitions", objItems(map[string]any{"term": strProp(""), "definition": strProp("")}, "term", "definition")),
			"inconsistencies": arrProp("defined-term usage problems", objItems(map[string]any{"term": strProp(""), "issue": strProp("")}, "term", "issue")),
		}, "glossary")
	sys := baseDraftingSystem
	user := fmt.Sprintf("Extract every defined term and its definition from the contract below, then list inconsistencies (undefined-but-used terms, terms defined twice, or used with different meaning).\n%s\n\nCONTRACT:\n%s",
		langLine(req.Language), d.truncate(req.Text))
	res, err := d.generate(ctx, tenantID, "lex-drafting-glossary", "glossary_consistency", nil,
		map[string]any{"length": len([]rune(req.Text))}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out GlossaryResult
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode glossary: %w", err)
	}
	out.Meta = res.meta
	return &out, nil
}

// ---- AID-10: AI-assisted RFP / tender response drafting -------------------

type RFPRequest struct {
	Requirements   string `json:"requirements"`
	CompanyProfile string `json:"company_profile,omitempty"`
	Language       string `json:"language,omitempty"`
}

type RFPSection struct {
	Requirement string `json:"requirement"`
	Response    string `json:"response"`
}

type RFPResponse struct {
	Sections []RFPSection   `json:"sections"`
	Summary  string         `json:"summary"`
	Gaps     []string       `json:"gaps"`
	Language string         `json:"language"`
	Meta     map[string]any `json:"meta,omitempty"`
}

func (d *Drafter) DraftRFPResponse(ctx context.Context, tenantID uuid.UUID, req RFPRequest) (*RFPResponse, error) {
	t := tool("emit_rfp_response", "Emit a structured RFP/tender response.",
		map[string]any{
			"sections": arrProp("per-requirement responses", objItems(map[string]any{"requirement": strProp(""), "response": strProp("")}, "requirement", "response")),
			"summary":  strProp("executive summary of the response"),
			"gaps":     arrProp("requirements the company may not meet / needs input on", strProp("")),
		}, "sections")
	sys := baseDraftingSystem + " You are drafting a tender/RFP response."
	user := fmt.Sprintf("Draft a response to the following RFP/tender requirements.\nCompany profile: %s\n%s\n\nREQUIREMENTS:\n%s",
		orNA(d.truncate(req.CompanyProfile)), langLine(req.Language), d.truncate(req.Requirements))
	res, err := d.generate(ctx, tenantID, "lex-drafting-rfp", "rfp_response", nil,
		map[string]any{"has_profile": req.CompanyProfile != ""}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out RFPResponse
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode rfp response: %w", err)
	}
	out.Language = cleanLang(req.Language)
	out.Meta = res.meta
	return &out, nil
}

// ---- AID-11: AI obligation & deadline extraction QA review ----------------

type ObligationQARequest struct {
	ContractText string           `json:"contract_text"`
	Obligations  []map[string]any `json:"obligations"`
}

type ObligationIssue struct {
	ObligationIndex int    `json:"obligation_index"`
	Severity        string `json:"severity"`
	Issue           string `json:"issue"`
	Suggestion      string `json:"suggestion"`
}

type ObligationQAReview struct {
	Issues             []ObligationIssue `json:"issues"`
	OverallConfidence  float64           `json:"overall_confidence"`
	MissingObligations []string          `json:"missing_obligations"`
	Meta               map[string]any    `json:"meta,omitempty"`
}

func (d *Drafter) ReviewObligationExtraction(ctx context.Context, tenantID uuid.UUID, req ObligationQARequest) (*ObligationQAReview, error) {
	t := tool("emit_qa_review", "Emit a QA review of extracted obligations against the source contract.",
		map[string]any{
			"issues": arrProp("problems found with the extracted obligations",
				objItems(map[string]any{
					"obligation_index": map[string]any{"type": "integer", "description": "0-based index into the supplied obligations"},
					"severity":         strProp("one of: info, warning, error"),
					"issue":            strProp("what is wrong"),
					"suggestion":       strProp("how to fix"),
				}, "obligation_index", "severity", "issue")),
			"overall_confidence":  map[string]any{"type": "number", "description": "0..1 confidence the extraction is complete and correct"},
			"missing_obligations": arrProp("obligations present in the contract but absent from the extraction", strProp("")),
		}, "overall_confidence")
	sys := baseDraftingSystem + " You are QA-reviewing an automated obligation extraction. Be skeptical: check dates, parties, and that each obligation is grounded in the contract text."
	user := fmt.Sprintf("Review these extracted obligations against the contract.\n\nEXTRACTED OBLIGATIONS:\n%s\n\nCONTRACT:\n%s",
		jsonish(req.Obligations), d.truncate(req.ContractText))
	res, err := d.generate(ctx, tenantID, "lex-drafting-obligation-qa", "obligation_qa_review", nil,
		map[string]any{"obligation_count": len(req.Obligations)}, sys, user, t)
	if err != nil {
		return nil, err
	}
	var out ObligationQAReview
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode qa review: %w", err)
	}
	out.Meta = res.meta
	return &out, nil
}

// ---- small helpers --------------------------------------------------------

func orNA(s string) string {
	if strings.TrimSpace(s) == "" {
		return "(not provided)"
	}
	return s
}

func orDefault(s, def string) string {
	if strings.TrimSpace(s) == "" {
		return def
	}
	return s
}

func jsonish(v any) string {
	return fmt.Sprintf("%v", v)
}
