package readmodel_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/readmodel"
)

type fakeReader struct {
	sites   []*model.ProtectedSite
	groups  []*model.ConsistencyGroup
	members map[string][]model.ConsistencyGroupMember
	streams []*model.ReplicationStream
	points  map[string][]*model.RecoveryPoint
	runs    []*model.FailoverRun
}

func (r fakeReader) ListSites(context.Context, uuid.UUID) ([]*model.ProtectedSite, error) {
	return r.sites, nil
}

func (r fakeReader) GetGroup(_ context.Context, _ uuid.UUID, groupID uuid.UUID) (*model.ConsistencyGroup, error) {
	for _, group := range r.groups {
		if group.ID == groupID.String() {
			return group, nil
		}
	}
	return nil, model.ErrNotFound
}

func (r fakeReader) ListGroups(context.Context, uuid.UUID) ([]*model.ConsistencyGroup, error) {
	return r.groups, nil
}

func (r fakeReader) ListGroupMembers(_ context.Context, _ uuid.UUID, groupID uuid.UUID) ([]model.ConsistencyGroupMember, error) {
	return r.members[groupID.String()], nil
}

func (r fakeReader) ListStreams(context.Context, uuid.UUID) ([]*model.ReplicationStream, error) {
	return r.streams, nil
}

func (r fakeReader) ListRecoveryPoints(_ context.Context, _ uuid.UUID, groupID uuid.UUID) ([]*model.RecoveryPoint, error) {
	return r.points[groupID.String()], nil
}

func (r fakeReader) ListFailoverRuns(context.Context, uuid.UUID) ([]*model.FailoverRun, error) {
	return r.runs, nil
}

func TestBuildPostureAndGroupSummaryDeriveLiveDRState(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	groupID := uuid.New()
	siteA := uuid.New()
	siteB := uuid.New()
	streamA := uuid.New()
	streamB := uuid.New()
	pointOld := uuid.New()
	pointNew := uuid.New()
	runOld := uuid.New()
	runNew := uuid.New()

	appliedA := now.Add(-60 * time.Second)
	appliedB := now.Add(-600 * time.Second)
	rtoActual := 120
	reader := fakeReader{
		sites: []*model.ProtectedSite{
			{ID: siteA.String(), TenantID: tenantID.String(), Name: "Core DB", Kind: model.SiteKindDatabase, RTOObjectiveSeconds: 900, RPOObjectiveSeconds: 300},
			{ID: siteB.String(), TenantID: tenantID.String(), Name: "Payments API", Kind: model.SiteKindVM, RTOObjectiveSeconds: 600, RPOObjectiveSeconds: 120},
		},
		groups: []*model.ConsistencyGroup{
			{ID: groupID.String(), TenantID: tenantID.String(), Name: "Core Banking"},
		},
		members: map[string][]model.ConsistencyGroupMember{
			groupID.String(): {
				{GroupID: groupID.String(), SiteID: siteA.String(), BootOrder: 10},
				{GroupID: groupID.String(), SiteID: siteB.String(), BootOrder: 20},
			},
		},
		streams: []*model.ReplicationStream{
			{ID: streamA.String(), TenantID: tenantID.String(), SiteID: siteA.String(), Status: model.StreamStatusStreaming, AppliedSeq: 10, AppliedAt: &appliedA},
			{ID: streamB.String(), TenantID: tenantID.String(), SiteID: siteB.String(), Status: model.StreamStatusStreaming, AppliedSeq: 12, AppliedAt: &appliedB},
		},
		points: map[string][]*model.RecoveryPoint{
			groupID.String(): {
				{ID: pointOld.String(), TenantID: tenantID.String(), GroupID: groupID.String(), MarkerLSN: "0/old", RPOSeconds: 80, IsValidated: true, LegalHold: true, SealedAt: now.Add(-2 * time.Hour), RetentionUntil: now.Add(24 * time.Hour)},
				{ID: pointNew.String(), TenantID: tenantID.String(), GroupID: groupID.String(), MarkerLSN: "0/new", RPOSeconds: 55, IsValidated: true, LegalHold: true, SealedAt: now.Add(-time.Hour), RetentionUntil: now.Add(48 * time.Hour)},
			},
		},
		runs: []*model.FailoverRun{
			{ID: runOld.String(), TenantID: tenantID.String(), GroupID: groupID.String(), Mode: model.ModeDrill, Status: model.StatusCompleted, RTOObjectiveSeconds: 900, RTOActualSeconds: &rtoActual, InitiatedAt: now.Add(-3 * time.Hour), CompletedAt: ptrTime(now.Add(-3*time.Hour + 2*time.Minute))},
			{ID: runNew.String(), TenantID: tenantID.String(), GroupID: groupID.String(), Mode: model.ModeReal, Status: model.StatusExecuting, RTOObjectiveSeconds: 600, InitiatedAt: now.Add(-30 * time.Minute)},
		},
	}

	posture, err := readmodel.BuildPosture(context.Background(), reader, tenantID, now)
	if err != nil {
		t.Fatalf("BuildPosture: %v", err)
	}
	if posture.SiteCount != 2 || posture.GroupCount != 1 || posture.StreamCount != 2 || posture.RecoveryPointCount != 2 {
		t.Fatalf("counts = sites:%d groups:%d streams:%d points:%d, want 2/1/2/2", posture.SiteCount, posture.GroupCount, posture.StreamCount, posture.RecoveryPointCount)
	}
	if posture.OverallHealth != "warning" {
		t.Fatalf("overall health = %q, want warning", posture.OverallHealth)
	}
	if len(posture.RPOBreaches) != 1 || posture.RPOBreaches[0].SiteID != siteB.String() {
		t.Fatalf("RPO breaches = %+v, want only site B", posture.RPOBreaches)
	}
	if posture.WorstLiveRPO == nil || posture.WorstLiveRPO.StreamID != streamB.String() || posture.WorstLiveRPO.RPOSeconds == nil || *posture.WorstLiveRPO.RPOSeconds != 600 {
		t.Fatalf("worst live RPO = %+v, want stream B at 600s", posture.WorstLiveRPO)
	}
	if len(posture.Groups) != 1 || posture.Groups[0].ReplicationPercent != 50 {
		t.Fatalf("group rollups = %+v, want 50%% replication health", posture.Groups)
	}
	if posture.Groups[0].LatestRecoveryPoint == nil || posture.Groups[0].LatestRecoveryPoint.ID != pointNew.String() {
		t.Fatalf("latest point = %+v, want new point", posture.Groups[0].LatestRecoveryPoint)
	}
	if len(posture.RecentRuns) != 2 || posture.RecentRuns[0].RunID != runNew.String() {
		t.Fatalf("recent runs = %+v, want newest first", posture.RecentRuns)
	}
	if len(posture.Attention) == 0 {
		t.Fatal("expected RPO breach attention item")
	}

	group, err := readmodel.BuildGroupSummary(context.Background(), reader, tenantID, groupID, now)
	if err != nil {
		t.Fatalf("BuildGroupSummary: %v", err)
	}
	if group.Health != "warning" || group.MemberCount != 2 || group.StreamCount != 2 || group.ReplicationPercent != 50 {
		t.Fatalf("group summary = %+v, want warning with 2 members, 2 streams, 50%%", group)
	}
	if group.RPOObjectiveSeconds != 120 || group.RTOObjectiveSeconds != 900 {
		t.Fatalf("objectives = rpo:%d rto:%d, want 120/900", group.RPOObjectiveSeconds, group.RTOObjectiveSeconds)
	}
	if len(group.Members) != 2 || group.Members[1].Stream == nil || !group.Members[1].Stream.BreachesRPO {
		t.Fatalf("members = %+v, want second member stream breach", group.Members)
	}
}

func TestBuildReplicationSummaryDerivesStatusCounts(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	siteID := uuid.New()
	streamID := uuid.New()
	appliedAt := now.Add(-10 * time.Second)
	reader := fakeReader{
		sites: []*model.ProtectedSite{
			{ID: siteID.String(), TenantID: tenantID.String(), Name: "ERP", Kind: model.SiteKindVM, RPOObjectiveSeconds: 300},
		},
		streams: []*model.ReplicationStream{
			{ID: streamID.String(), TenantID: tenantID.String(), SiteID: siteID.String(), Status: model.StreamStatusStreaming, AppliedAt: &appliedAt},
		},
	}

	summary, err := readmodel.BuildReplicationSummary(context.Background(), reader, tenantID, now)
	if err != nil {
		t.Fatalf("BuildReplicationSummary: %v", err)
	}
	if summary.OverallHealth != "healthy" || summary.TotalStreams != 1 {
		t.Fatalf("summary = %+v, want one healthy stream", summary)
	}
	if summary.StreamsByStatus[model.StreamStatusStreaming] != 1 {
		t.Fatalf("streams by status = %+v, want one streaming", summary.StreamsByStatus)
	}
	if len(summary.Streams) != 1 || summary.Streams[0].RPOSeconds == nil || *summary.Streams[0].RPOSeconds != 10 {
		t.Fatalf("streams = %+v, want RPO 10s", summary.Streams)
	}
}

func TestBuildGroupSummaryReportsReadyFailoverReadiness(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	groupID := uuid.New()
	siteID := uuid.New()
	streamID := uuid.New()
	pointID := uuid.New()
	ratio := 1.0
	appliedAt := now.Add(-20 * time.Second)
	reader := fakeReader{
		sites: []*model.ProtectedSite{
			{ID: siteID.String(), TenantID: tenantID.String(), Name: "Orders DB", Kind: model.SiteKindDatabase, RPOObjectiveSeconds: 120, RTOObjectiveSeconds: 600},
		},
		groups: []*model.ConsistencyGroup{
			{ID: groupID.String(), TenantID: tenantID.String(), Name: "Orders"},
		},
		members: map[string][]model.ConsistencyGroupMember{
			groupID.String(): {{GroupID: groupID.String(), SiteID: siteID.String(), BootOrder: 10}},
		},
		streams: []*model.ReplicationStream{
			{ID: streamID.String(), TenantID: tenantID.String(), SiteID: siteID.String(), Status: model.StreamStatusStreaming, AppliedAt: &appliedAt},
		},
		points: map[string][]*model.RecoveryPoint{
			groupID.String(): {
				{ID: pointID.String(), TenantID: tenantID.String(), GroupID: groupID.String(), MarkerLSN: "0/ready", ValidationRatio: &ratio, IsValidated: true, LegalHold: true, SealedAt: now.Add(-time.Minute), RetentionUntil: now.Add(time.Hour)},
			},
		},
	}

	group, err := readmodel.BuildGroupSummary(context.Background(), reader, tenantID, groupID, now)
	if err != nil {
		t.Fatalf("BuildGroupSummary: %v", err)
	}
	if group.FailoverReadiness.Status != "ready" || !group.FailoverReadiness.CanFailover {
		t.Fatalf("readiness = %+v, want ready/can failover", group.FailoverReadiness)
	}
	if len(group.FailoverReadiness.BlockingReasons) != 0 || len(group.FailoverReadiness.WarningReasons) != 0 {
		t.Fatalf("readiness reasons = %+v, want none", group.FailoverReadiness)
	}
}

func TestBuildGroupSummaryReportsDegradedReadinessForRPOAndLegalHold(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	groupID := uuid.New()
	siteID := uuid.New()
	streamID := uuid.New()
	pointID := uuid.New()
	ratio := 0.9995
	appliedAt := now.Add(-5 * time.Minute)
	reader := fakeReader{
		sites: []*model.ProtectedSite{
			{ID: siteID.String(), TenantID: tenantID.String(), Name: "Billing API", Kind: model.SiteKindVM, RPOObjectiveSeconds: 60, RTOObjectiveSeconds: 300},
		},
		groups: []*model.ConsistencyGroup{
			{ID: groupID.String(), TenantID: tenantID.String(), Name: "Billing"},
		},
		members: map[string][]model.ConsistencyGroupMember{
			groupID.String(): {{GroupID: groupID.String(), SiteID: siteID.String(), BootOrder: 10}},
		},
		streams: []*model.ReplicationStream{
			{ID: streamID.String(), TenantID: tenantID.String(), SiteID: siteID.String(), Status: model.StreamStatusStreaming, AppliedAt: &appliedAt},
		},
		points: map[string][]*model.RecoveryPoint{
			groupID.String(): {
				{ID: pointID.String(), TenantID: tenantID.String(), GroupID: groupID.String(), MarkerLSN: "0/degraded", ValidationRatio: &ratio, IsValidated: true, LegalHold: false, SealedAt: now.Add(-time.Minute), RetentionUntil: now.Add(time.Hour)},
			},
		},
	}

	group, err := readmodel.BuildGroupSummary(context.Background(), reader, tenantID, groupID, now)
	if err != nil {
		t.Fatalf("BuildGroupSummary: %v", err)
	}
	if group.FailoverReadiness.Status != "degraded" || !group.FailoverReadiness.CanFailover {
		t.Fatalf("readiness = %+v, want degraded but failover-capable", group.FailoverReadiness)
	}
	if len(group.FailoverReadiness.WarningReasons) != 2 {
		t.Fatalf("warning reasons = %+v, want RPO and legal-hold warnings", group.FailoverReadiness.WarningReasons)
	}
}

func TestBuildPostureAddsAttentionForBlockedFailoverReadiness(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	groupID := uuid.New()
	siteID := uuid.New()
	streamID := uuid.New()
	pointID := uuid.New()
	ratio := 0.5
	reader := fakeReader{
		sites: []*model.ProtectedSite{
			{ID: siteID.String(), TenantID: tenantID.String(), Name: "Ledger", Kind: model.SiteKindDatabase, RPOObjectiveSeconds: 120, RTOObjectiveSeconds: 600},
		},
		groups: []*model.ConsistencyGroup{
			{ID: groupID.String(), TenantID: tenantID.String(), Name: "Ledger"},
		},
		members: map[string][]model.ConsistencyGroupMember{
			groupID.String(): {{GroupID: groupID.String(), SiteID: siteID.String(), BootOrder: 10}},
		},
		streams: []*model.ReplicationStream{
			{ID: streamID.String(), TenantID: tenantID.String(), SiteID: siteID.String(), Status: model.StreamStatusSeeding},
		},
		points: map[string][]*model.RecoveryPoint{
			groupID.String(): {
				{ID: pointID.String(), TenantID: tenantID.String(), GroupID: groupID.String(), MarkerLSN: "0/bad", ValidationRatio: &ratio, IsValidated: false, LegalHold: false, SealedAt: now.Add(-time.Minute), RetentionUntil: now.Add(time.Hour)},
			},
		},
	}

	posture, err := readmodel.BuildPosture(context.Background(), reader, tenantID, now)
	if err != nil {
		t.Fatalf("BuildPosture: %v", err)
	}
	if len(posture.Groups) != 1 || posture.Groups[0].FailoverReadiness.Status != "blocked" || posture.Groups[0].FailoverReadiness.CanFailover {
		t.Fatalf("group readiness = %+v, want blocked", posture.Groups)
	}
	found := false
	for _, item := range posture.Attention {
		if item.Kind == "failover_readiness" && item.ResourceID == groupID.String() {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("attention = %+v, want failover_readiness item", posture.Attention)
	}
}

func ptrTime(t time.Time) *time.Time {
	return &t
}
