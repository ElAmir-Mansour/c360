// Package payloadcrypto provides field-level PAYLOAD ENCRYPTION AT REST for
// sensitive workflow data (the form_data / variables / step_outputs JSONB
// carried by workflow_instances, workflow_step_executions, and workflow_tasks).
//
// Governance / PDPL context: sensitive approval content (PII, confidential
// legal/settlement figures, approval justifications) previously sat in plaintext
// in those JSONB columns. This package encrypts the VALUES of CLASSIFIED keys at
// rest and transparently decrypts them on read, so a database snapshot / backup
// / replica never exposes the cleartext to a reader who lacks the data key.
//
// It does NOT invent a cipher. It REUSES the platform's existing field crypto —
// internal/lex/crypto.FieldCrypto (AES-256-GCM, per-value random nonce, the
// self-describing "enc:v1:<base64>" ciphertext-prefix envelope, a KeyProvider
// seam for software-custody or Vault/KMS-backed external custody, and
// legacy-plaintext-passthrough on read). This package is a thin, map-shaped
// adapter over that primitive:
//
//   - Classification: a caller-supplied set of top-level keys (derived from
//     FormField.Sensitivity and WorkflowDefinition.SensitiveVariableKeys) selects
//     WHICH values in a map are sensitive. An UNCLASSIFIED key is left in
//     plaintext exactly as before.
//   - Encrypt at rest: the sensitive value is JSON-encoded, then wrapped in an
//     "enc:v1:" envelope by the reused FieldCrypto, so the at-rest bytes are
//     self-describing and differ from the plaintext.
//   - Decrypt on read: BOTH encrypted envelopes AND legacy plaintext are handled.
//     A value WITHOUT the "enc:v1:" prefix is legacy plaintext and returned as-is
//     (existing rows keep working). A value WITH the prefix is decrypted; a
//     corrupted / tampered / wrong-key envelope FAILS CLOSED (returns an error)
//     rather than surfacing ciphertext as if it were plaintext.
//
// OPTIONAL via a type-assertion seam: callers hold a *Codec that MAY be nil. A
// nil *Codec means "no encryptor wired" — Encrypt/Decrypt are pure pass-throughs
// and the legacy plaintext behavior is preserved bit-for-bit. This is what keeps
// every existing test double and every un-migrated deployment unaffected.
package payloadcrypto

import (
	"encoding/json"
	"errors"
	"fmt"

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
)

// FieldEncryptor is the minimal surface this package needs from a field crypto
// implementation. internal/lex/crypto.FieldCrypto satisfies it. Declaring it as
// an interface (rather than depending on the concrete type) keeps the seam
// testable and lets a future crypto backend drop in without touching call sites.
type FieldEncryptor interface {
	// Encrypt returns an "enc:v1:<base64>" envelope for a non-empty plaintext, and
	// returns an empty string / already-enveloped value unchanged (idempotent).
	Encrypt(plaintext string) (string, error)
	// Decrypt returns the plaintext for an "enc:v1:" envelope, returns a
	// non-enveloped (legacy plaintext) value unchanged, and FAILS CLOSED on a
	// corrupt/tampered envelope.
	Decrypt(value string) (string, error)
	// Provider returns a short custody label (e.g. "software", "vault").
	Provider() string
}

// Codec encrypts the values of CLASSIFIED keys in a string-keyed map before it is
// persisted to JSONB, and decrypts them transparently on read. It is safe to call
// on a NIL *Codec: every method degrades to a legacy plaintext pass-through, which
// is the "no encryptor wired" behavior that keeps existing deployments and test
// doubles unchanged.
//
// A Codec does NOT own the classification. The set of sensitive keys travels with
// each Encrypt call (derived by the caller from the definition / form schema at
// write time), so a single Codec instance serves every tenant and every workflow.
// Decrypt needs no key set: an "enc:v1:" envelope is self-describing, so a value
// that was encrypted is decrypted, and a plaintext value is left alone —
// regardless of whether the reading definition still classifies that key.
type Codec struct {
	enc       FieldEncryptor
	residency string
}

// New builds a Codec over the supplied field encryptor (typically an
// *internal/lex/crypto.FieldCrypto). It returns an error if enc is nil so a
// caller that intends to encrypt cannot silently get plaintext behavior; a caller
// that wants the legacy pass-through should hold a nil *Codec instead of calling
// New. residency is an OPTIONAL data-residency pin (e.g. "ksa") stamped into each
// envelope's metadata for sovereignty audit; pass "" to omit it.
func New(enc FieldEncryptor, residency string) (*Codec, error) {
	if enc == nil {
		return nil, errors.New("payloadcrypto: New requires a non-nil field encryptor")
	}
	return &Codec{enc: enc, residency: residency}, nil
}

// Provider returns the custody label of the underlying encryptor, or "none" when
// no codec is wired (nil receiver). Used for structured logging / audit WITHOUT
// ever emitting key material.
func (c *Codec) Provider() string {
	if c == nil || c.enc == nil {
		return "none"
	}
	return c.enc.Provider()
}

// EncryptMap returns a COPY of m in which the values of the keys named in
// sensitive are replaced by "enc:v1:" envelopes. The input map is never mutated
// (the engine keeps operating on plaintext in memory; only the at-rest copy is
// encrypted). Rules:
//
//   - A nil *Codec, an empty sensitive set, or a nil/empty map returns m unchanged
//     (legacy plaintext behavior — the exact pre-encryption path).
//   - A sensitive key whose value is nil, or already an "enc:v1:" envelope, is left
//     as-is (nothing to protect / idempotent re-encrypt).
//   - Any other sensitive value is JSON-encoded and wrapped in an envelope. The
//     JSON encoding preserves the value's type across the round-trip (a number
//     stays a number, an object stays an object) — DecryptMap reverses it.
//   - An UNCLASSIFIED key whose value is a NESTED map[string]interface{} is
//     RECURSED into, so a classified key found at ANY depth is enveloped. This is
//     what protects the real step_outputs shape {stepID:{"output":{field:val}}},
//     where the classified FIELD name is nested two levels below the step id (the
//     step id itself is not a sensitive key). The nested map is copied, not
//     mutated. A classified key whose OWN value is a map is enveloped whole (the
//     entire object is sealed) rather than recursed — classification wins over
//     descent, so a classified sub-object is never left partially in plaintext.
//   - Any other UNCLASSIFIED key is copied through in plaintext.
//
// FAIL-CLOSED: if encryption of a classified value errors, EncryptMap returns the
// error and NO map — the caller must not persist plaintext when encryption was
// requested.
func (c *Codec) EncryptMap(sensitive map[string]bool, m map[string]interface{}) (map[string]interface{}, error) {
	if c == nil || c.enc == nil || len(sensitive) == 0 || len(m) == 0 {
		return m, nil
	}
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		if v == nil {
			out[k] = v
			continue
		}
		if sensitive[k] {
			if s, ok := v.(string); ok && lexcrypto.IsEncrypted(s) {
				// Already an envelope (idempotent re-persist) — carry through.
				out[k] = v
				continue
			}
			env, err := c.encryptValue(v)
			if err != nil {
				return nil, fmt.Errorf("payloadcrypto: encrypting %q: %w", k, err)
			}
			out[k] = env
			continue
		}
		// UNCLASSIFIED key: descend into a nested object so a classified key at a
		// deeper level (the step_outputs {stepID:{output:{field}}} shape) is still
		// protected. Non-map values are copied through unchanged.
		if nested, ok := v.(map[string]interface{}); ok {
			enc, err := c.EncryptMap(sensitive, nested)
			if err != nil {
				return nil, err
			}
			out[k] = enc
			continue
		}
		out[k] = v
	}
	return out, nil
}

// DecryptMap returns a COPY of m in which any "enc:v1:" envelope value is
// decrypted back to its original typed value. It needs NO classification set: the
// envelope is self-describing. Rules:
//
//   - A nil *Codec or a nil/empty map returns m unchanged.
//   - A value that is NOT an "enc:v1:" envelope (legacy plaintext, numbers,
//     objects, booleans) is copied through unchanged — this is the backward-compat
//     path for rows written before encryption was enabled.
//   - A value that IS a NESTED map[string]interface{} is RECURSED into, so an
//     envelope written at any depth by EncryptMap (the step_outputs
//     {stepID:{output:{field}}} shape) is transparently decrypted on read. The
//     nested map is copied, not mutated.
//   - An envelope value is decrypted and JSON-decoded back to its original type.
//
// FAIL-CLOSED: a value that CARRIES the "enc:v1:" prefix but fails to decrypt
// (tampered, truncated, wrong key) returns an error and NO map. It is never
// returned as-if-plaintext, so ciphertext can never leak to a reader through a
// swallowed error.
func (c *Codec) DecryptMap(m map[string]interface{}) (map[string]interface{}, error) {
	if c == nil || c.enc == nil || len(m) == 0 {
		return m, nil
	}
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		if nested, ok := v.(map[string]interface{}); ok {
			dec, err := c.DecryptMap(nested)
			if err != nil {
				return nil, err
			}
			out[k] = dec
			continue
		}
		s, ok := v.(string)
		if !ok || !lexcrypto.IsEncrypted(s) {
			// Not an envelope: legacy plaintext / non-string typed value — as-is.
			out[k] = v
			continue
		}
		dec, err := c.decryptValue(s)
		if err != nil {
			return nil, fmt.Errorf("payloadcrypto: decrypting %q: %w", k, err)
		}
		out[k] = dec
	}
	return out, nil
}

// envelopeMeta is the JSON structure sealed inside an envelope. It carries the
// original value (preserving its JSON type) plus optional residency metadata so a
// sovereignty audit can prove where the data key is custodied WITHOUT decrypting
// the payload's semantics. The struct is versioned implicitly by the "enc:v1:"
// prefix the underlying crypto stamps.
type envelopeMeta struct {
	// V is the original value, re-encoded as JSON so its type survives the
	// round-trip (string/number/bool/object/array).
	V json.RawMessage `json:"v"`
	// R is the OPTIONAL residency pin (e.g. "ksa"); omitted when empty.
	R string `json:"r,omitempty"`
}

// encryptValue JSON-encodes v (with any residency pin) and seals it in an
// "enc:v1:" envelope via the reused field crypto.
func (c *Codec) encryptValue(v interface{}) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("marshaling value for encryption: %w", err)
	}
	meta := envelopeMeta{V: raw, R: c.residency}
	metaJSON, err := json.Marshal(meta)
	if err != nil {
		return "", fmt.Errorf("marshaling envelope metadata: %w", err)
	}
	// The reused FieldCrypto returns a value UNCHANGED when its input is empty; our
	// metaJSON is never empty (it always contains at least {"v":...}), so an
	// envelope is always produced for a classified value.
	env, err := c.enc.Encrypt(string(metaJSON))
	if err != nil {
		return "", err
	}
	return env, nil
}

// decryptValue reverses encryptValue: it decrypts the envelope, unwraps the
// metadata, and JSON-decodes the original value back to its native type.
func (c *Codec) decryptValue(env string) (interface{}, error) {
	plain, err := c.enc.Decrypt(env)
	if err != nil {
		return nil, err
	}
	var meta envelopeMeta
	if err := json.Unmarshal([]byte(plain), &meta); err != nil {
		return nil, fmt.Errorf("unmarshaling envelope metadata: %w", err)
	}
	var v interface{}
	if err := json.Unmarshal(meta.V, &v); err != nil {
		return nil, fmt.Errorf("unmarshaling decrypted value: %w", err)
	}
	return v, nil
}

// IsEncrypted reports whether a stored value string is an at-rest envelope. It is
// a pass-through to the reused primitive so masking / audit code can detect an
// encrypted value without importing lex.
func IsEncrypted(value string) bool {
	return lexcrypto.IsEncrypted(value)
}
