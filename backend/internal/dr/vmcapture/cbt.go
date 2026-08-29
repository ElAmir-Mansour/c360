package vmcapture

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"

	"github.com/clario360/platform/internal/datastream/core"
)

// DefaultBlockSize is the fixed CBT block unit (64 KiB). It matches
// core.FileBlockSize so the frames a VMDiskCapturer emits are reconstructed
// byte-identically by the core FileApplier on the recovery target.
const DefaultBlockSize = 64 * 1024

// vmDiskRelPath is the relative path under which a VM disk image is
// reconstructed by the core FileApplier. A VM disk source captures exactly one
// "file" (the disk image), so all block/manifest frames carry this path.
const vmDiskRelPath = "disk.img"

// file-delta payload ops. These MUST match internal/datastream/core's
// (unexported) fileFrameOp constants so the core FileApplier decodes the frames
// this capturer emits. core defines: block=1, file(manifest)=2, delete=3.
const (
	fileOpBlock  uint8 = 1
	fileOpFile   uint8 = 2
	fileOpDelete uint8 = 3
)

// BlockSource is the narrow interface a HypervisorBinding exposes to the CBT
// engine: a fixed-block-size, random-access view of a VM disk. External
// hypervisors (VMware CBT, libvirt dirty bitmaps) are NOT available in the test
// environment, so the engine is written against this interface and exercised
// with a fully-real, file-backed implementation (FileBlockSource) doing real
// I/O. A production VMwareCBTBinding/LibvirtBinding implements the same
// interface; its changed-block-query optimization is an accelerator over — not
// a replacement for — the content-hash diff the engine always computes.
type BlockSource interface {
	// Size returns the current disk size in bytes.
	Size() (int64, error)
	// ReadBlock reads block index (0-based) into dst and returns the number of
	// bytes read. dst is BlockSize long; a short read at the tail returns n <
	// len(dst) with a nil error. Reading beyond the disk returns (0, io.EOF).
	ReadBlock(index int, dst []byte) (int, error)
	// BlockSize is the fixed block size this source is read in.
	BlockSize() int
	// Close releases any handles.
	Close() error
}

// FileBlockSource is the real, tested BlockSource: a VM disk backed by an image
// FILE on disk. It does real random-access I/O (ReadAt) at block granularity,
// so the CBT engine can be fully exercised without a hypervisor. This is the
// "real-core / interface-boundary" implementation that proves the block-delta
// math against real bytes.
type FileBlockSource struct {
	f         *os.File
	blockSize int
}

// NewFileBlockSource opens path for block-level reads at blockSize. blockSize
// must be positive; zero selects DefaultBlockSize.
func NewFileBlockSource(path string, blockSize int) (*FileBlockSource, error) {
	if blockSize <= 0 {
		blockSize = DefaultBlockSize
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("vmcapture: open disk image %s: %w", path, err)
	}
	return &FileBlockSource{f: f, blockSize: blockSize}, nil
}

// Size returns the image file size in bytes.
func (s *FileBlockSource) Size() (int64, error) {
	info, err := s.f.Stat()
	if err != nil {
		return 0, fmt.Errorf("vmcapture: stat disk image: %w", err)
	}
	return info.Size(), nil
}

// BlockSize reports the fixed block size.
func (s *FileBlockSource) BlockSize() int { return s.blockSize }

// ReadBlock reads block index into dst with real ReadAt I/O. A short read at the
// final, partial block returns n < len(dst) with a nil error; a read entirely
// past the end returns (0, io.EOF).
func (s *FileBlockSource) ReadBlock(index int, dst []byte) (int, error) {
	if index < 0 {
		return 0, fmt.Errorf("vmcapture: negative block index %d", index)
	}
	offset := int64(index) * int64(s.blockSize)
	n, err := s.f.ReadAt(dst, offset)
	if err != nil {
		// io.EOF on a partial final block is expected: ReadAt fills n<len(dst)
		// bytes then reports EOF. Surface EOF only when nothing was read.
		if errors.Is(err, io.EOF) {
			if n == 0 {
				return 0, io.EOF
			}
			return n, nil
		}
		return n, fmt.Errorf("vmcapture: read disk block %d: %w", index, err)
	}
	return n, nil
}

// Close closes the underlying image file.
func (s *FileBlockSource) Close() error {
	if s.f == nil {
		return nil
	}
	return s.f.Close()
}

// CBTResult is the deterministic output of one CBT pass: the frames to emit
// (block deltas + a single manifest, plus a trailing consistency marker), the
// new full block-hash map to persist, and the delta accounting.
type CBTResult struct {
	// Frames are the ordered frames for this pass, with Seq already assigned
	// strictly above the resume cursor. The trailing frame is a MARKER pinning
	// the consistency point.
	Frames []core.Frame
	// BlockHashes is the FULL per-block content-hash map of the disk after this
	// pass (index == block index). It becomes the next pass's prior map and is
	// also the basis of the epoch content hash.
	BlockHashes []string
	// WholeHash is the SHA-256 over the entire disk's bytes (the manifest's
	// whole-file hash the applier verifies after reconstruction).
	WholeHash string
	// ImageBytes is the disk size this pass observed.
	ImageBytes int64
	// ChangedBlocks is the number of blocks emitted as deltas (0 on a no-change
	// incremental pass).
	ChangedBlocks int
	// TotalBlocks is the full block count of the disk.
	TotalBlocks int
	// PayloadBytes is the total raw byte size of the emitted frame payloads.
	PayloadBytes int64
	// SourceMarker is the consistency marker carried on the trailing MARKER
	// frame (the snapshot wall-clock anchor).
	SourceMarker string
}

// RunCBT runs one changed-block-tracking pass over src.
//
// streamID is stamped on every emitted frame. resumeFrom is the highest Seq
// already emitted for the stream; this pass assigns Seq strictly above it.
// prior is the block-hash map from the previous pass (nil/empty => full base
// pass: every block is "changed" and shipped). marker is the consistency-point
// string for the trailing MARKER frame.
//
// The algorithm is real and deterministic:
//  1. compute the block count from the current disk size,
//  2. read each block, hash it (SHA-256), and roll the whole-disk hash,
//  3. emit a block delta frame for any block whose hash differs from prior
//     (or that is newly present beyond prior's length),
//  4. emit a single manifest frame carrying the disk size, whole-disk hash and
//     the full ordered block-hash map (so the applier truncates a shrunk disk
//     and verifies the reconstruction),
//  5. if the disk shrank below prior's block count, the applier truncates via
//     the manifest size — no per-block delete is needed for a single-file disk,
//  6. emit a trailing MARKER pinning the consistency point.
//
// A pass whose disk is byte-identical to prior emits ZERO block frames and a
// manifest only when the size changed; the MARKER always closes the pass.
func RunCBT(ctx context.Context, src BlockSource, streamID string, resumeFrom uint64, prior []string, marker string) (*CBTResult, error) {
	if src == nil {
		return nil, fmt.Errorf("%w: block source is required", ErrInvalid)
	}
	if streamID == "" {
		return nil, fmt.Errorf("%w: stream id is required", ErrInvalid)
	}
	blockSize := src.BlockSize()
	if blockSize <= 0 {
		return nil, fmt.Errorf("%w: block size must be positive", ErrInvalid)
	}
	size, err := src.Size()
	if err != nil {
		return nil, err
	}
	if size < 0 {
		return nil, fmt.Errorf("%w: negative disk size %d", ErrInvalid, size)
	}

	blockCount := int((size + int64(blockSize) - 1) / int64(blockSize))

	res := &CBTResult{
		BlockHashes: make([]string, 0, blockCount),
		ImageBytes:  size,
		TotalBlocks: blockCount,
	}
	whole := sha256.New()
	buf := make([]byte, blockSize)
	seq := resumeFrom

	emit := func(kind core.FrameKind, payload []byte, lsn string) {
		seq++
		res.Frames = append(res.Frames, core.Frame{
			StreamID:  streamID,
			Seq:       seq,
			Kind:      kind,
			Payload:   payload,
			SourceLSN: lsn,
		})
		res.PayloadBytes += int64(len(payload))
	}

	for idx := 0; idx < blockCount; idx++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		n, rerr := src.ReadBlock(idx, buf)
		if rerr != nil && !errors.Is(rerr, io.EOF) {
			return nil, rerr
		}
		if n == 0 {
			// The geometry said this block exists but the source returned
			// nothing: treat as end of data.
			break
		}
		block := buf[:n]
		whole.Write(block)
		sum := sha256.Sum256(block)
		h := hex.EncodeToString(sum[:])
		res.BlockHashes = append(res.BlockHashes, h)

		offset := int64(idx) * int64(blockSize)
		changed := idx >= len(prior) || prior[idx] != h
		if changed {
			emit(core.FrameKindFileDelta, encodeBlock(vmDiskRelPath, uint64(idx), offset, block, h), fmt.Sprintf("blk:%s:%d", vmDiskRelPath, idx))
			res.ChangedBlocks++
		}
	}
	res.WholeHash = hex.EncodeToString(whole.Sum(nil))
	// TotalBlocks reflects what we actually read (a sparse / short source may
	// stop early); keep it consistent with the persisted map length.
	res.TotalBlocks = len(res.BlockHashes)

	// Emit the manifest whenever the disk content OR geometry differs from the
	// prior pass, so the applier truncates a shrunk disk and re-verifies. On a
	// genuinely identical pass (same length, same hashes) the manifest is
	// redundant and skipped — only the MARKER closes the pass.
	if manifestNeeded(prior, res.BlockHashes) {
		emit(core.FrameKindFileDelta, encodeManifest(vmDiskRelPath, size, res.WholeHash, res.BlockHashes), "manifest:"+vmDiskRelPath)
	}

	if marker == "" {
		marker = fmt.Sprintf("vm-snapshot:%s", res.WholeHash)
	}
	res.SourceMarker = marker
	emit(core.FrameKindMarker, nil, marker)
	return res, nil
}

// manifestNeeded reports whether the manifest frame must be emitted: any block
// changed, the disk grew or shrank, or there is no prior map (base pass).
func manifestNeeded(prior, current []string) bool {
	if len(prior) != len(current) {
		return true
	}
	for i := range current {
		if prior[i] != current[i] {
			return true
		}
	}
	return false
}

// EpochContentHash computes the deterministic content hash of a captured disk
// state: SHA-256 over the ordered, newline-joined block hashes. Identical disk
// content across two passes yields the same hash, which is how a no-change pass
// is proven at the epoch level.
func EpochContentHash(blockHashes []string) string {
	h := sha256.New()
	for _, bh := range blockHashes {
		h.Write([]byte(bh))
		h.Write([]byte{'\n'})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// --- file-delta payload codec (wire-compatible with internal/datastream/core's
// FileApplier). All ints are big-endian; strings/blobs are uint32-length-
// prefixed; the op byte is first. This MUST match core's encodeFileBlock /
// encodeFileManifest / encodeFileDelete byte layout exactly.

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
		return "", nil, errors.New("vmcapture: truncated string length")
	}
	n := binary.BigEndian.Uint32(b[:4])
	b = b[4:]
	if uint64(len(b)) < uint64(n) {
		return "", nil, fmt.Errorf("vmcapture: string length %d exceeds remaining %d", n, len(b))
	}
	return string(b[:n]), b[n:], nil
}

func getBytes(b []byte) ([]byte, []byte, error) {
	if len(b) < 4 {
		return nil, nil, errors.New("vmcapture: truncated bytes length")
	}
	n := binary.BigEndian.Uint32(b[:4])
	b = b[4:]
	if uint64(len(b)) < uint64(n) {
		return nil, nil, fmt.Errorf("vmcapture: bytes length %d exceeds remaining %d", n, len(b))
	}
	out := make([]byte, n)
	copy(out, b[:n])
	return out, b[n:], nil
}

func encodeBlock(rel string, idx uint64, offset int64, block []byte, hashHex string) []byte {
	b := make([]byte, 0, 1+4+len(rel)+8+8+4+len(block)+4+len(hashHex))
	b = append(b, fileOpBlock)
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

// decodeBlock parses a fileOpBlock payload. Used by tests to assert exactly the
// expected blocks were emitted and to verify the wire format round-trips.
func decodeBlock(payload []byte) (rel string, idx uint64, offset int64, block []byte, hashHex string, err error) {
	if len(payload) == 0 || payload[0] != fileOpBlock {
		err = errors.New("vmcapture: not a block payload")
		return
	}
	b := payload[1:]
	rel, b, err = getString(b)
	if err != nil {
		return
	}
	if len(b) < 16 {
		err = errors.New("vmcapture: truncated block index/offset")
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

func encodeManifest(rel string, size int64, wholeHash string, blockHashes []string) []byte {
	b := []byte{fileOpFile}
	b = putString(b, rel)
	var u [8]byte
	binary.BigEndian.PutUint64(u[:], uint64(size))
	b = append(b, u[:]...)
	b = putString(b, wholeHash)
	binary.BigEndian.PutUint64(u[:], uint64(len(blockHashes)))
	b = append(b, u[:]...)
	for _, h := range blockHashes {
		b = putString(b, h)
	}
	return b
}

// blockIndicesOf returns, in ascending order, the block indices carried by the
// fileOpBlock frames in frames. Tests use it to assert exactly which blocks an
// incremental pass shipped.
func blockIndicesOf(frames []core.Frame) ([]int, error) {
	var idxs []int
	for _, f := range frames {
		if f.Kind != core.FrameKindFileDelta || len(f.Payload) == 0 || f.Payload[0] != fileOpBlock {
			continue
		}
		_, idx, _, _, _, err := decodeBlock(f.Payload)
		if err != nil {
			return nil, err
		}
		idxs = append(idxs, int(idx))
	}
	sort.Ints(idxs)
	return idxs, nil
}
