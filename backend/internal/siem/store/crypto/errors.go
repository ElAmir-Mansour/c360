package crypto

import "errors"

// Sentinel errors. Wrappers in this package always wrap one of these so
// callers can use errors.Is to discriminate.
var (
	// ErrDEKUnavailable is returned when the DEK cannot be obtained for any
	// reason (Vault sealed, network error, persistence failure). Callers MUST
	// NOT proceed to indexing on this error.
	ErrDEKUnavailable = errors.New("crypto: data encryption key unavailable")

	// ErrDecryptFailed is returned when AEAD verification rejects a
	// ciphertext (tampered or wrong DEK).
	ErrDecryptFailed = errors.New("crypto: decrypt failed")

	// ErrInvalidCiphertext is returned when a value does not match the
	// "enc:v1:<base64url>" format expected by DecryptDocument.
	ErrInvalidCiphertext = errors.New("crypto: invalid ciphertext format")

	// ErrInvalidDEK is returned for DEKs of the wrong length (not 32 bytes).
	ErrInvalidDEK = errors.New("crypto: invalid DEK length")

	// ErrPIIRegistryLoad is returned when the embedded pii-fields.yaml fails
	// to parse.
	ErrPIIRegistryLoad = errors.New("crypto: pii registry load failed")
)
