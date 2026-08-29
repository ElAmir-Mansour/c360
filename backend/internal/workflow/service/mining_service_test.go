package service

import (
	"context"
	"math"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/repository"
)

// fakeMiningRepo is a hand double for miningRepository. It returns canned paths /
// duration samples / definition graph so the service's grouping, conformance,
// heatmap, and simulation logic can be asserted deterministically without a DB.
type fakeMiningRepo struct {
	paths    []repository.InstancePath
	samples  []repository.StepDurationSample
	graph    *repository.DefinitionGraph
	graphErr error
}

func (f *fakeMiningRepo) InstancePaths(_ context.Context, _, _ string, _ int) ([]repository.InstancePath, error) {
	return f.paths, nil
}
func (f *fakeMiningRepo) StepDurationSamples(_ context.Context, _, _ string, _ int) ([]repository.StepDurationSample, error) {
	return f.samples, nil
}
func (f *fakeMiningRepo) LoadDefinitionGraph(_ context.Context, _, _ string) (*repository.DefinitionGraph, error) {
	return f.graph, f.graphErr
}

func newMiningSvc(repo miningRepository) *MiningService {
	return NewMiningService(repo, zerolog.Nop())
}

// sampleGraph is the reference model used by conformance tests:
// start -> review -> {approve, reject}; approve/reject are ends.
func sampleGraph() *repository.DefinitionGraph {
	return &repository.DefinitionGraph{
		DefinitionKey: "k",
		Name:          "Contract Review",
		Version:       1,
		Steps: map[string]string{
			"start": "service_task", "review": "human_task",
			"approve": "end", "reject": "end",
		},
		StepOrder: []string{"start", "review", "approve", "reject"},
		AllowedTransitions: map[string]map[string]struct{}{
			"start":   {"review": {}},
			"review":  {"approve": {}, "reject": {}},
			"approve": {},
			"reject":  {},
		},
	}
}

// -----------------------------------------------------------------------------
// (1) VARIANT DISCOVERY: grouping correctness + frequency sums to 100%.
// -----------------------------------------------------------------------------

func TestMining_VariantsGroupingAndFrequencySumsTo100(t *testing.T) {
	// 5 instances: 3 follow start->review->approve, 2 follow start->review->reject.
	repo := &fakeMiningRepo{paths: []repository.InstancePath{
		{InstanceID: "1", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 1000},
		{InstanceID: "2", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 3000},
		{InstanceID: "3", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 5000},
		{InstanceID: "4", Sequence: []string{"start", "review", "reject"}, Completed: true, CycleMs: 2000},
		{InstanceID: "5", Sequence: []string{"start", "review", "reject"}, Completed: true, CycleMs: 4000},
	}}
	svc := newMiningSvc(repo)

	report, err := svc.Variants(context.Background(), "t", "k", 30, 0)
	if err != nil {
		t.Fatalf("Variants() error = %v", err)
	}
	if report.TotalInstances != 5 || report.DistinctVariants != 2 {
		t.Fatalf("totals = %d instances / %d variants, want 5/2", report.TotalInstances, report.DistinctVariants)
	}
	if len(report.Variants) != 2 {
		t.Fatalf("variants len = %d, want 2", len(report.Variants))
	}
	// Most-frequent first: approve variant (count 3) ranks 1.
	v0 := report.Variants[0]
	if v0.Rank != 1 || v0.Count != 3 || v0.Sequence[2] != "approve" {
		t.Fatalf("variant[0] = %+v, want rank1 count3 approve", v0)
	}
	if math.Abs(v0.FrequencyPct-60.0) > 1e-9 {
		t.Fatalf("variant[0] freq = %v, want 60", v0.FrequencyPct)
	}
	// p50 of {1000,3000,5000} ms = 3000ms = 3.0s (nearest-rank).
	if math.Abs(v0.P50Seconds-3.0) > 1e-9 {
		t.Fatalf("variant[0] p50 = %vs, want 3.0", v0.P50Seconds)
	}
	v1 := report.Variants[1]
	if v1.Count != 2 || math.Abs(v1.FrequencyPct-40.0) > 1e-9 {
		t.Fatalf("variant[1] = %+v, want count2 freq40", v1)
	}
	// Frequencies sum to 100% across the individually-returned variants (no long
	// tail here since topN default 10 > 2 distinct).
	var sum float64
	for _, v := range report.Variants {
		sum += v.FrequencyPct
	}
	if math.Abs(sum-100.0) > 1e-9 {
		t.Fatalf("frequency sum = %v, want 100", sum)
	}
	if report.LongTail != nil {
		t.Fatalf("LongTail should be nil when all variants fit in topN, got %+v", report.LongTail)
	}
}

func TestMining_VariantsLongTailBucketAndFrequencyClosure(t *testing.T) {
	// 4 distinct variants, topN=2 -> 2 individual + a 2-variant long tail. The
	// individual freqs + the long-tail freq must sum to 100%.
	repo := &fakeMiningRepo{paths: []repository.InstancePath{
		{InstanceID: "1", Sequence: []string{"a"}, Completed: true, CycleMs: 100},
		{InstanceID: "2", Sequence: []string{"a"}, Completed: true, CycleMs: 100},
		{InstanceID: "3", Sequence: []string{"a"}, Completed: true, CycleMs: 100}, // a: 3
		{InstanceID: "4", Sequence: []string{"b"}, Completed: true, CycleMs: 100},
		{InstanceID: "5", Sequence: []string{"b"}, Completed: true, CycleMs: 100}, // b: 2
		{InstanceID: "6", Sequence: []string{"c"}, Completed: true, CycleMs: 100}, // c: 1
		{InstanceID: "7", Sequence: []string{"d"}, Completed: true, CycleMs: 100}, // d: 1
	}}
	svc := newMiningSvc(repo)

	report, err := svc.Variants(context.Background(), "t", "k", 30, 2)
	if err != nil {
		t.Fatalf("Variants() error = %v", err)
	}
	if report.TotalInstances != 7 || report.DistinctVariants != 4 {
		t.Fatalf("totals = %d/%d, want 7/4", report.TotalInstances, report.DistinctVariants)
	}
	if len(report.Variants) != 2 {
		t.Fatalf("individual variants = %d, want 2 (topN)", len(report.Variants))
	}
	if report.LongTail == nil {
		t.Fatal("LongTail should be present, got nil")
	}
	if report.LongTail.VariantCount != 2 || report.LongTail.InstanceCount != 2 {
		t.Fatalf("LongTail = %+v, want 2 variants / 2 instances", report.LongTail)
	}
	// Closure: individual freqs + tail freq == 100%.
	sum := report.LongTail.FrequencyPct
	for _, v := range report.Variants {
		sum += v.FrequencyPct
	}
	if math.Abs(sum-100.0) > 1e-9 {
		t.Fatalf("freq closure = %v, want 100", sum)
	}
}

func TestMining_VariantsEmptyAndRequiresKey(t *testing.T) {
	svc := newMiningSvc(&fakeMiningRepo{})
	if _, err := svc.Variants(context.Background(), "t", "", 0, 0); err == nil {
		t.Fatal("Variants() empty key: want error")
	}
	// No instances -> empty report, no panic, no long tail.
	report, err := svc.Variants(context.Background(), "t", "k", 0, 0)
	if err != nil {
		t.Fatalf("Variants() error = %v", err)
	}
	if report.TotalInstances != 0 || len(report.Variants) != 0 || report.LongTail != nil {
		t.Fatalf("empty report = %+v, unexpected", report)
	}
}

// -----------------------------------------------------------------------------
// (2) CONFORMANCE: flags a known deviation vs the model.
// -----------------------------------------------------------------------------

func TestMining_ConformanceFlagsKnownDeviation(t *testing.T) {
	// 8 conformant (start->review->approve) + 2 deviating: the deviating path
	// takes an ILLEGAL transition start->approve (skipping review, which the
	// model requires) and thus also SKIPS review.
	repo := &fakeMiningRepo{
		graph: sampleGraph(),
		paths: []repository.InstancePath{
			{InstanceID: "1", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "2", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "3", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "4", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "5", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "6", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "7", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "8", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "9", Sequence: []string{"start", "approve"}, Completed: true, CycleMs: 100},
			{InstanceID: "10", Sequence: []string{"start", "approve"}, Completed: true, CycleMs: 100},
		},
	}
	svc := newMiningSvc(repo)

	report, err := svc.Conformance(context.Background(), "t", "k", 30)
	if err != nil {
		t.Fatalf("Conformance() error = %v", err)
	}
	if report.TotalInstances != 10 || report.DistinctVariants != 2 {
		t.Fatalf("totals = %d/%d, want 10/2", report.TotalInstances, report.DistinctVariants)
	}
	// 8 of 10 instances conformant -> score 0.8.
	if report.ConformantInstances != 8 || math.Abs(report.ConformanceScore-0.8) > 1e-9 {
		t.Fatalf("conformance = %d instances / score %v, want 8 / 0.8", report.ConformantInstances, report.ConformanceScore)
	}
	if len(report.DeviatingVariants) != 1 {
		t.Fatalf("deviating variants = %d, want 1", len(report.DeviatingVariants))
	}
	dv := report.DeviatingVariants[0]
	if dv.Count != 2 || dv.Conformant {
		t.Fatalf("deviating variant = %+v, unexpected", dv)
	}
	// It must flag BOTH the illegal transition start->approve AND the skipped
	// required step review.
	var hasIllegal, hasSkipped bool
	for _, d := range dv.Deviations {
		if d.Kind == dto.DeviationIllegalTransition && d.From == "start" && d.To == "approve" {
			hasIllegal = true
		}
		if d.Kind == dto.DeviationSkippedRequiredStep && d.Step == "review" {
			hasSkipped = true
		}
	}
	if !hasIllegal {
		t.Fatalf("expected illegal transition start->approve, deviations = %+v", dv.Deviations)
	}
	if !hasSkipped {
		t.Fatalf("expected skipped required step review, deviations = %+v", dv.Deviations)
	}
}

func TestMining_ConformanceFlagsUndeclaredStep(t *testing.T) {
	// A variant visits a step the model does not declare ("adhoc") -> undeclared.
	repo := &fakeMiningRepo{
		graph: sampleGraph(),
		paths: []repository.InstancePath{
			{InstanceID: "1", Sequence: []string{"start", "review", "adhoc", "approve"}, Completed: true, CycleMs: 100},
		},
	}
	svc := newMiningSvc(repo)
	report, err := svc.Conformance(context.Background(), "t", "k", 30)
	if err != nil {
		t.Fatalf("Conformance() error = %v", err)
	}
	if report.ConformanceScore != 0 || len(report.DeviatingVariants) != 1 {
		t.Fatalf("report = %+v, want score 0 / 1 deviating", report)
	}
	var hasUndeclared bool
	for _, d := range report.DeviatingVariants[0].Deviations {
		if d.Kind == dto.DeviationUndeclaredStep && d.Step == "adhoc" {
			hasUndeclared = true
		}
	}
	if !hasUndeclared {
		t.Fatalf("expected undeclared step adhoc, deviations = %+v", report.DeviatingVariants[0].Deviations)
	}
}

func TestMining_ConformanceAllConformantScoreIsOne(t *testing.T) {
	repo := &fakeMiningRepo{
		graph: sampleGraph(),
		paths: []repository.InstancePath{
			{InstanceID: "1", Sequence: []string{"start", "review", "approve"}, Completed: true},
			{InstanceID: "2", Sequence: []string{"start", "review", "reject"}, Completed: true},
		},
	}
	svc := newMiningSvc(repo)
	report, err := svc.Conformance(context.Background(), "t", "k", 30)
	if err != nil {
		t.Fatalf("Conformance() error = %v", err)
	}
	if report.ConformanceScore != 1.0 || len(report.DeviatingVariants) != 0 {
		t.Fatalf("report = %+v, want score 1.0 / 0 deviating", report)
	}
}

// -----------------------------------------------------------------------------
// (3) HEATMAP: node visit counts + edge traversal counts match the paths.
// -----------------------------------------------------------------------------

func TestMining_HeatmapCountsMatchPaths(t *testing.T) {
	// 3 x start->review->approve, 1 x start->review->reject.
	//   visits: start=4, review=4, approve=3, reject=1
	//   edges: start->review=4, review->approve=3, review->reject=1
	repo := &fakeMiningRepo{
		paths: []repository.InstancePath{
			{InstanceID: "1", Sequence: []string{"start", "review", "approve"}},
			{InstanceID: "2", Sequence: []string{"start", "review", "approve"}},
			{InstanceID: "3", Sequence: []string{"start", "review", "approve"}},
			{InstanceID: "4", Sequence: []string{"start", "review", "reject"}},
		},
		samples: []repository.StepDurationSample{
			{StepID: "review", StepType: "human_task", DurationMs: 1000},
			{StepID: "review", StepType: "human_task", DurationMs: 3000},
			{StepID: "review", StepType: "human_task", DurationMs: 5000},
		},
	}
	svc := newMiningSvc(repo)

	report, err := svc.Heatmap(context.Background(), "t", "k", 30)
	if err != nil {
		t.Fatalf("Heatmap() error = %v", err)
	}
	if report.TotalInstances != 4 {
		t.Fatalf("total instances = %d, want 4", report.TotalInstances)
	}
	visit := map[string]int{}
	median := map[string]int64{}
	stype := map[string]string{}
	for _, n := range report.Nodes {
		visit[n.StepID] = n.Visits
		median[n.StepID] = n.MedianMs
		stype[n.StepID] = n.StepType
	}
	if visit["start"] != 4 || visit["review"] != 4 || visit["approve"] != 3 || visit["reject"] != 1 {
		t.Fatalf("node visits = %v, unexpected", visit)
	}
	// review median of {1000,3000,5000} = 3000ms.
	if median["review"] != 3000 {
		t.Fatalf("review median = %d, want 3000", median["review"])
	}
	if stype["review"] != "human_task" {
		t.Fatalf("review step type = %q, want human_task", stype["review"])
	}
	// Nodes sorted visits desc: start/review (4) before approve (3) before reject (1).
	if report.Nodes[len(report.Nodes)-1].StepID != "reject" {
		t.Fatalf("last node = %q, want reject (lowest visits)", report.Nodes[len(report.Nodes)-1].StepID)
	}

	edge := map[string]int{}
	for _, e := range report.Edges {
		edge[e.From+"->"+e.To] = e.Count
	}
	if edge["start->review"] != 4 || edge["review->approve"] != 3 || edge["review->reject"] != 1 {
		t.Fatalf("edges = %v, unexpected", edge)
	}
	if len(report.Edges) != 3 {
		t.Fatalf("edge count = %d, want 3", len(report.Edges))
	}
	// Edges sorted count desc: the top edge is start->review (4).
	if report.Edges[0].From != "start" || report.Edges[0].To != "review" || report.Edges[0].Count != 4 {
		t.Fatalf("top edge = %+v, want start->review 4", report.Edges[0])
	}
}

// -----------------------------------------------------------------------------
// (4) SIMULATION: deterministic under a fixed seed + bounded + estimate.
// -----------------------------------------------------------------------------

func simRepo() *fakeMiningRepo {
	return &fakeMiningRepo{
		paths: []repository.InstancePath{
			{InstanceID: "1", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 6000},
			{InstanceID: "2", Sequence: []string{"start", "review", "approve"}, Completed: true, CycleMs: 6000},
			{InstanceID: "3", Sequence: []string{"start", "review", "reject"}, Completed: true, CycleMs: 4000},
		},
		samples: []repository.StepDurationSample{
			{StepID: "start", StepType: "service_task", DurationMs: 1000},
			{StepID: "review", StepType: "human_task", DurationMs: 4000},
			{StepID: "review", StepType: "human_task", DurationMs: 4000},
			{StepID: "approve", StepType: "end", DurationMs: 1000},
			{StepID: "reject", StepType: "end", DurationMs: 1000},
		},
	}
}

func TestMining_SimulateDeterministicUnderFixedSeed(t *testing.T) {
	svc := newMiningSvc(simRepo())
	req := dto.SimulationRequest{WindowDays: 30, Iterations: 1000, Seed: 42}

	r1, err := svc.Simulate(context.Background(), "t", "k", req)
	if err != nil {
		t.Fatalf("Simulate() error = %v", err)
	}
	r2, err := svc.Simulate(context.Background(), "t", "k", req)
	if err != nil {
		t.Fatalf("Simulate() rerun error = %v", err)
	}
	// Same seed + inputs -> identical distribution.
	if r1.P50Ms != r2.P50Ms || r1.P90Ms != r2.P90Ms || r1.MeanMs != r2.MeanMs {
		t.Fatalf("non-deterministic: run1 p50/p90/mean = %d/%d/%d, run2 = %d/%d/%d",
			r1.P50Ms, r1.P90Ms, r1.MeanMs, r2.P50Ms, r2.P90Ms, r2.MeanMs)
	}
	if !r1.Estimate {
		t.Fatal("Simulate() Estimate must be true (it is an estimate, not a prediction)")
	}
	if r1.Iterations != 1000 || r1.Seed != 42 {
		t.Fatalf("echoed iterations/seed = %d/%d, want 1000/42", r1.Iterations, r1.Seed)
	}
	// A different seed generally shifts the sampled distribution (sanity that the
	// seed actually feeds the RNG) — but at minimum it must still be bounded.
	if r1.P50Ms <= 0 || r1.P90Ms < r1.P50Ms {
		t.Fatalf("distribution degenerate: p50=%d p90=%d", r1.P50Ms, r1.P90Ms)
	}
}

func TestMining_SimulateIterationsBounded(t *testing.T) {
	svc := newMiningSvc(simRepo())
	// Request an absurd iteration count -> hard-capped at maxSimIterations.
	r, err := svc.Simulate(context.Background(), "t", "k", dto.SimulationRequest{Iterations: 10_000_000})
	if err != nil {
		t.Fatalf("Simulate() error = %v", err)
	}
	if r.Iterations != maxSimIterations {
		t.Fatalf("iterations = %d, want capped at %d", r.Iterations, maxSimIterations)
	}
	// Zero iterations -> default.
	r2, err := svc.Simulate(context.Background(), "t", "k", dto.SimulationRequest{Iterations: 0})
	if err != nil {
		t.Fatalf("Simulate() error = %v", err)
	}
	if r2.Iterations != defaultSimIterations {
		t.Fatalf("iterations = %d, want default %d", r2.Iterations, defaultSimIterations)
	}
	// Zero seed -> default seed (reproducible).
	if r2.Seed != defaultSimSeed {
		t.Fatalf("seed = %d, want default %d", r2.Seed, defaultSimSeed)
	}
}

func TestMining_SimulateRemoveStepLowersEstimate(t *testing.T) {
	svc := newMiningSvc(simRepo())
	seed := int64(7)
	base, err := svc.Simulate(context.Background(), "t", "k", dto.SimulationRequest{Iterations: 3000, Seed: seed})
	if err != nil {
		t.Fatalf("Simulate(baseline) error = %v", err)
	}
	// Remove the dominant "review" step (4000ms each) -> the applied estimate must
	// drop well below the baseline; the baseline field must equal the no-override run.
	removed, err := svc.Simulate(context.Background(), "t", "k", dto.SimulationRequest{
		Iterations: 3000, Seed: seed,
		Override: &dto.SimulationOverride{RemoveSteps: []string{"review"}},
	})
	if err != nil {
		t.Fatalf("Simulate(remove) error = %v", err)
	}
	if removed.BaselineP50Ms != base.P50Ms {
		t.Fatalf("baseline p50 in override run = %d, want %d (as-observed)", removed.BaselineP50Ms, base.P50Ms)
	}
	if removed.P50Ms >= removed.BaselineP50Ms {
		t.Fatalf("removing the dominant step should lower p50: applied=%d baseline=%d", removed.P50Ms, removed.BaselineP50Ms)
	}
	if removed.Applied == nil || len(removed.Applied.RemoveSteps) != 1 {
		t.Fatalf("Applied override not echoed: %+v", removed.Applied)
	}
}

func TestMining_SimulateStepScaleHalvesContribution(t *testing.T) {
	svc := newMiningSvc(simRepo())
	seed := int64(11)
	base, _ := svc.Simulate(context.Background(), "t", "k", dto.SimulationRequest{Iterations: 4000, Seed: seed})
	scaled, err := svc.Simulate(context.Background(), "t", "k", dto.SimulationRequest{
		Iterations: 4000, Seed: seed,
		Override: &dto.SimulationOverride{StepDurationScale: map[string]float64{"review": 0.5}},
	})
	if err != nil {
		t.Fatalf("Simulate(scale) error = %v", err)
	}
	// Halving the dominant step's duration must lower the estimate vs baseline.
	if scaled.P50Ms >= base.P50Ms {
		t.Fatalf("scaling review to 0.5 should lower p50: scaled=%d base=%d", scaled.P50Ms, base.P50Ms)
	}
}

func TestMining_SimulateEmptyWindowIsBoundedNotError(t *testing.T) {
	svc := newMiningSvc(&fakeMiningRepo{}) // no paths, no samples
	r, err := svc.Simulate(context.Background(), "t", "k", dto.SimulationRequest{Iterations: 100, Seed: 1})
	if err != nil {
		t.Fatalf("Simulate(empty) error = %v", err)
	}
	if r.P50Ms != 0 || r.P90Ms != 0 || r.MeanMs != 0 {
		t.Fatalf("empty simulation should be zero, got %+v", r)
	}
	if len(r.Notes) == 0 {
		t.Fatal("empty simulation should carry an explanatory note")
	}
	if !r.Estimate {
		t.Fatal("empty simulation is still labelled an estimate")
	}
}

func TestMining_SimulateRequiresKey(t *testing.T) {
	svc := newMiningSvc(simRepo())
	if _, err := svc.Simulate(context.Background(), "t", "", dto.SimulationRequest{}); err == nil {
		t.Fatal("Simulate() empty key: want error")
	}
}
