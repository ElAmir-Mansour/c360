package cleanroom

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestSandbox_WriteAndCleanup(t *testing.T) {
	t.Parallel()
	sb, err := NewSandbox(uuid.New())
	if err != nil {
		t.Fatalf("NewSandbox: %v", err)
	}
	if _, statErr := os.Stat(sb.Dir()); statErr != nil {
		t.Fatalf("sandbox dir should exist: %v", statErr)
	}

	path, err := sb.Write("stream-1", []byte("chunk-bytes"))
	if err != nil {
		t.Fatalf("Write: %v", err)
	}
	if filepath.Dir(path) != sb.Dir() {
		t.Fatalf("chunk written outside sandbox: %s not under %s", path, sb.Dir())
	}
	got, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read back: %v", err)
	}
	if string(got) != "chunk-bytes" {
		t.Fatalf("round-trip mismatch: %q", got)
	}
	// 0600 permissions: not group/world readable while quarantined.
	info, _ := os.Stat(path)
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("chunk perms: got %o want 600", perm)
	}

	if err := sb.Cleanup(); err != nil {
		t.Fatalf("Cleanup: %v", err)
	}
	if _, statErr := os.Stat(path); !os.IsNotExist(statErr) {
		t.Fatalf("sandbox should be gone after cleanup")
	}
	// Idempotent.
	if err := sb.Cleanup(); err != nil {
		t.Fatalf("second Cleanup should be a no-op: %v", err)
	}
}

func TestSandbox_WriteRejectsPathTraversal(t *testing.T) {
	t.Parallel()
	sb, err := NewSandbox(uuid.New())
	if err != nil {
		t.Fatalf("NewSandbox: %v", err)
	}
	defer func() { _ = sb.Cleanup() }()

	// A malicious stream id must not escape the sandbox; it is sanitized to a
	// base name, so the file stays inside sb.Dir().
	path, err := sb.Write("../../etc/passwd", []byte("x"))
	if err != nil {
		t.Fatalf("Write with traversal id: %v", err)
	}
	if !strings.HasPrefix(path, sb.Dir()) {
		t.Fatalf("traversal escaped sandbox: %s", path)
	}
	if _, statErr := os.Stat("/etc/passwd.chunk"); statErr == nil {
		t.Fatal("path traversal wrote outside the sandbox")
	}
}

func TestChainContentHashMatchesSealPath(t *testing.T) {
	t.Parallel()
	// Independently reproduce the seal-path chain: per-chunk sha256 hex over
	// sorted stream ids, NUL-joined. This is the exact algorithm the recovery
	// point store records as content_hash, so the engine can detect tampering.
	data := map[string][]byte{
		"z-stream": []byte("zzz"),
		"a-stream": []byte("aaa"),
		"m-stream": []byte("mmm"),
	}
	hashes := map[string]string{}
	for k, v := range data {
		hashes[k] = sha256Hex(v)
	}
	got := chainContentHash(hashes)

	// Manual recomputation in sorted order.
	want := chainHash([]string{
		sha256Hex(data["a-stream"]),
		sha256Hex(data["m-stream"]),
		sha256Hex(data["z-stream"]),
	})
	if got != want {
		t.Fatalf("chainContentHash: got %s want %s", got, want)
	}
}
