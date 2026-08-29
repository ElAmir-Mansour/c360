package service

import (
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// IntakeClassification is the CAP-003 rules-classifier output: the resolved
// request_type, an optional beneficiary entity code parsed from the message, and
// a human-readable reason describing which rule fired (recorded on the intake
// message for audit).
type IntakeClassification struct {
	ServiceID       uuid.UUID
	ServiceCode     string
	RequestType     string
	BeneficiaryCode string
	Reason          string
	Matched         bool
}

// classifierKeywordTokenPattern extracts lowercase alnum tokens from free text.
var classifierKeywordTokenPattern = regexp.MustCompile(`[a-z0-9]+`)

// beneficiaryCodePattern recognizes an explicit "[CODE: XYZ]" or "ref: XYZ"
// beneficiary marker an upstream mailer or sender may embed in the subject/body.
var beneficiaryCodePattern = regexp.MustCompile(`(?i)\[?\s*(?:code|ref|entity)\s*[:=]\s*([A-Za-z0-9_\-]{2,32})\s*\]?`)

// intakeClassifier is a deterministic, rules-based CAP-003 classifier. It maps a
// message's subject + body to a request_type by keyword match against the
// active service catalog (a service's code/request_type/name keywords define its
// trigger set), falling back to the addressed mailbox's default request_type.
// It is intentionally NOT an ML model: classification must be explainable and
// reproducible for legal-intake audit.
type intakeClassifier struct {
	defaultRequestType string
}

func newIntakeClassifier(defaultRequestType string) *intakeClassifier {
	return &intakeClassifier{defaultRequestType: strings.TrimSpace(defaultRequestType)}
}

// Classify runs the rules over a message. services is the active catalog used to
// derive request-type keyword triggers; mailboxService is the addressed
// mailbox's default request_type (always wins as the fallback so a message is
// never left unrouted).
func (c *intakeClassifier) Classify(subject, body string, services []model.ServiceCatalogEntry) IntakeClassification {
	text := strings.ToLower(strings.TrimSpace(subject + " " + body))
	tokens := tokenSet(classifierKeywordTokenPattern.FindAllString(text, -1))

	beneficiary := ""
	if m := beneficiaryCodePattern.FindStringSubmatch(subject + " " + body); len(m) == 2 {
		beneficiary = strings.ToUpper(strings.TrimSpace(m[1]))
	}

	// Score each active, email-reachable service by keyword overlap. The service
	// with the most matched trigger tokens (and at least one) wins.
	bestType := ""
	bestCode := ""
	bestID := uuid.Nil
	bestScore := 0
	for _, svc := range services {
		if !svc.Active || !svc.Channel.AcceptsEmail() {
			continue
		}
		score := 0
		for _, trigger := range serviceTriggerTokens(svc) {
			if _, ok := tokens[trigger]; ok {
				score++
			}
		}
		if score > bestScore {
			bestScore = score
			bestID = svc.ID
			bestType = svc.RequestType
			bestCode = svc.Code
		}
	}

	if bestScore > 0 {
		return IntakeClassification{
			ServiceID:       bestID,
			ServiceCode:     bestCode,
			RequestType:     bestType,
			BeneficiaryCode: beneficiary,
			Reason:          "keyword_match:service=" + bestCode,
			Matched:         true,
		}
	}

	if c.defaultRequestType != "" {
		return IntakeClassification{
			RequestType:     c.defaultRequestType,
			BeneficiaryCode: beneficiary,
			Reason:          "mailbox_default",
			Matched:         true,
		}
	}

	return IntakeClassification{
		BeneficiaryCode: beneficiary,
		Reason:          "no_rule_matched",
		Matched:         false,
	}
}

// serviceTriggerTokens derives the keyword trigger set for a service from its
// code, request_type, and bilingual name. Tokens shorter than 3 chars are
// dropped to avoid trivial matches.
func serviceTriggerTokens(svc model.ServiceCatalogEntry) []string {
	fields := []string{svc.Code, svc.RequestType, svc.Name.EN, svc.Name.AR}
	return tokenList(classifierKeywordTokenPattern.FindAllString(strings.ToLower(strings.Join(fields, " ")), -1))
}

func tokenSet(raw []string) map[string]struct{} {
	out := make(map[string]struct{}, len(raw))
	for _, token := range raw {
		if len(token) < 3 {
			continue
		}
		out[token] = struct{}{}
	}
	return out
}

func tokenList(raw []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(raw))
	for _, token := range raw {
		if len(token) < 3 {
			continue
		}
		if _, ok := seen[token]; ok {
			continue
		}
		seen[token] = struct{}{}
		out = append(out, token)
	}
	return out
}
