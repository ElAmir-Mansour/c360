package service

import (
	"context"
	"fmt"
	"math/rand"
	"sort"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/repository"
)

// miningRepository is the READ-ONLY process-MINING read model the MiningService
// drives. It mirrors the WorkflowMiningRepository methods so the service can be
// unit-tested against a double. Every method is tenant-scoped at the repository
// layer (RLS).
type miningRepository interface {
	InstancePaths(ctx context.Context, tenantID, definitionKey string, windowDays int) ([]repository.InstancePath, error)
	StepDurationSamples(ctx context.Context, tenantID, definitionKey string, windowDays int) ([]repository.StepDurationSample, error)
	LoadDefinitionGraph(ctx context.Context, tenantID, definitionKey string) (*repository.DefinitionGraph, error)
}

// MiningService assembles the four process-mining reports (variant discovery,
// conformance checking, path-frequency heatmap, what-if simulation) from the
// read model. It is a pure read-side aggregator + estimator — NO engine or
// state-model interaction — so it never mutates workflow state.
type MiningService struct {
	repo   miningRepository
	logger zerolog.Logger
}

// NewMiningService creates a MiningService over the given read model.
func NewMiningService(repo miningRepository, logger zerolog.Logger) *MiningService {
	return &MiningService{
		repo:   repo,
		logger: logger.With().Str("service", "workflow_mining").Logger(),
	}
}

// Mining tuning constants. All are BOUNDS so no caller (or pathological history)
// can produce an unbounded computation.
const (
	// defaultTopVariants is the number of variants returned individually before
	// the long-tail bucket kicks in when the caller does not specify topN.
	defaultTopVariants = 10
	// maxTopVariants caps the individually-returned variant count.
	maxTopVariants = 100
	// defaultSimIterations is the Monte-Carlo sample count used when the request
	// omits it.
	defaultSimIterations = 2000
	// maxSimIterations hard-caps the simulation so a request cannot ask for an
	// unbounded run.
	maxSimIterations = 50000
	// defaultSimSeed makes an omitted seed deterministic (reproducible runs).
	defaultSimSeed = 1
	// maxDurationSamplesPerStep bounds how many empirical duration samples the
	// simulation retains per step so a huge history cannot blow memory; the most
	// recent samples (query is ORDER BY started_at) win when truncating.
	maxDurationSamplesPerStep = 5000
	// maxDurationScale clamps a what-if per-step duration multiplier.
	maxDurationScale = 10.0
)

// sequenceKey joins a step_id sequence into a stable grouping key. A NUL byte is
// the separator so it cannot appear inside a step_id and collide two distinct
// sequences into one key.
func sequenceKey(seq []string) string {
	return strings.Join(seq, "\x00")
}

// variantAgg is the in-progress grouping of instances that followed one exact
// sequence.
type variantAgg struct {
	sequence       []string
	count          int
	completedCount int
	completedMs    []int64
}

// discoverVariants groups the instance paths into distinct variants (by exact
// step sequence), sorted most-frequent-first (tie-break: fewer steps first, then
// lexicographic on the joined key) so the ordering is deterministic. It returns
// the aggregates plus the total analysed instance count.
func discoverVariants(paths []repository.InstancePath) ([]*variantAgg, int) {
	byKey := make(map[string]*variantAgg)
	order := make([]string, 0)
	for _, p := range paths {
		k := sequenceKey(p.Sequence)
		v, ok := byKey[k]
		if !ok {
			// Copy the sequence so a later mutation of the source slice cannot
			// alias into the aggregate.
			seq := make([]string, len(p.Sequence))
			copy(seq, p.Sequence)
			v = &variantAgg{sequence: seq}
			byKey[k] = v
			order = append(order, k)
		}
		v.count++
		if p.Completed {
			v.completedCount++
			v.completedMs = append(v.completedMs, p.CycleMs)
		}
	}

	variants := make([]*variantAgg, 0, len(order))
	for _, k := range order {
		variants = append(variants, byKey[k])
	}
	sort.SliceStable(variants, func(i, j int) bool {
		if variants[i].count != variants[j].count {
			return variants[i].count > variants[j].count // most frequent first
		}
		if len(variants[i].sequence) != len(variants[j].sequence) {
			return len(variants[i].sequence) < len(variants[j].sequence)
		}
		return sequenceKey(variants[i].sequence) < sequenceKey(variants[j].sequence)
	})
	return variants, len(paths)
}

// Variants implements (1) VARIANT DISCOVERY. It reconstructs each instance's
// executed path, groups identical sequences into variants with count, frequency
// percent, and cycle-time p50/p90 per variant, and returns the top-N variants
// plus a long-tail bucket. topN <= 0 defaults; it is capped at maxTopVariants.
func (s *MiningService) Variants(ctx context.Context, tenantID, definitionKey string, windowDays, topN int) (*dto.VariantReport, error) {
	if definitionKey == "" {
		return nil, fmt.Errorf("definition key is required")
	}
	windowDays = normalizeWindow(windowDays)
	if topN <= 0 {
		topN = defaultTopVariants
	}
	if topN > maxTopVariants {
		topN = maxTopVariants
	}

	paths, err := s.repo.InstancePaths(ctx, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, err
	}
	variants, total := discoverVariants(paths)

	report := &dto.VariantReport{
		DefinitionKey:    definitionKey,
		WindowDays:       windowDays,
		TotalInstances:   total,
		DistinctVariants: len(variants),
		TopN:             topN,
		Variants:         []dto.Variant{},
	}
	if total == 0 {
		return report, nil
	}

	limit := topN
	if limit > len(variants) {
		limit = len(variants)
	}
	for i := 0; i < limit; i++ {
		v := variants[i]
		p50, p90 := percentileMs(v.completedMs, 0.5), percentileMs(v.completedMs, 0.9)
		report.Variants = append(report.Variants, dto.Variant{
			Rank:           i + 1,
			Sequence:       v.sequence,
			Count:          v.count,
			FrequencyPct:   pct(v.count, total),
			CompletedCount: v.completedCount,
			P50Seconds:     float64(p50) / 1000.0,
			P90Seconds:     float64(p90) / 1000.0,
			Conformant:     true, // variant-only view does not evaluate conformance
		})
	}

	// Fold the remainder into the long-tail bucket.
	if len(variants) > limit {
		tail := &dto.LongTailBucket{}
		for i := limit; i < len(variants); i++ {
			tail.VariantCount++
			tail.InstanceCount += variants[i].count
		}
		tail.FrequencyPct = pct(tail.InstanceCount, total)
		report.LongTail = tail
	}
	return report, nil
}

// Conformance implements (2) CONFORMANCE CHECKING. It discovers the variants,
// then compares each variant's transitions + step set against the MODEL graph,
// flagging undeclared steps, illegal transitions, and skipped required steps. The
// conformance score is the fraction of instances that followed a fully conformant
// variant. Deviating variants are returned most-frequent-first.
func (s *MiningService) Conformance(ctx context.Context, tenantID, definitionKey string, windowDays int) (*dto.ConformanceReport, error) {
	if definitionKey == "" {
		return nil, fmt.Errorf("definition key is required")
	}
	windowDays = normalizeWindow(windowDays)

	graph, err := s.repo.LoadDefinitionGraph(ctx, tenantID, definitionKey)
	if err != nil {
		return nil, err
	}
	paths, err := s.repo.InstancePaths(ctx, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, err
	}
	variants, total := discoverVariants(paths)

	report := &dto.ConformanceReport{
		DefinitionKey:     definitionKey,
		WindowDays:        windowDays,
		TotalInstances:    total,
		DistinctVariants:  len(variants),
		ModelSteps:        len(graph.Steps),
		DeviatingVariants: []dto.VariantConformance{},
	}
	if total == 0 {
		return report, nil
	}

	conformantInstances := 0
	for i, v := range variants {
		devs := evaluateConformance(v.sequence, graph)
		conformant := len(devs) == 0
		if conformant {
			conformantInstances += v.count
			continue
		}
		report.DeviatingVariants = append(report.DeviatingVariants, dto.VariantConformance{
			Rank:         i + 1,
			Sequence:     v.sequence,
			Count:        v.count,
			FrequencyPct: pct(v.count, total),
			Conformant:   false,
			Deviations:   devs,
		})
	}
	report.ConformantInstances = conformantInstances
	report.ConformanceScore = float64(conformantInstances) / float64(total)
	return report, nil
}

// evaluateConformance returns the deviations a single variant sequence exhibits
// against the model graph. It uses token-replay semantics that treat a step with
// MULTIPLE outgoing transitions as a BRANCH (visiting exactly one target is
// conformant — the un-taken alternative branches are NOT skipped-step
// deviations), so a legal branching trace is fully conformant.
//
//	(a) undeclared_step     — an executed step_id the model does not declare.
//	(b) illegal_transition  — an executed consecutive (from -> to) hop where both
//	    endpoints are declared but the model lists no such target under `from`.
//	(c) skipped_required_step — a model step that an ILLEGAL transition bypassed:
//	    for an illegal hop `from -> to`, any LEGAL successor of `from` that the
//	    trace never visited is reported as skipped (the trace short-circuited past
//	    a required successor). This ties skipped-step detection to a genuine
//	    illegal jump, so it never false-positives on the alternative arm of a
//	    legal branch.
//
// Deviations are de-duplicated and returned in a stable order: undeclared steps
// (first-seen), illegal transitions (first-seen), then skipped steps
// (model-declaration order). A trace whose steps are all declared and whose
// consecutive hops are all legal has NO deviations (fully conformant).
func evaluateConformance(seq []string, graph *repository.DefinitionGraph) []dto.Deviation {
	var devs []dto.Deviation

	// (a) undeclared steps (de-duped, first-seen order) + track what was visited.
	visited := make(map[string]struct{}, len(seq))
	seenUndeclared := make(map[string]struct{})
	for _, step := range seq {
		visited[step] = struct{}{}
		if _, ok := graph.Steps[step]; !ok {
			if _, dup := seenUndeclared[step]; !dup {
				seenUndeclared[step] = struct{}{}
				devs = append(devs, dto.Deviation{Kind: dto.DeviationUndeclaredStep, Step: step})
			}
		}
	}

	// (b) illegal transitions (de-duped, first-seen order) + collect the source
	// steps of illegal hops so (c) can report the legal successors they bypassed.
	// A hop between two declared steps is legal iff the model lists the target
	// under the source. If either endpoint is undeclared we do NOT ALSO flag the
	// transition (the undeclared-step deviation already captures the divergence).
	seenTrans := make(map[string]struct{})
	illegalSources := make([]string, 0)
	seenIllegalSource := make(map[string]struct{})
	for i := 0; i+1 < len(seq); i++ {
		from, to := seq[i], seq[i+1]
		if _, ok := graph.Steps[from]; !ok {
			continue
		}
		if _, ok := graph.Steps[to]; !ok {
			continue
		}
		allowed := graph.AllowedTransitions[from]
		if _, ok := allowed[to]; ok {
			continue
		}
		k := from + "\x00" + to
		if _, dup := seenTrans[k]; !dup {
			seenTrans[k] = struct{}{}
			devs = append(devs, dto.Deviation{Kind: dto.DeviationIllegalTransition, From: from, To: to})
		}
		if _, dup := seenIllegalSource[from]; !dup {
			seenIllegalSource[from] = struct{}{}
			illegalSources = append(illegalSources, from)
		}
	}

	// (c) skipped required steps: for each source of an illegal transition, the
	// LEGAL successors the trace never visited are the required steps the illegal
	// jump bypassed. Reported de-duped, in model-declaration order for stability.
	skippedSet := make(map[string]struct{})
	for _, from := range illegalSources {
		for target := range graph.AllowedTransitions[from] {
			if _, seen := visited[target]; seen {
				continue
			}
			skippedSet[target] = struct{}{}
		}
	}
	for _, step := range graph.StepOrder {
		if _, ok := skippedSet[step]; ok {
			devs = append(devs, dto.Deviation{Kind: dto.DeviationSkippedRequiredStep, Step: step})
		}
	}
	return devs
}

// Heatmap implements (3) PATH-FREQUENCY / HEATMAP. It derives the per-step visit
// count + per-transition traversal count from the SAME reconstructed instance
// paths the variants use (single source of truth so the counts match), and the
// per-step median duration from the step-duration samples. Nodes and edges are
// sorted deterministically for a stable payload.
func (s *MiningService) Heatmap(ctx context.Context, tenantID, definitionKey string, windowDays int) (*dto.HeatmapReport, error) {
	if definitionKey == "" {
		return nil, fmt.Errorf("definition key is required")
	}
	windowDays = normalizeWindow(windowDays)

	paths, err := s.repo.InstancePaths(ctx, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, err
	}
	samples, err := s.repo.StepDurationSamples(ctx, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, err
	}

	// Per-step visit counts + per-transition traversal counts, derived from the
	// executed paths.
	visits := make(map[string]int)
	edges := make(map[string]int) // key: from\x00to
	for _, p := range paths {
		for i, step := range p.Sequence {
			visits[step]++
			if i+1 < len(p.Sequence) {
				edges[step+"\x00"+p.Sequence[i+1]]++
			}
		}
	}

	// Per-step median duration + step_type from the samples.
	durByStep := make(map[string][]int64)
	typeByStep := make(map[string]string)
	for _, sm := range samples {
		durByStep[sm.StepID] = append(durByStep[sm.StepID], sm.DurationMs)
		if _, ok := typeByStep[sm.StepID]; !ok && sm.StepType != "" {
			typeByStep[sm.StepID] = sm.StepType
		}
	}

	report := &dto.HeatmapReport{
		DefinitionKey:  definitionKey,
		WindowDays:     windowDays,
		TotalInstances: len(paths),
		Nodes:          []dto.HeatNode{},
		Edges:          []dto.HeatEdge{},
	}

	for step, v := range visits {
		report.Nodes = append(report.Nodes, dto.HeatNode{
			StepID:   step,
			StepType: typeByStep[step],
			Visits:   v,
			MedianMs: percentileMs(durByStep[step], 0.5),
		})
	}
	sort.SliceStable(report.Nodes, func(i, j int) bool {
		if report.Nodes[i].Visits != report.Nodes[j].Visits {
			return report.Nodes[i].Visits > report.Nodes[j].Visits
		}
		return report.Nodes[i].StepID < report.Nodes[j].StepID
	})

	for k, c := range edges {
		parts := strings.SplitN(k, "\x00", 2)
		report.Edges = append(report.Edges, dto.HeatEdge{From: parts[0], To: parts[1], Count: c})
	}
	sort.SliceStable(report.Edges, func(i, j int) bool {
		if report.Edges[i].Count != report.Edges[j].Count {
			return report.Edges[i].Count > report.Edges[j].Count
		}
		if report.Edges[i].From != report.Edges[j].From {
			return report.Edges[i].From < report.Edges[j].From
		}
		return report.Edges[i].To < report.Edges[j].To
	})
	return report, nil
}

// Simulate implements (4) WHAT-IF SIMULATION. Over the observed path variants
// (weighted by frequency) and per-step empirical duration distributions, it runs
// a deterministic-seedable, bounded Monte-Carlo roll-up to estimate the resulting
// end-to-end cycle-time distribution (p50/p90/mean, ms) after applying an
// optional override (remove step / parallelize a group / scale a step duration).
// It ALSO computes an as-observed baseline (same samples, no override) so the
// caller can read the delta. The result is explicitly an ESTIMATE.
func (s *MiningService) Simulate(ctx context.Context, tenantID, definitionKey string, req dto.SimulationRequest) (*dto.SimulationReport, error) {
	if definitionKey == "" {
		return nil, fmt.Errorf("definition key is required")
	}
	windowDays := normalizeWindow(req.WindowDays)
	iterations := req.Iterations
	if iterations <= 0 {
		iterations = defaultSimIterations
	}
	if iterations > maxSimIterations {
		iterations = maxSimIterations
	}
	seed := req.Seed
	if seed == 0 {
		seed = defaultSimSeed
	}

	paths, err := s.repo.InstancePaths(ctx, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, err
	}
	samples, err := s.repo.StepDurationSamples(ctx, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, err
	}
	variants, total := discoverVariants(paths)

	report := &dto.SimulationReport{
		DefinitionKey:   definitionKey,
		WindowDays:      windowDays,
		Estimate:        true,
		Method:          "monte_carlo_over_observed_variants",
		Iterations:      iterations,
		Seed:            seed,
		SampledVariants: len(variants),
		Applied:         req.Override,
		Notes:           []string{},
	}

	// Build the per-step empirical distribution (bounded per step).
	distByStep := make(map[string][]int64)
	for _, sm := range samples {
		if len(distByStep[sm.StepID]) >= maxDurationSamplesPerStep {
			continue
		}
		distByStep[sm.StepID] = append(distByStep[sm.StepID], sm.DurationMs)
	}

	if total == 0 {
		report.Notes = append(report.Notes, "no instances in window; simulation is empty")
		return report, nil
	}
	if len(distByStep) == 0 {
		report.Notes = append(report.Notes, "no completed step-duration samples in window; simulation is empty")
		return report, nil
	}

	// Build the frequency-weighted variant chooser: cumulative counts over the
	// distinct variants. rand is seeded so the run is reproducible.
	weights := make([]int, len(variants))
	cum := 0
	for i, v := range variants {
		cum += v.count
		weights[i] = cum
	}

	// The baseline uses the SAME seed as the override run so the two share the
	// identical variant + duration draws and the delta reflects ONLY the override,
	// not sampling noise. Two independent generators, one per pass, both from the
	// same seed.
	baseline := runMonteCarlo(rand.New(rand.NewSource(seed)), iterations, variants, weights, cum, distByStep, nil)
	report.BaselineP50Ms = percentileMs(baseline, 0.5)
	report.BaselineP90Ms = percentileMs(baseline, 0.9)

	applied := runMonteCarlo(rand.New(rand.NewSource(seed)), iterations, variants, weights, cum, distByStep, req.Override)
	report.P50Ms = percentileMs(applied, 0.5)
	report.P90Ms = percentileMs(applied, 0.9)
	report.MeanMs = meanMs(applied)

	if req.Override == nil {
		report.Notes = append(report.Notes, "no override supplied; result is the as-observed estimate (equal to baseline)")
	}
	return report, nil
}

// runMonteCarlo draws `iterations` samples: each iteration picks a variant
// weighted by observed frequency, then rolls up the variant's per-step sampled
// durations under the override, yielding one cycle-time sample (ms). It is
// deterministic for a given seeded rng. The returned slice is the sampled
// distribution (unsorted; percentileMs sorts a copy).
func runMonteCarlo(rng *rand.Rand, iterations int, variants []*variantAgg, weights []int, totalWeight int, distByStep map[string][]int64, override *dto.SimulationOverride) []int64 {
	if len(variants) == 0 || totalWeight == 0 {
		return nil
	}

	// Pre-resolve the override lookups once.
	var removeSet map[string]struct{}
	var parallelSet map[string]struct{}
	var scale map[string]float64
	if override != nil {
		if len(override.RemoveSteps) > 0 {
			removeSet = make(map[string]struct{}, len(override.RemoveSteps))
			for _, s := range override.RemoveSteps {
				removeSet[s] = struct{}{}
			}
		}
		if len(override.ParallelizeSteps) > 0 {
			parallelSet = make(map[string]struct{}, len(override.ParallelizeSteps))
			for _, s := range override.ParallelizeSteps {
				parallelSet[s] = struct{}{}
			}
		}
		if len(override.StepDurationScale) > 0 {
			scale = override.StepDurationScale
		}
	}

	out := make([]int64, 0, iterations)
	for it := 0; it < iterations; it++ {
		// Weighted pick of a variant by cumulative frequency.
		x := rng.Intn(totalWeight)
		vi := sort.SearchInts(weights, x+1)
		if vi >= len(variants) {
			vi = len(variants) - 1
		}
		seq := variants[vi].sequence

		var total int64
		var parallelMax int64
		for _, step := range seq {
			if removeSet != nil {
				if _, drop := removeSet[step]; drop {
					continue
				}
			}
			d := sampleDuration(rng, distByStep[step])
			if scale != nil {
				if f, ok := scale[step]; ok {
					if f < 0 {
						f = 0
					}
					if f > maxDurationScale {
						f = maxDurationScale
					}
					d = int64(float64(d) * f)
				}
			}
			if parallelSet != nil {
				if _, par := parallelSet[step]; par {
					// The parallelized group's contribution is the MAX of its
					// members (they run concurrently), tracked separately and
					// added once after the loop.
					if d > parallelMax {
						parallelMax = d
					}
					continue
				}
			}
			total += d
		}
		total += parallelMax
		out = append(out, total)
	}
	return out
}

// sampleDuration draws one duration (ms) from a step's empirical distribution. An
// empty distribution (a step that never completed in the window) contributes 0 —
// the step is treated as instantaneous rather than aborting the estimate.
func sampleDuration(rng *rand.Rand, dist []int64) int64 {
	if len(dist) == 0 {
		return 0
	}
	return dist[rng.Intn(len(dist))]
}

// percentileMs returns the p-th percentile (0..1) of the given ms samples using
// the nearest-rank method on a sorted COPY (so the caller's slice is untouched).
// Empty input returns 0.
func percentileMs(vals []int64, p float64) int64 {
	if len(vals) == 0 {
		return 0
	}
	cp := make([]int64, len(vals))
	copy(cp, vals)
	sort.Slice(cp, func(i, j int) bool { return cp[i] < cp[j] })
	if p <= 0 {
		return cp[0]
	}
	if p >= 1 {
		return cp[len(cp)-1]
	}
	// Nearest-rank: rank = ceil(p * n), 1-based.
	rank := int(p*float64(len(cp)) + 0.9999999999)
	if rank < 1 {
		rank = 1
	}
	if rank > len(cp) {
		rank = len(cp)
	}
	return cp[rank-1]
}

// meanMs returns the arithmetic mean (ms, truncated to int64) of the samples.
func meanMs(vals []int64) int64 {
	if len(vals) == 0 {
		return 0
	}
	var sum int64
	for _, v := range vals {
		sum += v
	}
	return sum / int64(len(vals))
}

// pct returns n/total*100 (0 when total is 0), the frequency percentage.
func pct(n, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(n) / float64(total) * 100.0
}
