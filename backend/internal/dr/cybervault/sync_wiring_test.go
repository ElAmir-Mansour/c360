package cybervault

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

// compliantSyncWindow / compliantSyncRequest describe a fully policy-compliant
// controlled sync that the planner allows at refNow.
func compliantSyncWindow() SyncWindow {
	return SyncWindow{
		ID:                "win-1",
		StartsAt:          refNow.Add(-time.Hour),
		EndsAt:            refNow.Add(time.Hour),
		AllowedOperations: []SyncOperation{SyncOperationBackupCopy},
	}
}

func compliantSyncRequest() SyncRequest {
	return SyncRequest{
		RequestedBy:          "operator",
		SourceAccountID:      "acct-src",
		SourceRegion:         "us-east-1",
		Operations:           []SyncOperation{SyncOperationBackupCopy},
		RetentionLockEnabled: true,
		ReplicaTargets: []SyncReplicaTarget{{
			ID:                   "replica-1",
			AccountID:            "acct-vault",
			Region:               "us-west-2",
			Immutable:            true,
			RetentionLockEnabled: true,
			RetentionDays:        30,
		}},
	}
}

func registerVaultForTest(t *testing.T, svc *Service, tenantID, groupID uuid.UUID) uuid.UUID {
	t.Helper()
	got, err := svc.UpsertVaultPosture(context.Background(), tenantID, groupID, VaultPosture{Name: "prod vault"})
	if err != nil {
		t.Fatalf("UpsertVaultPosture: %v", err)
	}
	vaultID, err := uuid.Parse(got.ID)
	if err != nil {
		t.Fatalf("registered vault id is not a uuid: %q", got.ID)
	}
	return vaultID
}

func TestService_PlanSync_AllowsCompliantRequest(t *testing.T) {
	t.Parallel()
	svc := newServiceForTest(t, newMemoryPostureStore(), nil)
	tenantID, groupID := uuid.New(), uuid.New()
	vaultID := registerVaultForTest(t, svc, tenantID, groupID)

	plan, err := svc.PlanSync(context.Background(), tenantID, groupID, vaultID, compliantSyncWindow(), compliantSyncRequest())
	if err != nil {
		t.Fatalf("PlanSync: %v", err)
	}
	if !plan.Decision.Allowed || plan.Decision.Verdict != SyncVerdictAllowed {
		t.Fatalf("decision = %+v, want allowed (findings=%+v)", plan.Decision, plan.Decision.Findings)
	}
	if plan.VaultID != vaultID.String() {
		t.Errorf("plan vault id = %q, want %q", plan.VaultID, vaultID)
	}
	if !plan.PlannedAt.Equal(refNow) {
		t.Errorf("planned at = %s, want service clock %s", plan.PlannedAt, refNow)
	}
}

func TestService_PlanSync_BlocksOutsideWindow(t *testing.T) {
	t.Parallel()
	svc := newServiceForTest(t, newMemoryPostureStore(), nil)
	tenantID, groupID := uuid.New(), uuid.New()
	vaultID := registerVaultForTest(t, svc, tenantID, groupID)

	// A zero window is never open; the planner blocks the request.
	plan, err := svc.PlanSync(context.Background(), tenantID, groupID, vaultID, SyncWindow{}, compliantSyncRequest())
	if err != nil {
		t.Fatalf("PlanSync: %v", err)
	}
	if plan.Decision.Allowed || plan.Decision.Verdict != SyncVerdictBlocked || len(plan.Decision.Findings) == 0 {
		t.Fatalf("decision = %+v, want blocked with findings", plan.Decision)
	}
}

func TestService_PlanSync_VaultNotFound(t *testing.T) {
	t.Parallel()
	svc := newServiceForTest(t, newMemoryPostureStore(), nil)
	_, err := svc.PlanSync(context.Background(), uuid.New(), uuid.New(), uuid.New(), compliantSyncWindow(), compliantSyncRequest())
	if err != ErrVaultNotFound {
		t.Fatalf("err = %v, want ErrVaultNotFound for an unregistered vault", err)
	}
}

func TestService_PlanSync_WrongGroupIsNotFound(t *testing.T) {
	t.Parallel()
	svc := newServiceForTest(t, newMemoryPostureStore(), nil)
	tenantID, groupID := uuid.New(), uuid.New()
	vaultID := registerVaultForTest(t, svc, tenantID, groupID)

	_, err := svc.PlanSync(context.Background(), tenantID, uuid.New(), vaultID, compliantSyncWindow(), compliantSyncRequest())
	if err != ErrVaultNotFound {
		t.Fatalf("err = %v, want ErrVaultNotFound when the vault is in a different group", err)
	}
}

func TestService_PlanSync_RequiresVaultID(t *testing.T) {
	t.Parallel()
	svc := newServiceForTest(t, newMemoryPostureStore(), nil)
	_, err := svc.PlanSync(context.Background(), uuid.New(), uuid.New(), uuid.Nil, compliantSyncWindow(), compliantSyncRequest())
	if err == nil {
		t.Fatal("expected an error when vault id is nil")
	}
}

// ---- router-level sync-plan endpoint -------------------------------------

func TestRouter_PlanSync(t *testing.T) {
	t.Parallel()
	vaultID, groupID := uuid.New(), uuid.New()
	svc := &fakeCyberVaultService{syncPlan: SyncPlan{
		VaultID:  vaultID.String(),
		Decision: SyncDecision{Verdict: SyncVerdictAllowed, Allowed: true},
	}}
	h := newHTTPRouter(svc)

	body, _ := json.Marshal(planSyncRequest{Window: compliantSyncWindow(), Request: compliantSyncRequest()})
	req := httptest.NewRequest(http.MethodPost, "/cyber-vaults/"+vaultID.String()+"/sync/plan?group="+groupID.String(), bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withUser(req, uuid.New(), "super-admin"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if svc.planCalls != 1 || svc.lastVaultID != vaultID || svc.lastGroupID != groupID {
		t.Errorf("PlanSync called %d times (vault=%s group=%s), want 1 for %s/%s", svc.planCalls, svc.lastVaultID, svc.lastGroupID, vaultID, groupID)
	}
	if len(svc.lastSyncReq.Operations) != 1 || svc.lastSyncReq.Operations[0] != SyncOperationBackupCopy {
		t.Errorf("decoded request operations = %v, want [backup_copy]", svc.lastSyncReq.Operations)
	}
	var env struct {
		Data SyncPlan `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if !env.Data.Decision.Allowed {
		t.Errorf("response decision = %+v, want allowed", env.Data.Decision)
	}
}

func TestRouter_PlanSync_RequiresGroup(t *testing.T) {
	t.Parallel()
	svc := &fakeCyberVaultService{}
	h := newHTTPRouter(svc)

	body, _ := json.Marshal(planSyncRequest{Window: compliantSyncWindow(), Request: compliantSyncRequest()})
	req := httptest.NewRequest(http.MethodPost, "/cyber-vaults/"+uuid.New().String()+"/sync/plan", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withUser(req, uuid.New(), "super-admin"))

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when group query param is missing", rec.Code)
	}
	if svc.planCalls != 0 {
		t.Error("service must not be called without a group")
	}
}

func TestRouter_PlanSync_VaultNotFound(t *testing.T) {
	t.Parallel()
	svc := &fakeCyberVaultService{err: ErrVaultNotFound}
	h := newHTTPRouter(svc)

	body, _ := json.Marshal(planSyncRequest{Window: compliantSyncWindow(), Request: compliantSyncRequest()})
	req := httptest.NewRequest(http.MethodPost, "/cyber-vaults/"+uuid.New().String()+"/sync/plan?group="+uuid.New().String(), bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withUser(req, uuid.New(), "super-admin"))

	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

// TestRouter_PlanSync_RequiresDRWrite asserts a dr:read-only user cannot plan a
// sync (the policy gate is a dr:write action like evaluate).
func TestRouter_PlanSync_RequiresDRWrite(t *testing.T) {
	t.Parallel()
	svc := &fakeCyberVaultService{}
	h := newHTTPRouter(svc)

	body, _ := json.Marshal(planSyncRequest{Window: compliantSyncWindow(), Request: compliantSyncRequest()})
	req := httptest.NewRequest(http.MethodPost, "/cyber-vaults/"+uuid.New().String()+"/sync/plan?group="+uuid.New().String(), bytes.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, withUser(req, uuid.New(), "viewer"))

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403 for a dr:read-only user", rec.Code)
	}
}
