package dto

// This file defines the READ-ONLY PROCESS-MINING DTOs returned by the
// WorkflowMiningHandler under /api/v1/workflows/analytics/{definitionKey}/...
// They are the process-intelligence "moat" primitives (variant discovery,
// conformance checking, path-frequency heatmap, what-if simulation) mined from
// the ALREADY-persisted event trail (workflow_instances +
// workflow_step_executions) against the model step graph (workflow_definitions).
//
// NOTHING here mutates engine or state-model data. Every underlying query is
// tenant-scoped by the repository (RLS), so a DTO never carries cross-tenant
// data. Durations are reported in MILLISECONDS (int64) — the exact shape a
// frontend heatmap wants to overlay on the @xyflow canvas — except the variant
// cycle-time stats, which carry seconds (float) to match the existing
// CycleTimeStats vocabulary. Frequencies are percentages (0..100).

// -----------------------------------------------------------------------------
// (1) VARIANT DISCOVERY
// -----------------------------------------------------------------------------

// Variant is one distinct executed PATH (an ordered sequence of step_ids) across
// the instances of a definition lineage. Instances whose step sequence is
// byte-for-byte identical are grouped into the same variant. Count is the number
// of instances that followed this exact path; FrequencyPct is Count / total
// (analysed instances) * 100. The cycle-time percentiles are computed over the
// COMPLETED instances of the variant (P50/P90 seconds); when a variant has no
// completed instance the percentiles are zero and CompletedCount is 0.
type Variant struct {
	// Rank is 1-based; the most frequent variant is rank 1. The long-tail bucket
	// (see VariantReport.LongTail) is not ranked (Rank 0).
	Rank int `json:"rank"`
	// Sequence is the ordered list of step_ids the instances of this variant
	// executed, in start-time order within each instance.
	Sequence []string `json:"sequence"`
	// Count is the number of instances that followed this exact sequence.
	Count int `json:"count"`
	// FrequencyPct is Count / total-analysed-instances * 100 (0..100).
	FrequencyPct float64 `json:"frequency_pct"`
	// CompletedCount is how many of Count instances reached a terminal
	// 'completed' status (the denominator for the cycle-time percentiles).
	CompletedCount int `json:"completed_count"`
	// P50Seconds / P90Seconds are the median / 90th-percentile end-to-end cycle
	// time (completed_at - started_at) over the variant's completed instances.
	P50Seconds float64 `json:"p50_seconds"`
	P90Seconds float64 `json:"p90_seconds"`
	// Conformant is set by the conformance pass (VariantReport does NOT populate
	// it; ConformanceReport does). Kept here so the two reports can share the
	// Variant vocabulary. When unset by the variant-only path it is true by
	// default and Deviations is nil.
	Conformant bool `json:"conformant"`
}

// LongTailBucket rolls up all variants beyond the top-N into a single summary so
// the response stays bounded regardless of how fragmented the process is. It is
// the classic process-mining "long tail" of rare, mostly one-off paths.
type LongTailBucket struct {
	// VariantCount is how many DISTINCT variants were folded into the tail.
	VariantCount int `json:"variant_count"`
	// InstanceCount is the total instances across those tail variants.
	InstanceCount int `json:"instance_count"`
	// FrequencyPct is InstanceCount / total-analysed * 100.
	FrequencyPct float64 `json:"frequency_pct"`
}

// VariantReport is the response for GET /analytics/{definitionKey}/variants. It
// carries the top-N variants (most frequent first) plus the long-tail bucket and
// the totals so a caller can verify the frequencies sum to ~100%.
type VariantReport struct {
	DefinitionKey string `json:"definition_key"`
	WindowDays    int    `json:"window_days"`
	// TotalInstances is the number of analysed instances (the frequency
	// denominator).
	TotalInstances int `json:"total_instances"`
	// DistinctVariants is the number of distinct paths observed (including those
	// folded into the long tail).
	DistinctVariants int `json:"distinct_variants"`
	// TopN is the number of variants returned individually (the rest are in
	// LongTail).
	TopN     int             `json:"top_n"`
	Variants []Variant       `json:"variants"`
	LongTail *LongTailBucket `json:"long_tail,omitempty"`
}

// -----------------------------------------------------------------------------
// (2) CONFORMANCE CHECKING
// -----------------------------------------------------------------------------

// DeviationKind classifies why a variant does not conform to the model graph.
type DeviationKind string

const (
	// DeviationUndeclaredStep is a step_id in the executed path that the model
	// does not declare at all.
	DeviationUndeclaredStep DeviationKind = "undeclared_step"
	// DeviationIllegalTransition is an executed (from -> to) hop that the model's
	// allowed-transition set does not contain.
	DeviationIllegalTransition DeviationKind = "illegal_transition"
	// DeviationSkippedRequiredStep is a model step that the variant never visited
	// (present in the model, absent from the executed path).
	DeviationSkippedRequiredStep DeviationKind = "skipped_required_step"
)

// Deviation is a single non-conformance a variant exhibits versus the model.
// From/To are populated for an illegal transition; Step for an undeclared or
// skipped step.
type Deviation struct {
	Kind DeviationKind `json:"kind"`
	Step string        `json:"step,omitempty"`
	From string        `json:"from,omitempty"`
	To   string        `json:"to,omitempty"`
}

// VariantConformance pairs a discovered variant with the deviations it exhibits
// against the model. Conformant is true iff Deviations is empty.
type VariantConformance struct {
	Rank         int         `json:"rank"`
	Sequence     []string    `json:"sequence"`
	Count        int         `json:"count"`
	FrequencyPct float64     `json:"frequency_pct"`
	Conformant   bool        `json:"conformant"`
	Deviations   []Deviation `json:"deviations,omitempty"`
}

// ConformanceReport is the response for GET
// /analytics/{definitionKey}/conformance. ConformanceScore is the fraction
// (0..1) of ANALYSED INSTANCES that followed a fully conformant variant (i.e. a
// variant with zero deviations). DeviatingVariants lists only the variants that
// exhibit at least one deviation, most-frequent first.
type ConformanceReport struct {
	DefinitionKey    string `json:"definition_key"`
	WindowDays       int    `json:"window_days"`
	TotalInstances   int    `json:"total_instances"`
	DistinctVariants int    `json:"distinct_variants"`
	// ConformantInstances is the instance count following conformant variants;
	// ConformanceScore = ConformantInstances / TotalInstances.
	ConformantInstances int     `json:"conformant_instances"`
	ConformanceScore    float64 `json:"conformance_score"`
	// ModelSteps is the count of steps declared in the model graph (context for
	// skipped-step deviations).
	ModelSteps        int                  `json:"model_steps"`
	DeviatingVariants []VariantConformance `json:"deviating_variants"`
}

// -----------------------------------------------------------------------------
// (3) PATH-FREQUENCY / HEATMAP
// -----------------------------------------------------------------------------

// HeatNode is one step node for the frontend heatmap overlay: Visits drives the
// node "heat" (frequency) and MedianMs the duration tint. StepType lets the UI
// pick the node glyph.
type HeatNode struct {
	StepID   string `json:"step_id"`
	StepType string `json:"step_type,omitempty"`
	Visits   int    `json:"visits"`
	MedianMs int64  `json:"median_ms"`
}

// HeatEdge is one directed transition edge (From -> To) with the observed
// traversal count driving the edge weight/thickness.
type HeatEdge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Count int    `json:"count"`
}

// HeatmapReport is the response for GET /analytics/{definitionKey}/map. It is the
// compact {nodes, edges} shape a frontend overlays on the @xyflow canvas: node
// heat = visits/median duration, edge weight = traversal count. Nodes and edges
// are sorted deterministically (visits desc then step_id; count desc then
// from,to) so the payload is stable.
type HeatmapReport struct {
	DefinitionKey  string     `json:"definition_key"`
	WindowDays     int        `json:"window_days"`
	TotalInstances int        `json:"total_instances"`
	Nodes          []HeatNode `json:"nodes"`
	Edges          []HeatEdge `json:"edges"`
}

// -----------------------------------------------------------------------------
// (4) WHAT-IF SIMULATION
// -----------------------------------------------------------------------------

// SimulationOverride is an optional what-if lever applied to the observed process
// before the Monte-Carlo roll-up. All fields are optional; an empty override
// simulates the process AS-OBSERVED (a useful baseline/sanity check).
type SimulationOverride struct {
	// RemoveSteps drops these step_ids from every sampled path (models removing /
	// automating a step to zero duration). The path's other steps are unaffected.
	RemoveSteps []string `json:"remove_steps,omitempty"`
	// ParallelizeSteps models running these steps CONCURRENTLY within any path
	// that contains more than one of them: their contribution collapses to the
	// MAX of the group's sampled durations rather than the SUM. Steps not in a
	// path are ignored.
	ParallelizeSteps []string `json:"parallelize_steps,omitempty"`
	// StepDurationScale multiplies a step's sampled duration by the given factor
	// (e.g. 0.5 = "twice as fast"). Keyed by step_id. Factors are clamped to
	// [0, 10]. A step absent from the map is unscaled.
	StepDurationScale map[string]float64 `json:"step_duration_scale,omitempty"`
}

// SimulationRequest is the POST /analytics/{definitionKey}/simulate body. The
// definitionKey comes from the path. Iterations and Seed make the run bounded and
// deterministic-reproducible; both are clamped/defaulted server-side.
type SimulationRequest struct {
	// WindowDays bounds the historical event log the duration distributions are
	// sampled from (defaulted/clamped like every other report).
	WindowDays int `json:"window_days,omitempty"`
	// Iterations is the Monte-Carlo sample count; defaulted and hard-capped
	// server-side so a caller cannot request an unbounded run.
	Iterations int `json:"iterations,omitempty"`
	// Seed makes the run reproducible: the same seed + inputs yields the same
	// distribution. Defaulted server-side when zero.
	Seed int64 `json:"seed,omitempty"`
	// Override is the optional what-if lever set (nil = simulate as-observed).
	Override *SimulationOverride `json:"override,omitempty"`
}

// SimulationReport is the response for POST /analytics/{definitionKey}/simulate.
// It is explicitly labelled an ESTIMATE (Estimate=true, Method describes the
// technique) — it is NOT a prediction. The percentiles/mean are over the sampled
// cycle-time distribution in MILLISECONDS.
type SimulationReport struct {
	DefinitionKey string `json:"definition_key"`
	WindowDays    int    `json:"window_days"`
	// Estimate is always true: this is a Monte-Carlo estimate over the historical
	// duration distributions, not a guarantee. The frontend MUST surface it as an
	// estimate.
	Estimate bool `json:"estimate"`
	// Method names the estimation technique for transparency.
	Method string `json:"method"`
	// Iterations / Seed echo the (clamped/defaulted) values actually used so the
	// run is reproducible.
	Iterations int   `json:"iterations"`
	Seed       int64 `json:"seed"`
	// SampledVariants is how many distinct path variants the branch sampler chose
	// among (weighted by observed frequency).
	SampledVariants int `json:"sampled_variants"`
	// BaselineP50Ms is the AS-OBSERVED p50 (no override) for comparison, so the
	// caller can read the delta the override produced. Equal to P50Ms when the
	// request carried no override.
	BaselineP50Ms int64 `json:"baseline_p50_ms"`
	BaselineP90Ms int64 `json:"baseline_p90_ms"`
	// P50/P90/Mean are the estimated cycle-time distribution (milliseconds) AFTER
	// applying the override.
	P50Ms  int64 `json:"p50_ms"`
	P90Ms  int64 `json:"p90_ms"`
	MeanMs int64 `json:"mean_ms"`
	// Applied echoes back the override that was applied (nil when as-observed).
	Applied *SimulationOverride `json:"applied,omitempty"`
	// Notes carries any degradation notices (e.g. "no completed instances in
	// window; simulation is empty").
	Notes []string `json:"notes,omitempty"`
}
