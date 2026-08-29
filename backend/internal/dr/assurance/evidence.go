package assurance

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/bcm"
	"github.com/clario360/platform/internal/dr/bootgraph"
	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/failback"
	"github.com/clario360/platform/internal/dr/gameday"
	drmodel "github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared DR repository so this package's store, the
// evidence sources, and the service all speak the same execution-context type: a
// *pgxpool.Pool for a single read, or the caller's open transaction so the
// assessment header, its control-result rows, and the outbox event all commit
// atomically.
type DBTX = repository.DBTX

// DomainEvidence is the collector seam for existing DR domains. Store-backed
// adapters return the domain value types they already own; ComposeEvidence is the
// only place that translates those values into the scorer's AssuranceEvidence.
// This keeps assurance from growing duplicate per-score feeders for BCM,
// appverify, clean-room, recovery points/RPO, drills/failovers, bootgraph, and
// failback.
type DomainEvidence struct {
	Assurance AssuranceEvidence

	BCMDrills         []bcm.DrillEvidence
	BCMFailovers      []bcm.FailoverEvidence
	BCMRecoveryPoints []bcm.RecoveryPointEvidence
	BCMCleanRoom      []bcm.CleanRoomEvidence

	AppVerifications  []appverify.Result
	CleanRoomScans    []cleanroom.Scan
	RecoveryPoints    []drmodel.RecoveryPoint
	StreamRPO         []drmodel.StreamRPO
	FailoverRuns      []drmodel.FailoverRun
	GameDayScorecards []gameday.Scorecard
	BootRuns          []bootgraph.BootRun
	FailbackRuns      []failback.FailbackRun
}

// EvidenceSource yields existing DR-domain evidence for a group. Implementers
// should return domain values rather than pre-scored assurance rows where
// possible; ComposeEvidence performs normalization once for all sources.
type EvidenceSource interface {
	AssuranceDomainEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) (DomainEvidence, error)
}

// The legacy evidence source interfaces below are kept for compatibility with
// existing tests/wiring. Collector adapts them into DomainEvidence and still
// routes them through ComposeEvidence.

// DrillSource yields recovery-drill results for a group.
type DrillSource interface {
	DrillEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]DrillEvidence, error)
}

// AppVerificationSource yields application-layer verification results for a
// group (the recovered workload was proven usable, not merely booted).
type AppVerificationSource interface {
	AppVerificationEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]VerificationEvidence, error)
}

// CleanRoomVerificationSource yields clean-room (isolated restore + scan)
// verification results for a group.
type CleanRoomVerificationSource interface {
	CleanRoomVerificationEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]VerificationEvidence, error)
}

// RunbookReviewSource yields recovery-runbook review/refresh evidence for a
// group.
type RunbookReviewSource interface {
	RunbookReviewEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]VerificationEvidence, error)
}

// BootGraphVerificationSource yields dependency / bootgraph validation evidence
// for a group (a boot run that proved the dependency order is executable).
type BootGraphVerificationSource interface {
	BootGraphVerificationEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]VerificationEvidence, error)
}

// FailbackVerificationSource yields failback-test evidence for a group.
type FailbackVerificationSource interface {
	FailbackVerificationEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]VerificationEvidence, error)
}

// DriftSource yields the latest infrastructure / topology / plan drift snapshots
// for a group.
type DriftSource interface {
	DriftEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]DriftEvidence, error)
}

// RPOSource yields observed replication-lag (RPO) samples for a group.
type RPOSource interface {
	RPOEvidence(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) ([]RPOEvidence, error)
}

// Sources bundles every evidence source. Integrate constructs it with the live
// store-backed implementations; tests construct it with in-memory fakes. Any
// field may be nil — the collector treats a nil source as "no evidence of that
// kind", which (per the evaluator) fails any control requiring it rather than
// vacuously passing.
type Sources struct {
	Feeds     []EvidenceSource
	Drills    DrillSource
	App       AppVerificationSource
	CleanRoom CleanRoomVerificationSource
	Runbook   RunbookReviewSource
	BootGraph BootGraphVerificationSource
	Failback  FailbackVerificationSource
	Drift     DriftSource
	RPO       RPOSource
}

// Collector reads real DR data through the Sources and assembles an
// AssuranceEvidence bundle for a group. It is stateless beyond the sources, so it
// is safe to share and reuse across evaluations.
type Collector struct {
	sources Sources
}

// NewCollector constructs a collector over the given sources.
func NewCollector(sources Sources) *Collector {
	return &Collector{sources: sources}
}

// Collect gathers evidence for one group. It queries every wired source; a nil
// source leaves that kind absent. A source error aborts the whole collection with
// a wrapped error — partial evidence would silently skew the score, so collection
// is all-or-nothing per wired source. Every verification source's rows are
// stamped with that source's canonical kind inside ComposeEvidence, so the
// evaluator's kind-filtering is authoritative regardless of what a feeder set.
func (c *Collector) Collect(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) (AssuranceEvidence, error) {
	var domain DomainEvidence

	for i, feed := range c.sources.Feeds {
		if feed == nil {
			continue
		}
		items, err := feed.AssuranceDomainEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return AssuranceEvidence{}, fmt.Errorf("collect domain evidence feed %d: %w", i, err)
		}
		domain.merge(items)
	}

	if c.sources.Drills != nil {
		items, err := c.sources.Drills.DrillEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return AssuranceEvidence{}, fmt.Errorf("collect drill evidence: %w", err)
		}
		domain.Assurance.Drills = append(domain.Assurance.Drills, items...)
	}

	verificationSources := []struct {
		kind  VerificationKind
		fetch func() ([]VerificationEvidence, error)
	}{
		{VerificationApp, c.appFetch(ctx, db, tenantID, groupID)},
		{VerificationCleanRoom, c.cleanRoomFetch(ctx, db, tenantID, groupID)},
		{VerificationRunbookReview, c.runbookFetch(ctx, db, tenantID, groupID)},
		{VerificationDependencyBootGraph, c.bootGraphFetch(ctx, db, tenantID, groupID)},
		{VerificationFailback, c.failbackFetch(ctx, db, tenantID, groupID)},
	}
	for _, vs := range verificationSources {
		if vs.fetch == nil {
			continue
		}
		items, err := vs.fetch()
		if err != nil {
			return AssuranceEvidence{}, fmt.Errorf("collect %s verification evidence: %w", vs.kind, err)
		}
		for i := range items {
			items[i].Kind = vs.kind
		}
		domain.Assurance.Verifications = append(domain.Assurance.Verifications, items...)
	}

	if c.sources.Drift != nil {
		items, err := c.sources.Drift.DriftEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return AssuranceEvidence{}, fmt.Errorf("collect drift evidence: %w", err)
		}
		domain.Assurance.Drift = append(domain.Assurance.Drift, items...)
	}
	if c.sources.RPO != nil {
		items, err := c.sources.RPO.RPOEvidence(ctx, db, tenantID, groupID)
		if err != nil {
			return AssuranceEvidence{}, fmt.Errorf("collect rpo evidence: %w", err)
		}
		domain.Assurance.RPO = append(domain.Assurance.RPO, items...)
	}

	return ComposeEvidence(domain), nil
}

// ComposeEvidence normalizes all collected DR-domain values into the evidence
// shape evaluated by this package. It is intentionally side-effect-free so the
// adapters can be unit-tested without database wiring.
func ComposeEvidence(in DomainEvidence) AssuranceEvidence {
	out := in.Assurance.clone()

	for _, d := range in.BCMDrills {
		out.Drills = append(out.Drills, drillFromBCM(d))
	}
	for _, f := range in.BCMFailovers {
		out.Drills = append(out.Drills, drillFromBCMFailover(f))
	}
	for _, rp := range in.BCMRecoveryPoints {
		out.RPO = append(out.RPO, rpoFromBCMRecoveryPoint(rp))
	}
	for _, cr := range in.BCMCleanRoom {
		out.Verifications = append(out.Verifications, verificationFromBCMCleanRoom(cr))
	}
	for _, result := range in.AppVerifications {
		out.Verifications = append(out.Verifications, verificationFromAppResult(result))
	}
	for _, scan := range in.CleanRoomScans {
		out.Verifications = append(out.Verifications, verificationFromCleanRoomScan(scan))
	}
	for _, rp := range in.RecoveryPoints {
		out.RPO = append(out.RPO, rpoFromRecoveryPoint(rp))
	}
	for _, rpo := range in.StreamRPO {
		out.RPO = append(out.RPO, rpoFromStreamRPO(rpo))
	}
	for _, run := range in.FailoverRuns {
		out.Drills = append(out.Drills, drillFromFailoverRun(run))
	}
	for _, card := range in.GameDayScorecards {
		if drill, ok := drillFromGameDayScorecard(card); ok {
			out.Drills = append(out.Drills, drill)
		}
	}
	for _, run := range in.BootRuns {
		out.Verifications = append(out.Verifications, verificationFromBootRun(run))
	}
	for _, run := range in.FailbackRuns {
		out.Verifications = append(out.Verifications, verificationFromFailbackRun(run))
	}

	return out
}

func (d *DomainEvidence) merge(other DomainEvidence) {
	d.Assurance.Drills = append(d.Assurance.Drills, other.Assurance.Drills...)
	d.Assurance.Verifications = append(d.Assurance.Verifications, other.Assurance.Verifications...)
	d.Assurance.Drift = append(d.Assurance.Drift, other.Assurance.Drift...)
	d.Assurance.RPO = append(d.Assurance.RPO, other.Assurance.RPO...)
	d.BCMDrills = append(d.BCMDrills, other.BCMDrills...)
	d.BCMFailovers = append(d.BCMFailovers, other.BCMFailovers...)
	d.BCMRecoveryPoints = append(d.BCMRecoveryPoints, other.BCMRecoveryPoints...)
	d.BCMCleanRoom = append(d.BCMCleanRoom, other.BCMCleanRoom...)
	d.AppVerifications = append(d.AppVerifications, other.AppVerifications...)
	d.CleanRoomScans = append(d.CleanRoomScans, other.CleanRoomScans...)
	d.RecoveryPoints = append(d.RecoveryPoints, other.RecoveryPoints...)
	d.StreamRPO = append(d.StreamRPO, other.StreamRPO...)
	d.FailoverRuns = append(d.FailoverRuns, other.FailoverRuns...)
	d.GameDayScorecards = append(d.GameDayScorecards, other.GameDayScorecards...)
	d.BootRuns = append(d.BootRuns, other.BootRuns...)
	d.FailbackRuns = append(d.FailbackRuns, other.FailbackRuns...)
}

func (e AssuranceEvidence) clone() AssuranceEvidence {
	return AssuranceEvidence{
		Drills:        append([]DrillEvidence(nil), e.Drills...),
		Verifications: append([]VerificationEvidence(nil), e.Verifications...),
		Drift:         append([]DriftEvidence(nil), e.Drift...),
		RPO:           append([]RPOEvidence(nil), e.RPO...),
	}
}

func drillFromBCM(d bcm.DrillEvidence) DrillEvidence {
	return DrillEvidence{
		ID:                  evidenceID("bcm:drill", d.ID.String()),
		RunID:               d.ID.String(),
		ExecutedAt:          d.ExecutedAt,
		CompletedAt:         d.ExecutedAt,
		NonDisruptive:       true,
		Passed:              d.Passed,
		RTOObjectiveSeconds: d.RTOObjectiveSeconds,
		RTOAchievedSeconds:  d.RTOActualSeconds,
		RPOAchievedSeconds:  d.RPOSeconds,
	}
}

func drillFromBCMFailover(f bcm.FailoverEvidence) DrillEvidence {
	return DrillEvidence{
		ID:                  evidenceID("bcm:failover", f.ID.String()),
		RunID:               f.ID.String(),
		ExecutedAt:          f.CompletedAt,
		CompletedAt:         f.CompletedAt,
		NonDisruptive:       f.Mode == drmodel.ModeDrill,
		Passed:              f.Status == drmodel.StatusCompleted,
		RTOObjectiveSeconds: f.RTOObjectiveSeconds,
		RTOAchievedSeconds:  f.RTOActualSeconds,
	}
}

func rpoFromBCMRecoveryPoint(rp bcm.RecoveryPointEvidence) RPOEvidence {
	return RPOEvidence{
		ID:               evidenceID("bcm:recovery_point", rp.ID.String()),
		MeasuredAt:       rp.SealedAt,
		ActualLagSeconds: rp.RPOSeconds,
		RecoveryPointID:  rp.ID.String(),
	}
}

func verificationFromBCMCleanRoom(cr bcm.CleanRoomEvidence) VerificationEvidence {
	return VerificationEvidence{
		ID:         evidenceID("bcm:clean_room", cr.ID.String()),
		Kind:       VerificationCleanRoom,
		VerifiedAt: cr.VerifiedAt,
		Passed:     cr.Clean,
		Message:    cr.Verdict,
	}
}

func verificationFromAppResult(result appverify.Result) VerificationEvidence {
	return VerificationEvidence{
		ID:           evidenceID("appverify", resultID(result.WorkloadID, result.WorkloadName, result.FinishedAt)),
		Kind:         VerificationApp,
		VerifiedAt:   firstTime(result.FinishedAt, result.StartedAt),
		Passed:       result.Passed,
		ChecksPassed: result.ChecksPassed,
		ChecksTotal:  result.ChecksTotal,
		Warnings:     appWarnings(result),
		Artifacts:    appEvidenceRefs(result.Results),
		Message:      strings.Join(result.FailedChecks, ","),
	}
}

func verificationFromCleanRoomScan(scan cleanroom.Scan) VerificationEvidence {
	return VerificationEvidence{
		ID:           evidenceID("cleanroom", firstString(scan.ID, scan.RecoveryPointID)),
		RunID:        scan.RecoveryPointID,
		Kind:         VerificationCleanRoom,
		VerifiedAt:   firstTime(scan.FinishedAt, scan.StartedAt),
		Passed:       scan.Verdict == cleanroom.VerdictClean,
		ChecksPassed: cleanRoomChecksPassed(scan),
		ChecksTotal:  scan.ChunksScanned,
		Message:      scan.Detail,
	}
}

func rpoFromRecoveryPoint(rp drmodel.RecoveryPoint) RPOEvidence {
	return RPOEvidence{
		ID:               evidenceID("recovery_point", rp.ID),
		MeasuredAt:       rp.SealedAt,
		ActualLagSeconds: rp.RPOSeconds,
		RecoveryPointID:  rp.ID,
	}
}

func rpoFromStreamRPO(rpo drmodel.StreamRPO) RPOEvidence {
	return RPOEvidence{
		ID:                  evidenceID("stream_rpo", rpo.StreamID),
		MeasuredAt:          rpo.MeasuredAt,
		ActualLagSeconds:    rpo.LagSeconds,
		ReplicationStreamID: rpo.StreamID,
	}
}

func drillFromFailoverRun(run drmodel.FailoverRun) DrillEvidence {
	actual := 0
	if run.RTOActualSeconds != nil {
		actual = *run.RTOActualSeconds
	} else if rto, ok := run.RTOActual(); ok {
		actual = int(rto.Seconds())
	}
	return DrillEvidence{
		ID:                  evidenceID("failover", run.ID),
		RunID:               run.ID,
		ExecutedAt:          run.InitiatedAt,
		CompletedAt:         timePtrValue(run.CompletedAt),
		NonDisruptive:       run.Mode == drmodel.ModeDrill,
		Passed:              run.Status == drmodel.StatusCompleted,
		RTOObjectiveSeconds: run.RTOObjectiveSeconds,
		RTOAchievedSeconds:  actual,
	}
}

func drillFromGameDayScorecard(card gameday.Scorecard) (DrillEvidence, bool) {
	if card.Run == nil {
		return DrillEvidence{}, false
	}
	run := card.Run
	failedSteps := make([]string, 0)
	for _, step := range card.Steps {
		if step == nil || step.Passed {
			continue
		}
		failedSteps = append(failedSteps, strconv.Itoa(step.StepIndex)+":"+step.Action)
	}
	return DrillEvidence{
		ID:            evidenceID("gameday", run.ID),
		RunID:         run.ID,
		Scenario:      run.ScenarioID,
		ExecutedAt:    run.InitiatedAt,
		CompletedAt:   timePtrValue(run.CompletedAt),
		NonDisruptive: gameday.ValidScope(run.Scope),
		Passed:        run.Status == gameday.RunStatusPassed && run.AllFaultsReverted,
		Warnings:      maxInt(0, run.StepsTotal-run.StepsPassed),
		FailedSteps:   failedSteps,
	}, true
}

func verificationFromBootRun(run bootgraph.BootRun) VerificationEvidence {
	return VerificationEvidence{
		ID:           evidenceID("bootgraph", run.ID),
		RunID:        run.ID,
		Kind:         VerificationDependencyBootGraph,
		VerifiedAt:   firstTime(timePtrValue(run.CompletedAt), run.StartedAt),
		Passed:       run.Status == bootgraph.RunStatusCompleted,
		ChecksPassed: run.TiersBooted,
		ChecksTotal:  run.TotalTiers,
		Message:      stringPtrValue(run.LastError),
	}
}

func verificationFromFailbackRun(run failback.FailbackRun) VerificationEvidence {
	return VerificationEvidence{
		ID:         evidenceID("failback", run.ID),
		RunID:      run.ID,
		Kind:       VerificationFailback,
		VerifiedAt: firstTime(timePtrValue(run.CompletedAt), run.UpdatedAt, run.InitiatedAt),
		Passed:     run.Status == failback.StatusCompleted,
		Message:    stringPtrValue(run.LastError),
	}
}

func evidenceID(prefix, id string) string {
	if id == "" {
		return prefix
	}
	return prefix + ":" + id
}

func resultID(workloadID, workloadName string, finishedAt time.Time) string {
	if workloadID != "" {
		return workloadID
	}
	if workloadName != "" {
		return workloadName
	}
	if !finishedAt.IsZero() {
		return finishedAt.UTC().Format("20060102T150405Z")
	}
	return ""
}

func appWarnings(result appverify.Result) int {
	if result.ChecksTotal <= 0 || result.ChecksPassed >= result.ChecksTotal {
		return 0
	}
	return result.ChecksTotal - result.ChecksPassed
}

func appEvidenceRefs(results []appverify.CheckResult) []string {
	refs := make([]string, 0, len(results))
	for _, r := range results {
		if r.EvidenceRef != "" {
			refs = append(refs, r.EvidenceRef)
		}
	}
	return refs
}

func cleanRoomChecksPassed(scan cleanroom.Scan) int {
	if scan.Verdict == cleanroom.VerdictClean {
		return scan.ChunksScanned
	}
	passed := 0
	for _, f := range scan.Findings {
		if f.Clean && f.IntegrityOK {
			passed++
		}
	}
	return passed
}

func firstString(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func firstTime(values ...time.Time) time.Time {
	for _, v := range values {
		if !v.IsZero() {
			return v
		}
	}
	return time.Time{}
}

func timePtrValue(v *time.Time) time.Time {
	if v == nil {
		return time.Time{}
	}
	return *v
}

func stringPtrValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// The *Fetch helpers return nil when their source is unwired so the collector's
// loop skips them, and otherwise bind the call into a thunk the loop invokes once.

func (c *Collector) appFetch(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) func() ([]VerificationEvidence, error) {
	if c.sources.App == nil {
		return nil
	}
	return func() ([]VerificationEvidence, error) {
		return c.sources.App.AppVerificationEvidence(ctx, db, tenantID, groupID)
	}
}

func (c *Collector) cleanRoomFetch(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) func() ([]VerificationEvidence, error) {
	if c.sources.CleanRoom == nil {
		return nil
	}
	return func() ([]VerificationEvidence, error) {
		return c.sources.CleanRoom.CleanRoomVerificationEvidence(ctx, db, tenantID, groupID)
	}
}

func (c *Collector) runbookFetch(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) func() ([]VerificationEvidence, error) {
	if c.sources.Runbook == nil {
		return nil
	}
	return func() ([]VerificationEvidence, error) {
		return c.sources.Runbook.RunbookReviewEvidence(ctx, db, tenantID, groupID)
	}
}

func (c *Collector) bootGraphFetch(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) func() ([]VerificationEvidence, error) {
	if c.sources.BootGraph == nil {
		return nil
	}
	return func() ([]VerificationEvidence, error) {
		return c.sources.BootGraph.BootGraphVerificationEvidence(ctx, db, tenantID, groupID)
	}
}

func (c *Collector) failbackFetch(ctx context.Context, db DBTX, tenantID, groupID uuid.UUID) func() ([]VerificationEvidence, error) {
	if c.sources.Failback == nil {
		return nil
	}
	return func() ([]VerificationEvidence, error) {
		return c.sources.Failback.FailbackVerificationEvidence(ctx, db, tenantID, groupID)
	}
}
