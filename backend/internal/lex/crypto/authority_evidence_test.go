package crypto

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"math/big"
	"testing"
	"time"
)

// fixedClock returns a deterministic clock at t for the validator.
func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

// buildECDSAPKI mints a self-signed root CA and an ECDSA leaf signed by it.
func buildECDSAPKI(t *testing.T, notBefore, notAfter time.Time) (rootPEM, leafPEM string, leafKey *ecdsa.PrivateKey) {
	t.Helper()

	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate root key: %v", err)
	}
	rootTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Clario DoA Test Root"},
		NotBefore:             notBefore.Add(-time.Hour),
		NotAfter:              notAfter.Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTmpl, rootTmpl, &rootKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("create root cert: %v", err)
	}

	leafKey, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}
	rootCert, err := x509.ParseCertificate(rootDER)
	if err != nil {
		t.Fatalf("parse root cert: %v", err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(4242),
		Subject:      pkix.Name{CommonName: "authority-holder@clario.dev"},
		NotBefore:    notBefore,
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, rootCert, &leafKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("create leaf cert: %v", err)
	}

	rootPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER}))
	leafPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}))
	return rootPEM, leafPEM, leafKey
}

// buildRSAPKI mints a self-signed root and an RSA leaf signed by it.
func buildRSAPKI(t *testing.T, notBefore, notAfter time.Time) (rootPEM, leafPEM string, leafKey *rsa.PrivateKey) {
	t.Helper()

	rootKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate root key: %v", err)
	}
	rootTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Clario DoA RSA Root"},
		NotBefore:             notBefore.Add(-time.Hour),
		NotAfter:              notAfter.Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTmpl, rootTmpl, &rootKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("create root cert: %v", err)
	}
	rootCert, err := x509.ParseCertificate(rootDER)
	if err != nil {
		t.Fatalf("parse root cert: %v", err)
	}

	leafKey, err = rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(7777),
		Subject:      pkix.Name{CommonName: "rsa-authority@clario.dev"},
		NotBefore:    notBefore,
		NotAfter:     notAfter,
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, rootCert, &leafKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("create leaf cert: %v", err)
	}

	rootPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER}))
	leafPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}))
	return rootPEM, leafPEM, leafKey
}

// signECDSA produces an ASN.1 ECDSA-SHA256 signature over payload.
func signECDSA(t *testing.T, key *ecdsa.PrivateKey, payload []byte) string {
	t.Helper()
	sum := sha256.Sum256(payload)
	sig, err := ecdsa.SignASN1(rand.Reader, key, sum[:])
	if err != nil {
		t.Fatalf("ecdsa sign: %v", err)
	}
	return base64.StdEncoding.EncodeToString(sig)
}

// signRSA produces an RSA-SHA256 PKCS#1 v1.5 signature over payload.
func signRSA(t *testing.T, key *rsa.PrivateKey, payload []byte) string {
	t.Helper()
	sum := sha256.Sum256(payload)
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		t.Fatalf("rsa sign: %v", err)
	}
	return base64.StdEncoding.EncodeToString(sig)
}

func canonicalPayload(t *testing.T, amount float64, currency string) []byte {
	t.Helper()
	b, err := json.Marshal(authorityPayload{AuthorityAmount: &amount, Currency: currency})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return b
}

func TestAuthorityEvidence_ECDSAHappyPath(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	rootPEM, leafPEM, leafKey := buildECDSAPKI(t, now.Add(-24*time.Hour), now.Add(24*time.Hour))

	payload := canonicalPayload(t, 5_000_000.50, "SAR")
	sig := signECDSA(t, leafKey, payload)

	v, err := NewAuthorityEvidenceValidator(rootPEM, WithClock(fixedClock(now)))
	if err != nil {
		t.Fatalf("NewAuthorityEvidenceValidator: %v", err)
	}

	got, err := v.Validate(context.Background(), AuthorityEvidenceInput{
		CertificatePEM: leafPEM,
		Payload:        payload,
		SignatureB64:   sig,
		SignatureAlg:   AlgECDSASHA256,
	})
	if err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
	if !got.ChainVerified || !got.SignatureVerified {
		t.Fatalf("ChainVerified=%v SignatureVerified=%v; want both true", got.ChainVerified, got.SignatureVerified)
	}
	if got.AuthorityAmount == nil || *got.AuthorityAmount != 5_000_000.50 {
		t.Fatalf("AuthorityAmount = %v, want 5000000.50", got.AuthorityAmount)
	}
	if got.Currency != "SAR" {
		t.Fatalf("Currency = %q, want SAR", got.Currency)
	}
	if got.SerialNumber != "4242" {
		t.Fatalf("SerialNumber = %q, want 4242", got.SerialNumber)
	}
}

func TestAuthorityEvidence_RSAHappyPath(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	rootPEM, leafPEM, leafKey := buildRSAPKI(t, now.Add(-24*time.Hour), now.Add(24*time.Hour))

	payload := canonicalPayload(t, 250000, "USD")
	sig := signRSA(t, leafKey, payload)

	v, err := NewAuthorityEvidenceValidator(rootPEM, WithClock(fixedClock(now)))
	if err != nil {
		t.Fatalf("NewAuthorityEvidenceValidator: %v", err)
	}
	got, err := v.Validate(context.Background(), AuthorityEvidenceInput{
		CertificatePEM: leafPEM,
		Payload:        payload,
		SignatureB64:   sig,
		SignatureAlg:   AlgRSASHA256,
	})
	if err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
	if !got.ChainVerified || !got.SignatureVerified {
		t.Fatalf("ChainVerified=%v SignatureVerified=%v; want both true", got.ChainVerified, got.SignatureVerified)
	}
	if got.Currency != "USD" {
		t.Fatalf("Currency = %q, want USD", got.Currency)
	}
}

func TestAuthorityEvidence_FailureModes(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	rootPEM, leafPEM, leafKey := buildECDSAPKI(t, now.Add(-24*time.Hour), now.Add(24*time.Hour))
	payload := canonicalPayload(t, 1000, "SAR")
	goodSig := signECDSA(t, leafKey, payload)

	// Independent (untrusted) CA + leaf for the wrong-root case.
	otherRootPEM, _, _ := buildECDSAPKI(t, now.Add(-24*time.Hour), now.Add(24*time.Hour))

	tests := []struct {
		name    string
		clock   time.Time
		roots   string // overrides validator default when non-empty
		in      AuthorityEvidenceInput
		wantErr error
	}{
		{
			name:  "expired certificate",
			clock: now.Add(72 * time.Hour), // past NotAfter
			in: AuthorityEvidenceInput{
				CertificatePEM: leafPEM, Payload: payload, SignatureB64: goodSig, SignatureAlg: AlgECDSASHA256,
			},
			wantErr: ErrExpired,
		},
		{
			name:  "not yet valid",
			clock: now.Add(-72 * time.Hour), // before NotBefore
			in: AuthorityEvidenceInput{
				CertificatePEM: leafPEM, Payload: payload, SignatureB64: goodSig, SignatureAlg: AlgECDSASHA256,
			},
			wantErr: ErrExpired,
		},
		{
			name:  "untrusted root",
			clock: now,
			roots: otherRootPEM, // does not include the cert's issuer
			in: AuthorityEvidenceInput{
				CertificatePEM: leafPEM, Payload: payload, SignatureB64: goodSig, SignatureAlg: AlgECDSASHA256,
			},
			wantErr: ErrChainInvalid,
		},
		{
			name:  "tampered payload bad signature",
			clock: now,
			in: AuthorityEvidenceInput{
				CertificatePEM: leafPEM,
				Payload:        canonicalPayload(t, 9_999_999, "SAR"), // signature was over a different amount
				SignatureB64:   goodSig,
				SignatureAlg:   AlgECDSASHA256,
			},
			wantErr: ErrSignatureInvalid,
		},
		{
			name:  "unsupported algorithm",
			clock: now,
			in: AuthorityEvidenceInput{
				CertificatePEM: leafPEM, Payload: payload, SignatureB64: goodSig, SignatureAlg: "DSA-WHIRLPOOL",
			},
			wantErr: ErrUnsupportedAlg,
		},
		{
			name:  "alg key-type mismatch (RSA alg on ECDSA cert)",
			clock: now,
			in: AuthorityEvidenceInput{
				CertificatePEM: leafPEM, Payload: payload, SignatureB64: goodSig, SignatureAlg: AlgRSASHA256,
			},
			wantErr: ErrUnsupportedAlg,
		},
		{
			name:  "malformed certificate pem",
			clock: now,
			in: AuthorityEvidenceInput{
				CertificatePEM: "-----BEGIN CERTIFICATE-----\nnot base64\n-----END CERTIFICATE-----",
				Payload:        payload, SignatureB64: goodSig, SignatureAlg: AlgECDSASHA256,
			},
			wantErr: ErrInvalidEvidence,
		},
		{
			name:  "empty signature",
			clock: now,
			in: AuthorityEvidenceInput{
				CertificatePEM: leafPEM, Payload: payload, SignatureB64: "", SignatureAlg: AlgECDSASHA256,
			},
			wantErr: ErrInvalidEvidence,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			v, err := NewAuthorityEvidenceValidator(rootPEM, WithClock(fixedClock(tc.clock)))
			if err != nil {
				t.Fatalf("NewAuthorityEvidenceValidator: %v", err)
			}
			in := tc.in
			if tc.roots != "" {
				in.TrustedRootsPEM = tc.roots
			}
			_, err = v.Validate(context.Background(), in)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("Validate() error = %v, want errors.Is(%v)", err, tc.wantErr)
			}
		})
	}
}

func TestAuthorityEvidence_RevocationCheck(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	rootPEM, leafPEM, leafKey := buildECDSAPKI(t, now.Add(-24*time.Hour), now.Add(24*time.Hour))
	payload := canonicalPayload(t, 1000, "SAR")
	sig := signECDSA(t, leafKey, payload)

	// leaf serial is 4242 (see buildECDSAPKI).
	v, err := NewAuthorityEvidenceValidator(rootPEM, WithClock(fixedClock(now)), WithRevokedSerials("4242"))
	if err != nil {
		t.Fatalf("NewAuthorityEvidenceValidator: %v", err)
	}
	_, err = v.Validate(context.Background(), AuthorityEvidenceInput{
		CertificatePEM: leafPEM, Payload: payload, SignatureB64: sig, SignatureAlg: AlgECDSASHA256,
	})
	if !errors.Is(err, ErrRevoked) {
		t.Fatalf("Validate() error = %v, want ErrRevoked", err)
	}

	// Not revoked when checking is off.
	v2, _ := NewAuthorityEvidenceValidator(rootPEM, WithClock(fixedClock(now)))
	if _, err := v2.Validate(context.Background(), AuthorityEvidenceInput{
		CertificatePEM: leafPEM, Payload: payload, SignatureB64: sig, SignatureAlg: AlgECDSASHA256,
	}); err != nil {
		t.Fatalf("Validate() with revocation off error = %v, want nil", err)
	}
}

func TestAuthorityEvidence_PerInputRootsAndNonJSONPayload(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	rootPEM, leafPEM, leafKey := buildECDSAPKI(t, now.Add(-24*time.Hour), now.Add(24*time.Hour))

	// Non-JSON payload: still valid evidence, just no bound limit.
	payload := []byte("DELEGATION:approve PO-2026-0042")
	sig := signECDSA(t, leafKey, payload)

	// Validator has NO default roots; the input supplies its own.
	v, err := NewAuthorityEvidenceValidator("", WithClock(fixedClock(now)))
	if err != nil {
		t.Fatalf("NewAuthorityEvidenceValidator: %v", err)
	}
	got, err := v.Validate(context.Background(), AuthorityEvidenceInput{
		CertificatePEM:  leafPEM,
		Payload:         payload,
		SignatureB64:    sig,
		SignatureAlg:    AlgECDSASHA256,
		TrustedRootsPEM: rootPEM,
	})
	if err != nil {
		t.Fatalf("Validate() error = %v, want nil", err)
	}
	if got.AuthorityAmount != nil || got.Currency != "" {
		t.Fatalf("non-JSON payload should yield no amount/currency, got %v %q", got.AuthorityAmount, got.Currency)
	}
	if !got.SignatureVerified {
		t.Fatal("SignatureVerified = false, want true")
	}
}

func TestAuthorityEvidence_NoRootsConfiguredFailsClosed(t *testing.T) {
	now := time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)
	_, leafPEM, leafKey := buildECDSAPKI(t, now.Add(-24*time.Hour), now.Add(24*time.Hour))
	payload := canonicalPayload(t, 1, "SAR")
	sig := signECDSA(t, leafKey, payload)

	v, err := NewAuthorityEvidenceValidator("", WithClock(fixedClock(now)))
	if err != nil {
		t.Fatalf("NewAuthorityEvidenceValidator: %v", err)
	}
	_, err = v.Validate(context.Background(), AuthorityEvidenceInput{
		CertificatePEM: leafPEM, Payload: payload, SignatureB64: sig, SignatureAlg: AlgECDSASHA256,
	})
	if !errors.Is(err, ErrChainInvalid) {
		t.Fatalf("Validate() with no roots error = %v, want ErrChainInvalid", err)
	}
}

func TestAuthorityEvidence_ContextCancelled(t *testing.T) {
	v, err := NewAuthorityEvidenceValidator("")
	if err != nil {
		t.Fatalf("NewAuthorityEvidenceValidator: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := v.Validate(ctx, AuthorityEvidenceInput{}); !errors.Is(err, context.Canceled) {
		t.Fatalf("Validate() with cancelled ctx error = %v, want context.Canceled", err)
	}
}
