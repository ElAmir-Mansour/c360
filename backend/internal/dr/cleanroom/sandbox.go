package cleanroom

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/google/uuid"
)

// ChunkReader restores a single sealed chunk of a recovery point back to its
// original plaintext bytes (download + decrypt via the recovery-point store's
// per-tenant DEK). *service.Service satisfies it via ReadSealedChunk, so the
// clean-room engine restores the SAME bytes the recovery executor would, through
// the same crypto path. It is an interface so unit tests supply deterministic
// bytes without an object store.
type ChunkReader interface {
	ReadSealedChunk(ctx context.Context, tenantID, pointID uuid.UUID, streamID string) ([]byte, error)
}

// RecoveryPointRef is the minimal view of a recovery point the engine restores
// and validates: which streams' chunks to restore (object keys) and the sealed
// content hash to check integrity against. The caller (the service) builds it
// from the recovery_point row.
type RecoveryPointRef struct {
	ID          uuid.UUID
	GroupID     uuid.UUID
	ContentHash string
	// ObjectKeys maps stream ID -> sealed WORM object key. The engine restores
	// one chunk per entry.
	ObjectKeys map[string]string
	// tenant scopes the tenant-scoped ReadSealedChunk call. It is unexported so
	// callers set it through the engine, not by reaching into the struct.
	tenant uuid.UUID
}

// Sandbox is an isolated, process-local restore area (a unique temp dir under
// os.TempDir()). Restored chunks are written here as files so scanning operates
// on real on-disk bytes that never touch the production filesystem, then the
// whole tree is removed. It is the "clean room" the chunks are exercised in.
type Sandbox struct {
	dir string
}

// NewSandbox creates a fresh isolated temp dir for one recovery point's restore.
// The directory name embeds the recovery point id for traceability.
func NewSandbox(pointID uuid.UUID) (*Sandbox, error) {
	dir, err := os.MkdirTemp("", "clario-dr-cleanroom-"+pointID.String()+"-")
	if err != nil {
		return nil, fmt.Errorf("cleanroom: creating sandbox: %w", err)
	}
	return &Sandbox{dir: dir}, nil
}

// Dir returns the sandbox directory.
func (s *Sandbox) Dir() string { return s.dir }

// Write writes one restored chunk into the sandbox under a safe file name
// derived from the stream id, returning the absolute path. The stream id is
// sanitized so it cannot escape the sandbox (path traversal), and the write is
// 0600 so the bytes are not world-readable while quarantined.
func (s *Sandbox) Write(streamID string, data []byte) (string, error) {
	name := filepath.Base(filepath.Clean("/" + streamID + ".chunk"))
	path := filepath.Join(s.dir, name)
	// Defense in depth: ensure the resolved path stays inside the sandbox.
	if rel, err := filepath.Rel(s.dir, path); err != nil || rel == ".." || filepath.IsAbs(rel) ||
		(len(rel) >= 3 && rel[:3] == ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("cleanroom: refusing to write outside sandbox: %s", streamID)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", fmt.Errorf("cleanroom: writing chunk to sandbox: %w", err)
	}
	return path, nil
}

// Cleanup removes the sandbox directory and all restored chunks. It is safe to
// call multiple times.
func (s *Sandbox) Cleanup() error {
	if s.dir == "" {
		return nil
	}
	if err := os.RemoveAll(s.dir); err != nil {
		return fmt.Errorf("cleanroom: cleaning up sandbox: %w", err)
	}
	s.dir = ""
	return nil
}

// chainHash folds per-chunk SHA-256 hex digests into a single tamper-evidence
// hash by hashing them in order with a NUL separator. This MUST match the
// recovery-point store's chainHash so the recomputed hash over the restored
// chunks can be compared against the sealed recovery_point.content_hash.
func chainHash(hexHashes []string) string {
	h := sha256.New()
	for _, hh := range hexHashes {
		h.Write([]byte(hh))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// sha256Hex returns the lowercase hex sha256 of data.
func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// chainContentHash recomputes the recovery point's chained content hash from the
// restored chunk hashes keyed by stream id, in the same sorted-by-stream-id
// order the seal path used.
func chainContentHash(hashByStream map[string]string) string {
	streamIDs := make([]string, 0, len(hashByStream))
	for id := range hashByStream {
		streamIDs = append(streamIDs, id)
	}
	sort.Strings(streamIDs)
	hashes := make([]string, 0, len(streamIDs))
	for _, id := range streamIDs {
		hashes = append(hashes, hashByStream[id])
	}
	return chainHash(hashes)
}

// restore downloads + decrypts every sealed chunk of ref into sandbox, returning
// the restored chunks in deterministic (stream-id) order. It does NOT scan or
// check integrity — that is the engine's job — but it does record each chunk's
// sha256 and on-disk path so the engine can do both. A read failure aborts the
// whole restore (an un-restorable point cannot be validated clean).
func restore(ctx context.Context, reader ChunkReader, ref RecoveryPointRef, sandbox *Sandbox) ([]restoredChunk, error) {
	streamIDs := make([]string, 0, len(ref.ObjectKeys))
	for id := range ref.ObjectKeys {
		streamIDs = append(streamIDs, id)
	}
	sort.Strings(streamIDs)

	chunks := make([]restoredChunk, 0, len(streamIDs))
	for _, streamID := range streamIDs {
		data, err := reader.ReadSealedChunk(ctx, ref.tenantID(), ref.ID, streamID)
		if err != nil {
			return nil, fmt.Errorf("restoring sealed chunk for stream %s: %w", streamID, err)
		}
		path, err := sandbox.Write(streamID, data)
		if err != nil {
			return nil, err
		}
		chunks = append(chunks, restoredChunk{
			streamID:  streamID,
			objectKey: ref.ObjectKeys[streamID],
			path:      path,
			data:      data,
			sha256:    sha256Hex(data),
		})
	}
	return chunks, nil
}

// restoredChunk is one chunk after restore, before scanning.
type restoredChunk struct {
	streamID  string
	objectKey string
	path      string
	data      []byte
	sha256    string
}

// tenantID is carried alongside the ref so restore can call ReadSealedChunk,
// which is tenant-scoped. It is set by the engine before restore runs.
func (r RecoveryPointRef) tenantID() uuid.UUID { return r.tenant }
