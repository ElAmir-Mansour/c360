package iacdr

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"errors"
	"testing"
)

// helmReleaseJSON is a REAL Helm v3 release object JSON (the shape Helm gzips +
// base64s into a Secret), with a rendered manifest of two Kubernetes objects.
const helmReleaseJSON = `{
  "name": "my-app",
  "namespace": "prod",
  "version": 7,
  "info": { "status": "deployed" },
  "chart": { "metadata": { "name": "my-app", "version": "2.3.1", "appVersion": "1.4.0" } },
  "manifest": "apiVersion: v1\nkind: Service\nmetadata:\n  name: my-app\n  namespace: prod\nspec:\n  ports:\n  - port: 80\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: my-app\n  namespace: prod\nspec:\n  replicas: 2\n"
}`

func TestDecodeHelmReleasePayload_RoundTrip(t *testing.T) {
	// Encode with the package's encoder (json -> gzip -> base64 -> base64) and
	// confirm DecodeHelmReleasePayload recovers the exact original JSON. This is
	// the REAL base64+gzip+json round-trip the prompt requires.
	encoded, err := EncodeHelmReleasePayload([]byte(helmReleaseJSON))
	if err != nil {
		t.Fatalf("EncodeHelmReleasePayload: %v", err)
	}
	decoded, err := DecodeHelmReleasePayload(encoded)
	if err != nil {
		t.Fatalf("DecodeHelmReleasePayload: %v", err)
	}
	if string(decoded) != helmReleaseJSON {
		t.Fatalf("round-trip mismatch:\n got: %s\nwant: %s", decoded, helmReleaseJSON)
	}
}

func TestDecodeHelmReleasePayload_SingleBase64(t *testing.T) {
	// A single-base64 layer (base64(gzip(json))) — the form left after the
	// Kubernetes API has already base64-decoded the Secret data field once — must
	// also decode.
	var gzBuf bytes.Buffer
	gw := gzip.NewWriter(&gzBuf)
	if _, err := gw.Write([]byte(helmReleaseJSON)); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := gw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}
	single := base64.StdEncoding.EncodeToString(gzBuf.Bytes())
	decoded, err := DecodeHelmReleasePayload([]byte(single))
	if err != nil {
		t.Fatalf("DecodeHelmReleasePayload single: %v", err)
	}
	if string(decoded) != helmReleaseJSON {
		t.Fatalf("single-base64 round-trip mismatch")
	}
}

func TestHelmReleaseParser_RealRelease(t *testing.T) {
	encoded, err := EncodeHelmReleasePayload([]byte(helmReleaseJSON))
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	res, err := NewHelmReleaseParser().Parse(encoded)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if res.SourceKind != SourceHelmRelease {
		t.Fatalf("SourceKind = %q", res.SourceKind)
	}
	if len(res.Resources) != 2 {
		t.Fatalf("resource count = %d, want 2: %v", len(res.Resources), addresses(res.Resources))
	}

	byAddr := map[string]Resource{}
	for _, r := range res.Resources {
		byAddr[r.Address] = r
	}
	if _, ok := byAddr["v1/Service/prod/my-app"]; !ok {
		t.Errorf("service missing; got %v", addresses(res.Resources))
	}
	if _, ok := byAddr["apps/v1/Deployment/prod/my-app"]; !ok {
		t.Errorf("deployment missing; got %v", addresses(res.Resources))
	}

	// Chart/release provenance carried into metadata.
	if res.Metadata["chart"] != "my-app" {
		t.Errorf("metadata chart = %q", res.Metadata["chart"])
	}
	if res.Metadata["chart_version"] != "2.3.1" {
		t.Errorf("metadata chart_version = %q", res.Metadata["chart_version"])
	}
	if res.Metadata["release"] != "my-app" {
		t.Errorf("metadata release = %q", res.Metadata["release"])
	}
}

func TestHelmReleaseParser_Errors(t *testing.T) {
	tests := []struct {
		name    string
		input   []byte
		wantErr error
	}{
		{"empty", []byte("   "), ErrEmptyArtifact},
		{"not base64", []byte("@@@not base64@@@"), ErrParse},
		{"base64 but not gzip", []byte(base64.StdEncoding.EncodeToString([]byte("plain text not gzip"))), ErrParse},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewHelmReleaseParser().Parse(tt.input)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("err = %v, want %v", err, tt.wantErr)
			}
		})
	}
}
