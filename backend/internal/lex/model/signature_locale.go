package model

import "strings"

// LocalizedText holds the rendered signing strings for a single locale.
type LocalizedText struct {
	Language     SignatureLanguage `json:"language"`
	Subject      string            `json:"subject"`
	Message      string            `json:"message"`
	LegalConsent string            `json:"legal_consent"`
}

// RenderedSignatureText is the bilingual-aware rendering of an envelope's signing
// content for a specific recipient (WTQ-SIG-01). For en/ar it carries a single
// localized block; for bilingual it carries both AR and EN.
type RenderedSignatureText struct {
	Language SignatureLanguage `json:"language"`
	// Primary is the recipient's effective-language block. For bilingual it is
	// the Arabic block (AR-first presentation, the KSA convention).
	Primary LocalizedText `json:"primary"`
	// Secondary is populated ONLY for bilingual rendering (the English block).
	Secondary *LocalizedText `json:"secondary,omitempty"`
}

// EffectiveLanguage returns the language that applies to a recipient: the
// recipient's per-recipient preference when set, otherwise the envelope default.
// An envelope with no language defaults to English.
func (e *SignatureEnvelope) EffectiveLanguage(recipient *SignatureRecipient) SignatureLanguage {
	if recipient != nil && recipient.Language != nil && IsValidSignatureLanguage(*recipient.Language) {
		return *recipient.Language
	}
	if e != nil && IsValidSignatureLanguage(e.Language) {
		return e.Language
	}
	return SignatureLanguageEN
}

// localizedBlock builds the localized strings for a single concrete locale
// (en or ar) from the envelope's stored content, falling back across languages
// and to default consent notices so a block is never empty.
func (e *SignatureEnvelope) localizedBlock(lang SignatureLanguage) LocalizedText {
	subjectEN := strings.TrimSpace(e.Subject)
	messageEN := strings.TrimSpace(e.Message)
	subjectAR := strings.TrimSpace(e.SubjectAr)
	messageAR := strings.TrimSpace(e.MessageAr)
	consentEN := strings.TrimSpace(e.LegalConsentEn)
	if consentEN == "" {
		consentEN = DefaultSignatureConsentEN
	}
	consentAR := strings.TrimSpace(e.LegalConsentAr)
	if consentAR == "" {
		consentAR = DefaultSignatureConsentAR
	}

	switch lang {
	case SignatureLanguageAR:
		return LocalizedText{
			Language:     SignatureLanguageAR,
			Subject:      firstNonEmpty(subjectAR, subjectEN),
			Message:      firstNonEmpty(messageAR, messageEN),
			LegalConsent: consentAR,
		}
	default: // English
		return LocalizedText{
			Language:     SignatureLanguageEN,
			Subject:      firstNonEmpty(subjectEN, subjectAR),
			Message:      firstNonEmpty(messageEN, messageAR),
			LegalConsent: consentEN,
		}
	}
}

// RenderForRecipient resolves the correct-language signing subject, message, and
// legal-consent notice for a recipient. For en/ar it returns that locale; for
// bilingual it returns both AR (primary) and EN (secondary).
func (e *SignatureEnvelope) RenderForRecipient(recipient *SignatureRecipient) RenderedSignatureText {
	lang := e.EffectiveLanguage(recipient)
	if lang == SignatureLanguageBilingual {
		ar := e.localizedBlock(SignatureLanguageAR)
		en := e.localizedBlock(SignatureLanguageEN)
		return RenderedSignatureText{
			Language:  SignatureLanguageBilingual,
			Primary:   ar,
			Secondary: &en,
		}
	}
	return RenderedSignatureText{
		Language: lang,
		Primary:  e.localizedBlock(lang),
	}
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
