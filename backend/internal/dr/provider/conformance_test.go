package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestFakeAdapterConformanceEnsureTeardownIsReversible(t *testing.T) {
	adapter := NewFakeAdapter("endpoint", "credential_ref")
	cfg := Config{Endpoint: "https://provider.example", CredentialRef: "vault:dr/provider"}
	if err := adapter.Validate(cfg); err != nil {
		t.Fatalf("Validate: %v", err)
	}

	req := EnsureRequest{
		IdempotencyKey:   "run|site|rp",
		TenantID:         "tenant-1",
		GroupID:          "group-1",
		SiteID:           "site-1",
		StreamID:         "stream-1",
		RecoveryEndpoint: "provider://target",
		Drill:            true,
	}
	first, err := adapter.Ensure(context.Background(), req)
	if err != nil {
		t.Fatalf("Ensure first: %v", err)
	}
	second, err := adapter.Ensure(context.Background(), req)
	if err != nil {
		t.Fatalf("Ensure second: %v", err)
	}
	if first.ExternalID == "" || second.ExternalID != first.ExternalID || !second.Already {
		t.Fatalf("idempotent ensure mismatch: first=%+v second=%+v", first, second)
	}
	if err := adapter.Teardown(context.Background(), TeardownRequest{ExternalID: first.ExternalID, EnsureRequest: req}); err != nil {
		t.Fatalf("Teardown: %v", err)
	}
	if !adapter.TornDown(first.ExternalID) {
		t.Fatalf("resource %q was not marked torn down", first.ExternalID)
	}
}

func TestCertifiedAdaptersFailWhenRequiredConfigMissing(t *testing.T) {
	cases := map[string]Config{
		KindVSphere:    {Kind: KindVSphere, Endpoint: "https://vcenter.example", CredentialRef: "vault:vsphere", Datacenter: "dc1"},
		KindKubernetes: {Kind: KindKubernetes, Endpoint: "https://k8s.example", CredentialRef: "vault:k8s", Cluster: "prod-dr"},
		KindCloud:      {Kind: KindCloud, Endpoint: "https://cloud-gateway.example", CredentialRef: "vault:cloud", Region: "us-east-1", Project: "dr-project"},
		KindNetApp:     {Kind: KindNetApp, Endpoint: "https://ontap.example", CredentialRef: "vault:netapp", StorageVM: "svm1"},
	}

	for kind, configured := range cases {
		t.Run(kind+"/missing static config", func(t *testing.T) {
			adapter, err := NewRegistry().Build(Config{Kind: kind})
			if err != nil {
				t.Fatalf("Build: %v", err)
			}
			if err := adapter.Validate(Config{Kind: kind}); !errors.Is(err, ErrNotConfigured) {
				t.Fatalf("Validate error = %v, want ErrNotConfigured", err)
			}
			_, err = adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "run|site|rp", SiteID: "site", StreamID: "stream"})
			if !errors.Is(err, ErrNotConfigured) {
				t.Fatalf("Ensure error = %v, want ErrNotConfigured", err)
			}
		})

		t.Run(kind+"/missing auth material", func(t *testing.T) {
			adapter, err := NewRegistry().Build(configured)
			if err != nil {
				t.Fatalf("Build: %v", err)
			}
			if kind != KindKubernetes {
				return
			}
			if err := adapter.Validate(configured); !errors.Is(err, ErrNotConfigured) {
				t.Fatalf("Validate error = %v, want ErrNotConfigured", err)
			}
		})
	}
}

func TestGatewayAdapterEnsureTeardown(t *testing.T) {
	// Wave 3: the gateway is HTTPS-only, so this conformance path runs over a TLS
	// test server with the client pinned to the in-test CA.
	ca := newTestCA(t)
	var sawEnsure, sawTeardown bool
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Clario-Credential-Ref"); got != "vault:vsphere" {
			t.Fatalf("credential header = %q", got)
		}
		switch r.URL.Path {
		case "/api/v1/dr/provider/ensure":
			sawEnsure = true
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{
					"external_id": "vmware:dr-vm-1",
					"metadata":    map[string]string{"vm": "dr-vm-1"},
				},
			})
		case "/api/v1/dr/provider/teardown":
			sawTeardown = true
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	server.TLS = ca.serverTLSConfig(t, false)
	server.StartTLS()
	defer server.Close()

	adapter, err := NewRegistry().Build(Config{
		Kind:          KindVSphere,
		Endpoint:      server.URL,
		CredentialRef: "vault:vsphere",
		Datacenter:    "dc1",
		CABundlePEM:   string(ca.certPEM),
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if err := adapter.Validate(Config{Kind: KindVSphere, Endpoint: server.URL, CredentialRef: "vault:vsphere", Datacenter: "dc1"}); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	result, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "run|site|rp", SiteID: "site", StreamID: "stream"})
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if result.ExternalID != "vmware:dr-vm-1" || result.Metadata["vm"] != "dr-vm-1" {
		t.Fatalf("Ensure result = %+v", result)
	}
	if err := adapter.Teardown(context.Background(), TeardownRequest{ExternalID: result.ExternalID}); err != nil {
		t.Fatalf("Teardown: %v", err)
	}
	if !sawEnsure || !sawTeardown {
		t.Fatalf("gateway calls missing: ensure=%t teardown=%t", sawEnsure, sawTeardown)
	}
}

func TestKubernetesAdapterEnsureCreatesNamespaceSecretAndJob(t *testing.T) {
	var sawNamespace, sawSecret, sawJob bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer test-token" {
			t.Fatalf("auth header = %q", got)
		}
		switch r.URL.Path {
		case "/api/v1/namespaces":
			sawNamespace = true
			w.WriteHeader(http.StatusCreated)
		case "/api/v1/namespaces/dr/secrets":
			sawSecret = true
			w.WriteHeader(http.StatusCreated)
		case "/apis/batch/v1/namespaces/dr/jobs":
			sawJob = true
			w.WriteHeader(http.StatusCreated)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	adapter, err := NewRegistry().Build(Config{
		Kind:          KindKubernetes,
		Endpoint:      server.URL,
		CredentialRef: "vault:k8s",
		Cluster:       "prod-dr",
		Settings: map[string]string{
			"token":     "test-token",
			"namespace": "dr",
			"image":     "registry.example/recover:1",
		},
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	result, err := adapter.Ensure(context.Background(), EnsureRequest{
		IdempotencyKey: "run|site|rp",
		TenantID:       "tenant",
		GroupID:        "group",
		SiteID:         "site",
		StreamID:       "stream",
		Plaintext:      []byte("payload"),
		Drill:          true,
	})
	if err != nil {
		t.Fatalf("Ensure: %v", err)
	}
	if result.ExternalID == "" || result.Metadata["namespace"] != "dr" || result.Metadata["job"] == "" {
		t.Fatalf("Ensure result = %+v", result)
	}
	if !sawNamespace || !sawSecret || !sawJob {
		t.Fatalf("kubernetes calls missing: namespace=%t secret=%t job=%t", sawNamespace, sawSecret, sawJob)
	}
}
