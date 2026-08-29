// Package forms is the canonical, bilingual, validated, conditional
// form-definition model that the workflow human-task step and the front-end
// dynamic renderer both consume (DESIGN_Workflow_Forms_Automation.md §3.2).
//
// A FormDefinition is authored once and validated on BOTH sides: the FE compiles
// the same Validation/VisibleWhen rules to Zod, while the backend re-validates on
// submit (never trust the client) using the EXACT same operator vocabulary as the
// workflow transition DSL — Condition values compile to an expression string that
// internal/workflow/expression.Evaluator evaluates against a {"fields": {...}}
// context (one grammar, two evaluators). See validate.go.
//
// This package is purely additive. It does not edit the existing
// internal/workflow/model.FormField (the legacy inline form shape) — the
// human-task executor gains a by-ref path in the INTEGRATE phase; this phase only
// delivers the new model, validator, and store.
package forms

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// LocalizedText carries an author-facing string in the two platform locales.
// Arabic (AR) and English (EN) are both first-class; FR-XC-008 requires every
// author-facing label to be present in both. A LocalizedText round-trips to JSON
// as {"ar": "...", "en": "..."} but for backward compatibility a bare JSON string
// is also accepted on read (see UnmarshalJSON) and assigned to BOTH locales so a
// legacy single-language seed keeps working.
type LocalizedText struct {
	AR string `json:"ar"`
	EN string `json:"en"`
}

// IsEmpty reports whether both locale strings are empty.
func (lt LocalizedText) IsEmpty() bool { return lt.AR == "" && lt.EN == "" }

// Localize returns the string for the requested locale, falling back to the
// other locale when the requested one is empty so a partially-translated label
// still renders something.
func (lt LocalizedText) Localize(locale string) string {
	switch locale {
	case "ar":
		if lt.AR != "" {
			return lt.AR
		}
		return lt.EN
	default:
		if lt.EN != "" {
			return lt.EN
		}
		return lt.AR
	}
}

// localizedTextWire is the struct shape LocalizedText marshals to / unmarshals
// from when the JSON is an object. A distinct type avoids infinite recursion in
// the custom UnmarshalJSON.
type localizedTextWire struct {
	AR string `json:"ar"`
	EN string `json:"en"`
}

// UnmarshalJSON accepts either a bare JSON string (legacy seed: "Approve") or the
// canonical object form ({"ar":"...","en":"..."}). A bare string is assigned to
// BOTH locales so it satisfies neither stricter localization checks falsely nor
// breaks rendering — the bilingual completeness check in validate.go still flags
// a definition whose author intended two locales but only supplied one as an
// object with an empty side. A null is treated as the empty value.
func (lt *LocalizedText) UnmarshalJSON(data []byte) error {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		*lt = LocalizedText{}
		return nil
	}
	// Bare string form.
	if trimmed[0] == '"' {
		var s string
		if err := json.Unmarshal(trimmed, &s); err != nil {
			return fmt.Errorf("forms: LocalizedText bare string: %w", err)
		}
		*lt = LocalizedText{AR: s, EN: s}
		return nil
	}
	// Object form.
	if trimmed[0] == '{' {
		var w localizedTextWire
		dec := json.NewDecoder(bytes.NewReader(trimmed))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&w); err != nil {
			return fmt.Errorf("forms: LocalizedText object: %w", err)
		}
		*lt = LocalizedText{AR: w.AR, EN: w.EN}
		return nil
	}
	return fmt.Errorf("forms: LocalizedText must be a string or {ar,en} object, got %s", string(trimmed))
}

// MarshalJSON always emits the canonical object form.
func (lt LocalizedText) MarshalJSON() ([]byte, error) {
	return json.Marshal(localizedTextWire{AR: lt.AR, EN: lt.EN})
}

// FieldType enumerates the field kinds the FE renderer supports (Tier 1+2).
type FieldType string

// Supported field types. "section" is a layout-only field (no value, no
// validation of its own beyond a bilingual label).
const (
	FieldText        FieldType = "text"
	FieldTextarea    FieldType = "textarea"
	FieldNumber      FieldType = "number"
	FieldBoolean     FieldType = "boolean"
	FieldDate        FieldType = "date"
	FieldSelect      FieldType = "select"
	FieldMultiSelect FieldType = "multiselect"
	FieldCombobox    FieldType = "combobox"
	FieldDateRange   FieldType = "daterange"
	FieldFile        FieldType = "file"
	FieldEmail       FieldType = "email"
	FieldURL         FieldType = "url"
	FieldPhone       FieldType = "phone"
	FieldCurrency    FieldType = "currency"
	FieldRadio       FieldType = "radio"
	FieldDateTime    FieldType = "datetime"
	FieldSection     FieldType = "section"
)

// validFieldTypes is the membership set used by Validate.
var validFieldTypes = map[FieldType]bool{
	FieldText: true, FieldTextarea: true, FieldNumber: true, FieldBoolean: true,
	FieldDate: true, FieldSelect: true, FieldMultiSelect: true, FieldCombobox: true,
	FieldDateRange: true, FieldFile: true, FieldEmail: true, FieldURL: true,
	FieldPhone: true, FieldCurrency: true, FieldRadio: true, FieldDateTime: true,
	FieldSection: true,
}

// IsValid reports whether ft is a known field type.
func (ft FieldType) IsValid() bool { return validFieldTypes[ft] }

// isOptionBacked reports whether the field draws its valid values from Options
// (select-family). enum validation and option membership only apply to these.
func (ft FieldType) isOptionBacked() bool {
	switch ft {
	case FieldSelect, FieldMultiSelect, FieldCombobox, FieldRadio:
		return true
	default:
		return false
	}
}

// isMultiValued reports whether the field's submitted value is naturally a list.
func (ft FieldType) isMultiValued() bool {
	return ft == FieldMultiSelect || ft == FieldDateRange
}

// holdsValue reports whether the field carries a user value at all. A section is
// layout-only and is skipped by the value validator.
func (ft FieldType) holdsValue() bool { return ft != FieldSection }

// Direction values for the Dir field. "auto" lets the renderer choose from the
// active locale; ltr/rtl force a direction (e.g. an email or IBAN in an RTL form).
const (
	DirAuto = "auto"
	DirLTR  = "ltr"
	DirRTL  = "rtl"
)

var validDirs = map[string]bool{"": true, DirAuto: true, DirLTR: true, DirRTL: true}

// Condition is one clause of a VisibleWhen / RequiredWhen / rule-When predicate.
// It reuses the workflow transition operator vocabulary: rather than inventing a
// second grammar, each Condition compiles to a fragment of the expression DSL
// that internal/workflow/expression.Evaluator evaluates against a
// {"fields": {<name>: <submitted value>}} context. Multiple conditions on one
// field list are combined with AND (all must hold).
type Condition struct {
	// Field is the Name of another field in the same form whose submitted value
	// the condition tests.
	Field string `json:"field"`
	// Operator is one of the supported comparison operators (see operatorExpr).
	Operator string `json:"operator"`
	// Value is the literal compared against the field value. For "in"/"notIn" it
	// is a JSON array; for "contains" it is the element looked for in a list (or
	// substring in a string).
	Value any `json:"value,omitempty"`
}

// FormOption is one choice of an option-backed field.
type FormOption struct {
	Value string        `json:"value"`
	Label LocalizedText `json:"label"`
}

// ValidationRule is one declarative server-side constraint on a field. Kind names
// the rule; Param parameterizes it (e.g. the min number, the regex pattern, the
// enum list); When optionally gates the rule on other field values (so a rule
// only applies under a condition); Message is the bilingual error shown when the
// rule is violated.
type ValidationRule struct {
	Kind    string        `json:"kind"`
	Param   any           `json:"param,omitempty"`
	When    []Condition   `json:"when,omitempty"`
	Message LocalizedText `json:"message,omitempty"`
}

// Validation rule kinds.
const (
	RuleRequired   = "required"
	RuleMin        = "min"
	RuleMax        = "max"
	RuleMinLength  = "minLength"
	RuleMaxLength  = "maxLength"
	RulePattern    = "pattern"
	RuleEmail      = "email"
	RuleURL        = "url"
	RuleUUID       = "uuid"
	RuleCron       = "cron"
	RuleEnum       = "enum"
	RuleRequiredIf = "requiredIf"
)

var validRuleKinds = map[string]bool{
	RuleRequired: true, RuleMin: true, RuleMax: true, RuleMinLength: true,
	RuleMaxLength: true, RulePattern: true, RuleEmail: true, RuleURL: true,
	RuleUUID: true, RuleCron: true, RuleEnum: true, RuleRequiredIf: true,
}

// FormField is a single field of a FormDefinition.
type FormField struct {
	Name         string           `json:"name"`
	Type         FieldType        `json:"type"`
	Label        LocalizedText    `json:"label"`
	Placeholder  *LocalizedText   `json:"placeholder,omitempty"`
	Description  *LocalizedText   `json:"description,omitempty"`
	Required     bool             `json:"required"`
	Default      any              `json:"default,omitempty"`
	Options      []FormOption     `json:"options,omitempty"`
	Validation   []ValidationRule `json:"validation,omitempty"`
	VisibleWhen  []Condition      `json:"visibleWhen,omitempty"`
	RequiredWhen []Condition      `json:"requiredWhen,omitempty"`
	Dir          string           `json:"dir,omitempty"`
}

// FormDefinition is the persisted, versioned form blueprint. The audit/version
// columns (ID/TenantID/Name/Version/timestamps) live on the row; the bilingual
// content (Locales/DefaultLocale/Fields) is stored as the JSONB body (store.go).
type FormDefinition struct {
	ID            string      `json:"id"`
	TenantID      string      `json:"tenant_id"`
	Name          string      `json:"name"`
	Version       int         `json:"version"`
	Locales       []string    `json:"locales"`
	DefaultLocale string      `json:"default_locale"`
	Fields        []FormField `json:"fields"`
	CreatedAt     string      `json:"created_at,omitempty"`
	UpdatedAt     string      `json:"updated_at,omitempty"`
}

// FormData is a submitted form's field-name -> value map.
type FormData = map[string]any

// fieldByName builds a name->field index for the definition. A nil/empty name is
// skipped (it cannot be referenced by a condition anyway).
func (fd *FormDefinition) fieldByName() map[string]*FormField {
	idx := make(map[string]*FormField, len(fd.Fields))
	for i := range fd.Fields {
		f := &fd.Fields[i]
		if f.Name != "" {
			idx[f.Name] = f
		}
	}
	return idx
}
