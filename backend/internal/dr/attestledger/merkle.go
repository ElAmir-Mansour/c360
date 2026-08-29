package attestledger

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
)

// Merkle domain-separation prefixes. Prefixing leaf and internal-node preimages
// with distinct bytes prevents second-preimage attacks where an attacker
// presents an internal node as a leaf (RFC 6962 style). Leaves are 0x00-tagged,
// internal nodes 0x01-tagged.
var (
	merkleLeafPrefix = []byte{0x00}
	merkleNodePrefix = []byte{0x01}
)

// hashLeaf hashes a leaf value (an entry_hash hex string). The entry_hash hex is
// hashed as bytes so the Merkle tree is over the chain's link hashes.
func hashLeaf(leaf string) [32]byte {
	h := sha256.New()
	_, _ = h.Write(merkleLeafPrefix)
	_, _ = h.Write([]byte(leaf))
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// hashNode hashes the concatenation of two child hashes.
func hashNode(left, right [32]byte) [32]byte {
	h := sha256.New()
	_, _ = h.Write(merkleNodePrefix)
	_, _ = h.Write(left[:])
	_, _ = h.Write(right[:])
	var out [32]byte
	copy(out[:], h.Sum(nil))
	return out
}

// MerkleRoot computes the Merkle root over leaves (each an entry_hash hex
// string). Odd levels duplicate the last node ("duplicate-last"), the common
// Bitcoin/RFC-style convention, so every level is even before pairing. The root
// is returned as a hex string. An empty leaf set returns the zero hash so the
// root of "nothing" is well-defined and stable.
func MerkleRoot(leaves []string) string {
	if len(leaves) == 0 {
		var zero [32]byte
		return hex.EncodeToString(zero[:])
	}
	level := make([][32]byte, len(leaves))
	for i, l := range leaves {
		level[i] = hashLeaf(l)
	}
	for len(level) > 1 {
		// Duplicate the last node when the count is odd.
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

// BuildInclusionProof produces the Merkle authentication path for the leaf at
// index within leaves, using the same duplicate-last construction as
// MerkleRoot. The returned path is ordered leaf→root; each node records whether
// the sibling is on the left so VerifyMerklePath can rebuild the root in the
// correct order. It errors when index is out of range or leaves is empty.
func BuildInclusionProof(leaves []string, index int) ([]ProofNode, string, error) {
	if len(leaves) == 0 {
		return nil, "", errors.New("attestledger: cannot build proof over empty leaf set")
	}
	if index < 0 || index >= len(leaves) {
		return nil, "", fmt.Errorf("attestledger: leaf index %d out of range [0,%d)", index, len(leaves))
	}
	level := make([][32]byte, len(leaves))
	for i, l := range leaves {
		level[i] = hashLeaf(l)
	}
	var path []ProofNode
	idx := index
	for len(level) > 1 {
		if len(level)%2 == 1 {
			level = append(level, level[len(level)-1])
		}
		var sibling [32]byte
		var siblingLeft bool
		if idx%2 == 0 {
			// idx is a left child; sibling is on the right.
			sibling = level[idx+1]
			siblingLeft = false
		} else {
			// idx is a right child; sibling is on the left.
			sibling = level[idx-1]
			siblingLeft = true
		}
		path = append(path, ProofNode{Hash: hex.EncodeToString(sibling[:]), Left: siblingLeft})

		next := make([][32]byte, 0, len(level)/2)
		for i := 0; i < len(level); i += 2 {
			next = append(next, hashNode(level[i], level[i+1]))
		}
		level = next
		idx /= 2
	}
	return path, hex.EncodeToString(level[0][:]), nil
}

// VerifyMerklePath recomputes the Merkle root from a leaf value and its
// authentication path and reports whether it equals wantRoot. This is the
// auditor-side check: it needs only the leaf, the path, and the published root —
// not the full tree — so it works against a checkpoint sealed in WORM. A path
// for a non-member leaf reconstructs a different root and fails.
func VerifyMerklePath(leaf string, path []ProofNode, wantRoot string) bool {
	running := hashLeaf(leaf)
	for _, node := range path {
		sib, err := decodeHash(node.Hash)
		if err != nil {
			return false
		}
		if node.Left {
			running = hashNode(sib, running)
		} else {
			running = hashNode(running, sib)
		}
	}
	return hex.EncodeToString(running[:]) == wantRoot
}

// VerifyInclusionProof verifies a full InclusionProof: the path must rebuild the
// stated Root from LeafHash. It is the convenience wrapper the HTTP layer and
// tests use.
func VerifyInclusionProof(p *InclusionProof) bool {
	if p == nil {
		return false
	}
	return VerifyMerklePath(p.LeafHash, p.Path, p.Root)
}

func decodeHash(h string) ([32]byte, error) {
	var out [32]byte
	b, err := hex.DecodeString(h)
	if err != nil {
		return out, err
	}
	if len(b) != 32 {
		return out, fmt.Errorf("attestledger: hash length %d, want 32", len(b))
	}
	copy(out[:], b)
	return out, nil
}
