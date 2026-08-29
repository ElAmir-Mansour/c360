package attestledger

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

// buildChain appends n entries to an in-memory chain using the real LinkEntry,
// returning the linked slice (genesis-first).
func buildChain(t *testing.T, n int) []*Entry {
	t.Helper()
	tenant := uuid.New()
	entries := make([]*Entry, 0, n)
	var prev *Entry
	for i := 0; i < n; i++ {
		e := &Entry{
			TenantID:  tenant,
			EntryType: EntryTypeCleanroomVerdict,
			SubjectID: uuid.New().String(),
		}
		payload := map[string]any{"i": i, "verdict": "clean", "ratio": 0.97}
		if err := LinkEntry(e, payload, prev); err != nil {
			t.Fatalf("LinkEntry[%d]: %v", i, err)
		}
		entries = append(entries, e)
		prev = e
	}
	return entries
}

func TestLinkEntry_GenesisAndLinks(t *testing.T) {
	t.Parallel()
	entries := buildChain(t, 5)

	if entries[0].Seq != 1 {
		t.Fatalf("genesis seq = %d, want 1", entries[0].Seq)
	}
	if entries[0].PrevHash != GenesisPrevHash {
		t.Fatalf("genesis prev_hash = %q, want genesis seed", entries[0].PrevHash)
	}
	for i := 1; i < len(entries); i++ {
		if entries[i].Seq != entries[i-1].Seq+1 {
			t.Fatalf("seq[%d] = %d, not contiguous after %d", i, entries[i].Seq, entries[i-1].Seq)
		}
		// Each entry's prev_hash MUST equal the predecessor's entry_hash.
		if entries[i].PrevHash != entries[i-1].EntryHash {
			t.Fatalf("entry[%d].prev_hash = %q, want predecessor entry_hash %q",
				i, entries[i].PrevHash, entries[i-1].EntryHash)
		}
		// And the entry_hash must be the canonical recomputation of its fields.
		want := ComputeEntryHash(entries[i].Seq, entries[i].EntryType, entries[i].SubjectID,
			entries[i].PayloadHash, entries[i].PrevHash)
		if entries[i].EntryHash != want {
			t.Fatalf("entry[%d].entry_hash = %q, want %q", i, entries[i].EntryHash, want)
		}
	}
}

func TestComputeEntryHash_DeterministicAndSensitive(t *testing.T) {
	t.Parallel()
	base := ComputeEntryHash(1, "cleanroom_verdict", "subj", "payhash", GenesisPrevHash)
	if base != ComputeEntryHash(1, "cleanroom_verdict", "subj", "payhash", GenesisPrevHash) {
		t.Fatal("entry hash is not deterministic")
	}
	// Each field flip must change the hash.
	cases := []string{
		ComputeEntryHash(2, "cleanroom_verdict", "subj", "payhash", GenesisPrevHash),
		ComputeEntryHash(1, "drill_attestation", "subj", "payhash", GenesisPrevHash),
		ComputeEntryHash(1, "cleanroom_verdict", "subj2", "payhash", GenesisPrevHash),
		ComputeEntryHash(1, "cleanroom_verdict", "subj", "payhash2", GenesisPrevHash),
		ComputeEntryHash(1, "cleanroom_verdict", "subj", "payhash", "ff"),
	}
	for i, c := range cases {
		if c == base {
			t.Fatalf("field flip %d did not change entry hash", i)
		}
	}
	// The field separator must prevent boundary-shift collisions:
	// (seq=1, subject="2x") must differ from (seq=12, subject="x") — without a
	// separator these would concatenate to the same preimage prefix.
	a := ComputeEntryHash(1, "t", "2x", "p", "h")
	b := ComputeEntryHash(12, "t", "x", "p", "h")
	if a == b {
		t.Fatal("boundary-shift collision: separator not effective")
	}
}

func TestHashPayload_CanonicalStableAcrossKeyOrder(t *testing.T) {
	t.Parallel()
	// Two semantically-equal payloads with different key order must hash equal.
	a := map[string]any{"b": 2, "a": 1, "nested": map[string]any{"y": "z", "x": "w"}}
	b := map[string]any{"nested": map[string]any{"x": "w", "y": "z"}, "a": 1, "b": 2}
	_, ha, err := HashPayload(a)
	if err != nil {
		t.Fatalf("HashPayload(a): %v", err)
	}
	_, hb, err := HashPayload(b)
	if err != nil {
		t.Fatalf("HashPayload(b): %v", err)
	}
	if ha != hb {
		t.Fatalf("canonical hashes differ for equal payloads: %s vs %s", ha, hb)
	}
	// A real content change must flip the hash.
	c := map[string]any{"a": 1, "b": 3, "nested": map[string]any{"x": "w", "y": "z"}}
	_, hc, _ := HashPayload(c)
	if hc == ha {
		t.Fatal("content change did not flip payload hash")
	}
}

func TestVerifyChain_Intact(t *testing.T) {
	t.Parallel()
	entries := buildChain(t, 8)
	res := VerifyChain(entries)
	if !res.Intact {
		t.Fatalf("clean chain reported broken at seq %d: %s", res.FirstBrokenSeq, res.Reason)
	}
	if res.EntriesChecked != 8 {
		t.Fatalf("entries checked = %d, want 8", res.EntriesChecked)
	}
	if res.HeadHash != entries[len(entries)-1].EntryHash {
		t.Fatalf("head hash mismatch")
	}
}

func TestVerifyChain_EmptyIsIntact(t *testing.T) {
	t.Parallel()
	res := VerifyChain(nil)
	if !res.Intact || res.FirstBrokenSeq != 0 {
		t.Fatalf("empty chain should be intact: %+v", res)
	}
}

func TestVerifyChain_MutatedPayload(t *testing.T) {
	t.Parallel()
	entries := buildChain(t, 6)
	// Tamper with entry seq 4's payload bytes WITHOUT updating the hashes
	// (the realistic "attacker edits the JSONB row" case).
	entries[3].Payload = json.RawMessage(`{"i":3,"ratio":0.97,"verdict":"malware"}`)
	res := VerifyChain(entries)
	if res.Intact {
		t.Fatal("mutated payload not detected")
	}
	if res.FirstBrokenSeq != 4 {
		t.Fatalf("first broken seq = %d, want 4 (%s)", res.FirstBrokenSeq, res.Reason)
	}
}

func TestVerifyChain_MutatedPayloadAndHash(t *testing.T) {
	t.Parallel()
	// A more sophisticated attacker rewrites the payload AND its payload_hash, but
	// cannot fix entry_hash without also breaking the next entry's prev_hash. The
	// recomputed entry_hash check catches the local forge first.
	entries := buildChain(t, 6)
	newPayload := map[string]any{"i": 3, "verdict": "malware", "ratio": 0.97}
	canon, h, err := HashPayload(newPayload)
	if err != nil {
		t.Fatal(err)
	}
	entries[3].Payload = canon
	entries[3].PayloadHash = h // attacker fixes payload_hash to match payload
	// entry_hash still reflects the OLD payload_hash → recompute check fails.
	res := VerifyChain(entries)
	if res.Intact || res.FirstBrokenSeq != 4 {
		t.Fatalf("payload+hash tamper not caught at seq 4: %+v", res)
	}
}

func TestVerifyChain_FullyReforgedEntryBreaksNextLink(t *testing.T) {
	t.Parallel()
	// The strongest local forge: rewrite payload, payload_hash, AND entry_hash of
	// entry 3 so entry 3 is internally consistent. The break then surfaces at
	// entry 4, whose prev_hash no longer equals the forged entry 3 hash.
	entries := buildChain(t, 6)
	newPayload := map[string]any{"i": 2, "verdict": "malware", "ratio": 0.10}
	canon, h, _ := HashPayload(newPayload)
	entries[2].Payload = canon
	entries[2].PayloadHash = h
	entries[2].EntryHash = ComputeEntryHash(entries[2].Seq, entries[2].EntryType,
		entries[2].SubjectID, h, entries[2].PrevHash)
	res := VerifyChain(entries)
	if res.Intact {
		t.Fatal("reforged entry not detected")
	}
	// Entry 3 (seq 3) is now self-consistent; the dangling link is at seq 4.
	if res.FirstBrokenSeq != 4 {
		t.Fatalf("first broken seq = %d, want 4 (%s)", res.FirstBrokenSeq, res.Reason)
	}
}

func TestVerifyChain_SplicedEntry(t *testing.T) {
	t.Parallel()
	// Splice a foreign entry into the middle (reuse a valid-looking entry from a
	// different chain at position 3). Its prev_hash will not match entry 3.
	entries := buildChain(t, 6)
	foreign := buildChain(t, 1)[0]
	foreign.Seq = entries[2].Seq + 1 // pretend it is seq 4
	spliced := make([]*Entry, 0, len(entries))
	spliced = append(spliced, entries[:3]...)
	spliced = append(spliced, foreign)
	spliced = append(spliced, entries[3:]...) // original 4..6 now shifted
	// Fix seqs so the only anomaly is the broken prev_hash link, not a seq gap.
	for i, e := range spliced {
		e.Seq = int64(i + 1)
	}
	res := VerifyChain(spliced)
	if res.Intact {
		t.Fatal("spliced entry not detected")
	}
	if res.FirstBrokenSeq != 4 {
		t.Fatalf("first broken seq = %d, want 4 (%s)", res.FirstBrokenSeq, res.Reason)
	}
}

func TestVerifyChain_DeletedMiddleEntry(t *testing.T) {
	t.Parallel()
	// Delete entry seq 3. The remaining entry that was seq 4 now follows seq 2,
	// so the contiguity check fires at the missing seq 3.
	entries := buildChain(t, 6)
	pruned := make([]*Entry, 0, len(entries)-1)
	pruned = append(pruned, entries[:2]...) // seq 1,2
	pruned = append(pruned, entries[3:]...) // seq 4,5,6 (seq 3 deleted)
	res := VerifyChain(pruned)
	if res.Intact {
		t.Fatal("deleted middle entry not detected")
	}
	if res.FirstBrokenSeq != 3 {
		t.Fatalf("first broken seq = %d, want 3 (%s)", res.FirstBrokenSeq, res.Reason)
	}
}

func TestVerifyChain_DeletedHeadEntry(t *testing.T) {
	t.Parallel()
	// Deleting the genesis entry leaves seq 2 first → genesis-seq check fires.
	entries := buildChain(t, 4)
	res := VerifyChain(entries[1:])
	if res.Intact {
		t.Fatal("deleted genesis entry not detected")
	}
	if res.FirstBrokenSeq != 2 {
		t.Fatalf("first broken seq = %d, want 2 (%s)", res.FirstBrokenSeq, res.Reason)
	}
}

func TestVerifyChain_TamperedGenesisSeed(t *testing.T) {
	t.Parallel()
	entries := buildChain(t, 3)
	entries[0].PrevHash = "1111111111111111111111111111111111111111111111111111111111111111"
	// Recompute entry 0's hash so the only anomaly is the bad genesis seed.
	entries[0].EntryHash = ComputeEntryHash(1, entries[0].EntryType, entries[0].SubjectID,
		entries[0].PayloadHash, entries[0].PrevHash)
	res := VerifyChain(entries)
	if res.Intact || res.FirstBrokenSeq != 1 {
		t.Fatalf("tampered genesis seed not caught at seq 1: %+v", res)
	}
}
