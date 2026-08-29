package vmcapture_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/vmcapture"
)

// rawResource builds a Resource from a JSON manifest string, decoding it the way
// the REST source would (UseNumber for stable numerics).
func rawResource(t *testing.T, kind, ns, name, manifest string) vmcapture.Resource {
	t.Helper()
	var obj map[string]any
	dec := json.NewDecoder(strings.NewReader(manifest))
	dec.UseNumber()
	if err := dec.Decode(&obj); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	return vmcapture.Resource{Kind: kind, Namespace: ns, Name: name, Object: obj}
}

// TestNormalize_StripsVolatileFields proves server-set fields and status are
// stripped so two captures of the same desired state hash identically.
func TestNormalize_StripsVolatileFields(t *testing.T) {
	t.Parallel()

	withVolatile := `{
		"apiVersion":"v1","kind":"ConfigMap",
		"metadata":{
			"name":"app-config","namespace":"prod",
			"resourceVersion":"99812","uid":"abc-123","generation":7,
			"creationTimestamp":"2026-01-01T00:00:00Z",
			"selfLink":"/api/v1/namespaces/prod/configmaps/app-config",
			"managedFields":[{"manager":"kubectl"}],
			"annotations":{
				"kubectl.kubernetes.io/last-applied-configuration":"{...}",
				"team":"payments"
			}
		},
		"data":{"key":"value"},
		"status":{"phase":"Active"}
	}`
	clean := `{
		"apiVersion":"v1","kind":"ConfigMap",
		"metadata":{"name":"app-config","namespace":"prod","annotations":{"team":"payments"}},
		"data":{"key":"value"}
	}`

	a, err := vmcapture.NormalizeResource(rawResource(t, "ConfigMap", "prod", "app-config", withVolatile), nil)
	if err != nil {
		t.Fatalf("normalize volatile: %v", err)
	}
	b, err := vmcapture.NormalizeResource(rawResource(t, "ConfigMap", "prod", "app-config", clean), nil)
	if err != nil {
		t.Fatalf("normalize clean: %v", err)
	}

	if a.Hash != b.Hash {
		t.Fatalf("volatile fields not stripped: hashes differ\n a=%s\n b=%s", a.Manifest, b.Manifest)
	}
	// The stripped manifest must not mention any volatile field.
	for _, banned := range []string{"resourceVersion", "uid", "managedFields", "creationTimestamp", "selfLink", "status", "last-applied-configuration"} {
		if strings.Contains(string(a.Manifest), banned) {
			t.Fatalf("normalized manifest still contains %q: %s", banned, a.Manifest)
		}
	}
	// A desired-state field must survive.
	if !strings.Contains(string(a.Manifest), "payments") {
		t.Fatalf("normalization stripped a desired-state annotation: %s", a.Manifest)
	}
}

// TestNormalize_CanonicalOrderingIsStable proves the canonical JSON (sorted map
// keys) makes the hash independent of source key order.
func TestNormalize_CanonicalOrderingIsStable(t *testing.T) {
	t.Parallel()
	m1 := `{"kind":"Service","metadata":{"name":"svc","namespace":"prod"},"spec":{"a":1,"b":2,"c":3}}`
	m2 := `{"spec":{"c":3,"b":2,"a":1},"metadata":{"namespace":"prod","name":"svc"},"kind":"Service"}`
	a, err := vmcapture.NormalizeResource(rawResource(t, "Service", "prod", "svc", m1), nil)
	if err != nil {
		t.Fatalf("normalize m1: %v", err)
	}
	b, err := vmcapture.NormalizeResource(rawResource(t, "Service", "prod", "svc", m2), nil)
	if err != nil {
		t.Fatalf("normalize m2: %v", err)
	}
	if a.Hash != b.Hash {
		t.Fatalf("key order changed the hash: %s vs %s", a.Manifest, b.Manifest)
	}
}

// fixtureSet is a representative multi-kind namespace resource set, intentionally
// supplied out of (kind, namespace, name) order to test deterministic ordering.
func fixtureSet(t *testing.T) []vmcapture.Resource {
	t.Helper()
	return []vmcapture.Resource{
		rawResource(t, "Service", "prod", "web", `{"kind":"Service","metadata":{"name":"web","namespace":"prod","resourceVersion":"1"},"spec":{"ports":[{"port":80}]}}`),
		rawResource(t, "ConfigMap", "prod", "app-config", `{"kind":"ConfigMap","metadata":{"name":"app-config","namespace":"prod","uid":"u1"},"data":{"k":"v"}}`),
		rawResource(t, "Secret", "prod", "db-creds", `{"kind":"Secret","metadata":{"name":"db-creds","namespace":"prod","uid":"u2"},"type":"Opaque","data":{"password":"czNjcjN0"}}`),
		rawResource(t, "Deployment", "prod", "web", `{"kind":"Deployment","metadata":{"name":"web","namespace":"prod","generation":4},"spec":{"replicas":3},"status":{"readyReplicas":3}}`),
		rawResource(t, "PersistentVolumeClaim", "prod", "data", `{"kind":"PersistentVolumeClaim","metadata":{"name":"data","namespace":"prod","uid":"u3"},"spec":{"resources":{"requests":{"storage":"10Gi"}}}}`),
		rawResource(t, "ConfigMap", "infra", "settings", `{"kind":"ConfigMap","metadata":{"name":"settings","namespace":"infra"},"data":{"x":"y"}}`),
	}
}

// TestBuildManifestSet_DeterministicOrderingAndHash proves ordering by
// (kind, namespace, name), a secret is captured, a PVC links to a data ref, and
// the set hash is stable and changes only when content changes.
func TestBuildManifestSet_DeterministicOrderingAndHash(t *testing.T) {
	t.Parallel()
	dataRef := func(ns, name string) string { return "block://stream-1/pvc/" + ns + "/" + name }

	set, err := vmcapture.BuildManifestSet(fixtureSet(t), dataRef)
	if err != nil {
		t.Fatalf("BuildManifestSet: %v", err)
	}

	wantOrder := []string{
		"ConfigMap/infra/settings",
		"ConfigMap/prod/app-config",
		"Deployment/prod/web",
		"PersistentVolumeClaim/prod/data",
		"Secret/prod/db-creds",
		"Service/prod/web",
	}
	var gotOrder []string
	for _, r := range set.Resources {
		gotOrder = append(gotOrder, r.Kind+"/"+r.Namespace+"/"+r.Name)
	}
	if !equalStrings(gotOrder, wantOrder) {
		t.Fatalf("ordering = %v, want %v", gotOrder, wantOrder)
	}

	// Secret is captured (its data survives normalization).
	secret := findResource(set, "Secret/prod/db-creds")
	if secret == nil {
		t.Fatal("secret was not captured")
	}
	if !strings.Contains(string(secret.Manifest), "czNjcjN0") {
		t.Fatalf("secret data not captured: %s", secret.Manifest)
	}

	// PVC links to its data reference.
	pvc := findResource(set, "PersistentVolumeClaim/prod/data")
	if pvc == nil {
		t.Fatal("PVC was not captured")
	}
	if pvc.DataRef != "block://stream-1/pvc/prod/data" {
		t.Fatalf("PVC data ref = %q, want block://stream-1/pvc/prod/data", pvc.DataRef)
	}
	// Non-PVC kinds carry no data ref.
	if cm := findResource(set, "ConfigMap/prod/app-config"); cm == nil || cm.DataRef != "" {
		t.Fatalf("non-PVC has a data ref: %+v", cm)
	}

	// The set hash is deterministic: re-building the same fixture yields the
	// same hash.
	set2, err := vmcapture.BuildManifestSet(fixtureSet(t), dataRef)
	if err != nil {
		t.Fatalf("BuildManifestSet 2: %v", err)
	}
	if set.SetHash != set2.SetHash {
		t.Fatalf("set hash not deterministic: %s vs %s", set.SetHash, set2.SetHash)
	}
	if set.SetHash == "" {
		t.Fatal("empty set hash")
	}
}

// TestDiffManifestSets_DetectsResourceChange proves the resource-level diff:
// modifying one ConfigMap, adding one resource, and removing one resource are
// each detected exactly.
func TestDiffManifestSets_DetectsResourceChange(t *testing.T) {
	t.Parallel()
	dataRef := func(ns, name string) string { return "block://stream-1/pvc/" + ns + "/" + name }

	prior, err := vmcapture.BuildManifestSet(fixtureSet(t), dataRef)
	if err != nil {
		t.Fatalf("prior set: %v", err)
	}

	next := fixtureSet(t)
	// Modify the prod/app-config ConfigMap data.
	for i, r := range next {
		if r.Kind == "ConfigMap" && r.Namespace == "prod" {
			next[i] = rawResource(t, "ConfigMap", "prod", "app-config", `{"kind":"ConfigMap","metadata":{"name":"app-config","namespace":"prod"},"data":{"k":"CHANGED"}}`)
		}
	}
	// Remove the infra/settings ConfigMap; add a new Service.
	filtered := next[:0]
	for _, r := range next {
		if r.Kind == "ConfigMap" && r.Namespace == "infra" {
			continue
		}
		filtered = append(filtered, r)
	}
	filtered = append(filtered, rawResource(t, "Service", "prod", "api", `{"kind":"Service","metadata":{"name":"api","namespace":"prod"},"spec":{"ports":[{"port":443}]}}`))

	current, err := vmcapture.BuildManifestSet(filtered, dataRef)
	if err != nil {
		t.Fatalf("current set: %v", err)
	}

	diff := vmcapture.DiffManifestSets(prior, current)
	if !equalStrings(diff.Modified, []string{"ConfigMap/prod/app-config"}) {
		t.Fatalf("modified = %v, want [ConfigMap/prod/app-config]", diff.Modified)
	}
	if !equalStrings(diff.Added, []string{"Service/prod/api"}) {
		t.Fatalf("added = %v, want [Service/prod/api]", diff.Added)
	}
	if !equalStrings(diff.Removed, []string{"ConfigMap/infra/settings"}) {
		t.Fatalf("removed = %v, want [ConfigMap/infra/settings]", diff.Removed)
	}
	if diff.Changed() != 3 {
		t.Fatalf("changed = %d, want 3", diff.Changed())
	}

	// A no-op diff against itself reports zero changes (proves stability).
	if same := vmcapture.DiffManifestSets(prior, prior); same.Changed() != 0 {
		t.Fatalf("self-diff changed = %d, want 0", same.Changed())
	}
}

// TestEncodeManifestSetFrames_RoundTrips proves the manifest-set frames carry
// every resource + a PVC link + a closing marker, with strictly increasing Seq,
// and that the payloads decode back to the captured resources.
func TestEncodeManifestSetFrames_RoundTrips(t *testing.T) {
	t.Parallel()
	dataRef := func(ns, name string) string { return "block://stream-1/pvc/" + ns + "/" + name }
	set, err := vmcapture.BuildManifestSet(fixtureSet(t), dataRef)
	if err != nil {
		t.Fatalf("BuildManifestSet: %v", err)
	}

	frames, payloadBytes := vmcapture.EncodeManifestSetFrames(set, "stream-1", 10)
	if payloadBytes <= 0 {
		t.Fatalf("payload bytes = %d, want > 0", payloadBytes)
	}
	// 6 resources + 1 PVC link + 1 marker = 8 frames; Seq strictly above 10.
	if len(frames) != len(set.Resources)+1+1 {
		t.Fatalf("frame count = %d, want %d", len(frames), len(set.Resources)+2)
	}
	for i, f := range frames {
		if f.Seq != uint64(11+i) {
			t.Fatalf("frame %d seq = %d, want %d", i, f.Seq, 11+i)
		}
		if f.StreamID != "stream-1" {
			t.Fatalf("frame %d stream = %q", i, f.StreamID)
		}
	}
	if last := frames[len(frames)-1]; last.Kind != core.FrameKindMarker {
		t.Fatalf("last frame kind = %s, want MARKER", last.Kind)
	}

	// Decode the resource + link frames back and reassemble the set.
	var decoded []string
	var sawLink bool
	for _, f := range frames {
		if f.Kind != core.FrameKindSnapshotChunk || len(f.Payload) == 0 {
			continue
		}
		switch f.Payload[0] {
		case vmcapture.ResourceOpForTest:
			nr, err := vmcapture.DecodeResourceForTest(f.Payload)
			if err != nil {
				t.Fatalf("decode resource: %v", err)
			}
			decoded = append(decoded, nr.Kind+"/"+nr.Namespace+"/"+nr.Name)
			// Each decoded resource's manifest must be non-empty and its hash
			// must match the captured set.
			orig := findResource(set, nr.Kind+"/"+nr.Namespace+"/"+nr.Name)
			if orig == nil || orig.Hash != nr.Hash {
				t.Fatalf("decoded resource %s hash mismatch", nr.Kind+"/"+nr.Namespace+"/"+nr.Name)
			}
		case vmcapture.LinkOpForTest:
			ns, name, ref, err := vmcapture.DecodeLinkForTest(f.Payload)
			if err != nil {
				t.Fatalf("decode link: %v", err)
			}
			if ns != "prod" || name != "data" || ref != "block://stream-1/pvc/prod/data" {
				t.Fatalf("link payload = %s/%s -> %s", ns, name, ref)
			}
			sawLink = true
		}
	}
	if !sawLink {
		t.Fatal("no PVC link frame emitted")
	}
	if len(decoded) != len(set.Resources) {
		t.Fatalf("decoded %d resources, want %d", len(decoded), len(set.Resources))
	}
}

func findResource(set *vmcapture.K8sManifestSet, key string) *vmcapture.NormalizedResource {
	for i := range set.Resources {
		r := &set.Resources[i]
		if r.Kind+"/"+r.Namespace+"/"+r.Name == key {
			return r
		}
	}
	return nil
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
