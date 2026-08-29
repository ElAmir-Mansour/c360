// Package bootgraph implements ClarioDR capability #13 — DEPENDENCY-AWARE BOOT
// ORCHESTRATION (DESIGN_DataStream_DR.md §6.3 recovery executor, §11 SLO
// metrics). The §6.3 recovery executor boots a consistency group in a FLAT
// boot_order; the registry runbook records the same flat member ordering. This
// package generalises that flat order to the APPLICATION-SERVICE DEPENDENCY
// GRAPH for recovery: a recoverable service (database, cache, API, worker, web,
// load-balancer) declares which other services it depends_on, and the planner
// levelises the graph into BOOT TIERS — services in the same tier have all their
// dependencies satisfied by earlier tiers, so they boot IN PARALLEL, while tiers
// boot strictly in order with a HEALTH-GATE barrier between them.
//
// Distinction from the sibling DR packages (the prompt is explicit about this):
//
//   - internal/dr/topology is the replication-SITE graph (which sites replicate
//     to which); its vertices are sites and its edges are replication links.
//   - internal/dr/registry boot_order is a FLAT member ordering of a group.
//   - internal/dr/failover is the gated failover FSM that, at Gate 3, boots the
//     group; it has no service-dependency model and no health probe.
//   - THIS package is the application-service dependency DAG: its vertices are
//     SERVICES with a health-check spec, its edges are depends_on relations, and
//     it owns a real planner (Kahn longest-path levelisation, cycle rejection)
//     and a BootOrchestrator that executes tier-by-tier with REAL HTTP/TCP/script
//     health probes gating each barrier.
//
// Disjoint ownership: this package defines its OWN model types, its OWN store
// over repository.DBTX (raw queries; it does NOT edit the shared repository),
// its OWN chi.Router, its OWN planner and orchestrator, and its OWN migration
// pair (000018). It reuses the repository.DBTX execution-context pattern, the
// platform transaction helpers, and internal/events + outbox for lifecycle
// events on the existing datastream.dr.events topic.
package bootgraph

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the router.
var (
	// ErrGroupNotFound is returned when the consistency group is absent.
	ErrGroupNotFound = errors.New("consistency group not found")
	// ErrServiceNotFound is returned when a boot service is absent.
	ErrServiceNotFound = errors.New("boot service not found")
	// ErrRunNotFound is returned when a boot run is absent.
	ErrRunNotFound = errors.New("boot run not found")
	// ErrCycle is returned by the planner when the dependency graph contains a
	// cycle (a service transitively depends on itself), so no boot order exists.
	// The router maps it to HTTP 409.
	ErrCycle = errors.New("boot dependency graph contains a cycle")
	// ErrSelfDependency is returned when a service is declared to depend on itself.
	ErrSelfDependency = errors.New("a service cannot depend on itself")
	// ErrUnknownDependency is returned when a depends_on names a service not in the
	// group's service set.
	ErrUnknownDependency = errors.New("dependency references an unknown service")
	// ErrDuplicateService is returned when two services share the same name in a group.
	ErrDuplicateService = errors.New("duplicate service name in group")
	// ErrInvalidProbe is returned when a service's health-check spec is invalid.
	ErrInvalidProbe = errors.New("invalid health-check spec")
	// ErrInvalidPolicy is returned when a run's failure policy is unrecognised.
	ErrInvalidPolicy = errors.New("invalid failure policy")
	// ErrNoServices is returned when a boot run is requested for a group with no
	// defined services.
	ErrNoServices = errors.New("group has no boot services defined")
)

// ProbeKind enumerates the supported health-check probe kinds. Each maps to a
// concrete HealthChecker implementation in probe.go.
const (
	// ProbeHTTP performs an HTTP(S) GET and checks the status code is in the
	// expected range (real net/http, context-bounded).
	ProbeHTTP = "http"
	// ProbeTCP dials a TCP address and checks the connection establishes (real
	// net.DialTimeout, context-bounded).
	ProbeTCP = "tcp"
	// ProbeScript runs a local command and checks its exit code is zero
	// (real os/exec, context-bounded).
	ProbeScript = "script"
)

// ValidProbeKind reports whether k is a recognised probe kind.
func ValidProbeKind(k string) bool {
	return k == ProbeHTTP || k == ProbeTCP || k == ProbeScript
}

// Failure policy for a boot run when a tier never goes healthy within its
// budget.
const (
	// PolicyHalt stops the run and leaves already-booted tiers running (the
	// operator decides next). The run ends FAILED.
	PolicyHalt = "halt"
	// PolicyRollback tears down already-booted tiers in REVERSE order (last
	// healthy tier first) before ending the run ROLLED_BACK.
	PolicyRollback = "rollback"
)

// ValidPolicy reports whether p is a recognised failure policy.
func ValidPolicy(p string) bool {
	return p == PolicyHalt || p == PolicyRollback
}

// Run statuses (the orchestrator's durable lifecycle).
const (
	// RunStatusPending is a created-but-not-yet-started run.
	RunStatusPending = "pending"
	// RunStatusRunning is a run actively booting tiers.
	RunStatusRunning = "running"
	// RunStatusCompleted is a run where every tier went healthy.
	RunStatusCompleted = "completed"
	// RunStatusFailed is a run halted on a tier failure (PolicyHalt) or an error.
	RunStatusFailed = "failed"
	// RunStatusRolledBack is a run that tore down booted tiers after a tier failure
	// (PolicyRollback).
	RunStatusRolledBack = "rolled_back"
)

// Per-service status within a run.
const (
	// SvcPending is a service not yet started.
	SvcPending = "pending"
	// SvcBooting is a service whose boot was issued; the probe has not yet gone green.
	SvcBooting = "booting"
	// SvcHealthy is a service whose health probe passed.
	SvcHealthy = "healthy"
	// SvcUnhealthy is a service whose health probe never passed within its budget.
	SvcUnhealthy = "unhealthy"
	// SvcRolledBack is a service torn down during rollback.
	SvcRolledBack = "rolled_back"
)

// Service is one recoverable application service — a vertex of the dependency
// DAG. It carries the health-check spec the orchestrator probes after issuing
// the service's boot. The same name is unique within a group.
type Service struct {
	ID       string `json:"id"`
	TenantID string `json:"tenant_id"`
	GroupID  string `json:"group_id"`
	// Name is the unique service identifier within the group (e.g. "database",
	// "api"). depends_on edges reference services by name.
	Name string `json:"name"`
	// Kind is a free-form classifier (database|cache|api|worker|web|lb|...),
	// advisory only — the planner orders strictly by declared dependencies.
	Kind string `json:"kind"`
	// BootAction is how the orchestrator ISSUES this service's boot. It is
	// dispatched by the injected Booter by scheme: "cmd:<argv>" runs a local
	// provisioner command, "http(s)://..." POSTs the service context to a recovery
	// webhook. EMPTY means the boot is performed out-of-band (the orchestrator is a
	// pure dependency-ordered health barrier — the NoopBooter behaviour), so it is
	// optional and backward compatible.
	BootAction string `json:"boot_action"`
	// SiteID is an OPTIONAL explicit link to the recovery_target site this boot
	// service represents (the protected_site id). When every recovery target of a
	// group is linked, the §6.3 recovery executor boots in this DAG's dependency
	// tiers (with a health-gate barrier) instead of the flat recovery_target
	// boot_order. Empty means unlinked — the executor then falls back to the flat
	// order, so this is optional and backward compatible.
	SiteID string `json:"site_id,omitempty"`
	// ProbeKind is the health-check probe kind (http|tcp|script).
	ProbeKind string `json:"probe_kind"`
	// ProbeTarget is the probe argument: an HTTP URL, a host:port for TCP, or a
	// command line for script.
	ProbeTarget string `json:"probe_target"`
	// ProbeExpectStatus is the HTTP status (for ProbeHTTP) considered healthy.
	// 0 means "any 2xx".
	ProbeExpectStatus int `json:"probe_expect_status"`
	// BootTimeoutSeconds bounds how long a single boot+health attempt may take.
	BootTimeoutSeconds int `json:"boot_timeout_seconds"`
	// HealthRetries is how many additional probe attempts to make after the first
	// before declaring the service unhealthy.
	HealthRetries int       `json:"health_retries"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// bootTimeout returns the per-attempt boot/health timeout, defaulting to 30s
// when unset.
func (s Service) bootTimeout() time.Duration {
	if s.BootTimeoutSeconds <= 0 {
		return 30 * time.Second
	}
	return time.Duration(s.BootTimeoutSeconds) * time.Second
}

// retries returns the non-negative retry count.
func (s Service) retries() int {
	if s.HealthRetries < 0 {
		return 0
	}
	return s.HealthRetries
}

// Dependency is a directed depends_on edge: ServiceID depends on DependsOnID, so
// DependsOnID must be healthy in an earlier tier before ServiceID may boot.
type Dependency struct {
	ID          string `json:"id"`
	TenantID    string `json:"tenant_id"`
	GroupID     string `json:"group_id"`
	ServiceID   string `json:"service_id"`
	DependsOnID string `json:"depends_on_id"`
}

// BootPlan is the computed boot plan: the ordered list of tiers, where Tiers[0]
// boots first and every service in a tier may boot in parallel.
type BootPlan struct {
	GroupID string      `json:"group_id"`
	Tiers   [][]Service `json:"tiers"`
}

// ServiceNames returns the tier structure as service names (test/diagnostic
// convenience; preserves tier and intra-tier ordering).
func (p BootPlan) ServiceNames() [][]string {
	out := make([][]string, len(p.Tiers))
	for i, tier := range p.Tiers {
		names := make([]string, len(tier))
		for j, s := range tier {
			names[j] = s.Name
		}
		out[i] = names
	}
	return out
}

// BootRun is a durable execution of a group's boot plan.
type BootRun struct {
	ID          string     `json:"id"`
	TenantID    string     `json:"tenant_id"`
	GroupID     string     `json:"group_id"`
	Status      string     `json:"status"`
	Policy      string     `json:"policy"`
	TotalTiers  int        `json:"total_tiers"`
	TiersBooted int        `json:"tiers_booted"`
	InitiatedBy *string    `json:"initiated_by,omitempty"`
	LastError   *string    `json:"last_error,omitempty"`
	StartedAt   time.Time  `json:"started_at"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
}

// IsTerminal reports whether the run is in a terminal status.
func (r BootRun) IsTerminal() bool {
	return r.Status == RunStatusCompleted ||
		r.Status == RunStatusFailed ||
		r.Status == RunStatusRolledBack
}

// BootServiceStatus is the per-service status row for a run.
type BootServiceStatus struct {
	ID          string     `json:"id"`
	RunID       string     `json:"run_id"`
	ServiceID   string     `json:"service_id"`
	ServiceName string     `json:"service_name"`
	Tier        int        `json:"tier"`
	Status      string     `json:"status"`
	Attempts    int        `json:"attempts"`
	LastError   *string    `json:"last_error,omitempty"`
	BootedAt    *time.Time `json:"booted_at,omitempty"`
	HealthyAt   *time.Time `json:"healthy_at,omitempty"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// RunDetail is the full GET /boot-runs/{id} payload: the run plus its per-service
// statuses.
type RunDetail struct {
	Run      BootRun             `json:"run"`
	Services []BootServiceStatus `json:"services"`
}
