// Package worm is the ClarioDR recovery-point object store: ransomware-safe
// immutable chunks in MinIO/S3 (DESIGN_DataStream_DR.md §5).
//
// It deliberately differs from the SIEM cold-store (internal/siem/store/minio)
// in two ways the design calls out:
//
//  1. Object-lock defaults to GOVERNANCE, not COMPLIANCE. DR recovery points are
//     operational — they roll over continuously and old ones must be reclaimable
//     on a normal cadence by a tightly-held break-glass role holding
//     s3:BypassGovernanceRetention. COMPLIANCE would make routine lifecycle
//     literally impossible. GOVERNANCE still gives ransomware immutability
//     against ordinary credentials (a plain delete is refused). Regulators that
//     mandate un-bypassable retention can opt into COMPLIANCE via
//     Config.RetentionMode; BypassDelete then refuses (the object is immutable
//     until retention expires even for the break-glass role).
//
//  2. The newest validated recovery points additionally carry an object-lock
//     legal-hold — the ransomware-safe floor: even a break-glass holder cannot
//     remove them until a newer validated point supersedes them and the hold is
//     released.
//
// Every chunk is envelope-encrypted at rest with the per-tenant Data Encryption
// Key (crypto.DEKManager, optionally gated by DR BYOK tenant KEK custody) using
// AES-256-GCM before it is written, so the bytes in the bucket are ciphertext;
// Get decrypts them back with the same DEK.
package worm

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	miniogo "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/sovereignty"
)

// Retention-mode selectors for Config.RetentionMode. They are the two S3
// object-lock modes: GOVERNANCE (routine lifecycle reclaimable by a break-glass
// holder of s3:BypassGovernanceRetention) and COMPLIANCE (un-bypassable even by
// root until retention expires — some regulators mandate it).
const (
	// RetentionModeGovernance is the default: ransomware immutability against
	// ordinary credentials, still reclaimable on cadence by the break-glass role.
	RetentionModeGovernance = "governance"
	// RetentionModeCompliance is the un-bypassable mode. A COMPLIANCE-locked
	// object cannot be governance-bypass deleted; BypassDelete refuses it.
	RetentionModeCompliance = "compliance"
)

// DefaultRegion is the object-store region used when Config.Region is empty and
// explicit-region enforcement is off. It is the MinIO/S3 wire default; it is NOT
// a sovereignty statement — sovereign deployments must set Config.Region and
// Config.RequireExplicitRegion so an empty region is rejected rather than
// silently defaulted (see NewClient / New validation).
const DefaultRegion = "us-east-1"

// Sentinel errors callers match with errors.Is.
var (
	// ErrObjectLocked is returned when an operation is refused by object-lock
	// (a delete with no governance bypass, or a delete of a legal-held object).
	ErrObjectLocked = errors.New("worm: object is lock-protected")
	// ErrObjectNotFound is returned when a key does not exist.
	ErrObjectNotFound = errors.New("worm: object not found")
	// ErrComplianceBypass is returned when BypassDelete is attempted while the
	// client is configured for COMPLIANCE retention. Compliance-locked objects
	// are un-bypassable by design; refusing it here makes the boundary explicit
	// rather than surfacing an opaque S3 403.
	ErrComplianceBypass = errors.New("worm: compliance-mode objects cannot be governance-bypass deleted")
	// ErrRegionRequired is returned by New when Config.Region is empty and
	// Config.RequireExplicitRegion is set — the sovereign-deployment guard.
	ErrRegionRequired = errors.New("worm: explicit region required but Config.Region is empty")
	// ErrObjectLockNotEnabled is returned by AssertObjectLock (and therefore by
	// EnsureBucket) when a pre-existing bucket does NOT have S3 object-lock
	// enabled. A WORM store on a plain bucket would silently accept writes with no
	// retention — ransomware-immutable in name only — so this is a fail-closed
	// startup error: we refuse to run against a misprovisioned bucket rather than
	// discovering the gap incidentally on a later delete that unexpectedly succeeds.
	ErrObjectLockNotEnabled = errors.New("worm: bucket does not have S3 object-lock enabled")
	// ErrObjectLockModeMismatch is returned by AssertObjectLock when the bucket's
	// object-lock default-retention MODE does not match this client's configured
	// RetentionMode (e.g. bucket defaults to GOVERNANCE but the client is
	// configured for COMPLIANCE, or vice-versa). Proceeding would seal chunks under
	// a weaker (or unexpectedly stronger) posture than configured.
	ErrObjectLockModeMismatch = errors.New("worm: bucket object-lock default mode does not match configured retention mode")
)

// TenantRegionResolver resolves a tenant's bound residency region for the
// data-plane sovereignty guard. It is satisfied by the platform residency
// loader (internal/residency.RegionLoader via a thin adapter). An empty region
// means the tenant is unrestricted; ErrTenantNotFound (or any lookup error) is
// treated as a hard failure so residency can never be silently bypassed on a
// resolve error — the guard fails CLOSED (see Client.assertResidency).
//
// The returned region is compared, case-insensitively, against this client's
// configured object-store region (the physical location of the WORM bucket).
type TenantRegionResolver interface {
	// TenantRegion returns the tenant's residency region, or "" if unrestricted.
	TenantRegion(ctx context.Context, tenantID string) (string, error)
}

// DEKProvider yields the per-(tenant, stream) Data Encryption Key. It is
// satisfied by internal/siem/store/crypto.DEKManager. The returned slice is
// owned by the provider; we copy it before use and never mutate it.
type DEKProvider interface {
	Get(ctx context.Context, tenantID uuid.UUID, name string) (dek []byte, kekVersion int, err error)
}

// DEKReleaser is an optional companion for providers that return caller-owned
// plaintext (for example a BYOK unwrap result). Client calls it after copying the
// DEK into its short-lived AES buffer. Cache-owned providers such as DEKManager
// do not implement it, so their cached slices are never zeroed by WORM.
type DEKReleaser interface {
	ReleaseDEK(dek []byte)
}

// Config bundles the runtime configuration for the DR WORM store.
type Config struct {
	// Endpoint is "host:port" without scheme.
	Endpoint string
	// AccessKey / SecretKey are the credentials.
	AccessKey string
	SecretKey string
	// UseSSL toggles HTTPS.
	UseSSL bool
	// Region is the object-store region. When empty it falls back to
	// DefaultRegion ("us-east-1") — UNLESS RequireExplicitRegion is set, in
	// which case New returns ErrRegionRequired. Sovereign deployments must set
	// this to the in-jurisdiction region.
	Region string
	// RequireExplicitRegion, when true, makes an empty Region a hard error
	// (ErrRegionRequired) instead of silently defaulting to DefaultRegion. It is
	// the sovereignty posture switch: off by default to preserve behavior, set
	// true for regulated/sovereign deployments so region is never implicit.
	RequireExplicitRegion bool
	// Bucket is the WORM recovery-point bucket (created --with-lock).
	Bucket string
	// DefaultRetention is the object-lock retention applied to every sealed
	// chunk. Defaults to 7 days when zero — the operational floor; DR layers a
	// rolling reclaim window on top (§5).
	DefaultRetention time.Duration
	// RetentionMode selects the object-lock mode used by EnsureBucket's default
	// retention and by every Seal PutObject: RetentionModeGovernance (default,
	// reclaimable by the break-glass s3:BypassGovernanceRetention role) or
	// RetentionModeCompliance (un-bypassable; BypassDelete refuses). Empty and
	// unrecognized values normalize to governance to preserve behavior.
	RetentionMode string
}

// SealOptions controls a Seal call.
type SealOptions struct {
	// TenantID and StreamID select the per-tenant DEK and form the object key.
	TenantID uuid.UUID
	StreamID string
	// MarkerLSN is the consistency marker the chunk is sealed at; it is part of
	// the object key so a recovery point's chunks group together.
	MarkerLSN string
	// RetainUntil overrides Config.DefaultRetention's computed retain-until when
	// non-zero.
	RetainUntil time.Time
	// EventTime determines the yyyy/mm prefix in the key. Defaults to now.
	EventTime time.Time
}

// SealResult describes a sealed chunk.
type SealResult struct {
	// Key is the object key in the bucket.
	Key string
	// VersionID is the object version the chunk was sealed as. Object-lock
	// protects the *version*, so a destructive delete must target this version
	// (a keyless delete only adds a delete marker on a versioned bucket).
	VersionID string
	// PlaintextSHA256 is the SHA-256 of the ORIGINAL (pre-encryption) bytes —
	// the tamper-evidence hash chained into the recovery_point row.
	PlaintextSHA256 string
	// CiphertextBytes is the on-disk size (encrypted).
	CiphertextBytes int64
	// KEKVersion is the key-encryption version reported by the DEK provider
	// (Vault Transit KEK for the raw manager, or tenant BYOK KEK when enrolled).
	KEKVersion int
	// RetainUntil is the GOVERNANCE retain-until date set on the object.
	RetainUntil time.Time
}

// Client is the DR WORM store.
type Client struct {
	cfg DEKConfig
	api *miniogo.Client
	dek DEKProvider
	log zerolog.Logger

	// regionResolver, when non-nil, enables data-plane data-residency
	// enforcement: every Seal (write) and Get (restore/read) resolves the
	// owning tenant's residency region and refuses the operation when the
	// tenant may not have its recovery data reside in this client's configured
	// object-store region (cfg.Region). Nil (the default) preserves the prior
	// behavior exactly — non-sovereign deployments are unaffected.
	regionResolver TenantRegionResolver
}

// DEKConfig is Config with defaults applied (kept private; New fills it).
type DEKConfig struct {
	Config
}

// New constructs a Client, applying defaults. The DEKProvider supplies the
// per-tenant key used to encrypt every chunk; it must not be nil.
func New(cfg Config, dek DEKProvider, logger zerolog.Logger) (*Client, error) {
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("worm: endpoint required")
	}
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("worm: bucket required")
	}
	if dek == nil {
		return nil, fmt.Errorf("worm: DEK provider required")
	}
	if cfg.Region == "" {
		if cfg.RequireExplicitRegion {
			return nil, ErrRegionRequired
		}
		cfg.Region = DefaultRegion
	}
	if cfg.DefaultRetention <= 0 {
		cfg.DefaultRetention = 7 * 24 * time.Hour
	}
	cfg.RetentionMode = normalizeRetentionMode(cfg.RetentionMode)
	api, err := miniogo.New(cfg.Endpoint, &miniogo.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("worm: new minio client: %w", err)
	}
	return &Client{
		cfg: DEKConfig{Config: cfg},
		api: api,
		dek: dek,
		log: logger.With().Str("component", "dr-worm").Logger(),
	}, nil
}

// WithRegionResolver turns on data-plane data-residency enforcement. Once set,
// every Seal and Get resolves the owning tenant's residency region through the
// resolver and refuses (fail-closed) any cross-region write or restore: regulated
// recovery bytes must never land in — or be served from — a WORM bucket outside
// the tenant's jurisdiction. It returns the receiver for chaining.
//
// A nil resolver leaves enforcement OFF (the default), preserving behavior for
// non-sovereign deployments. Callers that enable it MUST pass a usable resolver;
// a resolve error fails the operation closed rather than bypassing residency.
func (c *Client) WithRegionResolver(r TenantRegionResolver) *Client {
	c.regionResolver = r
	return c
}

// ResidencyEnforced reports whether this client actively enforces data-plane
// residency (a region resolver is attached). Wiring/health surfaces use it to
// attest that recovery-point writes are geo-fenced.
func (c *Client) ResidencyEnforced() bool { return c.regionResolver != nil }

// Region returns this client's configured object-store region — the physical
// region a sealed chunk lands in. Exposed so the startup posture gate can assert
// the WORM bucket region equals the deployment's residency region.
func (c *Client) Region() string { return c.cfg.Region }

// assertResidency is the data-plane sovereignty guard shared by Seal (write) and
// Get (restore/read). When a region resolver is attached it resolves the tenant's
// bound residency region and, via sovereignty.AssertRegionAllowed, refuses any
// operation whose target region (this client's bucket region) is disallowed for
// the tenant.
//
// Fail-closed semantics:
//   - no resolver               => nil (enforcement off; behavior preserved).
//   - resolver returns an error => error (residency is NEVER bypassed on a
//     lookup failure, e.g. tenant-not-found or DB outage).
//   - tenantRegion empty        => allowed (unrestricted tenant), matching the
//     control-plane middleware exactly.
//   - regions mismatch          => *sovereignty.RegionViolationError.
func (c *Client) assertResidency(ctx context.Context, tenantID uuid.UUID, op string) error {
	if c.regionResolver == nil {
		return nil
	}
	tenantRegion, err := c.regionResolver.TenantRegion(ctx, tenantID.String())
	if err != nil {
		// Fail closed: an unresolvable residency binding must not permit a
		// cross-region write/read to slip through.
		c.log.Warn().
			Str("event", "residency.resolve_failed").
			Str("op", op).
			Str("tenant_id", tenantID.String()).
			Str("target_region", c.cfg.Region).
			Err(err).
			Msg("dr-worm: refusing operation; could not resolve tenant residency region")
		return fmt.Errorf("worm: %s residency check failed to resolve tenant region: %w", op, err)
	}
	if err := sovereignty.AssertRegionAllowed(tenantRegion, c.cfg.Region); err != nil {
		c.log.Warn().
			Str("event", "residency.denied").
			Str("code", "RESIDENCY_VIOLATION").
			Str("op", op).
			Str("tenant_id", tenantID.String()).
			Str("tenant_region", tenantRegion).
			Str("target_region", c.cfg.Region).
			Msg("dr-worm: refusing cross-region recovery data operation")
		return fmt.Errorf("worm: %s: %w", op, err)
	}
	return nil
}

// EnsureBucket creates the WORM bucket with object-locking enabled and a default
// GOVERNANCE retention if it does not already exist. Mirrors the
// `mc mb --with-lock` + default-retention init the design specifies (§5, §10.6),
// so a fresh environment is self-provisioning. Idempotent.
//
// Fail-closed provisioning guarantee: whether the bucket is freshly created here
// or already existed, EnsureBucket ends with a POSITIVE AssertObjectLock probe
// that reads the live object-lock configuration back and refuses to proceed
// (ErrObjectLockNotEnabled / ErrObjectLockModeMismatch) if object-lock is not
// actually enabled or the default mode disagrees with this client's configured
// RetentionMode. This catches a MISPROVISIONED pre-existing bucket (object-lock
// off, or wrong mode) by assertion at startup — not incidentally on some later
// delete that unexpectedly succeeds.
func (c *Client) EnsureBucket(ctx context.Context) error {
	exists, err := c.api.BucketExists(ctx, c.cfg.Bucket)
	if err != nil {
		return fmt.Errorf("worm: bucket exists check: %w", err)
	}
	if !exists {
		if err := c.api.MakeBucket(ctx, c.cfg.Bucket, miniogo.MakeBucketOptions{
			Region:        c.cfg.Region,
			ObjectLocking: true,
		}); err != nil {
			return fmt.Errorf("worm: make bucket with object-lock: %w", err)
		}
	}
	// Default GOVERNANCE retention so any object written without an explicit
	// retain-until is still lock-protected. Retention is expressed in whole
	// days (object-lock's unit granularity).
	days := uint(c.cfg.DefaultRetention / (24 * time.Hour))
	if days == 0 {
		days = 1
	}
	mode := c.retentionMode()
	unit := miniogo.Days
	if err := c.api.SetObjectLockConfig(ctx, c.cfg.Bucket, &mode, &days, &unit); err != nil {
		return fmt.Errorf("worm: set default object-lock config: %w", err)
	}
	// Positive, fail-closed assertion: read the object-lock config back and prove
	// it is really enabled with the configured mode. If a pre-existing bucket was
	// created WITHOUT object-lock, SetObjectLockConfig above would already have
	// failed — but a bucket can also carry a DIFFERENT default mode, and defense in
	// depth demands we never assume the SET took: we verify by GET.
	if err := c.AssertObjectLock(ctx); err != nil {
		return err
	}
	return nil
}

// AssertObjectLock is the positive object-lock preflight probe. It reads the
// bucket's live object-lock configuration via minio-go GetObjectLockConfig and
// ASSERTS, fail-closed, that:
//
//   - object-lock is ENABLED on the bucket (a plain bucket makes the S3 call
//     error with ObjectLockConfigurationNotFoundError; we surface that as
//     ErrObjectLockNotEnabled);
//   - where the bucket advertises a default-retention MODE, it MATCHES this
//     client's configured RetentionMode (else ErrObjectLockModeMismatch).
//
// It is safe to call standalone as a health/preflight check on an
// already-provisioned bucket: it performs no writes. It exists so a
// misprovisioned bucket (object-lock silently OFF, or the wrong mode) is caught
// by assertion at startup rather than incidentally when a delete that should have
// been refused unexpectedly succeeds. Returns nil only when the bucket is proven
// WORM-capable in the configured mode.
func (c *Client) AssertObjectLock(ctx context.Context) error {
	objectLock, mode, _, _, err := c.api.GetObjectLockConfig(ctx, c.cfg.Bucket)
	if err != nil {
		// A bucket created without object-lock has no object-lock configuration;
		// S3/MinIO answers with ObjectLockConfigurationNotFoundError. Treat any
		// "not configured" answer as the fail-closed ErrObjectLockNotEnabled so the
		// caller sees a precise reason, and wrap other errors verbatim.
		if isObjectLockNotConfigured(err) {
			c.log.Error().
				Str("event", "worm.objectlock.assert_failed").
				Str("bucket", c.cfg.Bucket).
				Err(err).
				Msg("dr-worm: refusing to run; bucket has no S3 object-lock configuration")
			return fmt.Errorf("%w: bucket %q: %v", ErrObjectLockNotEnabled, c.cfg.Bucket, err)
		}
		return fmt.Errorf("worm: get object-lock config for bucket %q: %w", c.cfg.Bucket, err)
	}
	return c.evaluateObjectLock(objectLock, mode)
}

// evaluateObjectLock applies the fail-closed object-lock assertion to a
// GetObjectLockConfig result. Split out from AssertObjectLock so the decision
// logic is unit-testable without a live MinIO. `objectLock` is the bucket's
// ObjectLockEnabled marker ("Enabled" when on); `mode` is the default-retention
// mode (nil when no default retention rule is configured on the bucket).
func (c *Client) evaluateObjectLock(objectLock string, mode *miniogo.RetentionMode) error {
	if !strings.EqualFold(strings.TrimSpace(objectLock), "Enabled") {
		c.log.Error().
			Str("event", "worm.objectlock.assert_failed").
			Str("bucket", c.cfg.Bucket).
			Str("object_lock", objectLock).
			Msg("dr-worm: refusing to run; bucket object-lock is not Enabled")
		return fmt.Errorf("%w: bucket %q reports object-lock %q, want \"Enabled\"",
			ErrObjectLockNotEnabled, c.cfg.Bucket, objectLock)
	}
	// Where the bucket advertises a default-retention mode, it must match the
	// configured posture. A nil mode means object-lock is enabled but no default
	// retention rule is present; EnsureBucket sets one, but AssertObjectLock is
	// also usable as a standalone preflight where a rule may legitimately be
	// absent, so a nil mode is not itself a failure — object-lock being ENABLED is
	// the load-bearing guarantee (every Seal sets an explicit per-object
	// retain-until in the configured mode regardless).
	if mode != nil {
		want := c.retentionMode()
		if !strings.EqualFold(string(*mode), string(want)) {
			c.log.Error().
				Str("event", "worm.objectlock.assert_failed").
				Str("bucket", c.cfg.Bucket).
				Str("bucket_mode", string(*mode)).
				Str("configured_mode", string(want)).
				Msg("dr-worm: refusing to run; bucket default object-lock mode mismatches configuration")
			return fmt.Errorf("%w: bucket %q default mode %q, configured %q",
				ErrObjectLockModeMismatch, c.cfg.Bucket, string(*mode), string(want))
		}
	}
	return nil
}

// isObjectLockNotConfigured reports whether an error from GetObjectLockConfig
// means the bucket simply has no object-lock configuration (i.e. it was NOT
// created --with-lock). S3/MinIO returns the ObjectLockConfigurationNotFoundError
// code for this; some gateways answer 404. Either way it is the fail-closed
// "object-lock is off" signal, distinct from a transport/credentials error.
func isObjectLockNotConfigured(err error) bool {
	resp := miniogo.ToErrorResponse(err)
	if resp.Code == "ObjectLockConfigurationNotFoundError" ||
		resp.Code == "ObjectLockConfigurationNotFound" {
		return true
	}
	msg := strings.ToLower(resp.Message)
	if strings.Contains(msg, "object lock configuration") &&
		(strings.Contains(msg, "not found") || strings.Contains(msg, "does not exist")) {
		return true
	}
	return false
}

// objectKey builds a deterministic, collision-free key for a chunk.
func objectKey(tenantID uuid.UUID, streamID, markerLSN string, t time.Time) string {
	safeMarker := strings.NewReplacer("/", "_", " ", "_").Replace(markerLSN)
	return fmt.Sprintf("%s/%04d/%02d/%s/%s/%s.chunk",
		tenantID.String(), t.Year(), int(t.Month()), streamID, safeMarker, uuid.NewString())
}

// Seal encrypts source with the per-tenant DEK (AES-256-GCM) and writes the
// ciphertext to the WORM bucket under a GOVERNANCE object-lock retain-until.
// This is the real seal: the bytes that land in the bucket are ciphertext, the
// object carries a retention lock, and SealResult.PlaintextSHA256 hashes the
// ORIGINAL bytes for the tamper-evidence chain.
func (c *Client) Seal(ctx context.Context, source io.Reader, opts SealOptions) (SealResult, error) {
	if source == nil {
		return SealResult{}, fmt.Errorf("worm: Seal source nil")
	}
	if opts.StreamID == "" {
		return SealResult{}, fmt.Errorf("worm: Seal StreamID required")
	}
	// Data-plane data-residency guard: refuse (fail-closed) to write recovery
	// bytes to a bucket in a region this tenant is not permitted to reside in.
	// Enforced BEFORE the source is read/encrypted so no work — and no bytes —
	// happen on a cross-region write.
	if err := c.assertResidency(ctx, opts.TenantID, "seal"); err != nil {
		return SealResult{}, err
	}
	if opts.EventTime.IsZero() {
		opts.EventTime = time.Now().UTC()
	}
	retainUntil := opts.RetainUntil
	if retainUntil.IsZero() {
		retainUntil = time.Now().Add(c.cfg.DefaultRetention).UTC()
	}

	plaintext, err := io.ReadAll(source)
	if err != nil {
		return SealResult{}, fmt.Errorf("worm: reading source: %w", err)
	}
	sum := sha256.Sum256(plaintext)
	plaintextHash := hex.EncodeToString(sum[:])

	// Fetch the per-tenant DEK and encrypt. Providers may return either cached
	// provider-owned bytes or caller-owned BYOK unwrap bytes; copyDEK handles the
	// copy and optional release before we use the short-lived AES key.
	key, kekVersion, err := c.copyDEK(ctx, opts.TenantID, opts.StreamID)
	if err != nil {
		return SealResult{}, fmt.Errorf("worm: fetching DEK: %w", err)
	}
	defer zero(key)

	ciphertext, err := aesGCMSeal(key, plaintext)
	if err != nil {
		return SealResult{}, fmt.Errorf("worm: encrypting chunk: %w", err)
	}

	key0 := objectKey(opts.TenantID, opts.StreamID, opts.MarkerLSN, opts.EventTime)
	info, err := c.api.PutObject(ctx, c.cfg.Bucket, key0, bytes.NewReader(ciphertext), int64(len(ciphertext)),
		miniogo.PutObjectOptions{
			ContentType:     "application/octet-stream",
			Mode:            c.retentionMode(),
			RetainUntilDate: retainUntil,
			UserMetadata: map[string]string{
				"dr-tenant-id":        opts.TenantID.String(),
				"dr-stream-id":        opts.StreamID,
				"dr-marker-lsn":       opts.MarkerLSN,
				"dr-plaintext-sha256": plaintextHash,
				"dr-kek-version":      fmt.Sprintf("%d", kekVersion),
				"dr-cipher":           "AES-256-GCM",
			},
			DisableMultipart: true,
		})
	if err != nil {
		return SealResult{}, fmt.Errorf("worm: put sealed chunk: %w", classify(err))
	}

	return SealResult{
		Key:             key0,
		VersionID:       info.VersionID,
		PlaintextSHA256: plaintextHash,
		CiphertextBytes: int64(len(ciphertext)),
		KEKVersion:      kekVersion,
		RetainUntil:     retainUntil.UTC(),
	}, nil
}

// Get downloads a sealed chunk and decrypts it back to the original plaintext
// with the per-tenant DEK. It is the round-trip proof that the bytes at rest
// are real ciphertext that only the tenant's key unwraps.
func (c *Client) Get(ctx context.Context, tenantID uuid.UUID, streamID, key string) ([]byte, error) {
	// Data-plane data-residency guard on the RESTORE/READ path: refuse to serve
	// recovery bytes for a tenant whose data may not reside in this bucket's
	// region. Fail-closed and enforced BEFORE any object is downloaded/decrypted.
	if err := c.assertResidency(ctx, tenantID, "get"); err != nil {
		return nil, err
	}
	obj, err := c.api.GetObject(ctx, c.cfg.Bucket, key, miniogo.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("worm: get object: %w", classify(err))
	}
	defer func() { _ = obj.Close() }()
	ciphertext, err := io.ReadAll(obj)
	if err != nil {
		return nil, fmt.Errorf("worm: reading object: %w", classify(err))
	}

	keyBytes, _, err := c.copyDEK(ctx, tenantID, streamID)
	if err != nil {
		return nil, fmt.Errorf("worm: fetching DEK: %w", err)
	}
	defer zero(keyBytes)

	plaintext, err := aesGCMOpen(keyBytes, ciphertext)
	if err != nil {
		return nil, fmt.Errorf("worm: decrypting chunk: %w", err)
	}
	return plaintext, nil
}

// SetLegalHold turns the object-lock legal-hold on or off for a sealed chunk.
// A legal-held object cannot be removed even with a governance bypass, which is
// the ransomware-safe floor on the newest validated recovery points (§5).
func (c *Client) SetLegalHold(ctx context.Context, key string, hold bool) error {
	status := miniogo.LegalHoldDisabled
	if hold {
		status = miniogo.LegalHoldEnabled
	}
	if err := c.api.PutObjectLegalHold(ctx, c.cfg.Bucket, key, miniogo.PutObjectLegalHoldOptions{
		Status: &status,
	}); err != nil {
		return fmt.Errorf("worm: set legal hold: %w", classify(err))
	}
	return nil
}

// LegalHold reports whether a sealed chunk currently carries a legal-hold.
func (c *Client) LegalHold(ctx context.Context, key string) (bool, error) {
	status, err := c.api.GetObjectLegalHold(ctx, c.cfg.Bucket, key, miniogo.GetObjectLegalHoldOptions{})
	if err != nil {
		return false, fmt.Errorf("worm: get legal hold: %w", classify(err))
	}
	return status != nil && *status == miniogo.LegalHoldEnabled, nil
}

// Delete attempts an ordinary delete (no governance bypass). On a GOVERNANCE
// object still within retention, or one under legal-hold, object-lock refuses
// the delete and this returns ErrObjectLocked. This is the method the
// integration test uses to prove a sealed chunk is immutable to ordinary
// credentials.
//
// NOTE: on a versioned bucket a keyless RemoveObject only adds a delete marker
// (the locked version survives); DeleteVersion is the destructive operation
// object-lock actually refuses. Both are kept so the privilege boundary is
// explicit.
func (c *Client) Delete(ctx context.Context, key string) error {
	err := c.api.RemoveObject(ctx, c.cfg.Bucket, key, miniogo.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("worm: delete object: %w", classify(err))
	}
	return nil
}

// DeleteVersion attempts to permanently destroy a specific sealed version with
// ordinary credentials (no governance bypass). On a GOVERNANCE-locked version
// still within retention, or one under legal-hold, object-lock refuses it and
// this returns ErrObjectLocked — the real ransomware-immutability guarantee. The
// integration test uses this to prove an attacker cannot destroy the recovery
// point's data.
func (c *Client) DeleteVersion(ctx context.Context, key, versionID string) error {
	err := c.api.RemoveObject(ctx, c.cfg.Bucket, key, miniogo.RemoveObjectOptions{
		VersionID: versionID,
	})
	if err != nil {
		return fmt.Errorf("worm: delete version: %w", classify(err))
	}
	return nil
}

// BypassDelete reclaims a sealed chunk using the s3:BypassGovernanceRetention
// privilege (the tightly-held break-glass role, §5). It is refused while a
// legal-hold is in force. Used for the normal operational reclaim cadence and
// by the lifecycle thinner; kept here so the privilege boundary is explicit.
//
// When the client is configured for COMPLIANCE retention there is no bypass to
// exercise — the object is immutable until retention expires even for root — so
// this refuses immediately with ErrComplianceBypass rather than issuing a
// GovernanceBypass the store would reject anyway.
func (c *Client) BypassDelete(ctx context.Context, key string) error {
	if c.retentionMode() == miniogo.Compliance {
		return ErrComplianceBypass
	}
	err := c.api.RemoveObject(ctx, c.cfg.Bucket, key, miniogo.RemoveObjectOptions{
		GovernanceBypass: true,
	})
	if err != nil {
		return fmt.Errorf("worm: governance-bypass delete: %w", classify(err))
	}
	return nil
}

// Stat reports whether an object exists (and its size).
func (c *Client) Stat(ctx context.Context, key string) (int64, error) {
	info, err := c.api.StatObject(ctx, c.cfg.Bucket, key, miniogo.StatObjectOptions{})
	if err != nil {
		return 0, fmt.Errorf("worm: stat object: %w", classify(err))
	}
	return info.Size, nil
}

// Bucket returns the configured bucket name.
func (c *Client) Bucket() string { return c.cfg.Bucket }

// --- retention-mode helpers ---------------------------------------------

// normalizeRetentionMode lower-cases and validates a configured mode string,
// falling back to RetentionModeGovernance for empty/unrecognized values so
// misconfiguration never silently weakens *or* strengthens the posture without
// an explicit, recognized selector.
func normalizeRetentionMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case RetentionModeCompliance:
		return RetentionModeCompliance
	default:
		return RetentionModeGovernance
	}
}

// retentionMode maps the client's normalized config onto the miniogo object-lock
// mode used for the default retention and every sealed PutObject.
func (c *Client) retentionMode() miniogo.RetentionMode {
	if c.cfg.RetentionMode == RetentionModeCompliance {
		return miniogo.Compliance
	}
	return miniogo.Governance
}

// --- crypto + error helpers ---------------------------------------------

func (c *Client) copyDEK(ctx context.Context, tenantID uuid.UUID, name string) ([]byte, int, error) {
	dek, kekVersion, err := c.dek.Get(ctx, tenantID, name)
	if err != nil {
		return nil, 0, err
	}
	key := make([]byte, len(dek))
	copy(key, dek)
	if releaser, ok := c.dek.(DEKReleaser); ok {
		releaser.ReleaseDEK(dek)
	}
	return key, kekVersion, nil
}

// aesGCMSeal encrypts plaintext with AES-256-GCM, prepending the nonce. Same
// wire shape as pkg/storage's content encryptor.
func aesGCMSeal(key, plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, plaintext, nil), nil
}

// aesGCMOpen decrypts AES-256-GCM ciphertext with a prepended nonce.
func aesGCMOpen(key, ciphertextWithNonce []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	ns := gcm.NonceSize()
	if len(ciphertextWithNonce) < ns {
		return nil, errors.New("worm: ciphertext too short")
	}
	return gcm.Open(nil, ciphertextWithNonce[:ns], ciphertextWithNonce[ns:], nil)
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// classify maps minio-go errors onto our sentinels. Object-lock refusals come
// back as 403 AccessDenied with a WORM/retention/legal-hold message.
func classify(err error) error {
	if err == nil {
		return nil
	}
	resp := miniogo.ToErrorResponse(err)
	switch {
	case resp.Code == "NoSuchKey", resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%w: %s", ErrObjectNotFound, err.Error())
	case isLockError(resp):
		return fmt.Errorf("%w: %s", ErrObjectLocked, err.Error())
	}
	return err
}

func isLockError(resp miniogo.ErrorResponse) bool {
	if resp.StatusCode == 0 || resp.StatusCode == http.StatusOK {
		return false
	}
	msg := strings.ToLower(resp.Message)
	if strings.Contains(msg, "worm") || strings.Contains(msg, "object lock") ||
		strings.Contains(msg, "legal hold") || strings.Contains(msg, "retention") ||
		resp.Code == "InvalidRetentionPeriod" {
		return true
	}
	// MinIO returns 403 AccessDenied for a delete blocked by GOVERNANCE mode
	// without a bypass; treat AccessDenied on a delete path as a lock refusal.
	if resp.Code == "AccessDenied" && resp.StatusCode == http.StatusForbidden {
		return true
	}
	return false
}
