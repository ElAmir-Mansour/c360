package selfdr

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"
)

const (
	OfflineBundleSchemaVersion = "clario.selfdr.offline_bundle.v1"
	defaultBundleStreamID      = "selfdr-offline-restore-bundle"
)

// OfflineBundleFormat controls how the offline restore bundle is encoded.
type OfflineBundleFormat string

const (
	OfflineBundleFormatTarGzip OfflineBundleFormat = "tar.gz"
	OfflineBundleFormatJSON    OfflineBundleFormat = "json"
)

// OperatorRunbookMetadata records out-of-band human restore instructions that
// should travel with the offline bundle when available.
type OperatorRunbookMetadata struct {
	DocumentID  string            `json:"document_id,omitempty"`
	Title       string            `json:"title,omitempty"`
	Version     string            `json:"version,omitempty"`
	URI         string            `json:"uri,omitempty"`
	SHA256      string            `json:"sha256,omitempty"`
	GeneratedAt time.Time         `json:"generated_at,omitempty"`
	Notes       string            `json:"notes,omitempty"`
	Metadata    map[string]string `json:"metadata,omitempty"`
}

// OfflineBundleRequest describes one offline restore bundle generation.
type OfflineBundleRequest struct {
	TenantID     string
	Profile      SelfDRProfile
	Assessment   *ReadinessAssessment
	Runbook      OperatorRunbookMetadata
	Format       OfflineBundleFormat
	LocationID   string
	StreamID     string
	RetainUntil  time.Time
	GeneratedAt  time.Time
	ManifestNote string
}

// OfflineBundleResult is returned after a bundle is rendered and sealed.
type OfflineBundleResult struct {
	Evidence OfflineRestoreBundle `json:"evidence"`
	Artifact ArtifactMetadata     `json:"artifact"`
}

// OfflineBundleGenerator renders and seals self-contained offline restore
// bundles for control-plane bootstrap.
type OfflineBundleGenerator struct {
	sealer    Sealer
	evaluator *Evaluator
	now       func() time.Time
}

// OfflineBundleGeneratorConfig wires an OfflineBundleGenerator.
type OfflineBundleGeneratorConfig struct {
	Sealer    Sealer
	Evaluator *Evaluator
	Now       func() time.Time
}

// NewOfflineBundleGenerator constructs an OfflineBundleGenerator.
func NewOfflineBundleGenerator(cfg OfflineBundleGeneratorConfig) (*OfflineBundleGenerator, error) {
	if cfg.Sealer == nil {
		return nil, errors.New("selfdr: sealer is required")
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	if cfg.Evaluator == nil {
		cfg.Evaluator = NewEvaluator(cfg.Now)
	}
	return &OfflineBundleGenerator{sealer: cfg.Sealer, evaluator: cfg.Evaluator, now: cfg.Now}, nil
}

// Generate renders a deterministic offline bundle, seals it, and returns the
// evaluator-visible evidence plus immutable artifact metadata.
func (g *OfflineBundleGenerator) Generate(ctx context.Context, req OfflineBundleRequest) (OfflineBundleResult, error) {
	if g == nil {
		return OfflineBundleResult{}, errors.New("selfdr: offline bundle generator is nil")
	}
	if strings.TrimSpace(req.TenantID) == "" {
		return OfflineBundleResult{}, errors.New("selfdr: tenant id is required")
	}
	generatedAt := req.GeneratedAt
	if generatedAt.IsZero() {
		generatedAt = g.now()
	}
	generatedAt = generatedAt.UTC()

	payload, err := RenderOfflineBundle(req, g.evaluator, generatedAt)
	if err != nil {
		return OfflineBundleResult{}, err
	}
	sum := sha256.Sum256(payload)
	digest := hex.EncodeToString(sum[:])

	streamID := req.StreamID
	if streamID == "" {
		streamID = defaultBundleStreamID
	}
	sealed, err := g.sealer.SealArtifact(ctx, bytes.NewReader(payload), SealRequest{
		Kind:        ArtifactKindOfflineBundle,
		TenantID:    req.TenantID,
		StreamID:    streamID,
		Marker:      digest,
		CapturedAt:  generatedAt,
		RetainUntil: req.RetainUntil,
	})
	if err != nil {
		return OfflineBundleResult{}, fmt.Errorf("selfdr: seal offline bundle: %w", err)
	}
	if sealed.SHA256 != "" && sealed.SHA256 != digest {
		return OfflineBundleResult{}, fmt.Errorf("selfdr: sealed offline bundle hash mismatch: got %s want %s", sealed.SHA256, digest)
	}
	return OfflineBundleResult{
		Evidence: OfflineRestoreBundle{
			Available:   true,
			Complete:    true,
			LocationID:  firstNonEmpty(sealed.LocationID, req.LocationID),
			GeneratedAt: generatedAt,
		},
		Artifact: ArtifactMetadata{
			Kind:        ArtifactKindOfflineBundle,
			Key:         sealed.Key,
			URI:         sealed.URI,
			VersionID:   sealed.VersionID,
			SHA256:      digest,
			SizeBytes:   int64(len(payload)),
			CapturedAt:  generatedAt,
			RetainUntil: sealed.RetainUntil,
		},
	}, nil
}

type offlineBundleManifest struct {
	SchemaVersion string                      `json:"schema_version"`
	Kind          ArtifactKind                `json:"kind"`
	Format        OfflineBundleFormat         `json:"format"`
	GeneratedAt   time.Time                   `json:"generated_at"`
	ProfileID     string                      `json:"profile_id"`
	Files         []offlineBundleManifestFile `json:"files"`
	Runbook       *OperatorRunbookMetadata    `json:"runbook,omitempty"`
	Note          string                      `json:"note,omitempty"`
}

type offlineBundleManifestFile struct {
	Path      string `json:"path"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

type bundleFile struct {
	path string
	data []byte
}

// RenderOfflineBundle renders deterministic offline bundle bytes. It is exposed
// so tests and future services can preview the payload before sealing.
func RenderOfflineBundle(req OfflineBundleRequest, evaluator *Evaluator, generatedAt time.Time) ([]byte, error) {
	if req.Profile.ID == "" {
		return nil, errors.New("selfdr: profile id is required")
	}
	format := req.Format
	if format == "" {
		format = OfflineBundleFormatTarGzip
	}
	if generatedAt.IsZero() {
		generatedAt = time.Now().UTC()
	}
	generatedAt = generatedAt.UTC()

	assessment := req.Assessment
	if assessment == nil {
		if evaluator == nil {
			evaluator = NewEvaluator(func() time.Time { return generatedAt })
		}
		evaluated := evaluator.Evaluate(req.Profile)
		assessment = &evaluated
	}
	restorePlan := assessment.RestorePlan
	if restorePlan.ProfileID == "" && len(restorePlan.Waves) == 0 {
		plan, err := NewPlanner().Plan(req.Profile)
		if err != nil {
			return nil, fmt.Errorf("selfdr: restore plan: %w", err)
		}
		restorePlan = plan
	}

	files := make([]bundleFile, 0, 5)
	addJSON := func(path string, value any) error {
		data, err := marshalDeterministicJSON(value)
		if err != nil {
			return fmt.Errorf("selfdr: render %s: %w", path, err)
		}
		files = append(files, bundleFile{path: path, data: data})
		return nil
	}
	if err := addJSON("profile.json", req.Profile); err != nil {
		return nil, err
	}
	if err := addJSON("assessment.json", assessment); err != nil {
		return nil, err
	}
	if err := addJSON("restore_plan.json", restorePlan); err != nil {
		return nil, err
	}
	if !emptyRunbook(req.Runbook) {
		if err := addJSON("runbook.json", req.Runbook); err != nil {
			return nil, err
		}
	}

	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })
	manifest := offlineBundleManifest{
		SchemaVersion: OfflineBundleSchemaVersion,
		Kind:          ArtifactKindOfflineBundle,
		Format:        format,
		GeneratedAt:   generatedAt,
		ProfileID:     req.Profile.ID,
		Files:         manifestFiles(files),
		Note:          req.ManifestNote,
	}
	if !emptyRunbook(req.Runbook) {
		runbook := req.Runbook
		manifest.Runbook = &runbook
	}
	manifestData, err := marshalDeterministicJSON(manifest)
	if err != nil {
		return nil, fmt.Errorf("selfdr: render manifest: %w", err)
	}
	files = append([]bundleFile{{path: "manifest.json", data: manifestData}}, files...)

	switch format {
	case OfflineBundleFormatTarGzip:
		return renderTarGzip(files, generatedAt)
	case OfflineBundleFormatJSON:
		return marshalDeterministicJSON(struct {
			Manifest offlineBundleManifest      `json:"manifest"`
			Files    map[string]json.RawMessage `json:"files"`
		}{
			Manifest: manifest,
			Files:    jsonBundleFiles(files),
		})
	default:
		return nil, fmt.Errorf("selfdr: unsupported offline bundle format %q", format)
	}
}

func manifestFiles(files []bundleFile) []offlineBundleManifestFile {
	out := make([]offlineBundleManifestFile, 0, len(files))
	for _, file := range files {
		sum := sha256.Sum256(file.data)
		out = append(out, offlineBundleManifestFile{
			Path:      file.path,
			SHA256:    hex.EncodeToString(sum[:]),
			SizeBytes: int64(len(file.data)),
		})
	}
	return out
}

func jsonBundleFiles(files []bundleFile) map[string]json.RawMessage {
	out := make(map[string]json.RawMessage, len(files))
	for _, file := range files {
		if file.path == "manifest.json" {
			continue
		}
		out[file.path] = append(json.RawMessage(nil), file.data...)
	}
	return out
}

func renderTarGzip(files []bundleFile, modTime time.Time) ([]byte, error) {
	var buf bytes.Buffer
	gz, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
	if err != nil {
		return nil, fmt.Errorf("selfdr: create gzip writer: %w", err)
	}
	gz.Header.ModTime = modTime
	tw := tar.NewWriter(gz)
	for _, file := range files {
		hdr := &tar.Header{
			Name:     file.path,
			Mode:     0o600,
			Size:     int64(len(file.data)),
			ModTime:  modTime,
			Typeflag: tar.TypeReg,
			Format:   tar.FormatUSTAR,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			_ = tw.Close()
			_ = gz.Close()
			return nil, fmt.Errorf("selfdr: write tar header %s: %w", file.path, err)
		}
		if _, err := io.Copy(tw, bytes.NewReader(file.data)); err != nil {
			_ = tw.Close()
			_ = gz.Close()
			return nil, fmt.Errorf("selfdr: write tar file %s: %w", file.path, err)
		}
	}
	if err := tw.Close(); err != nil {
		_ = gz.Close()
		return nil, fmt.Errorf("selfdr: close tar: %w", err)
	}
	if err := gz.Close(); err != nil {
		return nil, fmt.Errorf("selfdr: close gzip: %w", err)
	}
	return buf.Bytes(), nil
}

func marshalDeterministicJSON(value any) ([]byte, error) {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func emptyRunbook(r OperatorRunbookMetadata) bool {
	return r.DocumentID == "" &&
		r.Title == "" &&
		r.Version == "" &&
		r.URI == "" &&
		r.SHA256 == "" &&
		r.GeneratedAt.IsZero() &&
		r.Notes == "" &&
		len(r.Metadata) == 0
}
