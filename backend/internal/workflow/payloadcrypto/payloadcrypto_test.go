package payloadcrypto

import (
	"encoding/json"
	"strings"
	"testing"

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
)

// newTestCodec builds a Codec over a random software key (a real AES-256-GCM
// field crypto — the SAME primitive lex uses; not a fake). residency is stamped
// into every envelope's metadata.
func newTestCodec(t *testing.T, residency string) *Codec {
	t.Helper()
	provider, err := lexcrypto.NewSoftwareKeyProviderRandom()
	if err != nil {
		t.Fatalf("minting key provider: %v", err)
	}
	fc, err := lexcrypto.NewFieldCrypto(provider)
	if err != nil {
		t.Fatalf("building field crypto: %v", err)
	}
	c, err := New(fc, residency)
	if err != nil {
		t.Fatalf("building codec: %v", err)
	}
	return c
}

// TestClassifiedRoundTripAndCiphertextAtRest asserts that a classified field is
// encrypted on write (its at-rest value is an "enc:v1:" envelope that is NOT the
// plaintext) and decrypts back to the original typed value on read.
func TestClassifiedRoundTripAndCiphertextAtRest(t *testing.T) {
	c := newTestCodec(t, "ksa")

	plaintext := "Abdullah Al Othaim — national id 1099887766"
	in := map[string]interface{}{
		"applicant_name": plaintext,
		"amount":         float64(250000), // classified non-string value
		"public_note":    "unclassified stays plaintext",
	}
	sensitive := map[string]bool{"applicant_name": true, "amount": true}

	atRest, err := c.EncryptMap(sensitive, in)
	if err != nil {
		t.Fatalf("EncryptMap: %v", err)
	}

	// The classified string field must be an envelope at rest and must NOT equal
	// the plaintext.
	env, ok := atRest["applicant_name"].(string)
	if !ok {
		t.Fatalf("applicant_name should be a string envelope, got %T", atRest["applicant_name"])
	}
	if !IsEncrypted(env) {
		t.Fatalf("applicant_name at rest should carry the enc:v1: prefix, got %q", env)
	}
	if env == plaintext {
		t.Fatal("ciphertext at rest must NOT equal plaintext")
	}
	if strings.Contains(env, plaintext) {
		t.Fatalf("plaintext leaked into the at-rest envelope: %q", env)
	}

	// The classified numeric field must also be enveloped.
	amtEnv, ok := atRest["amount"].(string)
	if !ok || !IsEncrypted(amtEnv) {
		t.Fatalf("amount should be an enc:v1: envelope at rest, got %#v", atRest["amount"])
	}

	// Simulate persistence + reload: marshal to JSON (as the JSONB column would)
	// and unmarshal back, then decrypt.
	raw, err := json.Marshal(atRest)
	if err != nil {
		t.Fatalf("marshaling at-rest map: %v", err)
	}
	var reloaded map[string]interface{}
	if err := json.Unmarshal(raw, &reloaded); err != nil {
		t.Fatalf("unmarshaling at-rest map: %v", err)
	}

	got, err := c.DecryptMap(reloaded)
	if err != nil {
		t.Fatalf("DecryptMap: %v", err)
	}
	if got["applicant_name"] != plaintext {
		t.Fatalf("round-trip mismatch: got %v want %v", got["applicant_name"], plaintext)
	}
	if got["amount"] != float64(250000) {
		t.Fatalf("numeric round-trip mismatch / type not preserved: got %#v (%T)", got["amount"], got["amount"])
	}
	if got["public_note"] != "unclassified stays plaintext" {
		t.Fatalf("unclassified field changed: got %v", got["public_note"])
	}
}

// TestUnclassifiedStaysPlaintext asserts that a field NOT named in the sensitive
// set is stored verbatim (no envelope) at rest.
func TestUnclassifiedStaysPlaintext(t *testing.T) {
	c := newTestCodec(t, "")

	in := map[string]interface{}{
		"secret":  "protect me",
		"comment": "just a comment",
	}
	atRest, err := c.EncryptMap(map[string]bool{"secret": true}, in)
	if err != nil {
		t.Fatalf("EncryptMap: %v", err)
	}
	if got := atRest["comment"]; got != "just a comment" {
		t.Fatalf("unclassified field should be plaintext at rest, got %#v", got)
	}
	if s, _ := atRest["comment"].(string); IsEncrypted(s) {
		t.Fatal("unclassified field must NOT be enveloped")
	}
	if s, _ := atRest["secret"].(string); !IsEncrypted(s) {
		t.Fatal("classified field must be enveloped")
	}
}

// TestLegacyPlaintextReadsUnchanged asserts backward-compat: a map that was
// written BEFORE encryption was enabled (no envelopes) decrypts to itself, so
// existing rows keep working.
func TestLegacyPlaintextReadsUnchanged(t *testing.T) {
	c := newTestCodec(t, "")

	legacy := map[string]interface{}{
		"applicant_name": "legacy plaintext name",
		"amount":         float64(42),
		"flag":           true,
		"nested":         map[string]interface{}{"k": "v"},
	}
	got, err := c.DecryptMap(legacy)
	if err != nil {
		t.Fatalf("DecryptMap of legacy plaintext should succeed: %v", err)
	}
	if got["applicant_name"] != "legacy plaintext name" {
		t.Fatalf("legacy string changed: %v", got["applicant_name"])
	}
	if got["amount"] != float64(42) || got["flag"] != true {
		t.Fatalf("legacy typed values changed: %#v", got)
	}
	if nested, ok := got["nested"].(map[string]interface{}); !ok || nested["k"] != "v" {
		t.Fatalf("legacy nested object changed: %#v", got["nested"])
	}
}

// TestCorruptedEnvelopeFailsClosed asserts that a value CARRYING the enc:v1:
// prefix but with tampered/invalid ciphertext returns an error rather than being
// surfaced as-if-plaintext (never leak ciphertext through a swallowed error).
func TestCorruptedEnvelopeFailsClosed(t *testing.T) {
	c := newTestCodec(t, "")

	// A well-formed envelope produced by this codec, then tampered.
	good, err := c.EncryptMap(map[string]bool{"x": true}, map[string]interface{}{"x": "secret"})
	if err != nil {
		t.Fatalf("EncryptMap: %v", err)
	}
	env := good["x"].(string)

	// Tamper: flip the last base64 char (breaks the GCM tag / decode).
	tampered := env[:len(env)-1]
	if strings.HasSuffix(env, "A") {
		tampered += "B"
	} else {
		tampered += "A"
	}

	_, err = c.DecryptMap(map[string]interface{}{"x": tampered})
	if err == nil {
		t.Fatal("DecryptMap of a corrupted enc:v1: envelope MUST fail closed, got nil error")
	}

	// A garbage envelope (prefix + non-base64) must also fail closed, not pass
	// through as plaintext.
	_, err = c.DecryptMap(map[string]interface{}{"x": "enc:v1:!!!not-base64!!!"})
	if err == nil {
		t.Fatal("DecryptMap of a garbage enc:v1: value MUST fail closed, got nil error")
	}
}

// TestEncryptFailClosedNoPlaintext asserts that if the underlying encryptor
// errors, EncryptMap returns the error and NO map — never a plaintext fallback.
func TestEncryptFailClosedNoPlaintext(t *testing.T) {
	c, err := New(failingEncryptor{}, "")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	out, err := c.EncryptMap(map[string]bool{"x": true}, map[string]interface{}{"x": "secret"})
	if err == nil {
		t.Fatal("EncryptMap MUST fail closed when the encryptor errors")
	}
	if out != nil {
		t.Fatalf("EncryptMap must return a nil map on failure (never plaintext), got %#v", out)
	}
}

// TestNilCodecIsLegacyPassthrough asserts the type-assertion seam: a nil *Codec
// (no encryptor wired) leaves maps untouched — the exact pre-encryption behavior
// that keeps every existing deployment and test double unaffected.
func TestNilCodecIsLegacyPassthrough(t *testing.T) {
	var c *Codec // nil

	in := map[string]interface{}{"applicant_name": "plaintext"}
	out, err := c.EncryptMap(map[string]bool{"applicant_name": true}, in)
	if err != nil {
		t.Fatalf("nil-codec EncryptMap should not error: %v", err)
	}
	if s, _ := out["applicant_name"].(string); IsEncrypted(s) || s != "plaintext" {
		t.Fatalf("nil codec must pass through plaintext, got %#v", out["applicant_name"])
	}

	back, err := c.DecryptMap(out)
	if err != nil {
		t.Fatalf("nil-codec DecryptMap should not error: %v", err)
	}
	if back["applicant_name"] != "plaintext" {
		t.Fatalf("nil codec DecryptMap changed value: %#v", back)
	}
	if c.Provider() != "none" {
		t.Fatalf("nil codec Provider() should be \"none\", got %q", c.Provider())
	}
}

// TestKeyNotLogged asserts the key material never appears in any string the codec
// exposes for logging (Provider label) and never rides in an envelope in the
// clear. It also confirms New rejects a nil encryptor (so a caller cannot silently
// end up with plaintext when they intended encryption).
func TestKeyNotLogged(t *testing.T) {
	const knownKey = "0123456789abcdef0123456789abcdef" // 32 bytes, AES-256
	provider, err := lexcrypto.NewSoftwareKeyProvider([]byte(knownKey))
	if err != nil {
		t.Fatalf("key provider: %v", err)
	}
	fc, err := lexcrypto.NewFieldCrypto(provider)
	if err != nil {
		t.Fatalf("field crypto: %v", err)
	}
	c, err := New(fc, "ksa")
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	// The Provider label used in logs must be the custody label, never the key.
	if c.Provider() != "software" {
		t.Fatalf("Provider() should be the custody label, got %q", c.Provider())
	}
	if strings.Contains(c.Provider(), knownKey) {
		t.Fatal("key material leaked into the Provider() log label")
	}

	// The envelope must not contain the raw key bytes.
	atRest, err := c.EncryptMap(map[string]bool{"x": true}, map[string]interface{}{"x": "value"})
	if err != nil {
		t.Fatalf("EncryptMap: %v", err)
	}
	env := atRest["x"].(string)
	if strings.Contains(env, knownKey) {
		t.Fatal("key material leaked into the ciphertext envelope")
	}

	// New must reject a nil encryptor (fail-closed on misconfiguration).
	if _, err := New(nil, ""); err == nil {
		t.Fatal("New(nil, ...) must error so a caller cannot silently get plaintext")
	}
}

// TestIdempotentReEncrypt asserts that re-encrypting an already-enveloped value
// (a load-mutate-persist round trip) does not double-wrap it.
func TestIdempotentReEncrypt(t *testing.T) {
	c := newTestCodec(t, "")

	first, err := c.EncryptMap(map[string]bool{"x": true}, map[string]interface{}{"x": "secret"})
	if err != nil {
		t.Fatalf("EncryptMap: %v", err)
	}
	env := first["x"].(string)

	// Feed the envelope back in as if it were still classified.
	second, err := c.EncryptMap(map[string]bool{"x": true}, map[string]interface{}{"x": env})
	if err != nil {
		t.Fatalf("re-EncryptMap: %v", err)
	}
	if second["x"].(string) != env {
		t.Fatal("re-encrypting an existing envelope must be idempotent (no double-wrap)")
	}
	got, err := c.DecryptMap(second)
	if err != nil {
		t.Fatalf("DecryptMap: %v", err)
	}
	if got["x"] != "secret" {
		t.Fatalf("idempotent re-encrypt broke the round trip: %#v", got["x"])
	}
}

// TestNestedStepOutputShapeEncryptsClassifiedField is the REGRESSION for the
// step_outputs no-leak hole. The engine stores a human-task/step output as the
// REAL nested shape StepOutputs[stepID] = {"output": {field: value}} — the
// classified FIELD name (applicant_name) sits TWO levels below a NON-sensitive
// top-level key (the step id). The old top-level-only EncryptMap left it in
// plaintext. This asserts the classified value is enveloped at rest wherever it
// is nested, that its plaintext appears NOWHERE in the at-rest JSON, that an
// unclassified sibling field stays plaintext, and that DecryptMap restores the
// original nested value.
func TestNestedStepOutputShapeEncryptsClassifiedField(t *testing.T) {
	c := newTestCodec(t, "ksa")

	const applicant = "Abdullah Al Othaim"
	const opinion = "confidential legal opinion text"
	// The classification set holds FIELD names (as the definition derives them),
	// NOT step ids.
	sensitive := map[string]bool{"applicant_name": true, "legal_opinion": true}

	stepOutputs := map[string]interface{}{
		"intake_step": map[string]interface{}{
			"output": map[string]interface{}{
				"applicant_name": applicant,       // classified, nested 2 deep
				"public_ref":     "case-2026-001", // unclassified sibling
			},
		},
		"review_step": map[string]interface{}{
			"output": map[string]interface{}{
				"legal_opinion": opinion, // classified, different step
			},
		},
	}

	atRest, err := c.EncryptMap(sensitive, stepOutputs)
	if err != nil {
		t.Fatalf("EncryptMap: %v", err)
	}

	raw, err := json.Marshal(atRest)
	if err != nil {
		t.Fatalf("marshaling at-rest step_outputs: %v", err)
	}
	atRestJSON := string(raw)

	// The exact PDPL leak the wave targets: neither classified plaintext may
	// appear anywhere in the persisted bytes.
	if strings.Contains(atRestJSON, applicant) {
		t.Fatalf("classified applicant_name LEAKED into step_outputs at rest: %s", atRestJSON)
	}
	if strings.Contains(atRestJSON, opinion) {
		t.Fatalf("classified legal_opinion LEAKED into step_outputs at rest: %s", atRestJSON)
	}
	// The classified values must be envelopes at their nested location.
	intakeOut := atRest["intake_step"].(map[string]interface{})["output"].(map[string]interface{})
	if env, ok := intakeOut["applicant_name"].(string); !ok || !IsEncrypted(env) {
		t.Fatalf("nested applicant_name should be an enc:v1: envelope, got %#v", intakeOut["applicant_name"])
	}
	// The unclassified sibling stays plaintext.
	if intakeOut["public_ref"] != "case-2026-001" {
		t.Fatalf("unclassified sibling should stay plaintext, got %#v", intakeOut["public_ref"])
	}
	if !strings.Contains(atRestJSON, "case-2026-001") {
		t.Fatalf("unclassified sibling should be readable at rest, got %s", atRestJSON)
	}

	// Round-trip: reload from JSON then decrypt recursively.
	var reloaded map[string]interface{}
	if err := json.Unmarshal(raw, &reloaded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	got, err := c.DecryptMap(reloaded)
	if err != nil {
		t.Fatalf("DecryptMap: %v", err)
	}
	gotIntake := got["intake_step"].(map[string]interface{})["output"].(map[string]interface{})
	if gotIntake["applicant_name"] != applicant {
		t.Fatalf("nested decrypt round-trip failed: %#v", gotIntake["applicant_name"])
	}
	gotReview := got["review_step"].(map[string]interface{})["output"].(map[string]interface{})
	if gotReview["legal_opinion"] != opinion {
		t.Fatalf("nested decrypt round-trip failed (review): %#v", gotReview["legal_opinion"])
	}
}

// failingEncryptor is a FieldEncryptor whose Encrypt always errors — used to
// prove EncryptMap fails closed and never persists plaintext.
type failingEncryptor struct{}

func (failingEncryptor) Encrypt(string) (string, error) {
	return "", errTestEncrypt
}
func (failingEncryptor) Decrypt(v string) (string, error) { return v, nil }
func (failingEncryptor) Provider() string                 { return "failing" }

var errTestEncrypt = &encErr{}

type encErr struct{}

func (*encErr) Error() string { return "test: encrypt failed" }
