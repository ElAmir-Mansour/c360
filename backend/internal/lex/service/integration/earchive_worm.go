package integration

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	miniogo "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// =============================================================================
// e-Archiving WORM transport (S3 object-lock backend).
//
// This is the real object-lock seam for the archiving connector's s3_objectlock
// backend. It mirrors the privilege boundary established by internal/dr/worm
// (DESIGN_DataStream_DR.md §5): GOVERNANCE retention gives ransomware
// immutability against ordinary credentials, COMPLIANCE makes even a break-glass
// holder unable to shorten/delete within retention, and an object-lock
// legal-hold is the ransomware-safe FLOOR that survives any retention bypass.
//
// We deliberately do NOT re-encrypt archived bytes here: the lex document store
// already governs document custody and FieldCrypto governs connection config.
// The e-archive's job is WORM placement + retention + legal-hold + a tamper-
// evident manifest chained from DocumentVersion.ContentHash. (internal/dr/worm
// owns the at-rest DEK story for DR recovery points; e-archive object bytes are
// the document bytes the operator already holds.)
//
// in_kingdom_only (PDPL) is enforced FAIL-CLOSED at test/connection time by the
// connector before any object is ever written: an endpoint whose resolved region
// is not an in-Kingdom region is refused rather than silently archived abroad.
// =============================================================================

// WORMMode selects the object-lock posture applied to archived objects.
//
//   - WORMModeNone leaves objects mutable (no retention, no hold) — used only for
//     self-serve buckets the operator has explicitly opted out of locking.
//   - WORMModeGovernance applies GOVERNANCE retention: immutable to ordinary
//     credentials, reclaimable only by a break-glass holder of
//     s3:BypassGovernanceRetention.
//   - WORMModeCompliance applies COMPLIANCE retention: immutable to EVERYONE
//     (including break-glass) until retention elapses — the records-management
//     default for legal archives.
type WORMMode string

const (
	WORMModeNone       WORMMode = "none"
	WORMModeGovernance WORMMode = "governance"
	WORMModeCompliance WORMMode = "compliance"
)

// NormalizeWORMMode coerces an arbitrary string to a valid WORMMode, defaulting
// to compliance (the safest, records-management posture) when empty/unknown.
func NormalizeWORMMode(s string) WORMMode {
	switch WORMMode(strings.ToLower(strings.TrimSpace(s))) {
	case WORMModeNone:
		return WORMModeNone
	case WORMModeGovernance:
		return WORMModeGovernance
	case WORMModeCompliance:
		return WORMModeCompliance
	default:
		return WORMModeCompliance
	}
}

// retentionMode maps a WORMMode onto the minio retention mode. Returns ok=false
// for WORMModeNone (no retention applied).
func (m WORMMode) retentionMode() (miniogo.RetentionMode, bool) {
	switch m {
	case WORMModeGovernance:
		return miniogo.Governance, true
	case WORMModeCompliance:
		return miniogo.Compliance, true
	default:
		return "", false
	}
}

// Sentinel errors callers match with errors.Is.
var (
	// ErrArchiveObjectLocked is returned when an operation is refused by
	// object-lock (a dispose within retention, or a dispose of a legal-held
	// object). This is the WORM guarantee surfacing — NOT a transport bug.
	ErrArchiveObjectLocked = errors.New("lex/earchive: object is lock-protected (WORM)")
	// ErrArchiveObjectNotFound is returned when an archived object key is absent.
	ErrArchiveObjectNotFound = errors.New("lex/earchive: archived object not found")
	// ErrRegionNotInKingdom is the PDPL fail-closed sentinel: the resolved bucket
	// region is outside the Kingdom but in_kingdom_only is set.
	ErrRegionNotInKingdom = errors.New("lex/earchive: bucket region is outside the Kingdom (in_kingdom_only)")
)

// inKingdomRegions is the allow-list of object-store regions considered
// in-Kingdom for PDPL data-residency. The operator's bucket region (resolved
// from config or from the live GetBucketLocation) must match one of these when
// in_kingdom_only is set. The list is intentionally small and explicit; an
// unrecognised region fails closed.
var inKingdomRegions = map[string]bool{
	"me-central-1": true, // AWS Middle East (UAE) is NOT in-Kingdom — excluded.
	"ksa-central":  true, // Sovereign / local S3 (e.g. STC/Oracle Jeddah, Google Dammam) operator-labelled.
	"sa-riyadh-1":  true,
	"sa-jeddah-1":  true,
	"sa-east-1":    true,
	"riyadh":       true,
	"jeddah":       true,
	"dammam":       true,
	"in-kingdom":   true, // explicit operator assertion for an on-prem/sovereign MinIO.
}

func init() {
	// me-central-1 is AWS UAE — outside the Kingdom. It is listed above only to
	// document the exclusion intent; remove it from the allow-list so it fails
	// closed under in_kingdom_only.
	delete(inKingdomRegions, "me-central-1")
}

// RegionInKingdom reports whether a resolved region label is on the in-Kingdom
// allow-list. Matching is case-insensitive and trims surrounding whitespace. An
// empty region is NOT in-Kingdom (fail-closed).
func RegionInKingdom(region string) bool {
	r := strings.ToLower(strings.TrimSpace(region))
	if r == "" {
		return false
	}
	return inKingdomRegions[r]
}

// S3WORMConfig parametrises the S3 object-lock backend. All values come from the
// endpoint's DECRYPTED config (resolved via the repository); SecretAccessKey is
// never logged.
type S3WORMConfig struct {
	// Endpoint is the S3 host:port WITHOUT scheme (e.g. "s3.ksa.local:9000").
	Endpoint string
	// AccessKeyID / SecretAccessKey are the bucket credentials.
	AccessKeyID     string
	SecretAccessKey string
	// UseSSL toggles HTTPS.
	UseSSL bool
	// Region is the operator-declared bucket region (PDPL residency check).
	Region string
	// Bucket is the WORM archive bucket (must be created --with-lock).
	Bucket string
	// WORMMode selects the retention posture.
	WORMMode WORMMode
	// DefaultRetention is the retain-until window applied when an archive call
	// supplies none. Defaults to a long records-management window.
	DefaultRetention time.Duration
	// InKingdomOnly enforces PDPL residency fail-closed at probe time.
	InKingdomOnly bool
}

// S3WORMClient is the real S3 object-lock transport for the archiving connector.
// It wraps a minio-go client (S3-compatible; works against AWS S3, MinIO, and
// sovereign object stores) and exposes exactly the object-lock surface the
// connector needs: a writable + lock-config probe, a locked PutObject, legal-
// hold toggling, and a (lock-refused) dispose.
type S3WORMClient struct {
	api    *miniogo.Client
	bucket string
	mode   WORMMode
	region string
	defRet time.Duration
}

// NewS3WORMClient builds the transport from resolved plaintext config. It does
// NOT perform any network I/O (construction is cheap and side-effect free); the
// reachability + lock-config + residency assertions happen in Probe.
func NewS3WORMClient(cfg S3WORMConfig) (*S3WORMClient, error) {
	if strings.TrimSpace(cfg.Endpoint) == "" {
		return nil, fmt.Errorf("lex/earchive: s3 endpoint required")
	}
	if strings.TrimSpace(cfg.Bucket) == "" {
		return nil, fmt.Errorf("lex/earchive: s3 bucket required")
	}
	region := strings.TrimSpace(cfg.Region)
	api, err := miniogo.New(cfg.Endpoint, &miniogo.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: cfg.UseSSL,
		Region: region,
	})
	if err != nil {
		return nil, fmt.Errorf("lex/earchive: new s3 client: %w", err)
	}
	defRet := cfg.DefaultRetention
	if defRet <= 0 {
		defRet = 10 * 365 * 24 * time.Hour // records-management default: 10y
	}
	return &S3WORMClient{
		api:    api,
		bucket: cfg.Bucket,
		mode:   NormalizeWORMMode(string(cfg.WORMMode)),
		region: region,
		defRet: defRet,
	}, nil
}

// S3ProbeResult is the sanitized outcome of the S3 backend connection probe.
type S3ProbeResult struct {
	// BucketExists is true when HeadBucket succeeded.
	BucketExists bool
	// ObjectLockEnabled is true when GetObjectLockConfiguration reports a mode.
	ObjectLockEnabled bool
	// LockMode is the bucket's default retention mode (GOVERNANCE/COMPLIANCE), if any.
	LockMode string
	// ResolvedRegion is the region used by the client (operator-declared).
	ResolvedRegion string
	// InKingdom reports whether ResolvedRegion is on the in-Kingdom allow-list.
	InKingdom bool
}

// Probe performs the non-mutating S3 connection test: HeadBucket (BucketExists)
// + GetObjectLockConfiguration, and resolves the region for the PDPL residency
// assertion. It does NOT itself reject an out-of-Kingdom region (the connector
// applies the fail-closed policy with the in_kingdom_only flag in hand), but it
// reports InKingdom so the caller can decide.
func (c *S3WORMClient) Probe(ctx context.Context) (S3ProbeResult, error) {
	res := S3ProbeResult{ResolvedRegion: c.region, InKingdom: RegionInKingdom(c.region)}

	exists, err := c.api.BucketExists(ctx, c.bucket)
	if err != nil {
		return res, fmt.Errorf("lex/earchive: head bucket: %w", sanitizeS3Err(err))
	}
	res.BucketExists = exists
	if !exists {
		return res, fmt.Errorf("lex/earchive: archive bucket does not exist")
	}

	_, mode, _, _, err := c.api.GetObjectLockConfig(ctx, c.bucket)
	if err != nil {
		// A bucket created without object-lock returns an error here; surface it as
		// "object-lock not enabled" rather than a hard failure so the operator sees
		// the misconfiguration (a WORM archive REQUIRES object-lock).
		res.ObjectLockEnabled = false
		return res, nil
	}
	if mode != nil {
		res.ObjectLockEnabled = true
		res.LockMode = string(*mode)
	}
	return res, nil
}

// PutResult describes a sealed archive object.
type PutResult struct {
	Key          string
	VersionID    string
	SHA256       string
	Bytes        int64
	RetainUntil  time.Time
	AppliedMode  WORMMode
	LegalHoldSet bool
}

// Put writes content to the archive bucket under the configured object-lock
// retention. When the connector's WORM mode is governance/compliance the object
// carries a retain-until; an explicit retainUntil overrides the default window.
// SHA256 is the hash of the bytes actually written (chained into the manifest).
func (c *S3WORMClient) Put(ctx context.Context, key string, content []byte, retainUntil time.Time, userMeta map[string]string) (PutResult, error) {
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	opts := miniogo.PutObjectOptions{
		ContentType:      "application/octet-stream",
		UserMetadata:     userMeta,
		DisableMultipart: true,
	}
	if mode, ok := c.mode.retentionMode(); ok {
		if retainUntil.IsZero() {
			retainUntil = time.Now().Add(c.defRet).UTC()
		}
		opts.Mode = mode
		opts.RetainUntilDate = retainUntil.UTC()
	}

	info, err := c.api.PutObject(ctx, c.bucket, key, bytes.NewReader(content), int64(len(content)), opts)
	if err != nil {
		return PutResult{}, fmt.Errorf("lex/earchive: put archive object: %w", sanitizeS3Err(err))
	}
	return PutResult{
		Key:         key,
		VersionID:   info.VersionID,
		SHA256:      hash,
		Bytes:       int64(len(content)),
		RetainUntil: retainUntil.UTC(),
		AppliedMode: c.mode,
	}, nil
}

// SetLegalHold toggles the object-lock legal-hold on an archived object. A
// legal-held object cannot be removed even with a governance bypass — the
// ransomware-safe + litigation-hold floor (mirrors internal/dr/worm.SetLegalHold).
func (c *S3WORMClient) SetLegalHold(ctx context.Context, key string, hold bool) error {
	status := miniogo.LegalHoldDisabled
	if hold {
		status = miniogo.LegalHoldEnabled
	}
	if err := c.api.PutObjectLegalHold(ctx, c.bucket, key, miniogo.PutObjectLegalHoldOptions{Status: &status}); err != nil {
		return fmt.Errorf("lex/earchive: set legal hold: %w", sanitizeS3Err(err))
	}
	return nil
}

// LegalHold reports whether an archived object currently carries a legal-hold.
func (c *S3WORMClient) LegalHold(ctx context.Context, key string) (bool, error) {
	status, err := c.api.GetObjectLegalHold(ctx, c.bucket, key, miniogo.GetObjectLegalHoldOptions{})
	if err != nil {
		return false, fmt.Errorf("lex/earchive: get legal hold: %w", sanitizeS3Err(err))
	}
	return status != nil && *status == miniogo.LegalHoldEnabled, nil
}

// Dispose attempts an ordinary delete of an archived object version (no
// governance bypass). On a GOVERNANCE/COMPLIANCE object still within retention,
// or one under legal-hold, object-lock refuses it and this returns
// ErrArchiveObjectLocked — the real WORM immutability guarantee surfacing. The
// connector only ever calls this after its OWN compliance gate (break-glass +
// no active hold + retention elapsed), so a refusal here is the storage layer
// independently confirming the floor.
func (c *S3WORMClient) Dispose(ctx context.Context, key, versionID string) error {
	opts := miniogo.RemoveObjectOptions{}
	if versionID != "" {
		opts.VersionID = versionID
	}
	if err := c.api.RemoveObject(ctx, c.bucket, key, opts); err != nil {
		return fmt.Errorf("lex/earchive: dispose object: %w", sanitizeS3Err(err))
	}
	return nil
}

// Stat reports an archived object's size (existence check).
func (c *S3WORMClient) Stat(ctx context.Context, key string) (int64, error) {
	info, err := c.api.StatObject(ctx, c.bucket, key, miniogo.StatObjectOptions{})
	if err != nil {
		return 0, fmt.Errorf("lex/earchive: stat object: %w", sanitizeS3Err(err))
	}
	return info.Size, nil
}

// Bucket returns the configured archive bucket name.
func (c *S3WORMClient) Bucket() string { return c.bucket }

// Mode returns the configured WORM mode.
func (c *S3WORMClient) Mode() WORMMode { return c.mode }

// sanitizeS3Err maps minio-go transport errors onto our sentinels and strips any
// credential material (minio errors carry only request/response metadata, never
// the secret key, but we normalise the surface here for safety).
func sanitizeS3Err(err error) error {
	if err == nil {
		return nil
	}
	resp := miniogo.ToErrorResponse(err)
	switch {
	case resp.Code == "NoSuchKey", resp.StatusCode == http.StatusNotFound:
		return ErrArchiveObjectNotFound
	case isArchiveLockError(resp):
		return ErrArchiveObjectLocked
	}
	// Default: return the upstream code/status only (no body, no creds).
	if resp.Code != "" {
		return fmt.Errorf("s3 error %s (status %d)", resp.Code, resp.StatusCode)
	}
	return err
}

func isArchiveLockError(resp miniogo.ErrorResponse) bool {
	if resp.StatusCode == 0 || resp.StatusCode == http.StatusOK {
		return false
	}
	msg := strings.ToLower(resp.Message)
	if strings.Contains(msg, "worm") || strings.Contains(msg, "object lock") ||
		strings.Contains(msg, "legal hold") || strings.Contains(msg, "retention") ||
		resp.Code == "InvalidRetentionPeriod" {
		return true
	}
	if resp.Code == "AccessDenied" && resp.StatusCode == http.StatusForbidden {
		return true
	}
	return false
}

// ArchiveManifestEntry is one tamper-evident link in an archive manifest. Each
// archived document version contributes an entry whose ContentHash is chained
// from the previous entry's hash (PrevHash), exactly like the audit-log
// hash-chain: a single altered byte breaks the chain. The manifest is what an
// auditor verifies to prove the archived corpus has not been silently mutated.
type ArchiveManifestEntry struct {
	Sequence    int       `json:"sequence"`
	DocumentID  string    `json:"document_id"`
	Version     int       `json:"version"`
	ContentHash string    `json:"content_hash"` // DocumentVersion.ContentHash (source of truth)
	ObjectKey   string    `json:"object_key"`
	ObjectHash  string    `json:"object_hash"` // SHA-256 of bytes actually written to WORM
	PrevHash    string    `json:"prev_hash"`
	EntryHash   string    `json:"entry_hash"` // SHA-256(seq|doc|ver|content_hash|object_hash|prev_hash)
	ArchivedAt  time.Time `json:"archived_at"`
}

// ComputeEntryHash chains an entry off the previous entry's EntryHash. The
// genesis entry uses an empty PrevHash. This mirrors the entry_hash/prev_hash
// chain used across the lex audit surfaces so verification tooling is uniform.
func ComputeEntryHash(e ArchiveManifestEntry) string {
	h := sha256.New()
	fmt.Fprintf(h, "%d\x1f%s\x1f%d\x1f%s\x1f%s\x1f%s",
		e.Sequence, e.DocumentID, e.Version, e.ContentHash, e.ObjectHash, e.PrevHash)
	return hex.EncodeToString(h.Sum(nil))
}
