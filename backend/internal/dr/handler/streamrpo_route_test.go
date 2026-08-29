package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/handler"
)

func TestStreamRPORoute_ReturnsLiveRPO(t *testing.T) {
	svc := &stubService{}
	router := handler.New(svc, zerolog.Nop()).Routes()
	tenantID := uuid.New()
	userID := uuid.New()
	streamID := uuid.New()

	req := httptest.NewRequest(http.MethodGet, "/streams/"+streamID.String()+"/rpo", nil)
	rec := httptest.NewRecorder()
	// dr:read is sufficient for the RPO view.
	router.ServeHTTP(rec, withUser(req, tenantID, userID, "viewer"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var body struct {
		Data struct {
			Status  string `json:"status"`
			HasData bool   `json:"has_data"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if !body.Data.HasData {
		t.Fatalf("has_data = false, want true; body=%s", rec.Body.String())
	}
}

func TestStreamPauseResumeRoutes_RequireDRWrite(t *testing.T) {
	streamID := uuid.New()
	cases := []struct {
		name   string
		path   string
		role   string
		expect int
	}{
		{"pause as admin", "/streams/" + streamID.String() + "/pause", "tenant_admin", http.StatusNoContent},
		{"resume as admin", "/streams/" + streamID.String() + "/resume", "tenant_admin", http.StatusNoContent},
		{"pause as viewer is forbidden", "/streams/" + streamID.String() + "/pause", "viewer", http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &stubService{}
			router := handler.New(svc, zerolog.Nop()).Routes()
			req := httptest.NewRequest(http.MethodPost, tc.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, withUser(req, uuid.New(), uuid.New(), tc.role))
			if rec.Code != tc.expect {
				t.Fatalf("status = %d, want %d; body=%s", rec.Code, tc.expect, rec.Body.String())
			}
		})
	}
}
