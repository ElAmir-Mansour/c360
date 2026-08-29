package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/dr/bootgraph"
)

// TestBootActionBooter exercises the REAL bootgraph Booter's action dispatch: an
// empty action is an out-of-band boot (nil), a cmd action runs a real local
// command and surfaces a non-zero exit as an error, an http action POSTs and
// gates on a 2xx, and an unsupported scheme is rejected.
func TestBootActionBooter(t *testing.T) {
	booter := newBootActionBooter(5*time.Second, zerolog.Nop())
	svc := bootgraph.Service{ID: "s1", TenantID: "t1", GroupID: "g1", Name: "api", Kind: "api"}

	t.Run("empty action is out-of-band no-op", func(t *testing.T) {
		s := svc
		s.BootAction = ""
		require.NoError(t, booter.Boot(context.Background(), s))
	})

	t.Run("cmd success", func(t *testing.T) {
		s := svc
		s.BootAction = "cmd:true"
		require.NoError(t, booter.Boot(context.Background(), s))
	})

	t.Run("cmd failure surfaces error", func(t *testing.T) {
		s := svc
		s.BootAction = "cmd:false"
		require.Error(t, booter.Boot(context.Background(), s))
	})

	t.Run("cmd empty command rejected", func(t *testing.T) {
		s := svc
		s.BootAction = "cmd:"
		require.Error(t, booter.Boot(context.Background(), s))
	})

	t.Run("http 2xx passes", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		}))
		defer srv.Close()
		s := svc
		s.BootAction = srv.URL
		require.NoError(t, booter.Boot(context.Background(), s))
	})

	t.Run("http non-2xx fails", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusInternalServerError)
		}))
		defer srv.Close()
		s := svc
		s.BootAction = srv.URL
		require.Error(t, booter.Boot(context.Background(), s))
	})

	t.Run("unsupported scheme rejected", func(t *testing.T) {
		s := svc
		s.BootAction = "ftp://example.com"
		require.Error(t, booter.Boot(context.Background(), s))
	})

	t.Run("teardown is a no-op", func(t *testing.T) {
		s := svc
		s.BootAction = "cmd:true"
		require.NoError(t, booter.TearDown(context.Background(), s))
	})
}

func TestBootActionBooterRejectsNoopTeardownWhenEnforced(t *testing.T) {
	t.Setenv("DR_BOOTGRAPH_REJECT_NOOP_TEARDOWN", "true")
	booter := newBootActionBooter(5*time.Second, zerolog.Nop())
	svc := bootgraph.Service{ID: "s1", TenantID: "t1", GroupID: "g1", Name: "api", Kind: "api", BootAction: "cmd:true"}

	require.Error(t, booter.TearDown(context.Background(), svc))
}
