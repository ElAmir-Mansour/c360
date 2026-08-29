package vmcapture

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// k8sKindPath maps a resource Kind to the K8s REST API list path template. The
// %s is the namespace. Core/v1 kinds live under /api/v1; apps/v1 kinds under
// /apis/apps/v1. This is the real K8s REST surface the RESTResourceSource lists.
var k8sKindPath = map[string]string{
	"ConfigMap":             "/api/v1/namespaces/%s/configmaps",
	"Secret":                "/api/v1/namespaces/%s/secrets",
	"Service":               "/api/v1/namespaces/%s/services",
	"PersistentVolumeClaim": "/api/v1/namespaces/%s/persistentvolumeclaims",
	"ServiceAccount":        "/api/v1/namespaces/%s/serviceaccounts",
	"Deployment":            "/apis/apps/v1/namespaces/%s/deployments",
	"StatefulSet":           "/apis/apps/v1/namespaces/%s/statefulsets",
	"DaemonSet":             "/apis/apps/v1/namespaces/%s/daemonsets",
	"ReplicaSet":            "/apis/apps/v1/namespaces/%s/replicasets",
}

// DefaultK8sKinds is the resource set captured when a source names none. It is
// the standard "application workload" set: workloads, their config and their
// storage claims.
var DefaultK8sKinds = []string{
	"Deployment", "StatefulSet", "DaemonSet",
	"Service", "ConfigMap", "Secret", "PersistentVolumeClaim", "ServiceAccount",
}

// RESTConfig wires a RESTResourceSource against a real K8s API server. It is the
// kubeconfig-equivalent reduced to what listing needs: the API server URL, a
// bearer token, the CA bundle (PEM) to verify the server, the namespaces and
// kinds in scope. No client-go: the source speaks the K8s REST API directly
// over net/http behind the ResourceSource interface.
type RESTConfig struct {
	APIServer   string
	BearerToken string
	CACertPEM   []byte
	// InsecureSkipTLSVerify is honored only when no CA is supplied (e.g. an
	// in-cluster proxy that terminates TLS); production supplies CACertPEM.
	InsecureSkipTLSVerify bool
	Namespaces            []string
	Kinds                 []string
	Timeout               time.Duration
	// HTTPClient overrides the constructed client (tests inject an httptest
	// server's client). When nil a client is built from CACertPEM/Timeout.
	HTTPClient *http.Client
}

// RESTResourceSource lists a workload's resources from a real K8s API server
// over net/http. It is the production ResourceSource; tests exercise the SAME
// listing/decoding logic against an httptest.Server via HTTPClient, so the path
// is real I/O end to end (real HTTP request/response, real JSON decode).
type RESTResourceSource struct {
	server     string
	token      string
	namespaces []string
	kinds      []string
	client     *http.Client
}

// NewRESTResourceSource builds a RESTResourceSource. APIServer and at least one
// namespace are required. When Kinds is empty, DefaultK8sKinds is used.
func NewRESTResourceSource(cfg RESTConfig) (*RESTResourceSource, error) {
	if cfg.APIServer == "" {
		return nil, fmt.Errorf("%w: k8s api server is required", ErrInvalid)
	}
	if len(cfg.Namespaces) == 0 {
		return nil, fmt.Errorf("%w: at least one namespace is required", ErrInvalid)
	}
	kinds := cfg.Kinds
	if len(kinds) == 0 {
		kinds = append([]string(nil), DefaultK8sKinds...)
	}
	for _, k := range kinds {
		if _, ok := k8sKindPath[k]; !ok {
			return nil, fmt.Errorf("%w: unsupported k8s kind %q", ErrInvalid, k)
		}
	}

	client := cfg.HTTPClient
	if client == nil {
		tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
		if len(cfg.CACertPEM) > 0 {
			pool := x509.NewCertPool()
			if !pool.AppendCertsFromPEM(cfg.CACertPEM) {
				return nil, fmt.Errorf("%w: invalid k8s CA bundle", ErrInvalid)
			}
			tlsCfg.RootCAs = pool
		} else {
			tlsCfg.InsecureSkipVerify = cfg.InsecureSkipTLSVerify
		}
		timeout := cfg.Timeout
		if timeout <= 0 {
			timeout = 30 * time.Second
		}
		client = &http.Client{
			Timeout:   timeout,
			Transport: &http.Transport{TLSClientConfig: tlsCfg},
		}
	}

	return &RESTResourceSource{
		server:     strings.TrimRight(cfg.APIServer, "/"),
		token:      cfg.BearerToken,
		namespaces: append([]string(nil), cfg.Namespaces...),
		kinds:      kinds,
		client:     client,
	}, nil
}

// ListResources lists every in-scope (namespace, kind) over the K8s REST API and
// flattens the List responses into individual Resources. Each kind is fetched
// with a real GET; the JSON List is decoded and its items are returned with
// kind/namespace/name extracted. Ordering is deterministic for reproducibility.
func (s *RESTResourceSource) ListResources(ctx context.Context) ([]Resource, error) {
	namespaces := append([]string(nil), s.namespaces...)
	kinds := append([]string(nil), s.kinds...)
	sort.Strings(namespaces)
	sort.Strings(kinds)

	var out []Resource
	for _, ns := range namespaces {
		for _, kind := range kinds {
			items, err := s.listKind(ctx, ns, kind)
			if err != nil {
				return nil, err
			}
			out = append(out, items...)
		}
	}
	return out, nil
}

// k8sList is the minimal shape of a K8s "*List" response: a kind plus items.
type k8sList struct {
	Items []map[string]any `json:"items"`
}

func (s *RESTResourceSource) listKind(ctx context.Context, namespace, kind string) ([]Resource, error) {
	tmpl, ok := k8sKindPath[kind]
	if !ok {
		return nil, fmt.Errorf("%w: unsupported k8s kind %q", ErrInvalid, kind)
	}
	path := fmt.Sprintf(tmpl, url.PathEscape(namespace))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.server+path, nil)
	if err != nil {
		return nil, fmt.Errorf("vmcapture: build k8s request %s: %w", path, err)
	}
	req.Header.Set("Accept", "application/json")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("vmcapture: k8s list %s/%s: %w", kind, namespace, err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()
	if resp.StatusCode == http.StatusNotFound {
		// The kind is not served / namespace empty: not an error, just no items.
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("vmcapture: k8s list %s/%s: status %d: %s", kind, namespace, resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var list k8sList
	dec := json.NewDecoder(resp.Body)
	dec.UseNumber()
	if err := dec.Decode(&list); err != nil {
		return nil, fmt.Errorf("vmcapture: decode k8s %s list: %w", kind, err)
	}

	out := make([]Resource, 0, len(list.Items))
	for _, obj := range list.Items {
		// Stamp the kind on the item if the List omitted it (List items often
		// carry no apiVersion/kind), so normalization is self-describing.
		if _, ok := obj["kind"]; !ok {
			obj["kind"] = kind
		}
		name := ""
		if meta, ok := obj["metadata"].(map[string]any); ok {
			if n, ok := meta["name"].(string); ok {
				name = n
			}
		}
		out = append(out, Resource{Kind: kind, Namespace: namespace, Name: name, Object: obj})
	}
	return out, nil
}

// FixtureResourceSource is an in-memory ResourceSource for tests. It returns a
// fixed resource set, so the normalization, ordering, hashing and PVC linkage
// can be tested directly without a cluster while exercising the SAME
// ResourceSource contract the REST source satisfies.
type FixtureResourceSource struct {
	Resources []Resource
	Err       error
}

// ListResources returns the fixture's resources (a copy, so the capturer cannot
// mutate the fixture between passes).
func (f *FixtureResourceSource) ListResources(ctx context.Context) ([]Resource, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if f.Err != nil {
		return nil, f.Err
	}
	out := make([]Resource, len(f.Resources))
	for i, r := range f.Resources {
		out[i] = Resource{
			Kind:      r.Kind,
			Namespace: r.Namespace,
			Name:      r.Name,
			Object:    deepCopyMap(r.Object),
		}
	}
	return out, nil
}
