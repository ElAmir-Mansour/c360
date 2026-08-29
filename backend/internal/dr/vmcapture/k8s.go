package vmcapture

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/clario360/platform/internal/datastream/core"
)

// k8s manifest-set payload ops, carried under FrameKindSnapshotChunk. Each
// resource ships as one op-prefixed, self-describing frame payload; the set is
// closed by a trailing MARKER frame pinning the manifest-set content hash.
const (
	k8sOpResource uint8 = 1 // a single normalized resource manifest
	k8sOpLink     uint8 = 2 // a PVC -> data-reference linkage record
)

// volatileMetaFields are the server-set metadata fields stripped during
// normalization so two captures of the same logical resource hash identically
// regardless of cluster-assigned bookkeeping. This is the heart of the
// normalization: a recovery must restore DESIRED state, not the source
// cluster's runtime identity.
var volatileMetaFields = []string{
	"resourceVersion",
	"uid",
	"selfLink",
	"generation",
	"creationTimestamp",
	"managedFields",
	"ownerReferences",
	"finalizers",
	"deletionTimestamp",
	"deletionGracePeriodSeconds",
}

// volatileAnnotations are controller/tooling annotations stripped during
// normalization (last-applied configuration, revision counters) that change on
// every apply without changing desired state.
var volatileAnnotations = []string{
	"kubectl.kubernetes.io/last-applied-configuration",
	"deployment.kubernetes.io/revision",
}

// Resource is one raw cluster object as returned by a ResourceSource, before
// normalization. Object is the decoded JSON manifest.
type Resource struct {
	Kind      string
	Namespace string
	Name      string
	Object    map[string]any
}

// NormalizedResource is a resource after stripping server-set fields and status,
// with its canonical JSON bytes and per-resource content hash computed.
type NormalizedResource struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
	// Manifest is the canonical (deterministically-keyed) JSON of the stripped
	// object. encoding/json marshals maps with sorted keys, so identical desired
	// state always produces identical bytes.
	Manifest []byte `json:"-"`
	// Hash is the hex SHA-256 of Manifest — the per-resource change detector.
	Hash string `json:"hash"`
	// DataRef is set for PVCs: the block-path data reference (stream/source) the
	// PV's bytes are captured under, so volume DATA is replicated via the VM/
	// file block path while the PVC MANIFEST is captured here.
	DataRef string `json:"data_ref,omitempty"`
}

// ResourceSource yields the live resource set of a K8s workload. External
// clusters are NOT available in the test environment, so the capturer is
// written against this interface and exercised with an in-memory / httptest
// fixture source doing the SAME normalization the REST source feeds. The real
// implementation (RESTResourceSource) talks to the K8s API over net/http with a
// bearer token + CA; tests use FixtureResourceSource or a httptest server.
type ResourceSource interface {
	// ListResources returns every in-scope resource for the workload. The
	// capturer normalizes and orders them deterministically, so the source need
	// not pre-sort.
	ListResources(ctx context.Context) ([]Resource, error)
}

// K8sManifestSet is the deterministic, normalized output of a K8s capture:
// resources ordered by (kind, namespace, name), each with its canonical
// manifest and hash, plus a stable set-level content hash.
type K8sManifestSet struct {
	// Resources are normalized and ordered by (kind, namespace, name).
	Resources []NormalizedResource `json:"resources"`
	// SetHash is the deterministic SHA-256 over the ordered per-resource hashes
	// — identical desired state across two captures yields the same SetHash.
	SetHash string `json:"set_hash"`
}

// NormalizeResource strips server-set fields and status from a raw resource and
// computes its canonical manifest bytes + hash. It is a pure function over the
// decoded object so it is directly unit-testable with fixtures. dataRefFn, when
// non-nil, supplies the block-path data reference for a PersistentVolumeClaim so
// the PVC's volume DATA is captured via the block path while its MANIFEST is
// captured here.
func NormalizeResource(r Resource, dataRefFn func(namespace, name string) string) (NormalizedResource, error) {
	if r.Object == nil {
		return NormalizedResource{}, fmt.Errorf("%w: resource %s/%s has no object", ErrInvalid, r.Namespace, r.Name)
	}
	// Deep-copy so we never mutate the caller's object.
	obj := deepCopyMap(r.Object)

	// Strip top-level status entirely: it is observed, not desired, state.
	delete(obj, "status")

	// Strip server-set metadata fields and volatile annotations.
	if meta, ok := obj["metadata"].(map[string]any); ok {
		for _, f := range volatileMetaFields {
			delete(meta, f)
		}
		if ann, ok := meta["annotations"].(map[string]any); ok {
			for _, a := range volatileAnnotations {
				delete(ann, a)
			}
			if len(ann) == 0 {
				delete(meta, "annotations")
			}
		}
		// namespace/name are carried on the row; keep them in metadata too so
		// the restored manifest is self-describing, but a missing one is filled.
		if _, ok := meta["name"]; !ok && r.Name != "" {
			meta["name"] = r.Name
		}
	}

	kind, _ := obj["kind"].(string)
	if kind == "" {
		kind = r.Kind
		if kind != "" {
			obj["kind"] = kind
		}
	}

	nr := NormalizedResource{
		Kind:      firstNonEmpty(kind, r.Kind),
		Namespace: r.Namespace,
		Name:      r.Name,
	}

	// PVC -> data reference linkage: the PVC manifest is captured here; its
	// bound PV's bytes are captured via the block path under a derived stream.
	if strings.EqualFold(nr.Kind, "PersistentVolumeClaim") && dataRefFn != nil {
		nr.DataRef = dataRefFn(nr.Namespace, nr.Name)
	}

	// Canonical JSON: encoding/json sorts map keys, so equal desired state
	// always serializes to equal bytes.
	manifest, err := json.Marshal(obj)
	if err != nil {
		return NormalizedResource{}, fmt.Errorf("vmcapture: marshal normalized %s/%s: %w", nr.Namespace, nr.Name, err)
	}
	nr.Manifest = manifest
	sum := sha256.Sum256(manifest)
	nr.Hash = hex.EncodeToString(sum[:])
	return nr, nil
}

// BuildManifestSet normalizes and deterministically orders a raw resource set,
// then computes the set-level content hash. The ordering key is
// (kind, namespace, name); the set hash folds in DataRef so a PVC's data-ref
// linkage is part of the captured identity.
func BuildManifestSet(resources []Resource, dataRefFn func(namespace, name string) string) (*K8sManifestSet, error) {
	out := &K8sManifestSet{Resources: make([]NormalizedResource, 0, len(resources))}
	for _, r := range resources {
		nr, err := NormalizeResource(r, dataRefFn)
		if err != nil {
			return nil, err
		}
		out.Resources = append(out.Resources, nr)
	}
	sort.SliceStable(out.Resources, func(i, j int) bool {
		a, b := out.Resources[i], out.Resources[j]
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		if a.Namespace != b.Namespace {
			return a.Namespace < b.Namespace
		}
		return a.Name < b.Name
	})

	h := sha256.New()
	for _, nr := range out.Resources {
		h.Write([]byte(nr.Kind))
		h.Write([]byte{0})
		h.Write([]byte(nr.Namespace))
		h.Write([]byte{0})
		h.Write([]byte(nr.Name))
		h.Write([]byte{0})
		h.Write([]byte(nr.Hash))
		h.Write([]byte{0})
		h.Write([]byte(nr.DataRef))
		h.Write([]byte{'\n'})
	}
	out.SetHash = hex.EncodeToString(h.Sum(nil))
	return out, nil
}

// DiffManifestSets reports the resources that changed between a prior and a
// current manifest set, keyed by (kind, namespace, name): added, removed and
// modified (hash differs). It is the K8s analogue of the VM changed-block diff.
type ManifestDiff struct {
	Added    []string // "kind/namespace/name"
	Removed  []string
	Modified []string
}

// Changed reports the total number of changed resources.
func (d ManifestDiff) Changed() int { return len(d.Added) + len(d.Removed) + len(d.Modified) }

// DiffManifestSets computes the change set between prior and current.
func DiffManifestSets(prior, current *K8sManifestSet) ManifestDiff {
	priorByKey := map[string]string{}
	if prior != nil {
		for _, nr := range prior.Resources {
			priorByKey[resourceKey(nr)] = nr.Hash
		}
	}
	curByKey := map[string]struct{}{}
	var d ManifestDiff
	if current != nil {
		for _, nr := range current.Resources {
			key := resourceKey(nr)
			curByKey[key] = struct{}{}
			ph, ok := priorByKey[key]
			switch {
			case !ok:
				d.Added = append(d.Added, key)
			case ph != nr.Hash:
				d.Modified = append(d.Modified, key)
			}
		}
	}
	for key := range priorByKey {
		if _, ok := curByKey[key]; !ok {
			d.Removed = append(d.Removed, key)
		}
	}
	sort.Strings(d.Added)
	sort.Strings(d.Removed)
	sort.Strings(d.Modified)
	return d
}

func resourceKey(nr NormalizedResource) string {
	return nr.Kind + "/" + nr.Namespace + "/" + nr.Name
}

// Headers projects a manifest set to its manifest-less per-resource headers, in
// the same deterministic order, for durable storage as the prior set of the
// next pass's resource-level diff.
func (s *K8sManifestSet) Headers() []ResourceHeader {
	if s == nil {
		return nil
	}
	out := make([]ResourceHeader, len(s.Resources))
	for i, nr := range s.Resources {
		out[i] = ResourceHeader{
			Kind:      nr.Kind,
			Namespace: nr.Namespace,
			Name:      nr.Name,
			Hash:      nr.Hash,
			DataRef:   nr.DataRef,
		}
	}
	return out
}

// ManifestSetFromHeaders rebuilds a (manifest-less) manifest set from stored
// headers so it can be diffed against a freshly-captured set. Only the diff-
// relevant fields (key + hash) are populated; Manifest bytes are absent because
// the prior pass's bytes are already durable in the pipeline.
func ManifestSetFromHeaders(headers []ResourceHeader, setHash string) *K8sManifestSet {
	set := &K8sManifestSet{SetHash: setHash, Resources: make([]NormalizedResource, len(headers))}
	for i, h := range headers {
		set.Resources[i] = NormalizedResource{
			Kind:      h.Kind,
			Namespace: h.Namespace,
			Name:      h.Name,
			Hash:      h.Hash,
			DataRef:   h.DataRef,
		}
	}
	return set
}

// EncodeManifestSetFrames turns a normalized manifest set into the ordered
// FrameKindSnapshotChunk frames the replication pipeline ships, closed by a
// FrameKindMarker pinning the set hash. Seq is assigned strictly above
// resumeFrom. Each resource is one frame; PVCs additionally emit a link frame
// recording the data-ref so the recovery path knows where the volume bytes are.
func EncodeManifestSetFrames(set *K8sManifestSet, streamID string, resumeFrom uint64) ([]core.Frame, int64) {
	var frames []core.Frame
	var payloadBytes int64
	seq := resumeFrom
	emit := func(kind core.FrameKind, payload []byte, lsn string) {
		seq++
		frames = append(frames, core.Frame{
			StreamID:  streamID,
			Seq:       seq,
			Kind:      kind,
			Payload:   payload,
			SourceLSN: lsn,
		})
		payloadBytes += int64(len(payload))
	}
	for _, nr := range set.Resources {
		emit(core.FrameKindSnapshotChunk, encodeResource(nr), "res:"+resourceKey(nr))
		if nr.DataRef != "" {
			emit(core.FrameKindSnapshotChunk, encodeLink(nr.Namespace, nr.Name, nr.DataRef), "link:"+nr.Namespace+"/"+nr.Name)
		}
	}
	emit(core.FrameKindMarker, nil, "k8s-set:"+set.SetHash)
	return frames, payloadBytes
}

// --- manifest-set payload codec --------------------------------------------

func encodeResource(nr NormalizedResource) []byte {
	b := []byte{k8sOpResource}
	b = putString(b, nr.Kind)
	b = putString(b, nr.Namespace)
	b = putString(b, nr.Name)
	b = putString(b, nr.Hash)
	b = putString(b, nr.DataRef)
	b = putBytes(b, nr.Manifest)
	return b
}

// decodeResource parses a k8sOpResource payload (used by tests and the recovery
// path to reconstruct a manifest set from shipped frames).
func decodeResource(payload []byte) (NormalizedResource, error) {
	if len(payload) == 0 || payload[0] != k8sOpResource {
		return NormalizedResource{}, errors.New("vmcapture: not a resource payload")
	}
	b := payload[1:]
	var nr NormalizedResource
	var err error
	if nr.Kind, b, err = getString(b); err != nil {
		return NormalizedResource{}, err
	}
	if nr.Namespace, b, err = getString(b); err != nil {
		return NormalizedResource{}, err
	}
	if nr.Name, b, err = getString(b); err != nil {
		return NormalizedResource{}, err
	}
	if nr.Hash, b, err = getString(b); err != nil {
		return NormalizedResource{}, err
	}
	if nr.DataRef, b, err = getString(b); err != nil {
		return NormalizedResource{}, err
	}
	if nr.Manifest, _, err = getBytes(b); err != nil {
		return NormalizedResource{}, err
	}
	return nr, nil
}

func encodeLink(namespace, name, dataRef string) []byte {
	b := []byte{k8sOpLink}
	b = putString(b, namespace)
	b = putString(b, name)
	b = putString(b, dataRef)
	return b
}

func decodeLink(payload []byte) (namespace, name, dataRef string, err error) {
	if len(payload) == 0 || payload[0] != k8sOpLink {
		return "", "", "", errors.New("vmcapture: not a link payload")
	}
	b := payload[1:]
	if namespace, b, err = getString(b); err != nil {
		return
	}
	if name, b, err = getString(b); err != nil {
		return
	}
	dataRef, _, err = getString(b)
	return
}

// --- helpers ----------------------------------------------------------------

func deepCopyMap(in map[string]any) map[string]any {
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = deepCopyValue(v)
	}
	return out
}

func deepCopyValue(v any) any {
	switch t := v.(type) {
	case map[string]any:
		return deepCopyMap(t)
	case []any:
		cp := make([]any, len(t))
		for i := range t {
			cp[i] = deepCopyValue(t[i])
		}
		return cp
	default:
		return v
	}
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
