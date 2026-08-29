package predict

import (
	"math"
	"testing"
	"time"
)

// base is a fixed reference instant so sample series are deterministic.
var base = time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

// series builds samples spaced every step seconds. lagFn maps the sample index
// to a lag value; tputFn maps it to a throughput value (nil → constant 1e6).
func series(n int, step time.Duration, lagFn func(i int) float64, tputFn func(i int) float64) []Sample {
	out := make([]Sample, n)
	for i := 0; i < n; i++ {
		lag := lagFn(i)
		tput := 1_000_000.0
		if tputFn != nil {
			tput = tputFn(i)
		}
		out[i] = Sample{
			TenantID:      "t1",
			StreamID:      "s1",
			ObservedAt:    base.Add(time.Duration(i) * step),
			LagSeconds:    lag,
			ThroughputBPS: tput,
			AppliedSeq:    int64(i + 1),
		}
	}
	return out
}

func TestForecast_SteadyLagStaysSilent(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{BreachWindow: 10 * time.Minute})

	// 30 samples, every 30s, lag flat at 30s — well under a 300s objective and
	// not trending. No breach forecast should be produced.
	samples := series(30, 30*time.Second, func(i int) float64 { return 30 }, nil)
	fc := f.Forecast(samples, 300)

	if !fc.Computable {
		t.Fatalf("expected a computable forecast with 30 samples")
	}
	if fc.BreachForecast {
		t.Fatalf("steady lag must not raise a breach forecast: %+v", fc)
	}
	if fc.AlreadyBreached {
		t.Fatalf("steady lag under objective must not be already breached")
	}
	if fc.PredictedBreachSeconds != nil {
		t.Fatalf("steady flat lag must have no finite breach horizon, got %v", *fc.PredictedBreachSeconds)
	}
	if math.Abs(fc.SmoothedLagSeconds-30) > 1.0 {
		t.Fatalf("smoothed lag should converge near 30, got %v", fc.SmoothedLagSeconds)
	}
	if math.Abs(fc.LagTrendSlope) > 1e-3 {
		t.Fatalf("flat series should have near-zero slope, got %v", fc.LagTrendSlope)
	}
}

func TestForecast_RisingLagFiresBreachAtCorrectHorizon(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{BreachWindow: 5 * time.Minute})

	// Lag rises linearly at exactly 1 second of lag per 1 second of wall clock
	// (slope 1.0). Samples every 10s starting at lag 50s, objective 300s.
	// After convergence, smoothed lag ~= current lag; remaining to objective
	// ~= 300 - lag, and with slope ~1.0 the horizon ~= that remaining gap.
	step := 10 * time.Second
	samples := series(40, step, func(i int) float64 {
		return 50 + float64(i)*10 // +10s lag every 10s step → slope 1.0/s
	}, nil)
	fc := f.Forecast(samples, 300)

	if !fc.Computable {
		t.Fatalf("expected computable forecast")
	}
	// Slope should converge close to 1.0 s-of-lag per s.
	if math.Abs(fc.LagTrendSlope-1.0) > 0.1 {
		t.Fatalf("rising slope should converge near 1.0/s, got %v", fc.LagTrendSlope)
	}
	// The last sample lag is 50 + 39*10 = 440 → smoothed lag is already over the
	// 300s objective. The model reports an immediate breach (horizon 0), not a
	// negative extrapolation.
	if !fc.AlreadyBreached {
		t.Fatalf("final lag 440s exceeds 300s objective; expected already-breached (smoothed=%v)", fc.SmoothedLagSeconds)
	}
	if fc.PredictedBreachSeconds == nil || *fc.PredictedBreachSeconds != 0 {
		t.Fatalf("already-breached-and-rising must report a zero (immediate) horizon, got %v", fc.PredictedBreachSeconds)
	}
	if !fc.BreachForecast {
		t.Fatalf("rising lag over objective must raise a breach forecast")
	}
}

func TestForecast_HorizonMatchesAnalyticFormulaWhenUnderObjective(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{BreachWindow: 10 * time.Minute})
	// Rise stays under the objective so the horizon is the real extrapolation
	// (objective - smoothedLag)/slope, which we assert against the formula.
	step := 5 * time.Second
	samples := series(20, step, func(i int) float64 { return 100 + float64(i)*5 }, nil) // up to 195 < 300
	fc := f.Forecast(samples, 300)
	if fc.AlreadyBreached {
		t.Fatalf("series under objective must not be already-breached")
	}
	if fc.PredictedBreachSeconds == nil {
		t.Fatalf("rising-under-objective must produce a finite horizon")
	}
	wantHorizon := (300 - fc.SmoothedLagSeconds) / fc.LagTrendSlope
	if math.Abs(*fc.PredictedBreachSeconds-wantHorizon) > 1e-6 {
		t.Fatalf("horizon must equal (objective-smoothedLag)/slope: got %v want %v",
			*fc.PredictedBreachSeconds, wantHorizon)
	}
}

func TestForecast_RisingButUnderObjectiveFiresWhenHorizonWithinWindow(t *testing.T) {
	t.Parallel()
	// Window 120s. Lag climbs from 200 toward 300 objective at slope 1.0/s.
	// When smoothed lag is ~ 250, remaining gap ~50s < 120s window → fire,
	// but the stream is NOT yet breached (under objective the whole series).
	f := NewForecaster(Config{BreachWindow: 120 * time.Second})
	step := 5 * time.Second
	// 20 samples from 200 to 200+19*5=295 (slope 1.0/s, stays < 300).
	samples := series(20, step, func(i int) float64 { return 200 + float64(i)*5 }, nil)
	fc := f.Forecast(samples, 300)

	if fc.AlreadyBreached {
		t.Fatalf("series stays under 300; must not be already-breached (lag=%v)", fc.SmoothedLagSeconds)
	}
	if fc.PredictedBreachSeconds == nil {
		t.Fatalf("expected a finite breach horizon")
	}
	if *fc.PredictedBreachSeconds > 120 {
		t.Fatalf("horizon %v should be within the 120s window to fire", *fc.PredictedBreachSeconds)
	}
	if !fc.BreachForecast {
		t.Fatalf("horizon within window must raise a breach forecast")
	}
}

func TestForecast_RisingSlowlyStaysSilentWhenHorizonBeyondWindow(t *testing.T) {
	t.Parallel()
	// Lag rises very slowly: +1s lag every 60s step → slope ~0.0167/s. From a
	// low base of 30 toward 300 objective, the horizon is thousands of seconds,
	// far beyond a 300s window → no breach forecast even though it is rising.
	f := NewForecaster(Config{BreachWindow: 300 * time.Second})
	step := 60 * time.Second
	samples := series(30, step, func(i int) float64 { return 30 + float64(i)*1 }, nil)
	fc := f.Forecast(samples, 300)

	if fc.LagTrendSlope <= 0 {
		t.Fatalf("expected a small positive slope, got %v", fc.LagTrendSlope)
	}
	if fc.PredictedBreachSeconds == nil {
		t.Fatalf("a positive slope under objective should give a finite (large) horizon")
	}
	if *fc.PredictedBreachSeconds <= 300 {
		t.Fatalf("slow rise horizon should exceed the 300s window, got %v", *fc.PredictedBreachSeconds)
	}
	if fc.BreachForecast {
		t.Fatalf("horizon beyond window must NOT raise a breach forecast: %+v", fc)
	}
}

func TestForecast_RecoveringLagHasNoHorizon(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{BreachWindow: 10 * time.Minute})
	// Lag falls from 250 toward 30 — recovering. No finite breach horizon.
	step := 15 * time.Second
	samples := series(25, step, func(i int) float64 {
		v := 250 - float64(i)*10
		if v < 10 {
			v = 10
		}
		return v
	}, nil)
	fc := f.Forecast(samples, 300)

	if fc.LagTrendSlope >= 0 {
		t.Fatalf("recovering lag should have a negative slope, got %v", fc.LagTrendSlope)
	}
	if fc.PredictedBreachSeconds != nil {
		t.Fatalf("recovering lag must have no breach horizon, got %v", *fc.PredictedBreachSeconds)
	}
	if fc.BreachForecast {
		t.Fatalf("recovering lag must not fire a breach forecast")
	}
}

func TestForecast_ThroughputCollapseDetected(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{CollapseFraction: 0.25})
	step := 10 * time.Second
	// Throughput holds at 1e6 for the first half, then collapses toward ~0 in
	// the second half (source failure). Lag flat so the collapse is the only
	// signal under test.
	n := 30
	samples := series(n, step,
		func(i int) float64 { return 40 }, // flat lag
		func(i int) float64 {
			if i < n/2 {
				return 1_000_000
			}
			// Linear collapse from 1e6 down to ~0 across the back half.
			frac := float64(n-1-i) / float64(n-1-n/2)
			if frac < 0 {
				frac = 0
			}
			return 1_000_000 * frac
		},
	)
	fc := f.Forecast(samples, 300)

	if fc.PeakSmoothedThroughputBPS < 500_000 {
		t.Fatalf("expected a meaningful throughput peak, got %v", fc.PeakSmoothedThroughputBPS)
	}
	if fc.ThroughputTrendSlope >= 0 {
		t.Fatalf("collapsing throughput should have a negative slope, got %v", fc.ThroughputTrendSlope)
	}
	if !fc.ThroughputCollapse {
		t.Fatalf("expected throughput collapse to be detected: smoothed=%v peak=%v slope=%v",
			fc.SmoothedThroughputBPS, fc.PeakSmoothedThroughputBPS, fc.ThroughputTrendSlope)
	}
}

func TestForecast_SteadyThroughputNoCollapse(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{})
	step := 10 * time.Second
	// Throughput steady at 1e6 → no collapse.
	samples := series(30, step, func(i int) float64 { return 40 }, func(i int) float64 { return 1_000_000 })
	fc := f.Forecast(samples, 300)
	if fc.ThroughputCollapse {
		t.Fatalf("steady throughput must not be flagged as collapse: %+v", fc)
	}
}

func TestForecast_TooFewSamplesNotComputable(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{MinSamplesForTrend: 3})
	samples := series(2, 30*time.Second, func(i int) float64 { return 30 }, nil)
	fc := f.Forecast(samples, 300)
	if fc.Computable {
		t.Fatalf("2 samples (< MinSamplesForTrend=3) must not be computable")
	}
	if fc.BreachForecast || fc.ThroughputCollapse {
		t.Fatalf("non-computable forecast must not raise any signal")
	}
}

func TestForecast_EmptySamples(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{})
	fc := f.Forecast(nil, 300)
	if fc.Computable || fc.BreachForecast || fc.SampleCount != 0 {
		t.Fatalf("empty input must be an empty, silent forecast: %+v", fc)
	}
}

// TestEWMA_FirstOrderConvergence checks the EWMA/Holt level recurrence directly:
// with a constant input x and alpha, the smoothed level must converge toward x,
// and after k steps the error decays like (1-alpha)^k from the initial offset.
func TestEWMA_FirstOrderConvergence(t *testing.T) {
	t.Parallel()
	const alpha = 0.4
	f := NewForecaster(Config{LagAlpha: alpha, LagBeta: 0.3, MinSamplesForTrend: 2})

	// Start the lag at 0 then hold a constant 100; the level should climb toward
	// 100. With a pure first-order EWMA the offset after k steps would be
	// (1-alpha)^k * 100; Holt's trend term makes convergence faster, so the
	// remaining error must be no larger than the first-order bound.
	const target = 100.0
	const k = 10
	lag := func(i int) float64 {
		if i == 0 {
			return 0
		}
		return target
	}
	samples := series(k+1, 1*time.Second, lag, nil)
	fc := f.Forecast(samples, 100000) // huge objective so no breach noise

	firstOrderBound := math.Pow(1-alpha, k) * target
	gotErr := math.Abs(target - fc.SmoothedLagSeconds)
	if gotErr > firstOrderBound+1e-9 {
		t.Fatalf("EWMA did not converge: error=%v exceeds first-order bound=%v (level=%v)",
			gotErr, firstOrderBound, fc.SmoothedLagSeconds)
	}
}

// TestTrendSlope_PerSecondUnitsAreSamplingInvariant verifies the slope is in
// per-second units: two series with the SAME per-second rise but DIFFERENT
// sampling intervals must converge to the same slope (~the per-second rate),
// which is what makes the horizon extrapolation correct under uneven sampling.
func TestTrendSlope_PerSecondUnitsAreSamplingInvariant(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{LagAlpha: 0.5, LagBeta: 0.5})

	// Rate: 2 seconds of lag per second of wall clock.
	const ratePerSec = 2.0

	// Series A: 10s spacing → +20 lag per step.
	a := series(40, 10*time.Second, func(i int) float64 { return float64(i) * 10 * ratePerSec }, nil)
	// Series B: 30s spacing → +60 lag per step (same per-second rate).
	b := series(40, 30*time.Second, func(i int) float64 { return float64(i) * 30 * ratePerSec }, nil)

	fa := f.Forecast(a, 1<<30)
	fb := f.Forecast(b, 1<<30)

	if math.Abs(fa.LagTrendSlope-ratePerSec) > 0.05 {
		t.Fatalf("series A slope %v should converge to %v/s", fa.LagTrendSlope, ratePerSec)
	}
	if math.Abs(fb.LagTrendSlope-ratePerSec) > 0.05 {
		t.Fatalf("series B slope %v should converge to %v/s", fb.LagTrendSlope, ratePerSec)
	}
	if math.Abs(fa.LagTrendSlope-fb.LagTrendSlope) > 0.05 {
		t.Fatalf("per-second slope must be sampling-invariant: A=%v B=%v", fa.LagTrendSlope, fb.LagTrendSlope)
	}
}

func TestForecast_DedupHandlesDuplicateTimestamps(t *testing.T) {
	t.Parallel()
	f := NewForecaster(Config{})
	samples := series(10, 10*time.Second, func(i int) float64 { return 30 }, nil)
	// Duplicate a couple of timestamps (Kafka redelivery) — must not panic or
	// produce NaN from a zero dt.
	samples = append(samples, samples[3], samples[7])
	fc := f.Forecast(samples, 300)
	if math.IsNaN(fc.SmoothedLagSeconds) || math.IsNaN(fc.LagTrendSlope) {
		t.Fatalf("duplicate timestamps produced NaN: %+v", fc)
	}
	if math.Abs(fc.SmoothedLagSeconds-30) > 1.0 {
		t.Fatalf("dedup should preserve a flat series near 30, got %v", fc.SmoothedLagSeconds)
	}
}

func TestConfig_ValidateRejectsOutOfRange(t *testing.T) {
	t.Parallel()
	if err := (Config{LagAlpha: 1.5}).Validate(); err == nil {
		t.Fatal("LagAlpha > 1 must be rejected")
	}
	if err := (Config{CollapseFraction: 1.0}).Validate(); err == nil {
		t.Fatal("CollapseFraction >= 1 must be rejected")
	}
	if err := (Config{LagAlpha: 0.4, LagBeta: 0.3}).Validate(); err != nil {
		t.Fatalf("in-range config must validate: %v", err)
	}
	if err := (Config{}).Validate(); err != nil {
		t.Fatalf("zero config (all defaults) must validate: %v", err)
	}
}

func TestToPrediction_MapsFields(t *testing.T) {
	t.Parallel()
	h := 42.5
	fc := Forecast{
		SmoothedLagSeconds:     120,
		LagTrendSlope:          0.5,
		ThroughputTrendSlope:   -100,
		PredictedBreachSeconds: &h,
		BreachForecast:         true,
		ThroughputCollapse:     true,
		RPOObjectiveSeconds:    300,
		SampleCount:            12,
	}
	now := base
	p := fc.ToPrediction("t1", "s1", "group-a", now)
	if p.TenantID != "t1" || p.StreamID != "s1" || p.GroupLabel != "group-a" {
		t.Fatalf("identity not mapped: %+v", p)
	}
	if p.PredictedBreachSeconds == nil || *p.PredictedBreachSeconds != 42.5 {
		t.Fatalf("breach horizon not mapped: %+v", p.PredictedBreachSeconds)
	}
	if !p.BreachForecast || !p.ThroughputCollapse {
		t.Fatalf("flags not mapped: %+v", p)
	}
	if p.SampleCount != 12 || p.RPOObjectiveSeconds != 300 {
		t.Fatalf("scalar fields not mapped: %+v", p)
	}
	if !p.ForecastAt.Equal(now.UTC()) {
		t.Fatalf("forecast time not stamped: %v", p.ForecastAt)
	}
}

func TestToPrediction_DropsInfiniteHorizon(t *testing.T) {
	t.Parallel()
	inf := math.Inf(1)
	fc := Forecast{PredictedBreachSeconds: &inf}
	p := fc.ToPrediction("t1", "s1", "g", base)
	if p.PredictedBreachSeconds != nil {
		t.Fatalf("infinite horizon must be dropped to nil, got %v", *p.PredictedBreachSeconds)
	}
}
