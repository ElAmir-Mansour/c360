package repository

import (
	"encoding/json"
	"testing"

	"github.com/clario360/platform/internal/workflow/model"
)

// TestTaskRepo_MarshalEncryptsClassifiedFormFieldThenScanDecrypts is the
// REGRESSION for the workflow_tasks.form_data plaintext hole. A submitted
// approval's content lives in form_data keyed by field name; a field the task's
// FormSchema classifies (Sensitivity) must be enveloped at rest and its plaintext
// must not appear in the JSONB bytes, while an unclassified field stays plaintext.
// The scan path decrypts the envelope back to the original value.
func TestTaskRepo_MarshalEncryptsClassifiedFormFieldThenScanDecrypts(t *testing.T) {
	repo := (&TaskRepository{}).WithPayloadCodec(newRepoTestCodec(t))

	schema := []model.FormField{
		{Name: "applicant_name", Type: "text", Sensitivity: model.SensitivityPII},
		{Name: "decision", Type: "select"}, // unclassified
		{Name: "settlement_amount", Type: "number", Sensitivity: model.SensitivityConfidential},
	}
	sensitive := model.SensitiveFormFieldKeys(schema)
	if !sensitive["applicant_name"] || !sensitive["settlement_amount"] || sensitive["decision"] {
		t.Fatalf("SensitiveFormFieldKeys derived wrong set: %#v", sensitive)
	}

	const applicant = "Abdullah Al Othaim"
	formData := map[string]interface{}{
		"applicant_name":    applicant,
		"decision":          "approve",
		"settlement_amount": float64(250000),
	}

	fdJSON, err := repo.marshalFormData(formData, sensitive)
	if err != nil {
		t.Fatalf("marshalFormData: %v", err)
	}
	if contains(string(fdJSON), applicant) {
		t.Fatalf("classified applicant_name LEAKED into form_data JSONB: %s", fdJSON)
	}
	if contains(string(fdJSON), "250000") {
		t.Fatalf("classified settlement_amount LEAKED into form_data JSONB: %s", fdJSON)
	}
	if !contains(string(fdJSON), "enc:v1:") {
		t.Fatalf("classified form field should be enveloped at rest, got %s", fdJSON)
	}
	if !contains(string(fdJSON), "approve") {
		t.Fatalf("unclassified field should stay plaintext, got %s", fdJSON)
	}

	// Read path: unmarshal into a task then decryptTaskFormData.
	var task model.HumanTask
	if err := json.Unmarshal(fdJSON, &task.FormData); err != nil {
		t.Fatalf("unmarshal form_data: %v", err)
	}
	if err := repo.decryptTaskFormData(&task); err != nil {
		t.Fatalf("decryptTaskFormData: %v", err)
	}
	if task.FormData["applicant_name"] != applicant {
		t.Fatalf("decrypt round-trip failed: %#v", task.FormData["applicant_name"])
	}
	if task.FormData["settlement_amount"] != float64(250000) {
		t.Fatalf("numeric decrypt round-trip failed: %#v", task.FormData["settlement_amount"])
	}
	if task.FormData["decision"] != "approve" {
		t.Fatalf("unclassified value changed: %#v", task.FormData["decision"])
	}
}

// TestTaskRepo_NoCodecIsLegacyPlaintext asserts the type-assertion seam: with no
// codec wired, marshalFormData is a plain json.Marshal (plaintext at rest) and
// decryptTaskFormData is a no-op, so existing rows and test doubles are unchanged.
func TestTaskRepo_NoCodecIsLegacyPlaintext(t *testing.T) {
	repo := &TaskRepository{} // no codec

	schema := []model.FormField{{Name: "applicant_name", Sensitivity: model.SensitivityPII}}
	formData := map[string]interface{}{"applicant_name": "Plaintext Name"}

	fdJSON, err := repo.marshalFormData(formData, model.SensitiveFormFieldKeys(schema))
	if err != nil {
		t.Fatalf("marshalFormData: %v", err)
	}
	if contains(string(fdJSON), "enc:v1:") {
		t.Fatalf("without a codec, nothing should be encrypted, got %s", fdJSON)
	}
	plain, _ := json.Marshal(formData)
	if string(plain) != string(fdJSON) {
		t.Fatalf("no-codec marshal must equal plain json.Marshal:\n got %s\nwant %s", fdJSON, plain)
	}

	task := &model.HumanTask{FormData: map[string]interface{}{"applicant_name": "Plaintext Name"}}
	if err := repo.decryptTaskFormData(task); err != nil {
		t.Fatalf("no-codec decrypt should be a no-op: %v", err)
	}
	if task.FormData["applicant_name"] != "Plaintext Name" {
		t.Fatalf("no-codec decrypt changed value: %#v", task.FormData)
	}
}

// TestTaskRepo_CorruptFormDataEnvelopeFailsClosed asserts a scanned form_data
// value carrying the enc:v1: prefix but with corrupt ciphertext fails the read
// closed (never surfaces ciphertext as plaintext).
func TestTaskRepo_CorruptFormDataEnvelopeFailsClosed(t *testing.T) {
	repo := (&TaskRepository{}).WithPayloadCodec(newRepoTestCodec(t))
	task := &model.HumanTask{FormData: map[string]interface{}{"x": "enc:v1:not-valid-ciphertext"}}
	if err := repo.decryptTaskFormData(task); err == nil {
		t.Fatal("decryptTaskFormData must fail closed on a corrupt envelope")
	}
}
