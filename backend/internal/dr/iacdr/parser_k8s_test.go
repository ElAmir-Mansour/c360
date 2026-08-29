package iacdr

import (
	"errors"
	"testing"
)

// realK8sManifest is a REAL multi-document Kubernetes manifest: a Namespace, a
// Deployment owned (via ownerReferences) by nothing but living in the namespace,
// and a ReplicaSet owned by the Deployment. The parser must derive:
//   - the Deployment depends on the Namespace (containment),
//   - the ReplicaSet depends on the Deployment (ownerReference) and the Namespace.
const realK8sManifest = `
apiVersion: v1
kind: Namespace
metadata:
  name: web
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: web
  uid: dep-uid-1
  resourceVersion: "12345"
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: api
          image: api:1.0
---
apiVersion: apps/v1
kind: ReplicaSet
metadata:
  name: api-abc
  namespace: web
  uid: rs-uid-1
  ownerReferences:
    - apiVersion: apps/v1
      kind: Deployment
      name: api
      uid: dep-uid-1
spec:
  replicas: 3
`

func TestK8sManifestParser_RealManifest(t *testing.T) {
	res, err := NewK8sManifestParser().Parse([]byte(realK8sManifest))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if res.SourceKind != SourceK8sManifest {
		t.Fatalf("SourceKind = %q", res.SourceKind)
	}
	if len(res.Resources) != 3 {
		t.Fatalf("resource count = %d, want 3: %v", len(res.Resources), addresses(res.Resources))
	}

	byAddr := map[string]Resource{}
	for _, r := range res.Resources {
		byAddr[r.Address] = r
	}

	ns, ok := byAddr["v1/Namespace/web"]
	if !ok {
		t.Fatalf("namespace missing; got %v", addresses(res.Resources))
	}
	if ns.Provider != "kubernetes" || ns.Type != "Namespace" {
		t.Errorf("ns provider/type = %q/%q", ns.Provider, ns.Type)
	}
	if len(ns.DependsOn) != 0 {
		t.Errorf("ns deps = %v, want none", ns.DependsOn)
	}

	dep := byAddr["apps/v1/Deployment/web/api"]
	if dep.Provider != "apps" {
		t.Errorf("deployment provider = %q, want apps", dep.Provider)
	}
	// Deployment depends on the namespace (containment).
	if !contains(dep.DependsOn, "v1/Namespace/web") {
		t.Errorf("deployment deps = %v, want to include namespace", dep.DependsOn)
	}
	// resourceVersion (volatile) must be stripped from attributes.
	if meta, _ := dep.Attributes["metadata"].(map[string]any); meta != nil {
		if _, present := meta["resourceVersion"]; present {
			t.Errorf("deployment metadata still has volatile resourceVersion")
		}
	}

	rs := byAddr["apps/v1/ReplicaSet/web/api-abc"]
	// ReplicaSet depends on the Deployment (ownerReference by UID) and the namespace.
	if !contains(rs.DependsOn, "apps/v1/Deployment/web/api") {
		t.Errorf("replicaset deps = %v, want owner Deployment", rs.DependsOn)
	}
	if !contains(rs.DependsOn, "v1/Namespace/web") {
		t.Errorf("replicaset deps = %v, want namespace", rs.DependsOn)
	}
}

func TestK8sManifestParser_JSONInput(t *testing.T) {
	// JSON is valid YAML — the parser accepts a single JSON manifest too.
	const jsonManifest = `{"apiVersion":"v1","kind":"ConfigMap","metadata":{"name":"cfg","namespace":"web"},"data":{"k":"v"}}`
	res, err := NewK8sManifestParser().Parse([]byte(jsonManifest))
	if err != nil {
		t.Fatalf("Parse JSON: %v", err)
	}
	if len(res.Resources) != 1 {
		t.Fatalf("count = %d, want 1", len(res.Resources))
	}
	if res.Resources[0].Type != "ConfigMap" {
		t.Errorf("type = %q", res.Resources[0].Type)
	}
}

func TestK8sManifestParser_Errors(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr error
	}{
		{"empty", "   \n  ", ErrEmptyArtifact},
		{"only comments", "# just a comment\n---\n# another", ErrEmptyArtifact},
		{"missing kind", "apiVersion: v1\nmetadata:\n  name: x", ErrParse},
		{"not a mapping", "- a\n- b\n- c", ErrParse},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewK8sManifestParser().Parse([]byte(tt.input))
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func contains(s []string, v string) bool {
	for _, e := range s {
		if e == v {
			return true
		}
	}
	return false
}
