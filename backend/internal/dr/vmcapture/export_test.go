package vmcapture

import "github.com/clario360/platform/internal/datastream/core"

// BlockIndicesForTest exposes the unexported block-index decoder to external
// (_test) package tests so they can assert exactly which disk blocks a CBT pass
// emitted, by decoding the real frame payloads (not a mock).
func BlockIndicesForTest(frames []core.Frame) ([]int, error) {
	return blockIndicesOf(frames)
}

// DecodeResourceForTest exposes the unexported manifest-resource decoder so
// external tests can verify the K8s frame payloads round-trip (kind, namespace,
// name, hash, data ref, manifest bytes).
func DecodeResourceForTest(payload []byte) (NormalizedResource, error) {
	return decodeResource(payload)
}

// DecodeLinkForTest exposes the unexported PVC link decoder so external tests
// can assert the PVC -> data-reference linkage frames.
func DecodeLinkForTest(payload []byte) (namespace, name, dataRef string, err error) {
	return decodeLink(payload)
}

// ResourceOpForTest / LinkOpForTest expose the payload op bytes so external
// tests can classify frames without duplicating the constants.
const (
	ResourceOpForTest = k8sOpResource
	LinkOpForTest     = k8sOpLink
)
