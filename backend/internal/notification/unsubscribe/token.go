// Package unsubscribe issues and verifies the HMAC-signed tokens carried by the
// RFC 8058 List-Unsubscribe one-click URL. The token binds a (tenant, user,
// notification-type) tuple so the public, no-auth unsubscribe handler can trust
// the request without a session: possession of a validly-signed token is the
// sole credential.
package unsubscribe

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrInvalidToken is returned when a token is malformed, has a bad signature, or
// carries an empty tenant/user. It is deliberately opaque so the handler never
// leaks which check failed.
var ErrInvalidToken = errors.New("invalid unsubscribe token")

// Claims is the payload embedded in an unsubscribe token. Field names are kept
// short because the token travels in a URL.
type Claims struct {
	TenantID string `json:"t"`
	UserID   string `json:"u"`
	Type     string `json:"y"`
	IssuedAt int64  `json:"i"`
}

// Sign produces a signed, URL-safe unsubscribe token of the form
// "<base64url(payload)>.<base64url(hmac-sha256)>".
func Sign(secret, tenantID, userID, notifType string) (string, error) {
	if secret == "" {
		return "", errors.New("unsubscribe: empty signing secret")
	}
	if tenantID == "" || userID == "" {
		return "", errors.New("unsubscribe: tenant and user are required")
	}
	payload, err := json.Marshal(Claims{
		TenantID: tenantID,
		UserID:   userID,
		Type:     notifType,
		IssuedAt: time.Now().Unix(),
	})
	if err != nil {
		return "", fmt.Errorf("marshal unsubscribe claims: %w", err)
	}
	encPayload := base64.RawURLEncoding.EncodeToString(payload)
	return encPayload + "." + mac(secret, encPayload), nil
}

// Verify checks the token signature and returns its claims. It uses a
// constant-time comparison to defeat timing attacks and rejects tokens with an
// empty tenant or user.
func Verify(secret, token string) (*Claims, error) {
	if secret == "" {
		return nil, errors.New("unsubscribe: empty signing secret")
	}
	encPayload, sig, ok := strings.Cut(token, ".")
	if !ok || encPayload == "" || sig == "" {
		return nil, ErrInvalidToken
	}
	expected := mac(secret, encPayload)
	if !hmac.Equal([]byte(expected), []byte(sig)) {
		return nil, ErrInvalidToken
	}
	raw, err := base64.RawURLEncoding.DecodeString(encPayload)
	if err != nil {
		return nil, ErrInvalidToken
	}
	var claims Claims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return nil, ErrInvalidToken
	}
	if claims.TenantID == "" || claims.UserID == "" {
		return nil, ErrInvalidToken
	}
	return &claims, nil
}

// mac returns the base64url-encoded HMAC-SHA256 of msg under secret.
func mac(secret, msg string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(msg))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
