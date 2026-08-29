package dto

// This file defines the READ-ONLY process-analytics DTOs returned by the
// WorkflowAnalyticsHandler under /api/v1/workflows/analytics. They mine the
// already-persisted event trail (workflow_instances + workflow_step_executions)
// into the four process-intelligence dimensions — cycle time, bottlenecks,
// rework, throughput — with NO engine / state-model change. Durations are
// reported in SECONDS (float, so sub-second precision survives) so the frontend
// can format them however it likes; counts are plain ints. Every response is
// tenant-scoped by the repository (RLS), so a DTO never carries cross-tenant data.

// CycleTimeStats holds the end-to-end duration distribution for a single
// definition lineage (grouped by definition_key + version). Durations are in
// seconds and computed as (completed_at - started_at) over COMPLETED instances
// only (running/failed/cancelled are excluded from the completed-time
// distribution but surface in throughput/failure metrics).
type CycleTimeStats struct {
	DefinitionKey  string  `json:"definition_key"`
	DefinitionName string  `json:"definition_name"`
	Version        int     `json:"version"`
	CompletedCount int     `json:"completed_count"`
	MeanSeconds    float64 `json:"mean_seconds"`
	P50Seconds     float64 `json:"p50_seconds"`
	P90Seconds     float64 `json:"p90_seconds"`
	P95Seconds     float64 `json:"p95_seconds"`
	MinSeconds     float64 `json:"min_seconds"`
	MaxSeconds     float64 `json:"max_seconds"`
}

// CycleTimeReport is the response for GET /analytics/{definitionKey}/cycle-time.
// It carries the per-version breakdown for the requested definition lineage,
// most-recent version first.
type CycleTimeReport struct {
	DefinitionKey string           `json:"definition_key"`
	WindowDays    int              `json:"window_days"`
	Versions      []CycleTimeStats `json:"versions"`
}

// StepBottleneck holds the duration distribution and rework rate for a single
// step across all instances of the tenant (optionally filtered to one
// definition lineage). WaitSeconds is the queue/wait portion (time from the
// step execution starting to the human task being claimed, when a task exists);
// WorkSeconds is the remaining active portion. When no task-claim timestamp is
// available the split is zero and the total duration is reported as work.
type StepBottleneck struct {
	StepID         string  `json:"step_id"`
	StepType       string  `json:"step_type"`
	ExecutionCount int     `json:"execution_count"`
	MedianSeconds  float64 `json:"median_seconds"`
	P90Seconds     float64 `json:"p90_seconds"`
	MeanSeconds    float64 `json:"mean_seconds"`
	MaxSeconds     float64 `json:"max_seconds"`
	// WaitSeconds / WorkSeconds are MEDIANS of the wait vs. work split for the
	// step (queue time before claim vs. active time). Zero when no claim
	// timestamp is available for the step (e.g. non-human steps).
	WaitSeconds float64 `json:"wait_seconds"`
	WorkSeconds float64 `json:"work_seconds"`
	// ReworkRate is the fraction (0..1) of this step's executions that ran on
	// attempt > 1 — i.e. a retry / rework of the step.
	ReworkRate float64 `json:"rework_rate"`
}

// BottleneckReport is the response for GET /analytics/bottlenecks. Steps are
// ranked slowest-first by P90 duration so the biggest process constraints
// surface at the top. DefinitionKey is empty when the report spans all
// definitions of the tenant.
type BottleneckReport struct {
	DefinitionKey string           `json:"definition_key"`
	WindowDays    int              `json:"window_days"`
	Steps         []StepBottleneck `json:"steps"`
}

// ReworkStat holds the rework rate for one scope. When StepID is empty the row
// is the per-definition aggregate; otherwise it is a per-step row within that
// definition. TotalExecutions is the denominator, ReworkExecutions the
// attempt>1 numerator.
type ReworkStat struct {
	DefinitionKey    string  `json:"definition_key"`
	DefinitionName   string  `json:"definition_name"`
	StepID           string  `json:"step_id,omitempty"`
	TotalExecutions  int     `json:"total_executions"`
	ReworkExecutions int     `json:"rework_executions"`
	ReworkRate       float64 `json:"rework_rate"`
}

// ReworkReport is the response for GET /analytics/rework. It carries both the
// per-definition aggregates and the per-step breakdown so a caller can see
// which definitions and which steps within them are churning.
type ReworkReport struct {
	WindowDays    int          `json:"window_days"`
	PerDefinition []ReworkStat `json:"per_definition"`
	PerStep       []ReworkStat `json:"per_step"`
}

// ThroughputBucket is one time bucket of started vs. completed instance counts.
// BucketStart is the DATE_TRUNC'd bucket boundary in RFC3339.
type ThroughputBucket struct {
	BucketStart string `json:"bucket_start"`
	Started     int    `json:"started"`
	Completed   int    `json:"completed"`
	Failed      int    `json:"failed"`
}

// ThroughputReport is the response for GET /analytics/throughput. Interval is
// the DATE_TRUNC granularity ("day" or "week"). ActiveCount is the current
// in-flight instance count (running + suspended + incident); FailureRate is the
// fraction of terminal instances in the window that ended failed/incident.
type ThroughputReport struct {
	Interval       string             `json:"interval"`
	WindowDays     int                `json:"window_days"`
	Buckets        []ThroughputBucket `json:"buckets"`
	TotalStarted   int                `json:"total_started"`
	TotalCompleted int                `json:"total_completed"`
	TotalFailed    int                `json:"total_failed"`
	ActiveCount    int                `json:"active_count"`
	FailureRate    float64            `json:"failure_rate"`
}
