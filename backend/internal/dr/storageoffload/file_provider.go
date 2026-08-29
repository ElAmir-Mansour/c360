package storageoffload

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// manifestFileName is the per-snapshot manifest file the FileProvider writes
// inside each snapshot directory. It lives alongside the captured files but is
// excluded from the captured set (it describes them).
const manifestFileName = ".clario_snapshot_manifest.json"

// FileProvider is a fully-real StorageOffloadProvider backed by the local
// filesystem. It models exactly how an array offloads work, with real I/O:
//
//   - CreateSnapshot walks the source volume, hashes every file (sha256), and
//     materializes a content-addressed snapshot directory. Files UNCHANGED since
//     the parent snapshot are HARD-LINKED from the parent (copy-on-write: the
//     inode is shared, so an unchanged file costs no extra bytes); CHANGED or NEW
//     files are copied. A manifest (path -> hash/size/mode) is written into the
//     snapshot dir. This is the array's "snapshot" done locally and for real.
//   - SnapshotStatus reads the snapshot manifest back (ready once it exists).
//   - ReplicateSnapshot copies a snapshot to a DR target. A full snapshot copies
//     every file; an incremental copies only the files whose hash differs from
//     the already-replicated parent (manifest diff), leaving unchanged target
//     files in place — real incremental replication.
//   - DeleteSnapshot removes the snapshot directory (idempotent).
//
// Because unchanged files are hard-linked, deleting one snapshot never corrupts
// another that shares its inodes (the data survives until the last link is
// removed), which is the copy-on-write retention property arrays provide.
type FileProvider struct {
	now func() time.Time
}

// NewFileProvider constructs the file/loopback provider.
func NewFileProvider() *FileProvider {
	return &FileProvider{now: func() time.Time { return time.Now().UTC() }}
}

// withClock is used by tests to make snapshot timestamps deterministic.
func (p *FileProvider) withClock(now func() time.Time) *FileProvider {
	p.now = now
	return p
}

// Name reports the provider kind.
func (p *FileProvider) Name() string { return ProviderFile }

// snapshotRoot resolves where snapshots for a volume live. ArrayEndpoint is the
// snapshot root; it must be set and must not be the source volume itself.
func (p *FileProvider) snapshotRoot(req SnapshotRequest) (string, error) {
	root := strings.TrimSpace(req.ArrayEndpoint)
	if root == "" {
		return "", fmt.Errorf("%w: array_endpoint (snapshot root) is required for the file provider", ErrValidation)
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("storageoffload file provider: resolving snapshot root: %w", err)
	}
	source := strings.TrimSpace(req.SourceLocation)
	if source == "" {
		return "", fmt.Errorf("%w: source_location is required for the file provider", ErrValidation)
	}
	sourceAbs, err := filepath.Abs(source)
	if err != nil {
		return "", fmt.Errorf("storageoffload file provider: resolving source location: %w", err)
	}
	if sameOrInside(abs, sourceAbs) {
		return "", fmt.Errorf("%w: array_endpoint must be outside source_location", ErrValidation)
	}
	return abs, nil
}

func sameOrInside(path, parent string) bool {
	rel, err := filepath.Rel(parent, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

// CreateSnapshot materializes a new snapshot directory for the volume and
// returns its handle. The handle is a fresh directory name under the snapshot
// root so repeated snapshots never collide.
func (p *FileProvider) CreateSnapshot(ctx context.Context, req SnapshotRequest) (SnapshotInfo, error) {
	if err := ctx.Err(); err != nil {
		return SnapshotInfo{}, err
	}
	root, err := p.snapshotRoot(req)
	if err != nil {
		return SnapshotInfo{}, err
	}
	source := strings.TrimSpace(req.SourceLocation)
	if source == "" {
		return SnapshotInfo{}, fmt.Errorf("%w: source_location is required", ErrValidation)
	}
	srcInfo, err := os.Stat(source)
	if err != nil {
		return SnapshotInfo{}, fmt.Errorf("storageoffload file provider: stat source %q: %w", source, err)
	}
	if !srcInfo.IsDir() {
		return SnapshotInfo{}, fmt.Errorf("%w: source_location %q is not a directory", ErrValidation, source)
	}
	if err := os.MkdirAll(root, 0o750); err != nil {
		return SnapshotInfo{}, fmt.Errorf("storageoffload file provider: creating snapshot root: %w", err)
	}

	handle := fmt.Sprintf("snap-%d-%s", p.now().UnixNano(), uuid.NewString())
	snapDir := filepath.Join(root, handle)
	if err := os.MkdirAll(snapDir, 0o750); err != nil {
		return SnapshotInfo{}, fmt.Errorf("storageoffload file provider: creating snapshot dir: %w", err)
	}

	var parentDir string
	if req.ParentHandle != "" {
		parentDir = filepath.Join(root, req.ParentHandle)
	}

	manifest, changedBytes, err := p.materialize(ctx, source, snapDir, parentDir, req)
	if err != nil {
		_ = os.RemoveAll(snapDir)
		return SnapshotInfo{}, err
	}
	manifest.Volume = req.VolumeName
	manifest.CreatedAt = p.now()
	manifest.ParentID = req.ParentHandle

	if err := p.writeManifest(snapDir, manifest); err != nil {
		_ = os.RemoveAll(snapDir)
		return SnapshotInfo{}, err
	}

	return SnapshotInfo{
		Handle:       handle,
		Manifest:     manifest,
		State:        ProviderSnapshotReady,
		ChangedBytes: changedBytes,
	}, nil
}

// materialize walks source and builds snapDir: unchanged files (same hash as the
// parent snapshot) are hard-linked from parentDir; changed/new files are copied.
// It returns the manifest and the number of bytes actually copied (the delta).
func (p *FileProvider) materialize(ctx context.Context, source, snapDir, parentDir string, req SnapshotRequest) (*Manifest, int64, error) {
	// Index the parent snapshot by path -> hash so an unchanged file is detected
	// and hard-linked instead of re-copied. The parent index comes from the
	// supplied ParentManifest when present, else from the parent dir's manifest.
	parentByPath := map[string]ManifestEntry{}
	if req.ParentManifest != nil {
		for _, e := range req.ParentManifest.Entries {
			parentByPath[e.Path] = e
		}
	} else if parentDir != "" {
		pm, err := p.readManifest(parentDir)
		if err == nil {
			for _, e := range pm.Entries {
				parentByPath[e.Path] = e
			}
		}
	}

	manifest := &Manifest{}
	var changedBytes int64

	err := filepath.Walk(source, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return fmt.Errorf("storageoffload file provider: relativizing %q: %w", path, err)
		}
		if rel == "." {
			return nil
		}
		relSlash := filepath.ToSlash(rel)
		if info.IsDir() {
			return os.MkdirAll(filepath.Join(snapDir, rel), 0o750)
		}
		if !info.Mode().IsRegular() {
			// Skip symlinks/devices/etc: the file provider models a file volume.
			return nil
		}
		hash, err := hashFile(path)
		if err != nil {
			return err
		}
		entry := ManifestEntry{
			Path:    relSlash,
			Size:    info.Size(),
			Hash:    hash,
			Mode:    uint32(info.Mode().Perm()),
			ModTime: info.ModTime().Unix(),
		}
		manifest.Entries = append(manifest.Entries, entry)

		dst := filepath.Join(snapDir, rel)
		if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
			return fmt.Errorf("storageoffload file provider: creating snapshot subdir: %w", err)
		}

		prev, unchanged := parentByPath[relSlash]
		if unchanged && prev.Hash == hash && parentDir != "" {
			// Copy-on-write: hard-link the unchanged file from the parent snapshot
			// so it shares the inode and costs no extra bytes.
			if linkErr := os.Link(filepath.Join(parentDir, rel), dst); linkErr == nil {
				return nil
			}
			// Hard link can fail across filesystems; fall back to a real copy.
		}
		n, err := copyFile(path, dst, info.Mode().Perm())
		if err != nil {
			return err
		}
		changedBytes += n
		return nil
	})
	if err != nil {
		return nil, 0, fmt.Errorf("storageoffload file provider: walking source %q: %w", source, err)
	}

	sort.Slice(manifest.Entries, func(i, j int) bool {
		return manifest.Entries[i].Path < manifest.Entries[j].Path
	})
	return manifest, changedBytes, nil
}

// SnapshotStatus reports a snapshot's state. A snapshot dir with a readable
// manifest is ready; a missing dir is missing. The file provider completes
// synchronously in CreateSnapshot, so a present snapshot is always ready — but
// SnapshotStatus is a real read so the orchestrator's poll-to-completion path is
// exercised end-to-end against the filesystem.
func (p *FileProvider) SnapshotStatus(ctx context.Context, req SnapshotRequest, handle string) (SnapshotInfo, error) {
	if err := ctx.Err(); err != nil {
		return SnapshotInfo{}, err
	}
	root, err := p.snapshotRoot(req)
	if err != nil {
		return SnapshotInfo{}, err
	}
	snapDir := filepath.Join(root, handle)
	if _, statErr := os.Stat(snapDir); statErr != nil {
		if errors.Is(statErr, os.ErrNotExist) {
			return SnapshotInfo{Handle: handle, State: ProviderSnapshotMissing}, nil
		}
		return SnapshotInfo{}, fmt.Errorf("storageoffload file provider: stat snapshot %q: %w", handle, statErr)
	}
	manifest, err := p.readManifest(snapDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// Dir exists but manifest not yet written: still creating.
			return SnapshotInfo{Handle: handle, State: ProviderSnapshotCreating}, nil
		}
		return SnapshotInfo{}, err
	}
	return SnapshotInfo{Handle: handle, Manifest: manifest, State: ProviderSnapshotReady}, nil
}

// ListSnapshots enumerates the snapshot directories under the volume's snapshot
// root, newest first by name (the handle embeds a monotonic timestamp).
func (p *FileProvider) ListSnapshots(ctx context.Context, req SnapshotRequest) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	root, err := p.snapshotRoot(req)
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("storageoffload file provider: listing snapshots: %w", err)
	}
	var handles []string
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), "snap-") {
			handles = append(handles, e.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(handles)))
	return handles, nil
}

// ReplicateSnapshot ships a snapshot to toTarget with real file I/O. For a full
// snapshot every file is copied. For an incremental, baseTarget names the
// previously-replicated parent location; the parent target is first cloned to the
// new target (hard-link/copy), then only the files whose hash differs from the
// parent manifest are overwritten, and files deleted since the parent are removed
// — so the bytes transferred equal the delta, not the whole dataset.
func (p *FileProvider) ReplicateSnapshot(ctx context.Context, req SnapshotRequest, handle, toTarget, baseTarget string) (int64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	root, err := p.snapshotRoot(req)
	if err != nil {
		return 0, err
	}
	target := strings.TrimSpace(toTarget)
	if target == "" {
		return 0, fmt.Errorf("%w: replication target is required", ErrValidation)
	}
	snapDir := filepath.Join(root, handle)
	childManifest, err := p.readManifest(snapDir)
	if err != nil {
		return 0, fmt.Errorf("storageoffload file provider: reading snapshot %q manifest for replication: %w", handle, err)
	}

	if err := os.RemoveAll(target); err != nil {
		return 0, fmt.Errorf("storageoffload file provider: clearing replication target: %w", err)
	}
	if err := os.MkdirAll(target, 0o750); err != nil {
		return 0, fmt.Errorf("storageoffload file provider: creating replication target: %w", err)
	}

	// Full replication when there is no usable base at the target.
	parentManifest := req.ParentManifest
	if baseTarget == "" || parentManifest == nil {
		return p.replicateFull(ctx, snapDir, target, childManifest)
	}

	// Incremental replication: seed the target from the base target (unchanged
	// files via hard-link/copy), then transfer only the changed/new files.
	if err := p.seedFromBase(ctx, baseTarget, target, parentManifest, childManifest); err != nil {
		return 0, err
	}
	return p.replicateDelta(ctx, snapDir, target, parentManifest, childManifest)
}

func (p *FileProvider) replicateFull(ctx context.Context, snapDir, target string, manifest *Manifest) (int64, error) {
	var bytes int64
	for _, e := range manifest.Entries {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		src := filepath.Join(snapDir, filepath.FromSlash(e.Path))
		dst := filepath.Join(target, filepath.FromSlash(e.Path))
		if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
			return 0, fmt.Errorf("storageoffload file provider: creating target subdir: %w", err)
		}
		n, err := copyFile(src, dst, os.FileMode(e.Mode))
		if err != nil {
			return 0, err
		}
		bytes += n
	}
	return bytes, nil
}

// seedFromBase clones the previously-replicated parent (baseTarget) into target,
// hard-linking files that survive into the child so the base bytes are reused.
// Files the child no longer contains are not seeded (they are effectively deleted).
func (p *FileProvider) seedFromBase(ctx context.Context, baseTarget, target string, parent, child *Manifest) error {
	childPaths := make(map[string]struct{}, len(child.Entries))
	for _, e := range child.Entries {
		childPaths[e.Path] = struct{}{}
	}
	for _, e := range parent.Entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, keep := childPaths[e.Path]; !keep {
			continue // deleted in child
		}
		src := filepath.Join(baseTarget, filepath.FromSlash(e.Path))
		dst := filepath.Join(target, filepath.FromSlash(e.Path))
		if _, err := os.Stat(src); err != nil {
			continue // base file absent; the delta copy will supply it
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
			return fmt.Errorf("storageoffload file provider: creating seed subdir: %w", err)
		}
		if err := os.Link(src, dst); err == nil {
			continue
		}
		if _, err := copyFile(src, dst, os.FileMode(e.Mode)); err != nil {
			return err
		}
	}
	return nil
}

// replicateDelta overwrites at target only the files changed/new in child versus
// parent and removes files deleted in child. It returns the bytes transferred,
// which equals the change-set size — the incremental's whole point.
func (p *FileProvider) replicateDelta(ctx context.Context, snapDir, target string, parent, child *Manifest) (int64, error) {
	diff := DiffManifests(parent, child)
	var bytes int64
	for _, e := range diff.Changed {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		src := filepath.Join(snapDir, filepath.FromSlash(e.Path))
		dst := filepath.Join(target, filepath.FromSlash(e.Path))
		if err := os.MkdirAll(filepath.Dir(dst), 0o750); err != nil {
			return 0, fmt.Errorf("storageoffload file provider: creating delta subdir: %w", err)
		}
		// Remove a hard-linked seed first so an overwrite never mutates the base
		// target's inode (copy-on-write semantics).
		_ = os.Remove(dst)
		n, err := copyFile(src, dst, os.FileMode(e.Mode))
		if err != nil {
			return 0, err
		}
		bytes += n
	}
	for _, path := range diff.Deleted {
		if err := os.Remove(filepath.Join(target, filepath.FromSlash(path))); err != nil && !errors.Is(err, os.ErrNotExist) {
			return 0, fmt.Errorf("storageoffload file provider: removing deleted file %q at target: %w", path, err)
		}
	}
	return bytes, nil
}

// DeleteSnapshot removes a snapshot directory. Idempotent: an absent handle is a
// no-op. Because unchanged files were hard-linked, removing one snapshot leaves
// any sibling that shares those inodes fully intact.
func (p *FileProvider) DeleteSnapshot(ctx context.Context, req SnapshotRequest, handle string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	root, err := p.snapshotRoot(req)
	if err != nil {
		return err
	}
	if strings.TrimSpace(handle) == "" {
		return nil
	}
	if err := os.RemoveAll(filepath.Join(root, handle)); err != nil {
		return fmt.Errorf("storageoffload file provider: deleting snapshot %q: %w", handle, err)
	}
	return nil
}

// writeManifest serializes the manifest into the snapshot dir atomically.
func (p *FileProvider) writeManifest(snapDir string, m *Manifest) error {
	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return fmt.Errorf("storageoffload file provider: marshaling manifest: %w", err)
	}
	path := filepath.Join(snapDir, manifestFileName)
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o640); err != nil {
		return fmt.Errorf("storageoffload file provider: writing manifest: %w", err)
	}
	if err := os.Rename(tmp, path); err != nil {
		return fmt.Errorf("storageoffload file provider: publishing manifest: %w", err)
	}
	return nil
}

// readManifest loads the manifest from a snapshot dir.
func (p *FileProvider) readManifest(snapDir string) (*Manifest, error) {
	data, err := os.ReadFile(filepath.Join(snapDir, manifestFileName))
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("storageoffload file provider: unmarshaling manifest: %w", err)
	}
	return &m, nil
}

// hashFile returns the sha256 hex digest of a file's contents, streamed so a
// large file does not load into memory.
func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("storageoffload file provider: opening %q for hashing: %w", path, err)
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("storageoffload file provider: hashing %q: %w", path, err)
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// copyFile copies src to dst with mode perm and returns the bytes written.
func copyFile(src, dst string, perm os.FileMode) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		return 0, fmt.Errorf("storageoffload file provider: opening source %q: %w", src, err)
	}
	defer in.Close()
	if perm == 0 {
		perm = 0o640
	}
	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, perm)
	if err != nil {
		return 0, fmt.Errorf("storageoffload file provider: creating dest %q: %w", dst, err)
	}
	n, err := io.Copy(out, in)
	if err != nil {
		_ = out.Close()
		return 0, fmt.Errorf("storageoffload file provider: copying %q -> %q: %w", src, dst, err)
	}
	if err := out.Sync(); err != nil {
		_ = out.Close()
		return 0, fmt.Errorf("storageoffload file provider: syncing %q: %w", dst, err)
	}
	if err := out.Close(); err != nil {
		return 0, fmt.Errorf("storageoffload file provider: closing %q: %w", dst, err)
	}
	return n, nil
}

// HashManifest returns a stable sha256 over a manifest's entries, used by the
// orchestrator as the catalog's tamper-evident manifest_hash. It hashes the
// canonical (path, hash, size) tuples in sorted path order so the same content
// always yields the same digest regardless of walk order.
func HashManifest(m *Manifest) string {
	entries := make([]ManifestEntry, len(m.Entries))
	copy(entries, m.Entries)
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	h := sha256.New()
	for _, e := range entries {
		fmt.Fprintf(h, "%s\x00%s\x00%d\n", e.Path, e.Hash, e.Size)
	}
	return hex.EncodeToString(h.Sum(nil))
}

var _ StorageOffloadProvider = (*FileProvider)(nil)
