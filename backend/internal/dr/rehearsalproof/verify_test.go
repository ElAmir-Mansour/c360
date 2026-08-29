package rehearsalproof

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
)

// buildSignedSealedProof assembles a real ProofRecord, seals it through the
// production Sealer flow (canonicalize → hash → sign), and returns the resulting
// SealedProof plus the signer's SPKI public-key PEM. It is the fixture the
// offline-verifier tests share: everything after this point uses ONLY the
// SealedProof JSON + the PEM, exactly as an auditor would.
func buildSignedSealedProof(t *testing.T) (*SealedProof, []byte) {
	t.Helper()
	signer, _ := rsaSignerPEM(t)
	pubPEM, err := signer.PublicKeyPEM()
	if err != nil {
		t.Fatalf("public key pem: %v", err)
	}
	sealer := newTestSealer(t, signer, &fakeWORM{}, &fakeLedger{}, newMemStore(), &fakeRunner{})
	proof, err := sealer.Seal(context.Background(), SubjectKindGameDay, sampleRecord(t))
	if err != nil {
		t.Fatalf("seal: %v", err)
	}
	// The row-level hash must equal the envelope-body hash (the sealer sets both).
	if proof.EnvelopeHash != proof.Envelope.EnvelopeHash {
		t.Fatalf("row hash %q != envelope body hash %q", proof.EnvelopeHash, proof.Envelope.EnvelopeHash)
	}
	return proof, []byte(pubPEM)
}

func TestVerifySealedProof_OfflineHappyPath(t *testing.T) {
	proof, pubPEM := buildSignedSealedProof(t)

	res, err := VerifySealedProof(proof, pubPEM)
	if err != nil {
		t.Fatalf("offline verification failed on a genuine proof: %v (%+v)", err, res)
	}
	if !res.OK || !res.HashMatched || !res.SignatureValid {
		t.Fatalf("expected all-green result, got %+v", res)
	}
	if res.RecomputedHash != proof.EnvelopeHash {
		t.Fatalf("recomputed hash %q != stored %q", res.RecomputedHash, proof.EnvelopeHash)
	}
	if res.Algorithm != SigAlgRSASHA256 {
		t.Fatalf("algorithm = %q, want RSA-SHA256", res.Algorithm)
	}
}

func TestVerifySealedProof_TamperedEnvelopeFieldFailsHashMismatch(t *testing.T) {
	proof, pubPEM := buildSignedSealedProof(t)

	// Mutate a field in the envelope BODY but leave the stored hash + signature
	// untouched — this is the "someone edited the evidence after signing" attack.
	// It must be caught as a hash mismatch, not slip through.
	proof.Envelope.OverallVerdict = VerdictFailed // was "passed"

	res, err := VerifySealedProof(proof, pubPEM)
	if !errors.Is(err, ErrHashMismatch) {
		t.Fatalf("expected ErrHashMismatch on mutated envelope field, got err=%v res=%+v", err, res)
	}
	if res.OK {
		t.Fatalf("tampered envelope must not verify OK: %+v", res)
	}
	if res.HashMatched {
		t.Fatalf("hash must not match after body mutation: %+v", res)
	}
	if res.RecomputedHash == res.StoredHash {
		t.Fatalf("recomputed hash unexpectedly equalled stored hash after tamper")
	}
	if !strings.Contains(res.Reason, res.RecomputedHash) {
		t.Fatalf("reason should surface the recomputed hash: %q", res.Reason)
	}
}

func TestVerifySealedProof_MutatedStoredHashFails(t *testing.T) {
	proof, pubPEM := buildSignedSealedProof(t)

	// Attacker recomputes/edits ONLY the stored hash column (row-level) but the
	// envelope body is unchanged. The verifier recomputes from the body, so the
	// stored hash no longer matches the body → hash mismatch.
	proof.EnvelopeHash = "sha256:" + strings.Repeat("00", 32)
	proof.Envelope.EnvelopeHash = proof.EnvelopeHash

	res, err := VerifySealedProof(proof, pubPEM)
	if !errors.Is(err, ErrHashMismatch) {
		t.Fatalf("expected ErrHashMismatch on mutated stored hash, got err=%v res=%+v", err, res)
	}
	if res.OK {
		t.Fatalf("mutated stored hash must not verify OK: %+v", res)
	}
}

func TestVerifySealedProof_MutatedSignatureFails(t *testing.T) {
	proof, pubPEM := buildSignedSealedProof(t)

	// Flip a byte in the detached signature. The hash still matches, but the
	// signature no longer verifies under the public key.
	proof.Signature = flipSignatureByte(t, proof.Signature)

	res, err := VerifySealedProof(proof, pubPEM)
	if err == nil {
		t.Fatalf("expected verification failure on mutated signature, got res=%+v", res)
	}
	if !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("expected ErrSignatureInvalid on mutated signature, got %v", err)
	}
	if res.OK || res.SignatureValid {
		t.Fatalf("mutated signature must not verify: %+v", res)
	}
	// The hash still matched — only the signature was bad — so the failure is
	// attributable to the signature specifically.
	if !res.HashMatched {
		t.Fatalf("hash should still match when only the signature was mutated: %+v", res)
	}
}

func TestVerifySealedProof_WrongPublicKeyFails(t *testing.T) {
	proof, _ := buildSignedSealedProof(t)

	// A different key pair's public key must not verify the signature.
	otherSigner, _ := rsaSignerPEM(t)
	otherPubPEM, err := otherSigner.PublicKeyPEM()
	if err != nil {
		t.Fatalf("other public key pem: %v", err)
	}

	res, err := VerifySealedProof(proof, []byte(otherPubPEM))
	if !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("expected ErrSignatureInvalid under wrong public key, got %v res=%+v", err, res)
	}
	if res.OK {
		t.Fatalf("wrong public key must not verify OK: %+v", res)
	}
}

func TestVerifySealedProof_ECDSAOfflineRoundTrip(t *testing.T) {
	signer, _ := ecdsaSignerPEM(t)
	pubPEM, err := signer.PublicKeyPEM()
	if err != nil {
		t.Fatalf("ecdsa public key pem: %v", err)
	}
	sealer := newTestSealer(t, signer, &fakeWORM{}, &fakeLedger{}, newMemStore(), &fakeRunner{})
	proof, err := sealer.Seal(context.Background(), SubjectKindFailoverDrill, sampleRecord(t))
	if err != nil {
		t.Fatalf("seal ecdsa: %v", err)
	}

	res, err := VerifySealedProof(proof, []byte(pubPEM))
	if err != nil {
		t.Fatalf("ecdsa offline verification failed: %v (%+v)", err, res)
	}
	if !res.OK || res.Algorithm != SigAlgECDSASHA256 {
		t.Fatalf("expected OK ECDSA result, got %+v", res)
	}

	// And a tampered ECDSA envelope fails too.
	proof.Envelope.Scope.Name = "mutated"
	if _, err := VerifySealedProof(proof, []byte(pubPEM)); !errors.Is(err, ErrHashMismatch) {
		t.Fatalf("expected hash mismatch on tampered ecdsa envelope, got %v", err)
	}
}

func TestParsePublicKeyPEM_FailsClosed(t *testing.T) {
	cases := map[string][]byte{
		"empty":         nil,
		"not pem":       []byte("this is not a pem block"),
		"private key":   privateKeyPEMForNegative(t),
		"garbage block": []byte("-----BEGIN PUBLIC KEY-----\nZ m9v\n-----END PUBLIC KEY-----\n"),
	}
	for name, pemBytes := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := ParsePublicKeyPEM(pemBytes); err == nil {
				t.Fatalf("expected ParsePublicKeyPEM to fail closed for %q", name)
			}
		})
	}
}

func TestVerifyEnvelope_NilAndMissingKeyFailClosed(t *testing.T) {
	if _, err := VerifyEnvelope(nil, "sig", SigAlgRSASHA256, struct{}{}); err == nil {
		t.Fatalf("expected error for nil record")
	}
	rec := sampleRecord(t)
	if _, err := VerifyEnvelope(rec, "sig", SigAlgRSASHA256, nil); !errors.Is(err, ErrMissingPublicKey) {
		t.Fatalf("expected ErrMissingPublicKey for nil key, got %v", err)
	}
}

// flipSignatureByte returns a base64 signature with one decoded byte flipped so
// the signature is structurally valid base64 but cryptographically wrong.
func flipSignatureByte(t *testing.T, sigB64 string) string {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(sigB64)
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	if len(raw) == 0 {
		t.Fatalf("empty signature")
	}
	raw[0] ^= 0xFF
	return base64.StdEncoding.EncodeToString(raw)
}

// privateKeyPEMForNegative returns a PRIVATE-labelled PEM so ParsePublicKeyPEM
// (which expects SPKI public keys) rejects it — proving the parser does not
// silently accept the wrong key class.
func privateKeyPEMForNegative(t *testing.T) []byte {
	t.Helper()
	return []byte("-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n")
}
