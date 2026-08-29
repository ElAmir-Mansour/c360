package core

import (
	"bytes"
	"context"
	"crypto/rand"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"
)

// writeFile writes content to relative path rel under dir, creating parents.
func writeFile(t *testing.T, dir, rel string, content []byte) {
	t.Helper()
	abs := filepath.Join(dir, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		t.Fatalf("mkdir for %s: %v", rel, err)
	}
	if err := os.WriteFile(abs, content, 0o644); err != nil {
		t.Fatalf("write %s: %v", rel, err)
	}
}

// randomBytes returns n cryptographically-random bytes (real, varied content
// across multiple blocks so the block-delta logic is genuinely exercised).
func randomBytes(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("rand: %v", err)
	}
	return b
}

// runFileReplication captures sourceDir, ships every frame over a real
// StreamTransport (net.Pipe), and applies into targetDir, returning the
// applier. baseline allows an incremental run.
func runFileReplication(t *testing.T, sourceDir, targetDir string, baseline FileBaseline) *FileApplier {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	cap, err := NewFileCapturer("fs-stream", sourceDir, baseline)
	if err != nil {
		t.Fatalf("NewFileCapturer: %v", err)
	}
	app, err := NewFileApplier(targetDir)
	if err != nil {
		t.Fatalf("NewFileApplier: %v", err)
	}

	sendT, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("sender transport: %v", err)
	}
	recvT, err := NewStreamTransport(testDEK)
	if err != nil {
		t.Fatalf("receiver transport: %v", err)
	}
	sender, receiver := NewPipeConnPair()

	// Capturer -> source channel.
	captured := make(chan Frame, 16)
	captureErr := make(chan error, 1)
	go func() {
		captureErr <- cap.Start(ctx, 0, captured)
		close(captured)
	}()

	// Receiver -> apply in strict Seq order (the capturer emits in order over a
	// reliable pipe, so contiguous apply is straightforward here; the pipeline
	// reorder test covers out-of-order delivery separately).
	applyErr := make(chan error, 1)
	go func() {
		frames, ack, errs := recvT.ReceiveOver(ctx, receiver)
		var next uint64 = 1
		for f := range frames {
			if f.Seq != next {
				applyErr <- &seqError{want: next, got: f.Seq}
				return
			}
			if _, err := app.Apply(ctx, f); err != nil {
				applyErr <- err
				return
			}
			ack(f.Seq)
			next++
		}
		<-errs
		applyErr <- nil
	}()

	// Sender drains captured frames over the pipe.
	sendErr := sendT.SendOver(ctx, sender, captured)
	_ = sender.Close()

	if err := <-captureErr; err != nil {
		t.Fatalf("capture: %v", err)
	}
	if sendErr != nil && !isClosedConnErr(sendErr) {
		// A clean drain returns nil; a closed-pipe after drain is acceptable.
		if !errorsIsClosed(sendErr) {
			t.Fatalf("send: %v", sendErr)
		}
	}
	if err := <-applyErr; err != nil {
		t.Fatalf("apply: %v", err)
	}
	return app
}

type seqError struct{ want, got uint64 }

func (e *seqError) Error() string { return "out-of-order frame" }

func errorsIsClosed(err error) bool { return isClosedConnErr(err) }

// assertTreesByteIdentical fails unless every regular file under wantDir exists
// under gotDir with byte-identical content, and gotDir has no extra files.
func assertTreesByteIdentical(t *testing.T, wantDir, gotDir string) {
	t.Helper()
	want := readTree(t, wantDir)
	got := readTree(t, gotDir)

	var wantPaths, gotPaths []string
	for p := range want {
		wantPaths = append(wantPaths, p)
	}
	for p := range got {
		gotPaths = append(gotPaths, p)
	}
	sort.Strings(wantPaths)
	sort.Strings(gotPaths)

	for _, p := range wantPaths {
		gc, ok := got[p]
		if !ok {
			t.Fatalf("target missing file %q", p)
		}
		if !bytes.Equal(want[p], gc) {
			t.Fatalf("file %q differs: want %d bytes, got %d bytes", p, len(want[p]), len(gc))
		}
	}
	for _, p := range gotPaths {
		if _, ok := want[p]; !ok {
			t.Fatalf("target has extra file %q", p)
		}
	}
}

func readTree(t *testing.T, dir string) map[string][]byte {
	t.Helper()
	out := map[string][]byte{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		b, rerr := os.ReadFile(p)
		if rerr != nil {
			return rerr
		}
		out[filepath.ToSlash(rel)] = b
		return nil
	})
	if err != nil {
		t.Fatalf("read tree %s: %v", dir, err)
	}
	return out
}

func TestFileDelta_FullCapture_ByteIdentical(t *testing.T) {
	t.Parallel()
	src := t.TempDir()
	tgt := t.TempDir()

	// A realistic mix: small config files, an empty file, a multi-block binary,
	// and nested directories.
	writeFile(t, src, "app.conf", []byte("listen=0.0.0.0:8443\nworkers=8\n"))
	writeFile(t, src, "secrets/key.pem", []byte("-----BEGIN-----\nABCDEF\n-----END-----\n"))
	writeFile(t, src, "empty.flag", []byte{})
	writeFile(t, src, "data/blob.bin", randomBytes(t, FileBlockSize*3+777)) // 3+ blocks
	writeFile(t, src, "data/nested/deep/note.txt", []byte("hello deep"))

	app := runFileReplication(t, src, tgt, NewFileBaseline())
	assertTreesByteIdentical(t, src, tgt)

	// Validator ratio must be >= 0.999.
	v := NewFileTreeValidator(src, tgt)
	res, err := v.Validate(context.Background(), "fs-stream", RecoveryPointRef{})
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if res.MatchRatio < 0.999 {
		t.Fatalf("match ratio %.4f < 0.999 (%s)", res.MatchRatio, res.Details)
	}
	if !res.Passed() {
		t.Fatalf("validation did not pass: %+v", res)
	}
	_ = app
}

func TestFileDelta_IncrementalCapture_ByteIdentical(t *testing.T) {
	t.Parallel()
	src := t.TempDir()
	tgt := t.TempDir()

	writeFile(t, src, "a.txt", []byte("alpha"))
	writeFile(t, src, "b.bin", randomBytes(t, FileBlockSize*2+10))
	writeFile(t, src, "c.txt", []byte("gamma"))

	app := runFileReplication(t, src, tgt, NewFileBaseline())
	assertTreesByteIdentical(t, src, tgt)
	baseline := app.Baseline()

	// Mutate: change one block of b.bin, edit a.txt, delete c.txt, add d.txt.
	bbin := readTree(t, src)["b.bin"]
	mutated := make([]byte, len(bbin))
	copy(mutated, bbin)
	for i := 0; i < 50; i++ { // mutate the FIRST block only
		mutated[i] ^= 0xFF
	}
	writeFile(t, src, "b.bin", mutated)
	writeFile(t, src, "a.txt", []byte("ALPHA-CHANGED-and-grown"))
	if err := os.Remove(filepath.Join(src, "c.txt")); err != nil {
		t.Fatalf("rm c.txt: %v", err)
	}
	writeFile(t, src, "d.txt", []byte("delta-new"))

	// Incremental run against the prior baseline: only changed blocks + the
	// deletion + the new file should reproduce a byte-identical target.
	app2 := runFileReplication(t, src, tgt, baseline)
	assertTreesByteIdentical(t, src, tgt)

	v := NewFileTreeValidator(src, tgt)
	res, err := v.Validate(context.Background(), "fs-stream", RecoveryPointRef{})
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if res.MatchRatio < 0.999 {
		t.Fatalf("incremental match ratio %.4f < 0.999 (%s)", res.MatchRatio, res.Details)
	}
	_ = app2
}

// TestFileDelta_OnlyChangedBlocksShipped proves the delta is real: an
// incremental capture of a multi-block file with one mutated block ships only
// the changed block (plus its manifest), not the whole file.
func TestFileDelta_OnlyChangedBlocksShipped(t *testing.T) {
	t.Parallel()
	src := t.TempDir()
	writeFile(t, src, "big.bin", randomBytes(t, FileBlockSize*5))

	// First capture establishes a baseline applier.
	tgt := t.TempDir()
	app := runFileReplication(t, src, tgt, NewFileBaseline())
	baseline := app.Baseline()

	// Mutate exactly one block (block index 2).
	data := readTree(t, src)["big.bin"]
	mutated := make([]byte, len(data))
	copy(mutated, data)
	off := 2 * FileBlockSize
	for i := 0; i < 100; i++ {
		mutated[off+i] ^= 0xAA
	}
	writeFile(t, src, "big.bin", mutated)

	// Capture incrementally and count the FILE_DELTA *block* frames emitted.
	cap, err := NewFileCapturer("fs-count", src, baseline)
	if err != nil {
		t.Fatalf("NewFileCapturer: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out := make(chan Frame, 64)
	var blockFrames, manifestFrames int
	var mu sync.Mutex
	done := make(chan struct{})
	go func() {
		defer close(done)
		for f := range out {
			if f.Kind != FrameKindFileDelta {
				continue
			}
			op := fileFrameOp(f.Payload[0])
			mu.Lock()
			switch op {
			case fileOpBlock:
				blockFrames++
			case fileOpFile:
				manifestFrames++
			}
			mu.Unlock()
		}
	}()
	if err := cap.Start(ctx, 0, out); err != nil {
		t.Fatalf("capture: %v", err)
	}
	close(out)
	<-done

	if blockFrames != 1 {
		t.Fatalf("incremental capture shipped %d block frames, want exactly 1 (only the mutated block)", blockFrames)
	}
	if manifestFrames != 1 {
		t.Fatalf("incremental capture shipped %d manifest frames, want 1", manifestFrames)
	}
}
