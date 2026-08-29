package forms

import (
	"testing"
)

// bi is a convenience constructor for a bilingual label.
func bi(ar, en string) LocalizedText { return LocalizedText{AR: ar, EN: en} }

// hasViolation reports whether vs contains a violation for (field, rule).
func hasViolation(vs []Violation, field, rule string) bool {
	for _, v := range vs {
		if v.Field == field && v.Rule == rule {
			return true
		}
	}
	return false
}

func violationRules(vs []Violation) []string {
	out := make([]string, len(vs))
	for i, v := range vs {
		out[i] = v.Field + "/" + v.Rule
	}
	return out
}

// ----------------------------------------------------------------------------
// Structural validation (Validate)
// ----------------------------------------------------------------------------

func TestValidate_Structural(t *testing.T) {
	t.Parallel()

	t.Run("clean definition passes", func(t *testing.T) {
		fd := &FormDefinition{
			Name: "f", Version: 1, Locales: []string{"ar", "en"}, DefaultLocale: "en",
			Fields: []FormField{
				{Name: "title", Type: FieldText, Label: bi("العنوان", "Title")},
				{Name: "color", Type: FieldSelect, Label: bi("اللون", "Color"),
					Options: []FormOption{{Value: "r", Label: bi("أحمر", "Red")}}},
			},
		}
		if vs := fd.Validate(); len(vs) != 0 {
			t.Fatalf("expected clean, got %v", violationRules(vs))
		}
	})

	t.Run("AR-missing label fails FR-XC-008", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "title", Type: FieldText, Label: bi("", "Title")},
		}}
		vs := fd.Validate()
		if !hasViolation(vs, "title", "bilingual") {
			t.Fatalf("expected bilingual violation, got %v", violationRules(vs))
		}
	})

	t.Run("EN-missing label fails FR-XC-008", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "title", Type: FieldText, Label: bi("العنوان", "")},
		}}
		if !hasViolation(fd.Validate(), "title", "bilingual") {
			t.Fatal("expected bilingual violation for missing EN")
		}
	})

	t.Run("unknown field type fails", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "x", Type: FieldType("bogus"), Label: bi("س", "X")},
		}}
		if !hasViolation(fd.Validate(), "x", "type") {
			t.Fatal("expected type violation")
		}
	})

	t.Run("select without options fails", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "c", Type: FieldSelect, Label: bi("ج", "C")},
		}}
		if !hasViolation(fd.Validate(), "c", "options") {
			t.Fatal("expected options violation")
		}
	})

	t.Run("option missing a locale fails", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "c", Type: FieldSelect, Label: bi("ج", "C"),
				Options: []FormOption{{Value: "r", Label: bi("", "Red")}}},
		}}
		if !hasViolation(fd.Validate(), "c", "bilingual") {
			t.Fatal("expected bilingual option violation")
		}
	})

	t.Run("unknown rule kind fails", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "x", Type: FieldText, Label: bi("س", "X"),
				Validation: []ValidationRule{{Kind: "weird"}}},
		}}
		if !hasViolation(fd.Validate(), "x", "rule_kind") {
			t.Fatal("expected rule_kind violation")
		}
	})

	t.Run("condition referencing unknown field fails", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "x", Type: FieldText, Label: bi("س", "X"),
				VisibleWhen: []Condition{{Field: "ghost", Operator: "eq", Value: "1"}}},
		}}
		if !hasViolation(fd.Validate(), "x", "visibleWhen") {
			t.Fatal("expected visibleWhen unknown-field violation")
		}
	})

	t.Run("unsupported operator fails", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "x", Type: FieldText, Label: bi("س", "X")},
			{Name: "y", Type: FieldText, Label: bi("ص", "Y"),
				VisibleWhen: []Condition{{Field: "x", Operator: "matches", Value: "1"}}},
		}}
		if !hasViolation(fd.Validate(), "y", "visibleWhen") {
			t.Fatal("expected unsupported operator violation")
		}
	})

	t.Run("in operator requires array", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "x", Type: FieldText, Label: bi("س", "X")},
			{Name: "y", Type: FieldText, Label: bi("ص", "Y"),
				VisibleWhen: []Condition{{Field: "x", Operator: "in", Value: "notarray"}}},
		}}
		if !hasViolation(fd.Validate(), "y", "visibleWhen") {
			t.Fatal("expected in-needs-array violation")
		}
	})

	t.Run("default locale not in locales fails", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Locales: []string{"ar", "en"}, DefaultLocale: "fr",
			Fields: []FormField{{Name: "x", Type: FieldText, Label: bi("س", "X")}}}
		if !hasViolation(fd.Validate(), "", "default_locale") {
			t.Fatal("expected default_locale violation")
		}
	})

	t.Run("duplicate field name fails", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "x", Type: FieldText, Label: bi("س", "X")},
			{Name: "x", Type: FieldText, Label: bi("س2", "X2")},
		}}
		if !hasViolation(fd.Validate(), "x", "name") {
			t.Fatal("expected duplicate name violation")
		}
	})

	t.Run("section field needs no options or value type", func(t *testing.T) {
		fd := &FormDefinition{Name: "f", Fields: []FormField{
			{Name: "sec", Type: FieldSection, Label: bi("قسم", "Section")},
		}}
		if vs := fd.Validate(); len(vs) != 0 {
			t.Fatalf("section should be clean, got %v", violationRules(vs))
		}
	})
}

// ----------------------------------------------------------------------------
// Submission validation (ValidateSubmission)
// ----------------------------------------------------------------------------

// sampleForm builds a representative form covering many field types and rules.
func sampleForm() *FormDefinition {
	return &FormDefinition{
		Name: "intake", Version: 1, Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "name", Type: FieldText, Label: bi("الاسم", "Name"), Required: true,
				Validation: []ValidationRule{
					{Kind: RuleMinLength, Param: float64(2)},
					{Kind: RuleMaxLength, Param: float64(10)},
				}},
			{Name: "age", Type: FieldNumber, Label: bi("العمر", "Age"),
				Validation: []ValidationRule{
					{Kind: RuleMin, Param: float64(18)},
					{Kind: RuleMax, Param: float64(120)},
				}},
			{Name: "email", Type: FieldEmail, Label: bi("البريد", "Email"),
				Validation: []ValidationRule{{Kind: RuleEmail}}},
			{Name: "website", Type: FieldURL, Label: bi("الموقع", "Website"),
				Validation: []ValidationRule{{Kind: RuleURL}}},
			{Name: "ref", Type: FieldText, Label: bi("المرجع", "Ref"),
				Validation: []ValidationRule{{Kind: RuleUUID}}},
			{Name: "code", Type: FieldText, Label: bi("الرمز", "Code"),
				Validation: []ValidationRule{{Kind: RulePattern, Param: "^[A-Z]{3}$"}}},
			{Name: "schedule", Type: FieldText, Label: bi("الجدول", "Schedule"),
				Validation: []ValidationRule{{Kind: RuleCron}}},
			{Name: "color", Type: FieldSelect, Label: bi("اللون", "Color"),
				Options: []FormOption{
					{Value: "red", Label: bi("أحمر", "Red")},
					{Value: "blue", Label: bi("أزرق", "Blue")},
				}},
			{Name: "active", Type: FieldBoolean, Label: bi("نشط", "Active")},
		},
	}
}

func TestValidateSubmission_Pass(t *testing.T) {
	t.Parallel()
	fd := sampleForm()
	data := FormData{
		"name":     "Alice",
		"age":      float64(30),
		"email":    "a@example.com",
		"website":  "https://example.com",
		"ref":      "123e4567-e89b-12d3-a456-426614174000",
		"code":     "ABC",
		"schedule": "0 9 * * 1",
		"color":    "red",
		"active":   true,
	}
	if vs := fd.ValidateSubmission(data); len(vs) != 0 {
		t.Fatalf("expected pass, got %v", violationRules(vs))
	}
}

func TestValidateSubmission_Failures(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		mutate    func(FormData)
		wantField string
		wantRule  string
	}{
		{"missing required name", func(d FormData) { delete(d, "name") }, "name", RuleRequired},
		{"empty required name", func(d FormData) { d["name"] = "  " }, "name", RuleRequired},
		{"name too short", func(d FormData) { d["name"] = "A" }, "name", RuleMinLength},
		{"name too long", func(d FormData) { d["name"] = "AbcdefghijK" }, "name", RuleMaxLength},
		{"age below min", func(d FormData) { d["age"] = float64(10) }, "age", RuleMin},
		{"age above max", func(d FormData) { d["age"] = float64(200) }, "age", RuleMax},
		{"age wrong type", func(d FormData) { d["age"] = "old" }, "age", "type"},
		{"bad email", func(d FormData) { d["email"] = "nope" }, "email", RuleEmail},
		{"bad url", func(d FormData) { d["website"] = "not a url" }, "website", RuleURL},
		{"bad uuid", func(d FormData) { d["ref"] = "xyz" }, "ref", RuleUUID},
		{"bad pattern", func(d FormData) { d["code"] = "abcd" }, "code", RulePattern},
		{"bad cron", func(d FormData) { d["schedule"] = "not cron" }, "schedule", RuleCron},
		{"bad enum option", func(d FormData) { d["color"] = "green" }, "color", RuleEnum},
		{"boolean wrong type", func(d FormData) { d["active"] = "yes" }, "active", "type"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			fd := sampleForm()
			data := FormData{
				"name": "Alice", "age": float64(30), "email": "a@example.com",
				"website": "https://example.com", "ref": "123e4567-e89b-12d3-a456-426614174000",
				"code": "ABC", "schedule": "0 9 * * 1", "color": "red", "active": true,
			}
			tt.mutate(data)
			vs := fd.ValidateSubmission(data)
			if !hasViolation(vs, tt.wantField, tt.wantRule) {
				t.Fatalf("expected %s/%s, got %v", tt.wantField, tt.wantRule, violationRules(vs))
			}
		})
	}
}

func TestValidateSubmission_OptionalAbsentIsSkipped(t *testing.T) {
	t.Parallel()
	fd := sampleForm()
	// Only the required field present; all optional fields absent -> no violations.
	if vs := fd.ValidateSubmission(FormData{"name": "Alice"}); len(vs) != 0 {
		t.Fatalf("optional absent should pass, got %v", violationRules(vs))
	}
}

func TestValidateSubmission_RequiredWhen(t *testing.T) {
	t.Parallel()
	fd := &FormDefinition{
		Name: "f", Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "needsReason", Type: FieldBoolean, Label: bi("يحتاج سبب", "Needs reason")},
			{Name: "reason", Type: FieldText, Label: bi("السبب", "Reason"),
				RequiredWhen: []Condition{{Field: "needsReason", Operator: "eq", Value: true}}},
		},
	}

	t.Run("required when condition true and value missing -> violation", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"needsReason": true})
		if !hasViolation(vs, "reason", RuleRequired) {
			t.Fatalf("expected reason required, got %v", violationRules(vs))
		}
	})
	t.Run("required when condition false -> no violation", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"needsReason": false})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
	t.Run("required when condition true and value present -> no violation", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"needsReason": true, "reason": "because"})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
}

func TestValidateSubmission_RequiredIfRule(t *testing.T) {
	t.Parallel()
	fd := &FormDefinition{
		Name: "f", Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "country", Type: FieldText, Label: bi("الدولة", "Country")},
			{Name: "state", Type: FieldText, Label: bi("الولاية", "State"),
				Validation: []ValidationRule{{
					Kind:  RuleRequiredIf,
					Param: []Condition{{Field: "country", Operator: "eq", Value: "US"}},
				}}},
		},
	}
	t.Run("requiredIf true -> missing state violates", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"country": "US"})
		if !hasViolation(vs, "state", RuleRequiredIf) {
			t.Fatalf("expected requiredIf violation, got %v", violationRules(vs))
		}
	})
	t.Run("requiredIf false -> missing state ok", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"country": "FR"})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
	t.Run("requiredIf true with value present -> ok", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"country": "US", "state": "CA"})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
}

func TestValidateSubmission_HiddenFieldExcluded(t *testing.T) {
	t.Parallel()
	// "reason" is required, but only visible when status == 'rejected'. When the
	// status is anything else the field is hidden and MUST NOT block submit even
	// though it is required and absent.
	fd := &FormDefinition{
		Name: "f", Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "status", Type: FieldSelect, Label: bi("الحالة", "Status"),
				Options: []FormOption{
					{Value: "approved", Label: bi("موافق", "Approved")},
					{Value: "rejected", Label: bi("مرفوض", "Rejected")},
				}},
			{Name: "reason", Type: FieldText, Label: bi("السبب", "Reason"), Required: true,
				VisibleWhen: []Condition{{Field: "status", Operator: "eq", Value: "rejected"}}},
		},
	}

	t.Run("hidden required field is excluded", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"status": "approved"})
		if len(vs) != 0 {
			t.Fatalf("hidden required field must not produce a violation, got %v", violationRules(vs))
		}
	})

	t.Run("visible required field is enforced", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"status": "rejected"})
		if !hasViolation(vs, "reason", RuleRequired) {
			t.Fatalf("visible required field must be enforced, got %v", violationRules(vs))
		}
	})

	t.Run("visible required field satisfied", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"status": "rejected", "reason": "missing docs"})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
}

func TestValidateSubmission_MultiSelectAndEnum(t *testing.T) {
	t.Parallel()
	fd := &FormDefinition{
		Name: "f", Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "tags", Type: FieldMultiSelect, Label: bi("الوسوم", "Tags"),
				Options: []FormOption{
					{Value: "a", Label: bi("أ", "A")},
					{Value: "b", Label: bi("ب", "B")},
				}},
		},
	}
	t.Run("valid multiselect passes", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"tags": []any{"a", "b"}})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
	t.Run("multiselect with unknown option fails enum", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"tags": []any{"a", "zzz"}})
		if !hasViolation(vs, "tags", RuleEnum) {
			t.Fatalf("expected enum violation, got %v", violationRules(vs))
		}
	})
	t.Run("multiselect wrong container type fails", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"tags": "a"})
		if !hasViolation(vs, "tags", "type") {
			t.Fatalf("expected type violation, got %v", violationRules(vs))
		}
	})
}

func TestValidateSubmission_DateRange(t *testing.T) {
	t.Parallel()
	fd := &FormDefinition{
		Name: "f", Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "window", Type: FieldDateRange, Label: bi("النطاق", "Window")},
		},
	}
	t.Run("valid pair passes", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"window": []any{"2026-01-01", "2026-02-01"}})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
	t.Run("single element fails", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"window": []any{"2026-01-01"}})
		if !hasViolation(vs, "window", "type") {
			t.Fatalf("expected type violation, got %v", violationRules(vs))
		}
	})
}

func TestValidateSubmission_ConditionOperators(t *testing.T) {
	t.Parallel()
	// Cover the compiled operators: gt and in via VisibleWhen visibility.
	fd := &FormDefinition{
		Name: "f", Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "amount", Type: FieldNumber, Label: bi("المبلغ", "Amount")},
			{Name: "tier", Type: FieldText, Label: bi("الفئة", "Tier")},
			// approval required only for large amounts in a watched tier.
			{Name: "approval", Type: FieldText, Label: bi("الموافقة", "Approval"), Required: true,
				VisibleWhen: []Condition{
					{Field: "amount", Operator: "gt", Value: float64(1000)},
					{Field: "tier", Operator: "in", Value: []any{"gold", "platinum"}},
				}},
		},
	}

	t.Run("both conditions hold -> approval enforced", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"amount": float64(5000), "tier": "gold"})
		if !hasViolation(vs, "approval", RuleRequired) {
			t.Fatalf("expected approval required, got %v", violationRules(vs))
		}
	})
	t.Run("amount too small -> approval hidden", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"amount": float64(500), "tier": "gold"})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
	t.Run("tier not in set -> approval hidden", func(t *testing.T) {
		vs := fd.ValidateSubmission(FormData{"amount": float64(5000), "tier": "bronze"})
		if len(vs) != 0 {
			t.Fatalf("expected pass, got %v", violationRules(vs))
		}
	})
}

func TestValidateSubmission_AuthoredMessageWins(t *testing.T) {
	t.Parallel()
	custom := bi("الاسم مطلوب", "Name is mandatory")
	fd := &FormDefinition{
		Name: "f", Locales: []string{"ar", "en"}, DefaultLocale: "en",
		Fields: []FormField{
			{Name: "name", Type: FieldText, Label: bi("الاسم", "Name"),
				Validation: []ValidationRule{{Kind: RuleMinLength, Param: float64(5), Message: custom}}},
		},
	}
	vs := fd.ValidateSubmission(FormData{"name": "ab"})
	if len(vs) != 1 {
		t.Fatalf("expected 1 violation, got %v", violationRules(vs))
	}
	if vs[0].Message != custom {
		t.Fatalf("expected authored message, got %+v", vs[0].Message)
	}
}

func TestValidateAll_StructuralBlocksSubmission(t *testing.T) {
	t.Parallel()
	// A structurally invalid form (AR label missing) returns structural
	// violations and never reaches submission validation.
	fd := &FormDefinition{Name: "f", Fields: []FormField{
		{Name: "name", Type: FieldText, Label: bi("", "Name"), Required: true},
	}}
	vs := fd.ValidateAll(FormData{})
	if !hasViolation(vs, "name", "bilingual") {
		t.Fatalf("expected structural bilingual violation, got %v", violationRules(vs))
	}
	if hasViolation(vs, "name", RuleRequired) {
		t.Fatal("submission validation should not run when structure is invalid")
	}
}
