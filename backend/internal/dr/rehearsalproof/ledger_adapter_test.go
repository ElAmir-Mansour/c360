package rehearsalproof

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/attestledger"
)

type recordingRecorder struct {
	req   attestledger.AppendRequest
	entry *attestledger.Entry
}

func (r *recordingRecorder) Append(_ context.Context, req attestledger.AppendRequest) (*attestledger.Entry, error) {
	r.req = req
	if r.entry == nil {
		r.entry = &attestledger.Entry{Seq: 7, EntryHash: "deadbeef"}
	}
	return r.entry, nil
}

func TestLedgerRecorderAdapter_AnchorsProofIntoChain(t *testing.T) {
	rec := &recordingRecorder{}
	adapter := &LedgerRecorderAdapter{rec: rec}

	tenantID := uuid.New()
	seq, hash, err := adapter.AnchorProof(context.Background(), AnchorInput{
		TenantID:      tenantID,
		SubjectKind:   SubjectKindFailoverDrill,
		SubjectRunID:  "run-123",
		EnvelopeHash:  "sha256:abc",
		Signature:     "sig",
		SignatureAlg:  SigAlgRSASHA256,
		WORMObjectKey: "worm/key",
	})
	if err != nil {
		t.Fatalf("anchor: %v", err)
	}
	if seq != 7 || hash != "deadbeef" {
		t.Fatalf("unexpected inclusion ref seq=%d hash=%q", seq, hash)
	}
	// The proof is anchored under an existing, DB-allowed ledger entry type so no
	// new entry type is introduced into the chain.
	if rec.req.EntryType != attestledger.EntryTypeRecoverEvidenceReport {
		t.Fatalf("unexpected entry type %q", rec.req.EntryType)
	}
	if rec.req.TenantID != tenantID {
		t.Fatalf("tenant not propagated")
	}
	if rec.req.SubjectID != "rehearsal_proof:failover_drill:run-123" {
		t.Fatalf("unexpected subject id %q", rec.req.SubjectID)
	}
	payload, ok := rec.req.Payload.(map[string]any)
	if !ok {
		t.Fatalf("payload is not a map: %T", rec.req.Payload)
	}
	if payload["envelope_hash"] != "sha256:abc" || payload["worm_object_key"] != "worm/key" {
		t.Fatalf("payload missing sealed evidence: %+v", payload)
	}
}
