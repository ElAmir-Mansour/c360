package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/rs/zerolog"

	drconfig "github.com/clario360/platform/internal/dr/config"
	siemenroll "github.com/clario360/platform/internal/siem/sources/enroll"
)

func configureDREnrollmentSigner(cfg *drconfig.Config, logger zerolog.Logger) (siemenroll.Signer, error) {
	if cfg == nil {
		return nil, errors.New("dr enrollment signer: config is nil")
	}
	keyName := strings.TrimSpace(cfg.EnrollTokenKeyName)
	if keyName == "" {
		keyName = "dr-enrollment-jwt"
	}

	keySource, keyBytes, err := configuredEnrollmentKeyMaterial(cfg)
	if err != nil {
		return nil, err
	}
	if len(keyBytes) > 0 {
		priv, kid, err := parseDREd25519PrivateKey(keyBytes)
		if err != nil {
			return nil, fmt.Errorf("dr enrollment signer: %s: %w", keySource, err)
		}
		if kid != "" {
			keyName = kid
		}
		logger.Info().Str("kid", keyName).Str("source", keySource).Msg("using configured durable DR enrollment-token signer")
		return siemenroll.NewEd25519Signer(keyName, priv), nil
	}

	env := strings.TrimSpace(os.Getenv("ENVIRONMENT"))
	if env == "" {
		env = "development"
	}
	if isProductionEnvironment(env) {
		return nil, errors.New("dr enrollment signer: production requires DR_ENROLL_TOKEN_PRIVATE_KEY_PATH, DR_ENROLL_TOKEN_PRIVATE_KEY_PEM, or DR_ENROLL_TOKEN_PRIVATE_JWK")
	}
	if !cfg.AllowEphemeralEnrollKey && !isDevelopmentEnvironment(env) {
		return nil, fmt.Errorf("dr enrollment signer: ephemeral key fallback is disabled for environment %q", env)
	}
	return newDREphemeralSigner(keyName, logger), nil
}

func configuredEnrollmentKeyMaterial(cfg *drconfig.Config) (string, []byte, error) {
	type source struct {
		name  string
		value string
	}
	sources := []source{
		{name: "DR_ENROLL_TOKEN_PRIVATE_KEY_PATH", value: strings.TrimSpace(cfg.EnrollTokenPrivateKeyPath)},
		{name: "DR_ENROLL_TOKEN_PRIVATE_KEY_PEM", value: strings.TrimSpace(cfg.EnrollTokenPrivateKeyPEM)},
		{name: "DR_ENROLL_TOKEN_PRIVATE_JWK", value: strings.TrimSpace(cfg.EnrollTokenPrivateJWK)},
	}
	var configured []source
	for _, src := range sources {
		if src.value != "" {
			configured = append(configured, src)
		}
	}
	if len(configured) == 0 {
		return "", nil, nil
	}
	if len(configured) > 1 {
		return "", nil, errors.New("dr enrollment signer: configure exactly one enrollment private key source")
	}
	src := configured[0]
	if src.name == "DR_ENROLL_TOKEN_PRIVATE_KEY_PATH" {
		b, err := os.ReadFile(src.value)
		if err != nil {
			return "", nil, fmt.Errorf("dr enrollment signer: read %s %q: %w", src.name, src.value, err)
		}
		return src.name, b, nil
	}
	return src.name, []byte(src.value), nil
}

func parseDREd25519PrivateKey(data []byte) (ed25519.PrivateKey, string, error) {
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) == 0 {
		return nil, "", errors.New("private key material is empty")
	}
	if bytes.HasPrefix(trimmed, []byte("{")) {
		return parseDREd25519JWK(trimmed)
	}
	block, rest := pem.Decode(trimmed)
	if block == nil {
		return nil, "", errors.New("private key must be PKCS#8 PEM or Ed25519 OKP JWK")
	}
	if len(bytes.TrimSpace(rest)) > 0 {
		return nil, "", errors.New("private key PEM contains trailing data")
	}
	if block.Type != "PRIVATE KEY" {
		return nil, "", fmt.Errorf("unsupported PEM block %q; expected PRIVATE KEY", block.Type)
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, "", err
	}
	priv, ok := key.(ed25519.PrivateKey)
	if !ok {
		return nil, "", fmt.Errorf("unsupported private key type %T; expected Ed25519", key)
	}
	if len(priv) != ed25519.PrivateKeySize {
		return nil, "", fmt.Errorf("invalid Ed25519 private key length %d", len(priv))
	}
	return priv, "", nil
}

func parseDREd25519JWK(data []byte) (ed25519.PrivateKey, string, error) {
	var jwk struct {
		Kty string `json:"kty"`
		Crv string `json:"crv"`
		Kid string `json:"kid"`
		D   string `json:"d"`
		X   string `json:"x"`
	}
	if err := json.Unmarshal(data, &jwk); err != nil {
		return nil, "", err
	}
	if jwk.Kty != "OKP" || jwk.Crv != "Ed25519" {
		return nil, "", fmt.Errorf("unsupported JWK kty/crv %q/%q; expected OKP/Ed25519", jwk.Kty, jwk.Crv)
	}
	if jwk.D == "" {
		return nil, "", errors.New("JWK missing private parameter d")
	}
	seed, err := base64.RawURLEncoding.DecodeString(jwk.D)
	if err != nil {
		return nil, "", fmt.Errorf("decode JWK d: %w", err)
	}
	if len(seed) != ed25519.SeedSize {
		return nil, "", fmt.Errorf("invalid Ed25519 JWK seed length %d", len(seed))
	}
	priv := ed25519.NewKeyFromSeed(seed)
	if jwk.X != "" {
		pub, err := base64.RawURLEncoding.DecodeString(jwk.X)
		if err != nil {
			return nil, "", fmt.Errorf("decode JWK x: %w", err)
		}
		if len(pub) != ed25519.PublicKeySize {
			return nil, "", fmt.Errorf("invalid Ed25519 JWK public key length %d", len(pub))
		}
		if !bytes.Equal(priv.Public().(ed25519.PublicKey), pub) {
			return nil, "", errors.New("JWK x does not match private parameter d")
		}
	}
	return priv, strings.TrimSpace(jwk.Kid), nil
}

func newDREphemeralSigner(keyName string, logger zerolog.Logger) *siemenroll.Ed25519Signer {
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic("ed25519 keygen: " + err.Error())
	}
	logger.Warn().Str("kid", keyName).Msg("using ephemeral DR enrollment-token signer; configure DR_ENROLL_TOKEN_PRIVATE_KEY_PATH, DR_ENROLL_TOKEN_PRIVATE_KEY_PEM, or DR_ENROLL_TOKEN_PRIVATE_JWK before production")
	return siemenroll.NewEd25519Signer(keyName, priv)
}

func isProductionEnvironment(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "prod", "production":
		return true
	default:
		return false
	}
}

func isDevelopmentEnvironment(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "", "dev", "development", "local", "test":
		return true
	default:
		return false
	}
}
