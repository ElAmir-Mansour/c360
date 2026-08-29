package consumer

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/visus/model"
)

// newDRConsumerForTest builds a VisusConsumer wired with the three seeded DR
// KPIs (matching kpi/defaults.go) plus in-memory fakes, so the DR handlers
// exercise the real updateKPIByName / createExecutiveAlert paths — not mocks
// of those methods.
func newDRConsumerForTest(t *testing.T) (*VisusConsumer, *fakeExecutiveAlertCreator, *fakeKPIStore, *fakeSnapshotStore, string) {
	t.Helper()

	alerts := &fakeExecutiveAlertCreator{}
	kpis := &fakeKPIStore{items: []model.KPIDefinition{
		{
			ID:                uuid.New(),
			Name:              kpiDRRecoveryPointObjective,
			Direction:         model.KPIDirectionLowerIsBetter,
			WarningThreshold:  ptrFloat(4), // 240s -> 4 min
			CriticalThreshold: ptrFloat(5), // 300s -> 5 min
		},
		{
			ID:                uuid.New(),
			Name:              kpiDRRecoveryValidation,
			Direction:         model.KPIDirectionHigherIsBetter,
			WarningThreshold:  ptrFloat(99.9),
			CriticalThreshold: ptrFloat(99),
		},
		{
			ID:                uuid.New(),
			Name:              kpiDRFailoverRecoveryTime,
			Direction:         model.KPIDirectionLowerIsBetter,
			WarningThreshold:  ptrFloat(15),
			CriticalThreshold: ptrFloat(30),
		},
	}}
	snapshots := &fakeSnapshotStore{latest: map[uuid.UUID]*model.KPISnapshot{}}

	consumer := NewVisusConsumer(zerolog.New(nil))
	consumer.alerts = alerts
	consumer.kpis = kpis
	consumer.snapshots = snapshots
	consumer.now = func() time.Time { return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC) }

	return consumer, alerts, kpis, snapshots, uuid.NewString()
}

func latestSnapshotByName(t *testing.T, kpis *fakeKPIStore, snapshots *fakeSnapshotStore, name string) *model.KPISnapshot {
	t.Helper()
	for _, def := range kpis.items {
		if def.Name == name {
			if snap, ok := snapshots.latest[def.ID]; ok {
				return snap
			}
		}
	}
	return nil
}

func TestDREventTypes_RegisteredInDispatcher(t *testing.T) {
	consumer := NewVisusConsumer(zerolog.New(nil))
	types := consumer.EventTypes()
	want := map[string]bool{
		drEventGate1Passed:       false,
		drEventAttestationIssued: false,
		drEventFailoverFailed:    false,
		drEventRecoveryPointSeal: false,
		drEventRecoveryPointVal:  false,
		drEventRPOBreached:       false,
		drEventRPORecovered:      false,
	}
	for _, ty := range types {
		if _, ok := want[ty]; ok {
			want[ty] = true
		}
	}
	for ty, seen := range want {
		if !seen {
			t.Errorf("DR event type %q not advertised by EventTypes()", ty)
		}
	}
}

func TestDRGate1Passed_UpdatesRPOAndValidationKPIs(t *testing.T) {
	consumer, alerts, kpis, snapshots, tenantID := newDRConsumerForTest(t)

	// gate1.passed carries rpo_seconds + validation_ratio; the failover driver
	// adds run_id/group_id/mode/status. Build it the way the driver does.
	event, err := events.NewEvent("datastream.dr.failover.gate1.passed", "clario-dr-service", tenantID, map[string]any{
		"run_id":            uuid.NewString(),
		"group_id":          uuid.NewString(),
		"mode":              "real",
		"status":            "SYNC_CONFIRMED",
		"recovery_point_id": uuid.NewString(),
		"rpo_seconds":       180.0,
		"validation_ratio":  0.99995,
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}
	if event.Type != drEventGate1Passed {
		t.Fatalf("normalized event type = %q, want %q", event.Type, drEventGate1Passed)
	}

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}

	rpo := latestSnapshotByName(t, kpis, snapshots, kpiDRRecoveryPointObjective)
	if rpo == nil {
		t.Fatal("expected an RPO KPI snapshot to be created")
	}
	if rpo.Value != 3.0 { // 180s -> 3 min
		t.Errorf("RPO KPI value = %v, want 3.0 (minutes)", rpo.Value)
	}
	val := latestSnapshotByName(t, kpis, snapshots, kpiDRRecoveryValidation)
	if val == nil {
		t.Fatal("expected a validation KPI snapshot to be created")
	}
	if val.Value < 99.99 || val.Value > 100 {
		t.Errorf("validation KPI value = %v, want ~99.995", val.Value)
	}
	// Gate 1 passing is not itself alert-worthy.
	if len(alerts.alerts) != 0 {
		t.Errorf("expected no exec alert on gate1.passed, got %d", len(alerts.alerts))
	}
}

func TestDRFailoverCompleted_RealBreach_RaisesAlertAndRecordsRTO(t *testing.T) {
	consumer, alerts, kpis, snapshots, tenantID := newDRConsumerForTest(t)
	runID := uuid.NewString()

	event, err := events.NewEvent("datastream.dr.attestation.issued", "clario-dr-service", tenantID, map[string]any{
		"run_id":                runID,
		"group_id":              uuid.NewString(),
		"mode":                  "real",
		"status":                "COMPLETED",
		"attestation_id":        uuid.NewString(),
		"report_object_key":     "dr-recovery-points/att/abc.json",
		"rto_actual_seconds":    1200.0, // 20 min > 15 min objective
		"rto_objective_seconds": 900.0,
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}

	rto := latestSnapshotByName(t, kpis, snapshots, kpiDRFailoverRecoveryTime)
	if rto == nil {
		t.Fatal("expected an RTO KPI snapshot")
	}
	if rto.Value != 20.0 { // 1200s -> 20 min
		t.Errorf("RTO KPI value = %v, want 20.0 (minutes)", rto.Value)
	}
	if len(alerts.alerts) != 1 {
		t.Fatalf("expected 1 exec alert for the RTO breach, got %d", len(alerts.alerts))
	}
	got := alerts.alerts[0]
	if got.Severity != model.AlertSeverityHigh {
		t.Errorf("alert severity = %v, want high", got.Severity)
	}
	if got.Category != model.AlertCategoryOperational {
		t.Errorf("alert category = %v, want operational", got.Category)
	}
	if got.SourceSuite != "datastream" {
		t.Errorf("alert source suite = %q, want datastream", got.SourceSuite)
	}
	if got.DedupKey == nil || *got.DedupKey != dedupKey("dr_failover_rto", runID) {
		t.Errorf("alert dedup key = %v, want dr_failover_rto:%s", got.DedupKey, runID)
	}
}

func TestDRFailoverCompleted_DrillWithinObjective_NoAlert(t *testing.T) {
	consumer, alerts, kpis, snapshots, tenantID := newDRConsumerForTest(t)

	event, err := events.NewEvent("datastream.dr.attestation.issued", "clario-dr-service", tenantID, map[string]any{
		"run_id":                uuid.NewString(),
		"mode":                  "drill",
		"status":                "COMPLETED",
		"rto_actual_seconds":    300.0, // 5 min, well within objective
		"rto_objective_seconds": 900.0,
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if rto := latestSnapshotByName(t, kpis, snapshots, kpiDRFailoverRecoveryTime); rto == nil || rto.Value != 5.0 {
		t.Fatalf("expected RTO KPI snapshot of 5.0 min, got %+v", rto)
	}
	if len(alerts.alerts) != 0 {
		t.Errorf("expected no alert for an in-objective drill, got %d", len(alerts.alerts))
	}
}

func TestDRFailoverFailed_RaisesCriticalAlert(t *testing.T) {
	consumer, alerts, _, _, tenantID := newDRConsumerForTest(t)
	runID := uuid.NewString()

	event, err := events.NewEvent("datastream.dr.failover.failed", "clario-dr-service", tenantID, map[string]any{
		"run_id":          runID,
		"group_id":        uuid.NewString(),
		"mode":            "real",
		"previous_status": "EXECUTING",
		"final_status":    "ROLLED_BACK",
		"error":           "boot order health probe timed out",
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(alerts.alerts) != 1 {
		t.Fatalf("expected 1 exec alert, got %d", len(alerts.alerts))
	}
	if alerts.alerts[0].Severity != model.AlertSeverityCritical {
		t.Errorf("failed real failover severity = %v, want critical", alerts.alerts[0].Severity)
	}
}

func TestDRRecoveryPointSealed_UpdatesRPOKPI(t *testing.T) {
	consumer, alerts, kpis, snapshots, tenantID := newDRConsumerForTest(t)

	event, err := events.NewEvent("dr.recovery_point.sealed", "clario-dr-service", tenantID, map[string]any{
		"recovery_point_id": uuid.NewString(),
		"group_id":          uuid.NewString(),
		"marker_lsn":        "0/1A2B3C",
		"rpo_seconds":       42.0,
		"content_hash":      "deadbeef",
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	rpo := latestSnapshotByName(t, kpis, snapshots, kpiDRRecoveryPointObjective)
	if rpo == nil {
		t.Fatal("expected an RPO KPI snapshot from the sealed recovery point")
	}
	if rpo.Value != 0.7 { // 42s -> 0.70 min
		t.Errorf("RPO KPI value = %v, want 0.7", rpo.Value)
	}
	if len(alerts.alerts) != 0 {
		t.Errorf("sealing a recovery point is not alert-worthy, got %d alerts", len(alerts.alerts))
	}
}

func TestDRRecoveryPointValidated_BelowSLO_Alerts(t *testing.T) {
	consumer, alerts, kpis, snapshots, tenantID := newDRConsumerForTest(t)
	pointID := uuid.NewString()

	event, err := events.NewEvent("dr.recovery_point.validated", "clario-dr-service", tenantID, map[string]any{
		"recovery_point_id": pointID,
		"group_id":          uuid.NewString(),
		"validation_ratio":  0.95,
		"is_validated":      false,
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	val := latestSnapshotByName(t, kpis, snapshots, kpiDRRecoveryValidation)
	if val == nil || val.Value != 95.0 {
		t.Fatalf("expected validation KPI snapshot of 95.0, got %+v", val)
	}
	if len(alerts.alerts) != 1 {
		t.Fatalf("expected 1 exec alert for sub-SLO validation, got %d", len(alerts.alerts))
	}
	if alerts.alerts[0].DedupKey == nil || *alerts.alerts[0].DedupKey != dedupKey("dr_validation", pointID) {
		t.Errorf("unexpected dedup key %v", alerts.alerts[0].DedupKey)
	}
}

func TestDRRecoveryPointValidated_MeetsSLO_NoAlert(t *testing.T) {
	consumer, alerts, kpis, snapshots, tenantID := newDRConsumerForTest(t)

	event, err := events.NewEvent("dr.recovery_point.validated", "clario-dr-service", tenantID, map[string]any{
		"recovery_point_id": uuid.NewString(),
		"validation_ratio":  0.9995,
		"is_validated":      true,
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if val := latestSnapshotByName(t, kpis, snapshots, kpiDRRecoveryValidation); val == nil {
		t.Fatal("expected a validation KPI snapshot")
	}
	if len(alerts.alerts) != 0 {
		t.Errorf("validation meeting SLO should not alert, got %d", len(alerts.alerts))
	}
}

func TestDRRPOBreached_AlertsAndUpdatesKPI(t *testing.T) {
	consumer, alerts, kpis, snapshots, tenantID := newDRConsumerForTest(t)
	streamID := uuid.NewString()
	live := int64(420)

	// The RPO monitor sets event.Type directly (unprefixed). Reproduce that.
	event, err := events.NewEvent("placeholder", "clario-dr-service/rpo-monitor", tenantID, map[string]any{
		"stream_id":             streamID,
		"site_id":               uuid.NewString(),
		"site_name":             "core-banking-primary",
		"status":                "error",
		"rpo_objective_seconds": 300,
		"live_rpo_seconds":      live,
		"reason":                "rpo_objective_exceeded",
		"message":               "live RPO is 420s; RPO objective is 300s",
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}
	event.Type = drEventRPOBreached // RPO monitor uses the raw type string

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	rpo := latestSnapshotByName(t, kpis, snapshots, kpiDRRecoveryPointObjective)
	if rpo == nil || rpo.Value != 7.0 { // 420s -> 7 min
		t.Fatalf("expected RPO KPI snapshot of 7.0 min, got %+v", rpo)
	}
	if len(alerts.alerts) != 1 {
		t.Fatalf("expected 1 exec alert for RPO breach, got %d", len(alerts.alerts))
	}
	got := alerts.alerts[0]
	if got.Severity != model.AlertSeverityCritical {
		t.Errorf("error-state RPO breach severity = %v, want critical", got.Severity)
	}
	if got.Title != "DR RPO Breach on core-banking-primary" {
		t.Errorf("unexpected alert title %q", got.Title)
	}
}

func TestDRRPORecovered_UpdatesKPINoAlert(t *testing.T) {
	consumer, alerts, kpis, snapshots, tenantID := newDRConsumerForTest(t)
	live := int64(90)

	event, err := events.NewEvent("placeholder", "clario-dr-service/rpo-monitor", tenantID, map[string]any{
		"stream_id":        uuid.NewString(),
		"live_rpo_seconds": live,
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}
	event.Type = drEventRPORecovered

	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if rpo := latestSnapshotByName(t, kpis, snapshots, kpiDRRecoveryPointObjective); rpo == nil || rpo.Value != 1.5 {
		t.Fatalf("expected RPO KPI snapshot of 1.5 min, got %+v", rpo)
	}
	if len(alerts.alerts) != 0 {
		t.Errorf("RPO recovery should not alert, got %d", len(alerts.alerts))
	}
}

func TestDRKPIOnly_ProcessesWithoutAlertService(t *testing.T) {
	// A KPI-only event (recovery point sealed) must still update KPIs even when
	// the alert service is not wired (the DR dispatch runs before the alerts==nil
	// guard in Handle).
	consumer, _, kpis, snapshots, tenantID := newDRConsumerForTest(t)
	consumer.alerts = nil

	event, err := events.NewEvent("dr.recovery_point.sealed", "clario-dr-service", tenantID, map[string]any{
		"recovery_point_id": uuid.NewString(),
		"rpo_seconds":       120.0,
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}
	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if rpo := latestSnapshotByName(t, kpis, snapshots, kpiDRRecoveryPointObjective); rpo == nil || rpo.Value != 2.0 {
		t.Fatalf("expected RPO KPI snapshot of 2.0 min even without alerts, got %+v", rpo)
	}
}

func TestNonDREvent_FallsThroughToBaseDispatcher(t *testing.T) {
	consumer, alerts, _, _, tenantID := newDRConsumerForTest(t)

	// A cyber critical alert is not a DR event; handleDR returns handled=false
	// and the base switch creates the executive alert.
	event, err := events.NewEvent("cyber.alert.created", "cyber-service", tenantID, map[string]any{
		"id":                   "alert-x",
		"title":                "Critical Intrusion",
		"severity":             "critical",
		"affected_asset_count": 2,
	})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}
	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(alerts.alerts) != 1 {
		t.Fatalf("expected the base cyber handler to still create 1 alert, got %d", len(alerts.alerts))
	}
}
