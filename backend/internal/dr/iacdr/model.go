// Package iacdr implements ClarioDR capability #16 — INFRASTRUCTURE-AS-CODE DR
// (DESIGN_DataStream_DR.md §6 recovery executor, §11 SLO metrics). Disaster
// recovery is not only about DATA: to TRULY recover an estate you must
// RECONSTITUTE its INFRASTRUCTURE. This package captures and VERSIONS the
// protected estate's Infrastructure-as-Code so a recovery can rebuild it.
//
// It does four real things, each a pure, unit-tested engine over fixtures:
//
//  1. INGEST behind a narrow Parser interface with REAL concrete parsers:
//     - a Terraform STATE parser: terraform.tfstate is JSON, so resources,
//     their provider/type/name, attributes and depends_on/references are
//     extracted with stdlib encoding/json (parser_terraform.go);
//     - a Kubernetes/Helm MANIFEST parser: YAML/JSON manifests plus Helm
//     release data, which a Helm secret stores as base64+gzip+JSON, decoded
//     for real (parser_k8s.go, parser_helm.go).
//  2. VERSION captured snapshots (dr_iac_snapshot, dr_iac_resource) with a
//     deterministic content hash per snapshot AND per resource (this file).
//  3. A real DRIFT DIFF engine comparing two snapshots: resources added /
//     removed / changed (attribute-level), keyed on (provider,type,name)
//     (diff.go).
//  4. A real RECONSTITUTION PLAN: a dependency graph built from depends_on /
//     references, topologically ordered into apply WAVES with cycle rejection,
//     so infra is rebuilt in the right order (plan.go).
//
// It also implements internal/datastream/core.Capturer (capturer.go) so a
// captured estate snapshot can be shipped as SNAPSHOT_CHUNK frames the EXISTING
// ingest/apply pipeline can persist alongside the data streams.
//
// Disjoint ownership: this package defines its OWN model types, its OWN store
// over repository.DBTX (raw queries; it does NOT edit the shared repository),
// its OWN chi.Router, its OWN parsers/diff/plan engines, and its OWN migration
// pair (000023). It reuses the repository.DBTX execution-context pattern, the
// platform transaction helpers, internal/datastream/core for the Capturer
// interface, and internal/events + outbox for lifecycle events on the existing
// datastream.dr.events topic.
package iacdr

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the router.
var (
	// ErrSnapshotNotFound is returned when a snapshot is absent.
	ErrSnapshotNotFound = errors.New("iac snapshot not found")
	// ErrUnsupportedKind is returned when an ingest names an unknown source kind.
	ErrUnsupportedKind = errors.New("unsupported iac source kind")
	// ErrEmptyArtifact is returned when an ingest artifact yields no resources.
	ErrEmptyArtifact = errors.New("iac artifact contains no resources")
	// ErrParse is returned when an artifact cannot be parsed.
	ErrParse = errors.New("iac artifact parse error")
	// ErrCycle is returned by the reconstitution planner when the resource
	// dependency graph contains a cycle, so no apply order exists. The router maps
	// it to HTTP 409.
	ErrCycle = errors.New("iac dependency graph contains a cycle")
	// ErrInvalidRequest is returned for a malformed ingest request (missing name,
	// missing artifact, ...).
	ErrInvalidRequest = errors.New("invalid iac ingest request")
)

// Source kinds — the supported IaC artifact formats.
const (
	// SourceTerraformState is a terraform.tfstate JSON file.
	SourceTerraformState = "terraform_state"
	// SourceK8sManifest is a set of Kubernetes/Helm-rendered YAML/JSON manifests.
	SourceK8sManifest = "k8s_manifest"
	// SourceHelmRelease is a Helm release secret payload (base64+gzip+JSON).
	SourceHelmRelease = "helm_release"
)

// ValidSourceKind reports whether k is a recognised IaC source kind.
func ValidSourceKind(k string) bool {
	switch k {
	case SourceTerraformState, SourceK8sManifest, SourceHelmRelease:
		return true
	default:
		return false
	}
}

// Resource is one captured IaC resource — a VERTEX of the reconstitution graph.
// It is the unit of drift comparison (keyed on provider/type/name) and the unit
// the reconstitution planner topologically orders.
type Resource struct {
	ID         string `json:"id,omitempty"`
	TenantID   string `json:"tenant_id,omitempty"`
	SnapshotID string `json:"snapshot_id,omitempty"`
	// Provider is the managing provider/plugin ("aws", "kubernetes", "helm", ...).
	Provider string `json:"provider"`
	// Type is the resource type ("aws_vpc", "Deployment", ...).
	Type string `json:"type"`
	// Name is the local resource name/identifier within the estate.
	Name string `json:"name"`
	// Address is a stable canonical address ("aws_vpc.main",
	// "apps/v1/Deployment/web") used in human-facing diffs and as a depends_on
	// reference target.
	Address string `json:"address"`
	// Attributes is the normalised attribute set — the unit of attribute-level
	// drift comparison (provider meta/timestamps stripped during normalisation).
	Attributes map[string]any `json:"attributes"`
	// DependsOn lists the resource addresses this resource depends on. The
	// reconstitution planner topologically orders the apply over these edges.
	DependsOn []string `json:"depends_on"`
	// Hash is the SHA-256 (hex) of the resource's canonical form; an attribute or
	// dependency change flips it so the diff engine is exact.
	Hash      string    `json:"hash"`
	CreatedAt time.Time `json:"created_at,omitempty"`
}

// Key is the drift-diff identity of a resource: (provider, type, name).
func (r Resource) Key() ResourceKey {
	return ResourceKey{Provider: r.Provider, Type: r.Type, Name: r.Name}
}

// ResourceKey is the stable cross-snapshot identity of a resource.
type ResourceKey struct {
	Provider string `json:"provider"`
	Type     string `json:"type"`
	Name     string `json:"name"`
}

// String renders the key as "provider/type/name" for stable map ordering and
// human-facing diff output.
func (k ResourceKey) String() string {
	return k.Provider + "/" + k.Type + "/" + k.Name
}

// ComputeHash returns the canonical SHA-256 (hex) of the resource. It is
// deterministic and order-independent: attribute maps are serialised with sorted
// keys (canonicalJSON) and the dependency list is sorted, so two ingests of a
// byte-identical resource hash equal regardless of input ordering. Mutating any
// attribute value, key, provider/type/name or dependency changes the hash.
func (r Resource) ComputeHash() string {
	depsCopy := append([]string(nil), r.DependsOn...)
	sort.Strings(depsCopy)
	canonical := struct {
		Provider   string   `json:"provider"`
		Type       string   `json:"type"`
		Name       string   `json:"name"`
		Attributes string   `json:"attributes"`
		DependsOn  []string `json:"depends_on"`
	}{
		Provider:   r.Provider,
		Type:       r.Type,
		Name:       r.Name,
		Attributes: canonicalJSON(r.Attributes),
		DependsOn:  depsCopy,
	}
	// The struct field order is fixed and the attributes are already a canonical
	// string, so a plain json.Marshal here is itself canonical.
	b, _ := json.Marshal(canonical)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// Snapshot is an immutable, content-hashed VERSION of an estate's IaC at a point
// in time, with the resources it captured.
type Snapshot struct {
	ID            string            `json:"id"`
	TenantID      string            `json:"tenant_id"`
	GroupID       *string           `json:"group_id,omitempty"`
	Name          string            `json:"name"`
	SourceKind    string            `json:"source_kind"`
	Version       int               `json:"version"`
	ContentHash   string            `json:"content_hash"`
	ResourceCount int               `json:"resource_count"`
	Metadata      map[string]string `json:"metadata,omitempty"`
	CreatedAt     time.Time         `json:"created_at"`
	Resources     []Resource        `json:"resources,omitempty"`
}

// ComputeContentHash returns the snapshot's content hash: the SHA-256 (hex) over
// the SORTED list of per-resource hashes. It is therefore independent of the
// order resources were parsed in — two captures of a byte-identical estate hash
// equal — yet flips if any resource is added, removed or changed.
func ComputeContentHash(resources []Resource) string {
	hashes := make([]string, len(resources))
	for i, r := range resources {
		h := r.Hash
		if h == "" {
			h = r.ComputeHash()
		}
		hashes[i] = h
	}
	sort.Strings(hashes)
	hasher := sha256.New()
	for _, h := range hashes {
		// length-prefix each hash so concatenation is unambiguous.
		fmt.Fprintf(hasher, "%d:%s", len(h), h)
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

// ParseResult is what a Parser returns: the captured resources plus
// artifact-level provenance metadata. The snapshot's content hash is derived
// from the resources, not stored here.
type ParseResult struct {
	// SourceKind identifies which parser produced this result.
	SourceKind string
	// Resources are the captured resources, each with its Hash already computed.
	Resources []Resource
	// Metadata is artifact-level provenance (terraform version, lineage, chart
	// name/version, cluster, ...).
	Metadata map[string]string
}

// Parser is the narrow ingest-boundary interface. Each concrete parser turns a
// raw IaC artifact (bytes) into normalised resources. External systems (a live
// Terraform backend, a K8s API server) sit BEHIND this interface; the concrete
// parsers here operate on the artifact bytes directly with REAL stdlib decoding
// (encoding/json, encoding/base64, compress/gzip, gopkg.in/yaml.v3) and are
// exercised by unit tests with real fixtures.
type Parser interface {
	// Kind is the source kind this parser handles.
	Kind() string
	// Parse decodes the artifact into normalised resources, computing each
	// resource's hash. It returns ErrParse (wrapped) on malformed input and
	// ErrEmptyArtifact when the artifact yields no resources.
	Parse(artifact []byte) (ParseResult, error)
}

// canonicalJSON serialises v with map keys recursively sorted so the output is a
// stable, deterministic string regardless of Go map iteration order. It is the
// foundation of order-independent resource hashing. nil and empty maps render as
// "{}" / "null" exactly as encoding/json would, but with sorted keys throughout.
func canonicalJSON(v any) string {
	var sb strings.Builder
	writeCanonical(&sb, v)
	return sb.String()
}

// writeCanonical recursively writes a canonical JSON encoding of v with sorted
// object keys. It handles the value shapes produced by encoding/json
// unmarshalling into any (map[string]any, []any, string, float64, bool, nil) as
// well as the json.Number form, so it is stable across both parse paths.
func writeCanonical(sb *strings.Builder, v any) {
	switch val := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		sb.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				sb.WriteByte(',')
			}
			kb, _ := json.Marshal(k)
			sb.Write(kb)
			sb.WriteByte(':')
			writeCanonical(sb, val[k])
		}
		sb.WriteByte('}')
	case []any:
		sb.WriteByte('[')
		for i, e := range val {
			if i > 0 {
				sb.WriteByte(',')
			}
			writeCanonical(sb, e)
		}
		sb.WriteByte(']')
	default:
		// Scalars (string/float64/bool/nil/json.Number) marshal canonically as-is.
		b, err := json.Marshal(val)
		if err != nil {
			sb.WriteString("null")
			return
		}
		sb.Write(b)
	}
}
