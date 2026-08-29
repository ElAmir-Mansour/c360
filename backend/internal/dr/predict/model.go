// Package predict implements ClarioDR capability #1: predictive failure
// detection.
//
// It consumes datastream.dr.progress telemetry per replication stream (lag,
// throughput, applied_seq cadence), persists a rolling sample series, and runs
// a real forecaster — an EWMA of replication lag plus a Holt-style linear
// trend (level + slope) extrapolation. From the smoothed lag and its slope it
// computes a "time-to-RPO-breach" horizon:
//
//	time_to_breach = (rpo_objective - smoothed_lag) / lag_trend_slope
//
// When that horizon falls under a configurable alert window, the forecaster
// stages a dr.prediction.rpo_breach_forecast event to the transactional outbox
// (Topics.DRAlerts) and updates the dr_predicted_breach_seconds Prometheus
// gauge. It also flags throughput collapse (a sharply negative throughput
// slope) as an early source-failure signal.
//
// The package owns its own model types, store (over repository.DBTX), Kafka
// EventHandler, forecaster, background loop, and chi.Router so it integrates
// without editing shared DR files.
package predict

import "time"

// Outbound DR alert event types staged to Topics.DRAlerts.
const (
	// EventTypeRPOBreachForecast fires when the forecast horizon to an RPO
	// breach falls under the configured alert window.
	EventTypeRPOBreachForecast = "dr.prediction.rpo_breach_forecast"
	// EventTypeRPOForecastCleared fires once when a previously-forecast breach
	// is no longer predicted (lag stopped rising / recovered).
	EventTypeRPOForecastCleared = "dr.prediction.rpo_forecast_cleared"
	// EventTypeThroughputCollapse fires when apply throughput collapses
	// sharply, an early source-failure signal independent of the lag forecast.
	EventTypeThroughputCollapse = "dr.prediction.throughput_collapse"

	defaultSource = "clario360/clario-dr-service/failure-predictor"
)

// ProgressSample is the canonical datastream.dr.progress payload the forecaster
// ingests. It mirrors the in-process core.Progress telemetry the pipeline emits
// (StreamID, AppliedSeq, Lag, ThroughputBPS) but is the wire/JSON contract for
// the Kafka topic, so the forecaster does not depend on the core package. The
// integration phase publishes this shape; the EventHandler parses it.
type ProgressSample struct {
	TenantID string `json:"tenant_id"`
	StreamID string `json:"stream_id"`
	// LagSeconds is the live replication lag (now - Frame.EmittedAt at apply).
	LagSeconds float64 `json:"lag_seconds"`
	// ThroughputBPS is the apply throughput in bytes/sec for the sample window.
	ThroughputBPS float64 `json:"throughput_bps"`
	// AppliedSeq is the highest contiguously-applied Seq at the sample instant.
	AppliedSeq int64 `json:"applied_seq"`
	// ObservedAt is the wall clock the sample was taken; when zero the handler
	// substitutes the event time.
	ObservedAt time.Time `json:"observed_at"`
	// GroupLabel is the consistency-group (or site) label used for the
	// prediction gauge; empty falls back to the stream ID.
	GroupLabel string `json:"group_label,omitempty"`
	// RPOObjectiveSeconds is the objective this stream's site is held to; zero
	// lets the forecaster fall back to its default objective.
	RPOObjectiveSeconds int `json:"rpo_objective_seconds,omitempty"`
}

// Sample is one persisted point of the rolling per-stream series
// (dr_replication_samples).
type Sample struct {
	ID            string    `json:"id"`
	TenantID      string    `json:"tenant_id"`
	StreamID      string    `json:"stream_id"`
	ObservedAt    time.Time `json:"observed_at"`
	LagSeconds    float64   `json:"lag_seconds"`
	ThroughputBPS float64   `json:"throughput_bps"`
	AppliedSeq    int64     `json:"applied_seq"`
	CreatedAt     time.Time `json:"created_at"`
}

// Prediction is the latest computed forecast for one stream (dr_predictions).
type Prediction struct {
	ID                  string `json:"id"`
	TenantID            string `json:"tenant_id"`
	StreamID            string `json:"stream_id"`
	GroupLabel          string `json:"group_label"`
	RPOObjectiveSeconds int    `json:"rpo_objective_seconds"`
	// SmoothedLagSeconds is the EWMA level of replication lag.
	SmoothedLagSeconds float64 `json:"smoothed_lag_seconds"`
	// LagTrendSlope is the Holt trend slope of lag (seconds-of-lag per second).
	LagTrendSlope float64 `json:"lag_trend_slope"`
	// ThroughputTrendSlope is the throughput slope (bytes/sec per second).
	ThroughputTrendSlope float64 `json:"throughput_trend_slope"`
	// PredictedBreachSeconds is the forecast horizon to RPO breach; nil when
	// lag is flat or shrinking (no finite breach is predicted).
	PredictedBreachSeconds *float64 `json:"predicted_breach_seconds,omitempty"`
	// BreachForecast is true when PredictedBreachSeconds is under the alert
	// window (an event was staged).
	BreachForecast bool `json:"breach_forecast"`
	// ThroughputCollapse is true when throughput collapse was detected.
	ThroughputCollapse bool      `json:"throughput_collapse"`
	SampleCount        int       `json:"sample_count"`
	ForecastAt         time.Time `json:"forecast_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// StreamPredictionState is the cross-tenant view the background loop needs to
// recompute and persist a forecast for one stream: the stream identity, its
// RPO objective, its group label, the previously-recorded breach/collapse flags
// (so the loop only fires events on a state flip), and the rolling sample
// series. The forecaster's math is pure over the Samples slice.
type StreamPredictionState struct {
	TenantID            string
	StreamID            string
	GroupLabel          string
	RPOObjectiveSeconds int
	// PrevBreachForecast / PrevThroughputCollapse are the flags from the last
	// persisted prediction (false if none), used for edge-triggered alerting.
	PrevBreachForecast     bool
	PrevThroughputCollapse bool
	Samples                []Sample
}
