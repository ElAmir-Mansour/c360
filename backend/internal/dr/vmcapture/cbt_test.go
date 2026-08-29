package vmcapture_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/vmcapture"
)

// blockSize used across CBT tests: small enough to make several blocks from a
// modest image, but exercised with real file I/O.
const testBlockSize = 4096

// writeImage writes data to a fresh image file under t.TempDir and returns its
// path.
func writeImage(t *testing.T, data []byte) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "disk.img")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatalf("write image: %v", err)
	}
	return path
}

// randomImage builds a deterministic-per-call image of n blocks of testBlockSize
// with per-block distinct content so block hashes differ.
func randomImage(t *testing.T, blocks int) []byte {
	t.Helper()
	buf := make([]byte, blocks*testBlockSize)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return buf
}

// runPass runs one CBT pass over the image file and returns the result.
func runPass(t *testing.T, path string, resumeFrom uint64, prior []string) *vmcapture.CBTResult {
	t.Helper()
	src, err := vmcapture.NewFileBlockSource(path, testBlockSize)
	if err != nil {
		t.Fatalf("NewFileBlockSource: %v", err)
	}
	defer src.Close()
	res, err := vmcapture.RunCBT(context.Background(), src, "stream-1", resumeFrom, prior, "")
	if err != nil {
		t.Fatalf("RunCBT: %v", err)
	}
	return res
}

// TestCBT_BaseCapturesEveryBlock proves the first pass ships every block plus a
// manifest plus a closing marker, and that the core FileApplier reconstructs the
// disk byte-identically from the emitted frames.
func TestCBT_BaseCapturesEveryBlock(t *testing.T) {
	t.Parallel()
	const blocks = 5
	data := randomImage(t, blocks)
	path := writeImage(t, data)

	res := runPass(t, path, 0, nil)

	if res.ChangedBlocks != blocks {
		t.Fatalf("base pass changed blocks = %d, want %d", res.ChangedBlocks, blocks)
	}
	if res.TotalBlocks != blocks {
		t.Fatalf("base pass total blocks = %d, want %d", res.TotalBlocks, blocks)
	}
	gotIdx := blockIndices(t, res.Frames)
	wantIdx := []int{0, 1, 2, 3, 4}
	if !equalInts(gotIdx, wantIdx) {
		t.Fatalf("base block indices = %v, want %v", gotIdx, wantIdx)
	}
	// Frame layout: 5 block frames + 1 manifest frame + 1 marker = 7.
	if len(res.Frames) != blocks+2 {
		t.Fatalf("base frame count = %d, want %d", len(res.Frames), blocks+2)
	}
	if last := res.Frames[len(res.Frames)-1]; last.Kind != core.FrameKindMarker {
		t.Fatalf("last frame kind = %s, want MARKER", last.Kind)
	}
	// Seq is strictly increasing from 1.
	for i, f := range res.Frames {
		if f.Seq != uint64(i+1) {
			t.Fatalf("frame %d seq = %d, want %d", i, f.Seq, i+1)
		}
	}

	// Reconstruct byte-identically with the REAL core FileApplier.
	assertReconstructs(t, res.Frames, data)
}

// TestCBT_IncrementalEmitsOnlyChangedBlocks is the headline requirement: after a
// base pass, modify exactly 2 blocks; the next pass must emit ONLY those 2
// blocks (plus the manifest + marker), advance nothing else, and still
// reconstruct byte-identically.
func TestCBT_IncrementalEmitsOnlyChangedBlocks(t *testing.T) {
	t.Parallel()
	const blocks = 6
	data := randomImage(t, blocks)
	path := writeImage(t, data)

	base := runPass(t, path, 0, nil)
	assertReconstructs(t, base.Frames, data)

	// Modify exactly block 1 and block 4 in place (full-block overwrites).
	modified := append([]byte(nil), data...)
	overwriteBlock(modified, 1)
	overwriteBlock(modified, 4)
	if err := os.WriteFile(path, modified, 0o600); err != nil {
		t.Fatalf("rewrite image: %v", err)
	}

	resumeFrom := base.Frames[len(base.Frames)-1].Seq
	inc := runPass(t, path, resumeFrom, base.BlockHashes)

	if inc.ChangedBlocks != 2 {
		t.Fatalf("incremental changed blocks = %d, want 2", inc.ChangedBlocks)
	}
	gotIdx := blockIndices(t, inc.Frames)
	if !equalInts(gotIdx, []int{1, 4}) {
		t.Fatalf("incremental block indices = %v, want [1 4]", gotIdx)
	}
	// 2 block frames + 1 manifest + 1 marker = 4.
	if len(inc.Frames) != 4 {
		t.Fatalf("incremental frame count = %d, want 4", len(inc.Frames))
	}
	// Seq continues strictly above the resume cursor.
	if inc.Frames[0].Seq != resumeFrom+1 {
		t.Fatalf("incremental first seq = %d, want %d", inc.Frames[0].Seq, resumeFrom+1)
	}

	// Applying base THEN incremental frames reconstructs the MODIFIED disk.
	all := append(append([]core.Frame(nil), base.Frames...), inc.Frames...)
	assertReconstructs(t, all, modified)
}

// TestCBT_UnchangedRecaptureEmitsNothing proves an identical re-capture ships no
// block frames and no manifest — only the closing marker — and the content hash
// is stable across the two passes.
func TestCBT_UnchangedRecaptureEmitsNothing(t *testing.T) {
	t.Parallel()
	const blocks = 4
	data := randomImage(t, blocks)
	path := writeImage(t, data)

	base := runPass(t, path, 0, nil)
	resumeFrom := base.Frames[len(base.Frames)-1].Seq

	inc := runPass(t, path, resumeFrom, base.BlockHashes)
	if inc.ChangedBlocks != 0 {
		t.Fatalf("unchanged re-capture changed blocks = %d, want 0", inc.ChangedBlocks)
	}
	if len(inc.Frames) != 1 {
		t.Fatalf("unchanged re-capture frame count = %d, want 1 (marker only)", len(inc.Frames))
	}
	if inc.Frames[0].Kind != core.FrameKindMarker {
		t.Fatalf("unchanged re-capture frame kind = %s, want MARKER", inc.Frames[0].Kind)
	}
	// The epoch content hash is identical when content is identical.
	if vmcapture.EpochContentHash(base.BlockHashes) != vmcapture.EpochContentHash(inc.BlockHashes) {
		t.Fatalf("content hash changed across an unchanged re-capture")
	}
}

// TestCBT_PartialTailBlock proves a non-block-aligned image (a partial final
// block) is captured and reconstructed byte-identically.
func TestCBT_PartialTailBlock(t *testing.T) {
	t.Parallel()
	data := randomImage(t, 2)
	data = append(data, []byte("partial-tail-bytes")...) // a short final block
	path := writeImage(t, data)

	res := runPass(t, path, 0, nil)
	if res.TotalBlocks != 3 {
		t.Fatalf("total blocks = %d, want 3 (2 full + 1 partial)", res.TotalBlocks)
	}
	if int64(len(data)) != res.ImageBytes {
		t.Fatalf("image bytes = %d, want %d", res.ImageBytes, len(data))
	}
	assertReconstructs(t, res.Frames, data)
}

// TestCBT_ShrinkTruncatesTarget proves that when the disk shrinks, the manifest
// re-emits and the applier truncates the target so the stale tail is gone.
func TestCBT_ShrinkTruncatesTarget(t *testing.T) {
	t.Parallel()
	data := randomImage(t, 4)
	path := writeImage(t, data)
	base := runPass(t, path, 0, nil)

	// Shrink to 2 blocks.
	shrunk := data[:2*testBlockSize]
	if err := os.WriteFile(path, shrunk, 0o600); err != nil {
		t.Fatalf("shrink image: %v", err)
	}
	resumeFrom := base.Frames[len(base.Frames)-1].Seq
	inc := runPass(t, path, resumeFrom, base.BlockHashes)

	// No block content changed in blocks 0..1, but the geometry shrank, so a
	// manifest must re-emit (truncation) even with 0 changed blocks.
	if inc.ChangedBlocks != 0 {
		t.Fatalf("shrink changed blocks = %d, want 0", inc.ChangedBlocks)
	}
	if !hasManifest(inc.Frames) {
		t.Fatalf("shrink pass did not emit a manifest frame")
	}
	all := append(append([]core.Frame(nil), base.Frames...), inc.Frames...)
	assertReconstructs(t, all, shrunk)
}

// TestCBT_DeterministicHash proves two independent captures of identical bytes
// produce identical block hashes and whole-disk hash.
func TestCBT_DeterministicHash(t *testing.T) {
	t.Parallel()
	data := randomImage(t, 3)
	p1 := writeImage(t, data)
	p2 := writeImage(t, data)
	r1 := runPass(t, p1, 0, nil)
	r2 := runPass(t, p2, 0, nil)
	if r1.WholeHash != r2.WholeHash {
		t.Fatalf("whole-disk hash differs for identical content: %s vs %s", r1.WholeHash, r2.WholeHash)
	}
	if vmcapture.EpochContentHash(r1.BlockHashes) != vmcapture.EpochContentHash(r2.BlockHashes) {
		t.Fatalf("epoch content hash differs for identical content")
	}
	// Cross-check whole-disk hash against an independent computation.
	want := sha256.Sum256(data)
	if r1.WholeHash != hex.EncodeToString(want[:]) {
		t.Fatalf("whole-disk hash = %s, want %s", r1.WholeHash, hex.EncodeToString(want[:]))
	}
}

// --- helpers ----------------------------------------------------------------

func overwriteBlock(data []byte, idx int) {
	start := idx * testBlockSize
	end := start + testBlockSize
	if end > len(data) {
		end = len(data)
	}
	for i := start; i < end; i++ {
		data[i] ^= 0xFF // flip every byte so the block hash certainly changes
	}
}

func blockIndices(t *testing.T, frames []core.Frame) []int {
	t.Helper()
	idx, err := vmcapture.BlockIndicesForTest(frames)
	if err != nil {
		t.Fatalf("decode block indices: %v", err)
	}
	return idx
}

func hasManifest(frames []core.Frame) bool {
	for _, f := range frames {
		if f.Kind == core.FrameKindFileDelta && len(f.Payload) > 0 && f.Payload[0] == 2 { // fileOpFile
			return true
		}
	}
	return false
}

// assertReconstructs applies frames through the REAL core FileApplier and
// asserts the reconstructed disk.img equals want byte-for-byte. This proves the
// CBT frames are wire-compatible with the existing apply path.
func assertReconstructs(t *testing.T, frames []core.Frame, want []byte) {
	t.Helper()
	target := t.TempDir()
	applier, err := core.NewFileApplier(target)
	if err != nil {
		t.Fatalf("NewFileApplier: %v", err)
	}
	for _, f := range frames {
		if _, err := applier.Apply(context.Background(), f); err != nil {
			t.Fatalf("apply seq=%d kind=%s: %v", f.Seq, f.Kind, err)
		}
	}
	got, err := os.ReadFile(filepath.Join(target, "disk.img"))
	if err != nil {
		t.Fatalf("read reconstructed disk: %v", err)
	}
	if !bytes.Equal(got, want) {
		t.Fatalf("reconstructed disk differs: got %d bytes, want %d bytes", len(got), len(want))
	}
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
