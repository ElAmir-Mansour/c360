package opensearch

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
)

func TestClusterHealth_Green(t *testing.T) {
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/_cluster/health") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"green","number_of_nodes":3,"active_primary_shards":12}`))
	})
	defer cleanup()
	h, err := c.ClusterHealth(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if h.Status != "green" {
		t.Errorf("status = %s", h.Status)
	}
	if h.NumberOfNodes != 3 {
		t.Errorf("nodes = %d", h.NumberOfNodes)
	}
}

func TestClusterHealth_Red(t *testing.T) {
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"red","number_of_nodes":0}`))
	})
	defer cleanup()
	_, err := c.ClusterHealth(context.Background())
	if err == nil {
		t.Fatal("expected ErrClusterRed")
	}
	if !errors.Is(err, ErrClusterRed) {
		t.Errorf("err = %v", err)
	}
}

func TestHealthCheckerAdapter(t *testing.T) {
	c, cleanup := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"yellow","number_of_nodes":1}`))
	})
	defer cleanup()
	hc := c.HealthChecker()
	if hc.Name() != "opensearch" {
		t.Errorf("name = %s", hc.Name())
	}
	res := hc.Check(context.Background())
	if res.Status != "degraded" {
		t.Errorf("status = %s", res.Status)
	}
}
