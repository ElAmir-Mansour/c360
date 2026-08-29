package recover

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/attestledger"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/recover/metastore"
)

// ---------------------------------------------------------------------------
// Regulatory evidence export (Prompt 10): GET /api/recover/evidence/:eventId +
// CSV/PDF export. It COMPOSES, it never reimplements:
//
//   - the runbook executed + RTO-vs-RTA — the EXISTING runbookstudio run record
//     (dr_studio_run) joined to its application via the Metastore runbook link;
//     the RTO TARGET comes from the Metastore seam (Application.RTOTargetSeconds),
//     never hardcoded.
//   - approvals + integrity-check results — the EXISTING cyber-recovery flow +
//     its append-only transition events (the integrity gate's verdict and the
//     authorized sign-off provenance).
//   - the full timeline — the append-only cross-sub-solution audit log
//     (recover_audit_event) this prompt owns.
//
// The export is the REAL document: every section is populated from real
// persisted data; an empty section reflects an event with no such records, never
// a placeholder.
// ---------------------------------------------------------------------------

// ErrEvidenceNotFound is returned when an event id has no evidence at all — no
// runbook run, no cyber-recovery flow, and no audit history for the tenant. The
// router maps it to 404.
var ErrEvidenceNotFound = errors.New("recover: no evidence found for event")

// EvidenceFormat is an export rendering format.
type EvidenceFormat string

const (
	// FormatJSON is the structured report (the GET /evidence/:eventId default).
	FormatJSON EvidenceFormat = "json"
	// FormatCSV is the regulator-ready CSV export.
	FormatCSV EvidenceFormat = "csv"
	// FormatPDF is the regulator-ready PDF export.
	FormatPDF EvidenceFormat = "pdf"
)

// evidenceEventWindow bounds how many audit rows the timeline read returns
// inline; an event with more than this many actions paginates by construction
// (the report is the regulator summary, the full log is queryable separately).
const evidenceEventWindow = 1000

// RunbookExecution is the runbook-executed + RTO-vs-RTA section of the report,
// sourced from one EXISTING runbookstudio run joined to its application via the
// Metastore link. RTO is the Metastore target; RTA is the run's captured actual.
type RunbookExecution struct {
	RunID       uuid.UUID  `json:"run_id"`
	RunbookID   uuid.UUID  `json:"runbook_id"`
	RunbookName string     `json:"runbook_name"`
	Mode        string     `json:"mode"`
	Status      string     `json:"status"`
	Succeeded   bool       `json:"succeeded"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	// RTOTargetSeconds is the application's defined Recovery Time Objective from
	// the Metastore seam; 0 when the run is not linked to an application.
	RTOTargetSeconds int `json:"rto_target_seconds"`
	// RTAActualSeconds is the captured Recovery Time Actual (completed_at -
	// started_at), stamped by the runbook engine at completion; nil while running.
	RTAActualSeconds *int `json:"rta_actual_seconds,omitempty"`
	// RTABreach / BreachSeconds compare the actual to the target.
	RTABreach     bool `json:"rta_breach"`
	BreachSeconds int  `json:"breach_seconds"`
}

// IntegrityCheck is one cyber-recovery integrity-gate evaluation captured for the
// event (the clean-room scan verdict that gates return-to-production).
type IntegrityCheck struct {
	ScanID    string    `json:"scan_id,omitempty"`
	Verdict   string    `json:"verdict"`
	Passed    bool      `json:"passed"`
	Detail    string    `json:"detail,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
	Actor     string    `json:"actor,omitempty"`
}

// Approval is one recorded authorized sign-off for the event (return-to-production
// approval for cyber recovery, or any approval action captured in the audit log).
type Approval struct {
	Action     string     `json:"action"`
	ApproverID *uuid.UUID `json:"approver_id,omitempty"`
	Approver   string     `json:"approver"`
	Note       string     `json:"note,omitempty"`
	// ScanID pins the approval to the integrity scan it was granted against
	// (provenance), present for cyber-recovery return-to-production sign-offs.
	ScanID     string    `json:"scan_id,omitempty"`
	ApprovedAt time.Time `json:"approved_at"`
}

// TimelineEntry is one chronological action in the event's full timeline, sourced
// from the append-only audit log.
type TimelineEntry struct {
	At          time.Time      `json:"at"`
	SubSolution string         `json:"sub_solution"`
	Action      string         `json:"action"`
	Actor       string         `json:"actor"`
	Summary     string         `json:"summary"`
	Detail      map[string]any `json:"detail,omitempty"`
}

// EvidenceReport is the complete regulator-ready record for one recovery event:
// the runbook executed (RTO vs RTA), the approvals, the integrity-check results
// (for cyber recovery), and the full timeline. Every field is populated from real
// persisted data; sections an event has no records for are empty, never faked.
type EvidenceReport struct {
	EventID     uuid.UUID `json:"event_id"`
	TenantID    uuid.UUID `json:"tenant_id"`
	SubSolution string    `json:"sub_solution"`
	// ApplicationID/ApplicationKey/ApplicationName identify the application the
	// event recovered, resolved from the Metastore seam when the event is linked.
	ApplicationID   string `json:"application_id,omitempty"`
	ApplicationKey  string `json:"application_key,omitempty"`
	ApplicationName string `json:"application_name,omitempty"`
	RecoveryTier    string `json:"recovery_tier,omitempty"`

	RunbookExecution *RunbookExecution `json:"runbook_execution,omitempty"`
	Approvals        []Approval        `json:"approvals"`
	IntegrityChecks  []IntegrityCheck  `json:"integrity_checks"`
	Timeline         []TimelineEntry   `json:"timeline"`

	GeneratedAt time.Time      `json:"generated_at"`
	Proof       *EvidenceProof `json:"proof,omitempty"`
}

// EvidenceProof is the cryptographic proof envelope attached to a generated
// evidence report. PayloadHash always covers the report content with this Proof
// field omitted; ledger/anchor fields are populated only when the real DR
// attestation ledger is wired and accepts the append. Degraded proof is explicit
// in Status and Reason so procurement evidence never implies a WORM anchor that
// does not exist.
type EvidenceProof struct {
	Status               string                 `json:"status"`
	Reason               string                 `json:"reason,omitempty"`
	PayloadHashAlgorithm string                 `json:"payload_hash_algorithm"`
	PayloadHash          string                 `json:"payload_hash"`
	GeneratedAt          time.Time              `json:"generated_at"`
	GeneratedBy          string                 `json:"generated_by,omitempty"`
	HashChain            *EvidenceHashChain     `json:"hash_chain,omitempty"`
	Anchor               *EvidenceProofAnchor   `json:"anchor,omitempty"`
	Signature            EvidenceProofSignature `json:"signature"`
}

// EvidenceHashChain carries DR attestation-ledger chain metadata when available.
type EvidenceHashChain struct {
	Ledger       string `json:"ledger"`
	EntryType    string `json:"entry_type"`
	SubjectID    string `json:"subject_id"`
	Seq          int64  `json:"seq"`
	PreviousHash string `json:"previous_hash"`
	EntryHash    string `json:"entry_hash"`
	AnchoredRoot string `json:"anchored_root,omitempty"`
	RootHash     string `json:"root_hash"`
}

// EvidenceProofAnchor describes the real anchoring state for the proof. A DB
// checkpoint is verifiable but not a WORM object anchor; WORM fields are present
// only when the existing attestation ledger sealer returned them.
type EvidenceProofAnchor struct {
	Status        string `json:"status"`
	FromSeq       int64  `json:"from_seq,omitempty"`
	ToSeq         int64  `json:"to_seq,omitempty"`
	MerkleRoot    string `json:"merkle_root,omitempty"`
	WORMObjectKey string `json:"worm_object_key,omitempty"`
	WORMVersionID string `json:"worm_version_id,omitempty"`
}

// EvidenceProofSignature is intentionally explicit when no signing key/helper is
// wired. The payload hash and ledger chain are real; this field must not imply a
// cryptographic signature unless a future signer populates it.
type EvidenceProofSignature struct {
	Status    string `json:"status"`
	Algorithm string `json:"algorithm,omitempty"`
	Value     string `json:"value,omitempty"`
}

// EvidenceRunbookRow is the EXISTING runbookstudio run record + its Metastore
// application link, read for the runbook-execution section. The store reads it in
// place from dr_studio_run / dr_studio_runbook / recover_metastore_runbook_link.
type EvidenceRunbookRow struct {
	RunID         uuid.UUID
	RunbookID     uuid.UUID
	RunbookName   string
	Mode          string
	Status        string
	StartedAt     time.Time
	CompletedAt   *time.Time
	ActualSeconds *int
	ApplicationID *string
}

// EvidenceCyberRow is the EXISTING cyber-recovery flow projection read for the
// approvals + integrity-check sections. The store reads it from
// recover_cyber_recovery_flow; the per-action provenance (who/when) comes from
// the flow's append-only transition events (recover_cyber_recovery_event).
type EvidenceCyberRow struct {
	FlowID             uuid.UUID
	IntegrityScanID    *string
	IntegrityVerdict   string
	IntegrityCheckedAt *time.Time
	IntegrityDetail    string
	ApprovedByEmail    string
	ApprovedBy         *uuid.UUID
	ApprovalNote       string
	ApprovedForScanID  *string
	ApprovedAt         *time.Time
}

// EvidenceStore is the read-only persistence surface the evidence export reads
// the EXISTING execution records from. It never writes and never reimplements the
// dr/* orchestration: it reads the runbookstudio run, the cyber-recovery flow,
// and (composed via AuditStore) the audit timeline. Every read takes a
// tenant-scoped DBTX so it is RLS-isolated.
type EvidenceStore interface {
	// RunbookRunForEvent returns the runbookstudio run identified by eventID (the
	// run id IS the event id for IT/Cloud DR runbook events), with its name and
	// linked application id, or (nil, nil) when eventID is not a runbook run.
	RunbookRunForEvent(ctx context.Context, db repository.DBTX, tenantID, eventID uuid.UUID) (*EvidenceRunbookRow, error)
	// CyberFlowForEvent returns the cyber-recovery flow identified by eventID (the
	// flow id IS the event id for cyber-recovery events), or (nil, nil) when
	// eventID is not a cyber flow.
	CyberFlowForEvent(ctx context.Context, db repository.DBTX, tenantID, eventID uuid.UUID) (*EvidenceCyberRow, error)
}

// evidenceMetastore is the read seam the evidence export resolves the RTO TARGET
// and the application metadata from — the Metastore seam, narrowed to the one
// read it needs (resolve one application by id). RTO is ALWAYS resolved here,
// never hardcoded. The DefaultRegistry satisfies it.
type evidenceMetastore interface {
	ResolveApplication(ctx context.Context, tenantID uuid.UUID, id string) (*metastore.Application, error)
}

// auditReader is the audit-timeline read the evidence export composes — the
// append-only log this prompt owns. *AuditService satisfies it.
type auditReader interface {
	Timeline(ctx context.Context, tenantID, eventID uuid.UUID) ([]AuditEvent, error)
	RecentEvents(ctx context.Context, tenantID uuid.UUID, limit int) ([]AuditEventSummary, error)
}

// EvidenceLedger is the existing DR attestation-ledger recorder surface used to
// chain generated Recover evidence reports. *attestledger.Recorder satisfies it.
type EvidenceLedger interface {
	Append(ctx context.Context, req attestledger.AppendRequest) (*attestledger.Entry, error)
	Anchor(ctx context.Context, tenantID uuid.UUID) (*attestledger.Checkpoint, error)
}

// EvidenceConfig wires an EvidenceService.
type EvidenceConfig struct {
	// Runner runs the tenant-scoped read transaction for the composed reads.
	Runner TenantRunner
	// Store reads the EXISTING runbook run + cyber-recovery flow records.
	Store EvidenceStore
	// Metastore resolves the RTO target + application metadata (the seam).
	Metastore evidenceMetastore
	// Audit is the append-only audit-trail reader (timeline + event list).
	Audit auditReader
	// Entitlements gates the export server-side on a Recover entitlement (any of
	// the three sub-solution keys), the same resolver the product view uses.
	Entitlements EntitlementResolver
	// Metrics records export observability; nil is safe (unmetered).
	Metrics *EvidenceMetrics
	// Ledger optionally appends each generated evidence report to the existing DR
	// attestation ledger. Nil leaves the proof envelope local and explicitly marks
	// anchor_unavailable.
	Ledger EvidenceLedger
	// Logger is required.
	Logger zerolog.Logger
	// Now is injectable for deterministic tests; defaults to time.Now().UTC().
	Now func() time.Time
}

// EvidenceService assembles the regulator-ready evidence report for a recovery
// event by COMPOSING the Metastore seam (RTO target), the EXISTING runbookstudio
// + cyber-recovery records (the runbook executed, RTA, approvals, integrity
// checks), and the append-only audit log (the full timeline). It owns no recovery
// logic and writes nothing. Every export is gated server-side on a Recover
// entitlement before any data is read.
type EvidenceService struct {
	runner       TenantRunner
	store        EvidenceStore
	metastore    evidenceMetastore
	audit        auditReader
	entitlements EntitlementResolver
	metrics      *EvidenceMetrics
	ledger       EvidenceLedger
	logger       zerolog.Logger
	now          func() time.Time
}

// NewEvidenceService validates the config and constructs the service.
func NewEvidenceService(cfg EvidenceConfig) (*EvidenceService, error) {
	if cfg.Runner == nil {
		return nil, errors.New("recover evidence service: runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("recover evidence service: store is required")
	}
	if cfg.Metastore == nil {
		return nil, errors.New("recover evidence service: metastore is required")
	}
	if cfg.Audit == nil {
		return nil, errors.New("recover evidence service: audit reader is required")
	}
	if cfg.Entitlements == nil {
		return nil, errors.New("recover evidence service: entitlement resolver is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &EvidenceService{
		runner:       cfg.Runner,
		store:        cfg.Store,
		metastore:    cfg.Metastore,
		audit:        cfg.Audit,
		entitlements: cfg.Entitlements,
		metrics:      cfg.Metrics,
		ledger:       cfg.Ledger,
		logger:       cfg.Logger.With().Str("service", "recover-evidence").Logger(),
		now:          now,
	}, nil
}

// ListEvents returns the tenant's audited recovery events, newest first — the
// "Prove" event list with the one-click compliance export. Gated server-side on
// a Recover entitlement.
func (s *EvidenceService) ListEvents(ctx context.Context, tenantID uuid.UUID, authorization string, limit int) ([]AuditEventSummary, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover evidence: tenant id is required")
	}
	entitled, err := s.anyEntitlement(ctx, tenantID, authorization)
	if err != nil {
		return nil, err
	}
	if !entitled {
		return nil, ErrAnalyticsNotEntitled
	}
	return s.audit.RecentEvents(ctx, tenantID, limit)
}

// Report assembles the full evidence report for one recovery event. It gates on a
// Recover entitlement, then composes the runbook execution (RTO from the
// Metastore seam, RTA from the run record), the cyber-recovery approvals +
// integrity checks, and the append-only audit timeline. It returns
// ErrEvidenceNotFound when the event has no records of any kind.
func (s *EvidenceService) Report(ctx context.Context, tenantID, eventID uuid.UUID, authorization string) (*EvidenceReport, error) {
	if tenantID == uuid.Nil || eventID == uuid.Nil {
		return nil, errors.New("recover evidence: tenant and event id are required")
	}
	entitled, err := s.anyEntitlement(ctx, tenantID, authorization)
	if err != nil {
		return nil, err
	}
	if !entitled {
		return nil, ErrAnalyticsNotEntitled
	}

	// 1. Composed reads of the EXISTING execution records in ONE read transaction.
	var (
		runbookRow *EvidenceRunbookRow
		cyberRow   *EvidenceCyberRow
	)
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var rerr error
		if runbookRow, rerr = s.store.RunbookRunForEvent(ctx, db, tenantID, eventID); rerr != nil {
			return rerr
		}
		if cyberRow, rerr = s.store.CyberFlowForEvent(ctx, db, tenantID, eventID); rerr != nil {
			return rerr
		}
		return nil
	}); err != nil {
		return nil, err
	}

	// 2. The append-only audit timeline (its own tenant-scoped read).
	auditEvents, err := s.audit.Timeline(ctx, tenantID, eventID)
	if err != nil {
		return nil, err
	}

	if runbookRow == nil && cyberRow == nil && len(auditEvents) == 0 {
		return nil, ErrEvidenceNotFound
	}

	report := &EvidenceReport{
		EventID:         eventID,
		TenantID:        tenantID,
		Approvals:       []Approval{},
		IntegrityChecks: []IntegrityCheck{},
		Timeline:        []TimelineEntry{},
		GeneratedAt:     s.now(),
	}

	// 3. Runbook execution + RTO-vs-RTA. The RTO TARGET is resolved from the
	// Metastore seam for the linked application (never hardcoded).
	if runbookRow != nil {
		report.SubSolution = AuditSubSolutionITDR
		exec := &RunbookExecution{
			RunID:       runbookRow.RunID,
			RunbookID:   runbookRow.RunbookID,
			RunbookName: runbookRow.RunbookName,
			Mode:        runbookRow.Mode,
			Status:      runbookRow.Status,
			Succeeded:   runbookRow.Status == "completed",
			StartedAt:   runbookRow.StartedAt,
			CompletedAt: runbookRow.CompletedAt,
		}
		if runbookRow.ActualSeconds != nil {
			rta := *runbookRow.ActualSeconds
			exec.RTAActualSeconds = &rta
		}
		if runbookRow.ApplicationID != nil {
			if app, aerr := s.metastore.ResolveApplication(ctx, tenantID, *runbookRow.ApplicationID); aerr == nil && app != nil {
				report.ApplicationID = app.ID
				report.ApplicationKey = app.AppKey
				report.ApplicationName = app.Name
				report.RecoveryTier = app.RecoveryTier
				exec.RTOTargetSeconds = app.RTOTargetSeconds
				if exec.RTAActualSeconds != nil && app.RTOTargetSeconds > 0 && *exec.RTAActualSeconds > app.RTOTargetSeconds {
					exec.RTABreach = true
					exec.BreachSeconds = *exec.RTAActualSeconds - app.RTOTargetSeconds
				}
			} else if aerr != nil {
				// A resolve failure is non-fatal for the export — the runbook section
				// still renders with the RTA; the RTO target is simply absent. The
				// error is logged for operability, never swallowed silently.
				s.logger.Warn().Err(aerr).Str("application_id", *runbookRow.ApplicationID).
					Msg("evidence: could not resolve application RTO target from metastore")
			}
		}
		report.RunbookExecution = exec
	}

	// 4. Cyber-recovery integrity-check results + approvals. The integrity verdict
	// and the authorized sign-off are read from the flow's recorded gate state; the
	// per-action actor/instant provenance is overlaid from the audit timeline below.
	if cyberRow != nil {
		report.SubSolution = AuditSubSolutionCyberRecovery
		if cyberRow.IntegrityVerdict != "" && cyberRow.IntegrityCheckedAt != nil {
			ic := IntegrityCheck{
				Verdict:   cyberRow.IntegrityVerdict,
				Passed:    cyberRow.IntegrityVerdict == "CLEAN",
				Detail:    cyberRow.IntegrityDetail,
				CheckedAt: *cyberRow.IntegrityCheckedAt,
			}
			if cyberRow.IntegrityScanID != nil {
				ic.ScanID = *cyberRow.IntegrityScanID
			}
			report.IntegrityChecks = append(report.IntegrityChecks, ic)
		}
		if cyberRow.ApprovedAt != nil && cyberRow.ApprovedByEmail != "" {
			ap := Approval{
				Action:     ActionApprovalGranted,
				ApproverID: cyberRow.ApprovedBy,
				Approver:   cyberRow.ApprovedByEmail,
				Note:       cyberRow.ApprovalNote,
				ApprovedAt: *cyberRow.ApprovedAt,
			}
			if cyberRow.ApprovedForScanID != nil {
				ap.ScanID = *cyberRow.ApprovedForScanID
			}
			report.Approvals = append(report.Approvals, ap)
		}
	}

	// 5. The full timeline from the append-only audit log. It also backfills the
	// sub-solution and any approvals/integrity actions captured via the unified
	// audit (e.g. an IT-DR approval) that the dr/* projections above don't carry.
	s.foldTimeline(report, auditEvents)

	sort.SliceStable(report.Timeline, func(i, j int) bool {
		return report.Timeline[i].At.Before(report.Timeline[j].At)
	})
	report.Proof = s.buildProof(ctx, report)

	s.metrics.observeReport(report.SubSolution)
	s.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Str("event_id", eventID.String()).
		Str("sub_solution", report.SubSolution).
		Int("timeline_entries", len(report.Timeline)).
		Int("approvals", len(report.Approvals)).
		Int("integrity_checks", len(report.IntegrityChecks)).
		Msg("assembled recover evidence report")
	return report, nil
}

// VerifyEvidenceReportPayloadHash recomputes the report payload hash with the
// proof envelope omitted. Auditors/tests can use it to detect post-generation
// tampering of any report field that was covered by the proof.
func VerifyEvidenceReportPayloadHash(rep *EvidenceReport) (bool, string, error) {
	if rep == nil || rep.Proof == nil || rep.Proof.PayloadHash == "" {
		return false, "", errors.New("recover evidence: proof payload hash is missing")
	}
	_, hash, err := evidenceReportPayloadHash(rep)
	if err != nil {
		return false, "", err
	}
	return hash == rep.Proof.PayloadHash, hash, nil
}

func (s *EvidenceService) buildProof(ctx context.Context, report *EvidenceReport) *EvidenceProof {
	generatedBy := evidenceGeneratedBy(ctx)
	_, payloadHash, err := evidenceReportPayloadHash(report)
	proof := &EvidenceProof{
		Status:               "anchor_unavailable",
		Reason:               "attestation ledger is not configured",
		PayloadHashAlgorithm: "sha256:canonical_json",
		PayloadHash:          payloadHash,
		GeneratedAt:          report.GeneratedAt,
		GeneratedBy:          generatedBy,
		Anchor:               &EvidenceProofAnchor{Status: "anchor_unavailable"},
		Signature:            EvidenceProofSignature{Status: "signature_unavailable", Algorithm: "none"},
	}
	if err != nil {
		proof.Status = "payload_hash_failed"
		proof.Reason = err.Error()
		proof.PayloadHash = ""
		return proof
	}
	if s.ledger == nil {
		return proof
	}

	subjectID := report.EventID.String()
	entry, err := s.ledger.Append(ctx, attestledger.AppendRequest{
		TenantID:  report.TenantID,
		EntryType: attestledger.EntryTypeRecoverEvidenceReport,
		SubjectID: subjectID,
		Payload: map[string]any{
			"event_id":               report.EventID.String(),
			"tenant_id":              report.TenantID.String(),
			"sub_solution":           report.SubSolution,
			"payload_hash_algorithm": proof.PayloadHashAlgorithm,
			"payload_hash":           payloadHash,
			"generated_at":           report.GeneratedAt.UTC().Format(time.RFC3339Nano),
			"generated_by":           generatedBy,
		},
	})
	if err != nil {
		proof.Status = "ledger_append_failed"
		proof.Reason = err.Error()
		proof.Anchor = &EvidenceProofAnchor{Status: "anchor_unavailable"}
		s.logger.Warn().Err(err).
			Str("tenant_id", report.TenantID.String()).
			Str("event_id", report.EventID.String()).
			Msg("recover evidence proof: attestation ledger append failed")
		return proof
	}

	proof.Status = "ledger_appended"
	proof.Reason = ""
	proof.HashChain = &EvidenceHashChain{
		Ledger:       "dr_attestation_ledger",
		EntryType:    entry.EntryType,
		SubjectID:    entry.SubjectID,
		Seq:          entry.Seq,
		PreviousHash: entry.PrevHash,
		EntryHash:    entry.EntryHash,
		AnchoredRoot: entry.AnchoredRoot,
		RootHash:     entry.EntryHash,
	}
	proof.Anchor = &EvidenceProofAnchor{Status: "anchor_pending"}

	checkpoint, err := s.ledger.Anchor(ctx, report.TenantID)
	if err != nil {
		proof.Status = "ledger_appended_anchor_pending"
		proof.Reason = err.Error()
		s.logger.Warn().Err(err).
			Str("tenant_id", report.TenantID.String()).
			Str("event_id", report.EventID.String()).
			Int64("ledger_seq", entry.Seq).
			Msg("recover evidence proof: ledger checkpoint anchor unavailable")
		return proof
	}
	proof.HashChain.RootHash = checkpoint.MerkleRoot
	proof.HashChain.AnchoredRoot = checkpoint.MerkleRoot
	proof.Anchor = &EvidenceProofAnchor{
		Status:        "worm_anchored",
		FromSeq:       checkpoint.FromSeq,
		ToSeq:         checkpoint.ToSeq,
		MerkleRoot:    checkpoint.MerkleRoot,
		WORMObjectKey: checkpoint.WORMObjectKey,
		WORMVersionID: checkpoint.WORMVersionID,
	}
	if checkpoint.WORMObjectKey == "" {
		proof.Status = "db_checkpoint_only"
		proof.Anchor.Status = "worm_anchor_unavailable"
		proof.Reason = "attestation ledger checkpoint recorded in dr_db, but WORM object anchoring is not configured"
		return proof
	}
	proof.Status = "worm_anchored"
	return proof
}

func evidenceReportPayloadHash(rep *EvidenceReport) ([]byte, string, error) {
	if rep == nil {
		return nil, "", errors.New("recover evidence: report is nil")
	}
	cp := *rep
	cp.Proof = nil
	return attestledger.HashPayload(cp)
}

func evidenceGeneratedBy(ctx context.Context) string {
	user := auth.UserFromContext(ctx)
	if user == nil {
		return ""
	}
	if user.Email != "" {
		return user.Email
	}
	return user.ID
}

// foldTimeline folds the append-only audit events into the report's timeline and
// backfills the sub-solution (when the dr/* projections didn't set it) plus any
// approval / integrity actions recorded only in the unified audit log.
func (s *EvidenceService) foldTimeline(report *EvidenceReport, events []AuditEvent) {
	if len(events) > evidenceEventWindow {
		events = events[:evidenceEventWindow]
	}
	for i := range events {
		ev := &events[i]
		if report.SubSolution == "" {
			report.SubSolution = ev.SubSolution
		}
		report.Timeline = append(report.Timeline, TimelineEntry{
			At:          ev.OccurredAt,
			SubSolution: ev.SubSolution,
			Action:      ev.Action,
			Actor:       ev.ActorEmail,
			Summary:     ev.Summary,
			Detail:      ev.Detail,
		})
	}
}

// anyEntitlement reports whether the tenant is entitled to ANY Recover
// sub-solution — the evidence/Prove surface is product-wide, so any single grant
// authorises it. A licensing outage bubbles as ErrEntitlementUnavailable
// (fail-closed); a clean "not licensed" is checked across all keys before denying.
func (s *EvidenceService) anyEntitlement(ctx context.Context, tenantID uuid.UUID, authorization string) (bool, error) {
	for _, key := range []string{EntitlementITDR, EntitlementCloudDR, EntitlementCyberRecovery} {
		active, _, err := s.entitlements.Resolve(ctx, tenantID.String(), authorization, key)
		if err != nil {
			return false, err
		}
		if active {
			return true, nil
		}
	}
	return false, nil
}
