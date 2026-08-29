package consumer

import (
	"context"
	"fmt"
	"math"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/visus/model"
)

// ClarioDR (DataStream Disaster Recovery) cross-suite handlers. BOSALAH (the
// visus executive surface) consumes datastream.dr.events and datastream.dr.alerts
// (DESIGN_DataStream_DR.md §8) to keep the exec DR KPIs and the executive alert
// feed current without polling the DR control plane.
//
// Event types (CloudEvents, com.clario360.* normalized — internal/events/event.go):
//   datastream.dr.events:
//     com.clario360.datastream.dr.failover.gate1.passed   (achieved RPO + validation pinned)
//     com.clario360.datastream.dr.attestation.issued      (failover/drill COMPLETED → RTO)
//     com.clario360.datastream.dr.failover.failed         (failover aborted)
//     com.clario360.dr.recovery_point.sealed              (new immutable recovery point)
//     com.clario360.dr.recovery_point.validated           (validation ratio recorded)
//   datastream.dr.alerts:
//     rpo.breached                                         (RPO monitor breach, not normalized)
//     rpo.recovered                                        (RPO monitor recovery)
//
// Boundary note: the visus consumer framework owns alert creation and KPI
// snapshotting (see visus_consumer.go). This file plugs the DR event vocabulary
// into that framework; it does not re-implement persistence or the threshold
// engine. The KPIs it updates ("DR Recovery Point Objective", "DR Recovery
// Validation", "DR Failover Recovery Time") are seeded in kpi/defaults.go.

const (
	drEventGate1Passed       = "com.clario360.datastream.dr.failover.gate1.passed"
	drEventAttestationIssued = "com.clario360.datastream.dr.attestation.issued"
	drEventFailoverFailed    = "com.clario360.datastream.dr.failover.failed"
	drEventRecoveryPointSeal = "com.clario360.dr.recovery_point.sealed"
	drEventRecoveryPointVal  = "com.clario360.dr.recovery_point.validated"

	// The RPO monitor sets Type directly (not via NewEvent), so these are not
	// com.clario360-prefixed.
	drEventRPOBreached  = "rpo.breached"
	drEventRPORecovered = "rpo.recovered"

	kpiDRRecoveryPointObjective = "DR Recovery Point Objective"
	kpiDRRecoveryValidation     = "DR Recovery Validation"
	kpiDRFailoverRecoveryTime   = "DR Failover Recovery Time"
)

// drEventTypes returns the DR event types this consumer handles, for inclusion
// in VisusConsumer.EventTypes().
func drEventTypes() []string {
	return []string{
		drEventGate1Passed,
		drEventAttestationIssued,
		drEventFailoverFailed,
		drEventRecoveryPointSeal,
		drEventRecoveryPointVal,
		drEventRPOBreached,
		drEventRPORecovered,
	}
}

// handleDR dispatches a datastream.dr.* event to the matching handler. It
// returns (handled, error): handled is false when the event type is not a DR
// type, letting the main dispatcher fall through.
func (c *VisusConsumer) handleDR(ctx context.Context, event *events.Event) (bool, error) {
	switch event.Type {
	case drEventGate1Passed:
		return true, c.handleDRFailoverGate1(ctx, event)
	case drEventAttestationIssued:
		return true, c.handleDRFailoverCompleted(ctx, event)
	case drEventFailoverFailed:
		return true, c.handleDRFailoverFailed(ctx, event)
	case drEventRecoveryPointSeal:
		return true, c.handleDRRecoveryPointSealed(ctx, event)
	case drEventRecoveryPointVal:
		return true, c.handleDRRecoveryPointValidated(ctx, event)
	case drEventRPOBreached:
		return true, c.handleDRRPOBreached(ctx, event)
	case drEventRPORecovered:
		return true, c.handleDRRPORecovered(ctx, event)
	default:
		return false, nil
	}
}

// handleDRFailoverGate1 records the achieved RPO and validation ratio pinned at
// Gate 1 (the recovery point selected for this failover) into the exec KPIs.
func (c *VisusConsumer) handleDRFailoverGate1(ctx context.Context, event *events.Event) error {
	tenantID, err := c.tenantID(event)
	if err != nil {
		return err
	}

	var payload struct {
		RunID           string  `json:"run_id"`
		GroupID         string  `json:"group_id"`
		Mode            string  `json:"mode"`
		RecoveryPointID string  `json:"recovery_point_id"`
		RPOSeconds      float64 `json:"rpo_seconds"`
		ValidationRatio float64 `json:"validation_ratio"`
	}
	if err := event.Unmarshal(&payload); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed dr gate1 event")
		return nil
	}

	// RPO objective KPI is expressed in minutes for the exec board.
	if _, _, err := c.updateKPIByName(ctx, tenantID, kpiDRRecoveryPointObjective, secondsToMinutes(payload.RPOSeconds)); err != nil {
		return err
	}
	// Validation ratio (0..1) surfaced as a percentage.
	if _, _, err := c.updateKPIByName(ctx, tenantID, kpiDRRecoveryValidation, payload.ValidationRatio*100); err != nil {
		return err
	}
	return c.invalidateDRDashboard(ctx, tenantID)
}

// handleDRFailoverCompleted fires when a failover/drill is attested and
// COMPLETED. It records the achieved RTO (in minutes) and raises an exec alert
// when the RTO exceeds the 15-minute objective (real mode only).
func (c *VisusConsumer) handleDRFailoverCompleted(ctx context.Context, event *events.Event) error {
	tenantID, err := c.tenantID(event)
	if err != nil {
		return err
	}

	var payload struct {
		RunID            string  `json:"run_id"`
		GroupID          string  `json:"group_id"`
		Mode             string  `json:"mode"`
		Status           string  `json:"status"`
		AttestationID    string  `json:"attestation_id"`
		ReportObjectKey  string  `json:"report_object_key"`
		RTOActualSeconds float64 `json:"rto_actual_seconds"`
		RTOObjectiveSecs float64 `json:"rto_objective_seconds"`
	}
	if err := event.Unmarshal(&payload); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed dr attestation event")
		return nil
	}

	rtoMinutes := secondsToMinutes(payload.RTOActualSeconds)
	objectiveSeconds := payload.RTOObjectiveSecs
	if objectiveSeconds <= 0 {
		objectiveSeconds = 900 // GA SLO ceiling (§1.3)
	}

	if payload.RTOActualSeconds > 0 {
		if _, _, err := c.updateKPIByName(ctx, tenantID, kpiDRFailoverRecoveryTime, rtoMinutes); err != nil {
			return err
		}
	}

	if err := c.invalidateDRDashboard(ctx, tenantID); err != nil {
		return err
	}

	// A successful drill is reassuring, not alert-worthy. A real failover that
	// breached its RTO objective is a board-level operational alert.
	if payload.Mode == "real" && payload.RTOActualSeconds > objectiveSeconds {
		return c.createExecutiveAlert(
			ctx,
			tenantID,
			fmt.Sprintf("DR Failover RTO Objective Breached: %.1f min (objective %.0f min)", rtoMinutes, secondsToMinutes(objectiveSeconds)),
			"A real disaster-recovery failover completed but took longer than its recovery-time objective. Investigate the boot-order and validation steps in the attestation.",
			model.AlertCategoryOperational,
			model.AlertSeverityHigh,
			"datastream",
			"dr_failover",
			dedupKey("dr_failover_rto", payload.RunID),
			map[string]any{
				"run_id":                payload.RunID,
				"group_id":              payload.GroupID,
				"attestation_id":        payload.AttestationID,
				"report_object_key":     payload.ReportObjectKey,
				"rto_actual_seconds":    payload.RTOActualSeconds,
				"rto_objective_seconds": objectiveSeconds,
				"source_event_type":     event.Type,
				"source_event_id":       event.ID,
			},
		)
	}
	return nil
}

// handleDRFailoverFailed raises a critical exec alert when a failover/drill
// aborts (Gate failure → FAILED/ROLLED_BACK).
func (c *VisusConsumer) handleDRFailoverFailed(ctx context.Context, event *events.Event) error {
	tenantID, err := c.tenantID(event)
	if err != nil {
		return err
	}

	var payload struct {
		RunID          string `json:"run_id"`
		GroupID        string `json:"group_id"`
		Mode           string `json:"mode"`
		PreviousStatus string `json:"previous_status"`
		FinalStatus    string `json:"final_status"`
		Error          string `json:"error"`
	}
	if err := event.Unmarshal(&payload); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed dr failover failed event")
		return nil
	}

	if err := c.invalidateDRDashboard(ctx, tenantID); err != nil {
		return err
	}

	severity := model.AlertSeverityCritical
	if payload.Mode == "drill" {
		// A failed drill is operationally important but not a live outage.
		severity = model.AlertSeverityHigh
	}
	return c.createExecutiveAlert(
		ctx,
		tenantID,
		fmt.Sprintf("DR %s Failed (%s)", failoverModeLabel(payload.Mode), failedStatusLabel(payload.FinalStatus)),
		fmt.Sprintf("A disaster-recovery %s run aborted at %s: %s", failoverModeLabel(payload.Mode), failedStatusLabel(payload.PreviousStatus), payload.Error),
		model.AlertCategoryOperational,
		severity,
		"datastream",
		"dr_failover",
		dedupKey("dr_failover_failed", payload.RunID),
		map[string]any{
			"run_id":            payload.RunID,
			"group_id":          payload.GroupID,
			"mode":              payload.Mode,
			"previous_status":   payload.PreviousStatus,
			"final_status":      payload.FinalStatus,
			"error":             payload.Error,
			"source_event_type": event.Type,
			"source_event_id":   event.ID,
		},
	)
}

// handleDRRecoveryPointSealed records the achieved RPO of a freshly-sealed
// immutable recovery point into the exec RPO KPI.
func (c *VisusConsumer) handleDRRecoveryPointSealed(ctx context.Context, event *events.Event) error {
	tenantID, err := c.tenantID(event)
	if err != nil {
		return err
	}

	var payload struct {
		RecoveryPointID string  `json:"recovery_point_id"`
		GroupID         string  `json:"group_id"`
		MarkerLSN       string  `json:"marker_lsn"`
		RPOSeconds      float64 `json:"rpo_seconds"`
		ContentHash     string  `json:"content_hash"`
	}
	if err := event.Unmarshal(&payload); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed dr recovery point sealed event")
		return nil
	}

	if _, _, err := c.updateKPIByName(ctx, tenantID, kpiDRRecoveryPointObjective, secondsToMinutes(payload.RPOSeconds)); err != nil {
		return err
	}
	return c.invalidateDRDashboard(ctx, tenantID)
}

// handleDRRecoveryPointValidated records the validation match ratio recorded on
// a recovery point and alerts when it falls below the 99.9% fidelity SLO.
func (c *VisusConsumer) handleDRRecoveryPointValidated(ctx context.Context, event *events.Event) error {
	tenantID, err := c.tenantID(event)
	if err != nil {
		return err
	}

	var payload struct {
		RecoveryPointID string  `json:"recovery_point_id"`
		GroupID         string  `json:"group_id"`
		ValidationRatio float64 `json:"validation_ratio"`
		IsValidated     bool    `json:"is_validated"`
	}
	if err := event.Unmarshal(&payload); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed dr recovery point validated event")
		return nil
	}

	if _, _, err := c.updateKPIByName(ctx, tenantID, kpiDRRecoveryValidation, payload.ValidationRatio*100); err != nil {
		return err
	}
	if err := c.invalidateDRDashboard(ctx, tenantID); err != nil {
		return err
	}

	if payload.ValidationRatio > 0 && payload.ValidationRatio < 0.999 {
		return c.createExecutiveAlert(
			ctx,
			tenantID,
			fmt.Sprintf("DR Recovery-Point Validation Below SLO: %.4f", payload.ValidationRatio),
			"A disaster-recovery recovery point validated below the 99.9% data-fidelity SLO. A failover from this point risks restoring incomplete or corrupt data.",
			model.AlertCategoryOperational,
			model.AlertSeverityHigh,
			"datastream",
			"dr_recovery_point",
			dedupKey("dr_validation", payload.RecoveryPointID),
			map[string]any{
				"recovery_point_id": payload.RecoveryPointID,
				"group_id":          payload.GroupID,
				"validation_ratio":  payload.ValidationRatio,
				"source_event_type": event.Type,
				"source_event_id":   event.ID,
			},
		)
	}
	return nil
}

// handleDRRPOBreached records the live RPO at breach and raises an exec alert
// (RPO monitor event on datastream.dr.alerts).
func (c *VisusConsumer) handleDRRPOBreached(ctx context.Context, event *events.Event) error {
	tenantID, err := c.tenantID(event)
	if err != nil {
		return err
	}

	var payload struct {
		StreamID            string `json:"stream_id"`
		SiteID              string `json:"site_id"`
		SiteName            string `json:"site_name"`
		Status              string `json:"status"`
		RPOObjectiveSeconds int    `json:"rpo_objective_seconds"`
		LiveRPOSeconds      *int64 `json:"live_rpo_seconds"`
		NoCheckpointSeconds *int64 `json:"no_checkpoint_seconds"`
		Reason              string `json:"reason"`
		Message             string `json:"message"`
	}
	if err := event.Unmarshal(&payload); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed dr rpo breach event")
		return nil
	}

	live := rpoSecondsValue(payload.LiveRPOSeconds, payload.NoCheckpointSeconds)
	if live > 0 {
		if _, _, err := c.updateKPIByName(ctx, tenantID, kpiDRRecoveryPointObjective, secondsToMinutes(float64(live))); err != nil {
			return err
		}
	}
	if err := c.invalidateDRDashboard(ctx, tenantID); err != nil {
		return err
	}

	title := fmt.Sprintf("DR RPO Breach on %s", siteLabel(payload.SiteName, payload.SiteID, payload.StreamID))
	desc := payload.Message
	if desc == "" {
		desc = fmt.Sprintf("Stream RPO of %ds exceeded the %ds objective.", live, payload.RPOObjectiveSeconds)
	}
	severity := model.AlertSeverityCritical
	if payload.Status == "degraded" {
		severity = model.AlertSeverityHigh
	}
	return c.createExecutiveAlert(
		ctx,
		tenantID,
		title,
		desc,
		model.AlertCategoryOperational,
		severity,
		"datastream",
		"dr_rpo",
		dedupKey("dr_rpo_breach", payload.StreamID),
		map[string]any{
			"stream_id":             payload.StreamID,
			"site_id":               payload.SiteID,
			"site_name":             payload.SiteName,
			"status":                payload.Status,
			"live_rpo_seconds":      live,
			"rpo_objective_seconds": payload.RPOObjectiveSeconds,
			"reason":                payload.Reason,
			"source_event_type":     event.Type,
			"source_event_id":       event.ID,
		},
	)
}

// handleDRRPORecovered records the recovered live RPO and refreshes the
// dashboard. Recovery is informational; it does not raise an alert.
func (c *VisusConsumer) handleDRRPORecovered(ctx context.Context, event *events.Event) error {
	tenantID, err := c.tenantID(event)
	if err != nil {
		return err
	}

	var payload struct {
		StreamID       string `json:"stream_id"`
		LiveRPOSeconds *int64 `json:"live_rpo_seconds"`
	}
	if err := event.Unmarshal(&payload); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed dr rpo recovered event")
		return nil
	}

	live := rpoSecondsValue(payload.LiveRPOSeconds, nil)
	if live > 0 {
		if _, _, err := c.updateKPIByName(ctx, tenantID, kpiDRRecoveryPointObjective, secondsToMinutes(float64(live))); err != nil {
			return err
		}
	}
	return c.invalidateDRDashboard(ctx, tenantID)
}

func (c *VisusConsumer) invalidateDRDashboard(ctx context.Context, tenantID interface{ String() string }) error {
	return c.invalidateKeys(ctx,
		fmt.Sprintf("visus:dashboard:%s", tenantID.String()),
		fmt.Sprintf("visus:executive:%s", tenantID.String()),
	)
}

func secondsToMinutes(seconds float64) float64 {
	if seconds <= 0 {
		return 0
	}
	return math.Round((seconds/60.0)*100) / 100
}

func rpoSecondsValue(live, fallback *int64) int64 {
	if live != nil && *live > 0 {
		return *live
	}
	if fallback != nil && *fallback > 0 {
		return *fallback
	}
	return 0
}

func failoverModeLabel(mode string) string {
	switch mode {
	case "drill":
		return "Drill"
	case "real":
		return "Failover"
	default:
		return "Failover"
	}
}

func failedStatusLabel(status string) string {
	if status == "" {
		return "unknown state"
	}
	return status
}

func siteLabel(name, siteID, streamID string) string {
	if name != "" {
		return name
	}
	if siteID != "" {
		return siteID
	}
	if streamID != "" {
		return streamID
	}
	return "stream"
}
