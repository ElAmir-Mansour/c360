package llm

import (
	llmmodel "github.com/clario360/platform/internal/cyber/vciso/llm/model"
	"github.com/clario360/platform/internal/lex/model"
)

// Stable tool names. The model is instructed to call exactly one of these and
// never to answer in prose.
const (
	ToolEmitClauseAnalysis = "emit_clause_analysis"
	ToolEmitObligations    = "emit_obligations"
)

// riskLevelEnum is the strict enum for any severity/risk_level field.
var riskLevelEnum = []any{
	string(model.RiskLevelCritical),
	string(model.RiskLevelHigh),
	string(model.RiskLevelMedium),
	string(model.RiskLevelLow),
	string(model.RiskLevelNone),
}

// clauseTypeEnum is generated from model.ClauseTypesForExtraction() (19 + other)
// so the schema can never drift from the Go enum.
func clauseTypeEnum() []any {
	types := model.ClauseTypesForExtraction()
	out := make([]any, 0, len(types))
	for _, t := range types {
		out = append(out, string(t))
	}
	return out
}

func obligationTypeEnum() []any {
	types := []model.ObligationType{
		model.ObligationTypeContractual,
		model.ObligationTypeRenewal,
		model.ObligationTypeNotice,
		model.ObligationTypePayment,
		model.ObligationTypeDelivery,
		model.ObligationTypeReporting,
		model.ObligationTypeCompliance,
		model.ObligationTypeCovenant,
		model.ObligationTypeConditionPrecedent,
		model.ObligationTypeRegulatory,
		model.ObligationTypeOther,
	}
	out := make([]any, 0, len(types))
	for _, t := range types {
		out = append(out, string(t))
	}
	return out
}

func legalPriorityEnum() []any {
	return []any{
		string(model.LegalPriorityCritical),
		string(model.LegalPriorityHigh),
		string(model.LegalPriorityMedium),
		string(model.LegalPriorityLow),
	}
}

func stringProp() map[string]any { return map[string]any{"type": "string"} }

func stringArrayProp() map[string]any {
	return map[string]any{"type": "array", "items": map[string]any{"type": "string"}}
}

func enumStringProp(values []any) map[string]any {
	return map[string]any{"type": "string", "enum": values}
}

func numberProp(minimum, maximum float64) map[string]any {
	return map[string]any{"type": "number", "minimum": minimum, "maximum": maximum}
}

// objectSchema builds a JSON-schema object with additionalProperties:false and
// the given required field list.
func objectSchema(properties map[string]any, required []string) map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties":           properties,
		"required":             required,
	}
}

func arrayOf(item map[string]any) map[string]any {
	return map[string]any{"type": "array", "items": item}
}

// ClauseAnalysisSchema returns the strict tool schema for clause + entity +
// finding extraction.
func ClauseAnalysisSchema() llmmodel.ToolSchema {
	clauseItem := objectSchema(map[string]any{
		"clause_type":       enumStringProp(clauseTypeEnum()),
		"title":             stringProp(),
		"text_span":         stringProp(),
		"section_reference": stringProp(),
		"risk_level":        enumStringProp(riskLevelEnum),
		"risk_score":        numberProp(0, 100),
		"rationale":         stringProp(),
		"risk_keywords":     stringArrayProp(),
		"recommendations":   stringArrayProp(),
		"confidence":        numberProp(0, 1),
	}, []string{"clause_type", "title", "text_span", "risk_level", "risk_score", "rationale", "confidence"})

	partyItem := objectSchema(map[string]any{
		"name":   stringProp(),
		"role":   enumStringProp([]any{"party_a", "party_b", "other"}),
		"source": stringProp(),
	}, []string{"name", "role"})

	dateItem := objectSchema(map[string]any{
		"label":  enumStringProp([]any{"effective_date", "expiry_date", "renewal_date", "other"}),
		"value":  stringProp(),
		"source": stringProp(),
	}, []string{"label", "value"})

	amountItem := objectSchema(map[string]any{
		"label":    stringProp(),
		"currency": enumStringProp([]any{"SAR", "USD", "EUR", "GBP", "AED", "other"}),
		"value":    map[string]any{"type": "number"},
		"source":   stringProp(),
	}, []string{"label", "currency", "value"})

	flagItem := objectSchema(map[string]any{
		"code":              stringProp(),
		"title":             stringProp(),
		"description":       stringProp(),
		"severity":          enumStringProp(riskLevelEnum),
		"section_reference": stringProp(),
	}, []string{"code", "title", "severity"})

	findingItem := objectSchema(map[string]any{
		"title":            stringProp(),
		"description":      stringProp(),
		"severity":         enumStringProp(riskLevelEnum),
		"clause_reference": stringProp(),
		"recommendation":   stringProp(),
		"clause_type":      enumStringProp(clauseTypeEnum()),
	}, []string{"title", "severity"})

	parameters := objectSchema(map[string]any{
		"clauses":          arrayOf(clauseItem),
		"parties":          arrayOf(partyItem),
		"dates":            arrayOf(dateItem),
		"amounts":          arrayOf(amountItem),
		"compliance_flags": arrayOf(flagItem),
		"key_findings":     arrayOf(findingItem),
	}, []string{"clauses"})

	return llmmodel.ToolSchema{
		Name:        ToolEmitClauseAnalysis,
		Description: "Emit the structured clause analysis, extracted entities, compliance flags, and key findings for a contract. You MUST call this tool; do not answer in prose.",
		Parameters:  parameters,
	}
}

// ObligationSchema returns the strict tool schema for obligation extraction.
func ObligationSchema() llmmodel.ToolSchema {
	obligationItem := objectSchema(map[string]any{
		"title":            stringProp(),
		"description":      stringProp(),
		"obligation_type":  enumStringProp(obligationTypeEnum()),
		"priority":         enumStringProp(legalPriorityEnum()),
		"due_date":         stringProp(),
		"source_reference": stringProp(),
		"confidence":       numberProp(0, 1),
	}, []string{"title", "due_date", "confidence"})

	parameters := objectSchema(map[string]any{
		"obligations": arrayOf(obligationItem),
	}, []string{"obligations"})

	return llmmodel.ToolSchema{
		Name:        ToolEmitObligations,
		Description: "Emit the structured contractual obligations extracted from a contract. Each obligation must include a title and a due_date in YYYY-MM-DD format. You MUST call this tool; do not answer in prose.",
		Parameters:  parameters,
	}
}
