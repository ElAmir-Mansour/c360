package core

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"sync"

	"github.com/klauspost/compress/zstd"
)

// PayloadCodec transforms a raw frame payload for the wire and back. The
// default implementation is compress -> encrypt on the way out and decrypt ->
// decompress on the way in (§3.3). It is the single place where throughput,
// compression and encryption are fixed once for every consumer.
type PayloadCodec interface {
	// Encode compresses then encrypts raw payload bytes.
	Encode(raw []byte) ([]byte, error)
	// Decode decrypts then decompresses wire bytes back to the raw payload.
	Decode(wire []byte) ([]byte, error)
}

// AESKeySize256 is the AES-256 key length in bytes.
const AESKeySize256 = 32

// zstdCodec implements PayloadCodec with zstd compression (vendored,
// github.com/klauspost/compress/zstd — already a direct module dependency, so
// no new dependency is added) and AES-256-GCM authenticated encryption. The
// per-tenant DEK is supplied by the caller; this type never derives or stores
// keys beyond the run.
type zstdCodec struct {
	gcm     cipher.AEAD
	encoder *zstd.Encoder
	decoder *zstd.Decoder
	encMu   sync.Mutex
	decMu   sync.Mutex
}

// NewPayloadCodec builds the default compress+encrypt PayloadCodec from a
// 32-byte AES-256 key. The key is typically a per-tenant DEK. It returns an
// error for any key length other than 32 bytes.
func NewPayloadCodec(key []byte) (PayloadCodec, error) {
	if len(key) != AESKeySize256 {
		return nil, fmt.Errorf("core: AES-256 key must be %d bytes, got %d", AESKeySize256, len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("core: build AES cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("core: build GCM: %w", err)
	}
	enc, err := zstd.NewWriter(nil)
	if err != nil {
		return nil, fmt.Errorf("core: build zstd encoder: %w", err)
	}
	dec, err := zstd.NewReader(nil)
	if err != nil {
		enc.Close()
		return nil, fmt.Errorf("core: build zstd decoder: %w", err)
	}
	return &zstdCodec{gcm: gcm, encoder: enc, decoder: dec}, nil
}

// Encode compresses raw with zstd then seals it with AES-256-GCM. The 12-byte
// random nonce is prepended to the ciphertext so Decode is self-contained.
func (c *zstdCodec) Encode(raw []byte) ([]byte, error) {
	c.encMu.Lock()
	compressed := c.encoder.EncodeAll(raw, make([]byte, 0, len(raw)))
	c.encMu.Unlock()

	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("core: generate GCM nonce: %w", err)
	}
	// Seal appends the ciphertext to nonce, yielding nonce||ciphertext||tag.
	sealed := c.gcm.Seal(nonce, nonce, compressed, nil)
	return sealed, nil
}

// Decode reverses Encode: it strips the prepended nonce, opens the AES-256-GCM
// ciphertext, then decompresses. A wrong key or tampered ciphertext fails the
// GCM authentication check.
func (c *zstdCodec) Decode(wire []byte) ([]byte, error) {
	ns := c.gcm.NonceSize()
	if len(wire) < ns {
		return nil, errors.New("core: ciphertext shorter than GCM nonce")
	}
	nonce, ciphertext := wire[:ns], wire[ns:]
	compressed, err := c.gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return nil, fmt.Errorf("core: GCM open (wrong key or corrupt frame): %w", err)
	}
	c.decMu.Lock()
	raw, err := c.decoder.DecodeAll(compressed, nil)
	c.decMu.Unlock()
	if err != nil {
		return nil, fmt.Errorf("core: zstd decompress: %w", err)
	}
	return raw, nil
}
