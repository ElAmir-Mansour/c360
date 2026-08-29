package recover

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/bootgraph"
	drmodel "github.com/clario360/platform/internal/dr/model"
)

// ErrCloudDRReader is returned when the Cloud DR composition cannot read a
// dependency from one of the composed dr/* services. Callers map it to 500 with
// no stack trace leaked.
var ErrCloudDRReader = errors.New("recover: cloud-dr read failed")

// ----------------------------------------------------------------------------
// Composition seams. Cloud DR owns NO recovery logic — it composes the public
// read surfaces of the existing dr/* services. These interfaces are the exact
// shape Cloud DR needs; the concrete dr/* services satisfy them (compile-time
// checks live in the cmd wiring), and tests substitute fakes so the aggregation
// logic is exercised without a database or live services.
// ----------------------------------------------------------------------------

// BootPlanner resolves a consistency group's dependency-aware boot plan. It is
// satisfied by *bootgraph.Manager (its GetPlan). Cloud DR reuses the bootgraph
// engine's plan verbatim — it does not recompute tiers.
type BootPlanner interface {
	GetPlan(ctx context.Context, tenantID uuid.UUID, groupID string) (bootgraph.BootPlan, error)
}

// EstateReader resolves the tenant's recovery estate from the DR repository:
// consistency groups (the recovery scopes a region/AZ failover targets), each
// group's member sites, and the tenant's failover/drill run history. It is
// satisfied by a repository-backed reader that runs every call inside a single
// read-only tenant transaction (RLS-isolated).
type EstateReader interface {
	ListGroups(ctx context.Context, tenantID uuid.UUID) ([]drmodel.ConsistencyGroup, error)
	ListGroupMembers(ctx context.Context, tenantID uuid.UUID, groupID string) ([]drmodel.ConsistencyGroupMember, error)
	ListSites(ctx context.Context, tenantID uuid.UUID) ([]drmodel.ProtectedSite, error)
	ListFailoverRuns(ctx context.Context, tenantID uuid.UUID) ([]drmodel.FailoverRun, error)
}

// WorkloadReader resolves the protected workloads backing Cloud DR: captured VM
// sources (vmcapture) and ingested infrastructure-as-code snapshots (iacdr). It
// is satisfied by adapters over vmcapture.Service.ListSources and
// iacdr.Service.ListSnapshots.
type WorkloadReader interface {
	ListVMSources(ctx context.Context, tenantID uuid.UUID) ([]VMSourceSummary, error)
	ListIaCSnapshots(ctx context.Context, tenantID uuid.UUID) ([]IaCSnapshotSummary, error)
}

// VMSourceSummary is the Cloud-DR-facing projection of a vmcapture source. The
// adapter maps vmcapture.Source into this stable shape so Cloud DR does not bind
// to the vmcapture model.
type VMSourceSummary struct {
	ID         string     `json:"id"`
	Name       string     `json:"name"`
	SourceKind string     `json:"source_kind"`
	Enabled    bool       `json:"enabled"`
	EpochCount int        `json:"epoch_count"`
	LastRunAt  *time.Time `json:"last_run_at,omitempty"`
}

// IaCSnapshotSummary is the Cloud-DR-facing projection of an iacdr snapshot.
type IaCSnapshotSummary struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	SourceKind    string    `json:"source_kind"`
	Version       int       `json:"version"`
	ResourceCount int       `json:"resource_count"`
	CreatedAt     time.Time `json:"created_at"`
}

// ----------------------------------------------------------------------------
// Response shapes for GET /api/recover/cloud-dr/overview and /regions.
// ----------------------------------------------------------------------------

// CloudDROverview is the GET /api/recover/cloud-dr/overview payload: the
// tenant's protected workloads, the last failover test, and the boot-graph
// status across recovery scopes. Every field is computed from real persisted
// state — there is no canned data.
type CloudDROverview struct {
	// Workloads summarises the protected estate (VM captures + IaC snapshots).
	Workloads WorkloadSummary `json:"workloads"`
	// LastFailoverTest is the most recent failover/drill run, or nil if none has
	// ever run.
	LastFailoverTest *FailoverTestSummary `json:"last_failover_test,omitempty"`
	// BootGraph aggregates each recovery scope's dependency-aware boot plan.
	BootGraph BootGraphSummary `json:"boot_graph"`
}

// WorkloadSummary counts the protected workloads backing Cloud DR.
type WorkloadSummary struct {
	VMSources     int                  `json:"vm_sources"`
	VMSourcesList []VMSourceSummary    `json:"vm_sources_list"`
	IaCSnapshots  int                  `json:"iac_snapshots"`
	IaCList       []IaCSnapshotSummary `json:"iac_snapshots_list"`
}

// FailoverTestSummary is the most-recent failover/drill run, with its captured
// RTO actual versus the defined RTO objective so the UI can show RTO-vs-RTA at a
// glance.
type FailoverTestSummary struct {
	ID                  string     `json:"id"`
	GroupID             string     `json:"group_id"`
	Mode                string     `json:"mode"`
	Status              string     `json:"status"`
	RTOObjectiveSeconds int        `json:"rto_objective_seconds"`
	RTOActualSeconds    *int       `json:"rto_actual_seconds,omitempty"`
	InitiatedAt         time.Time  `json:"initiated_at"`
	CompletedAt         *time.Time `json:"completed_at,omitempty"`
}

// BootGraphSummary aggregates the dependency-aware boot plans across every
// recovery scope (consistency group). Scopes is the per-scope breakdown the
// region/AZ failover view drills into.
type BootGraphSummary struct {
	TotalScopes    int                `json:"total_scopes"`
	ScopesWithPlan int                `json:"scopes_with_plan"`
	TotalServices  int                `json:"total_services"`
	Scopes         []RegionBootStatus `json:"scopes"`
}

// RegionBootStatus is one recovery scope's (region/AZ) boot-graph status: its
// identity, member sites, and the tier/service shape of its dependency-aware
// boot plan. It is the row the region/AZ failover view lists before a target is
// selected.
type RegionBootStatus struct {
	GroupID      string   `json:"group_id"`
	GroupName    string   `json:"group_name"`
	SiteNames    []string `json:"site_names"`
	TierCount    int      `json:"tier_count"`
	ServiceCount int      `json:"service_count"`
	HasPlan      bool     `json:"has_plan"`
}

// RegionFailoverPlan is the GET /api/recover/cloud-dr/regions/{groupID}/boot-plan
// payload: the real, dependency-ordered boot plan for one recovery scope, ready
// to visualise BEFORE execution. It carries the bootgraph engine's tiers
// verbatim (Cloud DR does not recompute ordering) alongside the scope identity.
type RegionFailoverPlan struct {
	GroupID      string   `json:"group_id"`
	GroupName    string   `json:"group_name"`
	SiteNames    []string `json:"site_names"`
	TierCount    int      `json:"tier_count"`
	ServiceCount int      `json:"service_count"`
	// Tiers is the bootgraph plan: Tiers[0] boots first; services within a tier
	// boot in parallel once the prior tier's health gate passes.
	Tiers [][]bootgraph.Service `json:"tiers"`
}

// ----------------------------------------------------------------------------
// CloudDRService — the composition service.
// ----------------------------------------------------------------------------

// CloudDRConfig wires a CloudDRService from the existing dr/* read surfaces.
type CloudDRConfig struct {
	// Planner resolves a group's boot plan (the bootgraph engine).
	Planner BootPlanner
	// Estate resolves recovery scopes, members, sites, and failover runs.
	Estate EstateReader
	// Workloads resolves VM captures and IaC snapshots.
	Workloads WorkloadReader
	// Logger is the structured logger; required.
	Logger zerolog.Logger
}

// CloudDRService composes the Cloud DR sub-solution's read surface over the
// existing dr/* services (bootgraph, vmcapture, iacdr, failover-run history).
// It owns no recovery logic: every value it returns is read from the composed
// services' public APIs and aggregated. It is read-only.
type CloudDRService struct {
	planner   BootPlanner
	estate    EstateReader
	workloads WorkloadReader
	logger    zerolog.Logger
}

// NewCloudDRService validates the config and constructs the service.
func NewCloudDRService(cfg CloudDRConfig) (*CloudDRService, error) {
	if cfg.Planner == nil {
		return nil, errors.New("recover cloud-dr: boot planner is required")
	}
	if cfg.Estate == nil {
		return nil, errors.New("recover cloud-dr: estate reader is required")
	}
	if cfg.Workloads == nil {
		return nil, errors.New("recover cloud-dr: workload reader is required")
	}
	return &CloudDRService{
		planner:   cfg.Planner,
		estate:    cfg.Estate,
		workloads: cfg.Workloads,
		logger:    cfg.Logger.With().Str("service", "recover-cloud-dr").Logger(),
	}, nil
}

// Overview composes the Cloud DR overview for a tenant: the protected workloads,
// the last failover test, and the boot-graph status across every recovery scope.
// It performs a bounded number of reads (one per composed service plus one boot
// plan per scope) — no N+1 over individual workloads.
func (s *CloudDRService) Overview(ctx context.Context, tenantID uuid.UUID) (*CloudDROverview, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover cloud-dr: tenant id is required")
	}

	vmSources, err := s.workloads.ListVMSources(ctx, tenantID)
	if err != nil {
		return nil, errors.Join(ErrCloudDRReader, err)
	}
	iacSnapshots, err := s.workloads.ListIaCSnapshots(ctx, tenantID)
	if err != nil {
		return nil, errors.Join(ErrCloudDRReader, err)
	}

	lastTest, err := s.lastFailoverTest(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	bootGraph, err := s.bootGraphSummary(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	s.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Int("vm_sources", len(vmSources)).
		Int("iac_snapshots", len(iacSnapshots)).
		Int("scopes", bootGraph.TotalScopes).
		Msg("composed cloud-dr overview")

	return &CloudDROverview{
		Workloads: WorkloadSummary{
			VMSources:     len(vmSources),
			VMSourcesList: vmSources,
			IaCSnapshots:  len(iacSnapshots),
			IaCList:       iacSnapshots,
		},
		LastFailoverTest: lastTest,
		BootGraph:        bootGraph,
	}, nil
}

// Regions returns each recovery scope's boot-graph status — the list the
// region/AZ failover view renders before a target scope is selected.
func (s *CloudDRService) Regions(ctx context.Context, tenantID uuid.UUID) ([]RegionBootStatus, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover cloud-dr: tenant id is required")
	}
	summary, err := s.bootGraphSummary(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	return summary.Scopes, nil
}

// RegionBootPlan resolves the real, dependency-ordered boot plan for one
// recovery scope so the region/AZ failover view can visualise the boot sequence
// and dependency order BEFORE execution. The tiers come straight from the
// bootgraph engine — Cloud DR does not recompute them.
func (s *CloudDRService) RegionBootPlan(ctx context.Context, tenantID uuid.UUID, groupID string) (*RegionFailoverPlan, error) {
	if tenantID == uuid.Nil {
		return nil, errors.New("recover cloud-dr: tenant id is required")
	}
	if _, err := uuid.Parse(groupID); err != nil {
		return nil, errors.Join(ErrUnknownRegion, err)
	}

	groups, err := s.estate.ListGroups(ctx, tenantID)
	if err != nil {
		return nil, errors.Join(ErrCloudDRReader, err)
	}
	var group *drmodel.ConsistencyGroup
	for i := range groups {
		if groups[i].ID == groupID {
			group = &groups[i]
			break
		}
	}
	if group == nil {
		return nil, ErrUnknownRegion
	}

	siteNames, err := s.siteNamesForGroup(ctx, tenantID, groupID)
	if err != nil {
		return nil, err
	}

	plan, err := s.planner.GetPlan(ctx, tenantID, groupID)
	if err != nil {
		return nil, errors.Join(ErrCloudDRReader, err)
	}

	serviceCount := 0
	for _, tier := range plan.Tiers {
		serviceCount += len(tier)
	}

	return &RegionFailoverPlan{
		GroupID:      group.ID,
		GroupName:    group.Name,
		SiteNames:    siteNames,
		TierCount:    len(plan.Tiers),
		ServiceCount: serviceCount,
		Tiers:        plan.Tiers,
	}, nil
}

// ErrUnknownRegion is returned for a region/scope (consistency group) that does
// not belong to the tenant. Callers map it to 404.
var ErrUnknownRegion = errors.New("recover cloud-dr: unknown recovery scope")

// lastFailoverTest reads the tenant's failover/drill run history and returns the
// most recent run by initiated-at, or nil when none exist.
func (s *CloudDRService) lastFailoverTest(ctx context.Context, tenantID uuid.UUID) (*FailoverTestSummary, error) {
	runs, err := s.estate.ListFailoverRuns(ctx, tenantID)
	if err != nil {
		return nil, errors.Join(ErrCloudDRReader, err)
	}
	if len(runs) == 0 {
		return nil, nil
	}
	latest := runs[0]
	for i := 1; i < len(runs); i++ {
		if runs[i].InitiatedAt.After(latest.InitiatedAt) {
			latest = runs[i]
		}
	}
	return &FailoverTestSummary{
		ID:                  latest.ID,
		GroupID:             latest.GroupID,
		Mode:                latest.Mode,
		Status:              latest.Status,
		RTOObjectiveSeconds: latest.RTOObjectiveSeconds,
		RTOActualSeconds:    latest.RTOActualSeconds,
		InitiatedAt:         latest.InitiatedAt,
		CompletedAt:         latest.CompletedAt,
	}, nil
}

// bootGraphSummary resolves every recovery scope's boot-graph status: it lists
// the tenant's consistency groups, resolves each group's boot plan from the
// bootgraph engine, and aggregates tier/service counts. A scope with no defined
// boot services yields HasPlan=false rather than an error.
func (s *CloudDRService) bootGraphSummary(ctx context.Context, tenantID uuid.UUID) (BootGraphSummary, error) {
	groups, err := s.estate.ListGroups(ctx, tenantID)
	if err != nil {
		return BootGraphSummary{}, errors.Join(ErrCloudDRReader, err)
	}

	sitesByID, err := s.sitesByID(ctx, tenantID)
	if err != nil {
		return BootGraphSummary{}, err
	}

	out := BootGraphSummary{TotalScopes: len(groups), Scopes: make([]RegionBootStatus, 0, len(groups))}
	for i := range groups {
		g := groups[i]
		members, merr := s.estate.ListGroupMembers(ctx, tenantID, g.ID)
		if merr != nil {
			return BootGraphSummary{}, errors.Join(ErrCloudDRReader, merr)
		}
		siteNames := make([]string, 0, len(members))
		for _, m := range members {
			if name, ok := sitesByID[m.SiteID]; ok {
				siteNames = append(siteNames, name)
			}
		}
		sort.Strings(siteNames)

		plan, perr := s.planner.GetPlan(ctx, tenantID, g.ID)
		if perr != nil {
			return BootGraphSummary{}, errors.Join(ErrCloudDRReader, perr)
		}
		serviceCount := 0
		for _, tier := range plan.Tiers {
			serviceCount += len(tier)
		}
		hasPlan := serviceCount > 0
		if hasPlan {
			out.ScopesWithPlan++
		}
		out.TotalServices += serviceCount
		out.Scopes = append(out.Scopes, RegionBootStatus{
			GroupID:      g.ID,
			GroupName:    g.Name,
			SiteNames:    siteNames,
			TierCount:    len(plan.Tiers),
			ServiceCount: serviceCount,
			HasPlan:      hasPlan,
		})
	}
	sort.Slice(out.Scopes, func(i, j int) bool { return out.Scopes[i].GroupName < out.Scopes[j].GroupName })
	return out, nil
}

// sitesByID returns the tenant's protected sites keyed by id, for resolving
// group-member site names in one read instead of per-member lookups.
func (s *CloudDRService) sitesByID(ctx context.Context, tenantID uuid.UUID) (map[string]string, error) {
	sites, err := s.estate.ListSites(ctx, tenantID)
	if err != nil {
		return nil, errors.Join(ErrCloudDRReader, err)
	}
	byID := make(map[string]string, len(sites))
	for _, st := range sites {
		byID[st.ID] = st.Name
	}
	return byID, nil
}

// siteNamesForGroup resolves the member site names of one group, sorted.
func (s *CloudDRService) siteNamesForGroup(ctx context.Context, tenantID uuid.UUID, groupID string) ([]string, error) {
	sitesByID, err := s.sitesByID(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	members, err := s.estate.ListGroupMembers(ctx, tenantID, groupID)
	if err != nil {
		return nil, errors.Join(ErrCloudDRReader, err)
	}
	names := make([]string, 0, len(members))
	for _, m := range members {
		if name, ok := sitesByID[m.SiteID]; ok {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names, nil
}
