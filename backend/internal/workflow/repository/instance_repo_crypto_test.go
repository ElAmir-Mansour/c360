package repository

import (
	"encoding/json"
	"testing"

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/payloadcrypto"
)

// newRepoTestCodec builds a real software-keyed payload codec (no DB needed).
func newRepoTestCodec(t *testing.T) *payloadcrypto.Codec {
	t.Helper()
	provider, err := lexcrypto.NewSoftwareKeyProviderRandom()
	if err != nil {
		t.Fatalf("key provider: %v", err)
	}
	fc, err := lexcrypto.NewFieldCrypto(provider)
	if err != nil {
		t.Fatalf("field crypto: %v", err)
	}
	c, err := payloadcrypto.New(fc, "ksa")
	if err != nil {
		t.Fatalf("codec: %v", err)
	}
	return c
}

// TestInstanceRepo_MarshalEncryptsClassifiedThenScanDecrypts exercises the repo's
// marshal (write) + scan-decrypt (read) helpers directly (no DB): a classified
// key is stored as an enc:v1: envelope in the JSONB bytes, and reading it back
// (as scanInstance does) restores the plaintext.
func TestInstanceRepo_MarshalEncryptsClassifiedThenScanDecrypts(t *testing.T) {
	repo := NewInstanceRepository(nil).WithPayloadCodec(newRepoTestCodec(t))

	inst := &model.WorkflowInstance{
		ID:       "inst-1",
		TenantID: "tenant-1",
		Variables: map[string]interface{}{
			"applicant_name": "Confidential Applicant",
			"public":         "not secret",
		},
		StepOutputs: map[string]interface{}{
			"opinion": "confidential legal opinion",
		},
		SensitiveKeys: map[string]bool{"applicant_name": true, "opinion": true},
	}

	varsJSON, err := repo.marshalVariables(inst)
	if err != nil {
		t.Fatalf("marshalVariables: %v", err)
	}
	outsJSON, err := repo.marshalStepOutputs(inst)
	if err != nil {
		t.Fatalf("marshalStepOutputs: %v", err)
	}

	// At rest, the classified values must be enveloped, and the plaintext must not
	// appear in the JSONB bytes.
	if !contains(string(varsJSON), "enc:v1:") {
		t.Fatalf("classified variable should be enveloped at rest, got %s", varsJSON)
	}
	if contains(string(varsJSON), "Confidential Applicant") {
		t.Fatalf("plaintext leaked into stored variables JSONB: %s", varsJSON)
	}
	if !contains(string(varsJSON), "not secret") {
		t.Fatalf("unclassified variable should remain plaintext, got %s", varsJSON)
	}
	if contains(string(outsJSON), "confidential legal opinion") {
		t.Fatalf("plaintext leaked into stored step_outputs JSONB: %s", outsJSON)
	}

	// Now simulate the read path: unmarshal + decryptInstancePayload.
	var scanned model.WorkflowInstance
	if err := json.Unmarshal(varsJSON, &scanned.Variables); err != nil {
		t.Fatalf("unmarshal vars: %v", err)
	}
	if err := json.Unmarshal(outsJSON, &scanned.StepOutputs); err != nil {
		t.Fatalf("unmarshal outs: %v", err)
	}
	if err := repo.decryptInstancePayload(&scanned); err != nil {
		t.Fatalf("decryptInstancePayload: %v", err)
	}
	if scanned.Variables["applicant_name"] != "Confidential Applicant" {
		t.Fatalf("decrypt round-trip failed: %#v", scanned.Variables["applicant_name"])
	}
	if scanned.Variables["public"] != "not secret" {
		t.Fatalf("unclassified value changed: %#v", scanned.Variables["public"])
	}
	if scanned.StepOutputs["opinion"] != "confidential legal opinion" {
		t.Fatalf("step_outputs decrypt round-trip failed: %#v", scanned.StepOutputs["opinion"])
	}

	// The read path must re-record which keys were encrypted so a re-persist keeps
	// them encrypted (never demotes to plaintext).
	if !scanned.SensitiveKeys["applicant_name"] || !scanned.SensitiveKeys["opinion"] {
		t.Fatalf("scan should re-populate SensitiveKeys from at-rest envelopes, got %#v", scanned.SensitiveKeys)
	}
	if scanned.SensitiveKeys["public"] {
		t.Fatal("unclassified key must not be marked sensitive")
	}
}

// TestInstanceRepo_NestedStepOutputEncryptsClassifiedField is the REGRESSION for
// the step_outputs no-leak hole using the REAL nested shape the engine writes:
// StepOutputs[stepID] = {"output": {field: value}}. SensitiveKeys holds FIELD
// names (applicant_name / legal_opinion), NOT step ids — exactly as the engine
// stamps them from the definition. The classified field values must be enveloped
// at rest even though they are nested two levels below a non-sensitive step id,
// and the plaintext must not appear in the JSONB bytes. On read, scan-decrypt
// restores the nested plaintext AND re-records the field names into SensitiveKeys
// so a re-persist keeps them encrypted.
func TestInstanceRepo_NestedStepOutputEncryptsClassifiedField(t *testing.T) {
	repo := NewInstanceRepository(nil).WithPayloadCodec(newRepoTestCodec(t))

	const applicant = "Abdullah Al Othaim"
	const opinion = "confidential legal opinion"
	inst := &model.WorkflowInstance{
		ID:       "inst-nested",
		TenantID: "tenant-1",
		StepOutputs: map[string]interface{}{
			"intake_step": map[string]interface{}{
				"output": map[string]interface{}{
					"applicant_name": applicant,
					"public_ref":     "case-1",
				},
			},
			"review_step": map[string]interface{}{
				"output": map[string]interface{}{
					"legal_opinion": opinion,
				},
			},
		},
		// Field names, NOT step ids (the shape the engine actually stamps).
		SensitiveKeys: map[string]bool{"applicant_name": true, "legal_opinion": true},
	}

	outsJSON, err := repo.marshalStepOutputs(inst)
	if err != nil {
		t.Fatalf("marshalStepOutputs: %v", err)
	}
	if contains(string(outsJSON), applicant) {
		t.Fatalf("classified applicant_name LEAKED into step_outputs JSONB: %s", outsJSON)
	}
	if contains(string(outsJSON), opinion) {
		t.Fatalf("classified legal_opinion LEAKED into step_outputs JSONB: %s", outsJSON)
	}
	if !contains(string(outsJSON), "enc:v1:") {
		t.Fatalf("classified nested value should be enveloped at rest, got %s", outsJSON)
	}
	if !contains(string(outsJSON), "case-1") {
		t.Fatalf("unclassified nested sibling should remain plaintext, got %s", outsJSON)
	}

	// Read path: unmarshal + decryptInstancePayload restores the nested plaintext.
	var scanned model.WorkflowInstance
	if err := json.Unmarshal(outsJSON, &scanned.StepOutputs); err != nil {
		t.Fatalf("unmarshal outs: %v", err)
	}
	if err := repo.decryptInstancePayload(&scanned); err != nil {
		t.Fatalf("decryptInstancePayload: %v", err)
	}
	gotIntake := scanned.StepOutputs["intake_step"].(map[string]interface{})["output"].(map[string]interface{})
	if gotIntake["applicant_name"] != applicant {
		t.Fatalf("nested decrypt round-trip failed: %#v", gotIntake["applicant_name"])
	}
	gotReview := scanned.StepOutputs["review_step"].(map[string]interface{})["output"].(map[string]interface{})
	if gotReview["legal_opinion"] != opinion {
		t.Fatalf("nested decrypt round-trip failed (review): %#v", gotReview["legal_opinion"])
	}
	// The read must re-record the nested FIELD names so a re-persist re-encrypts
	// them (never demotes to plaintext).
	if !scanned.SensitiveKeys["applicant_name"] || !scanned.SensitiveKeys["legal_opinion"] {
		t.Fatalf("scan should re-populate nested SensitiveKeys, got %#v", scanned.SensitiveKeys)
	}
}

// TestInstanceRepo_NoCodecIsLegacyPlaintext asserts the type-assertion seam: with
// no codec wired, marshal is a plain json.Marshal (plaintext at rest) and scan
// decrypt is a no-op, so existing behavior and test doubles are unaffected.
func TestInstanceRepo_NoCodecIsLegacyPlaintext(t *testing.T) {
	repo := NewInstanceRepository(nil) // no codec

	inst := &model.WorkflowInstance{
		Variables:     map[string]interface{}{"applicant_name": "Plaintext Name"},
		SensitiveKeys: map[string]bool{"applicant_name": true}, // classified, but no codec
	}
	varsJSON, err := repo.marshalVariables(inst)
	if err != nil {
		t.Fatalf("marshalVariables: %v", err)
	}
	if contains(string(varsJSON), "enc:v1:") {
		t.Fatalf("without a codec, nothing should be encrypted, got %s", varsJSON)
	}
	if !contains(string(varsJSON), "Plaintext Name") {
		t.Fatalf("without a codec, value should be stored plaintext, got %s", varsJSON)
	}

	// Byte-for-byte identical to a plain json.Marshal of the map.
	plain, _ := json.Marshal(inst.Variables)
	if string(plain) != string(varsJSON) {
		t.Fatalf("no-codec marshal must equal plain json.Marshal:\n got %s\nwant %s", varsJSON, plain)
	}

	// decryptInstancePayload with no codec is a no-op.
	scanned := &model.WorkflowInstance{Variables: map[string]interface{}{"applicant_name": "Plaintext Name"}}
	if err := repo.decryptInstancePayload(scanned); err != nil {
		t.Fatalf("no-codec decrypt should be a no-op: %v", err)
	}
	if scanned.Variables["applicant_name"] != "Plaintext Name" {
		t.Fatalf("no-codec decrypt changed value: %#v", scanned.Variables)
	}
}

// TestInstanceRepo_CorruptEnvelopeFailsClosedOnScan asserts that a scanned value
// carrying the enc:v1: prefix but with corrupt ciphertext fails the read closed
// (never surfaces ciphertext as plaintext).
func TestInstanceRepo_CorruptEnvelopeFailsClosedOnScan(t *testing.T) {
	repo := NewInstanceRepository(nil).WithPayloadCodec(newRepoTestCodec(t))

	scanned := &model.WorkflowInstance{
		Variables: map[string]interface{}{"x": "enc:v1:not-valid-ciphertext"},
	}
	if err := repo.decryptInstancePayload(scanned); err == nil {
		t.Fatal("decryptInstancePayload must fail closed on a corrupt envelope")
	}
}

func contains(haystack, needle string) bool {
	return len(needle) == 0 || (len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
