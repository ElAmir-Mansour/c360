package service

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/clario360/platform/internal/license/model"
)

// testKeyPair generates a throwaway RSA key pair as PEM.
func testKeyPair(t *testing.T) (privatePEM, publicPEM []byte) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generating RSA key: %v", err)
	}
	privatePEM = pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	publicDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatalf("marshaling public key: %v", err)
	}
	publicPEM = pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: publicDER})
	return privatePEM, publicPEM
}

func testClaims(expires time.Time) *OfflineClaims {
	limit := int64(100)
	return &OfflineClaims{
		RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(expires)},
		LicenseID:        "11111111-1111-1111-1111-111111111111",
		TenantID:         "aaaaaaaa-0000-0000-0000-000000000001",
		PlanKey:          "business-plus",
		PlanName:         "Business+ Suite",
		Seats:            25,
		GraceDays:        14,
		Entitlements: []model.Entitlement{
			{Key: "app.watheeq"},
			{Key: "api.calls", Limit: &limit},
		},
	}
}

func TestOfflineLicense_SignVerifyRoundTrip(t *testing.T) {
	privatePEM, publicPEM := testKeyPair(t)
	signer, err := NewOfflineSigner(privatePEM)
	if err != nil {
		t.Fatalf("NewOfflineSigner() error = %v", err)
	}
	verifier, err := NewOfflineVerifier(publicPEM)
	if err != nil {
		t.Fatalf("NewOfflineVerifier() error = %v", err)
	}

	signed, err := signer.Sign(testClaims(time.Now().UTC().Add(30 * 24 * time.Hour)))
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}

	claims, err := verifier.Verify(signed)
	if err != nil {
		t.Fatalf("Verify() error = %v", err)
	}
	if claims.TenantID != "aaaaaaaa-0000-0000-0000-000000000001" {
		t.Errorf("tenant = %s, want test tenant", claims.TenantID)
	}
	if claims.PlanKey != "business-plus" || claims.Seats != 25 || claims.GraceDays != 14 {
		t.Errorf("plan snapshot mismatch: %+v", claims)
	}
	if len(claims.Entitlements) != 2 {
		t.Fatalf("entitlements = %d, want 2", len(claims.Entitlements))
	}
	if claims.Entitlements[1].Limit == nil || *claims.Entitlements[1].Limit != 100 {
		t.Errorf("metered entitlement limit lost in transit: %+v", claims.Entitlements[1])
	}
	if claims.Issuer != offlineIssuer {
		t.Errorf("issuer = %s, want %s", claims.Issuer, offlineIssuer)
	}
}

func TestOfflineLicense_TamperedPayloadRejected(t *testing.T) {
	privatePEM, publicPEM := testKeyPair(t)
	signer, _ := NewOfflineSigner(privatePEM)
	verifier, _ := NewOfflineVerifier(publicPEM)

	signed, err := signer.Sign(testClaims(time.Now().UTC().Add(time.Hour)))
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}

	// Flip a character in the payload segment.
	parts := strings.Split(signed, ".")
	payload := []byte(parts[1])
	if payload[10] == 'A' {
		payload[10] = 'B'
	} else {
		payload[10] = 'A'
	}
	parts[1] = string(payload)

	if _, err := verifier.Verify(strings.Join(parts, ".")); err == nil {
		t.Fatal("expected tampered license to be rejected")
	}
}

func TestOfflineLicense_WrongKeyRejected(t *testing.T) {
	privatePEM, _ := testKeyPair(t)
	_, otherPublicPEM := testKeyPair(t)
	signer, _ := NewOfflineSigner(privatePEM)
	verifier, _ := NewOfflineVerifier(otherPublicPEM)

	signed, err := signer.Sign(testClaims(time.Now().UTC().Add(time.Hour)))
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}
	if _, err := verifier.Verify(signed); err == nil {
		t.Fatal("expected license signed with a different key to be rejected")
	}
}

func TestOfflineLicense_ExpiredRejected(t *testing.T) {
	privatePEM, publicPEM := testKeyPair(t)
	signer, _ := NewOfflineSigner(privatePEM)
	verifier, _ := NewOfflineVerifier(publicPEM)

	signed, err := signer.Sign(testClaims(time.Now().UTC().Add(-time.Hour)))
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}
	if _, err := verifier.Verify(signed); err == nil {
		t.Fatal("expected expired license to be rejected")
	}
}

func TestOfflineLicense_MissingExpiryRejectedAtSigning(t *testing.T) {
	privatePEM, _ := testKeyPair(t)
	signer, _ := NewOfflineSigner(privatePEM)

	claims := testClaims(time.Time{})
	claims.ExpiresAt = nil
	if _, err := signer.Sign(claims); err == nil {
		t.Fatal("expected signing without expiry to fail — offline licenses must be time-boxed")
	}
}

func TestOfflineLicense_MissingIdentityRejected(t *testing.T) {
	privatePEM, publicPEM := testKeyPair(t)
	signer, _ := NewOfflineSigner(privatePEM)
	verifier, _ := NewOfflineVerifier(publicPEM)

	claims := testClaims(time.Now().UTC().Add(time.Hour))
	claims.TenantID = ""
	signed, err := signer.Sign(claims)
	if err != nil {
		t.Fatalf("Sign() error = %v", err)
	}
	if _, err := verifier.Verify(signed); err == nil {
		t.Fatal("expected license without tenant_id to be rejected")
	}
}

func TestOfflineLicense_AlgorithmConfusionRejected(t *testing.T) {
	_, publicPEM := testKeyPair(t)
	verifier, _ := NewOfflineVerifier(publicPEM)

	// An attacker signs with HMAC using the (public) verification key bytes
	// as the secret — classic alg-confusion. WithValidMethods must refuse it.
	claims := testClaims(time.Now().UTC().Add(time.Hour))
	claims.Issuer = offlineIssuer
	claims.IssuedAt = jwt.NewNumericDate(time.Now().UTC())
	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(publicPEM)
	if err != nil {
		t.Fatalf("forging HS256 token: %v", err)
	}
	if _, err := verifier.Verify(forged); err == nil {
		t.Fatal("expected HS256-forged license to be rejected")
	}
}
