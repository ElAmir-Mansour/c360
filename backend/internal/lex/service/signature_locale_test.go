package service

import (
	"errors"
	"testing"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func baseLocaleRequest() dto.CreateSignatureEnvelopeRequest {
	contractID := uuid.New()
	email := "signer@example.com"
	return dto.CreateSignatureEnvelopeRequest{
		Title:      "Signature pack",
		ContractID: &contractID,
		Provider:   model.SignatureProviderNative,
		Method:     model.SignatureMethodOTP,
		Recipients: []dto.CreateSignatureRecipientRequest{{Name: "Signer", Email: &email}},
	}
}

func TestSignatureRequest_NormalizeDefaultsLanguageToEnglish(t *testing.T) {
	req := baseLocaleRequest()
	req.Normalize()
	if req.Language != model.SignatureLanguageEN {
		t.Fatalf("default language = %q, want en", req.Language)
	}
}

func TestSignatureRequest_NormalizeLowercasesLanguages(t *testing.T) {
	req := baseLocaleRequest()
	req.Language = model.SignatureLanguage("BILINGUAL")
	upper := model.SignatureLanguage("AR")
	req.Recipients[0].Language = &upper
	req.Normalize()
	if req.Language != model.SignatureLanguageBilingual {
		t.Fatalf("envelope language = %q, want bilingual", req.Language)
	}
	if req.Recipients[0].Language == nil || *req.Recipients[0].Language != model.SignatureLanguageAR {
		t.Fatalf("recipient language = %v, want ar", req.Recipients[0].Language)
	}
}

func TestValidateCreateSignatureEnvelopeRequest_AcceptsEachLocale(t *testing.T) {
	for _, lang := range []model.SignatureLanguage{
		model.SignatureLanguageEN, model.SignatureLanguageAR, model.SignatureLanguageBilingual,
	} {
		req := baseLocaleRequest()
		req.Language = lang
		req.Normalize()
		if err := validateCreateSignatureEnvelopeRequest(req); err != nil {
			t.Fatalf("locale %q rejected: %v", lang, err)
		}
	}
}

func TestValidateCreateSignatureEnvelopeRequest_RejectsInvalidLanguage(t *testing.T) {
	req := baseLocaleRequest()
	req.Language = model.SignatureLanguage("fr")
	req.Normalize()
	err := validateCreateSignatureEnvelopeRequest(req)
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Fields["language"] == "" {
		t.Fatalf("expected invalid language validation error, got %v", err)
	}
}

func TestValidateCreateSignatureEnvelopeRequest_RejectsInvalidRecipientLanguage(t *testing.T) {
	req := baseLocaleRequest()
	bad := model.SignatureLanguage("de")
	req.Recipients[0].Language = &bad
	req.Normalize()
	err := validateCreateSignatureEnvelopeRequest(req)
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("expected validation error, got %v", err)
	}
	if appErr.Fields["recipients.language"] == "" {
		t.Fatalf("expected recipient language error, fields = %#v", appErr.Fields)
	}
}
