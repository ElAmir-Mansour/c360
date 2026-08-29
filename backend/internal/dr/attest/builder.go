// Package attest builds deterministic ClarioDR Gate-4 attestations.
package attest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/worm"
)

const (
	SchemaVersion = "clario.dr.attestation.v1"
	ReportKind    = "nca-ready-dr-attestation"
)

// Repository is the system-read surface required by the attestation builder.
// repository.Repository satisfies it directly.
type Repository interface {
	SystemGetRecoveryPoint(ctx context.Context, db repository.DBTX, id string) (*model.RecoveryPoint, error)
	SystemListFailoverSteps(ctx context.Context, db repository.DBTX, runID string) ([]*model.FailoverStep, error)
	SystemLatestAttestationHash(ctx context.Context, db repository.DBTX, groupID string) (string, error)
}

// SystemReadRunner runs cross-tenant system reads for the failover singleton.
type SystemReadRunner interface {
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

// Sealer persists the deterministic JSON-compatible report bundle to immutable
// storage. Tests use a fake; production can use WORMReportSealer.
type Sealer interface {
	Seal(ctx context.Context, report []byte, opts SealOptions) (SealResult, error)
}

// SealOptions describes one attestation seal operation.
type SealOptions struct {
	TenantID    string
	RunID       string
	GroupID     string
	ContentHash string
	CreatedAt   time.Time
}

// SealResult identifies the sealed immutable report object.
type SealResult struct {
	ObjectKey string
}

// WORMSealClient is the subset of the DR WORM client used by WORMReportSealer.
type WORMSealClient interface {
	EnsureBucket(ctx context.Context) error
	Seal(ctx context.Context, source io.Reader, opts worm.SealOptions) (worm.SealResult, error)
}

// WORMReportSealer stores attestation report bundles in the same object-lock
// bucket as DR recovery artifacts, under a dedicated per-run stream key.
type WORMReportSealer struct {
	Client      WORMSealClient
	RetainUntil time.Time
}

// Seal writes the attestation bytes to WORM object storage.
func (s WORMReportSealer) Seal(ctx context.Context, report []byte, opts SealOptions) (SealResult, error) {
	if s.Client == nil {
		return SealResult{}, errors.New("attest: WORM client is required")
	}
	tenantID, err := uuid.Parse(opts.TenantID)
	if err != nil {
		return SealResult{}, fmt.Errorf("attest: parse tenant id %q: %w", opts.TenantID, err)
	}
	if err := s.Client.EnsureBucket(ctx); err != nil {
		return SealResult{}, fmt.Errorf("attest: ensure WORM bucket: %w", err)
	}
	eventTime := opts.CreatedAt
	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}
	result, err := s.Client.Seal(ctx, bytes.NewReader(report), worm.SealOptions{
		TenantID:    tenantID,
		StreamID:    "attestation-" + opts.RunID,
		MarkerLSN:   opts.ContentHash,
		RetainUntil: s.RetainUntil,
		EventTime:   eventTime,
	})
	if err != nil {
		return SealResult{}, err
	}
	return SealResult{ObjectKey: result.Key}, nil
}

// Config wires a Builder.
type Config struct {
	Repository Repository
	Runner     SystemReadRunner
	Sealer     Sealer
	Now        func() time.Time
}

// Builder assembles, hashes and seals an attestation report.
type Builder struct {
	repo   Repository
	runner SystemReadRunner
	sealer Sealer
	now    func() time.Time
}

// NewBuilder constructs a Builder.
func NewBuilder(cfg Config) (*Builder, error) {
	if cfg.Repository == nil {
		return nil, errors.New("attest: repository is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("attest: system read runner is required")
	}
	if cfg.Sealer == nil {
		return nil, errors.New("attest: sealer is required")
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	return &Builder{repo: cfg.Repository, runner: cfg.Runner, sealer: cfg.Sealer, now: cfg.Now}, nil
}

// BuildAttestation satisfies failover.AttestationBuilder. It seals the
// deterministic JSON/PDF report bundle and returns the attestation row payload.
func (b *Builder) BuildAttestation(ctx context.Context, run *model.FailoverRun) (*model.Attestation, error) {
	report, formats, err := b.BuildReportFormats(ctx, run)
	if err != nil {
		return nil, err
	}
	bundle, err := RenderBundle(report, formats)
	if err != nil {
		return nil, err
	}
	sealed, err := b.sealer.Seal(ctx, bundle, SealOptions{
		TenantID:    run.TenantID,
		RunID:       run.ID,
		GroupID:     run.GroupID,
		ContentHash: report.ContentHash,
		CreatedAt:   report.Payload.GeneratedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("attest: seal report: %w", err)
	}
	if sealed.ObjectKey == "" {
		return nil, errors.New("attest: sealer returned empty object key")
	}
	return &model.Attestation{
		TenantID:            run.TenantID,
		RunID:               run.ID,
		RTOObjectiveSeconds: report.Payload.RTO.ObjectiveSeconds,
		RTOActualSeconds:    report.Payload.RTO.ActualSeconds,
		RPOSeconds:          report.Payload.RPO.Seconds,
		ValidationRatio:     report.Payload.Validation.Ratio,
		ReportObjectKey:     sealed.ObjectKey,
		ContentHash:         report.ContentHash,
		CreatedAt:           report.Payload.GeneratedAt,
	}, nil
}

// BuildReport assembles and renders the deterministic JSON report. The content
// hash is over Payload only; the final document includes that hash alongside the
// payload to avoid a circular hash.
func (b *Builder) BuildReport(ctx context.Context, run *model.FailoverRun) (*Report, []byte, error) {
	if run == nil {
		return nil, nil, errors.New("attest: run is required")
	}
	if run.RecoveryPointID == nil || *run.RecoveryPointID == "" {
		return nil, nil, errors.New("attest: run has no pinned recovery point")
	}

	var (
		point        *model.RecoveryPoint
		steps        []*model.FailoverStep
		previousHash string
	)
	if err := b.runner.RunSystemRead(ctx, func(db repository.DBTX) error {
		var err error
		point, err = b.repo.SystemGetRecoveryPoint(ctx, db, *run.RecoveryPointID)
		if err != nil {
			return err
		}
		steps, err = b.repo.SystemListFailoverSteps(ctx, db, run.ID)
		if err != nil {
			return err
		}
		previousHash, err = b.repo.SystemLatestAttestationHash(ctx, db, run.GroupID)
		return err
	}); err != nil {
		return nil, nil, err
	}
	if point.GroupID != run.GroupID {
		return nil, nil, fmt.Errorf("attest: recovery point %s belongs to group %s, not %s", point.ID, point.GroupID, run.GroupID)
	}
	if !point.IsValidated {
		return nil, nil, fmt.Errorf("attest: recovery point %s is not validated", point.ID)
	}

	generatedAt := b.now().UTC()
	payload := buildPayload(run, point, steps, previousHash, generatedAt)
	hash, err := ContentHash(payload)
	if err != nil {
		return nil, nil, err
	}
	report := &Report{ContentHash: hash, Payload: payload}
	rendered, err := RenderJSON(report)
	if err != nil {
		return nil, nil, err
	}
	return report, rendered, nil
}

// Report is the rendered immutable attestation document.
type Report struct {
	ContentHash string        `json:"content_hash"`
	Payload     ReportPayload `json:"payload"`
}

// ReportPayload is the hashable attestation content.
type ReportPayload struct {
	SchemaVersion       string               `json:"schema_version"`
	ReportKind          string               `json:"report_kind"`
	TenantID            string               `json:"tenant_id"`
	Run                 RunSection           `json:"run"`
	RecoveryPoint       RecoveryPointSection `json:"recovery_point"`
	RTO                 RTOSection           `json:"rto"`
	RPO                 RPOSection           `json:"rpo"`
	Validation          ValidationSection    `json:"validation"`
	Approvals           ApprovalSection      `json:"approvals"`
	Timeline            []StepSection        `json:"timeline"`
	PreviousContentHash string               `json:"previous_content_hash,omitempty"`
	GeneratedAt         time.Time            `json:"generated_at"`
}

type RunSection struct {
	ID          string  `json:"id"`
	GroupID     string  `json:"group_id"`
	Mode        string  `json:"mode"`
	Status      string  `json:"status"`
	InitiatedBy string  `json:"initiated_by"`
	ApprovedBy  *string `json:"approved_by,omitempty"`
}

type RecoveryPointSection struct {
	ID          string            `json:"id"`
	MarkerLSN   string            `json:"marker_lsn"`
	ContentHash string            `json:"content_hash"`
	ObjectKeys  map[string]string `json:"object_keys"`
	SealedAt    time.Time         `json:"sealed_at"`
}

type RTOSection struct {
	ObjectiveSeconds int       `json:"objective_seconds"`
	ActualSeconds    int       `json:"actual_seconds"`
	InitiatedAt      time.Time `json:"initiated_at"`
	CompletedAt      time.Time `json:"completed_at"`
}

type RPOSection struct {
	Seconds int `json:"seconds"`
}

type ValidationSection struct {
	Ratio  float64 `json:"ratio"`
	Passed bool    `json:"passed"`
}

type ApprovalSection struct {
	InitiatedBy string     `json:"initiated_by"`
	InitiatedAt time.Time  `json:"initiated_at"`
	ApprovedBy  *string    `json:"approved_by,omitempty"`
	ApprovedAt  *time.Time `json:"approved_at,omitempty"`
}

type StepSection struct {
	Step       string         `json:"step"`
	Status     string         `json:"status"`
	StartedAt  time.Time      `json:"started_at"`
	FinishedAt *time.Time     `json:"finished_at,omitempty"`
	Detail     map[string]any `json:"detail,omitempty"`
}

func buildPayload(run *model.FailoverRun, point *model.RecoveryPoint, steps []*model.FailoverStep, previousHash string, generatedAt time.Time) ReportPayload {
	completedAt := generatedAt
	if run.CompletedAt != nil {
		completedAt = run.CompletedAt.UTC()
	}
	actual := secondsBetween(run.InitiatedAt, completedAt)
	ratio := 0.0
	if point.ValidationRatio != nil {
		ratio = *point.ValidationRatio
	}
	approval := ApprovalSection{
		InitiatedBy: run.InitiatedBy,
		InitiatedAt: run.InitiatedAt.UTC(),
		ApprovedBy:  run.ApprovedBy,
	}
	if run.ApprovedBy != nil {
		approval.ApprovedAt = approvalTime(steps)
	}
	return ReportPayload{
		SchemaVersion: SchemaVersion,
		ReportKind:    ReportKind,
		TenantID:      run.TenantID,
		Run: RunSection{
			ID:          run.ID,
			GroupID:     run.GroupID,
			Mode:        run.Mode,
			Status:      run.Status,
			InitiatedBy: run.InitiatedBy,
			ApprovedBy:  run.ApprovedBy,
		},
		RecoveryPoint: RecoveryPointSection{
			ID:          point.ID,
			MarkerLSN:   point.MarkerLSN,
			ContentHash: point.ContentHash,
			ObjectKeys:  copyObjectKeys(point.ObjectKeys),
			SealedAt:    point.SealedAt.UTC(),
		},
		RTO: RTOSection{
			ObjectiveSeconds: run.RTOObjectiveSeconds,
			ActualSeconds:    actual,
			InitiatedAt:      run.InitiatedAt.UTC(),
			CompletedAt:      completedAt,
		},
		RPO:                 RPOSection{Seconds: point.RPOSeconds},
		Validation:          ValidationSection{Ratio: ratio, Passed: ratio >= 0.999},
		Approvals:           approval,
		Timeline:            stepSections(steps),
		PreviousContentHash: previousHash,
		GeneratedAt:         generatedAt,
	}
}

func approvalTime(steps []*model.FailoverStep) *time.Time {
	for _, step := range steps {
		if step.Step == "gate2.approved" && step.FinishedAt != nil {
			t := step.FinishedAt.UTC()
			return &t
		}
	}
	return nil
}

func stepSections(steps []*model.FailoverStep) []StepSection {
	out := make([]StepSection, 0, len(steps))
	for _, step := range steps {
		if step == nil {
			continue
		}
		started := step.StartedAt.UTC()
		var finished *time.Time
		if step.FinishedAt != nil {
			t := step.FinishedAt.UTC()
			finished = &t
		}
		out = append(out, StepSection{
			Step:       step.Step,
			Status:     step.Status,
			StartedAt:  started,
			FinishedAt: finished,
			Detail:     step.Detail,
		})
	}
	return out
}

func copyObjectKeys(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func secondsBetween(start, end time.Time) int {
	d := end.Sub(start)
	if d < 0 {
		return 0
	}
	return int(d.Seconds())
}

// ContentHash computes the SHA-256 hash of the canonical payload JSON.
func ContentHash(payload ReportPayload) (string, error) {
	b, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("attest: marshal payload for hash: %w", err)
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// RenderJSON renders the final report as deterministic compact JSON.
func RenderJSON(report *Report) ([]byte, error) {
	if report == nil {
		return nil, errors.New("attest: report is required")
	}
	b, err := json.Marshal(report)
	if err != nil {
		return nil, fmt.Errorf("attest: marshal report: %w", err)
	}
	return b, nil
}
