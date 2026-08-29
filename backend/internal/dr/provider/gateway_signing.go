package provider

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
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

// Detached-signature algorithm identifiers stamped in the X-Clario-Signature-Alg
// header so a receiver knows how to verify. They mirror the rehearsal-proof /
// lex crypto identifiers and add Ed25519 (the preferred gateway algorithm).
const (
	SigAlgEd25519     = "Ed25519"
	SigAlgRSASHA256   = "RSA-SHA256"
	SigAlgECDSASHA256 = "ECDSA-SHA256"
)

// Signature header names. The detached signature covers the SHA-256 of the
// signing string, which binds the request method-agnostic canonical body to the
// timestamp and nonce so a captured envelope cannot be replayed with a mutated
// body or clock.
const (
	HeaderSignature      = "X-Clario-Signature"
	HeaderSignatureAlg   = "X-Clario-Signature-Alg"
	HeaderSignatureKeyID = "X-Clario-Signature-KeyId"
	HeaderTimestamp      = "X-Clario-Timestamp"
	HeaderNonce          = "X-Clario-Nonce"
	HeaderIdempotencyKey = "Idempotency-Key"
)

var (
	// ErrNoSigner is returned when signing is attempted without a configured key.
	ErrNoSigner = errors.New("dr provider gateway: no signing key configured")
	// ErrUnsupportedSigningKey is returned when the signing key PEM is not an
	// Ed25519, RSA, or ECDSA private key.
	ErrUnsupportedSigningKey = errors.New("dr provider gateway: unsupported signing key type")
	// ErrSignatureInvalid is returned by VerifyGatewaySignature when a detached
	// signature does not verify against the reconstructed signing string.
	ErrSignatureInvalid = errors.New("dr provider gateway: signature invalid")
)

// envelopeSigner produces a detached signature over the canonical gateway
// request envelope. Constructed once from Config.SigningKeyPEM.
type envelopeSigner struct {
	alg    string
	keyID  string
	ed     ed25519.PrivateKey
	rsaKey *rsa.PrivateKey
	ecKey  *ecdsa.PrivateKey
}

// newEnvelopeSigner parses a PEM-encoded Ed25519 / RSA / ECDSA private key. It
// accepts PKCS#8 (Ed25519 and any type), PKCS#1 (RSA), and SEC1 (EC). It fails
// closed on any malformed or unsupported key so construction rejects bad PEM.
func newEnvelopeSigner(privateKeyPEM, keyID string) (*envelopeSigner, error) {
	pemBytes := []byte(privateKeyPEM)
	if strings.TrimSpace(privateKeyPEM) == "" {
		return nil, fmt.Errorf("%w: empty signing key PEM", ErrUnsupportedSigningKey)
	}
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("%w: no PEM block found", ErrUnsupportedSigningKey)
	}
	key, err := parseSigningKey(block)
	if err != nil {
		return nil, err
	}
	s := &envelopeSigner{keyID: strings.TrimSpace(keyID)}
	switch k := key.(type) {
	case ed25519.PrivateKey:
		s.ed, s.alg = k, SigAlgEd25519
	case *rsa.PrivateKey:
		s.rsaKey, s.alg = k, SigAlgRSASHA256
	case *ecdsa.PrivateKey:
		s.ecKey, s.alg = k, SigAlgECDSASHA256
	default:
		return nil, fmt.Errorf("%w: %T", ErrUnsupportedSigningKey, key)
	}
	return s, nil
}

func parseSigningKey(block *pem.Block) (any, error) {
	switch block.Type {
	case "RSA PRIVATE KEY":
		return x509.ParsePKCS1PrivateKey(block.Bytes)
	case "EC PRIVATE KEY":
		return x509.ParseECPrivateKey(block.Bytes)
	case "PRIVATE KEY":
		return x509.ParsePKCS8PrivateKey(block.Bytes)
	default:
		if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
			return key, nil
		}
		return nil, fmt.Errorf("%w: unexpected PEM type %q", ErrUnsupportedSigningKey, block.Type)
	}
}

// signingString is the deterministic bytes covered by the detached signature.
// It binds the canonical body to the timestamp and nonce with unambiguous
// length-free framing (newline-joined, fixed field order). The SAME function is
// used on the verify side, so the two can never drift.
func signingString(canonicalBody []byte, timestamp, nonce string) []byte {
	var b strings.Builder
	b.WriteString("clario-dr-gateway-v1\n")
	b.WriteString(timestamp)
	b.WriteByte('\n')
	b.WriteString(nonce)
	b.WriteByte('\n')
	out := append([]byte(b.String()), canonicalBody...)
	return out
}

// sign produces the base64 (std) detached signature over the canonical body +
// timestamp + nonce. Ed25519 signs the raw signing string; RSA/ECDSA sign its
// SHA-256 digest (the shapes an auditor/lex-crypto verifier already accepts).
func (s *envelopeSigner) sign(canonicalBody []byte, timestamp, nonce string) (sigB64, alg, keyID string, err error) {
	if s == nil {
		return "", "", "", ErrNoSigner
	}
	msg := signingString(canonicalBody, timestamp, nonce)
	switch s.alg {
	case SigAlgEd25519:
		sig := ed25519.Sign(s.ed, msg)
		return base64.StdEncoding.EncodeToString(sig), s.alg, s.keyID, nil
	case SigAlgRSASHA256:
		digest := sha256.Sum256(msg)
		sig, err := rsa.SignPKCS1v15(rand.Reader, s.rsaKey, crypto.SHA256, digest[:])
		if err != nil {
			return "", "", "", fmt.Errorf("dr provider gateway: rsa sign: %w", err)
		}
		return base64.StdEncoding.EncodeToString(sig), s.alg, s.keyID, nil
	case SigAlgECDSASHA256:
		digest := sha256.Sum256(msg)
		sig, err := ecdsa.SignASN1(rand.Reader, s.ecKey, digest[:])
		if err != nil {
			return "", "", "", fmt.Errorf("dr provider gateway: ecdsa sign: %w", err)
		}
		return base64.StdEncoding.EncodeToString(sig), s.alg, s.keyID, nil
	default:
		return "", "", "", fmt.Errorf("%w: %s", ErrUnsupportedSigningKey, s.alg)
	}
}

// publicKeyPEM returns the SubjectPublicKeyInfo PEM for the signer's public key
// so a receiver can be provisioned with the verification key.
func (s *envelopeSigner) publicKeyPEM() (string, error) {
	if s == nil {
		return "", ErrNoSigner
	}
	var pub any
	switch s.alg {
	case SigAlgEd25519:
		pub = s.ed.Public()
	case SigAlgRSASHA256:
		pub = &s.rsaKey.PublicKey
	case SigAlgECDSASHA256:
		pub = &s.ecKey.PublicKey
	default:
		return "", fmt.Errorf("%w: %s", ErrUnsupportedSigningKey, s.alg)
	}
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", fmt.Errorf("dr provider gateway: marshal public key: %w", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})), nil
}

// VerifyGatewaySignature verifies a detached gateway request signature. It is
// the receiver/auditor entry point (and the sign→verify test oracle): given the
// verification public key (or its PEM), the algorithm, the RAW request body, and
// the timestamp/nonce/signature that travelled as headers, it returns nil iff
// the signature is valid. A mutated body, timestamp, or nonce fails.
//
// publicKey may be a crypto public key (ed25519.PublicKey, *rsa.PublicKey,
// *ecdsa.PublicKey) OR the PEM string / []byte of a SubjectPublicKeyInfo block.
func VerifyGatewaySignature(publicKey any, algorithm string, canonicalBody []byte, timestamp, nonce, signatureB64 string) error {
	pub, err := coercePublicKey(publicKey)
	if err != nil {
		return err
	}
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signatureB64))
	if err != nil {
		return fmt.Errorf("%w: decode signature: %v", ErrSignatureInvalid, err)
	}
	msg := signingString(canonicalBody, timestamp, nonce)
	switch algorithm {
	case SigAlgEd25519:
		key, ok := pub.(ed25519.PublicKey)
		if !ok {
			return fmt.Errorf("%w: key is %T, not Ed25519", ErrSignatureInvalid, pub)
		}
		if !ed25519.Verify(key, msg, sig) {
			return fmt.Errorf("%w: ed25519 verify failed", ErrSignatureInvalid)
		}
		return nil
	case SigAlgRSASHA256:
		key, ok := pub.(*rsa.PublicKey)
		if !ok {
			return fmt.Errorf("%w: key is %T, not RSA", ErrSignatureInvalid, pub)
		}
		digest := sha256.Sum256(msg)
		if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], sig); err != nil {
			return fmt.Errorf("%w: %v", ErrSignatureInvalid, err)
		}
		return nil
	case SigAlgECDSASHA256:
		key, ok := pub.(*ecdsa.PublicKey)
		if !ok {
			return fmt.Errorf("%w: key is %T, not ECDSA", ErrSignatureInvalid, pub)
		}
		digest := sha256.Sum256(msg)
		if !ecdsa.VerifyASN1(key, digest[:], sig) {
			return fmt.Errorf("%w: ecdsa verify failed", ErrSignatureInvalid)
		}
		return nil
	default:
		return fmt.Errorf("%w: unsupported algorithm %q", ErrSignatureInvalid, algorithm)
	}
}

// coercePublicKey accepts a crypto public key or a PEM SubjectPublicKeyInfo
// (string or []byte) and returns the parsed crypto public key.
func coercePublicKey(publicKey any) (any, error) {
	switch k := publicKey.(type) {
	case ed25519.PublicKey, *rsa.PublicKey, *ecdsa.PublicKey:
		return k, nil
	case string:
		return parsePublicKeyPEM([]byte(k))
	case []byte:
		return parsePublicKeyPEM(k)
	case nil:
		return nil, fmt.Errorf("%w: nil public key", ErrSignatureInvalid)
	default:
		return nil, fmt.Errorf("%w: unsupported public key type %T", ErrSignatureInvalid, publicKey)
	}
}

func parsePublicKeyPEM(pemBytes []byte) (any, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, fmt.Errorf("%w: no public key PEM block", ErrSignatureInvalid)
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("%w: parse public key: %v", ErrSignatureInvalid, err)
	}
	return pub, nil
}
