package minio

import "errors"

// Sentinel errors. All errors returned from this package wrap one of these
// via fmt.Errorf("...: %w", ErrXxx) so callers can use errors.Is to
// discriminate.
var (
	// ErrBucketMissing indicates the configured bucket does not exist.
	ErrBucketMissing = errors.New("minio: bucket missing")

	// ErrObjectNotFound indicates the requested object key is absent.
	ErrObjectNotFound = errors.New("minio: object not found")

	// ErrObjectLocked indicates a delete was rejected because the object's
	// WORM retention is still in effect.
	ErrObjectLocked = errors.New("minio: object locked by WORM")

	// ErrRetentionTooShort indicates an attempt to seal an object with a
	// retention shorter than the class default.
	ErrRetentionTooShort = errors.New("minio: retention shorter than class default")

	// ErrSentinelMissing indicates the BucketHealthy probe could not find a
	// sentinel object under __siem_self_test/.
	ErrSentinelMissing = errors.New("minio: bucket sentinel missing")

	// ErrEncryptionMisconfigured indicates the bucket lacks server-side
	// encryption.
	ErrEncryptionMisconfigured = errors.New("minio: bucket encryption misconfigured")

	// ErrWORMSelfTestFailed indicates the WORM self-test detected a delete
	// that should have failed but succeeded (or vice versa).
	ErrWORMSelfTestFailed = errors.New("minio: WORM self-test failed")
)
