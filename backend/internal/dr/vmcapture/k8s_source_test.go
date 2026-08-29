package vmcapture_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/dr/vmcapture"
)

// TestRESTResourceSource_ListsOverHTTP exercises the REAL REST source against a
// httptest.Server: a genuine HTTP GET per (namespace, kind), a genuine JSON List
// decode, and the bearer token + Accept headers actually sent on the wire. This
// is real I/O end to end, just without a live cluster.
func TestRESTResourceSource_ListsOverHTTP(t *testing.T) {
	t.Parallel()

	var gotPaths []string
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPaths = append(gotPaths, r.URL.Path)
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/apis/apps/v1/namespaces/prod/deployments":
			_, _ = w.Write([]byte(`{"kind":"DeploymentList","items":[
				{"metadata":{"name":"web","namespace":"prod","resourceVersion":"5"},"spec":{"replicas":2},"status":{"readyReplicas":2}}
			]}`))
		case "/api/v1/namespaces/prod/configmaps":
			_, _ = w.Write([]byte(`{"kind":"ConfigMapList","items":[
				{"metadata":{"name":"cfg","namespace":"prod"},"data":{"a":"b"}}
			]}`))
		case "/api/v1/namespaces/prod/secrets":
			// Empty namespace for this kind: a 404 is treated as no items.
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"kind":"Status","status":"Failure","reason":"NotFound"}`))
		default:
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"items":[]}`))
		}
	}))
	defer srv.Close()

	src, err := vmcapture.NewRESTResourceSource(vmcapture.RESTConfig{
		APIServer:   srv.URL,
		BearerToken: "tok-123",
		Namespaces:  []string{"prod"},
		Kinds:       []string{"Deployment", "ConfigMap", "Secret"},
		HTTPClient:  srv.Client(),
	})
	if err != nil {
		t.Fatalf("NewRESTResourceSource: %v", err)
	}

	resources, err := src.ListResources(context.Background())
	if err != nil {
		t.Fatalf("ListResources: %v", err)
	}

	// Deployment + ConfigMap returned items; Secret 404'd to zero.
	if len(resources) != 2 {
		t.Fatalf("resources = %d, want 2", len(resources))
	}
	if gotAuth != "Bearer tok-123" {
		t.Fatalf("authorization header = %q, want Bearer tok-123", gotAuth)
	}
	// All three kinds were requested over real HTTP.
	if len(gotPaths) != 3 {
		t.Fatalf("requested %d paths, want 3: %v", len(gotPaths), gotPaths)
	}

	// Normalizing the listed resources strips the server-set fields seen on the
	// wire (resourceVersion, status).
	set, err := vmcapture.BuildManifestSet(resources, nil)
	if err != nil {
		t.Fatalf("BuildManifestSet: %v", err)
	}
	for _, r := range set.Resources {
		if strings.Contains(string(r.Manifest), "resourceVersion") || strings.Contains(string(r.Manifest), "status") {
			t.Fatalf("REST-listed resource not normalized: %s", r.Manifest)
		}
	}
}

// TestRESTResourceSource_RejectsUnsupportedKind proves construction validates
// the requested kinds against the known REST surface.
func TestRESTResourceSource_RejectsUnsupportedKind(t *testing.T) {
	t.Parallel()
	_, err := vmcapture.NewRESTResourceSource(vmcapture.RESTConfig{
		APIServer:  "https://k8s.example",
		Namespaces: []string{"prod"},
		Kinds:      []string{"CustomResourceThatDoesNotExist"},
	})
	if err == nil {
		t.Fatal("expected error for unsupported kind")
	}
}

// TestRESTResourceSource_PropagatesServerError proves a non-200/404 status is a
// hard error (not silently dropped).
func TestRESTResourceSource_PropagatesServerError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"reason":"boom"}`))
	}))
	defer srv.Close()

	src, err := vmcapture.NewRESTResourceSource(vmcapture.RESTConfig{
		APIServer:  srv.URL,
		Namespaces: []string{"prod"},
		Kinds:      []string{"ConfigMap"},
		HTTPClient: srv.Client(),
	})
	if err != nil {
		t.Fatalf("NewRESTResourceSource: %v", err)
	}
	if _, err := src.ListResources(context.Background()); err == nil {
		t.Fatal("expected error on 500 status")
	}
}
