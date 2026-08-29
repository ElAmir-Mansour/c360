package recover

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/attestledger"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/recover/metastore"
)

// --- fakes -------------------------------------------------------------------

// fakeEvidenceStore returns canned EXISTING-record projections; mocks live only
// in test files.
type fakeEvidenceStore struct {
	runbook *EvidenceRunbookRow
	cyber   *EvidenceCyberRow
	err     error
}

func (f *fakeEvidenceStore) RunbookRunForEvent(_ context.Context, _ repository.DBTX, _, _ uuid.UUID) (*EvidenceRunbookRow, error) {
	return f.runbook, f.err
}

func (f *fakeEvidenceStore) CyberFlowForEvent(_ context.Context, _ repository.DBTX, _, _ uuid.UUID) (*EvidenceCyberRow, error) {
	return f.cyber, f.err
}

// fakeEvidenceMetastore resolves one application (the RTO seam).
type fakeEvidenceMetastore struct {
	app *metastore.Application
	err error
}

func (f *fakeEvidenceMetastore) ResolveApplication(_ context.Context, _ uuid.UUID, _ string) (*metastore.Application, error) {
	return f.app, f.err
}

// fakeAuditReader supplies the timeline + event list.
type fakeAuditReader struct {
	timeline []AuditEvent
	events   []AuditEventSummary
	err      error
}

func (f *fakeAuditReader) Timeline(_ context.Context, _, _ uuid.UUID) ([]AuditEvent, error) {
	return f.timeline, f.err
}
func (f *fakeAuditReader) RecentEvents(_ context.Context, _ uuid.UUID, _ int) ([]AuditEventSummary, error) {
	return f.events, f.err
}

type fakeEvidenceLedger struct {
	mu          sync.Mutex
	entries     []*attestledger.Entry
	appendErr   error
	anchorErr   error
	wormObject  string
	wormVersion string
}

func (f *fakeEvidenceLedger) Append(_ context.Context, req attestledger.AppendRequest) (*attestledger.Entry, error) {
	if f.appendErr != nil {
		return nil, f.appendErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	entry := &attestledger.Entry{
		TenantID:  req.TenantID,
		EntryType: req.EntryType,
		SubjectID: req.SubjectID,
	}
	var prev *attestledger.Entry
	if len(f.entries) > 0 {
		prev = f.entries[len(f.entries)-1]
	}
	if err := attestledger.LinkEntry(entry, req.Payload, prev); err != nil {
		return nil, err
	}
	entry.ID = uuid.New()
	cp := *entry
	f.entries = append(f.entries, &cp)
	return entry, nil
}

func (f *fakeEvidenceLedger) Anchor(_ context.Context, tenantID uuid.UUID) (*attestledger.Checkpoint, error) {
	if f.anchorErr != nil {
		return nil, f.anchorErr
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.entries) == 0 {
		return nil, errors.New("nothing to anchor")
	}
	leaves := make([]string, 0, len(f.entries))
	var from, to int64
	for _, e := range f.entries {
		if e.TenantID != tenantID {
			continue
		}
		if from == 0 {
			from = e.Seq
		}
		to = e.Seq
		leaves = append(leaves, e.EntryHash)
	}
	if len(leaves) == 0 {
		return nil, errors.New("nothing to anchor")
	}
	root := attestledger.MerkleRoot(leaves)
	for _, e := range f.entries {
		if e.TenantID == tenantID {
			e.AnchoredRoot = root
		}
	}
	return &attestledger.Checkpoint{
		ID:            uuid.New(),
		TenantID:      tenantID,
		FromSeq:       from,
		ToSeq:         to,
		MerkleRoot:    root,
		EntryCount:    len(leaves),
		WORMObjectKey: f.wormObject,
		WORMVersionID: f.wormVersion,
		CreatedAt:     time.Unix(1700000300, 0).UTC(),
	}, nil
}

func newEvidenceService(t *testing.T, store EvidenceStore, ms evidenceMetastore, audit auditReader, resolver EntitlementResolver, now time.Time) *EvidenceService {
	t.Helper()
	svc, err := NewEvidenceService(EvidenceConfig{
		Runner:       &fakeRunner{},
		Store:        store,
		Metastore:    ms,
		Audit:        audit,
		Entitlements: resolver,
		Logger:       zerolog.Nop(),
		Now:          func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewEvidenceService: %v", err)
	}
	return svc
}

func newEvidenceServiceWithLedger(t *testing.T, store EvidenceStore, ms evidenceMetastore, audit auditReader, resolver EntitlementResolver, ledger EvidenceLedger, now time.Time) *EvidenceService {
	t.Helper()
	svc, err := NewEvidenceService(EvidenceConfig{
		Runner:       &fakeRunner{},
		Store:        store,
		Metastore:    ms,
		Audit:        audit,
		Entitlements: resolver,
		Ledger:       ledger,
		Logger:       zerolog.Nop(),
		Now:          func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewEvidenceService: %v", err)
	}
	return svc
}

func entitledResolver() *stubResolver {
	return &stubResolver{active: map[string]bool{EntitlementCyberRecovery: true}}
}

// --- happy path: full cyber-recovery report ----------------------------------

func TestEvidence_Report_CyberRecovery_AllSectionsPopulated(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	tenant := uuid.New()
	event := uuid.New()
	approver := uuid.New()
	scanID := uuid.NewString()
	checkedAt := now.Add(-30 * time.Minute)
	approvedAt := now.Add(-20 * time.Minute)

	store := &fakeEvidenceStore{
		cyber: &EvidenceCyberRow{
			FlowID:             event,
			IntegrityScanID:    &scanID,
			IntegrityVerdict:   "CLEAN",
			IntegrityCheckedAt: &checkedAt,
			IntegrityDetail:    "no malware; checksums match",
			ApprovedBy:         &approver,
			ApprovedByEmail:    "ciso@bank.test",
			ApprovalNote:       "blast radius cleared",
			ApprovedForScanID:  &scanID,
			ApprovedAt:         &approvedAt,
		},
	}
	audit := &fakeAuditReader{timeline: []AuditEvent{
		{EventID: event, SubSolution: AuditSubSolutionCyberRecovery, Action: ActionCleanPointSelected, ActorEmail: "op@bank.test", Summary: "clean point selected", OccurredAt: now.Add(-time.Hour)},
		{EventID: event, SubSolution: AuditSubSolutionCyberRecovery, Action: ActionIntegrityEvaluated, ActorEmail: "scanner@recover", Summary: "gate CLEAN", OccurredAt: checkedAt},
		{EventID: event, SubSolution: AuditSubSolutionCyberRecovery, Action: ActionReturnToProduction, ActorEmail: "ciso@bank.test", Summary: "returned to prod", OccurredAt: now.Add(-10 * time.Minute)},
	}}
	svc := newEvidenceService(t, store, &fakeEvidenceMetastore{}, audit, entitledResolver(), now)

	rep, err := svc.Report(context.Background(), tenant, event, "Bearer t")
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	if rep.SubSolution != AuditSubSolutionCyberRecovery {
		t.Errorf("sub_solution = %q", rep.SubSolution)
	}
	if len(rep.IntegrityChecks) != 1 || !rep.IntegrityChecks[0].Passed || rep.IntegrityChecks[0].Verdict != "CLEAN" {
		t.Errorf("integrity checks = %+v", rep.IntegrityChecks)
	}
	if len(rep.Approvals) != 1 || rep.Approvals[0].Approver != "ciso@bank.test" || rep.Approvals[0].ScanID != scanID {
		t.Errorf("approvals = %+v", rep.Approvals)
	}
	if len(rep.Timeline) != 3 {
		t.Fatalf("timeline = %d entries, want 3", len(rep.Timeline))
	}
	if rep.Proof == nil || rep.Proof.PayloadHash == "" {
		t.Fatalf("proof missing payload hash: %+v", rep.Proof)
	}
	if rep.Proof.Status != "anchor_unavailable" || rep.Proof.Anchor == nil || rep.Proof.Anchor.Status != "anchor_unavailable" {
		t.Fatalf("proof must explicitly mark missing ledger anchor, got %+v", rep.Proof)
	}
	if rep.Proof.Signature.Status != "signature_unavailable" {
		t.Fatalf("signature status = %+v, want explicit unavailable", rep.Proof.Signature)
	}
	// Timeline must be chronological.
	for i := 1; i < len(rep.Timeline); i++ {
		if rep.Timeline[i].At.Before(rep.Timeline[i-1].At) {
			t.Errorf("timeline out of order at %d", i)
		}
	}
}

func TestEvidence_Report_ProofHashStableAndTamperDetected(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	tenant := uuid.New()
	event := uuid.New()
	store := &fakeEvidenceStore{runbook: &EvidenceRunbookRow{
		RunID:       event,
		RunbookID:   uuid.New(),
		RunbookName: "Core Banking Failover",
		Status:      "completed",
		StartedAt:   now.Add(-time.Minute),
	}}
	audit := &fakeAuditReader{timeline: []AuditEvent{
		{EventID: event, SubSolution: AuditSubSolutionITDR, Action: ActionRunbookRunCompleted, ActorEmail: "op@bank.test", Summary: "done", OccurredAt: now},
	}}
	svc := newEvidenceService(t, store, &fakeEvidenceMetastore{}, audit, entitledResolver(), now)

	rep1, err := svc.Report(context.Background(), tenant, event, "Bearer t")
	if err != nil {
		t.Fatalf("Report #1: %v", err)
	}
	rep2, err := svc.Report(context.Background(), tenant, event, "Bearer t")
	if err != nil {
		t.Fatalf("Report #2: %v", err)
	}
	if rep1.Proof.PayloadHash == "" || rep1.Proof.PayloadHash != rep2.Proof.PayloadHash {
		t.Fatalf("payload hash not stable: %q vs %q", rep1.Proof.PayloadHash, rep2.Proof.PayloadHash)
	}
	ok, recomputed, err := VerifyEvidenceReportPayloadHash(rep1)
	if err != nil {
		t.Fatalf("VerifyEvidenceReportPayloadHash: %v", err)
	}
	if !ok || recomputed != rep1.Proof.PayloadHash {
		t.Fatalf("proof hash did not verify: ok=%v recomputed=%s proof=%s", ok, recomputed, rep1.Proof.PayloadHash)
	}
	rep1.Timeline[0].Summary = "tampered after export"
	ok, _, err = VerifyEvidenceReportPayloadHash(rep1)
	if err != nil {
		t.Fatalf("Verify tampered report: %v", err)
	}
	if ok {
		t.Fatal("tampered report still verified")
	}
}

func TestEvidence_Report_ProofAnchorsToLedgerWhenConfigured(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	tenant := uuid.New()
	event := uuid.New()
	store := &fakeEvidenceStore{cyber: &EvidenceCyberRow{FlowID: event}}
	audit := &fakeAuditReader{timeline: []AuditEvent{
		{EventID: event, SubSolution: AuditSubSolutionCyberRecovery, Action: ActionCleanPointSelected, ActorEmail: "op@bank.test", Summary: "selected", OccurredAt: now},
	}}
	ledger := &fakeEvidenceLedger{wormObject: tenant.String() + "/attestation-checkpoints/000000000001-000000000001.json", wormVersion: "v1"}
	ctx := auth.WithUser(context.Background(), &auth.ContextUser{ID: uuid.NewString(), Email: "auditor@bank.test"})
	svc := newEvidenceServiceWithLedger(t, store, &fakeEvidenceMetastore{}, audit, entitledResolver(), ledger, now)

	rep, err := svc.Report(ctx, tenant, event, "Bearer t")
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	if rep.Proof == nil {
		t.Fatal("proof missing")
	}
	if rep.Proof.Status != "worm_anchored" {
		t.Fatalf("proof status = %q, want worm_anchored (%+v)", rep.Proof.Status, rep.Proof)
	}
	if rep.Proof.GeneratedBy != "auditor@bank.test" {
		t.Fatalf("generated_by = %q", rep.Proof.GeneratedBy)
	}
	if rep.Proof.HashChain == nil || rep.Proof.HashChain.EntryType != attestledger.EntryTypeRecoverEvidenceReport || rep.Proof.HashChain.PreviousHash != attestledger.GenesisPrevHash {
		t.Fatalf("hash chain metadata = %+v", rep.Proof.HashChain)
	}
	if rep.Proof.Anchor == nil || rep.Proof.Anchor.WORMObjectKey == "" || rep.Proof.Anchor.MerkleRoot == "" {
		t.Fatalf("anchor metadata = %+v", rep.Proof.Anchor)
	}
	ok, _, err := VerifyEvidenceReportPayloadHash(rep)
	if err != nil || !ok {
		t.Fatalf("anchored report hash verification ok=%v err=%v", ok, err)
	}
}

func TestEvidence_Report_LedgerWithoutWORMIsExplicitlyDegraded(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	tenant := uuid.New()
	event := uuid.New()
	store := &fakeEvidenceStore{cyber: &EvidenceCyberRow{FlowID: event}}
	audit := &fakeAuditReader{timeline: []AuditEvent{
		{EventID: event, SubSolution: AuditSubSolutionCyberRecovery, Action: ActionCleanPointSelected, ActorEmail: "op@bank.test", Summary: "selected", OccurredAt: now},
	}}
	svc := newEvidenceServiceWithLedger(t, store, &fakeEvidenceMetastore{}, audit, entitledResolver(), &fakeEvidenceLedger{}, now)

	rep, err := svc.Report(context.Background(), tenant, event, "Bearer t")
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	if rep.Proof.Status != "db_checkpoint_only" {
		t.Fatalf("proof status = %q, want db_checkpoint_only", rep.Proof.Status)
	}
	if rep.Proof.Anchor == nil || rep.Proof.Anchor.Status != "worm_anchor_unavailable" {
		t.Fatalf("anchor = %+v, want explicit worm_anchor_unavailable", rep.Proof.Anchor)
	}
	if rep.Proof.Reason == "" {
		t.Fatal("degraded proof must include a reason")
	}
}

// --- happy path: runbook RTO-vs-RTA from the Metastore seam -------------------

func TestEvidence_Report_RunbookRTOvsRTA_FromMetastoreSeam(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	tenant := uuid.New()
	event := uuid.New()
	rb := uuid.New()
	appID := uuid.NewString()
	completed := now.Add(-5 * time.Minute)
	rta := 900
	store := &fakeEvidenceStore{runbook: &EvidenceRunbookRow{
		RunID:         event,
		RunbookID:     rb,
		RunbookName:   "Core Banking Failover",
		Mode:          "rehearsal",
		Status:        "completed",
		StartedAt:     now.Add(-20 * time.Minute),
		CompletedAt:   &completed,
		ActualSeconds: &rta,
		ApplicationID: &appID,
	}}
	ms := &fakeEvidenceMetastore{app: &metastore.Application{
		ID: appID, AppKey: "core-banking", Name: "Core Banking",
		RecoveryTier: metastore.TierMissionCritical, RTOTargetSeconds: 600, // RTA 900 > 600 → breach
	}}
	svc := newEvidenceService(t, store, ms, &fakeAuditReader{}, entitledResolver(), now)

	rep, err := svc.Report(context.Background(), tenant, event, "Bearer t")
	if err != nil {
		t.Fatalf("Report: %v", err)
	}
	if rep.RunbookExecution == nil {
		t.Fatal("runbook execution section missing")
	}
	e := rep.RunbookExecution
	if e.RTOTargetSeconds != 600 {
		t.Errorf("RTO target = %d, want 600 (from the Metastore seam)", e.RTOTargetSeconds)
	}
	if e.RTAActualSeconds == nil || *e.RTAActualSeconds != 900 {
		t.Errorf("RTA actual = %v, want 900", e.RTAActualSeconds)
	}
	if !e.RTABreach || e.BreachSeconds != 300 {
		t.Errorf("RTO breach = %v / %d, want true / 300", e.RTABreach, e.BreachSeconds)
	}
	if rep.ApplicationKey != "core-banking" || rep.ApplicationName != "Core Banking" {
		t.Errorf("application identity not resolved from seam: %+v", rep)
	}
}

// --- edge: event with no records → 404 ---------------------------------------

func TestEvidence_Report_NotFound(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	svc := newEvidenceService(t, &fakeEvidenceStore{}, &fakeEvidenceMetastore{}, &fakeAuditReader{}, entitledResolver(), now)
	_, err := svc.Report(context.Background(), uuid.New(), uuid.New(), "Bearer t")
	if !errors.Is(err, ErrEvidenceNotFound) {
		t.Fatalf("err = %v, want ErrEvidenceNotFound", err)
	}
}

// --- authz-denied: no Recover entitlement → not entitled ---------------------

func TestEvidence_Report_NotEntitled(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	store := &fakeEvidenceStore{runbook: &EvidenceRunbookRow{RunID: uuid.New(), Status: "completed"}}
	resolver := &stubResolver{active: map[string]bool{}} // entitled to nothing
	svc := newEvidenceService(t, store, &fakeEvidenceMetastore{}, &fakeAuditReader{}, resolver, now)

	_, err := svc.Report(context.Background(), uuid.New(), uuid.New(), "Bearer t")
	if !errors.Is(err, ErrAnalyticsNotEntitled) {
		t.Fatalf("err = %v, want ErrAnalyticsNotEntitled", err)
	}
	if _, err := svc.ListEvents(context.Background(), uuid.New(), "Bearer t", 50); !errors.Is(err, ErrAnalyticsNotEntitled) {
		t.Fatalf("ListEvents err = %v, want ErrAnalyticsNotEntitled", err)
	}
}

// --- failure: licensing outage → fail-closed 503 -----------------------------

func TestEvidence_Report_EntitlementOutageFailsClosed(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	resolver := &stubResolver{err: ErrEntitlementUnavailable}
	svc := newEvidenceService(t, &fakeEvidenceStore{}, &fakeEvidenceMetastore{}, &fakeAuditReader{}, resolver, now)
	_, err := svc.Report(context.Background(), uuid.New(), uuid.New(), "Bearer t")
	if !errors.Is(err, ErrEntitlementUnavailable) {
		t.Fatalf("err = %v, want ErrEntitlementUnavailable (fail-closed)", err)
	}
}

// --- export rendering: CSV + PDF integrity -----------------------------------

func sampleReport() *EvidenceReport {
	now := time.Unix(1700000000, 0).UTC()
	rta := 900
	completed := now.Add(-5 * time.Minute)
	scan := "scan-1"
	return &EvidenceReport{
		EventID:         uuid.New(),
		TenantID:        uuid.New(),
		SubSolution:     AuditSubSolutionCyberRecovery,
		ApplicationKey:  "core-banking",
		ApplicationName: "Core Banking",
		RecoveryTier:    metastore.TierMissionCritical,
		RunbookExecution: &RunbookExecution{
			RunID: uuid.New(), RunbookID: uuid.New(), RunbookName: "Failover", Mode: "rehearsal",
			Status: "completed", Succeeded: true, StartedAt: now.Add(-20 * time.Minute), CompletedAt: &completed,
			RTOTargetSeconds: 600, RTAActualSeconds: &rta, RTABreach: true, BreachSeconds: 300,
		},
		Approvals:       []Approval{{Action: ActionApprovalGranted, Approver: "ciso@bank.test", Note: "ok", ScanID: scan, ApprovedAt: now}},
		IntegrityChecks: []IntegrityCheck{{ScanID: scan, Verdict: "CLEAN", Passed: true, Detail: "clean", CheckedAt: now}},
		Timeline:        []TimelineEntry{{At: now, SubSolution: AuditSubSolutionCyberRecovery, Action: ActionReturnToProduction, Actor: "ciso@bank.test", Summary: "returned"}},
		GeneratedAt:     now,
	}
}

func TestEvidence_RenderCSV_Complete(t *testing.T) {
	rep := sampleReport()
	rep.Proof = &EvidenceProof{
		Status:               "anchor_unavailable",
		Reason:               "attestation ledger is not configured",
		PayloadHashAlgorithm: "sha256:canonical_json",
		PayloadHash:          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		GeneratedAt:          rep.GeneratedAt,
		Anchor:               &EvidenceProofAnchor{Status: "anchor_unavailable"},
		Signature:            EvidenceProofSignature{Status: "signature_unavailable", Algorithm: "none"},
	}
	out, err := RenderEvidenceCSV(rep)
	if err != nil {
		t.Fatalf("RenderEvidenceCSV: %v", err)
	}
	s := string(out)
	for _, want := range []string{"section,field,value,detail", "runbook_execution", "rto_target_seconds", "rta_actual_seconds", "approval", "integrity_check", "CLEAN", "timeline", "core-banking", "proof", "payload_hash", "anchor_unavailable"} {
		if !bytes.Contains(out, []byte(want)) {
			t.Errorf("CSV missing %q\n%s", want, s)
		}
	}
}

func TestEvidence_RenderPDF_ValidDocument(t *testing.T) {
	rep := sampleReport()
	out, err := RenderEvidencePDF(rep)
	if err != nil {
		t.Fatalf("RenderEvidencePDF: %v", err)
	}
	// A real PDF starts with the %PDF- magic header and ends with the EOF marker.
	if !bytes.HasPrefix(out, []byte("%PDF-")) {
		t.Fatalf("PDF does not start with %%PDF- magic: %q", out[:min(8, len(out))])
	}
	if !bytes.Contains(out, []byte("%%EOF")) {
		t.Error("PDF missing EOF trailer")
	}
	if len(out) < 1000 {
		t.Errorf("PDF suspiciously small (%d bytes)", len(out))
	}
}

// --- handler: HTTP surface (authz-denied, export content types) --------------

func evidenceTestRouter(h *EvidenceHandler) chi.Router {
	r := chi.NewRouter()
	// Inject an authenticated user with dr:read so RequirePermission passes; the
	// service-level entitlement gate is exercised separately above.
	tenant := uuid.NewString()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := auth.WithUser(req.Context(), &auth.ContextUser{ID: uuid.NewString(), TenantID: tenant, Roles: []string{"tenant_admin"}})
			ctx = auth.WithTenantID(ctx, tenant)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/", h.Routes())
	return r
}

type stubEvidenceSvc struct {
	report    *EvidenceReport
	events    []AuditEventSummary
	reportErr error
}

func (s *stubEvidenceSvc) ListEvents(_ context.Context, _ uuid.UUID, _ string, _ int) ([]AuditEventSummary, error) {
	return s.events, nil
}
func (s *stubEvidenceSvc) Report(_ context.Context, _, _ uuid.UUID, _ string) (*EvidenceReport, error) {
	return s.report, s.reportErr
}

func TestEvidenceHandler_Export_ContentTypes(t *testing.T) {
	h := newEvidenceHandler(&stubEvidenceSvc{report: sampleReport()}, zerolog.Nop())
	router := evidenceTestRouter(h)
	event := uuid.New().String()

	cases := []struct {
		format     string
		wantType   string
		wantPrefix []byte
	}{
		{"csv", "text/csv", []byte("section,field")},
		{"pdf", "application/pdf", []byte("%PDF-")},
	}
	for _, tc := range cases {
		t.Run(tc.format, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/evidence/"+event+"/export?format="+tc.format, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if ct := rec.Header().Get("Content-Type"); !bytes.Contains([]byte(ct), []byte(tc.wantType)) {
				t.Errorf("Content-Type = %q, want %q", ct, tc.wantType)
			}
			if cd := rec.Header().Get("Content-Disposition"); !bytes.Contains([]byte(cd), []byte("attachment")) {
				t.Errorf("Content-Disposition = %q, want attachment", cd)
			}
			if !bytes.HasPrefix(rec.Body.Bytes(), tc.wantPrefix) {
				t.Errorf("body prefix = %q, want %q", rec.Body.Bytes()[:min(12, rec.Body.Len())], tc.wantPrefix)
			}
		})
	}
}

func TestEvidenceHandler_Export_BadFormatRejected(t *testing.T) {
	h := newEvidenceHandler(&stubEvidenceSvc{report: sampleReport()}, zerolog.Nop())
	router := evidenceTestRouter(h)
	req := httptest.NewRequest(http.MethodGet, "/evidence/"+uuid.New().String()+"/export?format=xml", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestEvidenceHandler_Report_BadEventIDRejected(t *testing.T) {
	h := newEvidenceHandler(&stubEvidenceSvc{}, zerolog.Nop())
	router := evidenceTestRouter(h)
	req := httptest.NewRequest(http.MethodGet, "/evidence/not-a-uuid", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestEvidenceHandler_RequiresPermission(t *testing.T) {
	// A request with NO dr:read permission must be rejected by RequirePermission
	// before the handler runs — authorization is server-side, never UI-only.
	h := newEvidenceHandler(&stubEvidenceSvc{events: []AuditEventSummary{}}, zerolog.Nop())
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// A user with NO roles carries no permissions → RequirePermission denies.
			ctx := auth.WithUser(req.Context(), &auth.ContextUser{ID: uuid.NewString(), TenantID: uuid.NewString(), Roles: []string{}})
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Mount("/", h.Routes())

	req := httptest.NewRequest(http.MethodGet, "/evidence", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden && rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 403/401 (permission denied)", rec.Code)
	}
}

func TestEvidenceHandler_ListEvents(t *testing.T) {
	events := []AuditEventSummary{{EventID: uuid.New(), SubSolution: AuditSubSolutionITDR, ActionCount: 3, LatestAction: ActionRunbookRunCompleted}}
	h := newEvidenceHandler(&stubEvidenceSvc{events: events}, zerolog.Nop())
	router := evidenceTestRouter(h)
	req := httptest.NewRequest(http.MethodGet, "/evidence", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []AuditEventSummary `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data) != 1 || env.Data[0].ActionCount != 3 {
		t.Fatalf("data = %+v", env.Data)
	}
}

// --- concurrency: many evidence reports assembled at once --------------------

func TestEvidence_Report_Concurrent(t *testing.T) {
	now := time.Unix(1700000000, 0).UTC()
	store := &fakeEvidenceStore{runbook: &EvidenceRunbookRow{RunID: uuid.New(), Status: "completed", RunbookName: "rb"}}
	svc, err := NewEvidenceService(EvidenceConfig{
		Runner:       concurrentRunner{},
		Store:        store,
		Metastore:    &fakeEvidenceMetastore{},
		Audit:        &fakeAuditReader{},
		Entitlements: entitledResolver(),
		Logger:       zerolog.Nop(),
		Now:          func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewEvidenceService: %v", err)
	}

	const n = 32
	var wg sync.WaitGroup
	wg.Add(n)
	errs := make(chan error, n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			_, e := svc.Report(context.Background(), uuid.New(), uuid.New(), "Bearer t")
			errs <- e
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatalf("concurrent Report: %v", e)
		}
	}
}
