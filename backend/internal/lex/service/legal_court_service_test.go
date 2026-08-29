package service

import (
	"errors"
	"testing"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
)

func appErrorFields(t *testing.T, err error) (int, map[string]string) {
	t.Helper()
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("error %v is not an *apperrors.AppError", err)
	}
	return appErr.Status, appErr.Fields
}

func TestValidateLegalCourtCode(t *testing.T) {
	cases := []struct {
		name    string
		code    string
		wantErr bool
	}{
		{name: "plain code", code: "RIYADH_COMMERCIAL"},
		{name: "hyphenated code", code: "GC-01"},
		{name: "arabic letters allowed", code: "محكمة1"},
		{name: "blank rejected", code: "   ", wantErr: true},
		{name: "space inside rejected", code: "GENERAL COURT", wantErr: true},
		{name: "punctuation rejected", code: "GC/01", wantErr: true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateLegalCourtCode(tc.code)
			if tc.wantErr && err == nil {
				t.Fatalf("validateLegalCourtCode(%q) = nil, want error", tc.code)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("validateLegalCourtCode(%q) = %v, want nil", tc.code, err)
			}
		})
	}
}

func TestValidateLegalCourtNameRequiresOneLocale(t *testing.T) {
	if err := validateLegalCourtName("", ""); err == nil {
		t.Fatal("empty name pair accepted; the DB CHECK would have produced a 500 instead")
	} else {
		status, fields := appErrorFields(t, err)
		if status != 422 && status != 400 {
			t.Fatalf("status = %d, want a client-error status", status)
		}
		if fields["name"] != "required" {
			t.Fatalf("fields = %#v, want name=required", fields)
		}
	}

	// Either locale alone is enough: the court list is populated by an admin who
	// may only have the Arabic name to hand.
	if err := validateLegalCourtName("", "المحكمة التجارية"); err != nil {
		t.Fatalf("Arabic-only name rejected: %v", err)
	}
	if err := validateLegalCourtName("Commercial Court", ""); err != nil {
		t.Fatalf("English-only name rejected: %v", err)
	}
}

func TestCreateLegalCourtRequestNormalizeUppercasesCodeAndTrimsNames(t *testing.T) {
	req := dto.CreateLegalCourtRequest{
		Code: "  riyadh_commercial  ",
		Name: forms.LocalizedText{EN: "  Commercial Court  ", AR: "  المحكمة التجارية  "},
	}
	req.Normalize()

	if req.Code != "RIYADH_COMMERCIAL" {
		t.Fatalf("Code = %q, want RIYADH_COMMERCIAL", req.Code)
	}
	if req.Name.EN != "Commercial Court" {
		t.Fatalf("Name.EN = %q", req.Name.EN)
	}
	if req.Name.AR != "المحكمة التجارية" {
		t.Fatalf("Name.AR = %q", req.Name.AR)
	}
	if req.Metadata == nil {
		t.Fatal("Metadata = nil, want an empty map so the JSONB column never receives null")
	}
}

func TestUpdateLegalCourtRequestNormalizeLeavesNilFieldsAlone(t *testing.T) {
	req := dto.UpdateLegalCourtRequest{}
	req.Normalize()

	if req.Code != nil || req.Name != nil || req.Active != nil || req.Sort != nil {
		t.Fatalf("Normalize() populated an omitted field: %#v", req)
	}

	code := "  gc-01 "
	name := forms.LocalizedText{EN: " General Court ", AR: " المحكمة العامة "}
	req = dto.UpdateLegalCourtRequest{Code: &code, Name: &name}
	req.Normalize()
	if *req.Code != "GC-01" {
		t.Fatalf("Code = %q, want GC-01", *req.Code)
	}
	if req.Name.EN != "General Court" || req.Name.AR != "المحكمة العامة" {
		t.Fatalf("Name = %#v", *req.Name)
	}
}
