package integration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// =============================================================================
// e-Archiving LOCAL filesystem transport (backend="local").
//
// This is the REVERSIBLE, non-WORM demo/records target for the archiving
// connector. It mirrors the surface of S3WORMClient (Probe / Put / SetLegalHold
// / LegalHold / Dispose / Stat) but writes to a plain local base directory with
// NO object-lock, NO retention, and NO immutability. It exists so the
// document-archiving flow is demonstrable end-to-end today with ZERO external
// dependencies (no S3/MinIO, no CMIS, no SharePoint, no credentials).
//
// CRITICAL — REVERSIBILITY / NO WORM:
//   - The applied WORM mode is ALWAYS WORMModeNone. The connector forces it and
//     this transport never accepts a retain-until or applies any lock, so the
//     object-lock go-live path can never be exercised on a local target.
//   - Dispose always removes the object (reversible); it is NEVER refused by a
//     storage lock. The connector's OWN policy gates (active lex legal-hold)
//     still apply above this layer — a legal-held document is blocked before we
//     are ever called for a dispose.
//   - SetLegalHold is an HONEST metadata-only marker (a sidecar flag). Local
//     filesystems have no true object-lock; the marker records operator intent
//     and is fully reversible. It does NOT provide WORM immutability and is not
//     represented as such.
//
// Bytes-at-rest are the same document bytes the operator already holds (the
// connector's custody model). PDPL residency: local storage is operator-asserted
// in-Kingdom (the box lives in the Kingdom), so the in-Kingdom check is trivially
// satisfied for this backend.
// =============================================================================

// localArchiveRegion is the operator-asserted residency label for a local
// filesystem archive. Local == in-Kingdom by operator assertion (the host lives
// in the Kingdom), so it is on the in-Kingdom allow-list.
const localArchiveRegion = "in-kingdom"

// defaultLocalArchiveDir resolves the base directory for the local archive
// backend when config supplies none. It honours LEX_EARCHIVE_LOCAL_DIR, else
// falls back to an os.TempDir subpath. This keeps the demo target zero-config.
func defaultLocalArchiveDir() string {
	if v := strings.TrimSpace(os.Getenv("LEX_EARCHIVE_LOCAL_DIR")); v != "" {
		return v
	}
	return filepath.Join(os.TempDir(), "lex-earchive")
}

// LocalArchiveClient is the reversible local-filesystem archive transport. It is
// deliberately WORM-free: no retention, no object-lock, disposals always
// succeed.
type LocalArchiveClient struct {
	baseDir string
	bucket  string
}

// LocalArchiveConfig parametrises the local backend. BaseDir defaults to
// defaultLocalArchiveDir when empty; Bucket is required (namespaces the archive).
type LocalArchiveConfig struct {
	BaseDir string
	Bucket  string
}

// NewLocalArchiveClient builds the local transport. It does NOT create the
// directory (that is Probe's / Put's job) — construction is side-effect free.
func NewLocalArchiveClient(cfg LocalArchiveConfig) (*LocalArchiveClient, error) {
	bucket := strings.TrimSpace(cfg.Bucket)
	if bucket == "" {
		return nil, fmt.Errorf("lex/earchive: local bucket required")
	}
	base := strings.TrimSpace(cfg.BaseDir)
	if base == "" {
		base = defaultLocalArchiveDir()
	}
	return &LocalArchiveClient{baseDir: base, bucket: bucket}, nil
}

// LocalProbeResult is the sanitized outcome of the local backend probe.
type LocalProbeResult struct {
	// BaseDir is the resolved archive root.
	BaseDir string
	// Writable is true when the bucket directory exists (or was created) and is writable.
	Writable bool
	// ResolvedRegion is always the operator-asserted in-Kingdom label.
	ResolvedRegion string
	// InKingdom is always true for local (operator-asserted residency).
	InKingdom bool
}

// bucketDir is the on-disk directory that namespaces this archive's objects.
func (c *LocalArchiveClient) bucketDir() string {
	return filepath.Join(c.baseDir, c.bucket)
}

// objectPath resolves the on-disk path for a storage key, guarding against path
// traversal (keys are built internally but we clean + confine defensively so a
// crafted key can never escape the bucket directory).
func (c *LocalArchiveClient) objectPath(key string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(strings.TrimSpace(key)))
	if clean == "" || clean == "." {
		return "", fmt.Errorf("lex/earchive: empty object key")
	}
	// Reject absolute or parent-escaping keys.
	if filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("lex/earchive: invalid object key")
	}
	root := c.bucketDir()
	full := filepath.Join(root, clean)
	// Confirm the joined path is still under the bucket root (defence-in-depth).
	rel, err := filepath.Rel(root, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("lex/earchive: object key escapes archive root")
	}
	return full, nil
}

// Probe checks the archive base/bucket directory is present + writable. It
// creates the bucket directory when missing (a first-run archive should not fail
// merely because the directory has not been materialised yet), then confirms
// writability with a temp marker. Region is the operator-asserted in-Kingdom
// label, so InKingdom is always true.
func (c *LocalArchiveClient) Probe(_ context.Context) (LocalProbeResult, error) {
	res := LocalProbeResult{BaseDir: c.baseDir, ResolvedRegion: localArchiveRegion, InKingdom: true}
	dir := c.bucketDir()
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return res, fmt.Errorf("lex/earchive: create archive dir: %w", err)
	}
	// Writability check via a transient marker file.
	marker := filepath.Join(dir, ".lex-archive-probe")
	if err := os.WriteFile(marker, []byte("ok"), 0o640); err != nil {
		return res, fmt.Errorf("lex/earchive: archive dir not writable: %w", err)
	}
	_ = os.Remove(marker)
	res.Writable = true
	return res, nil
}

// localSidecar is the JSON sidecar persisted next to every archived object. It
// records the object's hash, its user metadata, the (always none) WORM mode, and
// any legal-hold marker — an honest, human-readable manifest of the local write.
type localSidecar struct {
	Key        string            `json:"key"`
	SHA256     string            `json:"sha256"`
	Bytes      int64             `json:"bytes"`
	WORMMode   string            `json:"worm_mode"`
	LegalHold  bool              `json:"legal_hold"`
	ArchivedAt time.Time         `json:"archived_at"`
	UserMeta   map[string]string `json:"user_meta,omitempty"`
}

func (c *LocalArchiveClient) sidecarPath(objPath string) string { return objPath + ".meta.json" }

func (c *LocalArchiveClient) readSidecar(objPath string) (localSidecar, bool) {
	var sc localSidecar
	raw, err := os.ReadFile(c.sidecarPath(objPath))
	if err != nil {
		return sc, false
	}
	if json.Unmarshal(raw, &sc) != nil {
		return sc, false
	}
	return sc, true
}

// Put writes content to <base>/<bucket>/<key> and a sidecar <key>.meta.json. It
// NEVER applies retention or a lock: the returned RetainUntil is always zero and
// AppliedMode is always WORMModeNone (reversible by construction). The retainUntil
// argument is accepted for surface-parity with S3WORMClient.Put and deliberately
// ignored.
func (c *LocalArchiveClient) Put(_ context.Context, key string, content []byte, _ time.Time, userMeta map[string]string) (PutResult, error) {
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	objPath, err := c.objectPath(key)
	if err != nil {
		return PutResult{}, err
	}
	if err := os.MkdirAll(filepath.Dir(objPath), 0o750); err != nil {
		return PutResult{}, fmt.Errorf("lex/earchive: create object dir: %w", err)
	}
	// Preserve any pre-existing legal-hold marker across a re-archive.
	prevHold := false
	if sc, ok := c.readSidecar(objPath); ok {
		prevHold = sc.LegalHold
	}
	if err := os.WriteFile(objPath, content, 0o640); err != nil {
		return PutResult{}, fmt.Errorf("lex/earchive: write archive object: %w", err)
	}
	sc := localSidecar{
		Key:        key,
		SHA256:     hash,
		Bytes:      int64(len(content)),
		WORMMode:   string(WORMModeNone),
		LegalHold:  prevHold,
		ArchivedAt: time.Now().UTC(),
		UserMeta:   userMeta,
	}
	if raw, merr := json.MarshalIndent(sc, "", "  "); merr == nil {
		_ = os.WriteFile(c.sidecarPath(objPath), raw, 0o640)
	}
	return PutResult{
		Key:         key,
		SHA256:      hash,
		Bytes:       int64(len(content)),
		RetainUntil: time.Time{}, // never a retention window on local (reversible).
		AppliedMode: WORMModeNone,
	}, nil
}

// SetLegalHold records/clears an HONEST metadata-only legal-hold marker on the
// sidecar. Local filesystems have no object-lock, so this is operator-intent
// metadata only — fully reversible and NOT a WORM guarantee. Returns
// ErrArchiveObjectNotFound when the object is absent.
func (c *LocalArchiveClient) SetLegalHold(_ context.Context, key string, hold bool) error {
	objPath, err := c.objectPath(key)
	if err != nil {
		return err
	}
	if _, statErr := os.Stat(objPath); statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			return ErrArchiveObjectNotFound
		}
		return fmt.Errorf("lex/earchive: stat object: %w", statErr)
	}
	sc, ok := c.readSidecar(objPath)
	if !ok {
		sc = localSidecar{Key: key, WORMMode: string(WORMModeNone), ArchivedAt: time.Now().UTC()}
	}
	sc.LegalHold = hold
	raw, merr := json.MarshalIndent(sc, "", "  ")
	if merr != nil {
		return fmt.Errorf("lex/earchive: encode sidecar: %w", merr)
	}
	if werr := os.WriteFile(c.sidecarPath(objPath), raw, 0o640); werr != nil {
		return fmt.Errorf("lex/earchive: write sidecar: %w", werr)
	}
	return nil
}

// LegalHold reports whether the metadata-only legal-hold marker is set. Absent
// object or sidecar reports false.
func (c *LocalArchiveClient) LegalHold(_ context.Context, key string) (bool, error) {
	objPath, err := c.objectPath(key)
	if err != nil {
		return false, err
	}
	sc, ok := c.readSidecar(objPath)
	if !ok {
		return false, nil
	}
	return sc.LegalHold, nil
}

// Dispose removes the archived object and its sidecar. Local is reversible: the
// disposal is NEVER refused by a storage lock. A metadata-only legal-hold marker
// is respected here (returns ErrArchiveObjectLocked) so the connector's hold
// semantics still hold at the storage layer; the connector also checks lex legal
// holds above this call. A missing object is treated as already-disposed (no
// error) so dispose is idempotent.
func (c *LocalArchiveClient) Dispose(_ context.Context, key, _ string) error {
	objPath, err := c.objectPath(key)
	if err != nil {
		return err
	}
	if sc, ok := c.readSidecar(objPath); ok && sc.LegalHold {
		return ErrArchiveObjectLocked
	}
	if rerr := os.Remove(objPath); rerr != nil && !errors.Is(rerr, os.ErrNotExist) {
		return fmt.Errorf("lex/earchive: dispose object: %w", rerr)
	}
	_ = os.Remove(c.sidecarPath(objPath))
	return nil
}

// Stat reports an archived object's size (existence check). Returns
// ErrArchiveObjectNotFound when absent.
func (c *LocalArchiveClient) Stat(_ context.Context, key string) (int64, error) {
	objPath, err := c.objectPath(key)
	if err != nil {
		return 0, err
	}
	info, serr := os.Stat(objPath)
	if serr != nil {
		if errors.Is(serr, os.ErrNotExist) {
			return 0, ErrArchiveObjectNotFound
		}
		return 0, fmt.Errorf("lex/earchive: stat object: %w", serr)
	}
	return info.Size(), nil
}

// Bucket returns the configured archive bucket (namespace) name.
func (c *LocalArchiveClient) Bucket() string { return c.bucket }

// BaseDir returns the resolved archive root directory.
func (c *LocalArchiveClient) BaseDir() string { return c.baseDir }

// Mode returns the WORM mode — ALWAYS WORMModeNone for the local backend.
func (c *LocalArchiveClient) Mode() WORMMode { return WORMModeNone }
