package rehearsalproof

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/gameday"
	drmodel "github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/runbookstudio"
)

var (
	ErrMissingTenant = errors.New("rehearsal proof: tenant id is required")
	ErrMissingRun    = errors.New("rehearsal proof: run id and type are required")
)

type BuildInput struct {
	ID                string
	TenantID          string
	Run               RunRef
	Scope             Scope
	Systems           []SystemRef
	Runbook           RunbookRef
	Targets           Targets
	ApprovalRefs      []ApprovalRef
	StartedAt         time.Time
	CompletedAt       *time.Time
	HealthChecks      []HealthCheck
	IntegrityVerdicts []IntegrityVerdict
	FailbackTeardown  TeardownStatus
	EvidenceReport    *EvidenceReportRef
	OverallVerdict    string
	Provenance        Provenance
	GeneratedAt       time.Time
}

type Assembler struct {
	now func() time.Time
}

func New(now func() time.Time) *Assembler {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Assembler{now: now}
}

func (a *Assembler) Build(in BuildInput) (*ProofRecord, error) {
	if strings.TrimSpace(in.TenantID) == "" {
		return nil, ErrMissingTenant
	}
	if strings.TrimSpace(in.Run.ID) == "" || strings.TrimSpace(in.Run.Type) == "" {
		return nil, ErrMissingRun
	}
	generatedAt := in.GeneratedAt
	if generatedAt.IsZero() {
		generatedAt = a.now()
	}
	startedAt := in.StartedAt
	if startedAt.IsZero() {
		startedAt = generatedAt
	}
	id := strings.TrimSpace(in.ID)
	if id == "" {
		id = uuid.NewString()
	}
	provenance := NormalizeProvenance(in.Provenance, generatedAt)
	targets := normalizeTargets(in.Targets)
	verdict := strings.TrimSpace(in.OverallVerdict)
	if verdict == "" {
		verdict = deriveVerdict(in.Run.Status, in.HealthChecks, in.IntegrityVerdicts, in.FailbackTeardown)
	}
	teardown := in.FailbackTeardown
	if teardown.Status == "" {
		teardown.Status = TeardownUnknown
	}
	record := &ProofRecord{
		SchemaVersion:     SchemaVersion,
		ID:                id,
		TenantID:          in.TenantID,
		Run:               in.Run,
		Scope:             in.Scope,
		Systems:           append([]SystemRef(nil), in.Systems...),
		Runbook:           in.Runbook,
		Targets:           targets,
		ApprovalRefs:      append([]ApprovalRef(nil), in.ApprovalRefs...),
		StartedAt:         startedAt.UTC(),
		CompletedAt:       utcPtr(in.CompletedAt),
		HealthChecks:      append([]HealthCheck(nil), in.HealthChecks...),
		IntegrityVerdicts: append([]IntegrityVerdict(nil), in.IntegrityVerdicts...),
		FailbackTeardown:  teardown,
		EvidenceReport:    cloneEvidenceRef(in.EvidenceReport),
		OverallVerdict:    verdict,
		Provenance:        provenance,
		GeneratedAt:       generatedAt.UTC(),
	}
	hash, err := EnvelopeHash(record)
	if err != nil {
		return nil, err
	}
	record.EnvelopeHash = hash
	return record, nil
}

type GameDayOptions struct {
	Scope             Scope
	Systems           []SystemRef
	Runbook           RunbookRef
	RTOTargetSeconds  int
	RPOTargetSeconds  int
	ApprovalRefs      []ApprovalRef
	IntegrityVerdicts []IntegrityVerdict
	FailbackTeardown  TeardownStatus
	EvidenceReport    *EvidenceReportRef
	Provenance        Provenance
}

func (a *Assembler) FromGameDayScorecard(card gameday.Scorecard, opts GameDayOptions) (*ProofRecord, error) {
	if card.Run == nil {
		return nil, ErrMissingRun
	}
	run := card.Run
	checks := make([]HealthCheck, 0, len(card.Steps))
	for _, step := range card.Steps {
		if step == nil {
			continue
		}
		checkedAt := step.StartedAt
		if step.FinishedAt != nil {
			checkedAt = *step.FinishedAt
		}
		status := VerdictFailed
		if step.Passed {
			status = VerdictPassed
		}
		checks = append(checks, HealthCheck{
			Name:       fmt.Sprintf("gameday step %d %s", step.StepIndex, step.Action),
			Target:     step.Target,
			Status:     status,
			Passed:     step.Passed,
			CheckedAt:  checkedAt,
			Detail:     step.Detail,
			EvidenceID: step.ID,
			FinishedAt: utcPtr(step.FinishedAt),
		})
	}
	teardown := opts.FailbackTeardown
	if teardown.Status == "" {
		if run.AllFaultsReverted {
			teardown.Status = TeardownComplete
		} else {
			teardown.Status = TeardownIncomplete
		}
	}
	provenance := opts.Provenance
	if provenance.Source == "" {
		provenance.Source = SourceLiveRun
	}
	if provenance.CapturedFrom == "" {
		provenance.CapturedFrom = RunTypeGameDay
	}
	return a.Build(BuildInput{
		TenantID: run.TenantID,
		Run: RunRef{
			Type:       RunTypeGameDay,
			ID:         run.ID,
			GroupID:    run.GroupID,
			ScenarioID: run.ScenarioID,
			Mode:       "rehearsal",
			Status:     run.Status,
		},
		Scope:             opts.ScopeOrDefault(run.Scope),
		Systems:           opts.Systems,
		Runbook:           opts.Runbook,
		Targets:           Targets{RTOTargetSeconds: opts.RTOTargetSeconds, RPOTargetSeconds: opts.RPOTargetSeconds},
		ApprovalRefs:      opts.ApprovalRefs,
		StartedAt:         firstTime(run.StartedAt, run.InitiatedAt),
		CompletedAt:       run.CompletedAt,
		HealthChecks:      checks,
		IntegrityVerdicts: opts.IntegrityVerdicts,
		FailbackTeardown:  teardown,
		EvidenceReport:    opts.EvidenceReport,
		Provenance:        provenance,
	})
}

func (o GameDayOptions) ScopeOrDefault(scope string) Scope {
	if o.Scope.Name != "" || o.Scope.Environment != "" || len(o.Scope.SystemIDs) > 0 {
		return o.Scope
	}
	return Scope{Name: scope, Environment: scope}
}

type RunbookOptions struct {
	Scope              Scope
	Systems            []SystemRef
	RunbookVersion     string
	RunbookContentHash string
	RTOTargetSeconds   int
	RPOTargetSeconds   int
	ApprovalRefs       []ApprovalRef
	IntegrityVerdicts  []IntegrityVerdict
	FailbackTeardown   TeardownStatus
	EvidenceReport     *EvidenceReportRef
	Provenance         Provenance
}

func (a *Assembler) FromRunbookStudioState(state runbookstudio.LiveState, opts RunbookOptions) (*ProofRecord, error) {
	run := state.Run
	provenance := opts.Provenance
	if provenance.Source == "" {
		provenance.Source = SourceLiveRun
	}
	if provenance.CapturedFrom == "" {
		provenance.CapturedFrom = RunTypeRunbookStudio
	}
	var completedAt *time.Time
	if run.CompletedAt != nil {
		completedAt = run.CompletedAt
	}
	runbook := RunbookRef{ID: run.RunbookID, Version: opts.RunbookVersion, ContentHash: opts.RunbookContentHash}
	targets := Targets{RTOTargetSeconds: opts.RTOTargetSeconds, RPOTargetSeconds: opts.RPOTargetSeconds}
	if run.ActualDurationSeconds != nil {
		actual := *run.ActualDurationSeconds
		targets.RTOActualSeconds = &actual
	}
	checks := taskRunHealthChecks(state)
	return a.Build(BuildInput{
		TenantID: run.TenantID,
		Run: RunRef{
			Type:      RunTypeRunbookStudio,
			ID:        run.ID,
			RunbookID: run.RunbookID,
			Mode:      run.Mode,
			Status:    run.Status,
		},
		Scope:             opts.Scope,
		Systems:           opts.Systems,
		Runbook:           runbook,
		Targets:           targets,
		ApprovalRefs:      opts.ApprovalRefs,
		StartedAt:         run.StartedAt,
		CompletedAt:       completedAt,
		HealthChecks:      checks,
		IntegrityVerdicts: opts.IntegrityVerdicts,
		FailbackTeardown:  opts.FailbackTeardown,
		EvidenceReport:    opts.EvidenceReport,
		Provenance:        provenance,
	})
}

type FailoverOptions struct {
	Systems           []SystemRef
	HealthChecks      []HealthCheck
	IntegrityVerdicts []IntegrityVerdict
	FailbackTeardown  TeardownStatus
	EvidenceReport    *EvidenceReportRef
	Provenance        Provenance
}

func FromFailoverRun(run drmodel.FailoverRun, opts FailoverOptions) BuildInput {
	provenance := opts.Provenance
	if provenance.Source == "" {
		provenance.Source = SourceLiveRun
	}
	if provenance.CapturedFrom == "" {
		provenance.CapturedFrom = RunTypeFailoverDrill
	}
	targets := Targets{RTOTargetSeconds: run.RTOObjectiveSeconds}
	if run.RTOActualSeconds != nil {
		actual := *run.RTOActualSeconds
		targets.RTOActualSeconds = &actual
	}
	completed := run.CompletedAt
	teardown := opts.FailbackTeardown
	if teardown.Status == "" {
		if run.IsTerminal() {
			teardown.Status = TeardownComplete
		} else {
			teardown.Status = TeardownNotStarted
		}
	}
	return BuildInput{
		TenantID: run.TenantID,
		Run: RunRef{
			Type:    RunTypeFailoverDrill,
			ID:      run.ID,
			GroupID: run.GroupID,
			Mode:    run.Mode,
			Status:  run.Status,
		},
		Scope:             Scope{Name: run.Mode, Environment: run.Mode},
		Systems:           opts.Systems,
		Targets:           targets,
		ApprovalRefs:      failoverApprovalRefs(run),
		StartedAt:         run.InitiatedAt,
		CompletedAt:       completed,
		HealthChecks:      append([]HealthCheck(nil), opts.HealthChecks...),
		IntegrityVerdicts: append([]IntegrityVerdict(nil), opts.IntegrityVerdicts...),
		FailbackTeardown:  teardown,
		EvidenceReport:    opts.EvidenceReport,
		Provenance:        provenance,
	}
}

func FromFailoverDrillRun(run drmodel.FailoverRun, systems []SystemRef, evidence *EvidenceReportRef, provenance Provenance) BuildInput {
	return FromFailoverRun(run, FailoverOptions{
		Systems:        systems,
		EvidenceReport: evidence,
		Provenance:     provenance,
	})
}

func NormalizeProvenance(in Provenance, fallback time.Time) Provenance {
	source := strings.TrimSpace(in.Source)
	if source == "" {
		source = SourceUnknown
	}
	switch source {
	case SourceLiveRun, SourceSeededDemo, SourceImported, SourceUnknown:
	default:
		source = SourceUnknown
	}
	in.Source = source
	if in.CapturedAt.IsZero() {
		in.CapturedAt = fallback
	}
	in.CapturedAt = in.CapturedAt.UTC()
	if source == SourceSeededDemo || in.Seeded || in.Demo {
		in.Live = false
		in.Seeded = true
		in.Demo = true
		if in.Notes == "" {
			in.Notes = "seeded demo evidence; not live rehearsal proof"
		}
		return in
	}
	in.Live = source == SourceLiveRun
	return in
}

func EnvelopeHash(record *ProofRecord) (string, error) {
	if record == nil {
		return "", errors.New("rehearsal proof: nil record")
	}
	copy := *record
	copy.EnvelopeHash = ""
	b, err := json.Marshal(copy)
	if err != nil {
		return "", fmt.Errorf("rehearsal proof: marshal envelope for hash: %w", err)
	}
	sum := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func normalizeTargets(t Targets) Targets {
	if t.RTOActualSeconds != nil && t.RTOTargetSeconds > 0 {
		met := *t.RTOActualSeconds <= t.RTOTargetSeconds
		t.RTOMet = &met
	}
	if t.RPOActualSeconds != nil && t.RPOTargetSeconds > 0 {
		met := *t.RPOActualSeconds <= t.RPOTargetSeconds
		t.RPOMet = &met
	}
	return t
}

func deriveVerdict(status string, checks []HealthCheck, integrity []IntegrityVerdict, teardown TeardownStatus) string {
	switch strings.ToLower(status) {
	case "passed", "completed", "attested":
		// Continue checking below; a failed health/integrity row should dominate.
	case "failed", "aborted", "cancelled":
		return VerdictFailed
	}
	for _, check := range checks {
		if !check.Passed {
			return VerdictFailed
		}
	}
	for _, verdict := range integrity {
		if !verdict.Passed {
			return VerdictFailed
		}
	}
	if teardown.Status == TeardownIncomplete {
		return VerdictWarning
	}
	switch strings.ToLower(status) {
	case "passed", "completed", "attested":
		return VerdictPassed
	default:
		return VerdictUnknown
	}
}

func utcPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	utc := t.UTC()
	return &utc
}

func firstTime(primary *time.Time, fallback time.Time) time.Time {
	if primary != nil {
		return *primary
	}
	return fallback
}

func cloneEvidenceRef(ref *EvidenceReportRef) *EvidenceReportRef {
	if ref == nil {
		return nil
	}
	cp := *ref
	return &cp
}

func taskRunHealthChecks(state runbookstudio.LiveState) []HealthCheck {
	tasksByID := make(map[string]runbookstudio.Task, len(state.Tasks))
	for _, task := range state.Tasks {
		tasksByID[task.ID] = task
	}
	checks := make([]HealthCheck, 0, len(state.TaskRuns))
	for _, tr := range state.TaskRuns {
		task := tasksByID[tr.TaskID]
		status := tr.Status
		passed := status == runbookstudio.TaskRunComplete || status == runbookstudio.TaskRunSkipped
		checkedAt := tr.UpdatedAt
		if tr.FinishedAt != nil {
			checkedAt = *tr.FinishedAt
		}
		checks = append(checks, HealthCheck{
			Name:       task.Name,
			Target:     task.TaskKey,
			Status:     status,
			Passed:     passed,
			CheckedAt:  checkedAt,
			EvidenceID: tr.ID,
			FinishedAt: utcPtr(tr.FinishedAt),
		})
	}
	return checks
}

func failoverApprovalRefs(run drmodel.FailoverRun) []ApprovalRef {
	if run.ApprovedBy == nil || *run.ApprovedBy == "" {
		return nil
	}
	ref := ApprovalRef{Approver: *run.ApprovedBy, Action: "failover_approval", Source: RunTypeFailoverDrill}
	return []ApprovalRef{ref}
}
