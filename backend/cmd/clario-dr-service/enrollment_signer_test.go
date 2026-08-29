package main

import (
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	drconfig "github.com/clario360/platform/internal/dr/config"
	"github.com/clario360/platform/internal/siem/sources"
	siemenroll "github.com/clario360/platform/internal/siem/sources/enroll"
)

func TestConfigureDREnrollmentSignerUsesPKCS8PEM(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	priv := ed25519.NewKeyFromSeed([]byte("12345678901234567890123456789012"))
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	require.NoError(t, err)
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})

	signer, err := configureDREnrollmentSigner(&drconfig.Config{
		EnrollTokenKeyName:       "dr-prod-k1",
		EnrollTokenPrivateKeyPEM: string(pemBytes),
	}, zerolog.Nop())
	require.NoError(t, err)
	require.Equal(t, "dr-prod-k1", signer.KeyID())
	requireEnrollmentSignerRoundTrip(t, signer)
}

func TestConfigureDREnrollmentSignerUsesEd25519JWKKid(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")
	priv := ed25519.NewKeyFromSeed([]byte("abcdefghijklmnopqrstuvwxyz123456"))
	pub := priv.Public().(ed25519.PublicKey)
	jwk, err := json.Marshal(map[string]string{
		"kty": "OKP",
		"crv": "Ed25519",
		"kid": "jwk-k1",
		"d":   base64.RawURLEncoding.EncodeToString(priv.Seed()),
		"x":   base64.RawURLEncoding.EncodeToString(pub),
	})
	require.NoError(t, err)

	signer, err := configureDREnrollmentSigner(&drconfig.Config{
		EnrollTokenKeyName:    "ignored",
		EnrollTokenPrivateJWK: string(jwk),
	}, zerolog.Nop())
	require.NoError(t, err)
	require.Equal(t, "jwk-k1", signer.KeyID())
	requireEnrollmentSignerRoundTrip(t, signer)
}

func TestConfigureDREnrollmentSignerRejectsProductionEphemeral(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")

	_, err := configureDREnrollmentSigner(&drconfig.Config{
		EnrollTokenKeyName:      "k",
		AllowEphemeralEnrollKey: true,
	}, zerolog.Nop())
	require.Error(t, err)
	require.Contains(t, err.Error(), "production requires")
}

func TestConfigureDREnrollmentSignerRejectsAmbiguousKeySources(t *testing.T) {
	t.Setenv("ENVIRONMENT", "production")

	_, err := configureDREnrollmentSigner(&drconfig.Config{
		EnrollTokenPrivateKeyPEM: "pem",
		EnrollTokenPrivateJWK:    "{}",
	}, zerolog.Nop())
	require.Error(t, err)
	require.Contains(t, err.Error(), "exactly one")
}

func requireEnrollmentSignerRoundTrip(t *testing.T, signer siemenroll.Signer) {
	t.Helper()
	mgr := siemenroll.NewTokenManager(signer, nil)
	agentID := uuid.New()
	tenantID := uuid.New()
	out, err := mgr.Mint(context.Background(), siemenroll.MintParams{
		SourceID: agentID,
		TenantID: tenantID,
		Purpose:  sources.PurposeEnroll,
		TTL:      time.Minute,
		Issuer:   "clario-dr-service",
		Audience: "clario-dr-agent",
	})
	require.NoError(t, err)
	require.True(t, strings.Count(out.JWT, ".") == 2)

	claims, err := mgr.Parse(context.Background(), out.JWT)
	require.NoError(t, err)
	require.Equal(t, agentID.String(), claims.Sub)
	require.Equal(t, tenantID.String(), claims.Tnt)
	require.Equal(t, string(sources.PurposeEnroll), claims.Pur)
}
