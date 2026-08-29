package service

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestValidateClauseLibraryRequestRequiresBilingualText(t *testing.T) {
	req := dto.CreateClauseLibraryItemRequest{
		Code:             "NDA-CONF-001",
		TitleEN:          "Confidentiality",
		TextEN:           "The receiving party must protect confidential information.",
		ClauseType:       model.ClauseTypeConfidentiality,
		Jurisdiction:     "SA",
		Version:          1,
		Status:           model.ClauseLibraryStatusDraft,
		GovernanceStatus: model.ClauseGovernancePendingReview,
	}

	err := validateCreateClauseLibraryRequest(req)
	if err == nil {
		t.Fatal("validateCreateClauseLibraryRequest() error = nil, want validation error")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Fields["title_ar"] != "required" || appErr.Fields["text_ar"] != "required" {
		t.Fatalf("fields = %#v, want Arabic title and text required", appErr.Fields)
	}
}

func TestValidateClauseLibraryRequestRequiresApprovalBeforeActive(t *testing.T) {
	req := validClauseLibraryRequest()
	req.Status = model.ClauseLibraryStatusActive
	req.GovernanceStatus = model.ClauseGovernancePendingReview

	err := validateCreateClauseLibraryRequest(req)
	if err == nil {
		t.Fatal("validateCreateClauseLibraryRequest() error = nil, want validation error")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Fields["governance_status"] != "active clauses must be approved" {
		t.Fatalf("governance_status field = %q", appErr.Fields["governance_status"])
	}
}

func TestRankClauseLibraryCandidatesMatchesArabicText(t *testing.T) {
	clauseID := uuid.New()
	candidates := []model.ClauseLibrarySearchCandidate{
		{
			Item: model.ClauseLibraryItem{
				ID:           clauseID,
				Code:         "DP-001",
				TitleEN:      "Data Protection",
				TitleAR:      "حماية البيانات",
				TextEN:       "The supplier must implement privacy safeguards.",
				TextAR:       "يلتزم المعالج بحماية البيانات الشخصية وإخطار المراقب بأي خرق.",
				ClauseType:   model.ClauseTypeDataProtection,
				Category:     "data_protection",
				Jurisdiction: "SA",
				Tags:         []string{"privacy"},
				Metadata:     map[string]any{"risk_level": "high"},
				UpdatedAt:    time.Now().Add(-time.Hour),
			},
		},
		{
			Item: model.ClauseLibraryItem{
				ID:           uuid.New(),
				Code:         "TERM-001",
				TitleEN:      "Termination",
				TitleAR:      "الإنهاء",
				TextEN:       "Either party may terminate for breach.",
				TextAR:       "يجوز لأي طرف إنهاء الاتفاقية عند الإخلال الجوهري.",
				ClauseType:   model.ClauseTypeTermination,
				Category:     "termination",
				Jurisdiction: "SA",
				Metadata:     map[string]any{},
				UpdatedAt:    time.Now(),
			},
		},
	}

	results := rankClauseLibraryCandidates(candidates, model.ClauseLibrarySearchFilters{
		Query:    "البيانات الشخصية",
		Language: "ar",
	})

	if len(results) != 1 {
		t.Fatalf("results len = %d, want 1", len(results))
	}
	if results[0].Item.ID != clauseID {
		t.Fatalf("first result id = %s, want %s", results[0].Item.ID, clauseID)
	}
	requireMatchedField(t, results[0].MatchedFields, "text_ar")
	if snippet := results[0].Snippets["text_ar"]; !strings.Contains(snippet, "البيانات الشخصية") {
		t.Fatalf("text_ar snippet = %q, want Arabic query phrase", snippet)
	}
}

func TestRankClauseLibraryCandidatesWeightsTitlesAndMatchedFields(t *testing.T) {
	titleMatchID := uuid.New()
	bodyMatchID := uuid.New()
	candidates := []model.ClauseLibrarySearchCandidate{
		{
			Item: model.ClauseLibraryItem{
				ID:           bodyMatchID,
				Code:         "CONF-001",
				TitleEN:      "Confidentiality",
				TitleAR:      "السرية",
				TextEN:       "The receiving party must follow data protection safeguards for confidential records.",
				TextAR:       "يلتزم الطرف المتلقي بحماية السجلات السرية.",
				ClauseType:   model.ClauseTypeConfidentiality,
				Category:     "confidentiality",
				Jurisdiction: "SA",
				Metadata:     map[string]any{},
				UpdatedAt:    time.Now(),
			},
		},
		{
			Item: model.ClauseLibraryItem{
				ID:           titleMatchID,
				Code:         "DP-002",
				TitleEN:      "Data Protection Addendum",
				TitleAR:      "ملحق حماية البيانات",
				TextEN:       "The supplier must process personal information lawfully.",
				TextAR:       "يعالج المورد المعلومات الشخصية بشكل نظامي.",
				ClauseType:   model.ClauseTypeDataProtection,
				Category:     "data_protection",
				Jurisdiction: "SA",
				Tags:         []string{"privacy", "data"},
				Metadata:     map[string]any{"risk_level": "high"},
				UpdatedAt:    time.Now().Add(-time.Hour),
			},
		},
	}

	results := rankClauseLibraryCandidates(candidates, model.ClauseLibrarySearchFilters{
		Query:    "data protection",
		Language: "en",
	})

	if len(results) != 2 {
		t.Fatalf("results len = %d, want 2", len(results))
	}
	if results[0].Item.ID != titleMatchID {
		t.Fatalf("first result id = %s, want title match %s", results[0].Item.ID, titleMatchID)
	}
	if results[0].Score <= results[1].Score {
		t.Fatalf("scores = %f <= %f, want title match ranked above body match", results[0].Score, results[1].Score)
	}
	requireMatchedField(t, results[0].MatchedFields, "title_en")
	requireMatchedField(t, results[0].MatchedFields, "category")
	requireMatchedField(t, results[0].MatchedFields, "tags")
	requireMatchedField(t, results[1].MatchedFields, "text_en")
}

func TestRankLibraryCandidatesUseRegulationAndClauseMappings(t *testing.T) {
	clauseResults := rankClauseLibraryCandidates([]model.ClauseLibrarySearchCandidate{
		{
			Item: model.ClauseLibraryItem{
				ID:           uuid.New(),
				Code:         "AUD-001",
				TitleEN:      "Audit Rights",
				TitleAR:      "حقوق التدقيق",
				TextEN:       "The customer may inspect relevant records.",
				TextAR:       "يجوز للعميل فحص السجلات ذات الصلة.",
				ClauseType:   model.ClauseTypeAuditRights,
				Category:     "audit",
				Jurisdiction: "SA",
				Metadata:     map[string]any{},
			},
			RegulationText: "PDPL Personal Data Protection Law نظام حماية البيانات الشخصية",
		},
	}, model.ClauseLibrarySearchFilters{Query: "PDPL"})
	if len(clauseResults) != 1 {
		t.Fatalf("clauseResults len = %d, want 1", len(clauseResults))
	}
	requireMatchedField(t, clauseResults[0].MatchedFields, "regulation_mappings")

	regulationResults := rankRegulationLibraryCandidates([]model.RegulationLibrarySearchCandidate{
		{
			Item: model.RegulationLibraryItem{
				ID:             uuid.New(),
				Code:           "CMA-001",
				TitleEN:        "Capital Market Guidance",
				TitleAR:        "إرشادات السوق المالية",
				DescriptionEN:  "Governance guidance for listed companies.",
				DescriptionAR:  "إرشادات حوكمة للشركات المدرجة.",
				Jurisdiction:   "SA",
				Authority:      "CMA",
				RegulationType: model.RegulationTypeGuidance,
				Status:         model.RegulationStatusActive,
				Metadata:       map[string]any{},
			},
			ClauseText: "Confidential information السرية proprietary records",
		},
	}, model.RegulationLibrarySearchFilters{Query: "confidential information", Language: "en"})
	if len(regulationResults) != 1 {
		t.Fatalf("regulationResults len = %d, want 1", len(regulationResults))
	}
	requireMatchedField(t, regulationResults[0].MatchedFields, "clause_mappings")
}

func TestSemanticClauseLibrarySearchUsesDeterministicLocalVectorMetadata(t *testing.T) {
	dataProtectionID := uuid.New()
	candidates := []model.ClauseLibrarySearchCandidate{
		{
			Item: model.ClauseLibraryItem{
				ID:           uuid.New(),
				Code:         "CONF-001",
				TitleEN:      "Confidentiality",
				TitleAR:      "السرية",
				TextEN:       "Each party shall keep proprietary records confidential.",
				TextAR:       "يلتزم الطرفان بالحفاظ على سرية السجلات.",
				ClauseType:   model.ClauseTypeConfidentiality,
				Category:     "confidentiality",
				Jurisdiction: "SA",
				Metadata:     map[string]any{},
			},
		},
		{
			Item: model.ClauseLibraryItem{
				ID:           dataProtectionID,
				Code:         "DP-003",
				TitleEN:      "Data Protection Addendum",
				TitleAR:      "ملحق حماية البيانات",
				TextEN:       "The processor shall protect personal data and notify controllers after a breach.",
				TextAR:       "يلتزم المعالج بحماية البيانات الشخصية وإخطار المراقب عند حدوث خرق.",
				ClauseType:   model.ClauseTypeDataProtection,
				Category:     "data_protection",
				Jurisdiction: "SA",
				Metadata:     map[string]any{"risk_level": "high"},
			},
		},
	}

	keywordResults := rankClauseLibraryCandidates(candidates, model.ClauseLibrarySearchFilters{
		Query:    "privacy duties",
		Language: "en",
	})
	if len(keywordResults) != 0 {
		t.Fatalf("keyword results len = %d, want 0", len(keywordResults))
	}

	semanticResults := rankClauseLibraryCandidates(candidates, model.ClauseLibrarySearchFilters{
		Query:    "privacy duties",
		Language: "en",
		Semantic: true,
	})

	if len(semanticResults) != 1 {
		t.Fatalf("semantic results len = %d, want 1", len(semanticResults))
	}
	result := semanticResults[0]
	if result.Item.ID != dataProtectionID {
		t.Fatalf("semantic result id = %s, want %s", result.Item.ID, dataProtectionID)
	}
	if result.Score <= 0 {
		t.Fatalf("semantic score = %f, want positive", result.Score)
	}
	requireMatchedField(t, result.MatchedFields, "title_en")
	requireMatchedField(t, result.MatchedFields, "text_en")
	if snippet := result.Snippets["text_en"]; !strings.Contains(snippet, "personal data") {
		t.Fatalf("text_en snippet = %q, want semantic match context", snippet)
	}
	requireSemanticMetadata(t, result.Metadata, "title_en", "text_en")
}

func TestSemanticRegulationLibrarySearchUsesMappedClauseVectorMetadata(t *testing.T) {
	regulationID := uuid.New()
	results := rankRegulationLibraryCandidates([]model.RegulationLibrarySearchCandidate{
		{
			Item: model.RegulationLibraryItem{
				ID:             regulationID,
				Code:           "PDPL",
				TitleEN:        "Personal Data Protection Law",
				TitleAR:        "نظام حماية البيانات الشخصية",
				DescriptionEN:  "Saudi privacy requirements.",
				DescriptionAR:  "متطلبات الخصوصية السعودية.",
				Jurisdiction:   "SA",
				Authority:      "SDAIA",
				RegulationType: model.RegulationTypeLaw,
				Status:         model.RegulationStatusActive,
				Metadata:       map[string]any{},
			},
			ClauseText: "The processor shall protect personal data and notify controllers after a breach.",
		},
		{
			Item: model.RegulationLibraryItem{
				ID:             uuid.New(),
				Code:           "PROC",
				TitleEN:        "Procurement Rules",
				TitleAR:        "قواعد المشتريات",
				DescriptionEN:  "Vendor onboarding and payment rules.",
				DescriptionAR:  "قواعد الموردين والمدفوعات.",
				Jurisdiction:   "SA",
				Authority:      "MOF",
				RegulationType: model.RegulationTypeRegulation,
				Status:         model.RegulationStatusActive,
				Metadata:       map[string]any{},
			},
		},
	}, model.RegulationLibrarySearchFilters{
		Query:    "privacy duties",
		Language: "en",
		Semantic: true,
	})

	if len(results) != 1 {
		t.Fatalf("results len = %d, want 1", len(results))
	}
	if results[0].Item.ID != regulationID {
		t.Fatalf("result id = %s, want %s", results[0].Item.ID, regulationID)
	}
	requireMatchedField(t, results[0].MatchedFields, "title_en")
	requireMatchedField(t, results[0].MatchedFields, "clause_mappings")
	requireSemanticMetadata(t, results[0].Metadata, "title_en", "clause_mappings")
}

func TestCreateClauseLibraryRequestNormalizeDefaultsVersionAndGovernance(t *testing.T) {
	req := dto.CreateClauseLibraryItemRequest{
		Code:         "  NDA-CONF-001 ",
		TitleEN:      " Confidentiality ",
		TitleAR:      " السرية ",
		TextEN:       " English text ",
		TextAR:       " نص عربي ",
		ClauseType:   model.ClauseTypeConfidentiality,
		Jurisdiction: " sa ",
		Tags:         []string{"nda", "nda", "  ksa  ", ""},
	}

	req.Normalize()

	if req.Code != "NDA-CONF-001" {
		t.Fatalf("Code = %q", req.Code)
	}
	if req.Jurisdiction != "SA" {
		t.Fatalf("Jurisdiction = %q, want SA", req.Jurisdiction)
	}
	if req.Version != 1 {
		t.Fatalf("Version = %d, want 1", req.Version)
	}
	if req.Status != model.ClauseLibraryStatusDraft {
		t.Fatalf("Status = %q", req.Status)
	}
	if req.GovernanceStatus != model.ClauseGovernancePendingReview {
		t.Fatalf("GovernanceStatus = %q", req.GovernanceStatus)
	}
	if len(req.Tags) != 2 || req.Tags[0] != "nda" || req.Tags[1] != "ksa" {
		t.Fatalf("Tags = %#v", req.Tags)
	}
}

func TestValidateRegulationLibraryRequestRejectsBadVersionAndType(t *testing.T) {
	req := dto.CreateRegulationLibraryItemRequest{
		Code:           "PDPL",
		TitleEN:        "Personal Data Protection Law",
		TitleAR:        "نظام حماية البيانات الشخصية",
		Jurisdiction:   "SA",
		RegulationType: model.RegulationType("unknown"),
		Version:        0,
		Status:         model.RegulationStatusActive,
	}

	err := validateCreateRegulationLibraryRequest(req)
	if err == nil {
		t.Fatal("validateCreateRegulationLibraryRequest() error = nil, want validation error")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Fields["regulation_type"] != "invalid" || appErr.Fields["version"] != "must be greater than zero" {
		t.Fatalf("fields = %#v, want regulation_type and version errors", appErr.Fields)
	}
}

func TestLibraryGovernanceDecisionMetadataCapturesEvidence(t *testing.T) {
	userID := uuid.New()
	decidedAt := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)
	req := dto.LibraryGovernanceDecisionRequest{
		Decision: " APPROVE ",
		Activate: true,
		Notes:    "Reviewed by legal ops.",
		Evidence: map[string]any{"workflow_instance_id": "wf-123"},
	}
	req.Normalize()

	metadata := appendLibraryGovernanceMetadata(map[string]any{"risk_level": "high"}, "clause_library", req, userID, decidedAt, map[string]any{
		"previous_status":            model.ClauseLibraryStatusDraft,
		"status":                     model.ClauseLibraryStatusActive,
		"previous_governance_status": model.ClauseGovernancePendingReview,
		"governance_status":          model.ClauseGovernanceApproved,
	})

	if metadata["risk_level"] != "high" {
		t.Fatalf("metadata risk_level = %#v, want preserved", metadata["risk_level"])
	}
	governance, ok := metadata["governance"].(map[string]any)
	if !ok {
		t.Fatalf("governance metadata = %#v, want object", metadata["governance"])
	}
	if governance["decision"] != "approve" || governance["activate"] != true || governance["notes"] != "Reviewed by legal ops." {
		t.Fatalf("governance = %#v, want approve decision", governance)
	}
	if governance["decided_by"] != userID.String() || governance["decided_at"] != decidedAt.Format(time.RFC3339) {
		t.Fatalf("governance actor/time = %#v", governance)
	}
	evidence, ok := governance["evidence"].(map[string]any)
	if !ok || evidence["workflow_instance_id"] != "wf-123" {
		t.Fatalf("evidence = %#v, want workflow proof", governance["evidence"])
	}
	history, ok := metadata["governance_history"].([]any)
	if !ok || len(history) != 1 {
		t.Fatalf("history = %#v, want one entry", metadata["governance_history"])
	}
}

func TestValidateLibraryGovernanceDecisionRejectsUnknownDecision(t *testing.T) {
	err := validateLibraryGovernanceDecision(dto.LibraryGovernanceDecisionRequest{Decision: "skip"})
	if err == nil {
		t.Fatal("validateLibraryGovernanceDecision() error = nil, want validation error")
	}
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error type = %T, want AppError", err)
	}
	if appErr.Fields["decision"] == "" {
		t.Fatalf("fields = %#v, want decision error", appErr.Fields)
	}
}

func validClauseLibraryRequest() dto.CreateClauseLibraryItemRequest {
	return dto.CreateClauseLibraryItemRequest{
		Code:             "NDA-CONF-001",
		TitleEN:          "Confidentiality",
		TitleAR:          "السرية",
		TextEN:           "The receiving party must protect confidential information.",
		TextAR:           "يلتزم الطرف المتلقي بحماية المعلومات السرية.",
		ClauseType:       model.ClauseTypeConfidentiality,
		Jurisdiction:     "SA",
		Version:          1,
		Status:           model.ClauseLibraryStatusDraft,
		GovernanceStatus: model.ClauseGovernancePendingReview,
	}
}

func requireMatchedField(t *testing.T, fields []string, want string) {
	t.Helper()
	for _, field := range fields {
		if field == want {
			return
		}
	}
	t.Fatalf("matched fields = %#v, want %q", fields, want)
}

func requireSemanticMetadata(t *testing.T, metadata map[string]any, wantFields ...string) {
	t.Helper()
	if metadata["search_mode"] != "semantic" {
		t.Fatalf("metadata search_mode = %#v, want semantic in %#v", metadata["search_mode"], metadata)
	}
	if metadata["semantic_backend"] != "deterministic_local_vector" {
		t.Fatalf("metadata semantic_backend = %#v, want deterministic_local_vector in %#v", metadata["semantic_backend"], metadata)
	}
	if score, ok := metadata["semantic_score"].(float64); !ok || score <= 0 {
		t.Fatalf("metadata semantic_score = %#v, want positive float64 in %#v", metadata["semantic_score"], metadata)
	}
	if dims, ok := metadata["query_vector_dimensions"].(int); !ok || dims == 0 {
		t.Fatalf("metadata query_vector_dimensions = %#v, want positive int in %#v", metadata["query_vector_dimensions"], metadata)
	}
	fields, ok := metadata["matched_semantic_fields"].([]string)
	if !ok {
		t.Fatalf("metadata matched_semantic_fields = %#v, want []string in %#v", metadata["matched_semantic_fields"], metadata)
	}
	for _, want := range wantFields {
		requireMatchedField(t, fields, want)
	}
}
