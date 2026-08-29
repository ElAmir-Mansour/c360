package enroll

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/clario360/platform/internal/siem/sources"
)

// Signer abstracts the JWT signing surface. The production
// implementation is Vault transit-backed; tests use an ed25519
// keypair.
type Signer interface {
	// KeyID identifies the signing key. Returned as the JWT kid.
	KeyID() string
	// Algorithm returns the JWS alg header value (e.g. "EdDSA").
	Algorithm() string
	// Sign signs the given signing input and returns the raw signature.
	Sign(ctx context.Context, signingInput []byte) ([]byte, error)
	// Verify validates a signature over signingInput.
	Verify(ctx context.Context, signingInput, signature []byte) error
}

// Claims is the JWT body shape from PROMPT3.MD §4.5.
type Claims struct {
	Iss string `json:"iss"`
	Aud string `json:"aud"`
	Sub string `json:"sub"`
	Tnt string `json:"tnt"`
	Pur string `json:"pur"`
	JTI string `json:"jti"`
	IAT int64  `json:"iat"`
	EXP int64  `json:"exp"`
	NBF int64  `json:"nbf"`
}

// MintParams bundles inputs to Mint.
type MintParams struct {
	SourceID uuid.UUID
	TenantID uuid.UUID
	Purpose  sources.Purpose
	TTL      time.Duration
	Issuer   string // defaults to "siem-service"
	Audience string // defaults to "siem-collector"
}

// MintResult bundles outputs from Mint.
type MintResult struct {
	JWT       string
	JTI       uuid.UUID
	ExpiresAt time.Time
}

// TokenManager combines a Signer with the Redis claim primitive.
type TokenManager struct {
	signer Signer
	rdb    *redis.Client
}

// NewTokenManager constructs the manager. rdb may be nil only in
// tests that exercise the signer in isolation.
func NewTokenManager(signer Signer, rdb *redis.Client) *TokenManager {
	return &TokenManager{signer: signer, rdb: rdb}
}

// Mint produces a signed JWT and registers the JTI in Redis.
func (m *TokenManager) Mint(ctx context.Context, p MintParams) (MintResult, error) {
	if p.TTL <= 0 {
		p.TTL = 15 * time.Minute
	}
	if p.Issuer == "" {
		p.Issuer = "siem-service"
	}
	if p.Audience == "" {
		p.Audience = "siem-collector"
	}
	jti := uuid.New()
	now := time.Now().UTC()
	claims := Claims{
		Iss: p.Issuer,
		Aud: p.Audience,
		Sub: p.SourceID.String(),
		Tnt: p.TenantID.String(),
		Pur: string(p.Purpose),
		JTI: jti.String(),
		IAT: now.Unix(),
		EXP: now.Add(p.TTL).Unix(),
		NBF: now.Add(-30 * time.Second).Unix(),
	}
	tok, err := m.signClaims(ctx, claims)
	if err != nil {
		return MintResult{}, err
	}
	if err := m.registerJTI(ctx, jti, p.TTL+30*time.Second); err != nil {
		return MintResult{}, err
	}
	return MintResult{JWT: tok, JTI: jti, ExpiresAt: time.Unix(claims.EXP, 0).UTC()}, nil
}

// Parse decodes a JWT and verifies the signature + standard claim
// invariants (iss, aud, exp, nbf, purpose set). The Redis JTI claim
// is performed separately by Claim.
func (m *TokenManager) Parse(ctx context.Context, token string) (*Claims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("%w: malformed", sources.ErrTokenInvalid)
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, fmt.Errorf("%w: header b64", sources.ErrTokenInvalid)
	}
	var hdr struct {
		Alg string `json:"alg"`
		Typ string `json:"typ"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerJSON, &hdr); err != nil {
		return nil, fmt.Errorf("%w: header json", sources.ErrTokenInvalid)
	}
	if hdr.Alg != m.signer.Algorithm() {
		return nil, fmt.Errorf("%w: alg %s != %s", sources.ErrTokenInvalid, hdr.Alg, m.signer.Algorithm())
	}
	if hdr.Kid != m.signer.KeyID() {
		return nil, fmt.Errorf("%w: kid mismatch", sources.ErrTokenInvalid)
	}
	bodyJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, fmt.Errorf("%w: body b64", sources.ErrTokenInvalid)
	}
	var c Claims
	if err := json.Unmarshal(bodyJSON, &c); err != nil {
		return nil, fmt.Errorf("%w: body json", sources.ErrTokenInvalid)
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, fmt.Errorf("%w: sig b64", sources.ErrTokenInvalid)
	}
	signingInput := []byte(parts[0] + "." + parts[1])
	if err := m.signer.Verify(ctx, signingInput, sig); err != nil {
		return nil, fmt.Errorf("%w: signature", sources.ErrTokenInvalid)
	}

	now := time.Now().UTC().Unix()
	if c.EXP <= now {
		return nil, fmt.Errorf("%w: expired", sources.ErrTokenInvalid)
	}
	if c.NBF > now {
		return nil, fmt.Errorf("%w: not yet valid", sources.ErrTokenInvalid)
	}
	if c.Iss == "" || c.Aud == "" {
		return nil, fmt.Errorf("%w: missing iss/aud", sources.ErrTokenInvalid)
	}
	if c.Pur != string(sources.PurposeEnroll) && c.Pur != string(sources.PurposeRotate) {
		return nil, fmt.Errorf("%w: bad purpose %q", sources.ErrTokenInvalid, c.Pur)
	}
	return &c, nil
}

// Claim is the atomic Redis verify-and-claim. Returns the parsed
// claims if-and-only-if the JTI transitions from issued→consumed in
// one operation. Subsequent calls with the same JTI return
// ErrTokenConsumed.
func (m *TokenManager) Claim(ctx context.Context, token, ip string) (*Claims, error) {
	c, err := m.Parse(ctx, token)
	if err != nil {
		return nil, err
	}
	if m.rdb == nil {
		return nil, errors.New("enroll: redis not configured")
	}
	// Lua: only flip if currently "issued".
	const lua = `
local current = redis.call("GET", KEYS[1])
if current == false then
  return -1
end
if current ~= "issued" then
  return 0
end
redis.call("SET", KEYS[1], ARGV[1], "KEEPTTL")
return 1`

	key := jtiKey(c.JTI)
	res, err := m.rdb.Eval(ctx, lua, []string{key}, "consumed:"+ip).Int()
	if err != nil {
		return nil, fmt.Errorf("claim: %w", err)
	}
	switch res {
	case 1:
		return c, nil
	case 0:
		return nil, fmt.Errorf("%w: jti=%s", sources.ErrTokenConsumed, c.JTI)
	case -1:
		// JTI key missing — either expired in Redis or never issued.
		// Treat as consumed (it cannot be safely accepted because the
		// Redis claim itself is the authoritative single-use guard).
		return nil, fmt.Errorf("%w: jti=%s missing", sources.ErrTokenConsumed, c.JTI)
	default:
		return nil, fmt.Errorf("claim: unexpected result %d", res)
	}
}

func (m *TokenManager) signClaims(ctx context.Context, c Claims) (string, error) {
	hdr := map[string]string{
		"alg": m.signer.Algorithm(),
		"typ": "JWT",
		"kid": m.signer.KeyID(),
	}
	hdrJSON, _ := json.Marshal(hdr)
	bodyJSON, _ := json.Marshal(c)
	signingInput := base64.RawURLEncoding.EncodeToString(hdrJSON) + "." +
		base64.RawURLEncoding.EncodeToString(bodyJSON)
	sig, err := m.signer.Sign(ctx, []byte(signingInput))
	if err != nil {
		return "", fmt.Errorf("sign: %w", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

func (m *TokenManager) registerJTI(ctx context.Context, jti uuid.UUID, ttl time.Duration) error {
	if m.rdb == nil {
		return nil
	}
	if err := m.rdb.Set(ctx, jtiKey(jti.String()), "issued", ttl).Err(); err != nil {
		return fmt.Errorf("redis set jti: %w", err)
	}
	return nil
}

func jtiKey(jti string) string { return "enroll:jti:" + jti }

// Ed25519Signer is the in-process signer used by tests and any
// environment that has not yet provisioned Vault transit. It is
// EXPLICITLY not for production use — production wires a Vault
// transit-backed Signer in main.go.
type Ed25519Signer struct {
	kid  string
	priv ed25519.PrivateKey
	pub  ed25519.PublicKey
}

// NewEd25519Signer constructs a deterministic Ed25519Signer.
func NewEd25519Signer(kid string, priv ed25519.PrivateKey) *Ed25519Signer {
	return &Ed25519Signer{kid: kid, priv: priv, pub: priv.Public().(ed25519.PublicKey)}
}

// KeyID returns the key identifier.
func (s *Ed25519Signer) KeyID() string { return s.kid }

// Algorithm returns "EdDSA".
func (s *Ed25519Signer) Algorithm() string { return "EdDSA" }

// Sign signs signingInput with the private key.
func (s *Ed25519Signer) Sign(_ context.Context, signingInput []byte) ([]byte, error) {
	return ed25519.Sign(s.priv, signingInput), nil
}

// Verify validates the signature over signingInput.
func (s *Ed25519Signer) Verify(_ context.Context, signingInput, signature []byte) error {
	if !ed25519.Verify(s.pub, signingInput, signature) {
		return errors.New("invalid signature")
	}
	return nil
}
