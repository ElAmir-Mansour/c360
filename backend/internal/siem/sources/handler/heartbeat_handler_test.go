package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/mtls"
)

func TestHeartbeat_NoMTLS_401(t *testing.T) {
	svc := newStubSvc()
	hb := NewHeartbeatHandler(svc, nil, 6)
	req := httptest.NewRequest("POST", "/collector/heartbeat", bytes.NewBufferString(`{}`))
	rec := httptest.NewRecorder()
	hb.Heartbeat(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestHeartbeat_OK(t *testing.T) {
	svc := newStubSvc()
	hb := NewHeartbeatHandler(svc, nil, 6)
	src := &sources.Source{ID: uuid.New(), TenantID: uuid.New(), Status: sources.StatusActive}
	body, _ := bytes.NewBufferString(`{"eps_1min":100,"eps_5min":100}`), error(nil)
	req := httptest.NewRequest("POST", "/collector/heartbeat", body)
	req = req.WithContext(mtls.WithSource(context.Background(), src))
	rec := httptest.NewRecorder()
	hb.Heartbeat(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code)
}

func TestHeartbeat_RateLimited(t *testing.T) {
	svc := newStubSvc()
	hb := NewHeartbeatHandler(svc, nil, 2) // tiny limit
	src := &sources.Source{ID: uuid.New(), Status: sources.StatusActive}
	for i := 0; i < 2; i++ {
		req := httptest.NewRequest("POST", "/collector/heartbeat", bytes.NewBufferString(`{"eps_1min":0,"eps_5min":0}`))
		req = req.WithContext(mtls.WithSource(context.Background(), src))
		rec := httptest.NewRecorder()
		hb.Heartbeat(rec, req)
		require.Equal(t, http.StatusNoContent, rec.Code)
	}
	req := httptest.NewRequest("POST", "/collector/heartbeat", bytes.NewBufferString(`{"eps_1min":0,"eps_5min":0}`))
	req = req.WithContext(mtls.WithSource(context.Background(), src))
	rec := httptest.NewRecorder()
	hb.Heartbeat(rec, req)
	require.Equal(t, http.StatusTooManyRequests, rec.Code)
}

func TestHeartbeat_NegativeCounter(t *testing.T) {
	svc := newStubSvc()
	hb := NewHeartbeatHandler(svc, nil, 6)
	src := &sources.Source{ID: uuid.New(), Status: sources.StatusActive}
	req := httptest.NewRequest("POST", "/collector/heartbeat", bytes.NewBufferString(`{"eps_1min":-1}`))
	req = req.WithContext(mtls.WithSource(context.Background(), src))
	rec := httptest.NewRecorder()
	hb.Heartbeat(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestHeartbeat_BadJSON(t *testing.T) {
	svc := newStubSvc()
	hb := NewHeartbeatHandler(svc, nil, 6)
	src := &sources.Source{ID: uuid.New(), Status: sources.StatusActive}
	req := httptest.NewRequest("POST", "/collector/heartbeat", bytes.NewBufferString(`nope`))
	req = req.WithContext(mtls.WithSource(context.Background(), src))
	rec := httptest.NewRecorder()
	hb.Heartbeat(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestInProcessLimiter_WindowExpires(t *testing.T) {
	l := newInProcessLimiter(1)
	id := uuid.New()
	require.True(t, l.allow(id))
	require.False(t, l.allow(id))
	// simulate elapsed minute
	l.buckets[id].since = time.Now().Add(-2 * time.Minute)
	require.True(t, l.allow(id))
}
