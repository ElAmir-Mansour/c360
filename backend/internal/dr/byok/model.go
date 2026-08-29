// Package byok implements ClarioDR capability #19 — BYOK / HSM SOVEREIGN KEY
// CUSTODY.
//
// Sovereignty wedge: a tenant brings/owns the MASTER key — the Key-Encryption-Key
// (KEK) — that protects their DR data, and that master key is custodied in the
// tenant's own HSM / cloud KMS. The operator therefore cannot read tenant data
// without the tenant-controlled key. The platform already mints per-tenant DATA
// keys (DEKs) via internal/siem/store/crypto.DEKManager; BYOK adds a tenant KEK
// layer ABOVE those DEKs: every DEK is envelope-wrapped under the tenant KEK, and
// the KEK lives behind a narrow KeyProvider interface (provider.go).
//
// The DOMAIN crypto is real and tested directly:
//
//   - SoftwareKeyProvider (software_provider.go) does AES-256-GCM envelope
//     encryption with a real 32-byte KEK and a random 96-bit nonce per wrap —
//     wrap = GCM-seal the DEK plaintext, unwrap = GCM-open. A tampered ciphertext
//     fails the GCM auth tag; a wrong KEK version fails to open.
//   - KEK ROTATION (service.go) introduces a NEW KEK version and REWRAPS every
//     tenant DEK from the old KEK to the new one (unwrap-with-old -> wrap-with-new),
//     atomically advancing the active version; the old version is retired only
//     after every DEK has been rewrapped. A mid-rotation failure leaves the old
//     version active with no partial rewrap.
//   - The custody audit is a HASH-CHAINED ledger (this file): each entry's
//     entry_hash chains the previous entry's hash, and MerkleRoot over the
//     entries gives a single tamper-evident digest of the whole custody history.
//
// HSMKeyProvider / KMSKeyProvider (kms_provider.go) declare the HSM/cloud-KMS
// custody path behind the SAME KeyProvider interface (HTTP to a remote wrap/unwrap
// endpoint, no cgo PKCS#11), so a deployment can custody the KEK off-box without
// the operator ever holding key material.
//
// The package owns its own model, store (over repository.DBTX, three tables in
// migrations/dr_db/000028), Prometheus metrics, HTTP router, orchestrator Service,
// and a background rotation/rewrap loop. Per the disjoint-ownership rule it edits
// no shared DR files; it emits custody events on the existing datastream.dr.events
// topic through the outbox and integrates with the DEK source via an interface
// (DEKSource) so it never modifies internal/siem/store/crypto.DEKManager.
package byok

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors mapped to HTTP statuses by the router layer.
var (
	// ErrNotFound is returned when a KEK, wrapped DEK, or custody row does not
	// exist for the tenant.
	ErrNotFound = errors.New("byok: not found")
	// ErrAlreadyEnrolled is returned when a tenant already has an active KEK and
	// enrollment is attempted again (rotate instead).
	ErrAlreadyEnrolled = errors.New("byok: tenant already has an active KEK")
	// ErrNotEnrolled is returned when an operation needs an active KEK but the
	// tenant has none.
	ErrNotEnrolled = errors.New("byok: tenant has no active KEK")
	// ErrInvalidState marks an operation requested against a KEK in a state that
	// does not permit it (e.g. a rotation already in progress).
	ErrInvalidState = errors.New("byok: invalid KEK state")
	// ErrValidation marks a caller-correctable request problem.
	ErrValidation = errors.New("byok: validation error")
	// ErrUnwrap marks a failed envelope-open: a wrong KEK version, a tampered
	// ciphertext (GCM auth failure), or a corrupt nonce.
	ErrUnwrap = errors.New("byok: unwrap failed")
	// ErrKeyVersion marks a wrapped DEK presented to a provider version that did
	// not produce it.
	ErrKeyVersion = errors.New("byok: wrong KEK version")
)

// Provider kinds custodying a tenant KEK.
const (
	// ProviderSoftware is the bundled, fully-real AES-256-GCM envelope provider.
	ProviderSoftware = "software"
	// ProviderHSM custodies the KEK in a tenant HSM reached over HTTP wrap/unwrap.
	ProviderHSM = "hsm"
	// ProviderKMS custodies the KEK in a cloud KMS reached over HTTP wrap/unwrap.
	ProviderKMS = "kms"
)

// KEK lifecycle states. Exactly one version is active per tenant. rotation moves
// the outgoing version to rotating while a new active version takes over, then
// retires the old version once every DEK is rewrapped.
const (
	KEKStateActive   = "active"
	KEKStateRotating = "rotating"
	KEKStateRetired  = "retired"
)

// Custody log actions (must match the dr_kek_custody_log CHECK constraint).
const (
	ActionEnroll         = "enroll"
	ActionWrap           = "wrap"
	ActionUnwrap         = "unwrap"
	ActionRotateBegin    = "rotate_begin"
	ActionRotateComplete = "rotate_complete"
	ActionRewrap         = "rewrap"
)

// TenantKEK is one KEK version for a tenant. For provider=software the KEK
// material is NOT stored here (the operator must not hold it in plaintext at
// rest); Reference points at the operator-side keystore handle. For hsm/kms the
// KEK never leaves the tenant's custody and Reference is the remote key handle.
type TenantKEK struct {
	ID          uuid.UUID  `json:"id"`
	TenantID    uuid.UUID  `json:"tenant_id"`
	KeyVersion  int        `json:"key_version"`
	Provider    string     `json:"provider"`
	Reference   string     `json:"reference"`
	State       string     `json:"state"`
	CreatedAt   time.Time  `json:"created_at"`
	ActivatedAt *time.Time `json:"activated_at,omitempty"`
	RetiredAt   *time.Time `json:"retired_at,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// WrappedDEK is one DEK wrapped under a specific KEK version. The platform never
// persists the DEK plaintext — only WrappedDEK (the GCM ciphertext+tag) and the
// Nonce needed to unwrap it under the KEK version that produced it.
type WrappedDEK struct {
	ID          uuid.UUID  `json:"id"`
	TenantID    uuid.UUID  `json:"tenant_id"`
	DEKID       string     `json:"dek_id"`
	KEKVersion  int        `json:"kek_version"`
	WrappedDEK  []byte     `json:"-"` // ciphertext+tag; never serialized to API responses
	Nonce       []byte     `json:"-"` // 96-bit GCM nonce; never serialized
	CreatedAt   time.Time  `json:"created_at"`
	RewrappedAt *time.Time `json:"rewrapped_at,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// CustodyEntry is one append-only, hash-chained custody-audit row. EntryHash =
// sha256(prev_hash || canonical(this row)). Re-walking the chain and recomputing
// each EntryHash detects any deletion or mutation of custody history.
type CustodyEntry struct {
	ID         uuid.UUID `json:"id"`
	TenantID   uuid.UUID `json:"tenant_id"`
	Seq        int64     `json:"seq"`
	Action     string    `json:"action"`
	KEKVersion int       `json:"kek_version"`
	DEKID      string    `json:"dek_id,omitempty"`
	Detail     string    `json:"detail,omitempty"`
	PrevHash   string    `json:"prev_hash"`
	EntryHash  string    `json:"entry_hash"`
	CreatedAt  time.Time `json:"created_at"`
}

// ComputeEntryHash deterministically derives a custody entry's tamper-evidence
// hash: sha256 over the previous entry's hash followed by this entry's canonical,
// length-prefixed fields. Length-prefixing makes the encoding injective so two
// distinct entries cannot collide by field-boundary ambiguity. This is real
// domain crypto with no I/O and is unit-tested directly.
//
// The CreatedAt timestamp is intentionally NOT hashed: the hash binds the
// semantic content (who did what to which key/DEK in what order), which the DB
// default timestamp does not influence and which must be reproducible by a
// verifier that does not know the exact insert instant.
func ComputeEntryHash(prevHash string, e *CustodyEntry) string {
	h := sha256.New()
	writeField(h, []byte(prevHash))
	writeField(h, []byte(e.TenantID.String()))
	writeInt64(h, e.Seq)
	writeField(h, []byte(e.Action))
	writeInt64(h, int64(e.KEKVersion))
	writeField(h, []byte(e.DEKID))
	writeField(h, []byte(e.Detail))
	return hex.EncodeToString(h.Sum(nil))
}

// VerifyChain re-walks a tenant's custody entries (ASCENDING seq) and confirms
// every entry's PrevHash links the previous EntryHash and every EntryHash equals
// the recomputed hash. It returns the seq of the first broken/tampered entry, or
// (true, 0) when the whole chain is intact. An empty slice is a valid (empty)
// chain. This is the real verification of the hash-chained ledger.
func VerifyChain(entries []*CustodyEntry) (ok bool, brokenSeq int64) {
	prev := ""
	for _, e := range entries {
		if e.PrevHash != prev {
			return false, e.Seq
		}
		if ComputeEntryHash(prev, e) != e.EntryHash {
			return false, e.Seq
		}
		prev = e.EntryHash
	}
	return true, 0
}

// MerkleRoot folds the custody entries' EntryHash leaves into a single Merkle
// root (hex sha256). It is a real binary Merkle tree: leaves are the raw 32-byte
// entry hashes, interior nodes are sha256(left || right), and a lone trailing node
// at an odd level is duplicated (promoted) — the standard convention. The root is
// a one-line tamper-evident digest of the entire custody history. Empty input
// returns sha256 of the empty string. This is real domain crypto, unit-tested.
func MerkleRoot(entries []*CustodyEntry) string {
	if len(entries) == 0 {
		sum := sha256.Sum256(nil)
		return hex.EncodeToString(sum[:])
	}
	level := make([][]byte, 0, len(entries))
	for _, e := range entries {
		// Decode the hex entry hash to its raw bytes; if it is not valid hex
		// (should never happen for a well-formed entry) fall back to hashing the
		// string so the fold is still defined.
		raw, err := hex.DecodeString(e.EntryHash)
		if err != nil {
			sum := sha256.Sum256([]byte(e.EntryHash))
			raw = sum[:]
		}
		level = append(level, raw)
	}
	for len(level) > 1 {
		next := make([][]byte, 0, (len(level)+1)/2)
		for i := 0; i < len(level); i += 2 {
			left := level[i]
			var right []byte
			if i+1 < len(level) {
				right = level[i+1]
			} else {
				right = left // promote the lone odd node
			}
			h := sha256.New()
			h.Write(left)
			h.Write(right)
			next = append(next, h.Sum(nil))
		}
		level = next
	}
	return hex.EncodeToString(level[0])
}

// writeField hashes a length-prefixed byte field into h (injective framing).
func writeField(h interface{ Write([]byte) (int, error) }, b []byte) {
	writeInt64(h, int64(len(b)))
	_, _ = h.Write(b)
}

// writeInt64 hashes an int64 as 8 big-endian bytes into h.
func writeInt64(h interface{ Write([]byte) (int, error) }, v int64) {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(v))
	_, _ = h.Write(buf[:])
}
