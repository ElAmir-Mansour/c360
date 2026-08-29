package copilot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// DRReader is the read surface the copilot tools need over real DR state. It is
// a subset of *repository.Repository, so the production wiring passes the real
// repository unchanged; tests pass a fake backed by an in-memory dataset to
// prove the tools compute real data (not always-true stubs).
type DRReader interface {
	ListSites(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ProtectedSite, error)
	GetSite(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.ProtectedSite, error)
	ListGroups(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ConsistencyGroup, error)
	GetGroup(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.ConsistencyGroup, error)
	ListGroupMembers(ctx context.Context, db repository.DBTX, groupID string) ([]model.ConsistencyGroupMember, error)
	ListStreams(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ReplicationStream, error)
	GetStreamBySite(ctx context.Context, db repository.DBTX, tenantID, siteID string) (*model.ReplicationStream, error)
	ListRecoveryPointsByGroup(ctx context.Context, db repository.DBTX, tenantID, groupID string) ([]*model.RecoveryPoint, error)
	ListFailoverRuns(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.FailoverRun, error)
	GetFailoverRun(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.FailoverRun, error)
	ListFailoverSteps(ctx context.Context, db repository.DBTX, runID string) ([]*model.FailoverStep, error)
	GetAttestationByRun(ctx context.Context, db repository.DBTX, tenantID, runID string) (*model.Attestation, error)
}

// readRunner runs a read against the tenant-scoped DB (RLS sees the tenant).
type readRunner interface {
	RunReadWithTenant(ctx context.Context, tenantID string, fn func(repository.DBTX) error) error
}

// GA service-level objectives the copilot reasons against (DESIGN §11).
const (
	rpoSLOSeconds          = 300   // dr_rpo_seconds SLO <= 300
	rtoSLOSeconds          = 900   // dr_failover_rto_seconds SLO <= 900
	validationSLORatio     = 0.999 // dr_recovery_point_validation_ratio SLO >= 0.999
	gate1ValidationFloor   = 0.999 // Gate 1 (Validate) bar mirrored from failover.gate_validator
	recentFailoverRunLimit = 5
)

// Tools holds the real DR tools the LLM can call. Each tool reads live DR state
// through the tenant runner; none mutate state. ProposeFailover returns a plan
// plus the API call the operator must make — it never initiates or approves a
// run itself.
type Tools struct {
	reader DRReader
	runner readRunner
	now    func() time.Time
}

// NewTools wires the copilot tools over a DR reader and tenant read runner.
func NewTools(reader DRReader, runner readRunner, now func() time.Time) *Tools {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Tools{reader: reader, runner: runner, now: now}
}

// ---------------------------------------------------------------------------
// Tool result shapes (the JSON the LLM consumes — real, computed values)
// ---------------------------------------------------------------------------

// DRStateSummaryResult is the system-wide DR posture the copilot grounds on.
type DRStateSummaryResult struct {
	GeneratedAt     time.Time            `json:"generated_at"`
	SiteCount       int                  `json:"site_count"`
	GroupCount      int                  `json:"group_count"`
	StreamCount     int                  `json:"stream_count"`
	StreamsByStatus map[string]int       `json:"streams_by_status"`
	WorstLiveRPO    *LiveRPOEntry        `json:"worst_live_rpo,omitempty"`
	Streams         []StreamRPOEntry     `json:"streams"`
	RecentRuns      []FailoverRunSummary `json:"recent_runs"`
	RPOBreaches     []LiveRPOEntry       `json:"rpo_breaches"`
	Groups          []GroupSummary       `json:"groups"`
}

// LiveRPOEntry is one stream's live RPO measurement.
type LiveRPOEntry struct {
	StreamID    string `json:"stream_id"`
	SiteID      string `json:"site_id"`
	SiteName    string `json:"site_name,omitempty"`
	Status      string `json:"status"`
	RPOSeconds  int    `json:"rpo_seconds"`
	HasData     bool   `json:"has_data"`
	BreachesSLO bool   `json:"breaches_slo"`
}

// StreamRPOEntry mirrors LiveRPOEntry for the per-stream list.
type StreamRPOEntry = LiveRPOEntry

// GroupSummary describes one consistency group's membership and RPO posture.
type GroupSummary struct {
	GroupID     string `json:"group_id"`
	Name        string `json:"name"`
	MemberCount int    `json:"member_count"`
}

// FailoverRunSummary is a recent failover/drill run's outcome.
type FailoverRunSummary struct {
	RunID        string     `json:"run_id"`
	GroupID      string     `json:"group_id"`
	Mode         string     `json:"mode"`
	Status       string     `json:"status"`
	RTOObjective int        `json:"rto_objective_seconds"`
	RTOActual    *int       `json:"rto_actual_seconds,omitempty"`
	MetRTO       *bool      `json:"met_rto,omitempty"`
	InitiatedAt  time.Time  `json:"initiated_at"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
	LastError    *string    `json:"last_error,omitempty"`
}

// BlastRadiusResult is the impact of losing one site: the consistency groups it
// belongs to, every co-member that fails over with it, and the dependent
// replication streams.
type BlastRadiusResult struct {
	SiteID           string           `json:"site_id"`
	SiteName         string           `json:"site_name"`
	SiteKind         string           `json:"site_kind"`
	ImpactedGroups   []ImpactedGroup  `json:"impacted_groups"`
	ImpactedMembers  []ImpactedMember `json:"impacted_members"`
	DependentStreams []LiveRPOEntry   `json:"dependent_streams"`
	TotalMemberCount int              `json:"total_member_count"`
	GeneratedAt      time.Time        `json:"generated_at"`
}

// ImpactedGroup is a consistency group the queried site belongs to.
type ImpactedGroup struct {
	GroupID   string `json:"group_id"`
	Name      string `json:"name"`
	BootOrder int    `json:"boot_order"`
}

// ImpactedMember is a site that fails over together with the queried site.
type ImpactedMember struct {
	SiteID    string `json:"site_id"`
	SiteName  string `json:"site_name"`
	SiteKind  string `json:"site_kind"`
	GroupID   string `json:"group_id"`
	GroupName string `json:"group_name"`
	BootOrder int    `json:"boot_order"`
	IsQueried bool   `json:"is_queried_site"`
}

// DrillSummaryResult is the outcome of one failover/drill run plus its
// attestation (if Gate 4 sealed one).
type DrillSummaryResult struct {
	Run         FailoverRunSummary `json:"run"`
	Steps       []DrillStep        `json:"steps"`
	Attestation *AttestationResult `json:"attestation,omitempty"`
	GeneratedAt time.Time          `json:"generated_at"`
}

// DrillStep is one durable step record from a run's audit trail.
type DrillStep struct {
	Step       string     `json:"step"`
	Status     string     `json:"status"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
}

// AttestationResult is the NCA-ready Gate-4 attestation for a run.
type AttestationResult struct {
	AttestationID   string    `json:"attestation_id"`
	RunID           string    `json:"run_id"`
	RTOObjective    int       `json:"rto_objective_seconds"`
	RTOActual       int       `json:"rto_actual_seconds"`
	MetRTO          bool      `json:"met_rto"`
	RPOSeconds      int       `json:"rpo_seconds"`
	ValidationRatio float64   `json:"validation_ratio"`
	MetValidation   bool      `json:"met_validation_slo"`
	ReportObjectKey string    `json:"report_object_key"`
	ContentHash     string    `json:"content_hash"`
	CreatedAt       time.Time `json:"created_at"`
}

// ---------------------------------------------------------------------------
// DRStateSummary
// ---------------------------------------------------------------------------

// DRStateSummary reports the system-wide DR posture: sites, groups, streams,
// live RPO per stream (now - applied_at), RPO breaches against the GA SLO, and
// the most recent failover/drill runs. All values are read live from the DR
// control plane and computed here — nothing is fabricated.
func (t *Tools) DRStateSummary(ctx context.Context, tenantID string) (*DRStateSummaryResult, error) {
	now := t.now()
	out := &DRStateSummaryResult{
		GeneratedAt:     now,
		StreamsByStatus: map[string]int{},
	}

	err := t.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		sites, serr := t.reader.ListSites(ctx, db, tenantID)
		if serr != nil {
			return serr
		}
		groups, gerr := t.reader.ListGroups(ctx, db, tenantID)
		if gerr != nil {
			return gerr
		}
		streams, strErr := t.reader.ListStreams(ctx, db, tenantID)
		if strErr != nil {
			return strErr
		}
		runs, rErr := t.reader.ListFailoverRuns(ctx, db, tenantID)
		if rErr != nil {
			return rErr
		}

		siteName := map[string]string{}
		for _, s := range sites {
			siteName[s.ID] = s.Name
		}

		out.SiteCount = len(sites)
		out.GroupCount = len(groups)
		out.StreamCount = len(streams)

		for _, g := range groups {
			members, merr := t.reader.ListGroupMembers(ctx, db, g.ID)
			if merr != nil {
				return merr
			}
			out.Groups = append(out.Groups, GroupSummary{
				GroupID:     g.ID,
				Name:        g.Name,
				MemberCount: len(members),
			})
		}

		var worst *LiveRPOEntry
		for _, s := range streams {
			out.StreamsByStatus[s.Status]++
			entry := liveRPOEntry(s, siteName[s.SiteID], now)
			out.Streams = append(out.Streams, entry)
			if entry.BreachesSLO {
				out.RPOBreaches = append(out.RPOBreaches, entry)
			}
			if entry.HasData && (worst == nil || entry.RPOSeconds > worst.RPOSeconds) {
				e := entry
				worst = &e
			}
		}
		out.WorstLiveRPO = worst

		out.RecentRuns = recentRuns(runs, recentFailoverRunLimit)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("copilot: DRStateSummary: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// BlastRadius
// ---------------------------------------------------------------------------

// BlastRadius computes the impact of losing siteID: the consistency groups the
// site belongs to, every co-member that fails over with it (the real group
// membership), and the dependent replication streams for the queried site and
// every co-member. This is the real impact graph from the group/member model,
// not a fabricated list.
func (t *Tools) BlastRadius(ctx context.Context, tenantID, siteID string) (*BlastRadiusResult, error) {
	siteID = strings.TrimSpace(siteID)
	if siteID == "" {
		return nil, fmt.Errorf("copilot: BlastRadius: site_id is required")
	}
	now := t.now()
	out := &BlastRadiusResult{SiteID: siteID, GeneratedAt: now}

	err := t.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		site, serr := t.reader.GetSite(ctx, db, tenantID, siteID)
		if serr != nil {
			return serr
		}
		out.SiteName = site.Name
		out.SiteKind = site.Kind

		sites, slErr := t.reader.ListSites(ctx, db, tenantID)
		if slErr != nil {
			return slErr
		}
		siteByID := map[string]*model.ProtectedSite{}
		for _, s := range sites {
			siteByID[s.ID] = s
		}

		groups, gerr := t.reader.ListGroups(ctx, db, tenantID)
		if gerr != nil {
			return gerr
		}

		// Collect every group the queried site is a member of, and from those
		// groups every co-member that fails over with it (boot-ordered).
		impactedSiteIDs := map[string]struct{}{siteID: {}}
		seenMember := map[string]struct{}{} // dedupe by site|group
		for _, g := range groups {
			members, merr := t.reader.ListGroupMembers(ctx, db, g.ID)
			if merr != nil {
				return merr
			}
			// Is the queried site in this group?
			var queriedBoot int
			inGroup := false
			for _, m := range members {
				if m.SiteID == siteID {
					inGroup = true
					queriedBoot = m.BootOrder
					break
				}
			}
			if !inGroup {
				continue
			}
			out.ImpactedGroups = append(out.ImpactedGroups, ImpactedGroup{
				GroupID:   g.ID,
				Name:      g.Name,
				BootOrder: queriedBoot,
			})
			for _, m := range members {
				key := m.SiteID + "|" + m.GroupID
				if _, dup := seenMember[key]; dup {
					continue
				}
				seenMember[key] = struct{}{}
				impactedSiteIDs[m.SiteID] = struct{}{}
				name, kind := "", ""
				if s, ok := siteByID[m.SiteID]; ok {
					name, kind = s.Name, s.Kind
				}
				out.ImpactedMembers = append(out.ImpactedMembers, ImpactedMember{
					SiteID:    m.SiteID,
					SiteName:  name,
					SiteKind:  kind,
					GroupID:   g.ID,
					GroupName: g.Name,
					BootOrder: m.BootOrder,
					IsQueried: m.SiteID == siteID,
				})
			}
		}

		// Dependent streams: one per impacted site that has a stream.
		impacted := make([]string, 0, len(impactedSiteIDs))
		for id := range impactedSiteIDs {
			impacted = append(impacted, id)
		}
		sort.Strings(impacted)
		for _, id := range impacted {
			stream, strErr := t.reader.GetStreamBySite(ctx, db, tenantID, id)
			if strErr != nil {
				// A site without a stream is not an error for blast-radius; skip.
				if isNotFound(strErr) {
					continue
				}
				return strErr
			}
			name := ""
			if s, ok := siteByID[id]; ok {
				name = s.Name
			}
			out.DependentStreams = append(out.DependentStreams, liveRPOEntry(stream, name, now))
		}

		// Deterministic ordering for stable output / tests.
		sort.SliceStable(out.ImpactedMembers, func(i, j int) bool {
			if out.ImpactedMembers[i].GroupID != out.ImpactedMembers[j].GroupID {
				return out.ImpactedMembers[i].GroupID < out.ImpactedMembers[j].GroupID
			}
			return out.ImpactedMembers[i].BootOrder < out.ImpactedMembers[j].BootOrder
		})
		out.TotalMemberCount = len(out.ImpactedMembers)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("copilot: BlastRadius: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// DrillSummary / AttestationSummary
// ---------------------------------------------------------------------------

// DrillSummary reports the outcome of one failover/drill run: its FSM status,
// achieved-vs-objective RTO, the durable step audit trail, and the Gate-4
// attestation if one was sealed. Real values from failover_run / failover_step
// / attestation rows.
func (t *Tools) DrillSummary(ctx context.Context, tenantID, runID string) (*DrillSummaryResult, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, fmt.Errorf("copilot: DrillSummary: run_id is required")
	}
	now := t.now()
	out := &DrillSummaryResult{GeneratedAt: now}

	err := t.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		run, rerr := t.reader.GetFailoverRun(ctx, db, tenantID, runID)
		if rerr != nil {
			return rerr
		}
		out.Run = runSummary(run)

		steps, serr := t.reader.ListFailoverSteps(ctx, db, runID)
		if serr != nil {
			return serr
		}
		for _, s := range steps {
			out.Steps = append(out.Steps, DrillStep{
				Step:       s.Step,
				Status:     s.Status,
				StartedAt:  s.StartedAt,
				FinishedAt: s.FinishedAt,
			})
		}

		att, aerr := t.reader.GetAttestationByRun(ctx, db, tenantID, runID)
		if aerr != nil {
			if isNotFound(aerr) {
				return nil // not yet attested — valid, no attestation block
			}
			return aerr
		}
		out.Attestation = attestationResult(att)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("copilot: DrillSummary: %w", err)
	}
	return out, nil
}

// AttestationSummary returns just the Gate-4 attestation for a run. Returns
// ErrNotFound (wrapped) when the run has not reached ATTESTED/COMPLETED.
func (t *Tools) AttestationSummary(ctx context.Context, tenantID, runID string) (*AttestationResult, error) {
	runID = strings.TrimSpace(runID)
	if runID == "" {
		return nil, fmt.Errorf("copilot: AttestationSummary: run_id is required")
	}
	var out *AttestationResult
	err := t.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		att, aerr := t.reader.GetAttestationByRun(ctx, db, tenantID, runID)
		if aerr != nil {
			return aerr
		}
		out = attestationResult(att)
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("copilot: AttestationSummary: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// ProposeFailover (NEVER executes — returns a plan + the gated API call)
// ---------------------------------------------------------------------------

// ProposeFailover builds a recovery plan for a consistency group and returns the
// exact API call the operator must issue to initiate it. It DOES NOT create or
// approve a run: the returned APICall (POST /failover-runs) creates a run that
// parks at AWAITING_APPROVAL, and the operator must separately perform the
// ApprovalCall (POST /failover-runs/{id}/approve). The plan respects the
// existing gates by selecting the newest VALIDATED recovery point and warning
// when none meets the Gate-1 validation floor, when streams are not healthy, or
// when boot order/network mapping is incomplete.
func (t *Tools) ProposeFailover(ctx context.Context, tenantID, groupID string) (*ProposedAction, error) {
	groupID = strings.TrimSpace(groupID)
	if groupID == "" {
		return nil, fmt.Errorf("copilot: ProposeFailover: group_id is required")
	}
	now := t.now()
	var action *ProposedAction

	err := t.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		group, gerr := t.reader.GetGroup(ctx, db, tenantID, groupID)
		if gerr != nil {
			return gerr
		}
		members, merr := t.reader.ListGroupMembers(ctx, db, groupID)
		if merr != nil {
			return merr
		}
		sites, slErr := t.reader.ListSites(ctx, db, tenantID)
		if slErr != nil {
			return slErr
		}
		siteByID := map[string]*model.ProtectedSite{}
		for _, s := range sites {
			siteByID[s.ID] = s
		}
		points, perr := t.reader.ListRecoveryPointsByGroup(ctx, db, tenantID, groupID)
		if perr != nil {
			return perr
		}

		var warnings []string

		// Boot order plan (the order members will be brought up).
		bootOrder := make([]ImpactedMember, 0, len(members))
		for _, m := range members {
			name, kind := "", ""
			if s, ok := siteByID[m.SiteID]; ok {
				name, kind = s.Name, s.Kind
			}
			bootOrder = append(bootOrder, ImpactedMember{
				SiteID:    m.SiteID,
				SiteName:  name,
				SiteKind:  kind,
				GroupID:   groupID,
				GroupName: group.Name,
				BootOrder: m.BootOrder,
			})
		}
		sort.SliceStable(bootOrder, func(i, j int) bool {
			return bootOrder[i].BootOrder < bootOrder[j].BootOrder
		})
		if len(bootOrder) == 0 {
			warnings = append(warnings, "consistency group has no members; nothing to fail over")
		}

		// Gate-1 recovery point: newest VALIDATED point meeting the validation
		// floor. This mirrors failover.DriverGateValidator: a point that is not
		// validated, or whose ratio is below the floor, cannot pass Gate 1.
		var chosen *model.RecoveryPoint
		var rtoObjective int
		// RTO objective for the run = max member RTO objective (whole group up).
		for _, m := range members {
			if s, ok := siteByID[m.SiteID]; ok && s.RTOObjectiveSeconds > rtoObjective {
				rtoObjective = s.RTOObjectiveSeconds
			}
		}
		if rtoObjective == 0 {
			rtoObjective = rtoSLOSeconds
		}
		for _, rp := range points {
			ratio := 0.0
			if rp.ValidationRatio != nil {
				ratio = *rp.ValidationRatio
			}
			if !rp.IsValidated || ratio < gate1ValidationFloor {
				continue
			}
			if chosen == nil || rp.SealedAt.After(chosen.SealedAt) {
				chosen = rp
			}
		}
		if chosen == nil {
			warnings = append(warnings,
				fmt.Sprintf("no validated recovery point meets the Gate-1 validation floor (%.1f%%); the run will fail validation until one is sealed",
					gate1ValidationFloor*100))
		}

		// Stream health: warn if any member's stream is not actively streaming.
		var unhealthy []string
		for _, m := range members {
			stream, strErr := t.reader.GetStreamBySite(ctx, db, tenantID, m.SiteID)
			if strErr != nil {
				if isNotFound(strErr) {
					unhealthy = append(unhealthy, fmt.Sprintf("site %s has no replication stream", m.SiteID))
					continue
				}
				return strErr
			}
			if stream.Status != model.StreamStatusStreaming {
				unhealthy = append(unhealthy, fmt.Sprintf("stream %s for site %s is %q (not streaming)", stream.ID, m.SiteID, stream.Status))
			}
		}
		warnings = append(warnings, unhealthy...)

		plan := map[string]any{
			"group_id":              groupID,
			"group_name":            group.Name,
			"member_count":          len(members),
			"boot_order":            bootOrder,
			"rto_objective_seconds": rtoObjective,
			"recovery_point":        recoveryPointPlan(chosen),
			"generated_at":          now,
		}

		body := map[string]any{
			"group_id":              groupID,
			"mode":                  model.ModeReal,
			"rto_objective_seconds": rtoObjective,
		}
		if chosen != nil {
			body["recovery_point_id"] = chosen.ID
		}

		summary := fmt.Sprintf("Proposed real failover of consistency group %q (%d member(s)). This is a PROPOSAL ONLY: initiating creates a run that parks at AWAITING_APPROVAL and requires explicit human approval before any execution.",
			group.Name, len(members))

		action = &ProposedAction{
			Kind:             "failover",
			Summary:          summary,
			RequiresApproval: true,
			APICall: APICall{
				Method: "POST",
				Path:   "/api/v1/dr/failover-runs",
				Body:   body,
			},
			ApprovalCall: &APICall{
				Method: "POST",
				Path:   "/api/v1/dr/failover-runs/{run_id}/approve",
			},
			Plan:     plan,
			Warnings: warnings,
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("copilot: ProposeFailover: %w", err)
	}
	return action, nil
}

// ---------------------------------------------------------------------------
// helpers (pure, real computations)
// ---------------------------------------------------------------------------

func liveRPOEntry(s *model.ReplicationStream, siteName string, now time.Time) LiveRPOEntry {
	rpo, ok := s.LiveRPO(now)
	seconds := int(rpo.Seconds())
	return LiveRPOEntry{
		StreamID:    s.ID,
		SiteID:      s.SiteID,
		SiteName:    siteName,
		Status:      s.Status,
		RPOSeconds:  seconds,
		HasData:     ok,
		BreachesSLO: ok && seconds > rpoSLOSeconds,
	}
}

func recentRuns(runs []*model.FailoverRun, limit int) []FailoverRunSummary {
	sort.SliceStable(runs, func(i, j int) bool {
		return runs[i].InitiatedAt.After(runs[j].InitiatedAt)
	})
	if limit > 0 && len(runs) > limit {
		runs = runs[:limit]
	}
	out := make([]FailoverRunSummary, 0, len(runs))
	for _, r := range runs {
		out = append(out, runSummary(r))
	}
	return out
}

func runSummary(r *model.FailoverRun) FailoverRunSummary {
	s := FailoverRunSummary{
		RunID:        r.ID,
		GroupID:      r.GroupID,
		Mode:         r.Mode,
		Status:       r.Status,
		RTOObjective: r.RTOObjectiveSeconds,
		RTOActual:    r.RTOActualSeconds,
		InitiatedAt:  r.InitiatedAt,
		CompletedAt:  r.CompletedAt,
		LastError:    r.LastError,
	}
	if r.RTOActualSeconds != nil {
		met := *r.RTOActualSeconds <= r.RTOObjectiveSeconds
		s.MetRTO = &met
	}
	return s
}

func attestationResult(a *model.Attestation) *AttestationResult {
	return &AttestationResult{
		AttestationID:   a.ID,
		RunID:           a.RunID,
		RTOObjective:    a.RTOObjectiveSeconds,
		RTOActual:       a.RTOActualSeconds,
		MetRTO:          a.RTOActualSeconds <= a.RTOObjectiveSeconds,
		RPOSeconds:      a.RPOSeconds,
		ValidationRatio: a.ValidationRatio,
		MetValidation:   a.ValidationRatio >= validationSLORatio,
		ReportObjectKey: a.ReportObjectKey,
		ContentHash:     a.ContentHash,
		CreatedAt:       a.CreatedAt,
	}
}

func recoveryPointPlan(rp *model.RecoveryPoint) map[string]any {
	if rp == nil {
		return map[string]any{
			"available": false,
			"reason":    "no validated recovery point meets the Gate-1 validation floor",
		}
	}
	ratio := 0.0
	if rp.ValidationRatio != nil {
		ratio = *rp.ValidationRatio
	}
	return map[string]any{
		"available":         true,
		"recovery_point_id": rp.ID,
		"marker_lsn":        rp.MarkerLSN,
		"rpo_seconds":       rp.RPOSeconds,
		"validation_ratio":  ratio,
		"is_validated":      rp.IsValidated,
		"legal_hold":        rp.LegalHold,
		"sealed_at":         rp.SealedAt,
	}
}

func isNotFound(err error) bool {
	return errors.Is(err, model.ErrNotFound)
}
