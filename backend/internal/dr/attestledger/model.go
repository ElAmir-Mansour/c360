// Package attestledger is ClarioDR capability #20: a tamper-evident attestation
// ledger — an append-only, hash-CHAINED, WORM-anchored record of every DR
// attestation (failover/drill RTO-RPO attestations, recovery-point validations,
// clean-room verdicts) so an auditor or regulator can cryptographically PROVE
// that no attestation was altered, spliced, or deleted.
//
// The cryptographic core is real and self-contained:
//
//   - Hash chain: each entry stores entry_hash = SHA-256(seq || entry_type ||
//     subject_id || payload_hash || prev_hash); prev_hash is the previous
//     entry's entry_hash; the genesis entry uses a fixed seed. Appends take a
//     per-tenant monotonic seq under a row lock so the chain cannot fork.
//   - Verifier: walks the chain and detects ANY tampering (a mutated payload, a
//     changed/spliced entry, a deleted middle entry → broken link) returning the
//     first broken seq.
//   - Merkle: a proper binary Merkle tree over a range of entry hashes
//     (duplicate-last for odd counts) yielding a stable root, with inclusion
//     proofs (Merkle path) that verify for present entries and fail for
//     non-members.
//   - Anchoring: the Merkle root over a [from,to] range is sealed to GOVERNANCE
//     WORM (internal/dr/worm) producing a tamper-proof checkpoint, and an
//     optional KEK envelope layer (KeyProvider) wraps the checkpoint payload.
//
// External custody systems (HSM, cloud KMS) sit behind the narrow KeyProvider
// interface; this package ships a fully real software envelope provider built on
// crypto/aes + crypto/cipher AES-256-GCM (see envelope.go) so the BYOK path is
// exercised end-to-end in tests without an HSM.
package attestledger

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Entry types recorded in the ledger. These name the DR attestation source so an
// auditor can filter the chain by what is being proved.
const (
	// EntryTypeFailoverAttestation records a Gate-4 failover attestation
	// (objective-vs-actual RTO, achieved RPO) from internal/dr/attest.
	EntryTypeFailoverAttestation = "failover_attestation"
	// EntryTypeDrillAttestation records a non-disruptive drill attestation
	// (BCM evidence) from internal/dr/attest + internal/dr/drillsched.
	EntryTypeDrillAttestation = "drill_attestation"
	// EntryTypeRecoveryPointValidation records a recovery-point validation
	// (content-hash chain verified at seal/validate time).
	EntryTypeRecoveryPointValidation = "recovery_point_validation"
	// EntryTypeCleanroomVerdict records a clean-room verdict (clean / malware /
	// integrity_failed / error) from internal/dr/cleanroom.
	EntryTypeCleanroomVerdict = "cleanroom_verdict"
	// EntryTypeRecoverEvidenceReport records a generated Clario Recover evidence
	// report payload hash and provenance, so procurement/regulatory exports can
	// be chained with the DR attestation ledger instead of carrying only a local
	// hash envelope.
	EntryTypeRecoverEvidenceReport = "recover_evidence_report"
	// EntryTypeAnchorCheckpoint records that a Merkle checkpoint over a range of
	// entries was sealed to WORM — the checkpoint is itself an entry so the
	// anchoring action is part of the chain it certifies up to.
	EntryTypeAnchorCheckpoint = "anchor_checkpoint"
)

// GenesisPrevHash is the fixed 32-byte (hex) seed used as the prev_hash of the
// first entry in a tenant's chain. It is a constant so the genesis link is
// itself verifiable and the chain has a well-defined root of trust.
const GenesisPrevHash = "0000000000000000000000000000000000000000000000000000000000000000"

// Entry is one row of the dr_attestation_ledger table — a single appended
// attestation. The hash columns are computed by the domain crypto (chain.go),
// never trusted from the caller.
type Entry struct {
	// ID is the row UUID.
	ID uuid.UUID `json:"id"`
	// TenantID scopes the entry; each tenant has an independent chain + seq space.
	TenantID uuid.UUID `json:"tenant_id"`
	// Seq is the per-tenant monotonic sequence (starts at 1). It is allocated
	// under a row lock so concurrent appends serialize and the chain cannot fork.
	Seq int64 `json:"seq"`
	// EntryType is one of the EntryType* constants.
	EntryType string `json:"entry_type"`
	// SubjectID is the id of the attested DR object (failover_run id, recovery
	// point id, cleanroom scan id, …) so an auditor can locate the source row.
	SubjectID string `json:"subject_id"`
	// Payload is the canonical attestation content (objective-vs-actual RTO, RPO,
	// verdict, validation ratio, …). It is hashed into PayloadHash and is what an
	// auditor reads; mutating it breaks PayloadHash → breaks EntryHash.
	Payload json.RawMessage `json:"payload"`
	// PayloadHash is the SHA-256 (hex) of the canonical Payload bytes.
	PayloadHash string `json:"payload_hash"`
	// PrevHash is the previous entry's EntryHash (GenesisPrevHash for seq 1).
	PrevHash string `json:"prev_hash"`
	// EntryHash is SHA-256(seq || entry_type || subject_id || payload_hash ||
	// prev_hash) — the link that chains this entry to its predecessor.
	EntryHash string `json:"entry_hash"`
	// AnchoredRoot is the Merkle root of the checkpoint that covers this entry,
	// set once the entry has been anchored to WORM (empty until then).
	AnchoredRoot string `json:"anchored_root,omitempty"`
	// CreatedAt is the append time (UTC).
	CreatedAt time.Time `json:"created_at"`
}

// AppendRequest is the input a DR component hands to the recorder to add an
// attestation. Seq / hashes / created_at are computed by the ledger, not the
// caller — the caller only supplies the semantic content.
type AppendRequest struct {
	// TenantID is the chain to append to.
	TenantID uuid.UUID
	// EntryType is one of the EntryType* constants.
	EntryType string
	// SubjectID identifies the attested DR object.
	SubjectID string
	// Payload is the attestation content; it is canonicalized (canonicalJSON)
	// before hashing so semantically equal payloads hash identically.
	Payload any
}

// VerifyResult is the outcome of walking and verifying a tenant's chain.
type VerifyResult struct {
	// Intact is true when every link from genesis to the head verified.
	Intact bool `json:"intact"`
	// EntriesChecked is how many entries the verifier walked.
	EntriesChecked int `json:"entries_checked"`
	// FirstBrokenSeq is the seq of the first entry whose link failed (its stored
	// hashes do not match a recomputation, or its prev_hash does not equal the
	// predecessor's entry_hash, or a seq is missing). Zero when Intact.
	FirstBrokenSeq int64 `json:"first_broken_seq,omitempty"`
	// Reason describes the break for the audit log (empty when Intact).
	Reason string `json:"reason,omitempty"`
	// HeadHash is the entry_hash of the last entry (the current chain head).
	HeadHash string `json:"head_hash,omitempty"`
}

// Checkpoint is an anchored Merkle root over a contiguous [FromSeq,ToSeq] range,
// sealed to WORM. It is the tamper-proof witness: re-deriving the Merkle root of
// those entries must equal MerkleRoot, and the WORM object is immutable, so an
// auditor can prove the range existed as recorded at anchoring time.
type Checkpoint struct {
	ID uuid.UUID `json:"id"`
	// TenantID scopes the checkpoint.
	TenantID uuid.UUID `json:"tenant_id"`
	// FromSeq / ToSeq are the inclusive range of entry seqs covered.
	FromSeq int64 `json:"from_seq"`
	ToSeq   int64 `json:"to_seq"`
	// MerkleRoot is the hex Merkle root over the entries' EntryHash leaves.
	MerkleRoot string `json:"merkle_root"`
	// EntryCount is ToSeq-FromSeq+1 (the number of leaves).
	EntryCount int `json:"entry_count"`
	// WORMObjectKey is the key of the sealed checkpoint object in the WORM bucket
	// (empty when WORM anchoring was not configured — the row still records the
	// root so the checkpoint is verifiable from the DB alone).
	WORMObjectKey string `json:"worm_object_key,omitempty"`
	// WORMVersionID is the object-lock-protected version of the sealed object.
	WORMVersionID string `json:"worm_version_id,omitempty"`
	// CreatedAt is the anchoring time (UTC).
	CreatedAt time.Time `json:"created_at"`
}

// InclusionProof is a Merkle path proving an entry's EntryHash is a leaf of a
// checkpoint's MerkleRoot. VerifyInclusionProof recomputes the root from
// LeafHash + Path and compares it to Root.
type InclusionProof struct {
	// Seq is the entry's seq.
	Seq int64 `json:"seq"`
	// LeafIndex is the entry's 0-based position within the checkpoint range
	// (Seq-FromSeq), i.e. its leaf index in the tree.
	LeafIndex int `json:"leaf_index"`
	// LeafHash is the entry's EntryHash (the leaf value).
	LeafHash string `json:"leaf_hash"`
	// Path is the ordered list of sibling hashes from leaf to root.
	Path []ProofNode `json:"path"`
	// Root is the checkpoint's Merkle root the path reconstructs.
	Root string `json:"root"`
	// FromSeq / ToSeq identify the checkpoint range the proof is against.
	FromSeq int64 `json:"from_seq"`
	ToSeq   int64 `json:"to_seq"`
}

// ProofNode is one sibling on a Merkle inclusion path.
type ProofNode struct {
	// Hash is the sibling subtree hash (hex).
	Hash string `json:"hash"`
	// Left is true when the sibling sits to the LEFT of the running hash (so the
	// verifier concatenates sibling || running); false when it sits to the right.
	Left bool `json:"left"`
}
