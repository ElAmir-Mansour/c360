package storageoffload

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// writeVolumeFile writes content to rel within volumeDir, creating parents.
func writeVolumeFile(t *testing.T, volumeDir, rel string, content []byte) {
	t.Helper()
	path := filepath.Join(volumeDir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatalf("mkdir %q: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, content, 0o640); err != nil {
		t.Fatalf("write %q: %v", path, err)
	}
}

// entryByPath returns the manifest entry for rel, or fails.
func entryByPath(t *testing.T, m *Manifest, rel string) ManifestEntry {
	t.Helper()
	for _, e := range m.Entries {
		if e.Path == rel {
			return e
		}
	}
	t.Fatalf("manifest has no entry for %q (entries: %d)", rel, len(m.Entries))
	return ManifestEntry{}
}

// sameInode reports whether two files share an inode (i.e. are hard-linked).
func sameInode(t *testing.T, a, b string) bool {
	t.Helper()
	ai, err := os.Stat(a)
	if err != nil {
		t.Fatalf("stat %q: %v", a, err)
	}
	bi, err := os.Stat(b)
	if err != nil {
		t.Fatalf("stat %q: %v", b, err)
	}
	as, ok1 := ai.Sys().(*syscall.Stat_t)
	bs, ok2 := bi.Sys().(*syscall.Stat_t)
	if !ok1 || !ok2 {
		t.Skip("inode comparison unsupported on this platform")
	}
	return as.Ino == bs.Ino
}

func TestFileProvider_RejectsSnapshotRootInsideSource(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	p := NewFileProvider()

	for name, root := range map[string]string{
		"same directory": volumeDir,
		"child":          filepath.Join(volumeDir, "snapshots"),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := p.CreateSnapshot(ctx, SnapshotRequest{
				VolumeName:     "vol-a",
				SourceLocation: volumeDir,
				ArrayEndpoint:  root,
			})
			if err == nil || !errors.Is(err, ErrValidation) {
				t.Fatalf("CreateSnapshot err = %v, want ErrValidation", err)
			}
		})
	}
}

// TestFileProvider_FullSnapshot_CapturesAllFilesAndHashes verifies a base
// snapshot captures every regular file with its real sha256 and size, with real
// filesystem I/O against a temp volume.
func TestFileProvider_FullSnapshot_CapturesAllFilesAndHashes(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	snapRoot := t.TempDir()

	files := map[string][]byte{
		"alpha.txt":        []byte("alpha contents"),
		"beta.bin":         bytes.Repeat([]byte{0x42}, 4096),
		"nested/gamma.txt": []byte("gamma in a subdir"),
	}
	for rel, content := range files {
		writeVolumeFile(t, volumeDir, rel, content)
	}

	p := NewFileProvider()
	req := SnapshotRequest{VolumeName: "vol-a", SourceLocation: volumeDir, ArrayEndpoint: snapRoot}
	info, err := p.CreateSnapshot(ctx, req)
	if err != nil {
		t.Fatalf("CreateSnapshot: %v", err)
	}
	if info.State != ProviderSnapshotReady {
		t.Fatalf("state = %q, want ready", info.State)
	}
	if info.Manifest == nil {
		t.Fatal("manifest is nil")
	}
	if len(info.Manifest.Entries) != len(files) {
		t.Fatalf("manifest entries = %d, want %d", len(info.Manifest.Entries), len(files))
	}
	// The manifest must record the real content hash and size for each file.
	for rel, content := range files {
		e := entryByPath(t, info.Manifest, rel)
		if e.Size != int64(len(content)) {
			t.Errorf("%q size = %d, want %d", rel, e.Size, len(content))
		}
		want, _ := hashBytes(content)
		if e.Hash != want {
			t.Errorf("%q hash = %s, want %s", rel, e.Hash, want)
		}
		// The snapshot dir holds a real copy with identical bytes.
		got, rerr := os.ReadFile(filepath.Join(snapRoot, info.Handle, filepath.FromSlash(rel)))
		if rerr != nil {
			t.Fatalf("reading snapshot file %q: %v", rel, rerr)
		}
		if !bytes.Equal(got, content) {
			t.Errorf("snapshot copy of %q differs from source", rel)
		}
	}
	// A full snapshot copied every byte.
	if info.ChangedBytes == 0 {
		t.Error("full snapshot ChangedBytes = 0, want > 0")
	}
}

// TestFileProvider_IncrementalSnapshot_HardLinksUnchangedCopiesChanged is the
// load-bearing test: after a base snapshot, modify one file and add one, take an
// incremental, and assert ONLY the changed/new files were copied while unchanged
// files are HARD-LINKED from the parent (shared inode, copy-on-write).
func TestFileProvider_IncrementalSnapshot_HardLinksUnchangedCopiesChanged(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	snapRoot := t.TempDir()

	writeVolumeFile(t, volumeDir, "unchanged.txt", []byte("i never change"))
	writeVolumeFile(t, volumeDir, "mutate.txt", []byte("original"))

	p := NewFileProvider()
	req := SnapshotRequest{VolumeName: "vol-b", SourceLocation: volumeDir, ArrayEndpoint: snapRoot}

	base, err := p.CreateSnapshot(ctx, req)
	if err != nil {
		t.Fatalf("base CreateSnapshot: %v", err)
	}

	// Mutate one file, add a new one; leave unchanged.txt alone.
	writeVolumeFile(t, volumeDir, "mutate.txt", []byte("CHANGED CONTENT - longer than before"))
	writeVolumeFile(t, volumeDir, "added.txt", []byte("brand new file"))

	incReq := req
	incReq.ParentHandle = base.Handle
	incReq.ParentManifest = base.Manifest
	inc, err := p.CreateSnapshot(ctx, incReq)
	if err != nil {
		t.Fatalf("incremental CreateSnapshot: %v", err)
	}
	if inc.Manifest == nil || len(inc.Manifest.Entries) != 3 {
		t.Fatalf("incremental manifest entries = %v, want 3", inc.Manifest)
	}

	baseDir := filepath.Join(snapRoot, base.Handle)
	incDir := filepath.Join(snapRoot, inc.Handle)

	// unchanged.txt must be hard-linked to the parent (shared inode, no extra copy).
	if !sameInode(t, filepath.Join(baseDir, "unchanged.txt"), filepath.Join(incDir, "unchanged.txt")) {
		t.Error("unchanged.txt was copied, not hard-linked from parent")
	}
	// mutate.txt must be a distinct inode (real copy of new content).
	if sameInode(t, filepath.Join(baseDir, "mutate.txt"), filepath.Join(incDir, "mutate.txt")) {
		t.Error("mutate.txt shares the parent inode, but it changed and must be copied")
	}
	got, _ := os.ReadFile(filepath.Join(incDir, "mutate.txt"))
	if !bytes.Equal(got, []byte("CHANGED CONTENT - longer than before")) {
		t.Errorf("incremental mutate.txt = %q, want changed content", got)
	}
	// The delta byte count must equal exactly the changed + new file sizes, not
	// the whole dataset (the unchanged file is not re-copied).
	wantDelta := int64(len("CHANGED CONTENT - longer than before") + len("brand new file"))
	if inc.ChangedBytes != wantDelta {
		t.Errorf("incremental ChangedBytes = %d, want %d (changed+new only)", inc.ChangedBytes, wantDelta)
	}

	// Deleting the parent snapshot must NOT corrupt the incremental's hard-linked
	// file (copy-on-write: data survives until the last link is gone).
	if err := p.DeleteSnapshot(ctx, req, base.Handle); err != nil {
		t.Fatalf("DeleteSnapshot(base): %v", err)
	}
	survived, rerr := os.ReadFile(filepath.Join(incDir, "unchanged.txt"))
	if rerr != nil {
		t.Fatalf("hard-linked file did not survive parent deletion: %v", rerr)
	}
	if !bytes.Equal(survived, []byte("i never change")) {
		t.Errorf("hard-linked survivor = %q, want original", survived)
	}
}

// TestFileProvider_ReplicateFull_ByteIdentical replicates a full snapshot to a
// target dir and asserts every file is byte-identical.
func TestFileProvider_ReplicateFull_ByteIdentical(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	snapRoot := t.TempDir()
	target := filepath.Join(t.TempDir(), "dr-target")

	files := map[string][]byte{
		"one.txt":         []byte("file one"),
		"dir/two.bin":     bytes.Repeat([]byte{0x7}, 1500),
		"dir/sub/three.c": []byte("int main(){return 0;}"),
	}
	for rel, content := range files {
		writeVolumeFile(t, volumeDir, rel, content)
	}

	p := NewFileProvider()
	req := SnapshotRequest{VolumeName: "vol-c", SourceLocation: volumeDir, ArrayEndpoint: snapRoot}
	snap, err := p.CreateSnapshot(ctx, req)
	if err != nil {
		t.Fatalf("CreateSnapshot: %v", err)
	}
	transferred, err := p.ReplicateSnapshot(ctx, req, snap.Handle, target, "")
	if err != nil {
		t.Fatalf("ReplicateSnapshot: %v", err)
	}
	if transferred != snap.Manifest.TotalSize() {
		t.Errorf("full replication transferred %d, want %d", transferred, snap.Manifest.TotalSize())
	}
	for rel, content := range files {
		got, rerr := os.ReadFile(filepath.Join(target, filepath.FromSlash(rel)))
		if rerr != nil {
			t.Fatalf("reading replicated %q: %v", rel, rerr)
		}
		if !bytes.Equal(got, content) {
			t.Errorf("replicated %q not byte-identical to source", rel)
		}
	}
}

// TestFileProvider_ReplicateIncremental_TransfersOnlyDelta replicates a base,
// then replicates an incremental on top of the base target and asserts only the
// changed/new files are transferred while the target ends byte-identical to the
// child snapshot (including a deleted file being removed).
func TestFileProvider_ReplicateIncremental_TransfersOnlyDelta(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	snapRoot := t.TempDir()
	baseTarget := filepath.Join(t.TempDir(), "base-target")
	incTarget := filepath.Join(t.TempDir(), "inc-target")

	writeVolumeFile(t, volumeDir, "keep.txt", []byte("keep me"))
	writeVolumeFile(t, volumeDir, "change.txt", []byte("v1"))
	writeVolumeFile(t, volumeDir, "drop.txt", []byte("delete me later"))

	p := NewFileProvider()
	req := SnapshotRequest{VolumeName: "vol-d", SourceLocation: volumeDir, ArrayEndpoint: snapRoot}

	base, err := p.CreateSnapshot(ctx, req)
	if err != nil {
		t.Fatalf("base CreateSnapshot: %v", err)
	}
	if _, err := p.ReplicateSnapshot(ctx, req, base.Handle, baseTarget, ""); err != nil {
		t.Fatalf("base ReplicateSnapshot: %v", err)
	}

	// Change one file, delete one, keep one.
	writeVolumeFile(t, volumeDir, "change.txt", []byte("v2 longer"))
	if err := os.Remove(filepath.Join(volumeDir, "drop.txt")); err != nil {
		t.Fatalf("remove drop.txt: %v", err)
	}

	incReq := req
	incReq.ParentHandle = base.Handle
	incReq.ParentManifest = base.Manifest
	inc, err := p.CreateSnapshot(ctx, incReq)
	if err != nil {
		t.Fatalf("incremental CreateSnapshot: %v", err)
	}

	transferred, err := p.ReplicateSnapshot(ctx, incReq, inc.Handle, incTarget, baseTarget)
	if err != nil {
		t.Fatalf("incremental ReplicateSnapshot: %v", err)
	}
	// Only change.txt's new bytes are transferred (keep.txt seeded from base,
	// drop.txt removed).
	if transferred != int64(len("v2 longer")) {
		t.Errorf("incremental replication transferred %d, want %d (changed file only)", transferred, len("v2 longer"))
	}
	// The incremental target must equal the child snapshot exactly.
	if got, _ := os.ReadFile(filepath.Join(incTarget, "change.txt")); !bytes.Equal(got, []byte("v2 longer")) {
		t.Errorf("inc target change.txt = %q, want v2 longer", got)
	}
	if got, _ := os.ReadFile(filepath.Join(incTarget, "keep.txt")); !bytes.Equal(got, []byte("keep me")) {
		t.Errorf("inc target keep.txt = %q, want keep me", got)
	}
	if _, err := os.Stat(filepath.Join(incTarget, "drop.txt")); !os.IsNotExist(err) {
		t.Errorf("inc target still has drop.txt, want it deleted (err=%v)", err)
	}
	// keep.txt at the incremental target must be the SAME inode as the base
	// target (seeded via hard link), proving the base bytes were reused.
	if !sameInode(t, filepath.Join(baseTarget, "keep.txt"), filepath.Join(incTarget, "keep.txt")) {
		t.Error("kept file at inc target was copied, not seeded from base target")
	}
	// The base target's change.txt must remain v1 (copy-on-write: the delta
	// overwrite at the inc target must not mutate the base target's inode).
	if got, _ := os.ReadFile(filepath.Join(baseTarget, "change.txt")); !bytes.Equal(got, []byte("v1")) {
		t.Errorf("base target change.txt was mutated to %q, want v1 (CoW violation)", got)
	}
}

// TestFileProvider_SnapshotStatus_RealReadback exercises the poll path against
// the filesystem: a present snapshot is ready (with its manifest), a missing one
// is missing.
func TestFileProvider_SnapshotStatus_RealReadback(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	snapRoot := t.TempDir()
	writeVolumeFile(t, volumeDir, "x.txt", []byte("x"))

	p := NewFileProvider()
	req := SnapshotRequest{VolumeName: "vol-e", SourceLocation: volumeDir, ArrayEndpoint: snapRoot}
	snap, err := p.CreateSnapshot(ctx, req)
	if err != nil {
		t.Fatalf("CreateSnapshot: %v", err)
	}

	status, err := p.SnapshotStatus(ctx, req, snap.Handle)
	if err != nil {
		t.Fatalf("SnapshotStatus: %v", err)
	}
	if status.State != ProviderSnapshotReady || status.Manifest == nil {
		t.Fatalf("status = %+v, want ready with manifest", status)
	}

	missing, err := p.SnapshotStatus(ctx, req, "snap-does-not-exist")
	if err != nil {
		t.Fatalf("SnapshotStatus(missing): %v", err)
	}
	if missing.State != ProviderSnapshotMissing {
		t.Errorf("missing snapshot state = %q, want missing", missing.State)
	}
}

// hashBytes is a tiny helper mirroring hashFile for in-memory content in tests.
func hashBytes(b []byte) (string, error) {
	tmp, err := os.CreateTemp("", "hashbytes-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(b); err != nil {
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	return hashFile(tmp.Name())
}
