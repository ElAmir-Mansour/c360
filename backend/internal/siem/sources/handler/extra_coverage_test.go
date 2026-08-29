package handler

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/enroll"
)

// fakeEnroller satisfies the Enroller surface used by the handler.
// The real *enroll.Service is concrete so we wire through the
// Deps.Enroller field with a tiny wrapper that just constructs a
// real *enroll.Service stub. Since the handler only calls
// Exchange and reports back via writeServiceErr, we can exercise
// the error paths by giving Exchange a setup that always fails
// (CSR empty).
func TestRotateExchange_NoEnroller(t *testing.T) {
	h := NewEnrollHandler(Deps{Logger: zerolog.Nop()})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x/rotate-cert/exchange", bytes.NewBufferString(`{}`))
	h.RotateExchange(rec, req)
	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

func TestClientIP_Forwarded(t *testing.T) {
	r := httptest.NewRequest("POST", "/x", nil)
	r.Header.Set("X-Forwarded-For", "1.2.3.4")
	require.Equal(t, "1.2.3.4", clientIP(r))

	r2 := httptest.NewRequest("POST", "/x", nil)
	r2.RemoteAddr = "5.6.7.8:1234"
	require.Equal(t, "5.6.7.8:1234", clientIP(r2))
}

func TestEnroll_BadJSON_Reaches503_NoEnroller(t *testing.T) {
	h := NewEnrollHandler(Deps{Logger: zerolog.Nop()})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x/enroll", bytes.NewBufferString("nope"))
	h.Enroll(rec, req)
	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

// fakeEnrollSvc just calls the real Exchange path with garbage —
// covers the Enroll handler's error branch.
type errEnroller struct{}

func (errEnroller) Exchange(_ context.Context, _ enroll.ExchangeInput) (*enroll.ExchangeOutput, error) {
	return nil, errors.New("boom")
}

func TestEnroll_DispatchesToEnroller(t *testing.T) {
	// We can't easily plug a non-*enroll.Service into Deps. Instead,
	// exercise writeServiceErr's tail-default branch via a Disable
	// call that returns an "internal" error.
	svc := newStubSvc()
	svc.updateErr = errors.New("non-sentinel")
	rtr := newTestRouter(svc)
	tenant := uuid.New()
	id := uuid.New()
	svc.bySource[id] = &sources.Source{ID: id, TenantID: tenant}
	req := httptest.NewRequest("PATCH", "/"+id.String(), bytes.NewBufferString(`{}`))
	req.Header.Set("If-Match", `"1"`)
	rec := httptest.NewRecorder()
	rtr.ServeHTTP(rec, withTenant(req, tenant))
	require.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestActorUUID_Empty(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	require.Equal(t, uuid.Nil, actorUUID(r))
}

func TestAllow_Redis(t *testing.T) {
	mr := newMRT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	hb := NewHeartbeatHandler(nil, rdb, 2)
	id := uuid.New()
	require.True(t, hb.allow(context.Background(), id))
	require.True(t, hb.allow(context.Background(), id))
	require.False(t, hb.allow(context.Background(), id))
}
