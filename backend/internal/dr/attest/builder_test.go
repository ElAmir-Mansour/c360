package attest

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

func TestBuilderBuildAttestationFieldsAndSealsReport(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 11, 42, 0, time.UTC)
	repo := newAttestRepo(now)
	sealer := &recordingSealer{}
	builder := newTestBuilder(t, repo, sealer, now)

	att, err := builder.BuildAttestation(context.Background(), attestRun(now))
	if err != nil {
		t.Fatalf("BuildAttestation: %v", err)
	}

	if att.RTOObjectiveSeconds != 900 || att.RTOActualSeconds != 702 {
		t.Fatalf("RTO objective/actual = %d/%d, want 900/702", att.RTOObjectiveSeconds, att.RTOActualSeconds)
	}
	if att.RPOSeconds != 42 {
		t.Fatalf("RPO seconds = %d, want 42", att.RPOSeconds)
	}
	if att.ValidationRatio != 0.9995 {
		t.Fatalf("validation ratio = %.4f, want 0.9995", att.ValidationRatio)
	}
	if att.ContentHash == "" || att.ReportObjectKey != "worm/"+att.ContentHash+".json" {
		t.Fatalf("content hash/object key = %q/%q", att.ContentHash, att.ReportObjectKey)
	}
	if len(sealer.reports) != 1 {
		t.Fatalf("sealed reports = %d, want 1", len(sealer.reports))
	}

	var report Report
	if err := json.Unmarshal(sealer.reports[0], &report); err != nil {
		t.Fatalf("unmarshal sealed report: %v", err)
	}
	if report.ContentHash != att.ContentHash {
		t.Fatalf("report hash = %q, att hash = %q", report.ContentHash, att.ContentHash)
	}
	if report.Payload.PreviousContentHash != "sha256:previous" {
		t.Fatalf("previous hash = %q", report.Payload.PreviousContentHash)
	}
	if report.Payload.Approvals.ApprovedAt == nil {
		t.Fatalf("approved_at missing")
	}
	var bundle ReportBundle
	if err := json.Unmarshal(sealer.reports[0], &bundle); err != nil {
		t.Fatalf("unmarshal sealed bundle: %v", err)
	}
	if bundle.Exports.PDFMediaType != "application/pdf" || bundle.Exports.PDFSHA256 == "" {
		t.Fatalf("PDF export metadata missing: %+v", bundle.Exports)
	}
	pdfBytes, err := base64.StdEncoding.DecodeString(bundle.Exports.PDFBase64)
	if err != nil {
		t.Fatalf("decode PDF export: %v", err)
	}
	if !bytes.HasPrefix(pdfBytes, []byte("%PDF-1.4")) {
		t.Fatalf("sealed PDF prefix = %.12q", pdfBytes)
	}
}

func TestBuilderReportJSONAndHashAreDeterministic(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 11, 42, 0, time.UTC)
	repo := newAttestRepo(now)
	builder := newTestBuilder(t, repo, &recordingSealer{}, now)
	run := attestRun(now)

	reportA, jsonA, err := builder.BuildReport(context.Background(), run)
	if err != nil {
		t.Fatalf("BuildReport A: %v", err)
	}
	reportB, jsonB, err := builder.BuildReport(context.Background(), run)
	if err != nil {
		t.Fatalf("BuildReport B: %v", err)
	}

	if reportA.ContentHash != reportB.ContentHash {
		t.Fatalf("content hashes differ: %s vs %s", reportA.ContentHash, reportB.ContentHash)
	}
	if !reflect.DeepEqual(jsonA, jsonB) {
		t.Fatalf("rendered JSON differs:\n%s\n%s", string(jsonA), string(jsonB))
	}
	recomputed, err := ContentHash(reportA.Payload)
	if err != nil {
		t.Fatalf("recompute hash: %v", err)
	}
	if recomputed != reportA.ContentHash {
		t.Fatalf("recomputed hash = %q, want %q", recomputed, reportA.ContentHash)
	}
}

func TestBuilderBuildReportFormatsIncludesNCAReadyPDFAndJSON(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 11, 42, 0, time.UTC)
	repo := newAttestRepo(now)
	builder := newTestBuilder(t, repo, &recordingSealer{}, now)

	report, formats, err := builder.BuildReportFormats(context.Background(), attestRun(now))
	if err != nil {
		t.Fatalf("BuildReportFormats: %v", err)
	}

	if !json.Valid(formats.JSON) {
		t.Fatalf("JSON export is invalid: %s", string(formats.JSON))
	}
	if !bytes.HasPrefix(formats.PDF, []byte("%PDF-1.4")) {
		t.Fatalf("PDF export prefix = %.12q, want PDF header", formats.PDF)
	}
	pdfText := string(formats.PDF)
	for _, want := range []string{
		"NCA Disaster Recovery Attestation",
		"RTO objective vs actual",
		"Achieved RPO seconds: 42",
		report.ContentHash,
	} {
		if !strings.Contains(pdfText, want) {
			t.Fatalf("PDF export missing %q", want)
		}
	}

	var decoded Report
	if err := json.Unmarshal(formats.JSON, &decoded); err != nil {
		t.Fatalf("unmarshal JSON export: %v", err)
	}
	if decoded.ContentHash != report.ContentHash {
		t.Fatalf("JSON hash = %q, report hash = %q", decoded.ContentHash, report.ContentHash)
	}

	bundle, err := RenderBundle(report, formats)
	if err != nil {
		t.Fatalf("RenderBundle: %v", err)
	}
	var decodedBundle ReportBundle
	if err := json.Unmarshal(bundle, &decodedBundle); err != nil {
		t.Fatalf("unmarshal bundle: %v", err)
	}
	if decodedBundle.ContentHash != report.ContentHash || decodedBundle.Exports.PDFBase64 == "" {
		t.Fatalf("bundle = %+v", decodedBundle)
	}
}

func TestBuilderRejectsUnvalidatedRecoveryPoint(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 11, 42, 0, time.UTC)
	repo := newAttestRepo(now)
	repo.point.IsValidated = false
	builder := newTestBuilder(t, repo, &recordingSealer{}, now)

	if _, _, err := builder.BuildReport(context.Background(), attestRun(now)); err == nil {
		t.Fatalf("expected unvalidated recovery point error")
	}
}

func newTestBuilder(t *testing.T, repo *fakeAttestRepo, sealer Sealer, now time.Time) *Builder {
	t.Helper()
	builder, err := NewBuilder(Config{
		Repository: repo,
		Runner:     fakeAttestRunner{},
		Sealer:     sealer,
		Now:        func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	return builder
}

func attestRun(now time.Time) *model.FailoverRun {
	rp := "rp-1"
	approvedBy := "approver-1"
	return &model.FailoverRun{
		ID:                  "run-1",
		TenantID:            "tenant-1",
		GroupID:             "group-1",
		Mode:                model.ModeDrill,
		Status:              model.StatusAttested,
		RecoveryPointID:     &rp,
		RTOObjectiveSeconds: 900,
		InitiatedBy:         "initiator-1",
		ApprovedBy:          &approvedBy,
		InitiatedAt:         now.Add(-702 * time.Second),
	}
}

func newAttestRepo(now time.Time) *fakeAttestRepo {
	ratio := 0.9995
	finishedGate1 := now.Add(-10 * time.Minute)
	finishedGate2 := now.Add(-9 * time.Minute)
	finishedGate3 := now.Add(-3 * time.Minute)
	return &fakeAttestRepo{
		point: &model.RecoveryPoint{
			ID:              "rp-1",
			TenantID:        "tenant-1",
			GroupID:         "group-1",
			MarkerLSN:       "0/16B6C50",
			RPOSeconds:      42,
			ObjectKeys:      map[string]string{"stream-b": "worm/b", "stream-a": "worm/a"},
			ContentHash:     "rp-content-hash",
			ValidationRatio: &ratio,
			IsValidated:     true,
			SealedAt:        now.Add(-15 * time.Minute),
		},
		steps: []*model.FailoverStep{
			{
				RunID:      "run-1",
				Step:       "gate1.validate",
				Status:     model.StepStatusPassed,
				Detail:     map[string]any{"validation_ratio": 0.9995, "rpo_seconds": 42},
				StartedAt:  now.Add(-11 * time.Minute),
				FinishedAt: &finishedGate1,
			},
			{
				RunID:      "run-1",
				Step:       "gate2.approved",
				Status:     model.StepStatusPassed,
				Detail:     map[string]any{"approved_by": "approver-1"},
				StartedAt:  now.Add(-9*time.Minute - 10*time.Second),
				FinishedAt: &finishedGate2,
			},
			{
				RunID:  "run-1",
				Step:   "gate3.execute",
				Status: model.StepStatusPassed,
				Detail: map[string]any{
					"targets": []any{
						map[string]any{"site_id": "site-b", "external_id": "vm-b"},
						map[string]any{"external_id": "vm-a", "site_id": "site-a"},
					},
					"network_profile": model.NetworkProfileIsolated,
				},
				StartedAt:  now.Add(-4 * time.Minute),
				FinishedAt: &finishedGate3,
			},
		},
		previousHash: "sha256:previous",
	}
}

type fakeAttestRunner struct{}

func (fakeAttestRunner) RunSystemRead(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}

type fakeAttestRepo struct {
	point        *model.RecoveryPoint
	steps        []*model.FailoverStep
	previousHash string
}

func (r *fakeAttestRepo) SystemGetRecoveryPoint(context.Context, repository.DBTX, string) (*model.RecoveryPoint, error) {
	return r.point, nil
}

func (r *fakeAttestRepo) SystemListFailoverSteps(context.Context, repository.DBTX, string) ([]*model.FailoverStep, error) {
	return r.steps, nil
}

func (r *fakeAttestRepo) SystemLatestAttestationHash(context.Context, repository.DBTX, string) (string, error) {
	return r.previousHash, nil
}

type recordingSealer struct {
	reports [][]byte
	opts    []SealOptions
}

func (s *recordingSealer) Seal(_ context.Context, report []byte, opts SealOptions) (SealResult, error) {
	cp := append([]byte(nil), report...)
	s.reports = append(s.reports, cp)
	s.opts = append(s.opts, opts)
	return SealResult{ObjectKey: "worm/" + opts.ContentHash + ".json"}, nil
}
