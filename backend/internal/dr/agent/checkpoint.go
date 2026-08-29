// Package agent is the reusable clario-dr-agent runtime: the code that runs on
// CUSTOMER INFRASTRUCTURE (the primary site). It enrolls with the sovereign DR
// control plane over PKI/mTLS (keypair + CSR -> single-use token -> leaf cert +
// CA chain), runs the shared replication-core Capturers against local sources
// (directories, PostgreSQL), and ships the captured Frame stream — compressed,
// encrypted and resumable — to the control plane's mTLS ingest listener.
//
// The package is a library so both the standalone cmd/clario-dr-agent binary and
// any service-embedded driver use exactly the same enroll/ship/resume logic; no
// agent-side logic is duplicated between them.
//
// Resume is durable on the agent itself: a local checkpoint cache (this file)
// records, per stream, the last Seq the control plane has durably acked. On a
// restart or a control-plane reconnect the agent reloads that cursor and tells
// the Capturer + Transport to resume from it, so frames are never re-applied and
// none are lost.
package agent

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Checkpoint is the agent-local resume record for one replication stream. It is
// the agent's mirror of the control plane's RPO ledger: AckedSeq is the highest
// Seq the control plane has confirmed durable (acked back over the transport),
// so the next ship resumes at AckedSeq+1.
type Checkpoint struct {
	StreamID  string    `json:"stream_id"`
	AckedSeq  uint64    `json:"acked_seq"`
	SourceLSN string    `json:"source_lsn,omitempty"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CheckpointStore is the durable, restart-safe resume cache the agent consults
// before every ship and updates after every confirmed ack. It is satisfied by
// FileCheckpointStore (the production on-disk cache) and by an in-memory store
// in tests.
type CheckpointStore interface {
	// Load returns the persisted checkpoint for streamID. An unknown stream
	// returns a zero-valued Checkpoint (AckedSeq == 0) so the agent ships from
	// scratch — never an error.
	Load(streamID string) (Checkpoint, error)
	// Save persists cp atomically and monotonically: a Save whose AckedSeq is
	// not strictly greater than the persisted value is a safe no-op so a late or
	// duplicate ack after a resume never rewinds the cursor.
	Save(cp Checkpoint) error
}

// FileCheckpointStore is the production agent checkpoint cache: one JSON file
// per stream under a base directory, written atomically (temp file + rename) so
// a crash mid-write can never corrupt a checkpoint. It is concurrency-safe.
//
// On-disk layout: <dir>/checkpoints/<sanitized-streamID>.json. The store keeps
// the last persisted AckedSeq in memory so a Save can enforce monotonicity
// without re-reading the file on the hot path.
type FileCheckpointStore struct {
	dir string

	mu   sync.Mutex
	last map[string]uint64 // streamID -> last persisted AckedSeq (hot-path guard)
}

// NewFileCheckpointStore opens (creating if absent) the checkpoint cache rooted
// at baseDir. The actual checkpoints live in baseDir/checkpoints so the agent
// can keep its enrollment material (cert/key) alongside without collisions.
func NewFileCheckpointStore(baseDir string) (*FileCheckpointStore, error) {
	if baseDir == "" {
		return nil, errors.New("agent: checkpoint cache requires a base directory")
	}
	dir := filepath.Join(baseDir, "checkpoints")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("agent: create checkpoint cache %s: %w", dir, err)
	}
	return &FileCheckpointStore{dir: dir, last: map[string]uint64{}}, nil
}

// Load reads the on-disk checkpoint for streamID. A missing file (stream never
// shipped) yields a zero-valued Checkpoint so the caller ships from scratch.
func (s *FileCheckpointStore) Load(streamID string) (Checkpoint, error) {
	if streamID == "" {
		return Checkpoint{}, errors.New("agent: checkpoint load requires a stream id")
	}
	path := s.pathFor(streamID)
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return Checkpoint{StreamID: streamID}, nil
	}
	if err != nil {
		return Checkpoint{}, fmt.Errorf("agent: read checkpoint %s: %w", path, err)
	}
	var cp Checkpoint
	if err := json.Unmarshal(b, &cp); err != nil {
		return Checkpoint{}, fmt.Errorf("agent: parse checkpoint %s: %w", path, err)
	}
	// Guard against a hand-edited or mismatched file: bind the loaded record to
	// the requested stream id so a misnamed file cannot resume the wrong stream.
	cp.StreamID = streamID
	s.mu.Lock()
	if cp.AckedSeq > s.last[streamID] {
		s.last[streamID] = cp.AckedSeq
	}
	s.mu.Unlock()
	return cp, nil
}

// Save atomically persists cp. It is monotonic: a Save at or below the last
// persisted AckedSeq for the stream is ignored so a duplicate/late ack never
// rewinds the resume cursor.
func (s *FileCheckpointStore) Save(cp Checkpoint) error {
	if cp.StreamID == "" {
		return errors.New("agent: checkpoint save requires a stream id")
	}
	s.mu.Lock()
	if last, ok := s.last[cp.StreamID]; ok && cp.AckedSeq <= last {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()

	if cp.UpdatedAt.IsZero() {
		cp.UpdatedAt = time.Now().UTC()
	}
	b, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return fmt.Errorf("agent: marshal checkpoint %s: %w", cp.StreamID, err)
	}

	path := s.pathFor(cp.StreamID)
	tmp, err := os.CreateTemp(s.dir, ".cp-*.tmp")
	if err != nil {
		return fmt.Errorf("agent: create temp checkpoint: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()

	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return fmt.Errorf("agent: write temp checkpoint: %w", err)
	}
	// fsync the data before the rename so the rename publishes durable bytes.
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("agent: sync temp checkpoint: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("agent: close temp checkpoint: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("agent: publish checkpoint %s: %w", path, err)
	}
	cleanup = false
	// Best-effort fsync of the directory so the rename itself is durable.
	if dir, derr := os.Open(s.dir); derr == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}

	s.mu.Lock()
	s.last[cp.StreamID] = cp.AckedSeq
	s.mu.Unlock()
	return nil
}

// List returns the checkpoints for every stream the cache currently knows
// about, ordered by stream id. It is used by the runtime to resume all streams
// after a restart and by operators inspecting the cache.
func (s *FileCheckpointStore) List() ([]Checkpoint, error) {
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, fmt.Errorf("agent: list checkpoint cache %s: %w", s.dir, err)
	}
	var out []Checkpoint
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			return nil, fmt.Errorf("agent: read checkpoint %s: %w", e.Name(), err)
		}
		var cp Checkpoint
		if err := json.Unmarshal(b, &cp); err != nil {
			return nil, fmt.Errorf("agent: parse checkpoint %s: %w", e.Name(), err)
		}
		out = append(out, cp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StreamID < out[j].StreamID })
	return out, nil
}

// pathFor maps a stream id to its checkpoint file path. The stream id is a UUID
// in production, but we still sanitize to keep arbitrary ids filesystem-safe.
func (s *FileCheckpointStore) pathFor(streamID string) string {
	return filepath.Join(s.dir, sanitizeFilename(streamID)+".json")
}

// sanitizeFilename replaces any character that is not a safe filename rune with
// an underscore so a stream id can never escape the cache directory.
func sanitizeFilename(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	if len(out) == 0 {
		return "stream"
	}
	return string(out)
}

// MemoryCheckpointStore is an in-memory CheckpointStore for tests and ephemeral
// runs. It enforces the same monotonic Save semantics as the file store.
type MemoryCheckpointStore struct {
	mu    sync.Mutex
	store map[string]Checkpoint
}

// NewMemoryCheckpointStore returns an empty in-memory checkpoint cache.
func NewMemoryCheckpointStore() *MemoryCheckpointStore {
	return &MemoryCheckpointStore{store: map[string]Checkpoint{}}
}

// Load returns the in-memory checkpoint for streamID (zero value if unknown).
func (m *MemoryCheckpointStore) Load(streamID string) (Checkpoint, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if cp, ok := m.store[streamID]; ok {
		return cp, nil
	}
	return Checkpoint{StreamID: streamID}, nil
}

// Save records cp monotonically.
func (m *MemoryCheckpointStore) Save(cp Checkpoint) error {
	if cp.StreamID == "" {
		return errors.New("agent: checkpoint save requires a stream id")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if cur, ok := m.store[cp.StreamID]; ok && cp.AckedSeq <= cur.AckedSeq {
		return nil
	}
	if cp.UpdatedAt.IsZero() {
		cp.UpdatedAt = time.Now().UTC()
	}
	m.store[cp.StreamID] = cp
	return nil
}
