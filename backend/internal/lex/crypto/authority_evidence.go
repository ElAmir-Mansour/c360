// Package crypto — DoA (Delegation of Authority) authority-evidence PKI validation.
//
// authority_evidence.go validates cryptographic evidence that a signing party
// holds the financial authority claimed in a lex (Watheeq) delegation. The
// evidence is a triple:
//
//   - an X.509 certificate (PEM) identifying the authority holder,
//   - a detached signature over a canonical authority payload,
//   - the payload itself (canonical JSON carrying an optional authority limit).
//
// Validation is three-pronged and ALL prongs must pass:
//
//  1. Chain: the leaf certificate must chain to a trusted root (x509.Verify with
//     the resolved CertPool and a digital-signature key usage), and be inside its
//     validity window relative to an injectable clock.
//  2. Signature: the detached signature must verify over the exact payload bytes
//     using the leaf's public key (ECDSA or RSA, selected by SignatureAlg).
//  3. Payload: if the payload is canonical JSON, the authority amount/currency are
//     extracted so callers can compare the cryptographically-bound limit against a
//     requested delegation amount.
//
// This file is stdlib-crypto only (crypto/x509, crypto/ecdsa, crypto/rsa,
// encoding/pem) — no external dependencies. It mirrors the package style of
// field_crypto.go: typed sentinel errors, validated inputs, no panics on caller
// data, and wrapped errors via fmt.Errorf("...: %w", err).
package crypto

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/sha512"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Signature algorithm identifiers accepted in AuthorityEvidenceInput.SignatureAlg.
// Comparison is case-insensitive; "_" and "-" are interchangeable on input.
const (
	AlgECDSASHA256 = "ECDSA-SHA256"
	AlgECDSASHA384 = "ECDSA-SHA384"
	AlgECDSASHA512 = "ECDSA-SHA512"
	AlgRSASHA256   = "RSA-SHA256"
	AlgRSASHA384   = "RSA-SHA384"
	AlgRSASHA512   = "RSA-SHA512"
)

var (
	// ErrInvalidEvidence is returned when the input is structurally malformed
	// (bad PEM, undecodable signature, missing required fields).
	ErrInvalidEvidence = errors.New("lex/crypto: invalid authority evidence")
	// ErrChainInvalid is returned when the certificate does not chain to a
	// trusted root (untrusted issuer, wrong key usage).
	ErrChainInvalid = errors.New("lex/crypto: certificate chain not trusted")
	// ErrExpired is returned when the certificate is outside its validity window
	// relative to the validator clock.
	ErrExpired = errors.New("lex/crypto: certificate outside validity window")
	// ErrSignatureInvalid is returned when the detached signature does not verify
	// over the payload with the certificate public key (tamper, wrong key).
	ErrSignatureInvalid = errors.New("lex/crypto: authority signature invalid")
	// ErrUnsupportedAlg is returned for an unknown/unsupported signature algorithm
	// or a key type that does not match the requested algorithm family.
	ErrUnsupportedAlg = errors.New("lex/crypto: unsupported signature algorithm")
	// ErrRevoked is returned when revocation checking is enabled and the
	// certificate is found on a configured revocation list.
	ErrRevoked = errors.New("lex/crypto: certificate revoked")
)

// AuthorityEvidenceInput is the raw evidence submitted for validation.
type AuthorityEvidenceInput struct {
	// CertificatePEM is the PEM-encoded leaf X.509 certificate of the authority
	// holder. Additional intermediate CERTIFICATE blocks may be appended and are
	// used to build the chain to a trusted root.
	CertificatePEM string
	// Payload is the exact byte sequence that was signed. Authority amount and
	// currency are parsed from it when it is canonical JSON.
	Payload []byte
	// SignatureB64 is the standard- or raw-base64 encoded detached signature.
	SignatureB64 string
	// SignatureAlg names the algorithm, e.g. "ECDSA-SHA256" or "RSA-SHA256".
	SignatureAlg string
	// TrustedRootsPEM is an optional PEM bundle of roots to trust for this
	// validation. Empty => the validator's default pool is used.
	TrustedRootsPEM string
}

// VerifiedAuthority is the result of a successful (or attempted) validation.
type VerifiedAuthority struct {
	Subject      string
	Issuer       string
	SerialNumber string
	NotBefore    time.Time
	NotAfter     time.Time
	// AuthorityAmount is the financial limit parsed from the payload, if present.
	AuthorityAmount *float64
	// Currency is the ISO currency code parsed from the payload, if present.
	Currency string
	// ChainVerified is true once the certificate chains to a trusted root.
	ChainVerified bool
	// SignatureVerified is true once the detached signature verifies.
	SignatureVerified bool
}

// authorityPayload is the canonical JSON shape from which the cryptographically
// bound authority limit is extracted. All fields are optional; unknown fields are
// ignored so the payload schema can evolve additively.
type authorityPayload struct {
	AuthorityAmount *float64 `json:"authority_amount"`
	Currency        string   `json:"currency"`
}

// EvidenceOption configures an AuthorityEvidenceValidator.
type EvidenceOption func(*AuthorityEvidenceValidator)

// WithClock injects a deterministic time source. Used by tests to make the
// validity-window check reproducible. now must be non-nil to take effect.
func WithClock(now func() time.Time) EvidenceOption {
	return func(v *AuthorityEvidenceValidator) {
		if now != nil {
			v.now = now
		}
	}
}

// WithRevocationCheck toggles revocation checking. When enabled, serial numbers
// supplied via WithRevokedSerials are rejected with ErrRevoked. (Network OCSP/CRL
// fetching is intentionally out of scope — this seam is offline and deterministic.)
func WithRevocationCheck(enabled bool) EvidenceOption {
	return func(v *AuthorityEvidenceValidator) {
		v.checkRevocation = enabled
	}
}

// WithRevokedSerials seeds the offline revocation set with certificate serial
// numbers (decimal strings, matching VerifiedAuthority.SerialNumber). Implies
// revocation checking is enabled.
func WithRevokedSerials(serials ...string) EvidenceOption {
	return func(v *AuthorityEvidenceValidator) {
		v.checkRevocation = true
		if v.revoked == nil {
			v.revoked = make(map[string]struct{}, len(serials))
		}
		for _, s := range serials {
			s = strings.TrimSpace(s)
			if s != "" {
				v.revoked[s] = struct{}{}
			}
		}
	}
}

// AuthorityEvidenceValidator validates DoA authority evidence against a default
// trusted-root pool, with an injectable clock and optional revocation checking.
type AuthorityEvidenceValidator struct {
	defaultRoots    *x509.CertPool
	now             func() time.Time
	checkRevocation bool
	revoked         map[string]struct{}
}

// NewAuthorityEvidenceValidator builds a validator. defaultRootsPEM is an optional
// PEM bundle of roots used when an input does not carry its own TrustedRootsPEM;
// an empty string leaves the default pool nil (every input must then supply its
// own roots, otherwise validation fails closed with ErrChainInvalid).
func NewAuthorityEvidenceValidator(defaultRootsPEM string, opts ...EvidenceOption) (*AuthorityEvidenceValidator, error) {
	v := &AuthorityEvidenceValidator{
		now: time.Now,
	}
	if strings.TrimSpace(defaultRootsPEM) != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(defaultRootsPEM)) {
			return nil, fmt.Errorf("%w: default roots contain no parseable certificates", ErrInvalidEvidence)
		}
		v.defaultRoots = pool
	}
	for _, opt := range opts {
		if opt != nil {
			opt(v)
		}
	}
	return v, nil
}

// Validate runs the three-pronged check (chain, signature, payload) and returns a
// VerifiedAuthority. On any failure it returns a typed sentinel error (use
// errors.Is). The returned *VerifiedAuthority is non-nil even on signature/chain
// failure where the certificate parsed, so callers can inspect identity fields;
// it is nil only for structural (parse) failures.
func (v *AuthorityEvidenceValidator) Validate(ctx context.Context, in AuthorityEvidenceInput) (*VerifiedAuthority, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	leaf, intermediates, err := parseCertChain(in.CertificatePEM)
	if err != nil {
		return nil, err
	}

	result := &VerifiedAuthority{
		Subject:      leaf.Subject.String(),
		Issuer:       leaf.Issuer.String(),
		SerialNumber: serialString(leaf),
		NotBefore:    leaf.NotBefore,
		NotAfter:     leaf.NotAfter,
	}

	// Parse payload up front so identity + bound-limit fields are populated
	// regardless of where (if anywhere) validation later fails.
	if amount, currency, ok := parseAuthorityPayload(in.Payload); ok {
		result.AuthorityAmount = amount
		result.Currency = currency
	}

	now := v.clock()

	// Prong 1: validity window. Checked explicitly (rather than relying solely on
	// x509.Verify) so we can return the specific ErrExpired sentinel.
	if now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
		return result, fmt.Errorf("%w: now=%s notBefore=%s notAfter=%s",
			ErrExpired, now.UTC().Format(time.RFC3339), leaf.NotBefore.UTC().Format(time.RFC3339), leaf.NotAfter.UTC().Format(time.RFC3339))
	}

	// Prong 1 (cont.): chain to a trusted root.
	roots, err := v.resolveRoots(in.TrustedRootsPEM)
	if err != nil {
		return result, err
	}
	if _, err := leaf.Verify(x509.VerifyOptions{
		Roots:         roots,
		Intermediates: intermediates,
		CurrentTime:   now,
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}); err != nil {
		return result, fmt.Errorf("%w: %v", ErrChainInvalid, err)
	}
	if leaf.KeyUsage != 0 && leaf.KeyUsage&x509.KeyUsageDigitalSignature == 0 {
		return result, fmt.Errorf("%w: leaf lacks digital-signature key usage", ErrChainInvalid)
	}
	result.ChainVerified = true

	// Prong 1 (cont.): optional offline revocation.
	if v.checkRevocation {
		if _, bad := v.revoked[result.SerialNumber]; bad {
			return result, fmt.Errorf("%w: serial %s", ErrRevoked, result.SerialNumber)
		}
	}

	// Prong 2: detached signature over the payload.
	if err := verifySignature(leaf, in.SignatureAlg, in.Payload, in.SignatureB64); err != nil {
		return result, err
	}
	result.SignatureVerified = true

	return result, nil
}

func (v *AuthorityEvidenceValidator) clock() time.Time {
	if v.now != nil {
		return v.now()
	}
	return time.Now()
}

// resolveRoots returns the CertPool to verify against: the per-input bundle if
// supplied, otherwise the validator default. Fails closed if neither exists.
func (v *AuthorityEvidenceValidator) resolveRoots(perInputPEM string) (*x509.CertPool, error) {
	if strings.TrimSpace(perInputPEM) != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(perInputPEM)) {
			return nil, fmt.Errorf("%w: trusted roots contain no parseable certificates", ErrInvalidEvidence)
		}
		return pool, nil
	}
	if v.defaultRoots == nil {
		return nil, fmt.Errorf("%w: no trusted roots configured", ErrChainInvalid)
	}
	return v.defaultRoots, nil
}

// parseCertChain decodes a PEM bundle into a leaf certificate (the first
// CERTIFICATE block) and a pool of any subsequent intermediate certificates.
func parseCertChain(certPEM string) (*x509.Certificate, *x509.CertPool, error) {
	if strings.TrimSpace(certPEM) == "" {
		return nil, nil, fmt.Errorf("%w: empty certificate PEM", ErrInvalidEvidence)
	}
	rest := []byte(certPEM)
	var leaf *x509.Certificate
	intermediates := x509.NewCertPool()
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		cert, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: parse certificate: %v", ErrInvalidEvidence, err)
		}
		if leaf == nil {
			leaf = cert
		} else {
			intermediates.AddCert(cert)
		}
	}
	if leaf == nil {
		return nil, nil, fmt.Errorf("%w: no CERTIFICATE block found", ErrInvalidEvidence)
	}
	return leaf, intermediates, nil
}

// serialString renders a certificate serial number as a decimal string, matching
// the form WithRevokedSerials expects.
func serialString(cert *x509.Certificate) string {
	if cert == nil || cert.SerialNumber == nil {
		return ""
	}
	return cert.SerialNumber.String()
}

// parseAuthorityPayload extracts authority amount/currency from a canonical JSON
// payload. ok is false when the payload is not JSON or carries neither field, so
// non-JSON signed blobs are still valid evidence (just without a bound limit).
func parseAuthorityPayload(payload []byte) (amount *float64, currency string, ok bool) {
	if len(payload) == 0 {
		return nil, "", false
	}
	var p authorityPayload
	if err := json.Unmarshal(payload, &p); err != nil {
		return nil, "", false
	}
	if p.AuthorityAmount == nil && strings.TrimSpace(p.Currency) == "" {
		return nil, "", false
	}
	return p.AuthorityAmount, strings.TrimSpace(p.Currency), true
}

// normalizeAlg canonicalizes a signature-algorithm identifier: upper-cased with
// "_" treated as "-" so "ecdsa_sha256" and "ECDSA-SHA256" match.
func normalizeAlg(alg string) string {
	alg = strings.ToUpper(strings.TrimSpace(alg))
	alg = strings.ReplaceAll(alg, "_", "-")
	return alg
}

// hashPayload returns the digest of payload under the hash bound to alg, plus the
// crypto.Hash for RSA PKCS#1 v1.5 verification.
func hashPayload(alg string, payload []byte) ([]byte, crypto.Hash, error) {
	switch alg {
	case AlgECDSASHA256, AlgRSASHA256:
		sum := sha256.Sum256(payload)
		return sum[:], crypto.SHA256, nil
	case AlgECDSASHA384, AlgRSASHA384:
		sum := sha512.Sum384(payload)
		return sum[:], crypto.SHA384, nil
	case AlgECDSASHA512, AlgRSASHA512:
		sum := sha512.Sum512(payload)
		return sum[:], crypto.SHA512, nil
	default:
		return nil, 0, fmt.Errorf("%w: %q", ErrUnsupportedAlg, alg)
	}
}

// verifySignature checks a detached signature over payload using the certificate's
// public key, dispatching on the requested algorithm family.
func verifySignature(leaf *x509.Certificate, signatureAlg string, payload []byte, signatureB64 string) error {
	alg := normalizeAlg(signatureAlg)

	sig, err := decodeSignature(signatureB64)
	if err != nil {
		return err
	}

	digest, hash, err := hashPayload(alg, payload)
	if err != nil {
		return err
	}

	switch {
	case strings.HasPrefix(alg, "ECDSA-"):
		pub, ok := leaf.PublicKey.(*ecdsa.PublicKey)
		if !ok {
			return fmt.Errorf("%w: certificate key is %T, not ECDSA", ErrUnsupportedAlg, leaf.PublicKey)
		}
		if !ecdsa.VerifyASN1(pub, digest, sig) {
			return fmt.Errorf("%w: ECDSA verify failed", ErrSignatureInvalid)
		}
		return nil
	case strings.HasPrefix(alg, "RSA-"):
		pub, ok := leaf.PublicKey.(*rsa.PublicKey)
		if !ok {
			return fmt.Errorf("%w: certificate key is %T, not RSA", ErrUnsupportedAlg, leaf.PublicKey)
		}
		if err := rsa.VerifyPKCS1v15(pub, hash, digest, sig); err != nil {
			return fmt.Errorf("%w: %v", ErrSignatureInvalid, err)
		}
		return nil
	default:
		return fmt.Errorf("%w: %q", ErrUnsupportedAlg, signatureAlg)
	}
}

// decodeSignature accepts standard or raw (unpadded) base64, returning the raw
// signature bytes.
func decodeSignature(signatureB64 string) ([]byte, error) {
	s := strings.TrimSpace(signatureB64)
	if s == "" {
		return nil, fmt.Errorf("%w: empty signature", ErrInvalidEvidence)
	}
	if sig, err := base64.StdEncoding.DecodeString(s); err == nil {
		return sig, nil
	}
	sig, err := base64.RawStdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("%w: decode signature: %v", ErrInvalidEvidence, err)
	}
	return sig, nil
}
