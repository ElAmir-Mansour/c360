package byok

import (
	"crypto/sha256"
	"encoding/hex"
	"testing"

	"github.com/google/uuid"
)

// buildChain produces a valid hash-chained custody slice of n entries for a
// tenant, exactly as the Service's appendCustody would: each entry's PrevHash is
// the prior EntryHash and its EntryHash = ComputeEntryHash(prev, entry).
func buildChain(tenant uuid.UUID, n int) []*CustodyEntry {
	var out []*CustodyEntry
	prev := ""
	for i := 1; i <= n; i++ {
		e := &CustodyEntry{
			TenantID:   tenant,
			Seq:        int64(i),
			Action:     ActionWrap,
			KEKVersion: 1,
			DEKID:      "dek-" + uuid.NewString(),
			Detail:     "wrapped DEK",
			PrevHash:   prev,
		}
		e.EntryHash = ComputeEntryHash(prev, e)
		out = append(out, e)
		prev = e.EntryHash
	}
	return out
}

// TestComputeEntryHash_Deterministic proves the entry hash is a pure function of
// the semantic fields (same inputs -> same hash; any field change -> different).
func TestComputeEntryHash_Deterministic(t *testing.T) {
	tenant := uuid.New()
	base := &CustodyEntry{TenantID: tenant, Seq: 7, Action: ActionRotateBegin, KEKVersion: 3, DEKID: "d1", Detail: "x"}
	h1 := ComputeEntryHash("prev", base)
	h2 := ComputeEntryHash("prev", base)
	if h1 != h2 {
		t.Fatalf("hash not deterministic: %s vs %s", h1, h2)
	}
	if len(h1) != hex.EncodedLen(sha256.Size) {
		t.Fatalf("hash is not a sha256 hex digest: len=%d", len(h1))
	}

	// Changing any contributing field changes the hash.
	mutators := []func(*CustodyEntry){
		func(e *CustodyEntry) { e.Seq = 8 },
		func(e *CustodyEntry) { e.Action = ActionRewrap },
		func(e *CustodyEntry) { e.KEKVersion = 4 },
		func(e *CustodyEntry) { e.DEKID = "d2" },
		func(e *CustodyEntry) { e.Detail = "y" },
	}
	for i, mut := range mutators {
		c := *base
		mut(&c)
		if ComputeEntryHash("prev", &c) == h1 {
			t.Fatalf("mutator %d did not change the hash", i)
		}
	}
	// Changing prev changes the hash (chain linkage).
	if ComputeEntryHash("other", base) == h1 {
		t.Fatalf("prevHash did not influence the hash")
	}
}

// TestComputeEntryHash_LengthPrefixInjective proves the length-prefix framing
// prevents field-boundary collisions: ("ab","c") must not collide with ("a","bc").
func TestComputeEntryHash_LengthPrefixInjective(t *testing.T) {
	tenant := uuid.New()
	a := &CustodyEntry{TenantID: tenant, Seq: 1, Action: "wrap", DEKID: "ab", Detail: "c"}
	b := &CustodyEntry{TenantID: tenant, Seq: 1, Action: "wrap", DEKID: "a", Detail: "bc"}
	if ComputeEntryHash("", a) == ComputeEntryHash("", b) {
		t.Fatalf("field-boundary collision: framing is not injective")
	}
}

// TestVerifyChain proves an intact chain verifies and any tamper is detected at
// the right sequence.
func TestVerifyChain(t *testing.T) {
	tenant := uuid.New()

	t.Run("empty chain is valid", func(t *testing.T) {
		ok, broken := VerifyChain(nil)
		if !ok || broken != 0 {
			t.Fatalf("empty chain should be valid, got ok=%v broken=%d", ok, broken)
		}
	})

	t.Run("intact chain verifies", func(t *testing.T) {
		chain := buildChain(tenant, 5)
		ok, broken := VerifyChain(chain)
		if !ok || broken != 0 {
			t.Fatalf("intact chain should verify, got ok=%v broken=%d", ok, broken)
		}
	})

	t.Run("mutated detail breaks chain", func(t *testing.T) {
		chain := buildChain(tenant, 5)
		chain[2].Detail = "TAMPERED" // EntryHash no longer matches recomputation
		ok, broken := VerifyChain(chain)
		if ok || broken != chain[2].Seq {
			t.Fatalf("expected break at seq %d, got ok=%v broken=%d", chain[2].Seq, ok, broken)
		}
	})

	t.Run("deleted middle entry breaks linkage", func(t *testing.T) {
		chain := buildChain(tenant, 5)
		// Remove entry index 2; the next entry's PrevHash no longer matches.
		broken := append(chain[:2:2], chain[3:]...)
		ok, brokenSeq := VerifyChain(broken)
		if ok {
			t.Fatalf("deleting an entry should break the chain")
		}
		if brokenSeq != chain[3].Seq {
			t.Fatalf("expected break at seq %d, got %d", chain[3].Seq, brokenSeq)
		}
	})

	t.Run("reordered entries break linkage", func(t *testing.T) {
		chain := buildChain(tenant, 4)
		chain[1], chain[2] = chain[2], chain[1]
		if ok, _ := VerifyChain(chain); ok {
			t.Fatalf("reordered chain should not verify")
		}
	})
}

// TestMerkleRoot proves the Merkle fold is deterministic, sensitive to any leaf
// change, and handles odd leaf counts (lone node promotion).
func TestMerkleRoot(t *testing.T) {
	tenant := uuid.New()

	t.Run("empty is sha256 of empty", func(t *testing.T) {
		sum := sha256.Sum256(nil)
		if MerkleRoot(nil) != hex.EncodeToString(sum[:]) {
			t.Fatalf("empty Merkle root mismatch")
		}
	})

	t.Run("deterministic", func(t *testing.T) {
		chain := buildChain(tenant, 5) // odd count exercises promotion
		if MerkleRoot(chain) != MerkleRoot(chain) {
			t.Fatalf("Merkle root not deterministic")
		}
	})

	t.Run("single leaf equals that leaf hash", func(t *testing.T) {
		chain := buildChain(tenant, 1)
		raw, _ := hex.DecodeString(chain[0].EntryHash)
		if MerkleRoot(chain) != hex.EncodeToString(raw) {
			t.Fatalf("single-leaf root should equal the leaf hash")
		}
	})

	t.Run("changing any leaf changes the root", func(t *testing.T) {
		chain := buildChain(tenant, 6)
		root := MerkleRoot(chain)
		for i := range chain {
			c := cloneChain(chain)
			// Recompute the i-th leaf hash with a mutated field.
			c[i].Detail = "changed"
			c[i].EntryHash = ComputeEntryHash(c[i].PrevHash, c[i])
			if MerkleRoot(c) == root {
				t.Fatalf("changing leaf %d did not change the Merkle root", i)
			}
		}
	})

	t.Run("known 2-leaf root", func(t *testing.T) {
		chain := buildChain(tenant, 2)
		l0, _ := hex.DecodeString(chain[0].EntryHash)
		l1, _ := hex.DecodeString(chain[1].EntryHash)
		h := sha256.New()
		h.Write(l0)
		h.Write(l1)
		if MerkleRoot(chain) != hex.EncodeToString(h.Sum(nil)) {
			t.Fatalf("2-leaf Merkle root mismatch")
		}
	})
}

func cloneChain(in []*CustodyEntry) []*CustodyEntry {
	out := make([]*CustodyEntry, len(in))
	for i, e := range in {
		c := *e
		out[i] = &c
	}
	return out
}
