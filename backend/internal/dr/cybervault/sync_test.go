package cybervault

import (
	"reflect"
	"testing"
	"time"
)

var syncNow = time.Date(2026, 6, 13, 14, 0, 0, 0, time.UTC)

func openSyncWindow(ops ...SyncOperation) SyncWindow {
	return SyncWindow{
		ID:                "win-1",
		Name:              "cyber-vault copy",
		StartsAt:          syncNow.Add(-time.Hour),
		EndsAt:            syncNow.Add(time.Hour),
		AllowedOperations: ops,
	}
}

func crossRegionTarget(id string) SyncReplicaTarget {
	return SyncReplicaTarget{
		ID:                   id,
		AccountID:            "vault-account",
		Region:               "us-west-2",
		Immutable:            true,
		RetentionLockEnabled: true,
		RetentionDays:        90,
	}
}

func baseSyncRequest(ops ...SyncOperation) SyncRequest {
	return SyncRequest{
		ID:                   "sync-1",
		VaultID:              "vault-1",
		RequestedBy:          "vault-operator",
		SourceAccountID:      "prod-account",
		SourceRegion:         "us-east-1",
		Operations:           ops,
		ReplicaTargets:       []SyncReplicaTarget{crossRegionTarget("target-a")},
		RetentionLockEnabled: true,
		CurrentRetentionDays: 90,
	}
}

func findingCodes(findings []SyncFinding) []string {
	out := make([]string, len(findings))
	for i, finding := range findings {
		out[i] = finding.Code
	}
	return out
}

func TestPlanSync_AllowsBackupCopyInsideWindow(t *testing.T) {
	t.Parallel()

	window := openSyncWindow(SyncOperationBackupCopy)
	request := baseSyncRequest(SyncOperationBackupCopy)

	plan := NewSyncPlanner(func() time.Time { return syncNow }).Plan(window, request)

	if plan.Decision.Verdict != SyncVerdictAllowed || !plan.Decision.Allowed {
		t.Fatalf("decision = %s/%v, want allowed/true: %#v", plan.Decision.Verdict, plan.Decision.Allowed, plan.Decision.Findings)
	}
	if len(plan.Decision.Findings) != 0 {
		t.Fatalf("findings = %#v, want none", plan.Decision.Findings)
	}
	if !plan.PlannedAt.Equal(syncNow) {
		t.Fatalf("planned_at = %v, want %v", plan.PlannedAt, syncNow)
	}
	if got, want := plan.Operations, []SyncOperation{SyncOperationBackupCopy}; !reflect.DeepEqual(got, want) {
		t.Fatalf("operations = %v, want %v", got, want)
	}
	if len(plan.ReplicaTargets) != 1 || plan.ReplicaTargets[0].ID != "target-a" {
		t.Fatalf("replica targets = %#v, want target-a", plan.ReplicaTargets)
	}
}

func TestPlanSync_BlocksDestructiveOperationWithoutApproval(t *testing.T) {
	t.Parallel()

	window := openSyncWindow(SyncOperationDeleteRecoveryPoint)
	request := baseSyncRequest(SyncOperationDeleteRecoveryPoint)
	request.ReplicaTargets = nil

	plan := PlanSync(window, request, syncNow)

	if plan.Decision.Verdict != SyncVerdictBlocked || plan.Decision.Allowed {
		t.Fatalf("decision = %s/%v, want blocked/false", plan.Decision.Verdict, plan.Decision.Allowed)
	}
	want := []string{"CV-SYNC-DESTRUCTIVE-APPROVAL"}
	if got := findingCodes(plan.Decision.Findings); !reflect.DeepEqual(got, want) {
		t.Fatalf("finding codes = %v, want %v", got, want)
	}
}

func TestPlanSync_BlocksRetentionShortening(t *testing.T) {
	t.Parallel()

	window := openSyncWindow(SyncOperationRetentionShorten)
	request := baseSyncRequest(SyncOperationRetentionShorten)
	request.ReplicaTargets = nil
	request.RequestedRetentionDays = 30
	request.DestructiveApproval = SyncApproval{Approved: true, ApproverCount: 2, Reference: "chg-123"}

	plan := PlanSync(window, request, syncNow)

	if plan.Decision.Verdict != SyncVerdictBlocked {
		t.Fatalf("decision = %s, want blocked", plan.Decision.Verdict)
	}
	want := []string{"CV-SYNC-RETENTION-SHORTEN"}
	if got := findingCodes(plan.Decision.Findings); !reflect.DeepEqual(got, want) {
		t.Fatalf("finding codes = %v, want %v", got, want)
	}
}

func TestPlanSync_RestoreDrillRequiresImmutableRecoveryPoint(t *testing.T) {
	t.Parallel()

	window := openSyncWindow(SyncOperationRestoreDrill)
	request := baseSyncRequest(SyncOperationRestoreDrill)
	request.ReplicaTargets = nil
	request.RecoveryPointID = "rp-1"
	request.RecoveryPointImmutable = false

	blocked := PlanSync(window, request, syncNow)
	if blocked.Decision.Verdict != SyncVerdictBlocked {
		t.Fatalf("mutable restore drill verdict = %s, want blocked", blocked.Decision.Verdict)
	}
	want := []string{"CV-SYNC-RESTORE-IMMUTABLE"}
	if got := findingCodes(blocked.Decision.Findings); !reflect.DeepEqual(got, want) {
		t.Fatalf("mutable restore drill findings = %v, want %v", got, want)
	}

	request.RecoveryPointImmutable = true
	allowed := PlanSync(window, request, syncNow)
	if allowed.Decision.Verdict != SyncVerdictAllowed || !allowed.Decision.Allowed {
		t.Fatalf("immutable restore drill decision = %s/%v, want allowed/true: %#v",
			allowed.Decision.Verdict, allowed.Decision.Allowed, allowed.Decision.Findings)
	}
}

func TestPlanSync_DeterministicFindingsAndOrdering(t *testing.T) {
	t.Parallel()

	window := SyncWindow{
		ID:                "win-1",
		StartsAt:          syncNow.Add(-3 * time.Hour),
		EndsAt:            syncNow.Add(-2 * time.Hour),
		AllowedOperations: []SyncOperation{SyncOperationBackupCopy},
	}
	request := baseSyncRequest(
		SyncOperationRestoreDrill,
		SyncOperationBackupCopy,
		SyncOperationDeleteRecoveryPoint,
		SyncOperation("unknown_op"),
		SyncOperationBackupCopy,
	)
	request.RequestedBySourceAdmin = true
	request.RequestedRetentionDays = 30
	request.RecoveryPointImmutable = false
	request.ReplicaTargets = []SyncReplicaTarget{
		{ID: "z-target", AccountID: "prod-account", Region: "us-east-1", Immutable: false, RetentionLockEnabled: false, RetentionDays: 10},
		{ID: "a-target", AccountID: "prod-account", Region: "us-east-1", Immutable: false, RetentionLockEnabled: false, RetentionDays: 10},
	}

	plan := PlanSync(window, request, syncNow)

	if plan.Decision.Verdict != SyncVerdictBlocked {
		t.Fatalf("decision = %s, want blocked", plan.Decision.Verdict)
	}
	wantOps := []SyncOperation{
		SyncOperationBackupCopy,
		SyncOperationRestoreDrill,
		SyncOperationDeleteRecoveryPoint,
		SyncOperation("unknown_op"),
	}
	if !reflect.DeepEqual(plan.Operations, wantOps) {
		t.Fatalf("operations = %v, want %v", plan.Operations, wantOps)
	}
	if gotIDs := []string{plan.ReplicaTargets[0].ID, plan.ReplicaTargets[1].ID}; !reflect.DeepEqual(gotIDs, []string{"a-target", "z-target"}) {
		t.Fatalf("target order = %v, want [a-target z-target]", gotIDs)
	}

	wantCodes := []string{
		"CV-SYNC-WINDOW",
		"CV-SYNC-UNKNOWN-OPERATION",
		"CV-SYNC-ALLOWED-OPERATION",
		"CV-SYNC-DESTRUCTIVE-APPROVAL",
		"CV-SYNC-SOURCE-ADMIN",
		"CV-SYNC-RETENTION-SHORTEN",
		"CV-SYNC-CROSS-ACCOUNT",
		"CV-SYNC-CROSS-REGION",
		"CV-SYNC-TARGET-LOCK",
		"CV-SYNC-TARGET-RETENTION",
		"CV-SYNC-CROSS-ACCOUNT",
		"CV-SYNC-CROSS-REGION",
		"CV-SYNC-TARGET-LOCK",
		"CV-SYNC-TARGET-RETENTION",
		"CV-SYNC-RESTORE-IMMUTABLE",
	}
	if got := findingCodes(plan.Decision.Findings); !reflect.DeepEqual(got, wantCodes) {
		t.Fatalf("finding codes = %v, want %v", got, wantCodes)
	}
}
