package predict

import (
	"fmt"
	"math"
	"sort"
	"time"
)

// Config tunes the forecaster. Zero values fall back to the constants in
// withDefaults so a caller can construct a usable forecaster with Config{}.
type Config struct {
	// LagAlpha is the EWMA / Holt level smoothing factor for replication lag
	// (0,1]. Higher reacts faster to recent lag; lower is smoother. Default 0.4.
	LagAlpha float64
	// LagBeta is the Holt trend smoothing factor (0,1]. Higher tracks a
	// changing trend faster. Default 0.3.
	LagBeta float64
	// ThroughputAlpha is the EWMA level factor for throughput. Default 0.4.
	ThroughputAlpha float64
	// ThroughputBeta is the Holt trend factor for throughput. Default 0.3.
	ThroughputBeta float64
	// BreachWindow is the forecast horizon under which a predicted RPO breach
	// stages an alert. A breach forecast to land in <= BreachWindow is "act
	// now". Default 10m.
	BreachWindow time.Duration
	// MinSlopeSecPerSec is the minimum positive lag slope (seconds of lag per
	// second of wall clock) treated as a real rising trend. Below this the lag
	// is considered flat and no finite breach horizon is computed (avoids
	// dividing by trend noise into a huge or spurious horizon). Default 1e-4.
	MinSlopeSecPerSec float64
	// CollapseFraction sets the throughput-collapse threshold. Throughput
	// collapse is flagged when the smoothed throughput has fallen to at most
	// CollapseFraction of the series' peak smoothed throughput AND the
	// throughput trend slope is negative. Default 0.25 (a 75% drop).
	CollapseFraction float64
	// MinSamplesForTrend is the minimum number of samples required before a
	// trend (and therefore a breach horizon or collapse) is computed. Default 3.
	MinSamplesForTrend int
	// DefaultRPOObjectiveSeconds is used when a stream's objective is unknown.
	// Default 300 (the GA 5-minute RPO).
	DefaultRPOObjectiveSeconds int
}

func (c Config) withDefaults() Config {
	if c.LagAlpha <= 0 || c.LagAlpha > 1 {
		c.LagAlpha = 0.4
	}
	if c.LagBeta <= 0 || c.LagBeta > 1 {
		c.LagBeta = 0.3
	}
	if c.ThroughputAlpha <= 0 || c.ThroughputAlpha > 1 {
		c.ThroughputAlpha = 0.4
	}
	if c.ThroughputBeta <= 0 || c.ThroughputBeta > 1 {
		c.ThroughputBeta = 0.3
	}
	if c.BreachWindow <= 0 {
		c.BreachWindow = 10 * time.Minute
	}
	if c.MinSlopeSecPerSec <= 0 {
		c.MinSlopeSecPerSec = 1e-4
	}
	if c.CollapseFraction <= 0 || c.CollapseFraction >= 1 {
		c.CollapseFraction = 0.25
	}
	if c.MinSamplesForTrend < 2 {
		c.MinSamplesForTrend = 3
	}
	if c.DefaultRPOObjectiveSeconds <= 0 {
		c.DefaultRPOObjectiveSeconds = 300
	}
	return c
}

// Forecast is the pure result of running the forecaster over a sample series.
// It carries the model state (smoothed lag, both trend slopes), the derived
// breach horizon, and the boolean decisions the loop acts on.
type Forecast struct {
	// SmoothedLagSeconds is the Holt level of replication lag at the last sample.
	SmoothedLagSeconds float64
	// LagTrendSlope is the Holt lag trend in seconds-of-lag per second of wall
	// clock. Positive means lag is growing toward a breach.
	LagTrendSlope float64
	// SmoothedThroughputBPS is the Holt level of throughput at the last sample.
	SmoothedThroughputBPS float64
	// ThroughputTrendSlope is the throughput trend in bytes/sec per second.
	ThroughputTrendSlope float64
	// PeakSmoothedThroughputBPS is the highest smoothed throughput in the series,
	// the baseline a collapse is measured against.
	PeakSmoothedThroughputBPS float64
	// PredictedBreachSeconds is the time-to-RPO-breach horizon; nil when no
	// finite breach is predicted (lag flat/shrinking or already past objective).
	PredictedBreachSeconds *float64
	// BreachForecast is true when a finite breach horizon falls within the
	// configured alert window (or the lag is already at/over objective and still
	// rising — an immediate breach).
	BreachForecast bool
	// AlreadyBreached is true when the smoothed lag is already at/over the
	// objective at the latest sample (breach now, not merely forecast).
	AlreadyBreached bool
	// ThroughputCollapse is true when smoothed throughput has fallen to <=
	// CollapseFraction of its peak and is still trending down.
	ThroughputCollapse bool
	// RPOObjectiveSeconds is the objective the forecast was measured against.
	RPOObjectiveSeconds int
	// SampleCount is the number of samples that fed the forecast.
	SampleCount int
	// Computable is false when there were too few samples to compute a trend;
	// the level fields are still populated from whatever samples existed.
	Computable bool
}

// Forecaster runs EWMA + Holt-style trend forecasting over a stream's sample
// series. It is stateless across calls (the durable state lives in the sample
// series), so the same instance is safe for concurrent use.
type Forecaster struct {
	cfg Config
}

// NewForecaster constructs a Forecaster, filling unset config with defaults.
func NewForecaster(cfg Config) *Forecaster {
	return &Forecaster{cfg: cfg.withDefaults()}
}

// Cfg returns the effective (defaults-applied) configuration.
func (f *Forecaster) Cfg() Config { return f.cfg }

// Forecast runs the model over a stream's samples and objective. Samples may be
// in any order; Forecast sorts a copy by observed_at and ignores duplicate
// timestamps. objectiveSeconds <= 0 falls back to the configured default.
func (f *Forecaster) Forecast(samples []Sample, objectiveSeconds int) Forecast {
	if objectiveSeconds <= 0 {
		objectiveSeconds = f.cfg.DefaultRPOObjectiveSeconds
	}
	out := Forecast{RPOObjectiveSeconds: objectiveSeconds, SampleCount: len(samples)}
	if len(samples) == 0 {
		return out
	}

	ordered := dedupSortedByTime(samples)
	out.SampleCount = len(ordered)

	// Holt double-exponential smoothing on lag, indexed by sample order. Because
	// progress samples can be irregularly spaced, the trend is kept in
	// per-second units: we smooth the per-second rate of change between
	// consecutive samples, not the raw level-to-level delta. This makes the
	// extrapolation (level + slope * seconds) correct for uneven sampling.
	lagLevel := ordered[0].LagSeconds
	tputLevel := ordered[0].ThroughputBPS
	var lagSlope, tputSlope float64 // per-second slopes
	peakTput := tputLevel
	haveTrend := false

	for i := 1; i < len(ordered); i++ {
		dt := ordered[i].ObservedAt.Sub(ordered[i-1].ObservedAt).Seconds()
		if dt <= 0 {
			// Defensive: dedup removes equal timestamps, but guard against
			// clock-skewed non-monotonic input rather than dividing by zero.
			continue
		}

		// --- Lag (Holt level + trend, per-second slope) ---
		prevLevel := lagLevel
		// Predicted level for this step from prior level + slope over dt.
		predicted := prevLevel + lagSlope*dt
		observed := ordered[i].LagSeconds
		// Level update: blend observation with the prediction.
		lagLevel = f.cfg.LagAlpha*observed + (1-f.cfg.LagAlpha)*predicted
		if (observed >= prevLevel && lagLevel > observed) || (observed <= prevLevel && lagLevel < observed) {
			lagLevel = observed
		}
		// Instantaneous per-second slope between the two smoothed levels.
		instSlope := (lagLevel - prevLevel) / dt
		lagSlope = f.cfg.LagBeta*instSlope + (1-f.cfg.LagBeta)*lagSlope

		// --- Throughput (same Holt scheme) ---
		prevTput := tputLevel
		predictedTput := prevTput + tputSlope*dt
		obsTput := ordered[i].ThroughputBPS
		tputLevel = f.cfg.ThroughputAlpha*obsTput + (1-f.cfg.ThroughputAlpha)*predictedTput
		instTputSlope := (tputLevel - prevTput) / dt
		tputSlope = f.cfg.ThroughputBeta*instTputSlope + (1-f.cfg.ThroughputBeta)*tputSlope

		if tputLevel > peakTput {
			peakTput = tputLevel
		}
		haveTrend = true
	}

	out.SmoothedLagSeconds = lagLevel
	out.LagTrendSlope = lagSlope
	out.SmoothedThroughputBPS = tputLevel
	out.ThroughputTrendSlope = tputSlope
	out.PeakSmoothedThroughputBPS = peakTput

	if !haveTrend || len(ordered) < f.cfg.MinSamplesForTrend {
		// Not enough history to trust a trend; report levels only.
		return out
	}
	out.Computable = true

	objective := float64(objectiveSeconds)

	// Already-breached: smoothed lag is at/over objective right now.
	if lagLevel >= objective {
		out.AlreadyBreached = true
		// Only treat as an actionable breach forecast while lag is not
		// recovering (slope >= 0). A negative slope means it is shrinking back
		// under objective, which the recovery path handles.
		if lagSlope >= 0 {
			zero := 0.0
			out.PredictedBreachSeconds = &zero
			out.BreachForecast = true
		}
	} else if lagSlope > f.cfg.MinSlopeSecPerSec {
		// Rising toward, but not yet at, the objective: extrapolate the horizon.
		horizon := (objective - lagLevel) / lagSlope
		if horizon < 0 {
			horizon = 0
		}
		h := horizon
		out.PredictedBreachSeconds = &h
		if horizon <= f.cfg.BreachWindow.Seconds() {
			out.BreachForecast = true
		}
	}
	// Else: lag flat or shrinking and under objective → no finite breach
	// horizon, PredictedBreachSeconds stays nil, BreachForecast false.

	// Throughput collapse: smoothed throughput fell to <= CollapseFraction of
	// its series peak and is still trending down. Requires a meaningful peak so
	// an always-near-zero stream does not perpetually "collapse".
	if peakTput > 0 && tputSlope < 0 && tputLevel <= f.cfg.CollapseFraction*peakTput {
		out.ThroughputCollapse = true
	}

	return out
}

// dedupSortedByTime returns a copy of samples sorted ascending by ObservedAt
// with duplicate timestamps collapsed to the last-seen value, so the Holt
// recurrence never sees dt <= 0 from re-delivered samples.
func dedupSortedByTime(samples []Sample) []Sample {
	cp := make([]Sample, len(samples))
	copy(cp, samples)
	sort.SliceStable(cp, func(i, j int) bool {
		return cp[i].ObservedAt.Before(cp[j].ObservedAt)
	})
	out := cp[:0]
	for i := range cp {
		if len(out) > 0 && out[len(out)-1].ObservedAt.Equal(cp[i].ObservedAt) {
			out[len(out)-1] = cp[i] // keep the latest value at this instant
			continue
		}
		out = append(out, cp[i])
	}
	return out
}

// ToPrediction projects a Forecast onto the persistable Prediction row for a
// stream, stamping the forecast time.
func (fc Forecast) ToPrediction(tenantID, streamID, groupLabel string, now time.Time) Prediction {
	p := Prediction{
		TenantID:             tenantID,
		StreamID:             streamID,
		GroupLabel:           groupLabel,
		RPOObjectiveSeconds:  fc.RPOObjectiveSeconds,
		SmoothedLagSeconds:   fc.SmoothedLagSeconds,
		LagTrendSlope:        fc.LagTrendSlope,
		ThroughputTrendSlope: fc.ThroughputTrendSlope,
		BreachForecast:       fc.BreachForecast,
		ThroughputCollapse:   fc.ThroughputCollapse,
		SampleCount:          fc.SampleCount,
		ForecastAt:           now.UTC(),
		UpdatedAt:            now.UTC(),
	}
	if fc.PredictedBreachSeconds != nil && !math.IsInf(*fc.PredictedBreachSeconds, 0) && !math.IsNaN(*fc.PredictedBreachSeconds) {
		v := *fc.PredictedBreachSeconds
		p.PredictedBreachSeconds = &v
	}
	return p
}

// Validate reports a configuration error if any tuned factor is out of range.
// Construction tolerates zero (→ default), but an explicitly out-of-range value
// is a wiring bug worth surfacing.
func (c Config) Validate() error {
	check := func(name string, v float64) error {
		if v != 0 && (v <= 0 || v > 1) {
			return fmt.Errorf("predict: %s must be in (0,1], got %v", name, v)
		}
		return nil
	}
	for _, e := range []error{
		check("LagAlpha", c.LagAlpha),
		check("LagBeta", c.LagBeta),
		check("ThroughputAlpha", c.ThroughputAlpha),
		check("ThroughputBeta", c.ThroughputBeta),
	} {
		if e != nil {
			return e
		}
	}
	if c.CollapseFraction != 0 && (c.CollapseFraction <= 0 || c.CollapseFraction >= 1) {
		return fmt.Errorf("predict: CollapseFraction must be in (0,1), got %v", c.CollapseFraction)
	}
	return nil
}
