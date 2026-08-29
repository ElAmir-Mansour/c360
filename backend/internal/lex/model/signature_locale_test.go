package model

import "testing"

func bilingualEnvelope() *SignatureEnvelope {
	return &SignatureEnvelope{
		Subject:        "Please sign the Services Agreement",
		Message:        "Kindly review and sign by Friday.",
		SubjectAr:      "يرجى توقيع اتفاقية الخدمات",
		MessageAr:      "نرجو المراجعة والتوقيع قبل يوم الجمعة.",
		LegalConsentEn: "I consent to sign electronically.",
		LegalConsentAr: "أوافق على التوقيع إلكترونياً.",
	}
}

func TestEffectiveLanguage_EnvelopeDefaultAndRecipientOverride(t *testing.T) {
	env := bilingualEnvelope()
	env.Language = SignatureLanguageEN

	// No recipient / no override -> envelope default.
	if got := env.EffectiveLanguage(nil); got != SignatureLanguageEN {
		t.Fatalf("EffectiveLanguage(nil) = %q, want en", got)
	}
	// Recipient override wins.
	ar := SignatureLanguageAR
	if got := env.EffectiveLanguage(&SignatureRecipient{Language: &ar}); got != SignatureLanguageAR {
		t.Fatalf("recipient override = %q, want ar", got)
	}
	// Recipient with no language preference falls back to envelope default.
	if got := env.EffectiveLanguage(&SignatureRecipient{}); got != SignatureLanguageEN {
		t.Fatalf("recipient no-pref = %q, want en", got)
	}
	// Envelope with no language at all defaults to English.
	empty := &SignatureEnvelope{}
	if got := empty.EffectiveLanguage(nil); got != SignatureLanguageEN {
		t.Fatalf("empty envelope = %q, want en default", got)
	}
}

func TestRenderForRecipient_English(t *testing.T) {
	env := bilingualEnvelope()
	env.Language = SignatureLanguageEN
	rendered := env.RenderForRecipient(nil)
	if rendered.Language != SignatureLanguageEN {
		t.Fatalf("language = %q, want en", rendered.Language)
	}
	if rendered.Secondary != nil {
		t.Fatal("english rendering should not carry a secondary block")
	}
	if rendered.Primary.Subject != "Please sign the Services Agreement" {
		t.Fatalf("subject = %q", rendered.Primary.Subject)
	}
	if rendered.Primary.LegalConsent != "I consent to sign electronically." {
		t.Fatalf("consent = %q", rendered.Primary.LegalConsent)
	}
}

func TestRenderForRecipient_Arabic(t *testing.T) {
	env := bilingualEnvelope()
	env.Language = SignatureLanguageEN
	ar := SignatureLanguageAR
	rendered := env.RenderForRecipient(&SignatureRecipient{Language: &ar})
	if rendered.Language != SignatureLanguageAR {
		t.Fatalf("language = %q, want ar", rendered.Language)
	}
	if rendered.Secondary != nil {
		t.Fatal("arabic rendering should not carry a secondary block")
	}
	if rendered.Primary.Subject != "يرجى توقيع اتفاقية الخدمات" {
		t.Fatalf("arabic subject = %q", rendered.Primary.Subject)
	}
	if rendered.Primary.LegalConsent != "أوافق على التوقيع إلكترونياً." {
		t.Fatalf("arabic consent = %q", rendered.Primary.LegalConsent)
	}
}

func TestRenderForRecipient_BilingualReturnsBoth(t *testing.T) {
	env := bilingualEnvelope()
	env.Language = SignatureLanguageBilingual
	rendered := env.RenderForRecipient(nil)
	if rendered.Language != SignatureLanguageBilingual {
		t.Fatalf("language = %q, want bilingual", rendered.Language)
	}
	if rendered.Secondary == nil {
		t.Fatal("bilingual rendering must carry a secondary (English) block")
	}
	// Primary is Arabic (AR-first), Secondary is English.
	if rendered.Primary.Language != SignatureLanguageAR {
		t.Fatalf("primary language = %q, want ar", rendered.Primary.Language)
	}
	if rendered.Secondary.Language != SignatureLanguageEN {
		t.Fatalf("secondary language = %q, want en", rendered.Secondary.Language)
	}
	if rendered.Primary.Subject != "يرجى توقيع اتفاقية الخدمات" {
		t.Fatalf("bilingual AR subject = %q", rendered.Primary.Subject)
	}
	if rendered.Secondary.Subject != "Please sign the Services Agreement" {
		t.Fatalf("bilingual EN subject = %q", rendered.Secondary.Subject)
	}
	// Both consent notices present and distinct.
	if rendered.Primary.LegalConsent == "" || rendered.Secondary.LegalConsent == "" {
		t.Fatal("bilingual rendering must include both AR and EN consent notices")
	}
	if rendered.Primary.LegalConsent == rendered.Secondary.LegalConsent {
		t.Fatal("AR and EN consent notices should differ")
	}
}

func TestRenderForRecipient_DefaultsConsentWhenUnset(t *testing.T) {
	// Envelope without explicit consent notices falls back to the defaults.
	env := &SignatureEnvelope{
		Subject:   "Sign here",
		SubjectAr: "وقّع هنا",
		Language:  SignatureLanguageBilingual,
	}
	rendered := env.RenderForRecipient(nil)
	if rendered.Primary.LegalConsent != DefaultSignatureConsentAR {
		t.Fatalf("AR consent default not applied: %q", rendered.Primary.LegalConsent)
	}
	if rendered.Secondary == nil || rendered.Secondary.LegalConsent != DefaultSignatureConsentEN {
		t.Fatalf("EN consent default not applied: %v", rendered.Secondary)
	}
}

func TestIsValidSignatureLanguage(t *testing.T) {
	valid := []SignatureLanguage{SignatureLanguageEN, SignatureLanguageAR, SignatureLanguageBilingual}
	for _, l := range valid {
		if !IsValidSignatureLanguage(l) {
			t.Fatalf("IsValidSignatureLanguage(%q) = false, want true", l)
		}
	}
	if IsValidSignatureLanguage(SignatureLanguage("fr")) {
		t.Fatal("IsValidSignatureLanguage(fr) = true, want false")
	}
}
