package topology

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// fakeTopologyService implements topologyService so the router's HTTP wiring,
// permission gating and error mapping are tested without a database.
type fakeTopologyService struct {
	topo      Topology
	order     []string
	topoErr   error
	addEdge   *Edge
	addErr    error
	selection FailoverSelection
	selErr    error

	lastGroupID string
	lastInput   AddEdgeInput
}

func (f *fakeTopologyService) GetTopology(_ context.Context, _ uuid.UUID, groupID string) (Topology, []string, error) {
	f.lastGroupID = groupID
	return f.topo, f.order, f.topoErr
}

func (f *fakeTopologyService) AddEdge(_ context.Context, _ uuid.UUID, groupID string, in AddEdgeInput) (*Edge, error) {
	f.lastGroupID = groupID
	f.lastInput = in
	return f.addEdge, f.addErr
}

func (f *fakeTopologyService) SelectFailoverTarget(_ context.Context, _ uuid.UUID, groupID string) (FailoverSelection, error) {
	f.lastGroupID = groupID
	return f.selection, f.selErr
}

func withUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func TestRouter_GetTopology(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeTopologyService{
		topo: Topology{GroupID: groupID.String(),
			Nodes: []Node{{ID: "S", Role: RoleSource}, {ID: "T", Role: RoleTarget}},
			Edges: []Edge{{ID: "e1", FromNodeID: "S", ToNodeID: "T"}}},
		order: []string{"S", "T"},
	}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/topology", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst")) // analyst has dr:read

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastGroupID != groupID.String() {
		t.Fatalf("group id not propagated: %q", svc.lastGroupID)
	}
	var body struct {
		Data struct {
			GroupID   string   `json:"group_id"`
			TopoOrder []string `json:"topo_order"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if len(body.Data.TopoOrder) != 2 {
		t.Fatalf("topo_order = %v, want 2", body.Data.TopoOrder)
	}
}

func TestRouter_GetTopology_RequiresPermission(t *testing.T) {
	groupID := uuid.New()
	router := newRouter(&fakeTopologyService{}, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/topology", nil)
	rec := httptest.NewRecorder()
	// A user with no DR permission must be rejected.
	router.ServeHTTP(rec, withUser(req, uuid.New(), "no_perms_role"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
}

func TestRouter_AddEdge_Created(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeTopologyService{addEdge: &Edge{ID: "edge-1", FromNodeID: "n1", ToNodeID: "n2"}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	payload := `{"from_site_id":"s1","to_site_id":"s2","stream_id":"stream-1","mode":"sync","priority":5}`
	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/topology/edges", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin")) // has dr:write

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastInput.FromSiteID != "s1" || svc.lastInput.ToSiteID != "s2" || svc.lastInput.Mode != "sync" || svc.lastInput.Priority != 5 {
		t.Fatalf("input not propagated: %+v", svc.lastInput)
	}
}

func TestRouter_AddEdge_CycleReturns409(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeTopologyService{addErr: ErrCycle}
	router := newRouter(svc, zerolog.Nop()).Routes()

	payload := `{"from_site_id":"s1","to_site_id":"s2"}`
	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/topology/edges", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 on cycle; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "cycle") {
		t.Fatalf("body should mention cycle: %s", rec.Body.String())
	}
}

func TestRouter_AddEdge_RequiresWritePermission(t *testing.T) {
	groupID := uuid.New()
	router := newRouter(&fakeTopologyService{}, zerolog.Nop()).Routes()
	payload := `{"from_site_id":"s1","to_site_id":"s2"}`
	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/topology/edges", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	// analyst has dr:read but NOT dr:write.
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (analyst lacks dr:write)", rec.Code)
	}
}

func TestRouter_AddEdge_MissingFields(t *testing.T) {
	groupID := uuid.New()
	router := newRouter(&fakeTopologyService{}, zerolog.Nop()).Routes()
	payload := `{"from_site_id":"s1"}` // to_site_id missing
	req := httptest.NewRequest(http.MethodPost, "/groups/"+groupID.String()+"/topology/edges", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "tenant_admin"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for missing to_site_id", rec.Code)
	}
}

func TestRouter_FailoverTarget(t *testing.T) {
	groupID := uuid.New()
	lag := int64(2)
	svc := &fakeTopologyService{selection: FailoverSelection{
		GroupID:     groupID.String(),
		EvaluatedAt: time.Now().UTC(),
		Selected:    &FailoverCandidate{NodeID: "T2", SiteName: "t2", Eligible: true, LagSeconds: &lag, Reason: "edge healthy"},
		Ranking: []FailoverCandidate{
			{NodeID: "T2", Eligible: true, LagSeconds: &lag},
			{NodeID: "T1", Eligible: true},
		},
	}}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/topology/failover-target", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data FailoverSelection `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if body.Data.Selected == nil || body.Data.Selected.NodeID != "T2" {
		t.Fatalf("selected = %v, want T2", body.Data.Selected)
	}
	if len(body.Data.Ranking) != 2 {
		t.Fatalf("ranking should be serialised; got %d", len(body.Data.Ranking))
	}
}

func TestRouter_GroupNotFound(t *testing.T) {
	groupID := uuid.New()
	svc := &fakeTopologyService{topoErr: ErrGroupNotFound}
	router := newRouter(svc, zerolog.Nop()).Routes()
	req := httptest.NewRequest(http.MethodGet, "/groups/"+groupID.String()+"/topology", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
