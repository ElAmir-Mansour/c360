package rehearsalproof

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
)

// Signature algorithm identifiers stamped on a sealed proof so a verifier knows
// how to check the detached signature. They mirror internal/lex/crypto's
// identifiers so the same X.509/detached-signature verification path applies.
const (
	SigAlgRSASHA256   = "RSA-SHA256"
	SigAlgECDSASHA256 = "ECDSA-SHA256"
)

var (
	// ErrNoSigner is returned when a sealing operation is attempted without a
	// configured signer — the proof service fails closed rather than persist an
	// unsigned envelope.
	ErrNoSigner = errors.New("rehearsal proof: no signer configured")
	// ErrUnsupportedKey is returned when the signing key PEM is neither an RSA
	// nor an ECDSA private key.
	ErrUnsupportedKey = errors.New("rehearsal proof: unsupported signing key type")
	// ErrSignatureInvalid is returned by VerifyEnvelopeSignature when a signature
	// does not verify against the envelope hash with the given public key.
	ErrSignatureInvalid = errors.New("rehearsal proof: signature invalid")
)

// Signer produces a detached digital signature over a rehearsal-proof envelope
// hash. It is deliberately narrow so the proof service depends on the seam, not
// on a concrete key type; PEMSigner is the production implementation and tests
// use a generated in-process key.
type Signer interface {
	// SignEnvelopeHash signs the (already SHA-256) envelope hash string and
	// returns the base64 (std) detached signature plus the algorithm identifier.
	SignEnvelopeHash(envelopeHash string) (signatureB64, algorithm string, err error)
}

// PEMSigner signs proof envelope hashes with an RSA or ECDSA private key parsed
// from PEM (the same key material class the attestation path uses). RSA uses
// PKCS#1 v1.5 over SHA-256; ECDSA uses ASN.1 DER over SHA-256 — both are the
// verification shapes internal/lex/crypto already accepts, so an auditor tool
// can validate the signature with only the matching public key.
type PEMSigner struct {
	rsaKey   *rsa.PrivateKey
	ecdsaKey *ecdsa.PrivateKey
	alg      string
}

// NewPEMSigner parses a PEM-encoded RSA or ECDSA private key. It accepts PKCS#1
// / SEC1 / PKCS#8 encodings. The returned signer fails closed on any malformed
// or unsupported key.
func NewPEMSigner(privateKeyPEM []byte) (*PEMSigner, error) {
	if len(privateKeyPEM) == 0 {
		return nil, fmt.Errorf("%w: empty private key PEM", ErrUnsupportedKey)
	}
	block, _ := pem.Decode(privateKeyPEM)
	if block == nil {
		return nil, fmt.Errorf("%w: no PEM block found", ErrUnsupportedKey)
	}
	key, err := parsePrivateKey(block)
	if err != nil {
		return nil, err
	}
	switch k := key.(type) {
	case *rsa.PrivateKey:
		return &PEMSigner{rsaKey: k, alg: SigAlgRSASHA256}, nil
	case *ecdsa.PrivateKey:
		return &PEMSigner{ecdsaKey: k, alg: SigAlgECDSASHA256}, nil
	default:
		return nil, fmt.Errorf("%w: %T", ErrUnsupportedKey, key)
	}
}

func parsePrivateKey(block *pem.Block) (any, error) {
	switch block.Type {
	case "RSA PRIVATE KEY":
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	case "EC PRIVATE KEY":
		return x509.ParseECPrivateKey(block.Bytes)
	case "PRIVATE KEY":
		return x509.ParsePKCS8PrivateKey(block.Bytes)
	default:
		// Best-effort: try PKCS#8 for unlabeled blocks before giving up.
		if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
			return key, nil
		}
		return nil, fmt.Errorf("%w: unexpected PEM type %q", ErrUnsupportedKey, block.Type)
	}
}

// SignEnvelopeHash signs the envelope hash string. The bytes signed are the
// canonical hash string (e.g. "sha256:abc…") so the signature is bound to the
// exact envelope digest recorded in the row.
func (s *PEMSigner) SignEnvelopeHash(envelopeHash string) (string, string, error) {
	if s == nil {
		return "", "", ErrNoSigner
	}
	if strings.TrimSpace(envelopeHash) == "" {
		return "", "", errors.New("rehearsal proof: envelope hash is required to sign")
	}
	digest := sha256.Sum256([]byte(envelopeHash))
	switch s.alg {
	case SigAlgRSASHA256:
		sig, err := rsa.SignPKCS1v15(rand.Reader, s.rsaKey, crypto.SHA256, digest[:])
		if err != nil {
			return "", "", fmt.Errorf("rehearsal proof: rsa sign: %w", err)
		}
		return base64.StdEncoding.EncodeToString(sig), s.alg, nil
	case SigAlgECDSASHA256:
		sig, err := ecdsa.SignASN1(rand.Reader, s.ecdsaKey, digest[:])
		if err != nil {
			return "", "", fmt.Errorf("rehearsal proof: ecdsa sign: %w", err)
		}
		return base64.StdEncoding.EncodeToString(sig), s.alg, nil
	default:
		return "", "", fmt.Errorf("%w: %s", ErrUnsupportedKey, s.alg)
	}
}

// PublicKeyPEM returns the SubjectPublicKeyInfo PEM of the signer's public key,
// so the service can expose the verification key alongside a proof (an auditor
// needs it to check the detached signature offline).
func (s *PEMSigner) PublicKeyPEM() (string, error) {
	if s == nil {
		return "", ErrNoSigner
	}
	var pub any
	switch s.alg {
	case SigAlgRSASHA256:
		pub = &s.rsaKey.PublicKey
	case SigAlgECDSASHA256:
		pub = &s.ecdsaKey.PublicKey
	default:
		return "", fmt.Errorf("%w: %s", ErrUnsupportedKey, s.alg)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", fmt.Errorf("rehearsal proof: marshal public key: %w", err)
	}
	block := &pem.Block{Type: "PUBLIC KEY", Bytes: der}
	return string(pem.EncodeToMemory(block)), nil
}

// VerifyEnvelopeSignature checks a base64 detached signature over an envelope
// hash against a public key (RSA or ECDSA), returning nil when it verifies. It
// exists so the sign→verify round-trip is exercised in tests and so an auditor
// service can validate a persisted proof with only the public key + algorithm.
func VerifyEnvelopeSignature(publicKey any, algorithm, envelopeHash, signatureB64 string) error {
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signatureB64))
	if err != nil {
		return fmt.Errorf("%w: decode signature: %v", ErrSignatureInvalid, err)
	}
	digest := sha256.Sum256([]byte(envelopeHash))
	switch algorithm {
	case SigAlgRSASHA256:
		pub, ok := publicKey.(*rsa.PublicKey)
		if !ok {
			return fmt.Errorf("%w: key is %T, not RSA", ErrSignatureInvalid, publicKey)
		}
		if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig); err != nil {
			return fmt.Errorf("%w: %v", ErrSignatureInvalid, err)
		}
		return nil
	case SigAlgECDSASHA256:
		pub, ok := publicKey.(*ecdsa.PublicKey)
		if !ok {
			return fmt.Errorf("%w: key is %T, not ECDSA", ErrSignatureInvalid, publicKey)
		}
		if !ecdsa.VerifyASN1(pub, digest[:], sig) {
			return fmt.Errorf("%w: ecdsa verify failed", ErrSignatureInvalid)
		}
		return nil
	default:
		return fmt.Errorf("%w: unsupported algorithm %q", ErrSignatureInvalid, algorithm)
	}
}
