package attestledger

import (
	"encoding/hex"
	"testing"
)

// recomputeRootManually rebuilds a Merkle root for small leaf sets independently
// of MerkleRoot, so the test asserts against an explicit construction (not the
// function under test calling itself).
func recomputeRootManually(leaves []string) string {
	level := make([][32]byte, len(leaves))
	for i, l := range leaves {
		level[i] = hashLeaf(l)
	}
	for len(level) > 1 {
		if len(level)%2 == 1 {
			level = append(level, level[len(level)-1])
		}
		next := make([][32]byte, 0, len(level)/2)
		for i := 0; i < len(level); i += 2 {
			next = append(next, hashNode(level[i], level[i+1]))
		}
		level = next
	}
	return hex.EncodeToString(level[0][:])
}

func TestMerkleRoot_KnownTwoLeaves(t *testing.T) {
	t.Parallel()
	leaves := []string{"aa", "bb"}
	want := hashNode(hashLeaf("aa"), hashLeaf("bb"))
	got := MerkleRoot(leaves)
	if got != hex.EncodeToString(want[:]) {
		t.Fatalf("root = %s, want %s", got, hex.EncodeToString(want[:]))
	}
}

func TestMerkleRoot_SingleLeafIsHashedLeaf(t *testing.T) {
	t.Parallel()
	leaf := hashLeaf("only")
	if got := MerkleRoot([]string{"only"}); got != hex.EncodeToString(leaf[:]) {
		t.Fatalf("single-leaf root = %s, want hashLeaf = %s", got, hex.EncodeToString(leaf[:]))
	}
}

func TestMerkleRoot_OddCountDuplicatesLast(t *testing.T) {
	t.Parallel()
	// 3 leaves: level0 = [L(a),L(b),L(c)] -> dup c -> [L(a),L(b),L(c),L(c)]
	// level1 = [N(a,b), N(c,c)] -> root = N(N(a,b), N(c,c))
	leaves := []string{"a", "b", "c"}
	la, lb, lc := hashLeaf("a"), hashLeaf("b"), hashLeaf("c")
	left := hashNode(la, lb)
	right := hashNode(lc, lc)
	want := hashNode(left, right)
	if got := MerkleRoot(leaves); got != hex.EncodeToString(want[:]) {
		t.Fatalf("odd-count root = %s, want %s", got, hex.EncodeToString(want[:]))
	}
	// Cross-check against the independent recompute.
	if got := MerkleRoot(leaves); got != recomputeRootManually(leaves) {
		t.Fatal("odd-count root disagrees with manual recompute")
	}
}

func TestMerkleRoot_Stable(t *testing.T) {
	t.Parallel()
	leaves := []string{"h0", "h1", "h2", "h3", "h4"}
	first := MerkleRoot(leaves)
	for i := 0; i < 10; i++ {
		if MerkleRoot(leaves) != first {
			t.Fatal("Merkle root is not stable across calls")
		}
	}
}

func TestMerkleRoot_EmptyIsZeroHash(t *testing.T) {
	t.Parallel()
	var zero [32]byte
	if MerkleRoot(nil) != hex.EncodeToString(zero[:]) {
		t.Fatal("empty root should be the zero hash")
	}
}

func TestMerkleRoot_OrderSensitive(t *testing.T) {
	t.Parallel()
	if MerkleRoot([]string{"a", "b"}) == MerkleRoot([]string{"b", "a"}) {
		t.Fatal("Merkle root must be order-sensitive")
	}
}

func TestInclusionProof_AllPositions(t *testing.T) {
	t.Parallel()
	// Test every leaf index for several sizes including odd counts.
	for _, n := range []int{1, 2, 3, 4, 5, 7, 8, 9} {
		leaves := make([]string, n)
		for i := range leaves {
			leaves[i] = hex.EncodeToString(hashLeafBytes(byte(i)))
		}
		root := MerkleRoot(leaves)
		for idx := 0; idx < n; idx++ {
			path, proofRoot, err := BuildInclusionProof(leaves, idx)
			if err != nil {
				t.Fatalf("n=%d idx=%d: BuildInclusionProof: %v", n, idx, err)
			}
			if proofRoot != root {
				t.Fatalf("n=%d idx=%d: proof root %s != tree root %s", n, idx, proofRoot, root)
			}
			if !VerifyMerklePath(leaves[idx], path, root) {
				t.Fatalf("n=%d idx=%d: valid inclusion proof failed to verify", n, idx)
			}
		}
	}
}

func TestInclusionProof_NonMemberFails(t *testing.T) {
	t.Parallel()
	leaves := []string{"a", "b", "c", "d", "e"}
	root := MerkleRoot(leaves)
	// A correct path for index 2, but verified against a leaf that is NOT a
	// member, must fail (it reconstructs a different root).
	path, _, err := BuildInclusionProof(leaves, 2)
	if err != nil {
		t.Fatal(err)
	}
	if VerifyMerklePath("not-a-member", path, root) {
		t.Fatal("non-member leaf verified against a member's path")
	}
	// A member leaf with a tampered sibling in the path must also fail.
	tampered := make([]ProofNode, len(path))
	copy(tampered, path)
	if len(tampered) > 0 {
		tampered[0].Hash = hex.EncodeToString(hashLeafBytes(99))
	}
	if VerifyMerklePath(leaves[2], tampered, root) {
		t.Fatal("tampered path verified")
	}
}

func TestVerifyInclusionProof_Wrapper(t *testing.T) {
	t.Parallel()
	leaves := []string{"aa", "bb", "cc", "dd"}
	root := MerkleRoot(leaves)
	path, _, err := BuildInclusionProof(leaves, 1)
	if err != nil {
		t.Fatal(err)
	}
	p := &InclusionProof{Seq: 2, LeafIndex: 1, LeafHash: "bb", Path: path, Root: root}
	if !VerifyInclusionProof(p) {
		t.Fatal("valid InclusionProof did not verify")
	}
	p.Root = MerkleRoot([]string{"x", "y"}) // wrong root
	if VerifyInclusionProof(p) {
		t.Fatal("InclusionProof verified against wrong root")
	}
	if VerifyInclusionProof(nil) {
		t.Fatal("nil proof verified")
	}
}

func TestBuildInclusionProof_OutOfRange(t *testing.T) {
	t.Parallel()
	if _, _, err := BuildInclusionProof(nil, 0); err == nil {
		t.Fatal("expected error for empty leaf set")
	}
	if _, _, err := BuildInclusionProof([]string{"a"}, 1); err == nil {
		t.Fatal("expected error for out-of-range index")
	}
}

// hashLeafBytes is a tiny helper producing distinct 32-byte values for tests.
func hashLeafBytes(b byte) []byte {
	h := hashLeaf(string([]byte{b}))
	return h[:]
}
