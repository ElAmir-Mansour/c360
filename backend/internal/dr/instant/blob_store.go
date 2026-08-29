package instant

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
)

// OverlayBlobStore holds large overlay chunk payloads outside Postgres. The DB
// row remains the authoritative index, origin, byte length, and content hash;
// this store only owns the raw bytes addressed by storage_ref.
type OverlayBlobStore interface {
	Backend() string
	Put(ctx context.Context, tenantID, sessionID uuid.UUID, index int64, origin string, data []byte, contentHash string) (ref string, err error)
	Get(ctx context.Context, ref string) ([]byte, error)
}

// FileOverlayBlobStore is a durable local filesystem implementation of
// OverlayBlobStore. Deployments can mount this path on block/object-backed
// storage while keeping Postgres as metadata only.
type FileOverlayBlobStore struct {
	root string
}

// NewFileOverlayBlobStore constructs a filesystem-backed overlay payload store.
func NewFileOverlayBlobStore(root string) (*FileOverlayBlobStore, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, errors.New("instant overlay file store: root is required")
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("instant overlay file store: resolving root: %w", err)
	}
	if err := os.MkdirAll(abs, 0o750); err != nil {
		return nil, fmt.Errorf("instant overlay file store: creating root: %w", err)
	}
	return &FileOverlayBlobStore{root: abs}, nil
}

func (s *FileOverlayBlobStore) Backend() string { return "file" }

func (s *FileOverlayBlobStore) Put(ctx context.Context, tenantID, sessionID uuid.UUID, index int64, origin string, data []byte, contentHash string) (string, error) {
	if err := ctx.Err(); err != nil {
		return "", err
	}
	if contentHash == "" {
		return "", errors.New("instant overlay file store: content hash is required")
	}
	ref := filepath.ToSlash(filepath.Join(tenantID.String(), sessionID.String(), fmt.Sprintf("%020d-%s-%s.chunk", index, origin, contentHash)))
	path, err := s.pathForRef(ref)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return "", fmt.Errorf("instant overlay file store: creating chunk dir: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".chunk-*")
	if err != nil {
		return "", fmt.Errorf("instant overlay file store: creating temp chunk: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("instant overlay file store: writing temp chunk: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return "", fmt.Errorf("instant overlay file store: syncing temp chunk: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("instant overlay file store: closing temp chunk: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return "", fmt.Errorf("instant overlay file store: publishing chunk: %w", err)
	}
	cleanup = false
	return ref, nil
}

func (s *FileOverlayBlobStore) Get(ctx context.Context, ref string) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	path, err := s.pathForRef(ref)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("instant overlay file store: reading chunk %q: %w", ref, err)
	}
	return data, nil
}

func (s *FileOverlayBlobStore) pathForRef(ref string) (string, error) {
	cleaned := filepath.Clean(filepath.FromSlash(strings.TrimSpace(ref)))
	if cleaned == "." || strings.HasPrefix(cleaned, ".."+string(os.PathSeparator)) || filepath.IsAbs(cleaned) {
		return "", fmt.Errorf("instant overlay file store: invalid storage ref %q", ref)
	}
	path := filepath.Join(s.root, cleaned)
	rel, err := filepath.Rel(s.root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("instant overlay file store: storage ref escapes root %q", ref)
	}
	return path, nil
}
