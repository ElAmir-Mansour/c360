package cybervault

import (
	"sort"
	"strings"
	"time"
)

// SyncOperation is an operational action that can be planned for a controlled
// cyber-vault sync window.
type SyncOperation string

const (
	// SyncOperationBackupCopy copies a protected recovery point into the vault.
	SyncOperationBackupCopy SyncOperation = "backup_copy"
	// SyncOperationReplicaCopy copies a vault recovery point to a replica target.
	SyncOperationReplicaCopy SyncOperation = "replica_copy"
	// SyncOperationRestoreDrill restores from a protected point into a drill
	// environment without changing production.
	SyncOperationRestoreDrill SyncOperation = "restore_drill"
	// SyncOperationRetentionExtend extends the immutable retention period.
	SyncOperationRetentionExtend SyncOperation = "retention_extend"
	// SyncOperationRetentionShorten attempts to reduce the retention period.
	SyncOperationRetentionShorten SyncOperation = "retention_shorten"
	// SyncOperationDeleteRecoveryPoint deletes a protected recovery point.
	SyncOperationDeleteRecoveryPoint SyncOperation = "delete_recovery_point"
	// SyncOperationDeleteReplica removes a replica copy from a target.
	SyncOperationDeleteReplica SyncOperation = "delete_replica"
	// SyncOperationDisableRetentionLock disables or bypasses retention lock.
	SyncOperationDisableRetentionLock SyncOperation = "disable_retention_lock"
)

// SyncVerdict is the policy decision for a requested sync plan.
type SyncVerdict string

const (
	// SyncVerdictAllowed means the request can proceed inside the current window.
	SyncVerdictAllowed SyncVerdict = "allowed"
	// SyncVerdictBlocked means at least one enforceable control blocks the plan.
	SyncVerdictBlocked SyncVerdict = "blocked"
)

// SyncWindow is the scheduled operational window and its approval policy.
type SyncWindow struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name,omitempty"`

	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`

	AllowedOperations []SyncOperation `json:"allowed_operations,omitempty"`

	// RequireApproval applies to all requested operations.
	RequireApproval bool `json:"require_approval"`
	// RequiredApprovers defaults to one when RequireApproval is true.
	RequiredApprovers int `json:"required_approvers,omitempty"`
	// RequiredDestructiveApprovers defaults to two for destructive operations.
	RequiredDestructiveApprovers int `json:"required_destructive_approvers,omitempty"`
}

// SyncApproval records an external approval workflow result. The planner only
// reasons over the evidence; it does not call an approval system.
type SyncApproval struct {
	Approved      bool   `json:"approved"`
	ApproverCount int    `json:"approver_count"`
	Reference     string `json:"reference,omitempty"`
}

// SyncReplicaTarget is a destination that will receive vault copies.
type SyncReplicaTarget struct {
	ID        string `json:"id,omitempty"`
	AccountID string `json:"account_id,omitempty"`
	Region    string `json:"region,omitempty"`

	Immutable            bool `json:"immutable"`
	RetentionLockEnabled bool `json:"retention_lock_enabled"`
	RetentionDays        int  `json:"retention_days,omitempty"`
}

// SyncRequest is the operator's requested plan context.
type SyncRequest struct {
	ID      string `json:"id,omitempty"`
	VaultID string `json:"vault_id,omitempty"`

	RequestedBy            string `json:"requested_by,omitempty"`
	RequestedBySourceAdmin bool   `json:"requested_by_source_admin"`

	SourceAccountID string `json:"source_account_id,omitempty"`
	SourceRegion    string `json:"source_region,omitempty"`

	Operations     []SyncOperation     `json:"operations,omitempty"`
	ReplicaTargets []SyncReplicaTarget `json:"replica_targets,omitempty"`

	RetentionLockEnabled   bool `json:"retention_lock_enabled"`
	CurrentRetentionDays   int  `json:"current_retention_days,omitempty"`
	RequestedRetentionDays int  `json:"requested_retention_days,omitempty"`

	RecoveryPointID        string `json:"recovery_point_id,omitempty"`
	RecoveryPointImmutable bool   `json:"recovery_point_immutable"`

	Approval            SyncApproval `json:"approval,omitempty"`
	DestructiveApproval SyncApproval `json:"destructive_approval,omitempty"`
}

// SyncFinding is one deterministic policy finding on a planned request.
type SyncFinding struct {
	Code        string          `json:"code"`
	Title       string          `json:"title"`
	Verdict     SyncVerdict     `json:"verdict"`
	Severity    FindingSeverity `json:"severity"`
	Message     string          `json:"message"`
	Remediation string          `json:"remediation"`
}

// SyncDecision is the enforceable outcome for a sync plan.
type SyncDecision struct {
	Verdict  SyncVerdict   `json:"verdict"`
	Allowed  bool          `json:"allowed"`
	Findings []SyncFinding `json:"findings,omitempty"`
}

// SyncPlan is a deterministic, side-effect-free operational plan. It describes
// what would be run and the policy decision; it does not perform cloud API work.
type SyncPlan struct {
	RequestID string `json:"request_id,omitempty"`
	VaultID   string `json:"vault_id,omitempty"`
	WindowID  string `json:"window_id,omitempty"`

	PlannedAt time.Time `json:"planned_at"`

	Operations             []SyncOperation     `json:"operations,omitempty"`
	ReplicaTargets         []SyncReplicaTarget `json:"replica_targets,omitempty"`
	RetentionLockEnabled   bool                `json:"retention_lock_enabled"`
	CurrentRetentionDays   int                 `json:"current_retention_days,omitempty"`
	RequestedRetentionDays int                 `json:"requested_retention_days,omitempty"`

	Decision SyncDecision `json:"decision"`
}

// SyncPlanner plans controlled cyber-vault sync windows with an injected clock
// so time-window checks remain deterministic in tests.
type SyncPlanner struct {
	now func() time.Time
}

// NewSyncPlanner constructs a SyncPlanner. A nil clock defaults to time.Now.
func NewSyncPlanner(clock func() time.Time) *SyncPlanner {
	if clock == nil {
		clock = time.Now
	}
	return &SyncPlanner{now: clock}
}

// PlanSync plans a request at now. If now is zero, time.Now is used.
func PlanSync(window SyncWindow, request SyncRequest, now time.Time) SyncPlan {
	if now.IsZero() {
		now = time.Now()
	}
	return planSync(window, request, now)
}

// Plan evaluates a request with the planner's clock.
func (p *SyncPlanner) Plan(window SyncWindow, request SyncRequest) SyncPlan {
	return planSync(window, request, p.now())
}

func planSync(window SyncWindow, request SyncRequest, now time.Time) SyncPlan {
	operations := normaliseSyncOperations(request.Operations)
	targets := normaliseSyncTargets(request.ReplicaTargets)
	findings := make([]SyncFinding, 0)

	if !syncWindowOpen(window, now) {
		findings = append(findings, syncFinding(
			"CV-SYNC-WINDOW",
			"sync window open",
			"requested operation is outside the approved cyber-vault sync window",
			"schedule the operation inside an active window with a valid start and end time",
		))
	}

	unknownOps, disallowedOps := syncOperationFindings(window, operations)
	if len(unknownOps) > 0 {
		findings = append(findings, syncFinding(
			"CV-SYNC-UNKNOWN-OPERATION",
			"known sync operation",
			"request includes unsupported operation(s): "+strings.Join(syncOperationStrings(unknownOps), ", "),
			"request only supported cyber-vault sync operations",
		))
	}
	if len(disallowedOps) > 0 {
		findings = append(findings, syncFinding(
			"CV-SYNC-ALLOWED-OPERATION",
			"operation allowed in window",
			"window does not allow operation(s): "+strings.Join(syncOperationStrings(disallowedOps), ", "),
			"open a window that explicitly allows every requested operation",
		))
	}
	if len(operations) == 0 {
		findings = append(findings, syncFinding(
			"CV-SYNC-OPERATION-REQUIRED",
			"sync operation requested",
			"request does not include any sync operation",
			"include at least one supported operation in the sync request",
		))
	}

	if window.RequireApproval && !syncApprovalSatisfied(request.Approval, requiredApprovers(window.RequiredApprovers, 1)) {
		findings = append(findings, syncFinding(
			"CV-SYNC-APPROVAL",
			"window approval",
			"sync window requires approval before operations can proceed",
			"attach an approved workflow reference with the required number of approvers",
		))
	}

	hasDestructive := hasDestructiveSyncOperation(operations)
	if hasDestructive && !syncApprovalSatisfied(request.DestructiveApproval, requiredApprovers(window.RequiredDestructiveApprovers, 2)) {
		findings = append(findings, syncFinding(
			"CV-SYNC-DESTRUCTIVE-APPROVAL",
			"destructive approval",
			"destructive cyber-vault operation lacks required approval",
			"obtain destructive-operation approval from the required approvers before planning the action",
		))
	}
	if hasDestructive && request.RequestedBySourceAdmin {
		findings = append(findings, syncFinding(
			"CV-SYNC-SOURCE-ADMIN",
			"source admin denied",
			"source administrators cannot perform destructive cyber-vault operations",
			"use a vault-admin role that is isolated from source production administration",
		))
	}

	if hasCopySyncOperation(operations) && !request.RetentionLockEnabled {
		findings = append(findings, syncFinding(
			"CV-SYNC-RETENTION-LOCK",
			"retention lock enabled",
			"copy operations require retention lock on the destination vault",
			"enable immutable retention lock before copying recovery points into the cyber vault",
		))
	}
	if shortensRetention(request, operations) {
		findings = append(findings, syncFinding(
			"CV-SYNC-RETENTION-SHORTEN",
			"retention not shortened",
			"requested plan would shorten retention on locked cyber-vault points",
			"extend retention or keep the existing locked retention period",
		))
	}

	if hasCopySyncOperation(operations) {
		findings = append(findings, syncTargetFindings(request, targets)...)
	}

	if hasSyncOperation(operations, SyncOperationRestoreDrill) && !request.RecoveryPointImmutable {
		findings = append(findings, syncFinding(
			"CV-SYNC-RESTORE-IMMUTABLE",
			"immutable restore point",
			"restore drills may only run from immutable cyber-vault recovery points",
			"select an immutable recovery point before planning the restore drill",
		))
	}

	verdict := SyncVerdictAllowed
	if len(findings) > 0 {
		verdict = SyncVerdictBlocked
	}

	return SyncPlan{
		RequestID:              request.ID,
		VaultID:                request.VaultID,
		WindowID:               window.ID,
		PlannedAt:              now,
		Operations:             operations,
		ReplicaTargets:         targets,
		RetentionLockEnabled:   request.RetentionLockEnabled,
		CurrentRetentionDays:   request.CurrentRetentionDays,
		RequestedRetentionDays: request.RequestedRetentionDays,
		Decision: SyncDecision{
			Verdict:  verdict,
			Allowed:  verdict == SyncVerdictAllowed,
			Findings: findings,
		},
	}
}

func syncWindowOpen(window SyncWindow, now time.Time) bool {
	if window.StartsAt.IsZero() || window.EndsAt.IsZero() || window.EndsAt.Before(window.StartsAt) {
		return false
	}
	return !now.Before(window.StartsAt) && !now.After(window.EndsAt)
}

func syncOperationFindings(window SyncWindow, operations []SyncOperation) ([]SyncOperation, []SyncOperation) {
	allowed := make(map[SyncOperation]struct{}, len(window.AllowedOperations))
	for _, op := range normaliseSyncOperations(window.AllowedOperations) {
		allowed[op] = struct{}{}
	}

	unknown := make([]SyncOperation, 0)
	disallowed := make([]SyncOperation, 0)
	for _, op := range operations {
		if _, ok := knownSyncOperations[op]; !ok {
			unknown = append(unknown, op)
			continue
		}
		if _, ok := allowed[op]; !ok {
			disallowed = append(disallowed, op)
		}
	}
	return unknown, disallowed
}

func syncTargetFindings(request SyncRequest, targets []SyncReplicaTarget) []SyncFinding {
	findings := make([]SyncFinding, 0)
	if len(targets) == 0 {
		return append(findings, syncFinding(
			"CV-SYNC-REPLICA-TARGET",
			"replica target configured",
			"copy operations require at least one replica target",
			"configure an immutable cross-account, cross-region replica target",
		))
	}

	for _, target := range targets {
		targetName := syncTargetName(target)
		if missingOrSameSyncBoundary(request.SourceAccountID, target.AccountID) {
			findings = append(findings, syncFinding(
				"CV-SYNC-CROSS-ACCOUNT",
				"cross-account target",
				"replica target "+targetName+" is not isolated in a different account",
				"use a vault replica target in an account, subscription, or project separate from the source",
			))
		}
		if missingOrSameSyncBoundary(request.SourceRegion, target.Region) {
			findings = append(findings, syncFinding(
				"CV-SYNC-CROSS-REGION",
				"cross-region target",
				"replica target "+targetName+" is not in a different region",
				"use a vault replica target in a region separate from the source",
			))
		}
		if !target.Immutable || !target.RetentionLockEnabled {
			findings = append(findings, syncFinding(
				"CV-SYNC-TARGET-LOCK",
				"target immutable lock",
				"replica target "+targetName+" is not immutable with retention lock enabled",
				"enable immutable retention lock on every replica target",
			))
		}
		if target.RetentionDays > 0 && request.CurrentRetentionDays > 0 && target.RetentionDays < request.CurrentRetentionDays {
			findings = append(findings, syncFinding(
				"CV-SYNC-TARGET-RETENTION",
				"target retention not shortened",
				"replica target "+targetName+" has retention below the current locked period",
				"set target retention to at least the current locked retention period",
			))
		}
	}
	return findings
}

func shortensRetention(request SyncRequest, operations []SyncOperation) bool {
	if hasSyncOperation(operations, SyncOperationDisableRetentionLock) || hasSyncOperation(operations, SyncOperationRetentionShorten) {
		return true
	}
	if request.CurrentRetentionDays <= 0 || request.RequestedRetentionDays <= 0 {
		return false
	}
	return request.RequestedRetentionDays < request.CurrentRetentionDays
}

func hasCopySyncOperation(operations []SyncOperation) bool {
	return hasSyncOperation(operations, SyncOperationBackupCopy) || hasSyncOperation(operations, SyncOperationReplicaCopy)
}

func hasDestructiveSyncOperation(operations []SyncOperation) bool {
	for _, op := range operations {
		if _, ok := destructiveSyncOperations[op]; ok {
			return true
		}
	}
	return false
}

func hasSyncOperation(operations []SyncOperation, want SyncOperation) bool {
	for _, op := range operations {
		if op == want {
			return true
		}
	}
	return false
}

func syncApprovalSatisfied(approval SyncApproval, required int) bool {
	return approval.Approved && approval.ApproverCount >= required
}

func requiredApprovers(configured, fallback int) int {
	if configured > 0 {
		return configured
	}
	return fallback
}

func normaliseSyncOperations(in []SyncOperation) []SyncOperation {
	seen := make(map[SyncOperation]struct{}, len(in))
	out := make([]SyncOperation, 0, len(in))
	for _, op := range in {
		op = SyncOperation(strings.TrimSpace(string(op)))
		if op == "" {
			continue
		}
		if _, ok := seen[op]; ok {
			continue
		}
		seen[op] = struct{}{}
		out = append(out, op)
	}
	sort.Slice(out, func(i, j int) bool {
		left, leftKnown := syncOperationRank[out[i]]
		right, rightKnown := syncOperationRank[out[j]]
		switch {
		case leftKnown && rightKnown:
			return left < right
		case leftKnown:
			return true
		case rightKnown:
			return false
		default:
			return out[i] < out[j]
		}
	})
	return out
}

func syncOperationStrings(in []SyncOperation) []string {
	out := make([]string, len(in))
	for i, op := range in {
		out[i] = string(op)
	}
	return out
}

func normaliseSyncTargets(in []SyncReplicaTarget) []SyncReplicaTarget {
	out := append([]SyncReplicaTarget(nil), in...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].AccountID != out[j].AccountID {
			return out[i].AccountID < out[j].AccountID
		}
		if out[i].Region != out[j].Region {
			return out[i].Region < out[j].Region
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func missingOrSameSyncBoundary(left, right string) bool {
	left = strings.TrimSpace(strings.ToLower(left))
	right = strings.TrimSpace(strings.ToLower(right))
	return left == "" || right == "" || left == right
}

func syncTargetName(target SyncReplicaTarget) string {
	if target.ID != "" {
		return target.ID
	}
	if target.AccountID != "" || target.Region != "" {
		return strings.TrimSpace(target.AccountID + "/" + target.Region)
	}
	return "unnamed"
}

func syncFinding(code, title, message, remediation string) SyncFinding {
	return SyncFinding{
		Code:        code,
		Title:       title,
		Verdict:     SyncVerdictBlocked,
		Severity:    SeverityHigh,
		Message:     message,
		Remediation: remediation,
	}
}

var syncOperationRank = map[SyncOperation]int{
	SyncOperationBackupCopy:           0,
	SyncOperationReplicaCopy:          1,
	SyncOperationRestoreDrill:         2,
	SyncOperationRetentionExtend:      3,
	SyncOperationRetentionShorten:     4,
	SyncOperationDeleteRecoveryPoint:  5,
	SyncOperationDeleteReplica:        6,
	SyncOperationDisableRetentionLock: 7,
}

var knownSyncOperations = map[SyncOperation]struct{}{
	SyncOperationBackupCopy:           {},
	SyncOperationReplicaCopy:          {},
	SyncOperationRestoreDrill:         {},
	SyncOperationRetentionExtend:      {},
	SyncOperationRetentionShorten:     {},
	SyncOperationDeleteRecoveryPoint:  {},
	SyncOperationDeleteReplica:        {},
	SyncOperationDisableRetentionLock: {},
}

var destructiveSyncOperations = map[SyncOperation]struct{}{
	SyncOperationRetentionShorten:     {},
	SyncOperationDeleteRecoveryPoint:  {},
	SyncOperationDeleteReplica:        {},
	SyncOperationDisableRetentionLock: {},
}
