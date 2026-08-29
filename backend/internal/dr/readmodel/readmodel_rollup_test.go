package readmodel_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/readmodel"
)

type rollupReader struct {
	sites   []*model.ProtectedSite
	groups  []*model.ConsistencyGroup
	members map[string][]model.ConsistencyGroupMember
	streams []*model.ReplicationStream
	points  map[string][]*model.RecoveryPoint
	runs    []*model.FailoverRun
}

func (r rollupReader) ListSites(context.Context, uuid.UUID) ([]*model.ProtectedSite, error) {
	return r.sites, nil
}

func (r rollupReader) GetGroup(_ context.Context, _ uuid.UUID, groupID uuid.UUID) (*model.ConsistencyGroup, error) {
	for _, group := range r.groups {
		if group.ID == groupID.String() {
			return group, nil
		}
	}
	return nil, model.ErrNotFound
}

func (r rollupReader) ListGroups(context.Context, uuid.UUID) ([]*model.ConsistencyGroup, error) {
	return r.groups, nil
}

func (r rollupReader) ListGroupMembers(_ context.Context, _ uuid.UUID, groupID uuid.UUID) ([]model.ConsistencyGroupMember, error) {
	return r.members[groupID.String()], nil
}

func (r rollupReader) ListStreams(context.Context, uuid.UUID) ([]*model.ReplicationStream, error) {
	return r.streams, nil
}

func (r rollupReader) ListRecoveryPoints(_ context.Context, _ uuid.UUID, groupID uuid.UUID) ([]*model.RecoveryPoint, error) {
	return r.points[groupID.String()], nil
}

func (r rollupReader) ListFailoverRuns(context.Context, uuid.UUID) ([]*model.FailoverRun, error) {
	return r.runs, nil
}

func TestRollupEmptyTenantSummariesReportEmptyHealth(t *testing.T) {
	t.Parallel()
	now := rollupNow()
	tenantID := rollupID(100)
	reader := rollupReader{}

	posture, err := readmodel.BuildPosture(context.Background(), reader, tenantID, now)
	if err != nil {
		t.Fatalf("BuildPosture: %v", err)
	}
	if posture.OverallHealth != "empty" {
		t.Fatalf("posture overall health = %q, want empty", posture.OverallHealth)
	}
	if posture.SiteCount != 0 || posture.GroupCount != 0 || posture.StreamCount != 0 || posture.RecoveryPointCount != 0 {
		t.Fatalf("posture counts = sites:%d groups:%d streams:%d points:%d, want all zero", posture.SiteCount, posture.GroupCount, posture.StreamCount, posture.RecoveryPointCount)
	}
	if posture.WorstLiveRPO != nil || len(posture.RPOBreaches) != 0 || len(posture.Attention) != 0 || len(posture.Groups) != 0 || len(posture.RecentRuns) != 0 {
		t.Fatalf("posture rollups = %+v, want empty collections and no worst RPO", posture)
	}

	replication, err := readmodel.BuildReplicationSummary(context.Background(), reader, tenantID, now)
	if err != nil {
		t.Fatalf("BuildReplicationSummary: %v", err)
	}
	if replication.OverallHealth != "empty" {
		t.Fatalf("replication overall health = %q, want empty", replication.OverallHealth)
	}
	if replication.TotalStreams != 0 || replication.WorstLiveRPO != nil || len(replication.RPOBreaches) != 0 || len(replication.Streams) != 0 {
		t.Fatalf("replication summary = %+v, want no stream data", replication)
	}
}

func TestBuildPostureLimitsAttentionBySeverityDeterministically(t *testing.T) {
	t.Parallel()
	now := rollupNow()
	tenantID := rollupID(200)
	groupID := rollupID(201)
	errorSiteID := rollupID(202)
	errorStreamID := rollupID(203)
	lastError := "apply failed"

	sites := []*model.ProtectedSite{
		{ID: errorSiteID.String(), TenantID: tenantID.String(), Name: "Critical DB", Kind: model.SiteKindDatabase, RPOObjectiveSeconds: 60},
	}
	streams := []*model.ReplicationStream{
		{ID: errorStreamID.String(), TenantID: tenantID.String(), SiteID: errorSiteID.String(), Status: model.StreamStatusError, LastError: &lastError},
	}
	breachStreamIDs := make([]string, 0, 12)
	for i := 0; i < 12; i++ {
		siteID := rollupID(300 + i)
		streamID := rollupID(400 + i)
		appliedAt := now.Add(-10*time.Minute - time.Duration(i)*time.Second)
		sites = append(sites, &model.ProtectedSite{
			ID:                  siteID.String(),
			TenantID:            tenantID.String(),
			Name:                fmt.Sprintf("Breach %02d", i),
			Kind:                model.SiteKindVM,
			RPOObjectiveSeconds: 60,
		})
		streams = append(streams, &model.ReplicationStream{
			ID:        streamID.String(),
			TenantID:  tenantID.String(),
			SiteID:    siteID.String(),
			Status:    model.StreamStatusStreaming,
			AppliedAt: &appliedAt,
		})
		breachStreamIDs = append(breachStreamIDs, streamID.String())
	}
	reader := rollupReader{
		sites:   sites,
		groups:  []*model.ConsistencyGroup{{ID: groupID.String(), TenantID: tenantID.String(), Name: "Unconfigured Group"}},
		streams: streams,
	}

	posture, err := readmodel.BuildPosture(context.Background(), reader, tenantID, now)
	if err != nil {
		t.Fatalf("BuildPosture: %v", err)
	}
	if len(posture.Attention) != 10 {
		t.Fatalf("attention length = %d, want limit of 10: %+v", len(posture.Attention), posture.Attention)
	}
	if got := posture.Attention[0]; got.Severity != "critical" || got.Kind != "stream_error" || got.ResourceID != errorStreamID.String() {
		t.Fatalf("attention[0] = %+v, want critical stream_error for %s", got, errorStreamID)
	}
	if got := posture.Attention[1]; got.Severity != "critical" || got.Kind != "failover_readiness" || got.ResourceID != groupID.String() {
		t.Fatalf("attention[1] = %+v, want critical failover_readiness for %s", got, groupID)
	}
	for i := 2; i < len(posture.Attention); i++ {
		wantStreamID := breachStreamIDs[i-2]
		if got := posture.Attention[i]; got.Severity != "warning" || got.Kind != "rpo_breach" || got.ResourceID != wantStreamID {
			t.Fatalf("attention[%d] = %+v, want warning rpo_breach for %s", i, got, wantStreamID)
		}
	}
}

func TestBuildGroupSummarySelectsLatestRecoveryPointBySealedAtThenID(t *testing.T) {
	t.Parallel()
	now := rollupNow()
	tenantID := rollupID(500)
	groupID := rollupID(501)
	siteID := rollupID(502)
	streamID := rollupID(503)
	latestLowID := rollupID(504)
	latestHighID := rollupID(505)
	olderHigherID := rollupID(999)
	appliedAt := now.Add(-20 * time.Second)
	latestSealedAt := now.Add(-time.Minute)

	reader := rollupReader{
		sites: []*model.ProtectedSite{
			{ID: siteID.String(), TenantID: tenantID.String(), Name: "Orders", Kind: model.SiteKindDatabase, RPOObjectiveSeconds: 120},
		},
		groups: []*model.ConsistencyGroup{{ID: groupID.String(), TenantID: tenantID.String(), Name: "Orders"}},
		members: map[string][]model.ConsistencyGroupMember{
			groupID.String(): {{GroupID: groupID.String(), SiteID: siteID.String(), BootOrder: 10}},
		},
		streams: []*model.ReplicationStream{
			{ID: streamID.String(), TenantID: tenantID.String(), SiteID: siteID.String(), Status: model.StreamStatusStreaming, AppliedAt: &appliedAt},
		},
		points: map[string][]*model.RecoveryPoint{
			groupID.String(): {
				rollupValidatedPoint(tenantID, groupID, olderHigherID, latestSealedAt.Add(-time.Minute), now.Add(time.Hour)),
				rollupValidatedPoint(tenantID, groupID, latestLowID, latestSealedAt, now.Add(time.Hour)),
				rollupValidatedPoint(tenantID, groupID, latestHighID, latestSealedAt, now.Add(time.Hour)),
			},
		},
	}

	group, err := readmodel.BuildGroupSummary(context.Background(), reader, tenantID, groupID, now)
	if err != nil {
		t.Fatalf("BuildGroupSummary: %v", err)
	}
	if group.LatestRecoveryPoint == nil {
		t.Fatal("latest recovery point = nil, want selected point")
	}
	if group.LatestRecoveryPoint.ID != latestHighID.String() {
		t.Fatalf("latest recovery point ID = %s, want %s", group.LatestRecoveryPoint.ID, latestHighID)
	}
	if !group.LatestRecoveryPoint.SealedAt.Equal(latestSealedAt) {
		t.Fatalf("latest recovery point sealed_at = %s, want %s", group.LatestRecoveryPoint.SealedAt, latestSealedAt)
	}
}

func TestBuildGroupSummaryBlocksReadinessForActiveFailoverRun(t *testing.T) {
	t.Parallel()
	now := rollupNow()
	tenantID := rollupID(600)
	groupID := rollupID(601)
	siteID := rollupID(602)
	streamID := rollupID(603)
	pointID := rollupID(604)
	runID := rollupID(605)
	reader := rollupReadyGroupReader(tenantID, groupID, siteID, streamID, pointID, now)
	reader.runs = []*model.FailoverRun{
		{ID: runID.String(), TenantID: tenantID.String(), GroupID: groupID.String(), Mode: model.ModeReal, Status: model.StatusExecuting, RTOObjectiveSeconds: 600, InitiatedAt: now.Add(-2 * time.Minute)},
	}

	group, err := readmodel.BuildGroupSummary(context.Background(), reader, tenantID, groupID, now)
	if err != nil {
		t.Fatalf("BuildGroupSummary: %v", err)
	}
	readiness := group.FailoverReadiness
	if readiness.Status != "in_progress" || readiness.CanFailover {
		t.Fatalf("readiness = %+v, want in_progress and not failover-capable", readiness)
	}
	if readiness.ActiveRun == nil || readiness.ActiveRun.RunID != runID.String() {
		t.Fatalf("active run = %+v, want %s", readiness.ActiveRun, runID)
	}
	wantReason := fmt.Sprintf("عملية تجاوز الفشل %s في الحالة %s", runID.String(), model.StatusExecuting)
	if len(readiness.BlockingReasons) != 1 || readiness.BlockingReasons[0] != wantReason {
		t.Fatalf("blocking reasons = %+v, want [%q]", readiness.BlockingReasons, wantReason)
	}
}

func TestBuildGroupSummaryBlocksReadinessForMissingMemberStream(t *testing.T) {
	t.Parallel()
	now := rollupNow()
	tenantID := rollupID(700)
	groupID := rollupID(701)
	siteAID := rollupID(702)
	siteBID := rollupID(703)
	streamID := rollupID(704)
	pointID := rollupID(705)
	appliedAt := now.Add(-20 * time.Second)
	reader := rollupReader{
		sites: []*model.ProtectedSite{
			{ID: siteAID.String(), TenantID: tenantID.String(), Name: "Ledger DB", Kind: model.SiteKindDatabase, RPOObjectiveSeconds: 120},
			{ID: siteBID.String(), TenantID: tenantID.String(), Name: "Ledger API", Kind: model.SiteKindVM, RPOObjectiveSeconds: 120},
		},
		groups: []*model.ConsistencyGroup{{ID: groupID.String(), TenantID: tenantID.String(), Name: "Ledger"}},
		members: map[string][]model.ConsistencyGroupMember{
			groupID.String(): {
				{GroupID: groupID.String(), SiteID: siteAID.String(), BootOrder: 10},
				{GroupID: groupID.String(), SiteID: siteBID.String(), BootOrder: 20},
			},
		},
		streams: []*model.ReplicationStream{
			{ID: streamID.String(), TenantID: tenantID.String(), SiteID: siteAID.String(), Status: model.StreamStatusStreaming, AppliedAt: &appliedAt},
		},
		points: map[string][]*model.RecoveryPoint{
			groupID.String(): {rollupValidatedPoint(tenantID, groupID, pointID, now.Add(-time.Minute), now.Add(time.Hour))},
		},
	}

	group, err := readmodel.BuildGroupSummary(context.Background(), reader, tenantID, groupID, now)
	if err != nil {
		t.Fatalf("BuildGroupSummary: %v", err)
	}
	if group.FailoverReadiness.Status != "blocked" || group.FailoverReadiness.CanFailover {
		t.Fatalf("readiness = %+v, want blocked and not failover-capable", group.FailoverReadiness)
	}
	if !rollupContains(group.FailoverReadiness.BlockingReasons, "عضو واحد أو أكثر بلا بثّ نسخ متماثل") {
		t.Fatalf("blocking reasons = %+v, want missing-stream reason", group.FailoverReadiness.BlockingReasons)
	}
}

func TestBuildReplicationSummaryRanksPausedErrorSeedingHealth(t *testing.T) {
	t.Parallel()
	now := rollupNow()
	tenantID := rollupID(800)
	tests := []struct {
		name         string
		statuses     []string
		wantOverall  string
		wantByStatus map[string]string
	}{
		{
			name:         "seeding only",
			statuses:     []string{model.StreamStatusSeeding},
			wantOverall:  "seeding",
			wantByStatus: map[string]string{model.StreamStatusSeeding: "seeding"},
		},
		{
			name:         "paused outranks seeding",
			statuses:     []string{model.StreamStatusSeeding, model.StreamStatusPaused},
			wantOverall:  "paused",
			wantByStatus: map[string]string{model.StreamStatusSeeding: "seeding", model.StreamStatusPaused: "paused"},
		},
		{
			name:         "error outranks paused and seeding",
			statuses:     []string{model.StreamStatusSeeding, model.StreamStatusPaused, model.StreamStatusError},
			wantOverall:  "critical",
			wantByStatus: map[string]string{model.StreamStatusSeeding: "seeding", model.StreamStatusPaused: "paused", model.StreamStatusError: "critical"},
		},
	}

	for i, tt := range tests {
		tt := tt
		i := i
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			streams := make([]*model.ReplicationStream, 0, len(tt.statuses))
			for j, status := range tt.statuses {
				streams = append(streams, &model.ReplicationStream{
					ID:       rollupID(810 + i*10 + j).String(),
					TenantID: tenantID.String(),
					SiteID:   rollupID(850 + i*10 + j).String(),
					Status:   status,
				})
			}
			summary, err := readmodel.BuildReplicationSummary(context.Background(), rollupReader{streams: streams}, tenantID, now)
			if err != nil {
				t.Fatalf("BuildReplicationSummary: %v", err)
			}
			if summary.OverallHealth != tt.wantOverall {
				t.Fatalf("overall health = %q, want %q", summary.OverallHealth, tt.wantOverall)
			}
			for _, stream := range summary.Streams {
				if want := tt.wantByStatus[stream.Status]; stream.Health != want {
					t.Fatalf("stream %s health = %q, want %q for status %q", stream.StreamID, stream.Health, want, stream.Status)
				}
			}
		})
	}
}

func rollupReadyGroupReader(tenantID, groupID, siteID, streamID, pointID uuid.UUID, now time.Time) rollupReader {
	appliedAt := now.Add(-20 * time.Second)
	return rollupReader{
		sites: []*model.ProtectedSite{
			{ID: siteID.String(), TenantID: tenantID.String(), Name: "Payments", Kind: model.SiteKindDatabase, RPOObjectiveSeconds: 120, RTOObjectiveSeconds: 600},
		},
		groups: []*model.ConsistencyGroup{{ID: groupID.String(), TenantID: tenantID.String(), Name: "Payments"}},
		members: map[string][]model.ConsistencyGroupMember{
			groupID.String(): {{GroupID: groupID.String(), SiteID: siteID.String(), BootOrder: 10}},
		},
		streams: []*model.ReplicationStream{
			{ID: streamID.String(), TenantID: tenantID.String(), SiteID: siteID.String(), Status: model.StreamStatusStreaming, AppliedAt: &appliedAt},
		},
		points: map[string][]*model.RecoveryPoint{
			groupID.String(): {rollupValidatedPoint(tenantID, groupID, pointID, now.Add(-time.Minute), now.Add(time.Hour))},
		},
	}
}

func rollupValidatedPoint(tenantID, groupID, pointID uuid.UUID, sealedAt, retentionUntil time.Time) *model.RecoveryPoint {
	ratio := 1.0
	return &model.RecoveryPoint{
		ID:              pointID.String(),
		TenantID:        tenantID.String(),
		GroupID:         groupID.String(),
		MarkerLSN:       fmt.Sprintf("0/%s", pointID.String()[24:]),
		RPOSeconds:      20,
		ValidationRatio: &ratio,
		IsValidated:     true,
		LegalHold:       true,
		ContentHash:     fmt.Sprintf("sha256:%s", pointID.String()[24:]),
		SealedAt:        sealedAt,
		RetentionUntil:  retentionUntil,
	}
}

func rollupNow() time.Time {
	return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
}

func rollupID(n int) uuid.UUID {
	return uuid.MustParse(fmt.Sprintf("00000000-0000-0000-0000-%012d", n))
}

func rollupContains(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}
