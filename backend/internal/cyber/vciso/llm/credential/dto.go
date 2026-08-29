// Package credential implements the encrypted per-tenant LLM API-key store and
// service (STAGE 1). Each tenant owns ONE LLM credential. The plaintext key is
// never persisted (encrypted at rest via crypto.SecretCrypto) and never returned
// from any read path -- the Status DTO has no key field by construction.
package credential

import "time"

// Status is the write-only-safe read shape returned by Set / Rotate / GetStatus.
// It structurally cannot leak the API key: there is no api_key / cipher field.
type Status struct {
	Configured    bool       `json:"configured"`
	Enabled       bool       `json:"enabled"`
	Provider      string     `json:"provider,omitempty"`
	Model         string     `json:"model,omitempty"`
	Version       int64      `json:"version,omitempty"`
	LastRotatedAt *time.Time `json:"last_rotated_at,omitempty"`
	UpdatedAt     *time.Time `json:"updated_at,omitempty"`
}
