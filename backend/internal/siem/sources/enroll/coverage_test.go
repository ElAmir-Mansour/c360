package enroll

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func TestEd25519Signer_VerifyFails(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	s := NewEd25519Signer("k", priv)
	require.Equal(t, "k", s.KeyID())
	require.Equal(t, "EdDSA", s.Algorithm())
	err := s.Verify(context.Background(), []byte("data"), []byte("not-a-sig"))
	require.Error(t, err)
}

func TestRegisterJTI_NilRDB(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer := NewEd25519Signer("k", priv)
	mgr := NewTokenManager(signer, nil)
	// registerJTI returns nil when rdb is nil — exercised through Mint.
	res, err := mgr.Mint(context.Background(), MintParams{SourceID: uuid.New(), TenantID: uuid.New(), Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)
	require.NotEmpty(t, res.JWT)
}

func TestClaim_NoRDB(t *testing.T) {
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer := NewEd25519Signer("k", priv)
	mgr := NewTokenManager(signer, nil)
	res, _ := mgr.Mint(context.Background(), MintParams{SourceID: uuid.New(), TenantID: uuid.New(), Purpose: sources.PurposeEnroll, TTL: time.Minute})
	_, err := mgr.Claim(context.Background(), res.JWT, "x")
	require.Error(t, err)
}

func TestParse_MissingClaims(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer := NewEd25519Signer("k", priv)
	mgr := NewTokenManager(signer, rdb)
	// Build a JWT with empty iss/aud manually.
	hdr, _ := json.Marshal(map[string]string{"alg": "EdDSA", "typ": "JWT", "kid": "k"})
	body, _ := json.Marshal(Claims{
		IAT: time.Now().Unix(), EXP: time.Now().Add(time.Minute).Unix(), NBF: time.Now().Unix() - 30,
		Pur: "enroll", JTI: uuid.New().String(),
	})
	signingInput := base64.RawURLEncoding.EncodeToString(hdr) + "." + base64.RawURLEncoding.EncodeToString(body)
	sig := ed25519.Sign(priv, []byte(signingInput))
	tok := signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
	_, err := mgr.Parse(context.Background(), tok)
	require.ErrorIs(t, err, sources.ErrTokenInvalid)
}

func TestParse_BadAlg(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer := NewEd25519Signer("k", priv)
	mgr := NewTokenManager(signer, rdb)
	hdr, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT", "kid": "k"})
	body, _ := json.Marshal(Claims{
		Iss: "siem-service", Aud: "siem-collector",
		IAT: time.Now().Unix(), EXP: time.Now().Add(time.Minute).Unix(), NBF: time.Now().Unix() - 30,
		Pur: "enroll", JTI: uuid.New().String(),
	})
	signingInput := base64.RawURLEncoding.EncodeToString(hdr) + "." + base64.RawURLEncoding.EncodeToString(body)
	sig := ed25519.Sign(priv, []byte(signingInput))
	tok := signingInput + "." + base64.RawURLEncoding.EncodeToString(sig)
	_, err := mgr.Parse(context.Background(), tok)
	require.ErrorIs(t, err, sources.ErrTokenInvalid)
}

func TestParse_BadHeader_Base64(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	_, priv, _ := ed25519.GenerateKey(rand.Reader)
	signer := NewEd25519Signer("k", priv)
	mgr := NewTokenManager(signer, rdb)
	_, err := mgr.Parse(context.Background(), "!!!.body.sig")
	require.ErrorIs(t, err, sources.ErrTokenInvalid)
}
