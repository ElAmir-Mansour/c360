package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/analyzer/llm"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// These tests exercise the exact draft-building chain ExtractFromContract uses
// to turn LLM-suggested obligations into committable drafts:
//
//	detItems := buildExtractionItems(contract, req)
//	merged   := llm.MergeObligations(detItems, llmItems)
//	drafts,_ := draftsFromItems(contract, req, merged, now)
//	for _, d := range drafts { s.Create(...) }  // persistence (DB) path
//
// They prove the LLM path produces valid CreateObligationRequest drafts that the
// unchanged s.Create loop commits, without a database or a real LLM. The DB-bound
// s.Create / event-publish steps are covered by integration tests; here we assert
// every draft is well-formed enough to pass validateObligationCreate (what
// s.Create runs first), so a committed obligation is guaranteed for each draft.

func hybridExtractionContract() *model.Contract {
	return &model.Contract{
		ID:             uuid.MustParse("cccccccc-cccc-cccc-cccc-cccccccccccc"),
		TenantID:       uuid.MustParse("dddddddd-dddd-dddd-dddd-dddddddddddd"),
		Title:          "Hybrid Obligation Contract",
		Type:           model.ContractTypeServiceAgreement,
		CurrentVersion: 4,
		DocumentText:   "Section 8. Vendor shall pay the invoice by 2026-10-15.",
	}
}

// llmObligationItem mirrors what enricher.SuggestObligations returns after
// decode (Source="llm" with the extraction.llm_confidence metadata MergeObligations
// keys on).
func llmObligationItem(title string, due time.Time, conf float64) dto.ObligationExtractionItem {
	d := due
	return dto.ObligationExtractionItem{
		Title:    title,
		Type:     model.ObligationTypePayment,
		Priority: model.LegalPriorityHigh,
		DueDate:  &d,
		Source:   "llm",
		Metadata: map[string]any{
			"extraction": map[string]any{"deterministic": false, "llm_confidence": conf},
		},
	}
}

// TestExtractionChain_LLMItemsBecomeCommittableDrafts proves a net-new, high
// confidence LLM obligation is merged with the deterministic items and produces
// a valid draft (one that s.Create would persist and emit an event for).
func TestExtractionChain_LLMItemsBecomeCommittableDrafts(t *testing.T) {
	contract := hybridExtractionContract()
	ownerID := uuid.New()
	detDue := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)
	includeRenewal := false
	req := dto.ExtractObligationsRequest{
		OwnerUserID:            ownerID,
		OwnerName:              "Contract Owner",
		IncludeContractRenewal: &includeRenewal,
		Items: []dto.ObligationExtractionItem{{
			Title:    "Submit quarterly report",
			Type:     model.ObligationTypeReporting,
			Priority: model.LegalPriorityMedium,
			DueDate:  &detDue,
			Source:   "analysis_clause",
		}},
	}
	req.Normalize()

	// Deterministic baseline (what the service computes first).
	detItems := buildExtractionItems(contract, req)
	if len(detItems) != 1 {
		t.Fatalf("deterministic items = %d, want 1", len(detItems))
	}

	// LLM suggestions (what enricher.SuggestObligations would return).
	llmDue := time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC)
	llmItems := []dto.ObligationExtractionItem{
		llmObligationItem("Pay invoice", llmDue, 0.85), // net-new, high conf -> kept
	}

	merged := llm.MergeObligations(detItems, llmItems)
	if len(merged) != 2 {
		t.Fatalf("merged items = %d, want 2 (det + llm)", len(merged))
	}

	// This is the same condition ExtractFromContract uses to flip the strategy.
	if len(merged) <= len(detItems) {
		t.Fatal("merge did not add net-new LLM item; strategy would stay deterministic")
	}

	committedAt := time.Date(2026, 6, 14, 9, 0, 0, 0, time.UTC)
	drafts, skipped := draftsFromItems(contract, req, merged, committedAt)
	if len(skipped) != 0 {
		t.Fatalf("skipped = %#v, want none", skipped)
	}
	if len(drafts) != 2 {
		t.Fatalf("drafts = %d, want 2", len(drafts))
	}

	// Every draft must pass the validation s.Create runs before persisting, so a
	// committed obligation is guaranteed for each.
	for i, draft := range drafts {
		if err := validateObligationCreate(draft); err != nil {
			t.Fatalf("draft[%d] would fail s.Create validation: %v", i, err)
		}
		if draft.ContractID == nil || *draft.ContractID != contract.ID {
			t.Fatalf("draft[%d] contract_id = %v, want %s", i, draft.ContractID, contract.ID)
		}
		if draft.OwnerUserID != ownerID {
			t.Fatalf("draft[%d] owner = %s, want %s", i, draft.OwnerUserID, ownerID)
		}
		if draft.Status != model.ObligationStatusOpen {
			t.Fatalf("draft[%d] status = %s, want open", i, draft.Status)
		}
	}

	// Locate the LLM-sourced draft and assert it is stamped as hybrid/non-deterministic.
	var llmDraft *dto.CreateObligationRequest
	for i := range drafts {
		if drafts[i].Title == "Pay invoice" {
			llmDraft = &drafts[i]
		}
	}
	if llmDraft == nil {
		t.Fatal("LLM-sourced 'Pay invoice' draft not found among committable drafts")
	}
	extraction, ok := llmDraft.Metadata["extraction"].(map[string]any)
	if !ok {
		t.Fatalf("llm draft extraction metadata missing: %#v", llmDraft.Metadata)
	}
	if extraction["deterministic"] != false {
		t.Fatalf("llm draft deterministic = %v, want false", extraction["deterministic"])
	}
	if extraction["extraction_strategy"] != "hybrid_llm_enriched" {
		t.Fatalf("llm draft strategy = %v, want hybrid_llm_enriched", extraction["extraction_strategy"])
	}
	if extraction["source"] != "llm" {
		t.Fatalf("llm draft source = %v, want llm", extraction["source"])
	}
	if conf, _ := extraction["llm_confidence"].(float64); conf != 0.85 {
		t.Fatalf("llm draft confidence = %v, want 0.85", extraction["llm_confidence"])
	}

	// The deterministic draft must stay stamped deterministic (det wins).
	for _, draft := range drafts {
		if draft.Title != "Submit quarterly report" {
			continue
		}
		ext := draft.Metadata["extraction"].(map[string]any)
		if ext["deterministic"] != true {
			t.Fatalf("deterministic draft mislabeled: %v", ext["deterministic"])
		}
	}
}

// TestExtractionChain_LLMDuplicateAndLowConfidenceDropped proves the merge keeps
// the deterministic item on a duplicate and drops a below-threshold LLM item, so
// no extra draft is committed in either case.
func TestExtractionChain_LLMDuplicateAndLowConfidenceDropped(t *testing.T) {
	contract := hybridExtractionContract()
	ownerID := uuid.New()
	due := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	includeRenewal := false
	req := dto.ExtractObligationsRequest{
		OwnerUserID:            ownerID,
		OwnerName:              "Contract Owner",
		IncludeContractRenewal: &includeRenewal,
		Items: []dto.ObligationExtractionItem{{
			Title:    "Submit report",
			Type:     model.ObligationTypeReporting,
			Priority: model.LegalPriorityMedium,
			DueDate:  &due,
			Source:   "payload",
		}},
	}
	req.Normalize()

	detItems := buildExtractionItems(contract, req)
	llmItems := []dto.ObligationExtractionItem{
		llmObligationItem("Submit report", due, 0.95),                                                // duplicate (title+due) -> dropped, det wins
		llmObligationItem("Low confidence thing", time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC), 0.4), // below 0.6 -> dropped
	}

	merged := llm.MergeObligations(detItems, llmItems)
	if len(merged) != 1 {
		t.Fatalf("merged = %d, want 1 (dup + low-conf dropped)", len(merged))
	}
	// Strategy would remain deterministic because merge added nothing.
	if len(merged) > len(detItems) {
		t.Fatalf("merge unexpectedly added items: %d > %d", len(merged), len(detItems))
	}

	drafts, skipped := draftsFromItems(contract, req, merged, time.Now().UTC())
	if len(skipped) != 0 || len(drafts) != 1 {
		t.Fatalf("drafts=%d skipped=%d, want 1/0", len(drafts), len(skipped))
	}
	if drafts[0].Title != "Submit report" {
		t.Fatalf("surviving draft = %q, want deterministic 'Submit report'", drafts[0].Title)
	}
	ext := drafts[0].Metadata["extraction"].(map[string]any)
	if ext["deterministic"] != true {
		t.Fatalf("surviving draft should be deterministic, got %v", ext["deterministic"])
	}
}

// TestExtractionChain_MalformedLLMItemSkipped proves a malformed LLM item that
// somehow survives the enricher decode (e.g. missing due date) is skipped by the
// existing draftsFromItems validation and never committed.
func TestExtractionChain_MalformedLLMItemSkipped(t *testing.T) {
	contract := hybridExtractionContract()
	ownerID := uuid.New()
	includeRenewal := false
	req := dto.ExtractObligationsRequest{
		OwnerUserID:            ownerID,
		OwnerName:              "Contract Owner",
		IncludeContractRenewal: &includeRenewal,
	}
	req.Normalize()

	// An LLM item without a due date. MergeObligations does not require a due date
	// (it keys on title|due), so it reaches draftsFromItems, which must skip it.
	malformed := dto.ObligationExtractionItem{
		Title:  "No due date obligation",
		Source: "llm",
		Metadata: map[string]any{
			"extraction": map[string]any{"deterministic": false, "llm_confidence": 0.9},
		},
	}
	merged := llm.MergeObligations(nil, []dto.ObligationExtractionItem{malformed})

	drafts, skipped := draftsFromItems(contract, req, merged, time.Now().UTC())
	if len(drafts) != 0 {
		t.Fatalf("drafts = %d, want 0 (malformed must not be committed)", len(drafts))
	}
	if len(skipped) != 1 || skipped[0].Reason != "due_date is required" {
		t.Fatalf("skipped = %#v, want one due_date skip", skipped)
	}
	if skipped[0].Source != "llm" {
		t.Fatalf("skip source = %q, want llm", skipped[0].Source)
	}
}
