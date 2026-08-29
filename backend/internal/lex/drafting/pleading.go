package drafting

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"

	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	provider "github.com/clario360/platform/internal/cyber/vciso/llm/provider"
)

// PleadingMaxOutputTokens is the hard output ceiling for interactive pleading
// generation. A pleading remains long enough for a useful first draft while the
// bounded response keeps an editor interaction materially faster than deep
// contract review.
const PleadingMaxOutputTokens = 2200

const pleadingCounselSystem = "You are a senior Saudi litigation counsel drafting a court pleading for review by a licensed lawyer. " +
	"Use formal, precise judicial language and the structure expected in Saudi court submissions. " +
	"Ground every factual assertion in the supplied case data. Never invent parties, dates, amounts, exhibits, article numbers, judicial precedents, or procedural facts. " +
	"If a material fact or authority is missing, insert a concise, clearly marked review placeholder instead of guessing. " +
	"Distinguish alleged facts from legal conclusions, preserve the stated party position, and make the requested relief specific. " +
	"The draft is attorney work product and must not claim that it has been filed or judicially accepted."

// PleadingDraftRequest contains the litigation facts available to the drafting
// engine. Fields are deliberately plain strings so callers can populate the
// request from a case snapshot without coupling the drafting package to Lex
// persistence models.
type PleadingDraftRequest struct {
	PleadingType    string `json:"pleading_type"`
	Direction       string `json:"direction,omitempty"`
	PleadingTitle   string `json:"pleading_title"`
	CaseNumber      string `json:"case_number,omitempty"`
	CaseType        string `json:"case_type,omitempty"`
	CompanyStatus   string `json:"company_status,omitempty"`
	CaseTitleAR     string `json:"case_title_ar,omitempty"`
	CaseTitleEN     string `json:"case_title_en,omitempty"`
	CaseDescription string `json:"case_description,omitempty"`
	Recipient       string `json:"recipient,omitempty"`
	CourtReference  string `json:"court_reference,omitempty"`
	Instructions    string `json:"instructions,omitempty"`
	Language        string `json:"language,omitempty"`
}

// PleadingSection mirrors the major court-document sections while Body remains
// the canonical, ready-to-edit document persisted by callers.
type PleadingSection struct {
	Heading string `json:"heading"`
	Body    string `json:"body"`
}

// PleadingDraft is a pleading-specific result contract. Body is always the
// complete draft; Sections are optional navigation aids for capable editors.
type PleadingDraft struct {
	Title       string            `json:"title"`
	Body        string            `json:"body"`
	Sections    []PleadingSection `json:"sections,omitempty"`
	ReviewFlags []string          `json:"review_flags,omitempty"`
	Language    string            `json:"language"`
	Meta        map[string]any    `json:"meta,omitempty"`
}

// DraftPleading produces a governed, structured pleading draft using the
// separately configured interactive model. Other Drafter methods continue to
// use the provider's stronger default model and global token budget.
func (d *Drafter) DraftPleading(ctx context.Context, tenantID uuid.UUID, req PleadingDraftRequest) (*PleadingDraft, error) {
	systemPrompt, userPrompt := d.pleadingPrompts(req, true)
	schema := pleadingToolSchema()
	res, err := d.generateWithOptions(
		ctx,
		tenantID,
		"lex-drafting-pleading",
		"litigation_pleading_draft",
		nil,
		map[string]any{
			"pleading_type":  req.PleadingType,
			"direction":      req.Direction,
			"case_type":      req.CaseType,
			"company_status": req.CompanyStatus,
			"language":       cleanLang(req.Language),
		},
		systemPrompt,
		userPrompt,
		schema,
		generationOptions{
			model:     d.cfg.InteractiveModel,
			maxTokens: PleadingMaxOutputTokens,
		},
	)
	if err != nil {
		return nil, err
	}
	var out PleadingDraft
	if err := decodeArgs(res.args, &out); err != nil {
		return nil, fmt.Errorf("decode pleading draft: %w", err)
	}
	if err := normalizePleadingDraft(&out, req.Language); err != nil {
		return nil, err
	}
	out.Meta = res.meta
	return &out, nil
}

// DraftPleadingStream is the low-latency twin of DraftPleading. Streaming
// providers emit the court-ready Body as plain-text deltas; the returned result
// exposes the same canonical Body/Sections/Meta shape. Structured section data
// is optional on this fast path because forcing tool JSON would surface partial
// JSON rather than useful editor text. Providers without streaming support fall
// back to DraftPleading and emit its complete Body in one delta.
func (d *Drafter) DraftPleadingStream(
	ctx context.Context,
	tenantID uuid.UUID,
	req PleadingDraftRequest,
	emit func(delta string),
) (*PleadingDraft, error) {
	if !d.Enabled() {
		return nil, ErrDraftingDisabled
	}
	systemPrompt, userPrompt := d.pleadingPrompts(req, false)
	cctx, cancel := context.WithTimeout(ctx, d.cfg.Timeout)
	defer cancel()

	prov, err := d.resolver.Resolve(cctx, tenantID)
	if err != nil {
		return nil, fmt.Errorf("resolve llm provider: %w", err)
	}
	streamer, ok := prov.(provider.StreamingProvider)
	if !ok {
		out, draftErr := d.DraftPleading(ctx, tenantID, req)
		if draftErr != nil {
			return nil, draftErr
		}
		if emit != nil && out.Body != "" {
			emit(out.Body)
		}
		if out.Meta == nil {
			out.Meta = map[string]any{}
		}
		out.Meta["streamed"] = false
		return out, nil
	}

	var body strings.Builder
	model := strings.TrimSpace(d.cfg.InteractiveModel)
	llmReq := &provider.CompletionRequest{
		SystemPrompt:   systemPrompt,
		Messages:       []llmmodel.LLMMessage{{Role: "user", Content: userPrompt}},
		Model:          model,
		MaxTokens:      PleadingMaxOutputTokens,
		TemperatureSet: false,
		ResponseFormat: "text",
	}
	resp, err := streamer.StreamComplete(cctx, llmReq, provider.StreamHandler{
		OnText: func(delta string) error {
			body.WriteString(delta)
			if emit != nil && delta != "" {
				emit(delta)
			}
			return nil
		},
	})
	if err != nil {
		return nil, fmt.Errorf("llm pleading stream: %w", err)
	}
	text := strings.TrimSpace(body.String())
	if text == "" && resp != nil {
		text = strings.TrimSpace(resp.Content)
	}
	if text == "" {
		return nil, fmt.Errorf("%w: pleading body is empty", ErrInvalidOutput)
	}
	if model == "" {
		model = prov.Model()
	}
	tokens := 0
	if resp != nil {
		tokens = resp.Usage.TotalTokens
	}
	out := &PleadingDraft{
		Title:       strings.TrimSpace(req.PleadingTitle),
		Body:        text,
		Sections:    []PleadingSection{},
		ReviewFlags: []string{},
		Language:    normalizedPleadingLanguage(req.Language),
		Meta: map[string]any{
			"model":    model,
			"provider": prov.Name(),
			"tokens":   tokens,
			"streamed": true,
		},
	}
	return out, nil
}

func pleadingToolSchema() llmmodel.ToolSchema {
	return tool(
		"emit_pleading",
		"Emit a complete litigation pleading ready for attorney review.",
		map[string]any{
			"title": strProp("formal pleading title"),
			"body": strProp(
				"complete court-ready pleading text, including addressee, parties, jurisdiction, facts, legal grounds, requested relief, and closing as applicable",
			),
			"sections": arrProp(
				"ordered major sections mirrored from body for editor navigation",
				objItems(
					map[string]any{
						"heading": strProp("section heading"),
						"body":    strProp("section text"),
					},
					"heading",
					"body",
				),
			),
			"review_flags": arrProp(
				"missing facts, evidence, citations, or procedural choices requiring lawyer review; empty when none",
				strProp(""),
			),
		},
		"title",
		"body",
	)
}

func (d *Drafter) pleadingPrompts(req PleadingDraftRequest, structured bool) (string, string) {
	outputInstruction := "Call the emit_pleading tool and place the complete editable pleading in body."
	if !structured {
		outputInstruction = "Output ONLY the complete pleading body as plain text. Do not add commentary, markdown fences, JSON, or an explanatory preamble."
	}
	system := pleadingCounselSystem + " " + outputInstruction
	user := fmt.Sprintf(
		"Prepare a %s pleading from the following case snapshot.\n"+
			"Pleading direction: %s\n"+
			"Pleading title: %s\n"+
			"Case number: %s\n"+
			"Case type: %s\n"+
			"Company position/status: %s\n"+
			"Case title (Arabic): %s\n"+
			"Case title (English): %s\n"+
			"Recipient/court: %s\n"+
			"Court reference: %s\n"+
			"Case facts and description:\n%s\n\n"+
			"Counsel instructions:\n%s\n\n"+
			"%s\n"+
			"Use an orderly pleading structure appropriate to the pleading type: addressee and party identification; jurisdiction/admissibility where relevant; numbered facts; legal grounds tied only to supplied facts or clearly marked review placeholders; numbered relief requested; and closing/signature placeholder. "+
			"Do not add generic contract clauses.",
		orNA(req.PleadingType),
		orNA(req.Direction),
		orNA(req.PleadingTitle),
		orNA(req.CaseNumber),
		orNA(req.CaseType),
		orNA(req.CompanyStatus),
		orNA(req.CaseTitleAR),
		orNA(req.CaseTitleEN),
		orNA(req.Recipient),
		orNA(req.CourtReference),
		orNA(d.truncate(req.CaseDescription)),
		orNA(d.truncate(req.Instructions)),
		langLine(normalizedPleadingLanguage(req.Language)),
	)
	return system, user
}

func normalizePleadingDraft(out *PleadingDraft, language string) error {
	if out == nil {
		return fmt.Errorf("%w: pleading output is nil", ErrInvalidOutput)
	}
	out.Title = strings.TrimSpace(out.Title)
	out.Body = strings.TrimSpace(out.Body)
	if out.Title == "" {
		return fmt.Errorf("%w: pleading title is empty", ErrInvalidOutput)
	}
	if out.Body == "" {
		return fmt.Errorf("%w: pleading body is empty", ErrInvalidOutput)
	}
	for index := range out.Sections {
		out.Sections[index].Heading = strings.TrimSpace(out.Sections[index].Heading)
		out.Sections[index].Body = strings.TrimSpace(out.Sections[index].Body)
		if out.Sections[index].Heading == "" || out.Sections[index].Body == "" {
			return fmt.Errorf("%w: pleading section %d requires heading and body", ErrInvalidOutput, index+1)
		}
	}
	if out.Sections == nil {
		out.Sections = []PleadingSection{}
	}
	if out.ReviewFlags == nil {
		out.ReviewFlags = []string{}
	}
	out.Language = normalizedPleadingLanguage(language)
	return nil
}

func normalizedPleadingLanguage(language string) string {
	if cleaned := cleanLang(language); cleaned != "" {
		return cleaned
	}
	return "ar"
}
