package dto

import "encoding/json"

// WebAuthnOptionsRequest is the body for POST /api/v1/auth/webauthn/options.
//
// Email is optional: when supplied, the assertion options are scoped to that
// user's registered credentials (allowCredentials populated); when empty, a
// usernameless / discoverable (resident-key) ceremony is started.
type WebAuthnOptionsRequest struct {
	Email string `json:"email,omitempty"`
}

// WebAuthnVerifyRequest is the body for POST /api/v1/auth/webauthn/verify.
//
// It is the serialized WebAuthn assertion produced by the browser's
// navigator.credentials.get() call:
//
//	{ id, rawId, type:"public-key", response:{ clientDataJSON, authenticatorData, signature, userHandle } }
//
// The shape is passed through verbatim to the go-webauthn parser, so the raw
// JSON is captured rather than modeled field-by-field.
type WebAuthnVerifyRequest struct {
	json.RawMessage
}

// UnmarshalJSON captures the entire assertion body so it can be replayed into
// protocol.ParseCredentialRequestResponseBytes during verification.
func (r *WebAuthnVerifyRequest) UnmarshalJSON(data []byte) error {
	r.RawMessage = append(r.RawMessage[:0], data...)
	return nil
}
