package rpo

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	drmetrics "github.com/clario360/platform/internal/dr/metrics"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/prometheus/client_golang/prometheus"
	io_prometheus_client "github.com/prometheus/client_model/go"
)

const (
	testTenantID = "aaaaaaaa-0000-0000-0000-000000000001"
	testSiteID   = "bbbbbbbb-0000-0000-0000-000000000001"
	testStreamID = "cccccccc-0000-0000-0000-000000000001"
)

func TestMonitorRunOnce_NoAppliedCheckpointBeyondObjectiveMarksError(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	stream := monitorSnapshot(now, model.StreamStatusStreaming, nil, 60)
	stream.CreatedAt = now.Add(-61 * time.Second)
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}
	sink := &fakeSink{}

	result, err := testMonitor(repo, sink, now).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	if result.Checked != 1 || result.Breached != 1 || result.Recovered != 0 || len(result.Events) != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(repo.updates) != 1 {
		t.Fatalf("updates = %d, want 1", len(repo.updates))
	}
	update := repo.updates[0]
	if update.nextStatus != model.StreamStatusError {
		t.Fatalf("next status = %q, want %q", update.nextStatus, model.StreamStatusError)
	}
	if update.lastError == nil || *update.lastError == "" {
		t.Fatalf("lastError should be populated for no-checkpoint breach")
	}

	payload := decodePayload(t, result.Events[0])
	if result.Events[0].Type != EventTypeRPOBreached {
		t.Fatalf("event type = %q, want %q", result.Events[0].Type, EventTypeRPOBreached)
	}
	if payload.Reason != "no_applied_checkpoint" {
		t.Fatalf("reason = %q", payload.Reason)
	}
	if payload.NoCheckpointSeconds == nil || *payload.NoCheckpointSeconds != 61 {
		t.Fatalf("no checkpoint seconds = %v, want 61", payload.NoCheckpointSeconds)
	}
	if payload.LiveRPOSeconds != nil {
		t.Fatalf("live RPO should be omitted when no checkpoint exists")
	}
	if len(sink.events) != 1 || sink.events[0].topic != events.Topics.DRAlerts {
		t.Fatalf("sink events = %+v", sink.events)
	}
}

func TestMonitorRunOnce_WithinSLOLeavesStreamUnchanged(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-30 * time.Second)
	stream := monitorSnapshot(now, model.StreamStatusStreaming, &appliedAt, 60)
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}

	result, err := testMonitor(repo, &fakeSink{}, now).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	if result.Checked != 1 || result.Unchanged != 1 || len(result.Events) != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(repo.updates) != 0 {
		t.Fatalf("updates = %d, want 0", len(repo.updates))
	}
}

func TestMonitorRunOnce_EmitsSLOMetrics(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-30 * time.Second)
	stream := monitorSnapshot(now, model.StreamStatusStreaming, &appliedAt, 60)
	stream.GroupName = "tier-0"
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}
	reg := prometheus.NewRegistry()
	metrics := drmetrics.New(reg)

	result, err := NewMonitor(nil, repo, &fakeSink{}, Config{
		Now:     func() time.Time { return now },
		Metrics: metrics,
	}).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if result.Checked != 1 {
		t.Fatalf("checked = %d, want 1", result.Checked)
	}

	if got := gatherGauge(t, reg, "dr_rpo_seconds", map[string]string{"group": "tier-0"}); got != 30 {
		t.Fatalf("dr_rpo_seconds = %v, want 30", got)
	}
	if got := gatherGauge(t, reg, "dr_stream_status", map[string]string{"stream": testStreamID, "status": model.StreamStatusStreaming}); got != 1 {
		t.Fatalf("streaming status gauge = %v, want 1", got)
	}
	if got := gatherGauge(t, reg, "dr_stream_status", map[string]string{"stream": testStreamID, "status": model.StreamStatusDegraded}); got != 0 {
		t.Fatalf("degraded status gauge = %v, want 0", got)
	}
	if missing := findGauge(t, reg, "dr_stream_status", map[string]string{"stream": "prod-db", "status": model.StreamStatusStreaming}); missing != nil {
		t.Fatalf("dr_stream_status used site name as stream label: %v", missing.GetGauge().GetValue())
	}
}

func TestMonitorRunOnce_EmitsSourceLagRPOWhenSourceTimestampPresent(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-30 * time.Second)
	// The change committed at the source 90s before it was applied on the
	// target: apply-side RPO is 30s but the true source-to-target lag is 90s.
	sourceAt := appliedAt.Add(-90 * time.Second)
	stream := monitorSnapshot(now, model.StreamStatusStreaming, &appliedAt, 300)
	stream.GroupName = "tier-0"
	stream.SourceCommittedAt = &sourceAt
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}
	reg := prometheus.NewRegistry()
	metrics := drmetrics.New(reg)

	if _, err := NewMonitor(nil, repo, &fakeSink{}, Config{
		Now:     func() time.Time { return now },
		Metrics: metrics,
	}).RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	if got := gatherGauge(t, reg, "dr_rpo_seconds", map[string]string{"group": "tier-0"}); got != 30 {
		t.Fatalf("apply-side dr_rpo_seconds = %v, want 30", got)
	}
	if got := gatherGauge(t, reg, "dr_rpo_seconds", map[string]string{"group": "tier-0" + sourceLagGroupSuffix}); got != 90 {
		t.Fatalf("source-lag dr_rpo_seconds = %v, want 90", got)
	}
}

func TestMonitorRunOnce_OmitsSourceLagRPOForLegacyRows(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-30 * time.Second)
	stream := monitorSnapshot(now, model.StreamStatusStreaming, &appliedAt, 300)
	stream.GroupName = "tier-0"
	stream.SourceCommittedAt = nil // legacy row: no source commit timestamp
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}
	reg := prometheus.NewRegistry()
	metrics := drmetrics.New(reg)

	if _, err := NewMonitor(nil, repo, &fakeSink{}, Config{
		Now:     func() time.Time { return now },
		Metrics: metrics,
	}).RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	// Apply-side RPO still published; no false source-lag series for legacy rows.
	if got := gatherGauge(t, reg, "dr_rpo_seconds", map[string]string{"group": "tier-0"}); got != 30 {
		t.Fatalf("apply-side dr_rpo_seconds = %v, want 30", got)
	}
	if series := findGauge(t, reg, "dr_rpo_seconds", map[string]string{"group": "tier-0" + sourceLagGroupSuffix}); series != nil {
		t.Fatalf("source-lag series should be absent for legacy row, got %v", series.GetGauge().GetValue())
	}
}

func TestMonitorRunOnce_BreachEventCarriesSourceLagSeconds(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-90 * time.Second)
	sourceAt := appliedAt.Add(-120 * time.Second)
	// live RPO 90s > 60s objective -> breach; source lag is 120s and rides along.
	stream := monitorSnapshot(now, model.StreamStatusStreaming, &appliedAt, 60)
	stream.SourceCommittedAt = &sourceAt
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}
	sink := &fakeSink{}

	result, err := testMonitor(repo, sink, now).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if result.Breached != 1 || len(result.Events) != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}

	payload := decodePayload(t, result.Events[0])
	if payload.LiveRPOSeconds == nil || *payload.LiveRPOSeconds != 90 {
		t.Fatalf("live RPO seconds = %v, want 90", payload.LiveRPOSeconds)
	}
	if payload.SourceLagSeconds == nil || *payload.SourceLagSeconds != 120 {
		t.Fatalf("source lag seconds = %v, want 120", payload.SourceLagSeconds)
	}
}

func TestMonitorRunOnce_RPOBreachMarksDegradedAndStagesAlert(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-61 * time.Second)
	stream := monitorSnapshot(now, model.StreamStatusStreaming, &appliedAt, 60)
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}

	result, err := testMonitor(repo, &fakeSink{}, now).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	if result.Breached != 1 || len(result.Events) != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if repo.updates[0].expectedStatus != model.StreamStatusStreaming || repo.updates[0].nextStatus != model.StreamStatusDegraded {
		t.Fatalf("update = %+v", repo.updates[0])
	}

	payload := decodePayload(t, result.Events[0])
	if result.Events[0].Type != EventTypeRPOBreached {
		t.Fatalf("event type = %q", result.Events[0].Type)
	}
	if payload.LiveRPOSeconds == nil || *payload.LiveRPOSeconds != 61 {
		t.Fatalf("live RPO seconds = %v, want 61", payload.LiveRPOSeconds)
	}
	if payload.RPOObjectiveSeconds != 60 {
		t.Fatalf("objective = %d, want 60", payload.RPOObjectiveSeconds)
	}
}

func TestMonitorRunOnce_RecoveryReturnsStreamToStreaming(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-10 * time.Second)
	stream := monitorSnapshot(now, model.StreamStatusDegraded, &appliedAt, 60)
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}

	result, err := testMonitor(repo, &fakeSink{}, now).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	if result.Recovered != 1 || len(result.Events) != 1 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if repo.updates[0].expectedStatus != model.StreamStatusDegraded || repo.updates[0].nextStatus != model.StreamStatusStreaming {
		t.Fatalf("update = %+v", repo.updates[0])
	}
	if repo.updates[0].lastError != nil {
		t.Fatalf("lastError should be cleared on recovery")
	}

	payload := decodePayload(t, result.Events[0])
	if result.Events[0].Type != EventTypeRPORecovered {
		t.Fatalf("event type = %q", result.Events[0].Type)
	}
	if payload.Reason != "within_rpo_objective" {
		t.Fatalf("reason = %q", payload.Reason)
	}
	if payload.Status != model.StreamStatusStreaming {
		t.Fatalf("payload status = %q", payload.Status)
	}
}

func TestMonitorRunOnce_IdempotentWhenAlreadyBreached(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-90 * time.Second)
	stream := monitorSnapshot(now, model.StreamStatusDegraded, &appliedAt, 60)
	repo := &fakeRepo{streams: []*model.StreamMonitorSnapshot{stream}}
	sink := &fakeSink{}

	result, err := testMonitor(repo, sink, now).RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}

	if result.Checked != 1 || result.Unchanged != 1 || result.Breached != 0 || len(result.Events) != 0 {
		t.Fatalf("unexpected result: %+v", result)
	}
	if len(repo.updates) != 0 {
		t.Fatalf("updates = %d, want 0", len(repo.updates))
	}
	if len(sink.events) != 0 {
		t.Fatalf("sink events = %d, want 0", len(sink.events))
	}
}

func TestMonitorRunOnce_TwoInstancesStageSingleRPOBreach(t *testing.T) {
	t.Parallel()
	now := fixedTime()
	appliedAt := now.Add(-90 * time.Second)
	staleStream := monitorSnapshot(now, model.StreamStatusStreaming, &appliedAt, 60)
	repo := &staleReadGuardRepo{
		listed:          staleStream,
		canonicalStatus: model.StreamStatusStreaming,
	}
	sinkA := &fakeSink{}
	sinkB := &fakeSink{}
	monitorA := NewMonitor(nil, repo, sinkA, Config{Now: func() time.Time { return now }})
	monitorB := NewMonitor(nil, repo, sinkB, Config{Now: func() time.Time { return now }})

	resultA, err := monitorA.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("first RunOnce: %v", err)
	}
	resultB, err := monitorB.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("second RunOnce: %v", err)
	}

	if resultA.Breached != 1 || len(resultA.Events) != 1 {
		t.Fatalf("first result = %+v, want one breach event", resultA)
	}
	if resultB.Checked != 1 || resultB.Unchanged != 1 || resultB.Breached != 0 || len(resultB.Events) != 0 {
		t.Fatalf("second result = %+v, want stale scan suppressed by guarded update", resultB)
	}
	if got := len(sinkA.events) + len(sinkB.events); got != 1 {
		t.Fatalf("staged events = %d, want exactly one", got)
	}
	if len(repo.updates) != 2 {
		t.Fatalf("updates = %d, want two guarded attempts", len(repo.updates))
	}
	if repo.updates[0].changed != true || repo.updates[1].changed != false {
		t.Fatalf("update changed flags = %+v", repo.updates)
	}
	if repo.canonicalStatus != model.StreamStatusDegraded {
		t.Fatalf("canonical status = %q, want %q", repo.canonicalStatus, model.StreamStatusDegraded)
	}
}

func fixedTime() time.Time {
	return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
}

func monitorSnapshot(now time.Time, status string, appliedAt *time.Time, objectiveSeconds int) *model.StreamMonitorSnapshot {
	return &model.StreamMonitorSnapshot{
		ReplicationStream: model.ReplicationStream{
			ID:         testStreamID,
			TenantID:   testTenantID,
			SiteID:     testSiteID,
			Status:     status,
			AppliedSeq: 42,
			AppliedAt:  appliedAt,
			CreatedAt:  now.Add(-5 * time.Minute),
			UpdatedAt:  now.Add(-10 * time.Second),
		},
		SiteName:            "prod-db",
		SiteKind:            model.SiteKindDatabase,
		RPOObjectiveSeconds: objectiveSeconds,
		GroupName:           "prod-db",
	}
}

func testMonitor(repo *fakeRepo, sink *fakeSink, now time.Time) *Monitor {
	return NewMonitor(nil, repo, sink, Config{
		Now: func() time.Time { return now },
	})
}

func decodePayload(t *testing.T, event *events.Event) EventPayload {
	t.Helper()
	var payload EventPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	return payload
}

type fakeRepo struct {
	streams []*model.StreamMonitorSnapshot
	updates []streamUpdate
}

func (f *fakeRepo) SystemListStreamsForMonitor(context.Context, repository.DBTX) ([]*model.StreamMonitorSnapshot, error) {
	return f.streams, nil
}

func (f *fakeRepo) SystemUpdateStreamStatusForMonitor(_ context.Context, _ repository.DBTX, tenantID, id, expectedStatus, status string, lastError *string) (bool, error) {
	f.updates = append(f.updates, streamUpdate{
		tenantID:       tenantID,
		streamID:       id,
		expectedStatus: expectedStatus,
		nextStatus:     status,
		lastError:      lastError,
	})
	for _, stream := range f.streams {
		if stream.TenantID == tenantID && stream.ID == id {
			if stream.Status != expectedStatus {
				return false, nil
			}
			stream.Status = status
			stream.LastError = lastError
			return true, nil
		}
	}
	return false, nil
}

type streamUpdate struct {
	tenantID       string
	streamID       string
	expectedStatus string
	nextStatus     string
	lastError      *string
	changed        bool
}

type staleReadGuardRepo struct {
	listed          *model.StreamMonitorSnapshot
	canonicalStatus string
	updates         []streamUpdate
}

func (f *staleReadGuardRepo) SystemListStreamsForMonitor(context.Context, repository.DBTX) ([]*model.StreamMonitorSnapshot, error) {
	return []*model.StreamMonitorSnapshot{cloneMonitorSnapshot(f.listed)}, nil
}

func (f *staleReadGuardRepo) SystemUpdateStreamStatusForMonitor(_ context.Context, _ repository.DBTX, tenantID, id, expectedStatus, status string, lastError *string) (bool, error) {
	changed := f.canonicalStatus == expectedStatus
	f.updates = append(f.updates, streamUpdate{
		tenantID:       tenantID,
		streamID:       id,
		expectedStatus: expectedStatus,
		nextStatus:     status,
		lastError:      lastError,
		changed:        changed,
	})
	if !changed {
		return false, nil
	}
	f.canonicalStatus = status
	return true, nil
}

func cloneMonitorSnapshot(in *model.StreamMonitorSnapshot) *model.StreamMonitorSnapshot {
	if in == nil {
		return nil
	}
	out := *in
	if in.SourceLSN != nil {
		sourceLSN := *in.SourceLSN
		out.SourceLSN = &sourceLSN
	}
	if in.AppliedAt != nil {
		appliedAt := *in.AppliedAt
		out.AppliedAt = &appliedAt
	}
	if in.SourceCommittedAt != nil {
		sourceCommittedAt := *in.SourceCommittedAt
		out.SourceCommittedAt = &sourceCommittedAt
	}
	if in.LastError != nil {
		lastError := *in.LastError
		out.LastError = &lastError
	}
	return &out
}

type fakeSink struct {
	events []stagedEvent
}

func (f *fakeSink) Stage(_ context.Context, _ repository.DBTX, topic string, event *events.Event) error {
	f.events = append(f.events, stagedEvent{topic: topic, event: event})
	return nil
}

type stagedEvent struct {
	topic string
	event *events.Event
}

func gatherGauge(t *testing.T, reg *prometheus.Registry, name string, labels map[string]string) float64 {
	t.Helper()
	metric := findGauge(t, reg, name, labels)
	if metric == nil {
		t.Fatalf("metric %s%v not found", name, labels)
	}
	if metric.GetGauge() == nil {
		t.Fatalf("metric %s%v is not a gauge", name, labels)
	}
	return metric.GetGauge().GetValue()
}

func findGauge(t *testing.T, reg *prometheus.Registry, name string, labels map[string]string) *io_prometheus_client.Metric {
	t.Helper()
	families, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather metrics: %v", err)
	}
	for _, family := range families {
		if family.GetName() != name {
			continue
		}
		for _, metric := range family.GetMetric() {
			if labelsMatch(metric, labels) {
				return metric
			}
		}
	}
	return nil
}

func labelsMatch(metric *io_prometheus_client.Metric, want map[string]string) bool {
	if len(metric.GetLabel()) != len(want) {
		return false
	}
	for _, label := range metric.GetLabel() {
		if want[label.GetName()] != label.GetValue() {
			return false
		}
	}
	return true
}
