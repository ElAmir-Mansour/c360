package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/cleanpoint"
	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/model"
)

// CleanPointScorer scores whether a candidate recovery point carries enough
// clean-room / integrity / ransomware / attestation evidence to be safely
// promoted. *cleanpoint.Scorer satisfies it; it is an interface so the gate can
// be unit-tested with a deterministic clock or a fake decision.
type CleanPointScorer interface {
	Score(ev cleanpoint.RecoveryPointEvidence) cleanpoint.Decision
}

// CleanPointScanner is the optional clean-room malware/integrity scan the gate
// pulls a verdict from at validation time. The DR cleanroom.Service satisfies it
// (the same ScanRecoveryPoint the final-syncer already uses). When it is wired,
// a recovery point cannot be marked promotion-safe unless a clean-room scan
// exists and did not report malware/integrity failure.
type CleanPointScanner interface {
	ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*cleanroom.Scan, error)
}

// cleanPointGate holds the clean-recovery-point promotion gate's dependencies.
// It is opt-in: ValidateRecoveryPoint only runs the gate when the Service has
// one wired (via WithCleanPointGate), so existing wiring that does not set it
// keeps the prior content-hash-only behavior.
type cleanPointGate struct {
	scorer  CleanPointScorer
	scanner CleanPointScanner
}

// WithCleanPointGate wires the clean-recovery-point scorer (and an optional
// clean-room scanner) onto the Service so ValidateRecoveryPoint refuses to mark
// a compromised recovery point promotion-safe. A nil scorer defaults to the
// production cleanpoint.Scorer with the service clock. When scanner is non-nil,
// the gate pulls the clean-room malware/integrity verdict for the point; when it
// is nil, the gate scores on the signals already available at validation time
// (content-hash integrity, seal/immutability, RPO) and treats missing clean-room
// evidence conservatively (never a clean pass). Returns the Service for chaining.
func (s *Service) WithCleanPointGate(scorer CleanPointScorer, scanner CleanPointScanner) *Service {
	if scorer == nil {
		scorer = cleanpoint.NewScorer(s.now)
	}
	s.cleanpoint = &cleanPointGate{scorer: scorer, scanner: scanner}
	return s
}

// evaluateCleanPoint builds a RecoveryPointEvidence from the signals available
// at validation time, scores it, and returns the decision. matchRatio is the
// re-derived content-hash match ratio; a ratio below the GA threshold is an
// integrity mismatch.
//
// Fail-safe: any missing required proof (a missing clean-room verdict, an
// unverified seal, an integrity mismatch) becomes a not-clean decision rather
// than a silent pass, per the scorer's conservative zero-value handling.
func (s *Service) evaluateCleanPoint(
	ctx context.Context,
	tenantID uuid.UUID,
	point *model.RecoveryPoint,
	matchRatio float64,
) (cleanpoint.Decision, error) {
	now := s.now().UTC()

	ev := cleanpoint.RecoveryPointEvidence{
		RecoveryPointID: point.ID,
		GroupID:         point.GroupID,
		CreatedAt:       point.SealedAt.UTC(),

		// The re-derived content-hash chain is the integrity proof: a match ratio
		// below the GA acceptance floor means the sealed bytes no longer chain to
		// the recorded content hash.
		IntegrityMismatch: matchRatio < core.ValidationThreshold,

		// A sealed recovery point is written through the WORM object-lock store
		// (GOVERNANCE retain-until, per-tenant DEK). Sealing succeeded for any row
		// that exists, and the content-hash re-derivation above verified the
		// sealed ciphertext still decrypts to the sealed bytes.
		Sealed:         true,
		SealVerified:   matchRatio >= core.ValidationThreshold,
		Immutable:      true,
		RetentionUntil: point.RetentionUntil.UTC(),

		// Attestation for the promotion gate is the successful re-validation of the
		// sealed content at scan time.
		AttestationVerified: matchRatio >= core.ValidationThreshold,
		AttestedAt:          now,
	}

	// Pull the clean-room malware/integrity verdict when a scanner is wired. This
	// is the ransomware-safe signal: a malware or integrity-failed verdict
	// quarantines the point; an error/absent verdict is not-clean (retest), never
	// a silent pass.
	if s.cleanpoint != nil && s.cleanpoint.scanner != nil {
		pointID, err := uuid.Parse(point.ID)
		if err != nil {
			return cleanpoint.Decision{}, err
		}
		scan, err := s.cleanpoint.scanner.ScanRecoveryPoint(ctx, tenantID, pointID)
		if err != nil {
			return cleanpoint.Decision{}, err
		}
		ev.CleanRoomVerdict = cleanRoomVerdict(scan)
		ev.AppVerificationVerdict = appVerificationFromScan(scan)
		if scan != nil {
			ev.RansomwareSuspected = scan.Verdict == cleanroom.VerdictMalware
			for _, f := range scan.Findings {
				if !f.Clean && f.Threat != "" {
					ev.MalwareFindings = append(ev.MalwareFindings, f.Threat)
				}
			}
			if !scan.FinishedAt.IsZero() {
				ev.CleanRoomFinishedAt = scan.FinishedAt.UTC()
			}
		}
	}

	return s.cleanpoint.scorer.Score(ev), nil
}

// cleanRoomVerdict maps a DR clean-room scan verdict onto the cleanpoint
// scorer's normalized verdict. A nil scan (no scan yet) maps to the empty
// verdict, which the scorer treats as missing required proof — not clean.
func cleanRoomVerdict(scan *cleanroom.Scan) cleanpoint.CleanRoomVerdict {
	if scan == nil {
		return ""
	}
	switch scan.Verdict {
	case cleanroom.VerdictClean:
		return cleanpoint.CleanRoomVerdictClean
	case cleanroom.VerdictMalware:
		return cleanpoint.CleanRoomVerdictMalware
	case cleanroom.VerdictIntegrityFailed:
		return cleanpoint.CleanRoomVerdictIntegrityFailed
	case cleanroom.VerdictError:
		return cleanpoint.CleanRoomVerdictError
	default:
		return cleanpoint.CleanRoomVerdict(scan.Verdict)
	}
}

// appVerificationFromScan derives the application-verification verdict from a
// clean room scan: a clean scan restored and exercised every chunk, so the
// recovered application surface verified; any other terminal verdict means the
// application could not be trusted from this point.
func appVerificationFromScan(scan *cleanroom.Scan) cleanpoint.AppVerificationVerdict {
	if scan == nil {
		return ""
	}
	if scan.Verdict == cleanroom.VerdictClean {
		return cleanpoint.AppVerificationPassed
	}
	return cleanpoint.AppVerificationFailed
}

// cleanPointPromotable reports whether a scored decision permits marking the
// recovery point promotion-safe. Only an unqualified clean promote (or a
// promote-with-warnings, where the blocking controls all passed) is safe;
// quarantine (dirty/malicious) and retest (missing/failed required proof) both
// refuse promotion so a compromised or unverified point is never silently
// promoted.
func cleanPointPromotable(kind cleanpoint.DecisionKind) bool {
	switch kind {
	case cleanpoint.DecisionPromote, cleanpoint.DecisionPromoteWithWarnings:
		return true
	default:
		return false
	}
}

// cleanPointReasons flattens a decision's reasons into a compact ordered list
// suitable for the validated outbox event / audit trail.
func cleanPointReasons(dec cleanpoint.Decision) []map[string]any {
	if len(dec.Reasons) == 0 {
		return nil
	}
	out := make([]map[string]any, 0, len(dec.Reasons))
	for _, r := range dec.Reasons {
		out = append(out, map[string]any{
			"code":     r.Code,
			"kind":     string(r.Kind),
			"severity": string(r.Severity),
			"message":  r.Message,
		})
	}
	return out
}
