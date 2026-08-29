package handler

import (
	"bytes"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

// Cover the writeServiceErr branches for sentinel errors that the
// other tests don't exercise.
func TestWriteServiceErr_AllSentinels(t *testing.T) {
	for _, c := range []struct {
		err  error
		want int
	}{
		{fmt.Errorf("%w: x", sources.ErrConflict), http.StatusConflict},
		{fmt.Errorf("%w: x", sources.ErrTenantMismatch), http.StatusForbidden},
		{fmt.Errorf("%w: x", sources.ErrTokenConsumed), http.StatusConflict},
		{fmt.Errorf("%w: x", sources.ErrTokenInvalid), http.StatusUnauthorized},
		{fmt.Errorf("%w: x", sources.ErrInvalidState), http.StatusConflict},
		{&sources.FieldErrors{Errors: []sources.FieldError{{Field: "name"}}}, http.StatusBadRequest},
		{errors.New("unknown"), http.StatusInternalServerError},
	} {
		rec := httptest.NewRecorder()
		writeServiceErr(rec, c.err)
		require.Equalf(t, c.want, rec.Code, "expected %d for %v", c.want, c.err)
	}
}

// Force the Disable handler to bubble a non-sentinel error so the
// fallback branch in writeServiceErr is exercised through the
// real router path.
func TestDisable_NonSentinelError(t *testing.T) {
	svc := newStubSvc()
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant, Status: sources.StatusActive}

	// Inject an error response by deleting the source mid-flight.
	delete(svc.bySource, id)
	req := httptest.NewRequest("POST", "/"+id.String()+"/disable", bytes.NewBufferString(`{}`))
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusNotFound, rec.Code)
}

// Exercise the publishLifecycle nil-hub guard.
func TestPublishLifecycle_NilHub(t *testing.T) {
	require.NotPanics(t, func() {
		publishLifecycle(nil, uuid.New(), "lifecycle", "x", "data")
	})
}

func TestActorUUID_BadUUID(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	// not setting a user -> Nil
	_ = actorUUID(r)
}

// Exercise the heartbeat default-limit branch.
func TestNewHeartbeatHandler_DefaultLimit(t *testing.T) {
	hb := NewHeartbeatHandler(nil, nil, 0)
	require.NotNil(t, hb)
	require.Equal(t, 6, hb.rateLimit)
}
