package iacdr

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strings"
)

// HelmReleaseParser parses a Helm v3 release payload. Helm stores a release in a
// Kubernetes Secret (type helm.sh/release.v1) whose `data.release` value is the
// release object gzip-compressed, JSON-encoded, then base64-encoded — and Helm
// base64-encodes a SECOND time before storing it in the Secret's data map (which
// the Kubernetes API base64-encodes once more on the wire). This parser performs
// the REAL decode chain: base64-decode (repeatedly, tolerating one or two
// layers) -> gunzip -> JSON-unmarshal -> walk the release.
//
// The decoded release object carries the rendered manifest (`manifest`: a
// multi-document YAML string of the chart's Kubernetes objects) plus chart and
// release metadata. We parse the embedded manifest with the same real
// K8sManifestParser so a Helm release versions into the same normalised resource
// shape as a raw manifest set, and we attach the chart name/version/release name
// as snapshot provenance metadata.
type HelmReleaseParser struct {
	manifestParser *K8sManifestParser
}

// NewHelmReleaseParser constructs a HelmReleaseParser.
func NewHelmReleaseParser() *HelmReleaseParser {
	return &HelmReleaseParser{manifestParser: NewK8sManifestParser()}
}

// Kind reports the source kind this parser handles.
func (*HelmReleaseParser) Kind() string { return SourceHelmRelease }

// helmRelease models the parts of a Helm v3 release object we read.
type helmRelease struct {
	Name      string          `json:"name"`
	Namespace string          `json:"namespace"`
	Version   int             `json:"version"`
	Info      helmReleaseInfo `json:"info"`
	Chart     *helmChart      `json:"chart"`
	Manifest  string          `json:"manifest"`
}

type helmReleaseInfo struct {
	Status string `json:"status"`
}

type helmChart struct {
	Metadata *helmChartMeta `json:"metadata"`
}

type helmChartMeta struct {
	Name       string `json:"name"`
	Version    string `json:"version"`
	AppVersion string `json:"appVersion"`
}

// Parse decodes a Helm release artifact into normalised resources. The input is
// the release secret value (base64+gzip+JSON, single OR double base64-wrapped).
func (p *HelmReleaseParser) Parse(artifact []byte) (ParseResult, error) {
	if len(bytes.TrimSpace(artifact)) == 0 {
		return ParseResult{}, fmt.Errorf("helm release is empty: %w", ErrEmptyArtifact)
	}

	jsonBytes, err := DecodeHelmReleasePayload(artifact)
	if err != nil {
		return ParseResult{}, err
	}

	var rel helmRelease
	if err := json.Unmarshal(jsonBytes, &rel); err != nil {
		return ParseResult{}, fmt.Errorf("decoding helm release json: %w: %v", ErrParse, err)
	}

	meta := map[string]string{
		"format":        "helm_release",
		"release":       rel.Name,
		"release_ns":    rel.Namespace,
		"release_ver":   fmt.Sprintf("%d", rel.Version),
		"release_state": rel.Info.Status,
	}
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		meta["chart"] = rel.Chart.Metadata.Name
		meta["chart_version"] = rel.Chart.Metadata.Version
		meta["app_version"] = rel.Chart.Metadata.AppVersion
	}

	if strings.TrimSpace(rel.Manifest) == "" {
		return ParseResult{}, fmt.Errorf("helm release has no rendered manifest: %w", ErrEmptyArtifact)
	}

	// Reuse the real manifest parser on the rendered objects.
	docs, err := decodeYAMLDocuments([]byte(rel.Manifest))
	if err != nil {
		return ParseResult{}, err
	}
	resources, err := manifestsToResources(docs)
	if err != nil {
		return ParseResult{}, err
	}
	if len(resources) == 0 {
		return ParseResult{}, fmt.Errorf("helm release rendered no objects: %w", ErrEmptyArtifact)
	}

	// Stamp every resource's provider context as helm-managed for clearer drift
	// attribution, while preserving the K8s API group as the type's origin in the
	// address. We keep the K8s provider (api group) on the Resource for diff
	// stability and instead record helm provenance in snapshot metadata.
	sort.Slice(resources, func(i, j int) bool { return resources[i].Address < resources[j].Address })

	return ParseResult{SourceKind: SourceHelmRelease, Resources: resources, Metadata: meta}, nil
}

// DecodeHelmReleasePayload performs the real Helm release decode chain:
// base64-decode (one or two layers, tolerantly) then gunzip, returning the raw
// release JSON bytes. It is exported and pure so the round-trip is unit-tested
// directly: gzip+json -> base64 -> base64 -> DecodeHelmReleasePayload yields the
// original JSON.
func DecodeHelmReleasePayload(artifact []byte) ([]byte, error) {
	raw := bytes.TrimSpace(artifact)

	// Layer 1: base64 decode. Helm/K8s store the value base64-encoded; the value
	// itself is base64(gzip(json)), so a first decode may yield either gzip bytes
	// or another base64 layer.
	decoded, err := decodeBase64(raw)
	if err != nil {
		return nil, fmt.Errorf("helm release base64 decode: %w: %v", ErrParse, err)
	}

	// If the first decode is not gzip, it is the inner base64 layer — decode again.
	if !hasGzipMagic(decoded) {
		inner, err2 := decodeBase64(bytes.TrimSpace(decoded))
		if err2 != nil {
			return nil, fmt.Errorf("helm release inner base64 decode: %w: %v", ErrParse, err2)
		}
		decoded = inner
	}

	if !hasGzipMagic(decoded) {
		return nil, fmt.Errorf("helm release payload is not gzip after base64 decode: %w", ErrParse)
	}

	gz, err := gzip.NewReader(bytes.NewReader(decoded))
	if err != nil {
		return nil, fmt.Errorf("helm release gzip reader: %w: %v", ErrParse, err)
	}
	defer gz.Close()
	jsonBytes, err := io.ReadAll(gz)
	if err != nil {
		return nil, fmt.Errorf("helm release gunzip: %w: %v", ErrParse, err)
	}
	return jsonBytes, nil
}

// hasGzipMagic reports whether b begins with the gzip magic bytes (0x1f 0x8b).
func hasGzipMagic(b []byte) bool {
	return len(b) >= 2 && b[0] == 0x1f && b[1] == 0x8b
}

// decodeBase64 decodes b as standard base64, falling back to raw (unpadded) and
// URL-safe alphabets so payloads from different tooling all decode.
func decodeBase64(b []byte) ([]byte, error) {
	s := string(bytes.TrimSpace(b))
	if out, err := base64.StdEncoding.DecodeString(s); err == nil {
		return out, nil
	}
	if out, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		return out, nil
	}
	if out, err := base64.URLEncoding.DecodeString(s); err == nil {
		return out, nil
	}
	return base64.RawURLEncoding.DecodeString(s)
}

// EncodeHelmReleasePayload is the inverse of DecodeHelmReleasePayload's chain
// (json -> gzip -> base64 -> base64). It exists so the decode round-trip is
// testable with a self-produced fixture exactly as a real Helm secret is stored,
// and so an agent could re-emit a release in Helm's storage form.
func EncodeHelmReleasePayload(releaseJSON []byte) ([]byte, error) {
	var gzBuf bytes.Buffer
	gw := gzip.NewWriter(&gzBuf)
	if _, err := gw.Write(releaseJSON); err != nil {
		return nil, fmt.Errorf("helm release gzip write: %w", err)
	}
	if err := gw.Close(); err != nil {
		return nil, fmt.Errorf("helm release gzip close: %w", err)
	}
	inner := base64.StdEncoding.EncodeToString(gzBuf.Bytes())
	outer := base64.StdEncoding.EncodeToString([]byte(inner))
	return []byte(outer), nil
}
