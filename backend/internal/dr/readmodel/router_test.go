package readmodel

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/model"
)

type stubReadService struct {
	posture     *Posture
	replication *ReplicationSummary
	group       *GroupSummary

	postureErr     error
	replicationErr error
	groupErr       error

	postureCalls     int
	replicationCalls int
	groupCalls       int

	postureTenant     uuid.UUID
	replicationTenant uuid.UUID
	groupTenant       uuid.UUID
	groupID           uuid.UUID
}

func (s *stubReadService) BuildPosture(_ context.Context, tenantID uuid.UUID) (*Posture, error) {
	s.postureCalls++
	s.postureTenant = tenantID
	return s.posture, s.postureErr
}

func (s *stubReadService) BuildReplicationSummary(_ context.Context, tenantID uuid.UUID) (*ReplicationSummary, error) {
	s.replicationCalls++
	s.replicationTenant = tenantID
	return s.replication, s.replicationErr
}

func (s *stubReadService) BuildGroupSummary(_ context.Context, tenantID, groupID uuid.UUID) (*GroupSummary, error) {
	s.groupCalls++
	s.groupTenant = tenantID
	s.groupID = groupID
	return s.group, s.groupErr
}

func TestRouterHappyPaths(t *testing.T) {
	tenantID := uuid.New()
	groupID := uuid.New()
	svc := &stubReadService{
		posture:     &Posture{OverallHealth: "healthy", SiteCount: 2},
		replication: &ReplicationSummary{OverallHealth: "warning", TotalStreams: 3},
		group:       &GroupSummary{GroupID: groupID.String(), Name: "Core Banking", Health: "healthy"},
	}
	router := newRouter(svc, zerolog.Nop()).Routes()

	t.Run("posture", func(t *testing.T) {
		rec := serveRead(router, tenantID, "/posture")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		got := decodeData[Posture](t, rec)
		if got.OverallHealth != "healthy" || got.SiteCount != 2 {
			t.Fatalf("posture = %+v", got)
		}
	})

	t.Run("replication summary", func(t *testing.T) {
		rec := serveRead(router, tenantID, "/replication/summary")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		got := decodeData[ReplicationSummary](t, rec)
		if got.OverallHealth != "warning" || got.TotalStreams != 3 {
			t.Fatalf("replication summary = %+v", got)
		}
	})

	t.Run("group summary", func(t *testing.T) {
		rec := serveRead(router, tenantID, "/groups/"+groupID.String()+"/summary")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		got := decodeData[GroupSummary](t, rec)
		if got.GroupID != groupID.String() || got.Name != "Core Banking" {
			t.Fatalf("group summary = %+v", got)
		}
	})

	if svc.postureCalls != 1 || svc.replicationCalls != 1 || svc.groupCalls != 1 {
		t.Fatalf("calls = posture:%d replication:%d group:%d, want 1/1/1", svc.postureCalls, svc.replicationCalls, svc.groupCalls)
	}
	if svc.postureTenant != tenantID || svc.replicationTenant != tenantID || svc.groupTenant != tenantID {
		t.Fatalf("tenant propagation mismatch: posture=%s replication=%s group=%s want %s", svc.postureTenant, svc.replicationTenant, svc.groupTenant, tenantID)
	}
	if svc.groupID != groupID {
		t.Fatalf("group id = %s, want %s", svc.groupID, groupID)
	}
}

func TestRouterRequiresDRRead(t *testing.T) {
	groupID := uuid.New()
	for _, path := range []string{"/posture", "/replication/summary", "/groups/" + groupID.String() + "/summary"} {
		t.Run(path, func(t *testing.T) {
			svc := &stubReadService{}
			router := newRouter(svc, zerolog.Nop()).Routes()
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, withAuth(req, uuid.New(), "billing_admin"))
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
			}
			if svc.postureCalls+svc.replicationCalls+svc.groupCalls != 0 {
				t.Fatalf("service called despite missing dr:read")
			}
		})
	}
}

func TestRouterBadGroupUUID(t *testing.T) {
	svc := &stubReadService{}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/groups/not-a-uuid/summary", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withAuth(req, uuid.New(), "viewer"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if svc.groupCalls != 0 {
		t.Fatalf("service called for bad group UUID")
	}
}

func TestRouterMissingTenant(t *testing.T) {
	svc := &stubReadService{}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/posture", nil)
	req = withUserOnly(req, "viewer")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
	if svc.postureCalls != 0 {
		t.Fatalf("service called without tenant")
	}
}

func TestRouterNotFoundMapping(t *testing.T) {
	groupID := uuid.New()
	svc := &stubReadService{groupErr: fmt.Errorf("group %s: %w", groupID, model.ErrNotFound)}
	router := newRouter(svc, zerolog.Nop()).Routes()
	rec := serveRead(router, uuid.New(), "/groups/"+groupID.String()+"/summary")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	got := decodeError(t, rec)
	if got.Code != "not_found" {
		t.Fatalf("error code = %q, want not_found", got.Code)
	}
}

func serveRead(router http.Handler, tenantID uuid.UUID, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withAuth(req, tenantID, "viewer"))
	return rec
}

func withAuth(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func withUserOnly(req *http.Request, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), Roles: roles}
	return req.WithContext(auth.WithUser(req.Context(), user))
}

func decodeData[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var envelope struct {
		Data T `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v; body=%s", err, rec.Body.String())
	}
	return envelope.Data
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) struct {
	Code    string `json:"code"`
	Message string `json:"message"`
} {
	t.Helper()
	var body struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error: %v; body=%s", err, rec.Body.String())
	}
	return body
}
