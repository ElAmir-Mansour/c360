package integration

import "strings"

// Nafath identity-confirmation status normalisation (e-sign basis).
//
// The Nafath ExtNafath MFA flow surfaces a small set of upstream transaction
// states. Lex normalises them onto a stable, provider-agnostic vocabulary so the
// e-sign / DoA flows that consume identity confirmation never branch on a raw
// vendor string. Nafath CONFIRMS IDENTITY; it is NOT a CA — a "verified" outcome
// means the citizen approved the number-match / biometric challenge, which is the
// BASIS for an identity-confirmed signature, not the signature itself (that pairs
// with a TSP such as emdha). The two states stay deliberately distinct.

// NafathVerificationStatus is the normalised lex-side status for a Nafath
// identity-confirmation transaction.
type NafathVerificationStatus string

const (
	// NafathStatusPending — the citizen has been pushed a challenge and has not
	// yet acted (upstream WAITING). The app should keep polling / await webhook.
	NafathStatusPending NafathVerificationStatus = "pending"
	// NafathStatusVerified — the citizen approved the challenge; identity is
	// confirmed (upstream COMPLETED). This is the basis for identity-confirmed
	// signing, NOT a signature on its own.
	NafathStatusVerified NafathVerificationStatus = "verified"
	// NafathStatusDeclined — the citizen rejected the challenge (upstream
	// REJECTED).
	NafathStatusDeclined NafathVerificationStatus = "declined"
	// NafathStatusExpired — the challenge window lapsed before the citizen acted
	// (upstream EXPIRED).
	NafathStatusExpired NafathVerificationStatus = "expired"
	// NafathStatusError — the transaction failed upstream (upstream ERROR) or the
	// vendor returned an unrecognised state.
	NafathStatusError NafathVerificationStatus = "error"
)

// Upstream ExtNafath transaction states, normalised to upper-case for matching.
const (
	nafathUpstreamWaiting   = "WAITING"
	nafathUpstreamCompleted = "COMPLETED"
	nafathUpstreamRejected  = "REJECTED"
	nafathUpstreamExpired   = "EXPIRED"
	nafathUpstreamError     = "ERROR"
)

// MapNafathStatus normalises a raw upstream Nafath transaction status onto the
// lex vocabulary. The mapping is, per the connector spec:
//
//	WAITING   -> pending
//	COMPLETED -> verified
//	REJECTED  -> declined
//	EXPIRED   -> expired
//	ERROR     -> error
//
// Matching is case-insensitive and whitespace-tolerant. Common vendor synonyms
// are folded in (e.g. "SUCCESS"/"APPROVED" -> verified, "DENIED" -> declined,
// "TIMEOUT" -> expired) so a small contract drift does not silently degrade to
// "error". Any genuinely unknown value maps to error (honest, not faked).
func MapNafathStatus(raw string) NafathVerificationStatus {
	switch strings.ToUpper(strings.TrimSpace(raw)) {
	case nafathUpstreamWaiting, "PENDING", "IN_PROGRESS", "INPROGRESS", "SENT", "PUSHED":
		return NafathStatusPending
	case nafathUpstreamCompleted, "SUCCESS", "SUCCEEDED", "APPROVED", "VERIFIED", "CONFIRMED":
		return NafathStatusVerified
	case nafathUpstreamRejected, "DECLINED", "DENIED", "CANCELLED", "CANCELED":
		return NafathStatusDeclined
	case nafathUpstreamExpired, "TIMEOUT", "TIMED_OUT", "LAPSED":
		return NafathStatusExpired
	case nafathUpstreamError, "FAILED", "FAILURE":
		return NafathStatusError
	default:
		return NafathStatusError
	}
}

// IsTerminal reports whether a normalised status is a settled outcome (no more
// polling). Pending is the only non-terminal state.
func (s NafathVerificationStatus) IsTerminal() bool {
	return s != NafathStatusPending
}

// Confirmed reports whether the status represents a successful identity
// confirmation (the precondition for identity-confirmed signing).
func (s NafathVerificationStatus) Confirmed() bool {
	return s == NafathStatusVerified
}
