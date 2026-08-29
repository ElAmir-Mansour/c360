package crypto

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"
	"strings"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

const (
	// CiphertextPrefix marks an encrypted field. Decrypt rejects strings
	// missing this prefix as invalid.
	CiphertextPrefix = "enc:v1:"
	// gcmNonceSize is the 96-bit (12-byte) IV size used by AES-GCM.
	gcmNonceSize = 12
)

// FieldCrypto encrypts/decrypts PII fields in a SIEM Document.
type FieldCrypto interface {
	EncryptDocument(ctx context.Context, tenantID uuid.UUID, indexName string,
		doc storetypes.Document) (encryptedDoc storetypes.Document, dekRef storetypes.DEKRef, err error)
	DecryptDocument(ctx context.Context, tenantID uuid.UUID, dekRef storetypes.DEKRef,
		encryptedDoc storetypes.Document) (plaintextDoc storetypes.Document, err error)
}

// FieldCryptoDeps wires the FieldCrypto implementation.
type FieldCryptoDeps struct {
	DEK DEKManager
	PII PIIRegistry
	Reg prometheus.Registerer
}

type fieldCrypto struct {
	deps FieldCryptoDeps

	encryptedFields prometheus.Counter
	encryptFailures prometheus.Counter
	decryptFailures prometheus.Counter
}

// NewFieldCrypto builds a FieldCrypto. Returns error if any dep is missing.
func NewFieldCrypto(deps FieldCryptoDeps) (FieldCrypto, error) {
	if deps.DEK == nil {
		return nil, fmt.Errorf("crypto: FieldCrypto requires DEK manager")
	}
	if deps.PII == nil {
		return nil, fmt.Errorf("crypto: FieldCrypto requires PII registry")
	}
	fc := &fieldCrypto{deps: deps}
	fc.encryptedFields = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "siem_pii_fields_encrypted_total",
		Help: "Number of PII field values encrypted across all calls.",
	})
	fc.encryptFailures = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "siem_pii_encrypt_failures_total",
		Help: "Number of EncryptDocument calls that returned an error.",
	})
	fc.decryptFailures = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "siem_pii_decrypt_failures_total",
		Help: "Number of DecryptDocument calls that returned an error.",
	})
	if deps.Reg != nil {
		deps.Reg.MustRegister(fc.encryptedFields, fc.encryptFailures, fc.decryptFailures)
	}
	return fc, nil
}

func (f *fieldCrypto) EncryptDocument(ctx context.Context, tenantID uuid.UUID, indexName string, doc storetypes.Document) (storetypes.Document, storetypes.DEKRef, error) {
	if doc == nil {
		return nil, "", fmt.Errorf("crypto: nil document")
	}

	dek, kekVersion, err := f.deps.DEK.Get(ctx, tenantID, indexName)
	if err != nil {
		f.encryptFailures.Inc()
		return nil, "", err
	}
	gcm, err := newGCM(dek)
	if err != nil {
		f.encryptFailures.Inc()
		return nil, "", err
	}

	encrypted := make([]string, 0)
	for _, path := range f.deps.PII.AllPaths() {
		val, ok := getPath(doc, path)
		if !ok {
			continue
		}
		s, ok := val.(string)
		if !ok || s == "" {
			continue
		}
		ct, encErr := encryptValue(gcm, []byte(s))
		if encErr != nil {
			f.encryptFailures.Inc()
			return nil, "", encErr
		}
		setPath(doc, path, ct)
		encrypted = append(encrypted, path)
		f.encryptedFields.Inc()
	}

	dekRef := storetypes.NewDEKRef(tenantID, indexName, kekVersion)
	if len(encrypted) > 0 {
		piiNode := ensureMap(doc, "pii")
		piiNode["encrypted_fields"] = encrypted
		piiNode["dek_ref"] = string(dekRef)
	}

	return doc, dekRef, nil
}

func (f *fieldCrypto) DecryptDocument(ctx context.Context, tenantID uuid.UUID, dekRef storetypes.DEKRef, doc storetypes.Document) (storetypes.Document, error) {
	if doc == nil {
		return nil, fmt.Errorf("crypto: nil document")
	}
	indexName, _, err := parseDEKRef(dekRef)
	if err != nil {
		f.decryptFailures.Inc()
		return nil, err
	}
	dek, _, err := f.deps.DEK.Get(ctx, tenantID, indexName)
	if err != nil {
		f.decryptFailures.Inc()
		return nil, err
	}
	gcm, err := newGCM(dek)
	if err != nil {
		f.decryptFailures.Inc()
		return nil, err
	}

	piiNode, _ := doc["pii"].(map[string]any)
	if piiNode == nil {
		return doc, nil
	}
	paths := stringSlice(piiNode["encrypted_fields"])
	for _, path := range paths {
		val, ok := getPath(doc, path)
		if !ok {
			continue
		}
		s, ok := val.(string)
		if !ok || !strings.HasPrefix(s, CiphertextPrefix) {
			continue
		}
		pt, decErr := decryptValue(gcm, s)
		if decErr != nil {
			f.decryptFailures.Inc()
			return nil, decErr
		}
		setPath(doc, path, string(pt))
	}
	return doc, nil
}

// --- internals ---

func newGCM(dek []byte) (cipher.AEAD, error) {
	if len(dek) != 32 {
		return nil, fmt.Errorf("%w: got %d bytes", ErrInvalidDEK, len(dek))
	}
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func encryptValue(gcm cipher.AEAD, plaintext []byte) (string, error) {
	nonce := make([]byte, gcmNonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("crypto: random nonce: %w", err)
	}
	// Seal returns nonce-less ciphertext||tag; we prepend our own nonce.
	sealed := gcm.Seal(nil, nonce, plaintext, nil)
	out := make([]byte, 0, len(nonce)+len(sealed))
	out = append(out, nonce...)
	out = append(out, sealed...)
	return CiphertextPrefix + base64.RawURLEncoding.EncodeToString(out), nil
}

func decryptValue(gcm cipher.AEAD, s string) ([]byte, error) {
	if !strings.HasPrefix(s, CiphertextPrefix) {
		return nil, fmt.Errorf("%w: missing prefix", ErrInvalidCiphertext)
	}
	raw, err := base64.RawURLEncoding.DecodeString(s[len(CiphertextPrefix):])
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidCiphertext, err)
	}
	if len(raw) < gcmNonceSize+1 {
		return nil, fmt.Errorf("%w: short", ErrInvalidCiphertext)
	}
	nonce := raw[:gcmNonceSize]
	ct := raw[gcmNonceSize:]
	pt, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDecryptFailed, err)
	}
	return pt, nil
}

// parseDEKRef extracts (indexName, kekVersion) from "siem-tenant-{t}/{idx}#{ver}".
func parseDEKRef(ref storetypes.DEKRef) (string, int, error) {
	s := string(ref)
	hashIdx := strings.LastIndex(s, "#")
	if hashIdx <= 0 {
		return "", 0, fmt.Errorf("%w: bad dek_ref", ErrInvalidCiphertext)
	}
	verStr := s[hashIdx+1:]
	if verStr == "" {
		return "", 0, fmt.Errorf("%w: empty dek_ref version", ErrInvalidCiphertext)
	}
	prefix := s[:hashIdx]
	slash := strings.Index(prefix, "/")
	if slash <= 0 || slash == len(prefix)-1 {
		return "", 0, fmt.Errorf("%w: bad dek_ref", ErrInvalidCiphertext)
	}
	indexName := prefix[slash+1:]
	ver := 0
	for _, r := range verStr {
		if r < '0' || r > '9' {
			return "", 0, fmt.Errorf("%w: bad dek_ref version", ErrInvalidCiphertext)
		}
		ver = ver*10 + int(r-'0')
	}
	return indexName, ver, nil
}

// getPath walks doc by dotted path. Returns (value, true) iff every segment
// resolves to a map[string]any along the way.
func getPath(doc storetypes.Document, path string) (any, bool) {
	parts := strings.Split(path, ".")
	var cur any = map[string]any(doc)
	for _, p := range parts {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		v, ok := m[p]
		if !ok {
			return nil, false
		}
		cur = v
	}
	return cur, true
}

// setPath replaces or creates the value at the dotted path. Missing
// intermediate maps are NOT created — setPath is only called by Encrypt
// AFTER getPath proved every intermediate exists.
func setPath(doc storetypes.Document, path string, val any) {
	parts := strings.Split(path, ".")
	var cur any = map[string]any(doc)
	for i, p := range parts {
		m, ok := cur.(map[string]any)
		if !ok {
			return
		}
		if i == len(parts)-1 {
			m[p] = val
			return
		}
		cur = m[p]
	}
}

// ensureMap returns doc[key] as a map[string]any, creating it if absent.
func ensureMap(doc storetypes.Document, key string) map[string]any {
	if existing, ok := doc[key].(map[string]any); ok {
		return existing
	}
	m := map[string]any{}
	doc[key] = m
	return m
}

func stringSlice(v any) []string {
	switch t := v.(type) {
	case []string:
		out := make([]string, len(t))
		copy(out, t)
		return out
	case []any:
		out := make([]string, 0, len(t))
		for _, e := range t {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}
