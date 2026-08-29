package auth

import (
	"testing"
	"time"
)

// TestGenerateImpersonationToken_Valid verifies that an impersonation token:
//
//	(a) parses/verifies under the manager's public key (RS256);
//	(b) carries Readonly=true, ImpersonatedBy=impersonator, ActAsUserID=target,
//	    UserID/Subject=target, Roles carried, TenantID=target tenant;
//	(c) expires at now+ttl within tolerance.
func TestGenerateImpersonationToken_Valid(t *testing.T) {
	mgr := newTestJWTManager(t)

	const (
		target       = "target-user-7"
		targetTenant = "tenant-acme"
		targetEmail  = "victim@example.com"
		impersonator = "platform-admin-1"
		ttl          = 5 * time.Minute
	)
	targetRoles := []string{"viewer", "analyst"}

	before := time.Now()
	tokenStr, err := mgr.GenerateImpersonationToken(target, targetTenant, targetEmail, targetRoles, impersonator, ttl)
	after := time.Now()
	if err != nil {
		t.Fatalf("GenerateImpersonationToken failed: %v", err)
	}
	if tokenStr == "" {
		t.Fatal("expected non-empty impersonation token")
	}

	// (a) parses/verifies under the manager's public key (RS256).
	claims, err := mgr.ValidateAccessToken(tokenStr)
	if err != nil {
		t.Fatalf("ValidateAccessToken failed for impersonation token: %v", err)
	}

	// (b) claim assertions.
	if !claims.Readonly {
		t.Error("expected Readonly=true on impersonation token")
	}
	if claims.ImpersonatedBy != impersonator {
		t.Errorf("expected ImpersonatedBy=%s, got %s", impersonator, claims.ImpersonatedBy)
	}
	if claims.ActAsUserID != target {
		t.Errorf("expected ActAsUserID=%s, got %s", target, claims.ActAsUserID)
	}
	if claims.UserID != target {
		t.Errorf("expected UserID=%s, got %s", target, claims.UserID)
	}
	if claims.Subject != target {
		t.Errorf("expected Subject=%s, got %s", target, claims.Subject)
	}
	if claims.TenantID != targetTenant {
		t.Errorf("expected TenantID=%s, got %s", targetTenant, claims.TenantID)
	}
	if claims.Email != targetEmail {
		t.Errorf("expected Email=%s, got %s", targetEmail, claims.Email)
	}
	if len(claims.Roles) != len(targetRoles) {
		t.Fatalf("expected %d roles, got %d (%v)", len(targetRoles), len(claims.Roles), claims.Roles)
	}
	for i, r := range targetRoles {
		if claims.Roles[i] != r {
			t.Errorf("role[%d]: expected %s, got %s", i, r, claims.Roles[i])
		}
	}

	// (c) expiry == now+ttl within tolerance.
	if claims.ExpiresAt == nil {
		t.Fatal("expected non-nil ExpiresAt")
	}
	gotExp := claims.ExpiresAt.Time
	wantMin := before.Add(ttl).Add(-2 * time.Second)
	wantMax := after.Add(ttl).Add(2 * time.Second)
	if gotExp.Before(wantMin) || gotExp.After(wantMax) {
		t.Errorf("expiry %v out of tolerance [%v, %v]", gotExp, wantMin, wantMax)
	}
}

// TestGenerateImpersonationToken_RequiresImpersonator asserts the function
// rejects an empty impersonator user ID.
func TestGenerateImpersonationToken_RequiresImpersonator(t *testing.T) {
	mgr := newTestJWTManager(t)
	if _, err := mgr.GenerateImpersonationToken("t", "tenant", "e@x.com", nil, "", time.Minute); err == nil {
		t.Fatal("expected error when impersonatorUserID is empty")
	}
}

// TestGenerateTokenPair_NotReadonly guards against a false-positive: an
// ordinary access token must NOT be marked read-only or carry impersonation
// metadata.
func TestGenerateTokenPair_NotReadonly(t *testing.T) {
	mgr := newTestJWTManager(t)

	pair, err := mgr.GenerateTokenPair("user-1", "tenant-1", "test@example.com", []string{"viewer"}, "sess-1")
	if err != nil {
		t.Fatalf("GenerateTokenPair failed: %v", err)
	}
	claims, err := mgr.ValidateAccessToken(pair.AccessToken)
	if err != nil {
		t.Fatalf("ValidateAccessToken failed: %v", err)
	}
	if claims.Readonly {
		t.Error("expected Readonly=false on a normal access token")
	}
	if claims.ImpersonatedBy != "" {
		t.Errorf("expected empty ImpersonatedBy on normal token, got %s", claims.ImpersonatedBy)
	}
	if claims.ActAsUserID != "" {
		t.Errorf("expected empty ActAsUserID on normal token, got %s", claims.ActAsUserID)
	}
}
