package integration

import (
	"fmt"
	"strings"
)

// =============================================================================
// Nafath Level-of-Assurance (LoA / acr) enforcement.
//
// Design-doc requirement (Lex_Integration_Platform_Design.md, line 52):
//
//	"LoA/acr enforcement for signing/DoA — recommend hard minimum (app-push
//	 number-match), configurable upward."
//
// Nafath authentication contexts (acr / "service" levels) escalate assurance:
//
//	none           - no assurance (rejected for any e-sign basis)
//	single_factor  - knowledge-only (password/OTP) — BELOW the e-sign minimum
//	app_push       - in-app approval WITHOUT number-match (single tap)
//	number_match   - in-app APP-PUSH NUMBER-MATCH (the hard minimum for e-sign)
//	biometric      - in-app biometric / liveness (above minimum)
//
// A Nafath identity confirmation is only a valid BASIS for an identity-confirmed
// signature when its assurance level meets-or-exceeds the configured minimum
// (defaulting to number_match — the app-push number-match the citizen completes
// in the Nafath app). Enforcement is FAIL-CLOSED: an unknown / absent assurance
// level NEVER satisfies the minimum, so a transaction whose acr cannot be proven
// is rejected rather than silently accepted.
//
// This is deliberately independent of the transaction status: a transaction may
// be COMPLETED (verified) yet still fail the LoA gate if it was confirmed at a
// lower assurance than the e-sign basis requires. Status answers "did the citizen
// approve?"; LoA answers "was the approval strong enough to anchor a signature?".
// =============================================================================

// NafathLoA is the normalised Nafath level-of-assurance / authentication-context
// (acr) for an identity-confirmation transaction.
type NafathLoA string

const (
	// NafathLoANone — no proven assurance (absent / unrecognised acr). Fail-closed:
	// never satisfies any positive minimum.
	NafathLoANone NafathLoA = "none"
	// NafathLoASingleFactor — knowledge-only (password / OTP). Below the e-sign
	// minimum.
	NafathLoASingleFactor NafathLoA = "single_factor"
	// NafathLoAAppPush — in-app push approval WITHOUT number-match (single tap).
	NafathLoAAppPush NafathLoA = "app_push"
	// NafathLoANumberMatch — in-app APP-PUSH NUMBER-MATCH (the citizen matches a
	// displayed number in the Nafath app). This is the HARD MINIMUM for using a
	// Nafath confirmation as an e-sign / DoA basis.
	NafathLoANumberMatch NafathLoA = "number_match"
	// NafathLoABiometric — in-app biometric / liveness confirmation (above the
	// minimum).
	NafathLoABiometric NafathLoA = "biometric"
)

// DefaultNafathMinimumLoA is the hard minimum assurance level for treating a
// Nafath confirmation as an e-sign / DoA basis: app-push number-match. Operators
// may raise it (e.g. to biometric) via the endpoint config but never silently
// lower it below this default — see resolveMinimumLoA.
const DefaultNafathMinimumLoA = NafathLoANumberMatch

// nafathLoARank orders assurance levels so a >= comparison can express "meets the
// minimum". Higher is stronger. Unknown levels rank as NafathLoANone (0).
var nafathLoARank = map[NafathLoA]int{
	NafathLoANone:         0,
	NafathLoASingleFactor: 1,
	NafathLoAAppPush:      2,
	NafathLoANumberMatch:  3,
	NafathLoABiometric:    4,
}

// rank returns the comparable strength of the level (0 for unknown).
func (l NafathLoA) rank() int { return nafathLoARank[l] }

// MeetsMinimum reports whether this assurance level meets-or-exceeds min. It is
// fail-closed: NafathLoANone (or any unknown level) only satisfies a NafathLoANone
// minimum, never a positive one.
func (l NafathLoA) MeetsMinimum(min NafathLoA) bool {
	return l.rank() >= min.rank() && l.rank() > 0 || min.rank() == 0 && l.rank() == 0
}

// MapNafathLoA normalises a raw upstream acr / authentication-context / service
// value onto the lex assurance vocabulary. Matching is case-insensitive and
// whitespace/separator tolerant. Anything unrecognised (or empty) maps to
// NafathLoANone — fail-closed, never optimistically upgraded.
//
// Recognised inputs cover the common Nafath / ExtNafath shapes and OIDC acr forms:
//
//	number-match / numbermatch / mfa_number_match / acr "...:numbermatch"  -> number_match
//	biometric / face / liveness / fingerprint                              -> biometric
//	app-push / push / apppush / tap                                        -> app_push
//	otp / sms / password / single / 1fa / loa1                             -> single_factor
//	(empty / unknown)                                                      -> none
func MapNafathLoA(raw string) NafathLoA {
	v := strings.ToLower(strings.TrimSpace(raw))
	if v == "" {
		return NafathLoANone
	}
	// Normalise separators so "number-match", "number_match", "number match" and
	// acr-style "urn:...:numbermatch" all collapse to a comparable token.
	collapsed := strings.NewReplacer("-", "", "_", "", " ", "", ":", "", ".", "").Replace(v)

	switch {
	case strings.Contains(collapsed, "numbermatch"), strings.Contains(collapsed, "numbermatching"):
		return NafathLoANumberMatch
	case strings.Contains(collapsed, "biometric"), strings.Contains(collapsed, "liveness"),
		strings.Contains(collapsed, "face"), strings.Contains(collapsed, "fingerprint"):
		return NafathLoABiometric
	case strings.Contains(collapsed, "apppush"), collapsed == "push", strings.Contains(collapsed, "approval"),
		collapsed == "tap":
		return NafathLoAAppPush
	case strings.Contains(collapsed, "otp"), strings.Contains(collapsed, "sms"),
		strings.Contains(collapsed, "password"), strings.Contains(collapsed, "knowledge"),
		strings.Contains(collapsed, "single"), strings.Contains(collapsed, "1fa"),
		collapsed == "loa1", collapsed == "low":
		return NafathLoASingleFactor
	default:
		return NafathLoANone
	}
}

// extractNafathLoA pulls the assurance level out of an arbitrary upstream
// status/details/webhook body using the tolerant set of keys Nafath / ExtNafath
// surface it under. Absent -> NafathLoANone (fail-closed).
func extractNafathLoA(body map[string]any) NafathLoA {
	if body == nil {
		return NafathLoANone
	}
	for _, k := range []string{
		"loa", "acr", "assurance", "assurance_level", "assuranceLevel",
		"auth_context", "authContext", "authenticationContext",
		"service", "serviceType", "service_type", "auth_method", "authMethod",
	} {
		if v, ok := body[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				if mapped := MapNafathLoA(s); mapped != NafathLoANone {
					return mapped
				}
			}
		}
	}
	return NafathLoANone
}

// resolveMinimumLoA reads the per-endpoint configured minimum assurance level,
// clamped so it can NEVER drop below the DefaultNafathMinimumLoA hard floor
// (app-push number-match). An operator may raise the bar (e.g. require biometric)
// but a misconfigured / lower / unrecognised value silently falls back to the
// secure default rather than weakening the e-sign basis.
func resolveMinimumLoA(cfg nafathConfig) NafathLoA {
	configured := MapNafathLoA(cfg.MinimumLoA)
	if configured.rank() < DefaultNafathMinimumLoA.rank() {
		return DefaultNafathMinimumLoA
	}
	return configured
}

// ErrNafathLoABelowMinimum is returned when a confirmed transaction's assurance
// level is below the configured minimum e-sign basis. It is a fail-closed reject:
// the identity may be confirmed, but not strongly enough to anchor a signature.
type ErrNafathLoABelowMinimum struct {
	Got NafathLoA
	Min NafathLoA
}

func (e ErrNafathLoABelowMinimum) Error() string {
	return fmt.Sprintf("lex/integration/nafath: assurance level %q below required minimum %q for e-sign basis", e.Got, e.Min)
}

// EnforceNafathLoA gates a CONFIRMED transaction against the minimum assurance
// level. It is only meaningful once status==verified; callers pass the verified
// status and the assurance level extracted from the status/details/webhook body.
//
// Returns:
//   - nil when the level meets-or-exceeds the minimum (valid e-sign basis), or
//   - ErrNafathLoABelowMinimum (fail-closed) when it does not, including the
//     case where no assurance level could be proven (got == none).
//
// A non-verified status is not a LoA failure — it is simply not yet a basis — so
// EnforceNafathLoA returns nil for those (the status gate handles them). This
// keeps "did they approve?" (status) and "was it strong enough?" (LoA) cleanly
// separated while still failing closed on a verified-but-weak confirmation.
func EnforceNafathLoA(status NafathVerificationStatus, got, min NafathLoA) error {
	if !status.Confirmed() {
		return nil
	}
	if !got.MeetsMinimum(min) {
		return ErrNafathLoABelowMinimum{Got: got, Min: min}
	}
	return nil
}
