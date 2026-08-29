package core

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// This file is the file-delta replication driver (slide 25 "App configs / file"
// replication): a real Capturer that walks a directory tree, splits each file
// into fixed-size blocks, and ships only the blocks that differ from a known
// baseline, plus a matching Applier that reconstructs the target tree
// BYTE-IDENTICALLY. It is the rsync-style member of WP-3's first capturers.

// FileBlockSize is the fixed block size for file-delta capture (64 KiB). A file
// is split into ceil(size/FileBlockSize) blocks; a block whose content hash is
// unchanged from the baseline is skipped, so only mutated regions ship.
const FileBlockSize = 64 * 1024

// fileFrameOp is the first byte of a file-delta frame payload, distinguishing
// the payload variants carried under FrameKindFileDelta.
type fileFrameOp uint8

const (
	fileOpBlock  fileFrameOp = 1 // a single changed block of a file
	fileOpFile   fileFrameOp = 2 // a file manifest (size, block count, whole-file hash)
	fileOpDelete fileFrameOp = 3 // a path removed at the source since the baseline
)

// FileBaseline is the per-path block-hash state of a prior capture. The Capturer
// diffs the current tree against it and emits only changed blocks; an empty
// baseline (FromScratch) ships every block of every file. The Applier returns
// an updated FileBaseline after applying so a follow-on run is incremental.
type FileBaseline struct {
	// Files maps a relative slash-path to its per-block hashes and total size.
	Files map[string]FileState
}

// FileState is one file's baseline: its byte size and per-block SHA-256 hashes
// (block i covers bytes [i*FileBlockSize, min((i+1)*FileBlockSize, size))).
type FileState struct {
	Size        int64
	BlockHashes []string
	WholeHash   string
}

// NewFileBaseline returns an empty baseline (a from-scratch capture ships every
// block).
func NewFileBaseline() FileBaseline {
	return FileBaseline{Files: map[string]FileState{}}
}

// FileCapturer walks rootDir and emits FrameKindFileDelta frames for changed
// blocks + a trailing FrameKindMarker at the consistent point. It is a real
// source reader: it opens and hashes the actual on-disk bytes.
type FileCapturer struct {
	streamID string
	rootDir  string
	baseline FileBaseline
	now      func() time.Time

	closed bool
	mu     sync.Mutex
}

// NewFileCapturer builds a file-delta Capturer for rootDir on streamID, diffing
// against baseline (use NewFileBaseline() for a full capture).
func NewFileCapturer(streamID, rootDir string, baseline FileBaseline) (*FileCapturer, error) {
	if streamID == "" {
		return nil, errors.New("core: file capturer requires a stream id")
	}
	info, err := os.Stat(rootDir)
	if err != nil {
		return nil, fmt.Errorf("core: file capturer stat root %s: %w", rootDir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("core: file capturer root %s is not a directory", rootDir)
	}
	if baseline.Files == nil {
		baseline.Files = map[string]FileState{}
	}
	return &FileCapturer{streamID: streamID, rootDir: rootDir, baseline: baseline, now: time.Now}, nil
}

// Kind reports the frame kind this capturer produces.
func (c *FileCapturer) Kind() FrameKind { return FrameKindFileDelta }

// Close is a no-op (the capturer holds no long-lived handles between Start
// calls); it exists to satisfy the Capturer interface.
func (c *FileCapturer) Close() error {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	return nil
}

// Start walks the tree and emits frames on out in deterministic order (paths
// sorted), assigning Seq strictly above resumeFrom so a resume re-ships only
// the un-acked tail. It emits, per file: changed-block frames, then a file
// manifest frame; then deletion frames for baseline paths now gone; then a
// final MARKER frame pinning the consistency point. The whole walk is one
// consistency snapshot — the MARKER's SourceLSN is the snapshot's wall clock.
func (c *FileCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- Frame) error {
	// Discover the current tree deterministically.
	var paths []string
	walkErr := filepath.WalkDir(c.rootDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			return nil // skip symlinks/devices: file replication covers regular files
		}
		rel, rerr := filepath.Rel(c.rootDir, p)
		if rerr != nil {
			return rerr
		}
		paths = append(paths, filepath.ToSlash(rel))
		return nil
	})
	if walkErr != nil {
		return fmt.Errorf("core: file capturer walk %s: %w", c.rootDir, walkErr)
	}
	sort.Strings(paths)

	seq := resumeFrom
	emittedAt := c.now()
	present := make(map[string]struct{}, len(paths))

	emit := func(kind FrameKind, payload []byte, lsn string) error {
		seq++
		f := Frame{
			StreamID:  c.streamID,
			Seq:       seq,
			Kind:      kind,
			Payload:   payload,
			SourceLSN: lsn,
			EmittedAt: emittedAt,
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- f:
			return nil
		}
	}

	for _, rel := range paths {
		present[rel] = struct{}{}
		if err := ctx.Err(); err != nil {
			return err
		}
		state, prev, err := c.captureFile(ctx, rel, c.baseline.Files[rel], emit)
		if err != nil {
			return err
		}
		// Emit the file manifest so the applier can finalize (truncate to size,
		// verify whole-file hash). prev indicates whether anything was unchanged
		// (it still needs the manifest to confirm length).
		_ = prev
		manifest := encodeFileManifest(rel, state)
		if err := emit(FrameKindFileDelta, manifest, "file:"+rel); err != nil {
			return err
		}
	}

	// Deletions: any baseline path no longer present at the source.
	var deleted []string
	for rel := range c.baseline.Files {
		if _, ok := present[rel]; !ok {
			deleted = append(deleted, rel)
		}
	}
	sort.Strings(deleted)
	for _, rel := range deleted {
		if err := emit(FrameKindFileDelta, encodeFileDelete(rel), "del:"+rel); err != nil {
			return err
		}
	}

	// Final consistency marker at the snapshot's wall clock.
	markerLSN := fmt.Sprintf("fs-snapshot:%d", emittedAt.UnixNano())
	if err := emit(FrameKindMarker, nil, markerLSN); err != nil {
		return err
	}
	return nil
}

// captureFile reads rel block by block, emitting a fileOpBlock frame for each
// block whose hash differs from the baseline, and returns the file's new state.
func (c *FileCapturer) captureFile(ctx context.Context, rel string, base FileState, emit func(FrameKind, []byte, string) error) (FileState, bool, error) {
	abs := filepath.Join(c.rootDir, filepath.FromSlash(rel))
	fh, err := os.Open(abs)
	if err != nil {
		return FileState{}, false, fmt.Errorf("core: file capturer open %s: %w", rel, err)
	}
	defer fh.Close()

	whole := sha256.New()
	state := FileState{}
	buf := make([]byte, FileBlockSize)
	var idx int
	anyUnchanged := false
	for {
		if err := ctx.Err(); err != nil {
			return FileState{}, false, err
		}
		n, rerr := io.ReadFull(fh, buf)
		if n > 0 {
			block := buf[:n]
			whole.Write(block)
			sum := sha256.Sum256(block)
			h := hex.EncodeToString(sum[:])
			state.BlockHashes = append(state.BlockHashes, h)
			state.Size += int64(n)

			unchanged := idx < len(base.BlockHashes) && base.BlockHashes[idx] == h
			if unchanged {
				anyUnchanged = true
			} else {
				payload := encodeFileBlock(rel, uint64(idx), int64(idx)*FileBlockSize, block, h)
				if eerr := emit(FrameKindFileDelta, payload, fmt.Sprintf("blk:%s:%d", rel, idx)); eerr != nil {
					return FileState{}, false, eerr
				}
			}
			idx++
		}
		if rerr == io.EOF || rerr == io.ErrUnexpectedEOF {
			break
		}
		if rerr != nil {
			return FileState{}, false, fmt.Errorf("core: file capturer read %s block %d: %w", rel, idx, rerr)
		}
	}
	state.WholeHash = hex.EncodeToString(whole.Sum(nil))
	return state, anyUnchanged, nil
}

// --- file-delta applier ---------------------------------------------------

// FileApplier reconstructs the captured tree byte-identically under targetDir.
// It is idempotent on (StreamID, Seq) by construction: writing the same block to
// the same offset twice is a no-op, and the orchestrator de-dupes anyway. It
// tracks the rebuilt per-file state so it can return an updated FileBaseline and
// verify whole-file hashes at each manifest.
type FileApplier struct {
	targetDir string

	mu      sync.Mutex
	files   map[string]*applierFile
	applied uint64
}

type applierFile struct {
	path string // absolute target path
	hash struct{ blocks []string }
}

// NewFileApplier builds an applier that reconstructs into targetDir (created if
// absent).
func NewFileApplier(targetDir string) (*FileApplier, error) {
	if targetDir == "" {
		return nil, errors.New("core: file applier requires a target dir")
	}
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return nil, fmt.Errorf("core: file applier mkdir %s: %w", targetDir, err)
	}
	return &FileApplier{targetDir: targetDir, files: map[string]*applierFile{}}, nil
}

// Kind reports the frame kind this applier consumes.
func (a *FileApplier) Kind() FrameKind { return FrameKindFileDelta }

// Apply durably applies one file-delta or marker frame and returns f.Seq as the
// applied cursor. Block frames write at their byte offset; manifest frames
// truncate the file to the captured size and verify the whole-file hash; delete
// frames remove the path; the marker is a consistency no-op.
func (a *FileApplier) Apply(ctx context.Context, f Frame) (uint64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if f.Kind == FrameKindMarker {
		a.mu.Lock()
		a.applied = f.Seq
		a.mu.Unlock()
		return f.Seq, nil
	}
	if f.Kind != FrameKindFileDelta {
		return 0, fmt.Errorf("core: file applier got frame seq=%d kind %s", f.Seq, f.Kind)
	}
	if len(f.Payload) == 0 {
		return 0, fmt.Errorf("core: file applier seq=%d empty payload", f.Seq)
	}
	op := fileFrameOp(f.Payload[0])
	switch op {
	case fileOpBlock:
		if err := a.applyBlock(f); err != nil {
			return 0, err
		}
	case fileOpFile:
		if err := a.applyManifest(f); err != nil {
			return 0, err
		}
	case fileOpDelete:
		if err := a.applyDelete(f); err != nil {
			return 0, err
		}
	default:
		return 0, fmt.Errorf("core: file applier seq=%d unknown op %d", f.Seq, op)
	}
	a.mu.Lock()
	a.applied = f.Seq
	a.mu.Unlock()
	return f.Seq, nil
}

func (a *FileApplier) targetPath(rel string) (string, error) {
	clean := filepath.Clean(filepath.FromSlash(rel))
	if clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) || filepath.IsAbs(clean) {
		return "", fmt.Errorf("core: file applier rejects unsafe path %q", rel)
	}
	return filepath.Join(a.targetDir, clean), nil
}

func (a *FileApplier) applyBlock(f Frame) error {
	rel, blockIdx, offset, block, hash, err := decodeFileBlock(f.Payload)
	if err != nil {
		return fmt.Errorf("core: file applier seq=%d: %w", f.Seq, err)
	}
	// Verify the block against its shipped content hash before writing it.
	sum := sha256.Sum256(block)
	if hex.EncodeToString(sum[:]) != hash {
		return fmt.Errorf("core: file applier seq=%d block %d of %s failed content hash", f.Seq, blockIdx, rel)
	}
	abs, err := a.targetPath(rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fmt.Errorf("core: file applier mkdir for %s: %w", rel, err)
	}
	fh, err := os.OpenFile(abs, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return fmt.Errorf("core: file applier open %s: %w", rel, err)
	}
	defer fh.Close()
	if _, err := fh.WriteAt(block, offset); err != nil {
		return fmt.Errorf("core: file applier write %s @%d: %w", rel, offset, err)
	}

	a.mu.Lock()
	af := a.files[rel]
	if af == nil {
		af = &applierFile{path: abs}
		a.files[rel] = af
	}
	for len(af.hash.blocks) <= int(blockIdx) {
		af.hash.blocks = append(af.hash.blocks, "")
	}
	af.hash.blocks[blockIdx] = hash
	a.mu.Unlock()
	return nil
}

func (a *FileApplier) applyManifest(f Frame) error {
	rel, state, err := decodeFileManifest(f.Payload)
	if err != nil {
		return fmt.Errorf("core: file applier seq=%d: %w", f.Seq, err)
	}
	abs, err := a.targetPath(rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fmt.Errorf("core: file applier mkdir for %s: %w", rel, err)
	}
	// Ensure the file exists even when it had zero changed blocks (e.g. empty
	// file or a file that was fully unchanged on an incremental run already on
	// disk). OpenFile with O_CREATE is idempotent.
	fh, err := os.OpenFile(abs, os.O_RDWR|os.O_CREATE, 0o644)
	if err != nil {
		return fmt.Errorf("core: file applier open %s: %w", rel, err)
	}
	// Truncate to the captured size so a shrunk file loses its stale tail.
	if err := fh.Truncate(state.Size); err != nil {
		fh.Close()
		return fmt.Errorf("core: file applier truncate %s to %d: %w", rel, state.Size, err)
	}
	if err := fh.Sync(); err != nil {
		fh.Close()
		return fmt.Errorf("core: file applier sync %s: %w", rel, err)
	}
	fh.Close()

	// Verify the reconstructed file's whole-file hash matches the manifest.
	got, err := hashFileWhole(abs)
	if err != nil {
		return fmt.Errorf("core: file applier rehash %s: %w", rel, err)
	}
	if got != state.WholeHash {
		return fmt.Errorf("core: file applier %s whole-file hash mismatch: got %s want %s", rel, got, state.WholeHash)
	}

	a.mu.Lock()
	a.files[rel] = &applierFile{path: abs, hash: struct{ blocks []string }{blocks: state.BlockHashes}}
	a.mu.Unlock()
	return nil
}

func (a *FileApplier) applyDelete(f Frame) error {
	rel, err := decodeFileDelete(f.Payload)
	if err != nil {
		return fmt.Errorf("core: file applier seq=%d: %w", f.Seq, err)
	}
	abs, err := a.targetPath(rel)
	if err != nil {
		return err
	}
	if err := os.Remove(abs); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("core: file applier delete %s: %w", rel, err)
	}
	a.mu.Lock()
	delete(a.files, rel)
	a.mu.Unlock()
	return nil
}

// Baseline returns the reconstructed per-file block-hash state so a follow-on
// capture against this applier's output is incremental.
func (a *FileApplier) Baseline() FileBaseline {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := FileBaseline{Files: make(map[string]FileState, len(a.files))}
	for rel, af := range a.files {
		blocks := make([]string, len(af.hash.blocks))
		copy(blocks, af.hash.blocks)
		out.Files[rel] = FileState{BlockHashes: blocks}
	}
	return out
}

// hashFileWhole returns the hex SHA-256 of the entire file at path.
func hashFileWhole(path string) (string, error) {
	fh, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer fh.Close()
	h := sha256.New()
	if _, err := io.Copy(h, fh); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// --- file-delta payload codec ---------------------------------------------
//
// Each variant is a self-describing byte payload (op byte first). All ints are
// big-endian. Strings/blobs are length-prefixed (uint32). Hashes are the raw
// 32-byte SHA-256 (encoded hex by the caller only when stored in FileState).

func putString(b []byte, s string) []byte {
	var l [4]byte
	binary.BigEndian.PutUint32(l[:], uint32(len(s)))
	b = append(b, l[:]...)
	return append(b, s...)
}

func putBytes(b, v []byte) []byte {
	var l [4]byte
	binary.BigEndian.PutUint32(l[:], uint32(len(v)))
	b = append(b, l[:]...)
	return append(b, v...)
}

func getString(b []byte) (string, []byte, error) {
	if len(b) < 4 {
		return "", nil, errors.New("truncated string length")
	}
	n := binary.BigEndian.Uint32(b[:4])
	b = b[4:]
	if uint64(len(b)) < uint64(n) {
		return "", nil, fmt.Errorf("string length %d exceeds remaining %d", n, len(b))
	}
	return string(b[:n]), b[n:], nil
}

func getBytes(b []byte) ([]byte, []byte, error) {
	if len(b) < 4 {
		return nil, nil, errors.New("truncated bytes length")
	}
	n := binary.BigEndian.Uint32(b[:4])
	b = b[4:]
	if uint64(len(b)) < uint64(n) {
		return nil, nil, fmt.Errorf("bytes length %d exceeds remaining %d", n, len(b))
	}
	out := make([]byte, n)
	copy(out, b[:n])
	return out, b[n:], nil
}

func encodeFileBlock(rel string, idx uint64, offset int64, block []byte, hashHex string) []byte {
	b := make([]byte, 0, 1+4+len(rel)+8+8+4+len(block)+4+len(hashHex))
	b = append(b, byte(fileOpBlock))
	b = putString(b, rel)
	var u [8]byte
	binary.BigEndian.PutUint64(u[:], idx)
	b = append(b, u[:]...)
	binary.BigEndian.PutUint64(u[:], uint64(offset))
	b = append(b, u[:]...)
	b = putBytes(b, block)
	b = putString(b, hashHex)
	return b
}

func decodeFileBlock(payload []byte) (rel string, idx uint64, offset int64, block []byte, hashHex string, err error) {
	b := payload[1:] // skip op byte (validated by caller)
	rel, b, err = getString(b)
	if err != nil {
		return
	}
	if len(b) < 16 {
		err = errors.New("truncated block index/offset")
		return
	}
	idx = binary.BigEndian.Uint64(b[:8])
	offset = int64(binary.BigEndian.Uint64(b[8:16]))
	b = b[16:]
	block, b, err = getBytes(b)
	if err != nil {
		return
	}
	hashHex, _, err = getString(b)
	return
}

func encodeFileManifest(rel string, state FileState) []byte {
	b := []byte{byte(fileOpFile)}
	b = putString(b, rel)
	var u [8]byte
	binary.BigEndian.PutUint64(u[:], uint64(state.Size))
	b = append(b, u[:]...)
	b = putString(b, state.WholeHash)
	binary.BigEndian.PutUint64(u[:], uint64(len(state.BlockHashes)))
	b = append(b, u[:]...)
	for _, h := range state.BlockHashes {
		b = putString(b, h)
	}
	return b
}

func decodeFileManifest(payload []byte) (string, FileState, error) {
	b := payload[1:]
	rel, b, err := getString(b)
	if err != nil {
		return "", FileState{}, err
	}
	if len(b) < 8 {
		return "", FileState{}, errors.New("truncated manifest size")
	}
	var st FileState
	st.Size = int64(binary.BigEndian.Uint64(b[:8]))
	b = b[8:]
	st.WholeHash, b, err = getString(b)
	if err != nil {
		return "", FileState{}, err
	}
	if len(b) < 8 {
		return "", FileState{}, errors.New("truncated manifest block count")
	}
	count := binary.BigEndian.Uint64(b[:8])
	b = b[8:]
	st.BlockHashes = make([]string, 0, count)
	for i := uint64(0); i < count; i++ {
		var h string
		h, b, err = getString(b)
		if err != nil {
			return "", FileState{}, err
		}
		st.BlockHashes = append(st.BlockHashes, h)
	}
	return rel, st, nil
}

func encodeFileDelete(rel string) []byte {
	b := []byte{byte(fileOpDelete)}
	return putString(b, rel)
}

func decodeFileDelete(payload []byte) (string, error) {
	rel, _, err := getString(payload[1:])
	return rel, err
}
