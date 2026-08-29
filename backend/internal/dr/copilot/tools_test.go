package copilot

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// ---------------------------------------------------------------------------
// In-memory DR dataset + fake DRReader. The fakes are NOT trivial: they store
// real rows and the tool logic computes over them, so the assertions verify the
// tools' real algorithms (e.g. BlastRadius derives co-members from the seeded
// group/member graph). The fake exercises EXACTLY the repository.DBTX methods
// the production reader exposes, so the tools are tested against the real
// contract — only the storage backend is in-memory.
// ---------------------------------------------------------------------------

type fakeData struct {
	tenantID  string
	sites     map[string]*model.ProtectedSite
	groups    map[string]*model.ConsistencyGroup
	members   map[string][]model.ConsistencyGroupMember // groupID -> members
	streams   map[string]*model.ReplicationStream       // siteID -> stream
	points    map[string][]*model.RecoveryPoint         // groupID -> points
	runs      map[string]*model.FailoverRun             // runID -> run
	steps     map[string][]*model.FailoverStep          // runID -> steps
	attests   map[string]*model.Attestation             // runID -> attestation
	runOrder  []string                                  // deterministic run listing
	siteOrder []string
	grpOrder  []string
}

func newFakeData() *fakeData {
	return &fakeData{
		tenantID: "11111111-0000-0000-0000-000000000001",
		sites:    map[string]*model.ProtectedSite{},
		groups:   map[string]*model.ConsistencyGroup{},
		members:  map[string][]model.ConsistencyGroupMember{},
		streams:  map[string]*model.ReplicationStream{},
		points:   map[string][]*model.RecoveryPoint{},
		runs:     map[string]*model.FailoverRun{},
		steps:    map[string][]*model.FailoverStep{},
		attests:  map[string]*model.Attestation{},
	}
}

func (d *fakeData) addSite(id, name, kind string, rto, rpo int) {
	d.sites[id] = &model.ProtectedSite{ID: id, TenantID: d.tenantID, Name: name, Kind: kind, RTOObjectiveSeconds: rto, RPOObjectiveSeconds: rpo}
	d.siteOrder = append(d.siteOrder, id)
}

func (d *fakeData) addGroup(id, name string, members map[string]int) {
	d.groups[id] = &model.ConsistencyGroup{ID: id, TenantID: d.tenantID, Name: name}
	d.grpOrder = append(d.grpOrder, id)
	for siteID, boot := range members {
		d.members[id] = append(d.members[id], model.ConsistencyGroupMember{GroupID: id, SiteID: siteID, BootOrder: boot})
	}
}

func (d *fakeData) addStream(id, siteID, status string, appliedAt *time.Time) {
	d.streams[siteID] = &model.ReplicationStream{ID: id, TenantID: d.tenantID, SiteID: siteID, Status: status, AppliedAt: appliedAt}
}

func (d *fakeData) addPoint(groupID, id string, ratio *float64, validated bool, sealedAt time.Time, rpoSeconds int) {
	d.points[groupID] = append(d.points[groupID], &model.RecoveryPoint{
		ID: id, TenantID: d.tenantID, GroupID: groupID, MarkerLSN: "0/" + id,
		ValidationRatio: ratio, IsValidated: validated, SealedAt: sealedAt, RPOSeconds: rpoSeconds,
	})
}

func (d *fakeData) addRun(r *model.FailoverRun) {
	r.TenantID = d.tenantID
	d.runs[r.ID] = r
	d.runOrder = append(d.runOrder, r.ID)
}

// fakeReader implements DRReader over fakeData.
type fakeReader struct{ d *fakeData }

func (f fakeReader) ListSites(_ context.Context, _ repository.DBTX, tenantID string) ([]*model.ProtectedSite, error) {
	out := make([]*model.ProtectedSite, 0, len(f.d.siteOrder))
	for _, id := range f.d.siteOrder {
		out = append(out, f.d.sites[id])
	}
	return out, nil
}

func (f fakeReader) GetSite(_ context.Context, _ repository.DBTX, tenantID, id string) (*model.ProtectedSite, error) {
	if s, ok := f.d.sites[id]; ok {
		return s, nil
	}
	return nil, model.ErrNotFound
}

func (f fakeReader) ListGroups(_ context.Context, _ repository.DBTX, tenantID string) ([]*model.ConsistencyGroup, error) {
	out := make([]*model.ConsistencyGroup, 0, len(f.d.grpOrder))
	for _, id := range f.d.grpOrder {
		out = append(out, f.d.groups[id])
	}
	return out, nil
}

func (f fakeReader) GetGroup(_ context.Context, _ repository.DBTX, tenantID, id string) (*model.ConsistencyGroup, error) {
	if g, ok := f.d.groups[id]; ok {
		return g, nil
	}
	return nil, model.ErrNotFound
}

func (f fakeReader) ListGroupMembers(_ context.Context, _ repository.DBTX, groupID string) ([]model.ConsistencyGroupMember, error) {
	return f.d.members[groupID], nil
}

func (f fakeReader) ListStreams(_ context.Context, _ repository.DBTX, tenantID string) ([]*model.ReplicationStream, error) {
	out := make([]*model.ReplicationStream, 0, len(f.d.streams))
	// Deterministic order by site id order.
	for _, sid := range f.d.siteOrder {
		if s, ok := f.d.streams[sid]; ok {
			out = append(out, s)
		}
	}
	return out, nil
}

func (f fakeReader) GetStreamBySite(_ context.Context, _ repository.DBTX, tenantID, siteID string) (*model.ReplicationStream, error) {
	if s, ok := f.d.streams[siteID]; ok {
		return s, nil
	}
	return nil, model.ErrNotFound
}

func (f fakeReader) ListRecoveryPointsByGroup(_ context.Context, _ repository.DBTX, tenantID, groupID string) ([]*model.RecoveryPoint, error) {
	return f.d.points[groupID], nil
}

func (f fakeReader) ListFailoverRuns(_ context.Context, _ repository.DBTX, tenantID string) ([]*model.FailoverRun, error) {
	out := make([]*model.FailoverRun, 0, len(f.d.runOrder))
	for _, id := range f.d.runOrder {
		out = append(out, f.d.runs[id])
	}
	return out, nil
}

func (f fakeReader) GetFailoverRun(_ context.Context, _ repository.DBTX, tenantID, id string) (*model.FailoverRun, error) {
	if r, ok := f.d.runs[id]; ok {
		return r, nil
	}
	return nil, model.ErrNotFound
}

func (f fakeReader) ListFailoverSteps(_ context.Context, _ repository.DBTX, runID string) ([]*model.FailoverStep, error) {
	return f.d.steps[runID], nil
}

func (f fakeReader) GetAttestationByRun(_ context.Context, _ repository.DBTX, tenantID, runID string) (*model.Attestation, error) {
	if a, ok := f.d.attests[runID]; ok {
		return a, nil
	}
	return nil, model.ErrNotFound
}

// fakeReadRunner runs fn directly with a nil DBTX (the fake reader ignores it).
// It also counts reads so a test can assert the tool actually went to the DB.
type fakeReadRunner struct{ reads int }

func (r *fakeReadRunner) RunReadWithTenant(ctx context.Context, tenantID string, fn func(repository.DBTX) error) error {
	r.reads++
	return fn(nil)
}

func newTestTools(d *fakeData, now time.Time) (*Tools, *fakeReadRunner) {
	runner := &fakeReadRunner{}
	return NewTools(fakeReader{d: d}, runner, func() time.Time { return now }), runner
}

func ptrFloat(v float64) *float64 { return &v }

// ---------------------------------------------------------------------------
// DRStateSummary
// ---------------------------------------------------------------------------

func TestDRStateSummary_ReflectsSeededRows(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)
	d.addSite("site-b", "Web VM", model.SiteKindVM, 600, 120)
	d.addSite("site-c", "Files", model.SiteKindFileset, 1800, 600)
	d.addGroup("grp-1", "Core Banking", map[string]int{"site-a": 1, "site-b": 2})
	d.addGroup("grp-2", "Archive", map[string]int{"site-c": 1})

	// site-a applied 60s ago (within SLO); site-b applied 600s ago (breach,
	// SLO 300); site-c is seeding (no applied_at => no data).
	appliedA := now.Add(-60 * time.Second)
	appliedB := now.Add(-600 * time.Second)
	d.addStream("str-a", "site-a", model.StreamStatusStreaming, &appliedA)
	d.addStream("str-b", "site-b", model.StreamStatusDegraded, &appliedB)
	d.addStream("str-c", "site-c", model.StreamStatusSeeding, nil)

	// Two runs; the more recent should sort first.
	older := now.Add(-2 * time.Hour)
	newer := now.Add(-30 * time.Minute)
	completed := now.Add(-29 * time.Minute)
	rtoActual := 60
	d.addRun(&model.FailoverRun{ID: "run-old", GroupID: "grp-1", Mode: model.ModeDrill, Status: model.StatusCompleted, RTOObjectiveSeconds: 900, RTOActualSeconds: &rtoActual, InitiatedAt: older, CompletedAt: &completed})
	d.addRun(&model.FailoverRun{ID: "run-new", GroupID: "grp-2", Mode: model.ModeReal, Status: model.StatusExecuting, RTOObjectiveSeconds: 600, InitiatedAt: newer})

	tools, runner := newTestTools(d, now)
	res, err := tools.DRStateSummary(context.Background(), d.tenantID)
	if err != nil {
		t.Fatalf("DRStateSummary: %v", err)
	}
	if runner.reads == 0 {
		t.Fatal("expected DRStateSummary to read through the tenant runner")
	}
	if res.SiteCount != 3 || res.GroupCount != 2 || res.StreamCount != 3 {
		t.Fatalf("counts: got sites=%d groups=%d streams=%d, want 3/2/3", res.SiteCount, res.GroupCount, res.StreamCount)
	}
	if res.StreamsByStatus[model.StreamStatusStreaming] != 1 || res.StreamsByStatus[model.StreamStatusDegraded] != 1 || res.StreamsByStatus[model.StreamStatusSeeding] != 1 {
		t.Fatalf("streams by status wrong: %+v", res.StreamsByStatus)
	}
	// RPO breach: only site-b (600s > 300 SLO). site-c has no data => not a breach.
	if len(res.RPOBreaches) != 1 || res.RPOBreaches[0].SiteID != "site-b" {
		t.Fatalf("expected exactly 1 RPO breach (site-b), got %+v", res.RPOBreaches)
	}
	if res.WorstLiveRPO == nil || res.WorstLiveRPO.SiteID != "site-b" || res.WorstLiveRPO.RPOSeconds != 600 {
		t.Fatalf("worst live RPO wrong: %+v", res.WorstLiveRPO)
	}
	// site-a within SLO, real seconds computed (60).
	var aEntry *LiveRPOEntry
	for i := range res.Streams {
		if res.Streams[i].SiteID == "site-a" {
			aEntry = &res.Streams[i]
		}
	}
	if aEntry == nil || aEntry.RPOSeconds != 60 || aEntry.BreachesSLO {
		t.Fatalf("site-a entry wrong: %+v", aEntry)
	}
	// Recent runs newest-first.
	if len(res.RecentRuns) != 2 || res.RecentRuns[0].RunID != "run-new" {
		t.Fatalf("recent runs order wrong: %+v", res.RecentRuns)
	}
	// Group membership counts.
	gm := map[string]int{}
	for _, g := range res.Groups {
		gm[g.GroupID] = g.MemberCount
	}
	if gm["grp-1"] != 2 || gm["grp-2"] != 1 {
		t.Fatalf("group member counts wrong: %+v", gm)
	}
}

// ---------------------------------------------------------------------------
// BlastRadius — the headline correctness test.
// ---------------------------------------------------------------------------

func TestBlastRadius_ComputesImpactedMembersFromSeededGroup(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)
	d.addSite("site-b", "Web VM", model.SiteKindVM, 600, 120)
	d.addSite("site-c", "Cache", model.SiteKindVM, 600, 120)
	d.addSite("site-x", "Unrelated", model.SiteKindFileset, 1800, 600)
	// grp-1 contains a, b, c (they fail over together). grp-2 contains only x.
	d.addGroup("grp-1", "Core Banking", map[string]int{"site-a": 1, "site-b": 2, "site-c": 3})
	d.addGroup("grp-2", "Unrelated Group", map[string]int{"site-x": 1})

	appliedA := now.Add(-30 * time.Second)
	appliedB := now.Add(-45 * time.Second)
	d.addStream("str-a", "site-a", model.StreamStatusStreaming, &appliedA)
	d.addStream("str-b", "site-b", model.StreamStatusStreaming, &appliedB)
	// site-c intentionally has NO stream — blast radius must not error on it.

	tools, runner := newTestTools(d, now)
	res, err := tools.BlastRadius(context.Background(), d.tenantID, "site-a")
	if err != nil {
		t.Fatalf("BlastRadius: %v", err)
	}
	if runner.reads == 0 {
		t.Fatal("expected BlastRadius to read through the tenant runner")
	}
	if res.SiteName != "App DB" || res.SiteKind != model.SiteKindDatabase {
		t.Fatalf("queried site metadata wrong: %+v", res)
	}
	// Impacted groups: only grp-1.
	if len(res.ImpactedGroups) != 1 || res.ImpactedGroups[0].GroupID != "grp-1" {
		t.Fatalf("expected only grp-1 impacted, got %+v", res.ImpactedGroups)
	}
	// Impacted members: a, b, c (all of grp-1) — NOT site-x.
	gotMembers := map[string]bool{}
	for _, m := range res.ImpactedMembers {
		gotMembers[m.SiteID] = true
		if m.SiteID == "site-x" {
			t.Fatalf("site-x must not be in blast radius of site-a")
		}
	}
	if !gotMembers["site-a"] || !gotMembers["site-b"] || !gotMembers["site-c"] {
		t.Fatalf("expected members a,b,c, got %+v", gotMembers)
	}
	if res.TotalMemberCount != 3 {
		t.Fatalf("expected 3 impacted members, got %d", res.TotalMemberCount)
	}
	// The queried site is flagged.
	queriedFlagged := false
	for _, m := range res.ImpactedMembers {
		if m.SiteID == "site-a" {
			if !m.IsQueried {
				t.Fatalf("site-a should be flagged is_queried")
			}
			queriedFlagged = true
		}
		if m.SiteID != "site-a" && m.IsQueried {
			t.Fatalf("only site-a should be is_queried, got %s", m.SiteID)
		}
	}
	if !queriedFlagged {
		t.Fatal("queried site not present in members")
	}
	// Dependent streams: a and b have streams; c does not (no error).
	depSites := map[string]bool{}
	for _, s := range res.DependentStreams {
		depSites[s.SiteID] = true
	}
	if !depSites["site-a"] || !depSites["site-b"] {
		t.Fatalf("expected dependent streams for a,b; got %+v", depSites)
	}
	if depSites["site-c"] {
		t.Fatalf("site-c has no stream; must not appear in dependent streams")
	}
	if len(res.DependentStreams) != 2 {
		t.Fatalf("expected exactly 2 dependent streams, got %d", len(res.DependentStreams))
	}
}

func TestBlastRadius_UnknownSiteReturnsNotFound(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	d := newFakeData()
	tools, _ := newTestTools(d, now)
	_, err := tools.BlastRadius(context.Background(), d.tenantID, "ghost")
	if !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for unknown site, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// DrillSummary / AttestationSummary
// ---------------------------------------------------------------------------

func TestDrillSummary_WithAndWithoutAttestation(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	d := newFakeData()
	d.addGroup("grp-1", "Core", map[string]int{})

	initiated := now.Add(-20 * time.Minute)
	completed := now.Add(-5 * time.Minute)
	rtoActual := 900
	d.addRun(&model.FailoverRun{ID: "run-1", GroupID: "grp-1", Mode: model.ModeDrill, Status: model.StatusCompleted, RTOObjectiveSeconds: 900, RTOActualSeconds: &rtoActual, InitiatedAt: initiated, CompletedAt: &completed})
	finished := now.Add(-6 * time.Minute)
	d.steps["run-1"] = []*model.FailoverStep{
		{ID: "s1", RunID: "run-1", Step: "validate", Status: model.StepStatusPassed, StartedAt: initiated, FinishedAt: &finished},
		{ID: "s2", RunID: "run-1", Step: "boot", Status: model.StepStatusPassed, StartedAt: finished, FinishedAt: &completed},
	}
	d.attests["run-1"] = &model.Attestation{ID: "att-1", TenantID: d.tenantID, RunID: "run-1", RTOObjectiveSeconds: 900, RTOActualSeconds: 900, RPOSeconds: 30, ValidationRatio: 0.9995, ReportObjectKey: "worm://att-1", ContentHash: "deadbeef", CreatedAt: completed}

	// A second run with no attestation yet.
	d.addRun(&model.FailoverRun{ID: "run-2", GroupID: "grp-1", Mode: model.ModeReal, Status: model.StatusExecuting, RTOObjectiveSeconds: 600, InitiatedAt: now.Add(-2 * time.Minute)})

	tools, _ := newTestTools(d, now)

	res, err := tools.DrillSummary(context.Background(), d.tenantID, "run-1")
	if err != nil {
		t.Fatalf("DrillSummary run-1: %v", err)
	}
	if res.Run.Status != model.StatusCompleted || res.Run.MetRTO == nil || !*res.Run.MetRTO {
		t.Fatalf("run-1 summary wrong: %+v", res.Run)
	}
	if len(res.Steps) != 2 || res.Steps[0].Step != "validate" {
		t.Fatalf("steps wrong: %+v", res.Steps)
	}
	if res.Attestation == nil || !res.Attestation.MetValidation || res.Attestation.ValidationRatio != 0.9995 {
		t.Fatalf("attestation wrong: %+v", res.Attestation)
	}

	res2, err := tools.DrillSummary(context.Background(), d.tenantID, "run-2")
	if err != nil {
		t.Fatalf("DrillSummary run-2: %v", err)
	}
	if res2.Attestation != nil {
		t.Fatalf("run-2 should have no attestation, got %+v", res2.Attestation)
	}

	// AttestationSummary direct.
	att, err := tools.AttestationSummary(context.Background(), d.tenantID, "run-1")
	if err != nil {
		t.Fatalf("AttestationSummary: %v", err)
	}
	if att.RPOSeconds != 30 || att.ContentHash != "deadbeef" {
		t.Fatalf("attestation summary wrong: %+v", att)
	}
	if _, err := tools.AttestationSummary(context.Background(), d.tenantID, "run-2"); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("expected ErrNotFound for un-attested run-2, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// ProposeFailover — must return a plan + gated API call and NOT execute.
// ---------------------------------------------------------------------------

func TestProposeFailover_ReturnsPlanAndDoesNotExecute(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)
	d.addSite("site-b", "Web VM", model.SiteKindVM, 1200, 120)
	d.addGroup("grp-1", "Core Banking", map[string]int{"site-a": 1, "site-b": 2})

	appliedA := now.Add(-30 * time.Second)
	appliedB := now.Add(-30 * time.Second)
	d.addStream("str-a", "site-a", model.StreamStatusStreaming, &appliedA)
	d.addStream("str-b", "site-b", model.StreamStatusStreaming, &appliedB)

	// Two recovery points: an OLD validated one and a NEWER validated one with a
	// passing ratio. The plan must pick the newest validated point.
	old := now.Add(-2 * time.Hour)
	recent := now.Add(-10 * time.Minute)
	d.addPoint("grp-1", "rp-old", ptrFloat(0.9999), true, old, 25)
	d.addPoint("grp-1", "rp-new", ptrFloat(0.9995), true, recent, 20)
	// A non-validated point that must be ignored even though it is newest.
	d.addPoint("grp-1", "rp-bad", ptrFloat(0.5), false, now, 10)

	tools, _ := newTestTools(d, now)
	action, err := tools.ProposeFailover(context.Background(), d.tenantID, "grp-1")
	if err != nil {
		t.Fatalf("ProposeFailover: %v", err)
	}
	if action == nil {
		t.Fatal("expected a proposed action")
	}
	if action.Kind != "failover" || !action.RequiresApproval {
		t.Fatalf("action must be a failover requiring approval: %+v", action)
	}
	// It returns the initiate API call (creates a run that PARKS at approval) and
	// the separate approval call — it never executes.
	if action.APICall.Method != "POST" || action.APICall.Path != "/api/v1/dr/failover-runs" {
		t.Fatalf("initiate API call wrong: %+v", action.APICall)
	}
	if action.ApprovalCall == nil || action.ApprovalCall.Path != "/api/v1/dr/failover-runs/{run_id}/approve" {
		t.Fatalf("approval call wrong: %+v", action.ApprovalCall)
	}
	// The chosen recovery point is the newest VALIDATED one (rp-new), not rp-old
	// or the non-validated rp-bad.
	if got := action.APICall.Body["recovery_point_id"]; got != "rp-new" {
		t.Fatalf("expected chosen recovery point rp-new, got %v", got)
	}
	// RTO objective = max member objective (1200).
	if got := action.APICall.Body["rto_objective_seconds"]; got != 1200 {
		t.Fatalf("expected rto objective 1200, got %v", got)
	}
	if got := action.APICall.Body["mode"]; got != model.ModeReal {
		t.Fatalf("expected mode real, got %v", got)
	}
	// Boot order present and ordered.
	bootOrder, _ := action.Plan["boot_order"].([]ImpactedMember)
	if len(bootOrder) != 2 || bootOrder[0].SiteID != "site-a" || bootOrder[1].SiteID != "site-b" {
		t.Fatalf("boot order wrong: %+v", bootOrder)
	}
	// Healthy streams + validated point => no warnings.
	if len(action.Warnings) != 0 {
		t.Fatalf("expected no warnings for healthy group, got %+v", action.Warnings)
	}
}

func TestProposeFailover_WarnsWhenNoValidatedPointOrDegradedStreams(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	d := newFakeData()
	d.addSite("site-a", "App DB", model.SiteKindDatabase, 900, 300)
	d.addGroup("grp-1", "Core Banking", map[string]int{"site-a": 1})
	// Stream is degraded (not streaming).
	applied := now.Add(-30 * time.Second)
	d.addStream("str-a", "site-a", model.StreamStatusDegraded, &applied)
	// Only a sub-floor validated point and a non-validated one => no usable point.
	d.addPoint("grp-1", "rp-low", ptrFloat(0.95), true, now, 40)
	d.addPoint("grp-1", "rp-unvalidated", ptrFloat(0.9999), false, now, 30)

	tools, _ := newTestTools(d, now)
	action, err := tools.ProposeFailover(context.Background(), d.tenantID, "grp-1")
	if err != nil {
		t.Fatalf("ProposeFailover: %v", err)
	}
	// No recovery point id in the body (none meets the Gate-1 floor).
	if _, ok := action.APICall.Body["recovery_point_id"]; ok {
		t.Fatalf("no validated point should be chosen, but body had recovery_point_id: %+v", action.APICall.Body)
	}
	// Expect both warnings: no validated point AND degraded stream.
	var sawNoPoint, sawDegraded bool
	for _, w := range action.Warnings {
		if strings.Contains(w, "validation floor") {
			sawNoPoint = true
		}
		if strings.Contains(w, "not streaming") {
			sawDegraded = true
		}
	}
	if !sawNoPoint {
		t.Fatalf("expected a no-validated-recovery-point warning, got %+v", action.Warnings)
	}
	if !sawDegraded {
		t.Fatalf("expected a degraded-stream warning, got %+v", action.Warnings)
	}
}
