package forms

import (
	"encoding/json"
	"testing"
)

func TestLocalizedText_UnmarshalJSON(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		input   string
		wantAR  string
		wantEN  string
		wantErr bool
	}{
		{name: "object form", input: `{"ar":"موافقة","en":"Approve"}`, wantAR: "موافقة", wantEN: "Approve"},
		{name: "bare string fills both locales (legacy seed)", input: `"Approve"`, wantAR: "Approve", wantEN: "Approve"},
		{name: "object with only en", input: `{"en":"Approve"}`, wantAR: "", wantEN: "Approve"},
		{name: "object with only ar", input: `{"ar":"موافقة"}`, wantAR: "موافقة", wantEN: ""},
		{name: "null is empty", input: `null`, wantAR: "", wantEN: ""},
		{name: "empty string bare", input: `""`, wantAR: "", wantEN: ""},
		{name: "number is invalid", input: `42`, wantErr: true},
		{name: "array is invalid", input: `["a","b"]`, wantErr: true},
		{name: "unknown object field is rejected", input: `{"fr":"x"}`, wantErr: true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var lt LocalizedText
			err := json.Unmarshal([]byte(tt.input), &lt)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got %+v", lt)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if lt.AR != tt.wantAR || lt.EN != tt.wantEN {
				t.Fatalf("got AR=%q EN=%q, want AR=%q EN=%q", lt.AR, lt.EN, tt.wantAR, tt.wantEN)
			}
		})
	}
}

func TestLocalizedText_MarshalRoundTrip(t *testing.T) {
	t.Parallel()
	orig := LocalizedText{AR: "اسم", EN: "Name"}
	b, err := json.Marshal(orig)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != `{"ar":"اسم","en":"Name"}` {
		t.Fatalf("marshal = %s", string(b))
	}
	var back LocalizedText
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if back != orig {
		t.Fatalf("round trip = %+v, want %+v", back, orig)
	}
}

func TestLocalizedText_Localize(t *testing.T) {
	t.Parallel()
	full := LocalizedText{AR: "نعم", EN: "Yes"}
	if got := full.Localize("ar"); got != "نعم" {
		t.Fatalf("ar = %q", got)
	}
	if got := full.Localize("en"); got != "Yes" {
		t.Fatalf("en = %q", got)
	}
	// Fallback when requested locale is empty.
	onlyEN := LocalizedText{EN: "Yes"}
	if got := onlyEN.Localize("ar"); got != "Yes" {
		t.Fatalf("ar fallback = %q", got)
	}
	onlyAR := LocalizedText{AR: "نعم"}
	if got := onlyAR.Localize("en"); got != "نعم" {
		t.Fatalf("en fallback = %q", got)
	}
}

// Unmarshalling a full FormField with a bare-string label and an object label
// in the same document exercises the custom unmarshaller in nested position.
func TestFormField_MixedLabelForms(t *testing.T) {
	t.Parallel()
	doc := `{
		"name":"amount",
		"type":"currency",
		"label":"Amount",
		"options":[{"value":"usd","label":{"ar":"دولار","en":"USD"}}]
	}`
	var f FormField
	if err := json.Unmarshal([]byte(doc), &f); err != nil {
		t.Fatalf("unmarshal field: %v", err)
	}
	if f.Label.AR != "Amount" || f.Label.EN != "Amount" {
		t.Fatalf("bare label = %+v", f.Label)
	}
	if len(f.Options) != 1 || f.Options[0].Label.AR != "دولار" || f.Options[0].Label.EN != "USD" {
		t.Fatalf("option label = %+v", f.Options)
	}
}

func TestFieldType_IsValid(t *testing.T) {
	t.Parallel()
	for _, ft := range []FieldType{
		FieldText, FieldTextarea, FieldNumber, FieldBoolean, FieldDate, FieldSelect,
		FieldMultiSelect, FieldCombobox, FieldDateRange, FieldFile, FieldEmail,
		FieldURL, FieldPhone, FieldCurrency, FieldRadio, FieldDateTime, FieldSection,
	} {
		if !ft.IsValid() {
			t.Fatalf("%q should be valid", ft)
		}
	}
	if FieldType("bogus").IsValid() {
		t.Fatal("bogus should be invalid")
	}
}
