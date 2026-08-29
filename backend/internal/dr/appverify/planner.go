package appverify

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
)

var (
	// ErrUnknownCheck is returned when objectives name a check that does not
	// exist in the selected profile.
	ErrUnknownCheck = errors.New("appverify: unknown check")
	// ErrMissingFallbackProfile is returned when an unknown workload cannot fall
	// back because the catalog does not contain generic_http.
	ErrMissingFallbackProfile = errors.New("appverify: missing generic_http fallback profile")
)

// WorkloadEndpoint describes a known endpoint for the recovered workload.
type WorkloadEndpoint struct {
	Name    string `json:"name,omitempty"`
	Type    string `json:"type,omitempty"`
	Address string `json:"address,omitempty"`
	URL     string `json:"url,omitempty"`
}

// WorkloadMetadata is the workload context the planner binds to a profile.
type WorkloadMetadata struct {
	ID              string             `json:"id,omitempty"`
	Name            string             `json:"name,omitempty"`
	Kind            WorkloadKind       `json:"kind"`
	Endpoints       []WorkloadEndpoint `json:"endpoints,omitempty"`
	Database        string             `json:"database,omitempty"`
	Namespace       string             `json:"namespace,omitempty"`
	Domain          string             `json:"domain,omitempty"`
	RecoveryPointID string             `json:"recovery_point_id,omitempty"`
	Attributes      map[string]string  `json:"attributes,omitempty"`
}

// RecoveryObjectives influences optional check inclusion and binds common
// objective parameters into the plan. Required checks in the profile are always
// included.
type RecoveryObjectives struct {
	RTOSeconds            int      `json:"rto_seconds,omitempty"`
	RPOSeconds            int      `json:"rpo_seconds,omitempty"`
	MaxLagSeconds         int      `json:"max_lag_seconds,omitempty"`
	IncludeOptionalChecks bool     `json:"include_optional_checks,omitempty"`
	IncludeCheckIDs       []string `json:"include_check_ids,omitempty"`
	RequireCheckIDs       []string `json:"require_check_ids,omitempty"`
}

// CheckPlan is the deterministic ordered verification plan for one workload.
type CheckPlan struct {
	WorkloadID    string             `json:"workload_id,omitempty"`
	WorkloadName  string             `json:"workload_name,omitempty"`
	RequestedKind WorkloadKind       `json:"requested_kind"`
	ProfileKind   WorkloadKind       `json:"profile_kind"`
	Objectives    RecoveryObjectives `json:"objectives"`
	Parameters    map[string]string  `json:"parameters,omitempty"`
	Checks        []PlannedCheck     `json:"checks"`
}

// PlannedCheck is a VerificationCheck with its deterministic sequence and bound
// workload/objective parameters.
type PlannedCheck struct {
	Sequence   int               `json:"sequence"`
	Parameters map[string]string `json:"parameters,omitempty"`
	VerificationCheck
}

// CheckIDs returns planned check IDs in execution order.
func (p CheckPlan) CheckIDs() []string {
	out := make([]string, len(p.Checks))
	for i, check := range p.Checks {
		out[i] = check.ID
	}
	return out
}

// RequiredCheckIDs returns planned required check IDs in execution order.
func (p CheckPlan) RequiredCheckIDs() []string {
	out := make([]string, 0, len(p.Checks))
	for _, check := range p.Checks {
		if check.Required {
			out = append(out, check.ID)
		}
	}
	return out
}

// Planner creates deterministic check plans from workload metadata and recovery
// objectives.
type Planner struct {
	catalog *Catalog
}

// NewPlanner constructs a Planner. A nil catalog uses the built-in catalog.
func NewPlanner(catalog *Catalog) *Planner {
	if catalog == nil {
		catalog = DefaultCatalog()
	}
	return &Planner{catalog: catalog}
}

// PlanChecks plans checks against the built-in catalog.
func PlanChecks(workload WorkloadMetadata, objectives RecoveryObjectives) (CheckPlan, error) {
	return NewPlanner(nil).Plan(workload, objectives)
}

// Plan turns workload metadata and objectives into a deterministic ordered
// check plan. Unknown workload kinds fall back to the generic_http profile.
func (p *Planner) Plan(workload WorkloadMetadata, objectives RecoveryObjectives) (CheckPlan, error) {
	catalog := p.catalog
	if catalog == nil {
		catalog = DefaultCatalog()
	}

	requestedKind := workload.Kind
	profileKind := requestedKind
	profile, ok := catalog.Profile(profileKind)
	if !ok {
		profileKind = WorkloadGenericHTTP
		profile, ok = catalog.Profile(profileKind)
		if !ok {
			return CheckPlan{}, ErrMissingFallbackProfile
		}
	}

	includeIDs := stringSet(objectives.IncludeCheckIDs)
	requireIDs := stringSet(objectives.RequireCheckIDs)
	for id := range requireIDs {
		includeIDs[id] = struct{}{}
	}
	if err := validateObjectiveCheckIDs(profile, includeIDs, requireIDs); err != nil {
		return CheckPlan{}, err
	}

	params := planParameters(workload, objectives)
	plan := CheckPlan{
		WorkloadID:    workload.ID,
		WorkloadName:  workload.Name,
		RequestedKind: requestedKind,
		ProfileKind:   profileKind,
		Objectives:    cloneObjectives(objectives),
		Parameters:    cloneStringMap(params),
		Checks:        make([]PlannedCheck, 0, len(profile.Checks)),
	}

	for _, check := range profile.Checks {
		_, includeByID := includeIDs[check.ID]
		required := check.Required
		if _, forced := requireIDs[check.ID]; forced {
			required = true
		}
		if !required && !objectives.IncludeOptionalChecks && !includeByID {
			continue
		}

		planned := PlannedCheck{
			Sequence:          len(plan.Checks) + 1,
			VerificationCheck: cloneCheck(check),
			Parameters:        cloneStringMap(params),
		}
		planned.Required = required
		plan.Checks = append(plan.Checks, planned)
	}

	return plan, nil
}

func validateObjectiveCheckIDs(profile VerificationProfile, includeIDs, requireIDs map[string]struct{}) error {
	known := make(map[string]struct{}, len(profile.Checks))
	for _, check := range profile.Checks {
		known[check.ID] = struct{}{}
	}
	for id := range includeIDs {
		if _, ok := known[id]; !ok {
			return fmt.Errorf("%w %q for profile %s", ErrUnknownCheck, id, profile.WorkloadKind)
		}
	}
	for id := range requireIDs {
		if _, ok := known[id]; !ok {
			return fmt.Errorf("%w %q for profile %s", ErrUnknownCheck, id, profile.WorkloadKind)
		}
	}
	return nil
}

func planParameters(workload WorkloadMetadata, objectives RecoveryObjectives) map[string]string {
	params := cloneStringMap(workload.Attributes)
	if params == nil {
		params = make(map[string]string)
	}
	if workload.Database != "" {
		params["database"] = workload.Database
	}
	if workload.Namespace != "" {
		params["namespace"] = workload.Namespace
	}
	if workload.Domain != "" {
		params["domain"] = workload.Domain
	}
	if workload.RecoveryPointID != "" {
		params["recovery_point_id"] = workload.RecoveryPointID
	}
	if objectives.RTOSeconds > 0 {
		params["rto_seconds"] = strconv.Itoa(objectives.RTOSeconds)
	}
	if objectives.RPOSeconds > 0 {
		params["rpo_seconds"] = strconv.Itoa(objectives.RPOSeconds)
	}
	if objectives.MaxLagSeconds > 0 {
		params["max_lag_seconds"] = strconv.Itoa(objectives.MaxLagSeconds)
	}
	if endpoint, ok := primaryEndpoint(workload.Endpoints); ok {
		if endpoint.Address != "" {
			params["endpoint.address"] = endpoint.Address
		}
		if endpoint.URL != "" {
			params["endpoint.url"] = endpoint.URL
		}
		if endpoint.Name != "" {
			params["endpoint.name"] = endpoint.Name
		}
		if endpoint.Type != "" {
			params["endpoint.type"] = endpoint.Type
		}
	}
	return params
}

func primaryEndpoint(endpoints []WorkloadEndpoint) (WorkloadEndpoint, bool) {
	if len(endpoints) == 0 {
		return WorkloadEndpoint{}, false
	}
	candidates := append([]WorkloadEndpoint(nil), endpoints...)
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Name != candidates[j].Name {
			return candidates[i].Name < candidates[j].Name
		}
		if candidates[i].Type != candidates[j].Type {
			return candidates[i].Type < candidates[j].Type
		}
		if candidates[i].Address != candidates[j].Address {
			return candidates[i].Address < candidates[j].Address
		}
		return candidates[i].URL < candidates[j].URL
	})
	return candidates[0], true
}

func stringSet(values []string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		out[value] = struct{}{}
	}
	return out
}

func cloneObjectives(objectives RecoveryObjectives) RecoveryObjectives {
	out := objectives
	out.IncludeCheckIDs = append([]string(nil), objectives.IncludeCheckIDs...)
	out.RequireCheckIDs = append([]string(nil), objectives.RequireCheckIDs...)
	sort.Strings(out.IncludeCheckIDs)
	sort.Strings(out.RequireCheckIDs)
	return out
}

func cloneStringMap(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}
