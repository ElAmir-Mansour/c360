package selfdr

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/worm"
)

const (
	defaultBackupStreamID = "selfdr-control-plane-backup"
)

// ArtifactKind classifies immutable self-DR artifacts.
type ArtifactKind string

const (
	ArtifactKindControlPlaneBackup ArtifactKind = "control_plane_backup"
	ArtifactKindOfflineBundle      ArtifactKind = "offline_restore_bundle"
)

// ArtifactMetadata is the durable identifier and integrity metadata for a
// sealed self-DR artifact.
type ArtifactMetadata struct {
	Kind        ArtifactKind `json:"kind"`
	Key         string       `json:"key,omitempty"`
	URI         string       `json:"uri,omitempty"`
	VersionID   string       `json:"version_id,omitempty"`
	SHA256      string       `json:"sha256"`
	SizeBytes   int64        `json:"size_bytes"`
	CapturedAt  time.Time    `json:"captured_at"`
	RetainUntil time.Time    `json:"retain_until,omitempty"`
}

// BackupCaptureRequest describes the component backup a BackupSource should
// capture.
type BackupCaptureRequest struct {
	ComponentID   string
	ComponentKind ComponentKind
	Metadata      map[string]string
}

// BackupCapture is the captured backup byte stream. Data is closed by the
// BackupManager after sealing.
type BackupCapture struct {
	Data     io.ReadCloser
	Marker   string
	Metadata map[string]string
}

// BackupSource captures a control-plane backup stream. Implementations can wrap
// pg_dump, pg_basebackup, storage snapshots, or tests' deterministic readers.
type BackupSource interface {
	Capture(ctx context.Context, req BackupCaptureRequest) (BackupCapture, error)
}

// BackupCommand is an argv-style command specification. It deliberately avoids
// shell parsing so pg_dump/pg_basebackup arguments remain explicit.
type BackupCommand struct {
	Name string
	Args []string
	Env  []string
	Dir  string
}

// CommandRunner executes a command and writes stdout to the supplied writer.
// Tests inject a fake runner and never shell out.
type CommandRunner interface {
	Run(ctx context.Context, command BackupCommand, stdout io.Writer) error
}

// ExecCommandRunner runs commands via os/exec.
type ExecCommandRunner struct{}

// Run executes command and writes stdout to stdout. Stderr is included in the
// returned error to make failed database backup commands diagnosable.
func (ExecCommandRunner) Run(ctx context.Context, command BackupCommand, stdout io.Writer) error {
	if strings.TrimSpace(command.Name) == "" {
		return errors.New("selfdr: backup command name is required")
	}
	cmd := exec.CommandContext(ctx, command.Name, command.Args...)
	cmd.Dir = command.Dir
	if len(command.Env) > 0 {
		cmd.Env = append(os.Environ(), command.Env...)
	}
	cmd.Stdout = stdout
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			return fmt.Errorf("selfdr: backup command %q failed: %w", command.Name, err)
		}
		return fmt.Errorf("selfdr: backup command %q failed: %w: %s", command.Name, err, msg)
	}
	return nil
}

// CommandBackupSource captures a backup by running a command and returning its
// stdout as the backup artifact.
type CommandBackupSource struct {
	Command BackupCommand
	Runner  CommandRunner
	TempDir string
}

// NewCommandBackupSource constructs a command-backed BackupSource.
func NewCommandBackupSource(command BackupCommand, runner CommandRunner) *CommandBackupSource {
	if runner == nil {
		runner = ExecCommandRunner{}
	}
	return &CommandBackupSource{Command: command, Runner: runner}
}

// Capture runs the configured command and stores stdout in a temporary file so
// later sealing can stream from disk instead of retaining a database dump in
// memory.
func (s *CommandBackupSource) Capture(ctx context.Context, req BackupCaptureRequest) (BackupCapture, error) {
	if s == nil {
		return BackupCapture{}, errors.New("selfdr: backup source is nil")
	}
	runner := s.Runner
	if runner == nil {
		runner = ExecCommandRunner{}
	}
	if strings.TrimSpace(s.Command.Name) == "" {
		return BackupCapture{}, errors.New("selfdr: backup command name is required")
	}

	f, err := os.CreateTemp(s.TempDir, "selfdr-backup-*")
	if err != nil {
		return BackupCapture{}, fmt.Errorf("selfdr: create backup temp file: %w", err)
	}
	path := f.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = f.Close()
			_ = os.Remove(path)
		}
	}()

	if err := runner.Run(ctx, s.Command, f); err != nil {
		return BackupCapture{}, err
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return BackupCapture{}, fmt.Errorf("selfdr: rewind backup temp file: %w", err)
	}

	cleanup = false
	return BackupCapture{
		Data:   removeOnCloseFile{File: f, path: path},
		Marker: req.ComponentID,
	}, nil
}

type removeOnCloseFile struct {
	*os.File
	path string
}

func (f removeOnCloseFile) Close() error {
	err := f.File.Close()
	if rmErr := os.Remove(f.path); err == nil {
		err = rmErr
	}
	return err
}

// SealRequest describes a self-DR artifact seal operation.
type SealRequest struct {
	Kind        ArtifactKind
	TenantID    string
	StreamID    string
	Marker      string
	CapturedAt  time.Time
	RetainUntil time.Time
	Metadata    map[string]string
}

// SealResult identifies the sealed artifact returned by a Sealer.
type SealResult struct {
	Key         string
	URI         string
	VersionID   string
	SHA256      string
	SizeBytes   int64
	RetainUntil time.Time
	LocationID  string
	Immutable   bool
	Encrypted   bool
}

// Sealer writes artifact bytes to immutable storage.
type Sealer interface {
	SealArtifact(ctx context.Context, source io.Reader, req SealRequest) (SealResult, error)
}

// WORMSealClient is the subset of the DR WORM client required by self-DR.
type WORMSealClient interface {
	EnsureBucket(ctx context.Context) error
	Seal(ctx context.Context, source io.Reader, opts worm.SealOptions) (worm.SealResult, error)
}

// WORMSealer adapts internal/dr/worm.Client to the self-DR Sealer interface.
type WORMSealer struct {
	Client     WORMSealClient
	LocationID string
	URIForKey  func(key string) string
}

// NewWORMSealer constructs a WORM-backed Sealer.
func NewWORMSealer(client WORMSealClient, locationID string) (*WORMSealer, error) {
	if client == nil {
		return nil, errors.New("selfdr: WORM client is required")
	}
	return &WORMSealer{Client: client, LocationID: locationID}, nil
}

// SealArtifact writes source to the DR WORM bucket with governance retention.
func (s WORMSealer) SealArtifact(ctx context.Context, source io.Reader, req SealRequest) (SealResult, error) {
	if s.Client == nil {
		return SealResult{}, errors.New("selfdr: WORM client is required")
	}
	if source == nil {
		return SealResult{}, errors.New("selfdr: seal source is nil")
	}
	tenantID, err := uuid.Parse(req.TenantID)
	if err != nil {
		return SealResult{}, fmt.Errorf("selfdr: parse tenant id %q: %w", req.TenantID, err)
	}
	if err := s.Client.EnsureBucket(ctx); err != nil {
		return SealResult{}, fmt.Errorf("selfdr: ensure WORM bucket: %w", err)
	}
	streamID := req.StreamID
	if streamID == "" {
		streamID = defaultBackupStreamID
	}
	marker := req.Marker
	if marker == "" {
		marker = string(req.Kind)
	}
	eventTime := req.CapturedAt
	if eventTime.IsZero() {
		eventTime = time.Now().UTC()
	}
	sealed, err := s.Client.Seal(ctx, source, worm.SealOptions{
		TenantID:    tenantID,
		StreamID:    streamID,
		MarkerLSN:   marker,
		RetainUntil: req.RetainUntil,
		EventTime:   eventTime,
	})
	if err != nil {
		return SealResult{}, fmt.Errorf("selfdr: WORM seal: %w", err)
	}
	uri := ""
	if s.URIForKey != nil {
		uri = s.URIForKey(sealed.Key)
	}
	return SealResult{
		Key:         sealed.Key,
		URI:         uri,
		VersionID:   sealed.VersionID,
		SHA256:      sealed.PlaintextSHA256,
		SizeBytes:   sealed.CiphertextBytes,
		RetainUntil: sealed.RetainUntil,
		LocationID:  s.LocationID,
		Immutable:   true,
		Encrypted:   true,
	}, nil
}

// BackupManager captures a backup and seals it as immutable self-DR evidence.
type BackupManager struct {
	source BackupSource
	sealer Sealer
	now    func() time.Time
}

// BackupManagerConfig wires a BackupManager.
type BackupManagerConfig struct {
	Source BackupSource
	Sealer Sealer
	Now    func() time.Time
}

// NewBackupManager constructs a BackupManager.
func NewBackupManager(cfg BackupManagerConfig) (*BackupManager, error) {
	if cfg.Source == nil {
		return nil, errors.New("selfdr: backup source is required")
	}
	if cfg.Sealer == nil {
		return nil, errors.New("selfdr: sealer is required")
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	return &BackupManager{source: cfg.Source, sealer: cfg.Sealer, now: cfg.Now}, nil
}

// BackupRequest describes one control-plane backup capture.
type BackupRequest struct {
	TenantID      string
	ComponentID   string
	ComponentKind ComponentKind
	LocationID    string
	StreamID      string
	Marker        string
	MaxRPOSeconds int
	RetainUntil   time.Time
	Metadata      map[string]string
}

// BackupResult is returned after a backup is captured and sealed.
type BackupResult struct {
	Evidence BackupEvidence   `json:"evidence"`
	Artifact ArtifactMetadata `json:"artifact"`
}

// Capture captures a backup artifact, computes its plaintext integrity
// metadata, seals it, and returns readiness evidence for the component.
func (m *BackupManager) Capture(ctx context.Context, req BackupRequest) (BackupResult, error) {
	if m == nil {
		return BackupResult{}, errors.New("selfdr: backup manager is nil")
	}
	if strings.TrimSpace(req.TenantID) == "" {
		return BackupResult{}, errors.New("selfdr: tenant id is required")
	}
	if strings.TrimSpace(req.ComponentID) == "" {
		return BackupResult{}, errors.New("selfdr: component id is required")
	}
	if req.ComponentKind == "" {
		return BackupResult{}, errors.New("selfdr: component kind is required")
	}
	capturedAt := m.now().UTC()

	capture, err := m.source.Capture(ctx, BackupCaptureRequest{
		ComponentID:   req.ComponentID,
		ComponentKind: req.ComponentKind,
		Metadata:      cloneStringMap(req.Metadata),
	})
	if err != nil {
		return BackupResult{}, fmt.Errorf("selfdr: capture backup: %w", err)
	}
	if capture.Data == nil {
		return BackupResult{}, errors.New("selfdr: backup source returned nil data")
	}
	defer func() { _ = capture.Data.Close() }()

	staged, digest, size, err := stageAndHash(capture.Data, "selfdr-backup-seal-*")
	if err != nil {
		return BackupResult{}, err
	}
	defer func() { _ = staged.Close() }()

	streamID := req.StreamID
	if streamID == "" {
		streamID = defaultBackupStreamID
	}
	marker := firstNonEmpty(req.Marker, capture.Marker, digest)
	sealed, err := m.sealer.SealArtifact(ctx, staged, SealRequest{
		Kind:        ArtifactKindControlPlaneBackup,
		TenantID:    req.TenantID,
		StreamID:    streamID,
		Marker:      marker,
		CapturedAt:  capturedAt,
		RetainUntil: req.RetainUntil,
		Metadata:    cloneStringMap(capture.Metadata),
	})
	if err != nil {
		return BackupResult{}, fmt.Errorf("selfdr: seal backup: %w", err)
	}
	if sealed.SHA256 != "" && sealed.SHA256 != digest {
		return BackupResult{}, fmt.Errorf("selfdr: sealed backup hash mismatch: got %s want %s", sealed.SHA256, digest)
	}
	locationID := firstNonEmpty(sealed.LocationID, req.LocationID)
	uri := firstNonEmpty(sealed.URI, sealed.Key)
	return BackupResult{
		Evidence: BackupEvidence{
			Available:     true,
			Immutable:     sealed.Immutable,
			Encrypted:     sealed.Encrypted,
			LocationID:    locationID,
			URI:           uri,
			CapturedAt:    capturedAt,
			MaxRPOSeconds: req.MaxRPOSeconds,
		},
		Artifact: ArtifactMetadata{
			Kind:        ArtifactKindControlPlaneBackup,
			Key:         sealed.Key,
			URI:         sealed.URI,
			VersionID:   sealed.VersionID,
			SHA256:      digest,
			SizeBytes:   size,
			CapturedAt:  capturedAt,
			RetainUntil: sealed.RetainUntil,
		},
	}, nil
}

func stageAndHash(source io.Reader, pattern string) (io.ReadCloser, string, int64, error) {
	f, err := os.CreateTemp("", pattern)
	if err != nil {
		return nil, "", 0, fmt.Errorf("selfdr: create artifact temp file: %w", err)
	}
	path := f.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = f.Close()
			_ = os.Remove(path)
		}
	}()

	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(f, hash), source)
	if err != nil {
		return nil, "", 0, fmt.Errorf("selfdr: stage artifact: %w", err)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return nil, "", 0, fmt.Errorf("selfdr: rewind artifact temp file: %w", err)
	}
	cleanup = false
	return removeOnCloseFile{File: f, path: path}, hex.EncodeToString(hash.Sum(nil)), size, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
