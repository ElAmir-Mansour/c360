//go:build integration

package integration

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestContractRenewalWarningsAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	now := time.Now().UTC()
	expiryOnlyDate := now.AddDate(0, 0, 24)
	expiryOnlyID := h.insertActiveContractFixture(t, ctx, "Expiry Only Warning", &expiryOnlyDate, nil, 45)
	renewalOnlyDate := now.AddDate(0, 0, 12)
	renewalOnlyID := h.insertActiveContractFixture(t, ctx, "Renewal Only Warning", nil, &renewalOnlyDate, 30)
	farExpiry := now.AddDate(0, 0, 180)
	renewalSoon := now.AddDate(0, 0, 18)
	renewalBeforeExpiryID := h.insertActiveContractFixture(t, ctx, "Renewal Before Far Expiry", &farExpiry, &renewalSoon, 30)
	for i := 0; i < 205; i++ {
		expiry := now.AddDate(0, 0, 20+(i%5))
		h.insertActiveContractFixture(t, ctx, fmt.Sprintf("Bulk Renewal Warning %03d", i), &expiry, nil, 30)
	}

	summary := mustData[model.ContractRenewalWarningSummary](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/contracts/renewal-warnings?horizon_days=60&lead_days=30", nil), http.StatusOK)
	if summary.Total < 208 {
		t.Fatalf("renewal warning total = %d, want at least 208 to prove route is not capped at 200", summary.Total)
	}
	for _, contractID := range []uuid.UUID{expiryOnlyID, renewalOnlyID, renewalBeforeExpiryID} {
		if !renewalSummaryContains(summary, contractID) {
			t.Fatalf("renewal warnings missing contract %s in %+v", contractID, summary.Items)
		}
	}

	aliasSummary := mustData[model.ContractRenewalWarningSummary](t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/contracts/renewal-warnings?horizon_days=60&lead_days=30", nil), http.StatusOK)
	if aliasSummary.Total != summary.Total {
		t.Fatalf("watheeq alias total = %d, want %d", aliasSummary.Total, summary.Total)
	}

	readOnly := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "viewer"))
	expectStatus(t, readOnly.doJSON(t, http.MethodGet, "/api/v1/lex/contracts/renewal-warnings", nil), http.StatusOK)
}

func TestContractClassifyAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Unclassified Agreement", model.ContractTypeOther, 100000, "Generic placeholder document.")

	preview := mustData[model.ContractClassificationResult](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/classify", contract.ID), dto.ClassifyContractRequest{
		CandidateText: "This non-disclosure agreement protects confidential information and trade secrets.",
	}), http.StatusOK)
	if preview.Applied || preview.RecommendedType != model.ContractTypeNDA {
		t.Fatalf("preview classification = %+v, want unapplied nda recommendation", preview)
	}
	detail := mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK)
	if detail.Contract.Type != model.ContractTypeOther {
		t.Fatalf("contract type after preview = %s, want unchanged other", detail.Contract.Type)
	}

	applied := mustData[model.ContractClassificationResult](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/classify", contract.ID), dto.ClassifyContractRequest{
		Apply:         true,
		CandidateText: "The service level agreement includes uptime targets, availability credits, and service credits.",
	}), http.StatusOK)
	if !applied.Applied || applied.AppliedType != model.ContractTypeSLA || applied.RecommendedType != model.ContractTypeSLA {
		t.Fatalf("applied classification = %+v, want applied sla", applied)
	}
	detail = mustData[model.ContractDetail](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s", contract.ID), nil), http.StatusOK)
	if detail.Contract.Type != model.ContractTypeSLA {
		t.Fatalf("contract type after apply = %s, want sla", detail.Contract.Type)
	}
	if _, ok := detail.Contract.Metadata["classification"]; !ok {
		t.Fatalf("classification metadata missing after apply: %+v", detail.Contract.Metadata)
	}

	invalid := model.ContractType("unsupported")
	mustError(t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/classify", contract.ID), dto.ClassifyContractRequest{
		OverrideType: &invalid,
	}), http.StatusUnprocessableEntity)

	readOnly := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "viewer"))
	expectStatus(t, readOnly.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/classify", contract.ID), dto.ClassifyContractRequest{}), http.StatusForbidden)
}

func TestContractTimelineAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	contract := h.createContractWithText(t, "Timeline Acceptance Contract", model.ContractTypeVendor, 250000, lifecycleContractText())
	h.uploadContractDocument(t, contract.ID, "timeline-v2.txt", lifecycleContractText()+"\n\n"+clauseSection(12, "Fallback Position", "Business accepted the fallback position."), "Added fallback position.")
	contract = h.updateContractStatus(t, contract.ID, model.ContractStatusInternalReview)

	metadataAt := time.Now().UTC().Add(time.Minute)
	if _, err := h.env.db.Exec(context.Background(), `
		UPDATE contracts
		SET metadata = jsonb_set(metadata, '{timeline}', $3::jsonb, true), updated_at = now()
		WHERE tenant_id = $1 AND id = $2`,
		h.tenantID, contract.ID,
		fmt.Sprintf(`[{"id":"negotiation-audit","event_type":"negotiation_note","title":"Fallback accepted","description":"Business accepted fallback clause.","actor":"Aisha","occurred_at":%q}]`, metadataAt.Format(time.RFC3339)),
	); err != nil {
		t.Fatalf("update contract metadata timeline: %v", err)
	}

	timeline := mustData[model.ContractTimeline](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/timeline", contract.ID), nil), http.StatusOK)
	if timeline.ContractID != contract.ID {
		t.Fatalf("timeline contract_id = %s, want %s", timeline.ContractID, contract.ID)
	}
	if len(timeline.Events) < 4 {
		t.Fatalf("timeline events = %d, want created/status/version/metadata events: %+v", len(timeline.Events), timeline.Events)
	}
	if !timeline.Events[0].OccurredAt.After(timeline.Events[len(timeline.Events)-1].OccurredAt) {
		t.Fatalf("timeline not reverse chronological: %+v", timeline.Events)
	}
	if !timelineContains(timeline, "version_uploaded") || !timelineContains(timeline, "negotiation_note") {
		t.Fatalf("timeline missing version or metadata event: %+v", timeline.Events)
	}

	otherTenant := newLexHarness(t)
	expectStatus(t, otherTenant.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/timeline", contract.ID), nil), http.StatusNotFound)
}

func TestContractRedlineAcrossUploadedVersionsAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	v1 := joinSections(
		clauseSection(1, "Services", "Supplier will provide managed services for Clario operations."),
		clauseSection(2, "Payment Terms", "Invoices are payable net 60 after receipt."),
		clauseSection(3, "Confidentiality", "Each party shall protect confidential information."),
	)
	contract := h.createContractWithText(t, "Redline Multi Version Contract", model.ContractTypeServiceAgreement, 180_000, v1)
	v2 := joinSections(
		clauseSection(1, "Services", "Supplier will provide managed services for Clario operations."),
		clauseSection(2, "Payment Terms", "Invoices are payable net 30 after receipt."),
		clauseSection(3, "Confidentiality", "Each party shall protect confidential information."),
		clauseSection(4, "Audit Rights", "Clario may audit service records once per year on reasonable notice."),
	)
	h.uploadContractDocument(t, contract.ID, "redline-v2.txt", v2, "Negotiated payment term and added audit rights.")
	v3 := joinSections(
		clauseSection(1, "Services", "Supplier will provide managed services for Clario operations and monthly governance reports."),
		clauseSection(2, "Payment Terms", "Invoices are payable net 30 after receipt with service credits for SLA misses."),
		clauseSection(3, "Confidentiality", "Each party shall protect confidential information."),
		clauseSection(4, "Audit Rights", "Clario may audit service records twice per year on reasonable notice."),
		clauseSection(5, "Data Protection", "Supplier shall maintain data protection safeguards for personal data."),
	)
	versions := h.uploadContractDocument(t, contract.ID, "redline-v3.txt", v3, "Added governance reports, service credits, and data protection.")
	if len(versions) != 3 || versions[0].Version != 3 {
		t.Fatalf("uploaded versions = %+v, want latest version 3 across three versions", versions)
	}

	explicit := mustData[model.ContractRedline](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/redline?base_version=1&target_version=3", contract.ID), nil), http.StatusOK)
	if explicit.BaseVersion != 1 || explicit.TargetVersion != 3 {
		t.Fatalf("explicit redline versions = %d/%d, want 1/3", explicit.BaseVersion, explicit.TargetVersion)
	}
	if explicit.BaseFileName == "" || explicit.TargetFileName != "redline-v3.txt" {
		t.Fatalf("redline file names = %q/%q, want base name and redline-v3.txt", explicit.BaseFileName, explicit.TargetFileName)
	}
	if explicit.AddedLines == 0 || explicit.RemovedLines == 0 {
		t.Fatalf("redline added/removed = %d/%d, want both populated", explicit.AddedLines, explicit.RemovedLines)
	}
	if !redlineContains(explicit, model.RedlineOperationRemoved, "Invoices are payable net 60") {
		t.Fatalf("explicit redline missing removed net-60 payment term: %+v", explicit.Segments)
	}
	if !redlineContains(explicit, model.RedlineOperationAdded, "Data Protection") || !redlineContains(explicit, model.RedlineOperationAdded, "service credits") {
		t.Fatalf("explicit redline missing added data-protection/service-credit terms: %+v", explicit.Segments)
	}

	latest := mustData[model.ContractRedline](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/redline", contract.ID), nil), http.StatusOK)
	if latest.BaseVersion != 2 || latest.TargetVersion != 3 {
		t.Fatalf("default redline versions = %d/%d, want latest comparison 2/3", latest.BaseVersion, latest.TargetVersion)
	}

	mustError(t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/redline?base_version=3&target_version=1", contract.ID), nil), http.StatusUnprocessableEntity)
	otherTenant := newLexHarness(t)
	expectStatus(t, otherTenant.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/redline?base_version=1&target_version=3", contract.ID), nil), http.StatusNotFound)
}

func TestContractBriefAndKeyTermAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	req := h.baseContractRequest("SLA Key Terms Brief Contract", model.ContractTypeOther, 950_000, highRiskClauseText())
	req.Metadata = map[string]any{
		"brief_summary": "Watheeq key-term fixture for contract detail and brief acceptance.",
		"obligations": []any{
			map[string]any{"label": "Service credits report", "value": "Monthly uptime report due by the fifth business day.", "source": "fixture.key_terms"},
		},
		"renewal_signals": []any{
			map[string]any{"label": "Renewal owner", "value": "Procurement must confirm renewal position before notice date.", "source": "fixture.key_terms"},
		},
	}
	renewal := time.Now().UTC().AddDate(0, 2, 0)
	req.RenewalDate = &renewal
	req.AutoRenew = true
	contract := h.createContract(t, req)

	classified := mustData[model.ContractClassificationResult](t, h.doJSON(t, http.MethodPost, fmt.Sprintf("/api/v1/lex/contracts/%s/classify", contract.ID), dto.ClassifyContractRequest{
		Apply:         true,
		CandidateText: "This service level agreement includes uptime availability, service credit, SLA reporting, and managed services obligations.",
	}), http.StatusOK)
	if !classified.Applied || classified.RecommendedType != model.ContractTypeSLA {
		t.Fatalf("classification = %+v, want applied SLA recommendation", classified)
	}
	for _, term := range []string{"service level", "uptime", "availability", "service credit", "sla"} {
		if !containsString(classified.MatchedTerms, term) {
			t.Fatalf("matched_terms = %+v, want %q", classified.MatchedTerms, term)
		}
	}

	analysis := h.analyzeContract(t, contract.ID)
	if analysis.Analysis == nil || analysis.Analysis.HighRiskClauseCount == 0 || len(analysis.Analysis.KeyFindings) == 0 {
		t.Fatalf("analysis = %+v, want high-risk clause and key-finding evidence", analysis.Analysis)
	}

	brief := mustData[model.ContractBrief](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/contracts/%s/brief", contract.ID), nil), http.StatusOK)
	if brief.ContractID != contract.ID || brief.Type != model.ContractTypeSLA {
		t.Fatalf("brief identity/type = %+v, want contract %s as SLA", brief, contract.ID)
	}
	if brief.RiskScore == nil || *brief.RiskScore != analysis.Analysis.RiskScore || brief.RiskLevel != analysis.Analysis.OverallRisk {
		t.Fatalf("brief risk = %s/%v, want analysis %s/%.2f", brief.RiskLevel, brief.RiskScore, analysis.Analysis.OverallRisk, analysis.Analysis.RiskScore)
	}
	if !strings.Contains(brief.ExecutiveSummary, "SLA Key Terms Brief Contract") || !strings.Contains(brief.RiskSummary, "Overall risk") {
		t.Fatalf("brief summaries not populated: executive=%q risk=%q", brief.ExecutiveSummary, brief.RiskSummary)
	}
	if !briefContainsClause(brief, model.ClauseTypeLimitationOfLiability) || len(brief.TopRisks) == 0 {
		t.Fatalf("brief missing top clauses or risks: clauses=%+v risks=%+v", brief.TopClauses, brief.TopRisks)
	}
	if !briefContainsSignal(brief.Obligations, "Service credits report") || !briefContainsSignal(brief.Obligations, "Payment terms") {
		t.Fatalf("brief obligations missing metadata/payment terms: %+v", brief.Obligations)
	}
	if !briefContainsSignal(brief.RenewalSignals, "Renewal owner") || !briefContainsSignal(brief.RenewalSignals, "Auto renew") || !briefContainsSignal(brief.RenewalSignals, "Renewal date") {
		t.Fatalf("brief renewal signals missing metadata/contract dates: %+v", brief.RenewalSignals)
	}
	if brief.Metadata == nil || brief.Metadata["brief_summary"] == nil {
		t.Fatalf("brief metadata missing summary: %+v", brief.Metadata)
	}
}

func (h *lexHarness) insertActiveContractFixture(t *testing.T, ctx context.Context, title string, expiryDate, renewalDate *time.Time, renewalNoticeDays int) uuid.UUID {
	t.Helper()

	contractID := uuid.New()
	if _, err := h.env.db.Exec(ctx, `
		INSERT INTO contracts (
			id, tenant_id, title, type, description, party_a_name, party_b_name,
			total_value, currency, effective_date, expiry_date, renewal_date,
			auto_renew, renewal_notice_days, status, owner_user_id, owner_name,
			risk_level, analysis_status, current_version, tags, metadata, created_by
		) VALUES (
			$1, $2, $3, 'service_agreement', 'Renewal warning fixture', 'Clario Holdings Limited', 'Counterparty Ltd.',
			100000, 'SAR', CURRENT_DATE - 30, $4, $5,
			true, $6, 'active', $7, 'Integration Owner',
			'low', 'pending', 1, ARRAY['integration'], '{}'::jsonb, $7
		)`,
		contractID, h.tenantID, title, dateArg(expiryDate), dateArg(renewalDate), renewalNoticeDays, h.userID,
	); err != nil {
		t.Fatalf("insert active contract fixture: %v", err)
	}
	return contractID
}

func dateArg(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC()
}

func renewalSummaryContains(summary model.ContractRenewalWarningSummary, contractID uuid.UUID) bool {
	for _, item := range summary.Items {
		if item.ContractID == contractID {
			return true
		}
	}
	return false
}

func timelineContains(timeline model.ContractTimeline, eventType string) bool {
	for _, event := range timeline.Events {
		if event.EventType == eventType {
			return true
		}
	}
	return false
}

func redlineContains(redline model.ContractRedline, operation model.RedlineOperation, text string) bool {
	for _, segment := range redline.Segments {
		if segment.Operation == operation && strings.Contains(segment.Text, text) {
			return true
		}
	}
	return false
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func briefContainsClause(brief model.ContractBrief, clauseType model.ClauseType) bool {
	for _, clause := range brief.TopClauses {
		if clause.ClauseType == clauseType {
			return true
		}
	}
	return false
}

func briefContainsSignal(signals []model.ContractBriefSignal, label string) bool {
	for _, signal := range signals {
		if signal.Label == label {
			return true
		}
	}
	return false
}
