package rehearsalproof

import (
	"context"
	"errors"

	"github.com/clario360/platform/internal/dr/attestledger"
)

// recorder is the subset of attestledger.Recorder the ledger adapter needs.
// *attestledger.Recorder satisfies it directly; tests supply a fake.
type recorder interface {
	Append(ctx context.Context, req attestledger.AppendRequest) (*attestledger.Entry, error)
}

// LedgerRecorderAdapter satisfies LedgerAnchor by appending the sealed proof into
// the tamper-evident attestation ledger via attestledger.Recorder.Append. The
// proof is recorded under the existing recover_evidence_report entry type (a
// generated, WORM-sealed evidence document) so it joins the same per-tenant
// hash-chained, Merkle-anchored chain as Gate-4 failover/drill attestations — no
// new ledger entry type is introduced. The append allocates the monotonic seq
// under a row lock and links the entry to the chain head, so the returned seq +
// entry_hash are the proof's inclusion reference into the chain the anchor loop
// later seals to WORM.
type LedgerRecorderAdapter struct {
	rec recorder
}

// NewLedgerRecorderAdapter wraps an attestledger.Recorder as a LedgerAnchor.
func NewLedgerRecorderAdapter(rec *attestledger.Recorder) (*LedgerRecorderAdapter, error) {
	if rec == nil {
		return nil, errors.New("rehearsal proof: nil attestation ledger recorder")
	}
	return &LedgerRecorderAdapter{rec: rec}, nil
}

// AnchorProof appends the proof to the ledger and returns its seq + entry hash.
func (a *LedgerRecorderAdapter) AnchorProof(ctx context.Context, in AnchorInput) (int64, string, error) {
	if a == nil || a.rec == nil {
		return 0, "", ErrNoLedger
	}
	entry, err := a.rec.Append(ctx, attestledger.AppendRequest{
		TenantID:  in.TenantID,
		EntryType: attestledger.EntryTypeRecoverEvidenceReport,
		SubjectID: proofLedgerSubjectID(in.SubjectKind, in.SubjectRunID),
		Payload: map[string]any{
			"kind":            "rehearsal_proof",
			"subject_kind":    in.SubjectKind,
			"subject_run_id":  in.SubjectRunID,
			"envelope_hash":   in.EnvelopeHash,
			"signature":       in.Signature,
			"signature_alg":   in.SignatureAlg,
			"worm_object_key": in.WORMObjectKey,
		},
	})
	if err != nil {
		return 0, "", err
	}
	return entry.Seq, entry.EntryHash, nil
}

// proofLedgerSubjectID namespaces the ledger subject so proof entries are
// distinguishable from raw run/attestation subjects when an auditor filters the
// chain by subject_id.
func proofLedgerSubjectID(kind, runID string) string {
	return "rehearsal_proof:" + kind + ":" + runID
}
