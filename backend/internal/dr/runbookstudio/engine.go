package runbookstudio

import (
	"sort"
	"time"
)

// engine.go is the pure orchestration engine: cycle detection over the authored
// task DAG, real critical-path (longest-path-in-a-DAG) math over planned
// durations, the runnable-frontier computation (topological readiness over task
// predecessors), and the live projection (elapsed-vs-planned + projected finish).
// Every function here is pure (no I/O), so the algorithms are unit-tested with
// deterministic fixtures. The Service wires persistence around them.

// Validate verifies the plan's task DAG is well-formed: every predecessor refers
// to a task in the same runbook, and the predecessor graph is acyclic. It returns
// ErrUnknownPredecessor or ErrCycle on failure, or nil. This is the AUTHOR-TIME
// guard — a cycle is rejected before it can ever be run.
func (p Plan) Validate() error {
	ids := make(map[string]bool, len(p.Tasks))
	for _, t := range p.Tasks {
		ids[t.ID] = true
	}
	for _, t := range p.Tasks {
		for _, pre := range t.Predecessors {
			if pre == t.ID {
				return ErrCycle // a self-edge is the trivial cycle
			}
			if !ids[pre] {
				return ErrUnknownPredecessor
			}
		}
	}
	if p.hasCycle() {
		return ErrCycle
	}
	return nil
}

// taskByID indexes the plan's tasks by ID.
func (p Plan) taskByID() map[string]Task {
	m := make(map[string]Task, len(p.Tasks))
	for _, t := range p.Tasks {
		m[t.ID] = t
	}
	return m
}

// successors builds the forward adjacency: for each task, the tasks that list it
// as a predecessor (the edges along which the frontier advances and the critical
// path is summed). The lists are sorted by task ID for determinism.
func (p Plan) successors() map[string][]string {
	adj := make(map[string][]string, len(p.Tasks))
	for _, t := range p.Tasks {
		for _, pre := range t.Predecessors {
			adj[pre] = append(adj[pre], t.ID)
		}
	}
	for k := range adj {
		sort.Strings(adj[k])
	}
	return adj
}

// sortedTaskIDs returns the plan's task IDs in lexical order, the basis for the
// deterministic ordering used throughout the engine.
func (p Plan) sortedTaskIDs() []string {
	ids := make([]string, 0, len(p.Tasks))
	for _, t := range p.Tasks {
		ids = append(ids, t.ID)
	}
	sort.Strings(ids)
	return ids
}

// hasCycle reports whether the predecessor DAG contains a cycle, using an
// iterative three-colour DFS over the successor adjacency (white = unvisited,
// grey = on the current DFS stack, black = fully explored). A grey node reached
// along an edge proves a back-edge, hence a cycle. Iterative to avoid recursion
// blowups on long chains. Unknown-predecessor edges are ignored here (Validate
// catches them first); cycle detection only follows edges between present tasks.
func (p Plan) hasCycle() bool {
	adj := p.successors()
	const (
		white = 0
		grey  = 1
		black = 2
	)
	colour := make(map[string]int, len(p.Tasks))
	present := make(map[string]bool, len(p.Tasks))
	for _, t := range p.Tasks {
		present[t.ID] = true
	}

	type frame struct {
		node string
		next int
	}
	for _, start := range p.sortedTaskIDs() {
		if colour[start] != white {
			continue
		}
		stack := []frame{{node: start, next: 0}}
		colour[start] = grey
		for len(stack) > 0 {
			top := &stack[len(stack)-1]
			children := adj[top.node]
			if top.next >= len(children) {
				colour[top.node] = black
				stack = stack[:len(stack)-1]
				continue
			}
			child := children[top.next]
			top.next++
			if !present[child] {
				continue
			}
			switch colour[child] {
			case grey:
				return true
			case white:
				colour[child] = grey
				stack = append(stack, frame{node: child, next: 0})
			}
		}
	}
	return false
}

// TopoOrder returns a topological ordering of the task IDs (every predecessor
// before its dependents) and ok=true, or ok=false when the DAG has a cycle. It is
// Kahn's algorithm over an indegree map, processing ready tasks in deterministic
// (sorted) order so the result is stable.
func (p Plan) TopoOrder() ([]string, bool) {
	adj := p.successors()
	indeg := make(map[string]int, len(p.Tasks))
	present := make(map[string]bool, len(p.Tasks))
	for _, t := range p.Tasks {
		if _, ok := indeg[t.ID]; !ok {
			indeg[t.ID] = 0
		}
		present[t.ID] = true
	}
	for _, t := range p.Tasks {
		for _, pre := range t.Predecessors {
			if present[pre] {
				indeg[t.ID]++
			}
		}
	}

	var ready []string
	for _, id := range p.sortedTaskIDs() {
		if indeg[id] == 0 {
			ready = append(ready, id)
		}
	}

	var order []string
	for len(ready) > 0 {
		sort.Strings(ready)
		cur := ready[0]
		ready = ready[1:]
		order = append(order, cur)
		for _, succ := range adj[cur] {
			indeg[succ]--
			if indeg[succ] == 0 {
				ready = append(ready, succ)
			}
		}
	}
	if len(order) != len(p.Tasks) {
		return nil, false
	}
	return order, true
}

// CriticalPathResult is the longest planned-duration path through the task DAG:
// the total seconds, the ordered task IDs on the path, and the per-task earliest
// finish (planned) seconds so a caller can render a schedule.
type CriticalPathResult struct {
	// TotalSeconds is the planned duration of the longest dependency chain.
	TotalSeconds int `json:"total_seconds"`
	// Path is the ordered list of task IDs forming the critical path.
	Path []string `json:"path"`
	// EarliestFinish maps each task ID to its earliest planned finish (seconds from
	// run start) — the sum of planned durations along the longest path ending at it.
	EarliestFinish map[string]int `json:"earliest_finish"`
}

// CriticalPath computes the real critical path: the longest planned-duration path
// through the task DAG (longest path in a DAG, solved in topological order). Each
// task's earliest finish = its planned duration + the max earliest finish of its
// predecessors. The critical-path length is the max earliest finish over all
// tasks, and the path is recovered by walking predecessors backward from the
// finishing task along the tie-broken-deterministic max edge.
//
// Returns a zero result (TotalSeconds 0, nil Path) when the DAG has a cycle — the
// caller should Validate first; this guard keeps the function total.
func (p Plan) CriticalPath() CriticalPathResult {
	order, ok := p.TopoOrder()
	if !ok {
		return CriticalPathResult{EarliestFinish: map[string]int{}}
	}
	tasks := p.taskByID()

	// Earliest start = max earliest finish over predecessors; earliest finish =
	// earliest start + planned duration. best[id] records the predecessor that
	// produced the max earliest start, for path recovery (deterministic tie-break:
	// higher finish wins, then lexical predecessor ID).
	earliestFinish := make(map[string]int, len(p.Tasks))
	best := make(map[string]string, len(p.Tasks))

	for _, id := range order {
		t := tasks[id]
		start := 0
		chosen := ""
		// Predecessors sorted for a deterministic tie-break.
		preds := append([]string(nil), t.Predecessors...)
		sort.Strings(preds)
		for _, pre := range preds {
			pf := earliestFinish[pre]
			if pf > start {
				start = pf
				chosen = pre
			}
		}
		earliestFinish[id] = start + t.PlannedDurationSeconds
		if chosen != "" {
			best[id] = chosen
		}
	}

	// Total = max earliest finish; finishing task chosen deterministically.
	total := 0
	finish := ""
	for _, id := range p.sortedTaskIDs() {
		if earliestFinish[id] > total {
			total = earliestFinish[id]
			finish = id
		}
	}

	// Recover the path by walking best[] predecessors backward from the finishing
	// task, then reverse.
	var rev []string
	for cur := finish; cur != ""; cur = best[cur] {
		rev = append(rev, cur)
		if _, ok := best[cur]; !ok {
			break
		}
	}
	path := make([]string, 0, len(rev))
	for i := len(rev) - 1; i >= 0; i-- {
		path = append(path, rev[i])
	}

	return CriticalPathResult{
		TotalSeconds:   total,
		Path:           path,
		EarliestFinish: earliestFinish,
	}
}

// RunState is the in-memory view of a run the engine reasons over: the plan plus
// the per-task execution statuses (task ID -> status). It is assembled from the
// persisted Run + TaskRuns and is the input to Frontier / Projection / completion.
type RunState struct {
	Plan       Plan
	TaskStatus map[string]string // task ID -> TaskRun* status
}

// NewRunState builds a RunState from a plan and the persisted per-task statuses.
// Tasks absent from statuses default to TaskRunPending.
func NewRunState(plan Plan, statuses map[string]string) RunState {
	ts := make(map[string]string, len(plan.Tasks))
	for _, t := range plan.Tasks {
		if s, ok := statuses[t.ID]; ok {
			ts[t.ID] = s
		} else {
			ts[t.ID] = TaskRunPending
		}
	}
	return RunState{Plan: plan, TaskStatus: ts}
}

// predecessorsComplete reports whether every predecessor of the task is in a
// complete-equivalent state (complete or skipped). An empty predecessor set is
// trivially satisfied (a root task).
func (rs RunState) predecessorsComplete(t Task) bool {
	for _, pre := range t.Predecessors {
		if !TaskRunDone(rs.TaskStatus[pre]) {
			return false
		}
	}
	return true
}

// predecessorFailed reports whether any predecessor of the task failed or is
// itself blocked — a downstream task can then never run and is BLOCKED.
func (rs RunState) predecessorFailed(t Task) bool {
	for _, pre := range t.Predecessors {
		s := rs.TaskStatus[pre]
		if s == TaskRunFailed || s == TaskRunBlocked {
			return true
		}
	}
	return false
}

// Frontier returns the task IDs that are RUNNABLE right now: every task not yet
// in a terminal state, not currently running, whose predecessors are ALL
// complete-equivalent (and none failed/blocked). The result is sorted for
// determinism. This is recomputed after every task action — the topological
// readiness frontier over task predecessors.
func (rs RunState) Frontier() []string {
	var frontier []string
	for _, t := range rs.Plan.Tasks {
		s := rs.TaskStatus[t.ID]
		if TaskRunTerminal(s) || s == TaskRunRunning {
			continue
		}
		if rs.predecessorFailed(t) {
			continue // blocked, not runnable
		}
		if rs.predecessorsComplete(t) {
			frontier = append(frontier, t.ID)
		}
	}
	sort.Strings(frontier)
	return frontier
}

// Blocked returns the task IDs that can never run because an upstream task failed
// or is itself blocked (transitively). It is the surfaced complement of the
// frontier, computed by propagating failure forward in topological order.
func (rs RunState) Blocked() []string {
	order, ok := rs.Plan.TopoOrder()
	if !ok {
		order = rs.Plan.sortedTaskIDs() // defensive; a validated plan is acyclic
	}
	blocked := make(map[string]bool, len(rs.Plan.Tasks))
	tasks := rs.Plan.taskByID()
	for _, id := range order {
		t := tasks[id]
		s := rs.TaskStatus[id]
		if TaskRunTerminal(s) {
			continue // already in a terminal state; not newly blocked
		}
		for _, pre := range t.Predecessors {
			if rs.TaskStatus[pre] == TaskRunFailed || blocked[pre] {
				blocked[id] = true
				break
			}
		}
	}
	out := make([]string, 0, len(blocked))
	for id := range blocked {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// AllRequiredDone reports whether every REQUIRED task is in a completed state
// (complete; a skipped required task does NOT count, because skipping a required
// task means the run cannot have met its objective). The run reaches COMPLETED
// when this is true. Non-required tasks (optional comms/milestones) do not block
// completion.
func (rs RunState) AllRequiredDone() bool {
	for _, t := range rs.Plan.Tasks {
		if !t.Required {
			continue
		}
		if rs.TaskStatus[t.ID] != TaskRunComplete {
			return false
		}
	}
	return true
}

// HasFailedRequired reports whether any REQUIRED task failed — the run cannot
// complete and should be marked failed.
func (rs RunState) HasFailedRequired() bool {
	for _, t := range rs.Plan.Tasks {
		if t.Required && rs.TaskStatus[t.ID] == TaskRunFailed {
			return true
		}
	}
	return false
}

// Stalled reports whether the run can make no further progress yet has not
// completed: the frontier is empty, the run is not done, and at least one required
// task is non-terminal. A stall happens when a required task failed and blocked
// the rest. The driver/service marks such a run FAILED.
func (rs RunState) Stalled() bool {
	if rs.AllRequiredDone() {
		return false
	}
	if len(rs.Frontier()) > 0 {
		return false
	}
	// No frontier and not all required done: are any tasks still running?
	for _, t := range rs.Plan.Tasks {
		if rs.TaskStatus[t.ID] == TaskRunRunning {
			return false // work in flight; not stalled
		}
	}
	return true
}

// RunProjection is the live elapsed-vs-planned view for a run.
type RunProjection struct {
	// PlannedCriticalPathSeconds is the baseline longest-path duration.
	PlannedCriticalPathSeconds int `json:"planned_critical_path_seconds"`
	// ElapsedSeconds is now - run.started_at.
	ElapsedSeconds int `json:"elapsed_seconds"`
	// CompletedTasks / TotalTasks track progress.
	CompletedTasks int `json:"completed_tasks"`
	TotalTasks     int `json:"total_tasks"`
	// RemainingCriticalPathSeconds is the longest planned-duration chain through
	// the NOT-yet-complete tasks (the planned work still ahead on the critical
	// path).
	RemainingCriticalPathSeconds int `json:"remaining_critical_path_seconds"`
	// ProjectedFinishSeconds is the projected total run duration from start:
	// elapsed + remaining critical path. ProjectedFinishAt is its wall clock.
	ProjectedFinishSeconds int       `json:"projected_finish_seconds"`
	ProjectedFinishAt      time.Time `json:"projected_finish_at"`
	// OnTrack reports whether the projected finish is within the planned critical
	// path (projected <= planned). Behind schedule otherwise.
	OnTrack bool `json:"on_track"`
	// VarianceSeconds is projected - planned (positive = behind schedule).
	VarianceSeconds int `json:"variance_seconds"`
}

// Projection computes the live elapsed-vs-planned projection for the run. The
// remaining critical path is the longest planned-duration chain through the tasks
// that are NOT yet complete-equivalent — a real recompute over the sub-DAG of
// outstanding work, not a static estimate. The projected finish is the elapsed
// time plus that remaining critical path (work already done is "off the clock";
// outstanding work still costs its planned critical path). `startedAt` and `now`
// are injected so tests are deterministic.
func (rs RunState) Projection(startedAt, now time.Time, plannedCriticalPath int) RunProjection {
	elapsed := int(now.Sub(startedAt).Seconds())
	if elapsed < 0 {
		elapsed = 0
	}

	completed := 0
	for _, t := range rs.Plan.Tasks {
		if TaskRunDone(rs.TaskStatus[t.ID]) {
			completed++
		}
	}

	remaining := rs.remainingCriticalPath()
	projected := elapsed + remaining

	proj := RunProjection{
		PlannedCriticalPathSeconds:   plannedCriticalPath,
		ElapsedSeconds:               elapsed,
		CompletedTasks:               completed,
		TotalTasks:                   len(rs.Plan.Tasks),
		RemainingCriticalPathSeconds: remaining,
		ProjectedFinishSeconds:       projected,
		ProjectedFinishAt:            startedAt.Add(time.Duration(projected) * time.Second),
		OnTrack:                      projected <= plannedCriticalPath,
		VarianceSeconds:              projected - plannedCriticalPath,
	}
	return proj
}

// remainingCriticalPath computes the longest planned-duration chain through the
// tasks NOT yet complete-equivalent. Complete/skipped tasks contribute 0 (their
// work is done) but their position in the DAG is preserved so a downstream
// outstanding task still sees the chain through them. It is the same
// longest-path-in-a-DAG recurrence as CriticalPath, with done tasks zeroed.
func (rs RunState) remainingCriticalPath() int {
	order, ok := rs.Plan.TopoOrder()
	if !ok {
		return 0
	}
	tasks := rs.Plan.taskByID()
	finish := make(map[string]int, len(rs.Plan.Tasks))
	maxRemaining := 0
	for _, id := range order {
		t := tasks[id]
		start := 0
		for _, pre := range t.Predecessors {
			if finish[pre] > start {
				start = finish[pre]
			}
		}
		cost := t.PlannedDurationSeconds
		if TaskRunDone(rs.TaskStatus[id]) {
			cost = 0 // already done; no remaining work, but keep the chain
		}
		finish[id] = start + cost
		if finish[id] > maxRemaining {
			maxRemaining = finish[id]
		}
	}
	return maxRemaining
}
