package rehearsalproof

import (
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
)

// This file provides an OFFLINE auditor verification path for a sealed
// rehearsal-proof envelope. It deliberately needs NO running service and NO
// database: given a sealed proof (or a bare ProofRecord) plus the verification
// public key as an SPKI ("PUBLIC KEY") PEM, an auditor can independently confirm
// that
//
//  1. the recomputed canonical envelope hash equals the stored EnvelopeHash
//     (the envelope has not been tampered with), and
//  2. the detached digital signature verifies over that hash under the given
//     public key (the envelope was signed by the holder of the private key).
//
// It is the counterpart to the sign-side in sealer.go / signer.go: the sealer
// canonicalizes → hashes → signs; this verifies hash → signature. Both sides use
// EnvelopeHash + VerifyEnvelopeSignature so there is a single source of truth for
// the digest algorithm and signature shape.

// VerifyResult is the structured, human-surfacable outcome of an offline proof
// verification. It is JSON-ready so a CLI or report can render it directly.
type VerifyResult struct {
	// OK is true only when BOTH the hash matches AND the signature verifies.
	OK bool `json:"ok"`
	// HashMatched reports whether the recomputed envelope hash equalled the
	// stored EnvelopeHash.
	HashMatched bool `json:"hash_matched"`
	// SignatureValid reports whether the detached signature verified against the
	// (stored) envelope hash under the supplied public key.
	SignatureValid bool `json:"signature_valid"`
	// RecomputedHash is the hash this verifier computed from the envelope body.
	RecomputedHash string `json:"recomputed_hash"`
	// StoredHash is the EnvelopeHash carried on the record.
	StoredHash string `json:"stored_hash"`
	// Algorithm is the signature algorithm identifier that was checked.
	Algorithm string `json:"algorithm"`
	// Reason is a short human explanation of a failure ("" when OK).
	Reason string `json:"reason,omitempty"`
}

var (
	// ErrHashMismatch is returned when the recomputed canonical envelope hash does
	// not equal the stored EnvelopeHash — the envelope body was mutated.
	ErrHashMismatch = errors.New("rehearsal proof: envelope hash mismatch (tampered envelope)")
	// ErrMissingPublicKey is returned when no verification public key PEM is
	// supplied.
	ErrMissingPublicKey = errors.New("rehearsal proof: verification public key PEM is required")
)

// ParsePublicKeyPEM parses an SPKI ("PUBLIC KEY") PEM into a crypto public key
// (RSA or ECDSA) suitable for VerifyEnvelopeSignature. It fails closed on any
// malformed input so an auditor never verifies against a partial/garbage key.
func ParsePublicKeyPEM(publicKeyPEM []byte) (any, error) {
	if len(publicKeyPEM) == 0 {
		return nil, ErrMissingPublicKey
	}
	block, _ := pem.Decode(publicKeyPEM)
	if block == nil {
		return nil, fmt.Errorf("%w: no PEM block found", ErrUnsupportedKey)
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("%w: parse SPKI public key: %v", ErrUnsupportedKey, err)
	}
	return pub, nil
}

// VerifyEnvelope performs the full offline check on a ProofRecord given its
// detached signature, the signature algorithm, and the verification public key.
// It is the reusable core an auditor tool, a router handler, or a test all share.
//
// Verification is fail-closed and order-independent: the hash is ALWAYS
// recomputed from the envelope body (never trusted from the caller), and the
// signature is ALWAYS checked against the STORED EnvelopeHash so a mismatch
// between "hash the signature covers" and "hash of the body" is caught as a hash
// mismatch. Both properties must hold for OK to be true.
func VerifyEnvelope(record *ProofRecord, signatureB64, algorithm string, publicKey any) (VerifyResult, error) {
	res := VerifyResult{Algorithm: algorithm}
	if record == nil {
		res.Reason = "nil record"
		return res, errors.New("rehearsal proof: nil record to verify")
	}
	if publicKey == nil {
		res.Reason = "missing public key"
		return res, ErrMissingPublicKey
	}

	stored := record.EnvelopeHash
	res.StoredHash = stored

	// (a) recompute the canonical envelope hash from the body and compare.
	recomputed, err := EnvelopeHash(record)
	if err != nil {
		res.Reason = "cannot recompute envelope hash: " + err.Error()
		return res, err
	}
	res.RecomputedHash = recomputed
	res.HashMatched = subtleHashEqual(recomputed, stored)
	if !res.HashMatched {
		res.Reason = fmt.Sprintf("recomputed %s != stored %s", recomputed, stored)
		return res, ErrHashMismatch
	}

	// (b) verify the detached signature over the stored hash.
	if err := VerifyEnvelopeSignature(publicKey, algorithm, stored, signatureB64); err != nil {
		res.SignatureValid = false
		res.Reason = err.Error()
		return res, err
	}
	res.SignatureValid = true
	res.OK = true
	return res, nil
}

// VerifySealedProof is the top-level offline verifier for a persisted, sealed
// proof (a dr_rehearsal_proof row as JSON). It reads the signature/algorithm off
// the SealedProof itself and verifies the embedded envelope, so an auditor with
// only the SealedProof JSON + the SPKI public key PEM can independently confirm
// the proof is authentic and untampered — no service, no DB, no WORM bucket.
func VerifySealedProof(proof *SealedProof, publicKeyPEM []byte) (VerifyResult, error) {
	if proof == nil {
		return VerifyResult{Reason: "nil sealed proof"}, errors.New("rehearsal proof: nil sealed proof to verify")
	}
	if proof.Envelope == nil {
		return VerifyResult{Reason: "sealed proof has no envelope body"}, errors.New("rehearsal proof: sealed proof missing envelope")
	}
	pub, err := ParsePublicKeyPEM(publicKeyPEM)
	if err != nil {
		return VerifyResult{Reason: err.Error()}, err
	}
	// The stored envelope hash on the row and the hash inside the envelope must
	// agree; verify against the envelope's own hash (the digest the signature
	// covers), and cross-check the row-level hash matches so a mutated row-level
	// hash column is also caught.
	res, verr := VerifyEnvelope(proof.Envelope, proof.Signature, proof.SignatureAlg, pub)
	if verr != nil {
		return res, verr
	}
	if strings.TrimSpace(proof.EnvelopeHash) != "" && !subtleHashEqual(proof.EnvelopeHash, proof.Envelope.EnvelopeHash) {
		res.OK = false
		res.HashMatched = false
		res.Reason = fmt.Sprintf("row envelope_hash %s != envelope body hash %s", proof.EnvelopeHash, proof.Envelope.EnvelopeHash)
		return res, ErrHashMismatch
	}
	return res, nil
}

// subtleHashEqual compares two canonical hash strings after trimming surrounding
// whitespace. The hashes are not secrets, so a plain comparison is acceptable;
// the helper exists to keep the trimming rule in one place.
func subtleHashEqual(a, b string) bool {
	return strings.TrimSpace(a) == strings.TrimSpace(b) && strings.TrimSpace(a) != ""
}
