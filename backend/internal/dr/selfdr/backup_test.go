package selfdr

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"reflect"
	"testing"
	"time"
)

func TestBackupManager_CapturesAndSealsBackup(t *testing.T) {
	source := fakeBackupSource{data: []byte("plain control-plane backup")}
	sealer := &fakeArtifactSealer{
		key:         "tenant/backup.chunk",
		uri:         "worm://tenant/backup.chunk",
		versionID:   "v1",
		retainUntil: fixedNow.Add(7 * 24 * time.Hour),
		locationID:  "secondary",
	}
	manager, err := NewBackupManager(BackupManagerConfig{
		Source: source,
		Sealer: sealer,
		Now:    func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatalf("NewBackupManager error: %v", err)
	}

	result, err := manager.Capture(context.Background(), BackupRequest{
		TenantID:      "6e7f14dc-d88d-47ec-85b4-dbc5f28cf4f7",
		ComponentID:   "control-db",
		ComponentKind: ComponentKindPostgresControlDB,
		MaxRPOSeconds: 60,
		RetainUntil:   fixedNow.Add(7 * 24 * time.Hour),
	})
	if err != nil {
		t.Fatalf("Capture error: %v", err)
	}

	wantHash := sha256Hex(source.data)
	if result.Artifact.Kind != ArtifactKindControlPlaneBackup {
		t.Fatalf("artifact kind = %s, want %s", result.Artifact.Kind, ArtifactKindControlPlaneBackup)
	}
	if result.Artifact.SHA256 != wantHash {
		t.Fatalf("artifact sha = %s, want %s", result.Artifact.SHA256, wantHash)
	}
	if result.Artifact.SizeBytes != int64(len(source.data)) {
		t.Fatalf("artifact size = %d, want %d", result.Artifact.SizeBytes, len(source.data))
	}
	if result.Artifact.Key != "tenant/backup.chunk" || result.Artifact.VersionID != "v1" {
		t.Fatalf("artifact location = %#v", result.Artifact)
	}
	if !result.Evidence.Available || !result.Evidence.Immutable || !result.Evidence.Encrypted {
		t.Fatalf("evidence flags = %#v, want available immutable encrypted", result.Evidence)
	}
	if result.Evidence.URI != "worm://tenant/backup.chunk" {
		t.Fatalf("evidence uri = %q", result.Evidence.URI)
	}
	if result.Evidence.LocationID != "secondary" {
		t.Fatalf("evidence location = %q", result.Evidence.LocationID)
	}
	if sealer.req.Kind != ArtifactKindControlPlaneBackup {
		t.Fatalf("seal kind = %s, want backup", sealer.req.Kind)
	}
	if sealer.req.Marker != "source-marker" {
		t.Fatalf("seal marker = %q, want source marker", sealer.req.Marker)
	}
	if !bytes.Equal(sealer.payload, source.data) {
		t.Fatalf("sealed payload = %q, want %q", sealer.payload, source.data)
	}
}

func TestBackupManager_RejectsSealerHashMismatch(t *testing.T) {
	manager, err := NewBackupManager(BackupManagerConfig{
		Source: fakeBackupSource{data: []byte("backup")},
		Sealer: &fakeArtifactSealer{shaOverride: "bad"},
		Now:    func() time.Time { return fixedNow },
	})
	if err != nil {
		t.Fatalf("NewBackupManager error: %v", err)
	}

	_, err = manager.Capture(context.Background(), BackupRequest{
		TenantID:      "6e7f14dc-d88d-47ec-85b4-dbc5f28cf4f7",
		ComponentID:   "control-db",
		ComponentKind: ComponentKindPostgresControlDB,
	})
	if err == nil {
		t.Fatal("Capture error = nil, want hash mismatch")
	}
}

func TestCommandBackupSource_UsesInjectedRunner(t *testing.T) {
	runner := &fakeCommandRunner{data: []byte("pg_dump bytes")}
	source := NewCommandBackupSource(BackupCommand{
		Name: "pg_dump",
		Args: []string{"--format=custom", "--dbname=control"},
		Env:  []string{"PGAPPNAME=clario-selfdr"},
	}, runner)

	capture, err := source.Capture(context.Background(), BackupCaptureRequest{
		ComponentID:   "control-db",
		ComponentKind: ComponentKindPostgresControlDB,
	})
	if err != nil {
		t.Fatalf("Capture error: %v", err)
	}
	defer func() { _ = capture.Data.Close() }()

	got, err := io.ReadAll(capture.Data)
	if err != nil {
		t.Fatalf("read capture: %v", err)
	}
	if string(got) != "pg_dump bytes" {
		t.Fatalf("capture bytes = %q", got)
	}
	if runner.called != 1 {
		t.Fatalf("runner called %d times, want 1", runner.called)
	}
	if runner.command.Name != "pg_dump" {
		t.Fatalf("command name = %q", runner.command.Name)
	}
	if !reflect.DeepEqual(runner.command.Args, []string{"--format=custom", "--dbname=control"}) {
		t.Fatalf("command args = %#v", runner.command.Args)
	}
	if capture.Marker != "control-db" {
		t.Fatalf("capture marker = %q, want component id", capture.Marker)
	}
}

type fakeBackupSource struct {
	data   []byte
	marker string
}

func (s fakeBackupSource) Capture(context.Context, BackupCaptureRequest) (BackupCapture, error) {
	marker := s.marker
	if marker == "" {
		marker = "source-marker"
	}
	return BackupCapture{
		Data:   io.NopCloser(bytes.NewReader(s.data)),
		Marker: marker,
	}, nil
}

type fakeArtifactSealer struct {
	key         string
	uri         string
	versionID   string
	shaOverride string
	retainUntil time.Time
	locationID  string
	payload     []byte
	req         SealRequest
}

func (s *fakeArtifactSealer) SealArtifact(_ context.Context, source io.Reader, req SealRequest) (SealResult, error) {
	payload, err := io.ReadAll(source)
	if err != nil {
		return SealResult{}, err
	}
	s.payload = payload
	s.req = req
	sha := sha256Hex(payload)
	if s.shaOverride != "" {
		sha = s.shaOverride
	}
	key := s.key
	if key == "" {
		key = string(req.Kind) + ".chunk"
	}
	return SealResult{
		Key:         key,
		URI:         s.uri,
		VersionID:   s.versionID,
		SHA256:      sha,
		SizeBytes:   int64(len(payload)),
		RetainUntil: s.retainUntil,
		LocationID:  s.locationID,
		Immutable:   true,
		Encrypted:   true,
	}, nil
}

type fakeCommandRunner struct {
	data    []byte
	command BackupCommand
	called  int
}

func (r *fakeCommandRunner) Run(_ context.Context, command BackupCommand, stdout io.Writer) error {
	r.called++
	r.command = command
	_, err := stdout.Write(r.data)
	return err
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
