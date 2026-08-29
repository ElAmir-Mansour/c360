package rehearsalproof

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/clario360/platform/internal/recover"
)

// EvidenceReportRefFromRecover pins a Recover evidence report by event id and a
// deterministic SHA-256 of the structured report. It is optional glue for the
// existing recover evidence export; callers can pass the returned ref into
// BuildInput.EvidenceReport without this package reading or mutating recover
// state.
func EvidenceReportRefFromRecover(report *recover.EvidenceReport) (*EvidenceReportRef, error) {
	if report == nil {
		return nil, nil
	}
	b, err := json.Marshal(report)
	if err != nil {
		return nil, fmt.Errorf("rehearsal proof: marshal recover evidence report: %w", err)
	}
	sum := sha256.Sum256(b)
	return &EvidenceReportRef{
		ID:          report.EventID.String(),
		Hash:        "sha256:" + hex.EncodeToString(sum[:]),
		Algorithm:   "sha256",
		GeneratedAt: report.GeneratedAt,
		Source:      "recover_evidence",
	}, nil
}
