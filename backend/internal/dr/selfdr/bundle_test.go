package selfdr

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"reflect"
	"sort"
	"testing"
	"time"
)

func TestRenderOfflineBundle_DeterministicTarGzip(t *testing.T) {
	req := OfflineBundleRequest{
		Profile: readyProfile(),
		Runbook: OperatorRunbookMetadata{
			DocumentID:  "runbook-1",
			Title:       "Control plane restore",
			Version:     "2026.06",
			URI:         "s3://offline/runbook.pdf",
			SHA256:      "runbook-sha",
			GeneratedAt: fixedNow.Add(-time.Hour),
			Metadata: map[string]string{
				"owner":  "platform",
				"region": "secondary",
			},
		},
		Format: OfflineBundleFormatTarGzip,
	}

	first, err := RenderOfflineBundle(req, NewEvaluator(func() time.Time { return fixedNow }), fixedNow)
	if err != nil {
		t.Fatalf("RenderOfflineBundle first error: %v", err)
	}
	second, err := RenderOfflineBundle(req, NewEvaluator(func() time.Time { return fixedNow }), fixedNow)
	if err != nil {
		t.Fatalf("RenderOfflineBundle second error: %v", err)
	}
	if !bytes.Equal(first, second) {
		t.Fatal("bundle bytes are not deterministic")
	}

	files := readTarGzip(t, first)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	wantNames := []string{"assessment.json", "manifest.json", "profile.json", "restore_plan.json", "runbook.json"}
	if !reflect.DeepEqual(names, wantNames) {
		t.Fatalf("bundle files = %v, want %v", names, wantNames)
	}

	var manifest struct {
		SchemaVersion string `json:"schema_version"`
		Kind          string `json:"kind"`
		Format        string `json:"format"`
		ProfileID     string `json:"profile_id"`
		Files         []struct {
			Path      string `json:"path"`
			SHA256    string `json:"sha256"`
			SizeBytes int64  `json:"size_bytes"`
		} `json:"files"`
		Runbook *OperatorRunbookMetadata `json:"runbook"`
	}
	if err := json.Unmarshal(files["manifest.json"], &manifest); err != nil {
		t.Fatalf("unmarshal manifest: %v", err)
	}
	if manifest.SchemaVersion != OfflineBundleSchemaVersion {
		t.Fatalf("schema = %q, want %q", manifest.SchemaVersion, OfflineBundleSchemaVersion)
	}
	if manifest.Kind != string(ArtifactKindOfflineBundle) || manifest.Format != string(OfflineBundleFormatTarGzip) {
		t.Fatalf("manifest kind/format = %q/%q", manifest.Kind, manifest.Format)
	}
	if manifest.ProfileID != req.Profile.ID {
		t.Fatalf("manifest profile = %q, want %q", manifest.ProfileID, req.Profile.ID)
	}
	if manifest.Runbook == nil || manifest.Runbook.DocumentID != "runbook-1" {
		t.Fatalf("manifest runbook = %#v", manifest.Runbook)
	}
	if len(manifest.Files) != 4 {
		t.Fatalf("manifest files = %d, want payload files only", len(manifest.Files))
	}
	for _, file := range manifest.Files {
		payload, ok := files[file.Path]
		if !ok {
			t.Fatalf("manifest references missing file %q", file.Path)
		}
		if file.SHA256 != sha256Hex(payload) {
			t.Fatalf("manifest sha for %s = %s, want %s", file.Path, file.SHA256, sha256Hex(payload))
		}
		if file.SizeBytes != int64(len(payload)) {
			t.Fatalf("manifest size for %s = %d, want %d", file.Path, file.SizeBytes, len(payload))
		}
	}
}

func TestOfflineBundleGenerator_SealsBundleEvidence(t *testing.T) {
	sealer := &fakeArtifactSealer{
		key:         "tenant/bundle.chunk",
		uri:         "worm://tenant/bundle.chunk",
		versionID:   "bundle-v1",
		retainUntil: fixedNow.Add(30 * 24 * time.Hour),
		locationID:  "offline-safe",
	}
	generator, err := NewOfflineBundleGenerator(OfflineBundleGeneratorConfig{
		Sealer: sealer,
		Now:    func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatalf("NewOfflineBundleGenerator error: %v", err)
	}

	result, err := generator.Generate(context.Background(), OfflineBundleRequest{
		TenantID:   "6e7f14dc-d88d-47ec-85b4-dbc5f28cf4f7",
		Profile:    readyProfile(),
		LocationID: "secondary",
		Format:     OfflineBundleFormatTarGzip,
	})
	if err != nil {
		t.Fatalf("Generate error: %v", err)
	}

	if !result.Evidence.Available || !result.Evidence.Complete {
		t.Fatalf("evidence = %#v, want available complete", result.Evidence)
	}
	if result.Evidence.LocationID != "offline-safe" {
		t.Fatalf("evidence location = %q", result.Evidence.LocationID)
	}
	if !result.Evidence.GeneratedAt.Equal(fixedNow) {
		t.Fatalf("generated_at = %s, want %s", result.Evidence.GeneratedAt, fixedNow)
	}
	if result.Artifact.Kind != ArtifactKindOfflineBundle {
		t.Fatalf("artifact kind = %s", result.Artifact.Kind)
	}
	if result.Artifact.SHA256 != sha256Hex(sealer.payload) {
		t.Fatalf("artifact sha = %s, want %s", result.Artifact.SHA256, sha256Hex(sealer.payload))
	}
	if result.Artifact.SizeBytes != int64(len(sealer.payload)) {
		t.Fatalf("artifact size = %d, want %d", result.Artifact.SizeBytes, len(sealer.payload))
	}
	if sealer.req.Kind != ArtifactKindOfflineBundle {
		t.Fatalf("seal kind = %s, want offline bundle", sealer.req.Kind)
	}
	if sealer.req.Marker != result.Artifact.SHA256 {
		t.Fatalf("seal marker = %s, want artifact sha", sealer.req.Marker)
	}
	if len(readTarGzip(t, sealer.payload)) == 0 {
		t.Fatal("sealed bundle did not contain tar files")
	}
}

func readTarGzip(t *testing.T, payload []byte) map[string][]byte {
	t.Helper()
	gz, err := gzip.NewReader(bytes.NewReader(payload))
	if err != nil {
		t.Fatalf("gzip reader: %v", err)
	}
	defer func() { _ = gz.Close() }()

	tr := tar.NewReader(gz)
	files := make(map[string][]byte)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("tar next: %v", err)
		}
		data, err := io.ReadAll(tr)
		if err != nil {
			t.Fatalf("read tar file %s: %v", hdr.Name, err)
		}
		files[hdr.Name] = data
	}
	return files
}
