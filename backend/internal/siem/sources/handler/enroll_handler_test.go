package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

func TestEnroll_NoEnroller(t *testing.T) {
	r := chi.NewRouter()
	r.Post("/{id}/enroll", NewEnrollHandler(Deps{Logger: zerolog.Nop()}).Enroll)
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/abc/enroll", bytes.NewBufferString(`{}`))
	r.ServeHTTP(rec, req)
	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
}

func TestEnroll_BadJSON_NoEnroller(t *testing.T) {
	// With Enroller nil we always return 503 even before parsing.
	h := NewEnrollHandler(Deps{Logger: zerolog.Nop()})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x/enroll", bytes.NewBufferString("notjson"))
	h.Enroll(rec, req)
	require.Equal(t, http.StatusServiceUnavailable, rec.Code)
}
