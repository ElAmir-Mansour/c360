package store

import "errors"

// Sentinel errors visible to callers of the Store package. Subpackage-specific
// errors wrap one of these so callers can use errors.Is to discriminate.
var (
	// ErrTenantMismatch is returned when a document submitted to BulkIndex
	// carries a tenant_id that does not match the tenant scope of the call.
	ErrTenantMismatch = errors.New("siem/store: document tenant_id does not match call scope")

	// ErrIndexNotFound is returned when an operation targets an index that
	// the cluster reports as missing.
	ErrIndexNotFound = errors.New("siem/store: index not found")

	// ErrMappingConflict is returned when a bulk insert is rejected because
	// of a mapping conflict (strict-dynamic violation, type mismatch, etc.).
	ErrMappingConflict = errors.New("siem/store: mapping conflict")

	// ErrClusterRed indicates the OpenSearch cluster status is red and the
	// requested operation is not safe.
	ErrClusterRed = errors.New("siem/store: cluster status red")

	// ErrSearchTargetsIndex is returned when a caller-supplied DSL contains
	// an explicit "_index" filter; tenant scoping is the responsibility of
	// the Search method and must not be overridden by callers.
	ErrSearchTargetsIndex = errors.New("siem/store: DSL must not target _index directly")

	// ErrObjectLocked is returned by delete operations when WORM (object
	// lock) protects the object from removal.
	ErrObjectLocked = errors.New("siem/store: object locked by WORM")

	// ErrRetentionTooShort indicates an attempt to seal an object with a
	// retention shorter than the class default.
	ErrRetentionTooShort = errors.New("siem/store: retention shorter than class default")

	// ErrBucketMissing indicates the configured MinIO bucket is absent.
	ErrBucketMissing = errors.New("siem/store: bucket missing")

	// ErrDEKUnavailable is returned when the DEK cannot be obtained for any
	// reason (Vault sealed, network error, persistence failure). Callers
	// MUST NOT proceed to indexing on this error.
	ErrDEKUnavailable = errors.New("siem/store: data encryption key unavailable")

	// ErrDecryptFailed is returned when AEAD verification rejects a
	// ciphertext (tampered or wrong DEK).
	ErrDecryptFailed = errors.New("siem/store: decrypt failed")

	// ErrSelfTestFailed wraps any failure in Store.SelfTest.
	ErrSelfTestFailed = errors.New("siem/store: self-test failed")
)
