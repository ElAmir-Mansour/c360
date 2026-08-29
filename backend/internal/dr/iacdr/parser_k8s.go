package iacdr

import (
	"bytes"
	"fmt"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// K8sManifestParser parses a set of Kubernetes / Helm-rendered manifests. Input
// is one or more YAML documents (the standard `---`-separated multi-doc form) or
// a single JSON document; both are real, decoded with gopkg.in/yaml.v3 (already
// in go.mod), which also accepts JSON since JSON is a YAML subset. Each manifest
// becomes a Resource keyed on (apiGroup-as-provider, Kind-as-type,
// namespace/name). Dependency edges are derived from REAL Kubernetes ownership
// and reference signals: metadata.ownerReferences (the controller that must
// exist first) and the namespace a namespaced object lives in (the Namespace
// object must be applied before objects inside it).
type K8sManifestParser struct{}

// NewK8sManifestParser constructs a K8sManifestParser.
func NewK8sManifestParser() *K8sManifestParser { return &K8sManifestParser{} }

// Kind reports the source kind this parser handles.
func (*K8sManifestParser) Kind() string { return SourceK8sManifest }

// Parse decodes a manifest artifact into normalised resources.
func (p *K8sManifestParser) Parse(artifact []byte) (ParseResult, error) {
	if len(bytes.TrimSpace(artifact)) == 0 {
		return ParseResult{}, fmt.Errorf("k8s manifest is empty: %w", ErrEmptyArtifact)
	}
	docs, err := decodeYAMLDocuments(artifact)
	if err != nil {
		return ParseResult{}, err
	}

	resources, err := manifestsToResources(docs)
	if err != nil {
		return ParseResult{}, err
	}
	if len(resources) == 0 {
		return ParseResult{}, fmt.Errorf("k8s manifest has no objects: %w", ErrEmptyArtifact)
	}
	sort.Slice(resources, func(i, j int) bool { return resources[i].Address < resources[j].Address })

	return ParseResult{
		SourceKind: SourceK8sManifest,
		Resources:  resources,
		Metadata:   map[string]string{"format": "k8s_manifest", "object_count": fmt.Sprintf("%d", len(resources))},
	}, nil
}

// decodeYAMLDocuments splits a multi-document YAML stream and decodes each
// non-empty document into a map. JSON inputs decode through the same path (JSON
// is valid YAML). Empty documents (blank, comment-only, or a literal "null") are
// skipped rather than erroring, matching `kubectl apply -f`'s tolerance.
func decodeYAMLDocuments(artifact []byte) ([]map[string]any, error) {
	dec := yaml.NewDecoder(bytes.NewReader(artifact))
	var docs []map[string]any
	for {
		var raw any
		err := dec.Decode(&raw)
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return nil, fmt.Errorf("decoding k8s manifest yaml: %w: %v", ErrParse, err)
		}
		if raw == nil {
			continue
		}
		m, ok := toStringMap(raw)
		if !ok {
			return nil, fmt.Errorf("k8s manifest document is not a mapping: %w", ErrParse)
		}
		if len(m) == 0 {
			continue
		}
		docs = append(docs, m)
	}
	return docs, nil
}

// manifestsToResources turns decoded manifest maps into Resources, resolving
// dependency edges between them (ownerReferences + namespace containment). It is
// pure (no I/O) so it is unit-tested directly.
func manifestsToResources(docs []map[string]any) ([]Resource, error) {
	// First pass: build a resource per manifest and an index from (kind,
	// namespace, name) and from uid to its canonical address, so owner/namespace
	// edges can be resolved to addresses.
	type pending struct {
		res       Resource
		ownerRefs []ownerRef
		namespace string
		kind      string
		name      string
		uid       string
	}
	var items []pending
	addrByUID := make(map[string]string)
	addrByKindNsName := make(map[string]string)

	for _, doc := range docs {
		apiVersion, _ := doc["apiVersion"].(string)
		kind, _ := doc["kind"].(string)
		if kind == "" {
			return nil, fmt.Errorf("k8s object missing kind: %w", ErrParse)
		}
		meta, _ := toStringMap(doc["metadata"])
		name, _ := meta["name"].(string)
		namespace, _ := meta["namespace"].(string)
		uid, _ := meta["uid"].(string)

		group := apiGroup(apiVersion)
		address := manifestAddress(apiVersion, kind, namespace, name)

		// Attributes are the full object minus metadata churn (handled by
		// normalizeAttributes recursively).
		attrs := normalizeAttributes(doc)

		res := Resource{
			Provider:   k8sProvider(group),
			Type:       kind,
			Name:       k8sName(namespace, name),
			Address:    address,
			Attributes: attrs,
		}

		items = append(items, pending{
			res:       res,
			ownerRefs: parseOwnerRefs(meta),
			namespace: namespace,
			kind:      kind,
			name:      name,
			uid:       uid,
		})
		if uid != "" {
			addrByUID[uid] = address
		}
		addrByKindNsName[kindNsNameKey(kind, namespace, name)] = address
	}

	// Second pass: resolve dependency edges to addresses now that the index is
	// complete.
	out := make([]Resource, 0, len(items))
	for _, it := range items {
		depSet := make(map[string]struct{})
		// ownerReferences: the owning controller must exist before its child.
		for _, o := range it.ownerRefs {
			if addr, ok := addrByUID[o.UID]; ok && addr != it.res.Address {
				depSet[addr] = struct{}{}
				continue
			}
			// Fall back to (kind, namespace, name): owner lives in the same namespace.
			if addr, ok := addrByKindNsName[kindNsNameKey(o.Kind, it.namespace, o.Name)]; ok && addr != it.res.Address {
				depSet[addr] = struct{}{}
			}
		}
		// Namespace containment: a namespaced object depends on its Namespace object
		// being applied first, when that Namespace is present in the artifact.
		if it.namespace != "" {
			if addr, ok := addrByKindNsName[kindNsNameKey("Namespace", "", it.namespace)]; ok && addr != it.res.Address {
				depSet[addr] = struct{}{}
			}
		}
		deps := make([]string, 0, len(depSet))
		for d := range depSet {
			deps = append(deps, d)
		}
		sort.Strings(deps)
		it.res.DependsOn = deps
		it.res.Hash = it.res.ComputeHash()
		out = append(out, it.res)
	}
	return out, nil
}

// ownerRef is the slice of metadata.ownerReferences we use for edge resolution.
type ownerRef struct {
	Kind string
	Name string
	UID  string
}

// parseOwnerRefs extracts metadata.ownerReferences from a manifest's metadata map.
func parseOwnerRefs(meta map[string]any) []ownerRef {
	raw, ok := meta["ownerReferences"].([]any)
	if !ok {
		return nil
	}
	var refs []ownerRef
	for _, r := range raw {
		m, ok := toStringMap(r)
		if !ok {
			continue
		}
		kind, _ := m["kind"].(string)
		name, _ := m["name"].(string)
		uid, _ := m["uid"].(string)
		if kind == "" && name == "" && uid == "" {
			continue
		}
		refs = append(refs, ownerRef{Kind: kind, Name: name, UID: uid})
	}
	return refs
}

// apiGroup extracts the API group from an apiVersion ("apps/v1" -> "apps",
// "v1" -> "" core group, "networking.k8s.io/v1" -> "networking.k8s.io").
func apiGroup(apiVersion string) string {
	if idx := strings.Index(apiVersion, "/"); idx >= 0 {
		return apiVersion[:idx]
	}
	return ""
}

// k8sProvider maps an API group to the resource provider label. The core group
// (empty) is reported as "kubernetes" so it is non-empty and stable.
func k8sProvider(group string) string {
	if group == "" {
		return "kubernetes"
	}
	return group
}

// k8sName builds the local resource name as "namespace/name" for namespaced
// objects, or just "name" for cluster-scoped objects.
func k8sName(namespace, name string) string {
	if namespace == "" {
		return name
	}
	return namespace + "/" + name
}

// manifestAddress builds a stable canonical address for a manifest:
// "apps/v1/Deployment/web/api" (apiVersion/kind/namespace/name) or
// "v1/Namespace/web" for cluster-scoped objects.
func manifestAddress(apiVersion, kind, namespace, name string) string {
	parts := []string{apiVersion, kind}
	if namespace != "" {
		parts = append(parts, namespace)
	}
	parts = append(parts, name)
	return strings.Join(parts, "/")
}

// kindNsNameKey is the dependency-resolution index key.
func kindNsNameKey(kind, namespace, name string) string {
	return kind + "|" + namespace + "|" + name
}

// toStringMap coerces a yaml.v3-decoded value into a map[string]any. yaml.v3
// decodes mappings into map[string]any when the target is `any`, but nested maps
// from some inputs can be map[any]any; this normalises both, recursively, so the
// rest of the parser deals with map[string]any uniformly.
func toStringMap(v any) (map[string]any, bool) {
	switch m := v.(type) {
	case map[string]any:
		return coerceMap(m), true
	case map[any]any:
		out := make(map[string]any, len(m))
		for k, vv := range m {
			out[fmt.Sprintf("%v", k)] = coerceValue(vv)
		}
		return out, true
	default:
		return nil, false
	}
}

func coerceMap(m map[string]any) map[string]any {
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[k] = coerceValue(v)
	}
	return out
}

// coerceValue recursively converts map[any]any to map[string]any throughout a
// decoded YAML value so the structure is stable for the canonical hash.
func coerceValue(v any) any {
	switch val := v.(type) {
	case map[any]any:
		out := make(map[string]any, len(val))
		for k, vv := range val {
			out[fmt.Sprintf("%v", k)] = coerceValue(vv)
		}
		return out
	case map[string]any:
		return coerceMap(val)
	case []any:
		out := make([]any, len(val))
		for i, e := range val {
			out[i] = coerceValue(e)
		}
		return out
	default:
		return val
	}
}
