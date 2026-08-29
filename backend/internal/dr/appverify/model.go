// Package appverify models application-aware recovery verification checks for
// ClarioDR. A profile names the checks that prove a recovered workload is not
// merely booted, but usable at the application layer: it accepts connections,
// exposes expected state, satisfies consistency markers, and can run a bounded
// smoke operation.
//
// The package is intentionally self-contained: it owns the catalog, planner,
// executor, and result model, while callers decide where results are persisted
// and which command/probe runners are allowed in their recovery environment.
package appverify

import (
	"fmt"
	"sort"
	"time"
)

// WorkloadKind is the stable classifier used to select an application-aware
// verification profile.
type WorkloadKind string

const (
	WorkloadPostgres        WorkloadKind = "postgres"
	WorkloadMySQL           WorkloadKind = "mysql"
	WorkloadMSSQL           WorkloadKind = "mssql"
	WorkloadOracle          WorkloadKind = "oracle"
	WorkloadMongoDB         WorkloadKind = "mongodb"
	WorkloadKafka           WorkloadKind = "kafka"
	WorkloadElasticsearch   WorkloadKind = "elasticsearch"
	WorkloadRedis           WorkloadKind = "redis"
	WorkloadActiveDirectory WorkloadKind = "active_directory"
	WorkloadKubernetes      WorkloadKind = "kubernetes"
	WorkloadGenericHTTP     WorkloadKind = "generic_http"
)

// WorkloadKinds returns the known workload kinds in deterministic order.
func WorkloadKinds() []WorkloadKind {
	return []WorkloadKind{
		WorkloadActiveDirectory,
		WorkloadElasticsearch,
		WorkloadGenericHTTP,
		WorkloadKafka,
		WorkloadKubernetes,
		WorkloadMongoDB,
		WorkloadMSSQL,
		WorkloadMySQL,
		WorkloadOracle,
		WorkloadPostgres,
		WorkloadRedis,
	}
}

// KnownWorkloadKind reports whether kind has a built-in semantic meaning.
func KnownWorkloadKind(kind WorkloadKind) bool {
	switch kind {
	case WorkloadPostgres, WorkloadMySQL, WorkloadMSSQL, WorkloadOracle,
		WorkloadMongoDB, WorkloadKafka, WorkloadElasticsearch, WorkloadRedis,
		WorkloadActiveDirectory, WorkloadKubernetes, WorkloadGenericHTTP:
		return true
	default:
		return false
	}
}

// CheckKind describes how an executor should interpret a verification check.
type CheckKind string

const (
	CheckSQLQuery      CheckKind = "sql_query"
	CheckNoSQLCommand  CheckKind = "nosql_command"
	CheckCLICommand    CheckKind = "cli_command"
	CheckHTTPProbe     CheckKind = "http_probe"
	CheckTCPProbe      CheckKind = "tcp_probe"
	CheckLDAPQuery     CheckKind = "ldap_query"
	CheckKubernetesAPI CheckKind = "kubernetes_api"
)

func knownCheckKind(kind CheckKind) bool {
	switch kind {
	case CheckSQLQuery, CheckNoSQLCommand, CheckCLICommand, CheckHTTPProbe,
		CheckTCPProbe, CheckLDAPQuery, CheckKubernetesAPI:
		return true
	default:
		return false
	}
}

// ProbeProtocol is the transport used by a probe check.
type ProbeProtocol string

const (
	ProbeHTTP ProbeProtocol = "http"
	ProbeTCP  ProbeProtocol = "tcp"
)

func knownProbeProtocol(protocol ProbeProtocol) bool {
	return protocol == ProbeHTTP || protocol == ProbeTCP
}

// CommandSpec describes the command/query metadata needed to execute a check.
// Placeholders such as {endpoint.address}, {database}, {namespace},
// {recovery_point_id}, and {max_lag_seconds} are intentionally left unresolved
// by this package and are supplied as plan parameters.
type CommandSpec struct {
	Tool                   string   `json:"tool"`
	Args                   []string `json:"args,omitempty"`
	Query                  string   `json:"query,omitempty"`
	ExpectedOutputContains string   `json:"expected_output_contains,omitempty"`
}

// ProbeSpec describes an HTTP or TCP probe.
type ProbeSpec struct {
	Protocol             ProbeProtocol `json:"protocol"`
	Target               string        `json:"target"`
	Method               string        `json:"method,omitempty"`
	Path                 string        `json:"path,omitempty"`
	ExpectedStatus       []int         `json:"expected_status,omitempty"`
	ExpectedBodyContains string        `json:"expected_body_contains,omitempty"`
}

// VerificationCheck is one catalog check. Required checks are always planned;
// optional checks are planned when the caller requests all optional checks or
// names them in RecoveryObjectives.
type VerificationCheck struct {
	ID             string       `json:"id"`
	Name           string       `json:"name"`
	Description    string       `json:"description,omitempty"`
	Kind           CheckKind    `json:"kind"`
	Required       bool         `json:"required"`
	TimeoutSeconds int          `json:"timeout_seconds"`
	Command        *CommandSpec `json:"command,omitempty"`
	Probe          *ProbeSpec   `json:"probe,omitempty"`
	Tags           []string     `json:"tags,omitempty"`
}

// CheckStatus is the terminal execution state of one planned verification
// check.
type CheckStatus string

const (
	CheckStatusPassed  CheckStatus = "passed"
	CheckStatusFailed  CheckStatus = "failed"
	CheckStatusError   CheckStatus = "error"
	CheckStatusSkipped CheckStatus = "skipped"
)

// CheckResult is the durable outcome of one PlannedCheck execution.
type CheckResult struct {
	Sequence    int         `json:"sequence"`
	CheckID     string      `json:"check_id"`
	Name        string      `json:"name"`
	Kind        CheckKind   `json:"kind"`
	Required    bool        `json:"required"`
	Status      CheckStatus `json:"status"`
	Passed      bool        `json:"passed"`
	StartedAt   time.Time   `json:"started_at"`
	FinishedAt  time.Time   `json:"finished_at"`
	DurationMS  int64       `json:"duration_ms"`
	Detail      string      `json:"detail,omitempty"`
	Error       string      `json:"error,omitempty"`
	EvidenceRef string      `json:"evidence_ref,omitempty"`
}

// Result is the application-aware verification outcome for one recovered
// workload. Passed is true only when every planned check passed.
type Result struct {
	WorkloadID     string        `json:"workload_id,omitempty"`
	WorkloadName   string        `json:"workload_name,omitempty"`
	RequestedKind  WorkloadKind  `json:"requested_kind"`
	ProfileKind    WorkloadKind  `json:"profile_kind"`
	Passed         bool          `json:"passed"`
	ChecksTotal    int           `json:"checks_total"`
	ChecksPassed   int           `json:"checks_passed"`
	RequiredTotal  int           `json:"required_total"`
	RequiredPassed int           `json:"required_passed"`
	FailedChecks   []string      `json:"failed_checks,omitempty"`
	StartedAt      time.Time     `json:"started_at"`
	FinishedAt     time.Time     `json:"finished_at"`
	DurationMS     int64         `json:"duration_ms"`
	Results        []CheckResult `json:"results"`
}

// VerificationProfile is the ordered default check set for a workload kind.
type VerificationProfile struct {
	WorkloadKind WorkloadKind        `json:"workload_kind"`
	Name         string              `json:"name"`
	Checks       []VerificationCheck `json:"checks"`
}

// Check returns a check by ID.
func (p VerificationProfile) Check(id string) (VerificationCheck, bool) {
	for _, check := range p.Checks {
		if check.ID == id {
			return cloneCheck(check), true
		}
	}
	return VerificationCheck{}, false
}

// RequiredCheckIDs returns required check IDs in profile order.
func (p VerificationProfile) RequiredCheckIDs() []string {
	out := make([]string, 0, len(p.Checks))
	for _, check := range p.Checks {
		if check.Required {
			out = append(out, check.ID)
		}
	}
	return out
}

// Validate checks a profile for deterministic, executable catalog metadata.
func (p VerificationProfile) Validate() error {
	if !KnownWorkloadKind(p.WorkloadKind) {
		return fmt.Errorf("profile has unknown workload kind %q", p.WorkloadKind)
	}
	if p.Name == "" {
		return fmt.Errorf("profile %s: name is empty", p.WorkloadKind)
	}
	if len(p.Checks) == 0 {
		return fmt.Errorf("profile %s: has no checks", p.WorkloadKind)
	}
	seen := make(map[string]struct{}, len(p.Checks))
	required := 0
	for _, check := range p.Checks {
		if err := validateCheck(p.WorkloadKind, check); err != nil {
			return err
		}
		if _, dup := seen[check.ID]; dup {
			return fmt.Errorf("profile %s: duplicate check id %q", p.WorkloadKind, check.ID)
		}
		seen[check.ID] = struct{}{}
		if check.Required {
			required++
		}
	}
	if required == 0 {
		return fmt.Errorf("profile %s: has no required checks", p.WorkloadKind)
	}
	return nil
}

func validateCheck(profileKind WorkloadKind, check VerificationCheck) error {
	if check.ID == "" {
		return fmt.Errorf("profile %s: check id is empty", profileKind)
	}
	if check.Name == "" {
		return fmt.Errorf("profile %s check %s: name is empty", profileKind, check.ID)
	}
	if !knownCheckKind(check.Kind) {
		return fmt.Errorf("profile %s check %s: unknown check kind %q", profileKind, check.ID, check.Kind)
	}
	if check.TimeoutSeconds <= 0 {
		return fmt.Errorf("profile %s check %s: timeout must be positive", profileKind, check.ID)
	}
	switch check.Kind {
	case CheckHTTPProbe:
		if check.Probe == nil {
			return fmt.Errorf("profile %s check %s: http probe metadata is required", profileKind, check.ID)
		}
		if check.Probe.Protocol != ProbeHTTP {
			return fmt.Errorf("profile %s check %s: http probe has protocol %q", profileKind, check.ID, check.Probe.Protocol)
		}
		if check.Probe.Target == "" {
			return fmt.Errorf("profile %s check %s: probe target is empty", profileKind, check.ID)
		}
		if len(check.Probe.ExpectedStatus) == 0 {
			return fmt.Errorf("profile %s check %s: expected HTTP status is empty", profileKind, check.ID)
		}
	case CheckTCPProbe:
		if check.Probe == nil {
			return fmt.Errorf("profile %s check %s: tcp probe metadata is required", profileKind, check.ID)
		}
		if check.Probe.Protocol != ProbeTCP {
			return fmt.Errorf("profile %s check %s: tcp probe has protocol %q", profileKind, check.ID, check.Probe.Protocol)
		}
		if check.Probe.Target == "" {
			return fmt.Errorf("profile %s check %s: probe target is empty", profileKind, check.ID)
		}
	default:
		if check.Command == nil {
			return fmt.Errorf("profile %s check %s: command metadata is required", profileKind, check.ID)
		}
		if check.Command.Tool == "" {
			return fmt.Errorf("profile %s check %s: command tool is empty", profileKind, check.ID)
		}
		if len(check.Command.Args) == 0 && check.Command.Query == "" {
			return fmt.Errorf("profile %s check %s: command args or query are required", profileKind, check.ID)
		}
	}
	return nil
}

func cloneProfile(profile VerificationProfile) VerificationProfile {
	out := profile
	out.Checks = make([]VerificationCheck, len(profile.Checks))
	for i, check := range profile.Checks {
		out.Checks[i] = cloneCheck(check)
	}
	return out
}

func cloneCheck(check VerificationCheck) VerificationCheck {
	out := check
	out.Tags = append([]string(nil), check.Tags...)
	sort.Strings(out.Tags)
	if check.Command != nil {
		cmd := *check.Command
		cmd.Args = append([]string(nil), check.Command.Args...)
		out.Command = &cmd
	}
	if check.Probe != nil {
		probe := *check.Probe
		probe.ExpectedStatus = append([]int(nil), check.Probe.ExpectedStatus...)
		out.Probe = &probe
	}
	return out
}
