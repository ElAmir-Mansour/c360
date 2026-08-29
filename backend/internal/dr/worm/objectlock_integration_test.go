//go:build integration

// WORM object-lock enforcement integration test (Wave 2 hardening).
//
// This is the real, no-stub proof that the DR WORM store is fail-closed against a
// MISPROVISIONED bucket and immutable in GOVERNANCE mode. It stands up an
// EPHEMERAL MinIO (testcontainers) with object-locking AVAILABLE and asserts, all
// against a throwaway dev container — never a prod bucket:
//
//   - AssertObjectLock / EnsureBucket PASS on a bucket that really has object-lock
//     enabled (the positive assertion succeeds);
//   - AssertObjectLock FAILS with ErrObjectLockNotEnabled on a PLAIN bucket
//     created WITHOUT object-lock — the misprovisioned-bucket catch, by assertion;
//   - a Seal against that plain bucket FAILS via the new assertion (EnsureBucket
//     refuses to proceed), so no chunk is ever written with no retention;
//   - GOVERNANCE immutability: a sealed chunk's locked VERSION cannot be
//     destroyed by ordinary credentials (delete is refused → ErrObjectLocked),
//     and the version survives the refused delete.
//
// GOVERNANCE mode ONLY. There is deliberately NO compliance-mode object written
// anywhere in this file — the un-bypassable compliance write is DEFERRED to the
// dedicated regulated environment (a compliance-locked object cannot be reclaimed
// on a normal cadence and must never be created against a shared/dev store).
//
// Run: GOWORK=off go test -tags=integration ./internal/dr/worm/... -count=1
package worm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	miniogo "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	itMinioUser = "minioadmin"
	itMinioPass = "minioadmin"
)

// itDEKProvider returns a deterministic 32-byte AES-256 key derived from the
// (tenant, stream) pair. It stands in for the Vault-backed DEKManager; the crypto
// path (AES-256-GCM with this key) is identical, so the round-trip is real. The
// object-lock assertions here do not depend on the key material.
type itDEKProvider struct{}

func (itDEKProvider) Get(_ context.Context, tenantID uuid.UUID, name string) ([]byte, int, error) {
	sum := sha256.Sum256([]byte("dr-worm-it-dek|" + tenantID.String() + "|" + name))
	return sum[:], 1, nil
}

// startMinIO spins up an EPHEMERAL MinIO with object-locking AVAILABLE (buckets
// are created --with-lock by the code under test). Returns the endpoint host:port.
// The container is terminated on test cleanup — nothing persists.
func startMinIO(t *testing.T, ctx context.Context) string {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	req := tc.ContainerRequest{
		Image:        "minio/minio:RELEASE.2024-01-16T16-07-38Z",
		ExposedPorts: []string{"9000/tcp"},
		Env: map[string]string{
			"MINIO_ROOT_USER":     itMinioUser,
			"MINIO_ROOT_PASSWORD": itMinioPass,
		},
		Cmd: []string{"server", "/data"},
		WaitingFor: wait.ForHTTP("/minio/health/live").
			WithPort("9000/tcp").
			WithStartupTimeout(90 * time.Second),
	}
	container, err := tc.GenericContainer(ctx, tc.GenericContainerRequest{
		ContainerRequest: req,
		Started:          true,
	})
	if err != nil {
		t.Fatalf("start minio: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	host, err := container.Host(ctx)
	if err != nil {
		t.Fatalf("minio host: %v", err)
	}
	port, err := container.MappedPort(ctx, "9000/tcp")
	if err != nil {
		t.Fatalf("minio port: %v", err)
	}
	return fmt.Sprintf("%s:%s", host, port.Port())
}

// rawClient builds a bare minio-go client for out-of-band bucket setup and
// at-rest assertions, independent of the worm.Client under test.
func rawClient(t *testing.T, endpoint string) *miniogo.Client {
	t.Helper()
	raw, err := miniogo.New(endpoint, &miniogo.Options{
		Creds:  credentials.NewStaticV4(itMinioUser, itMinioPass, ""),
		Secure: false,
	})
	if err != nil {
		t.Fatalf("raw minio client: %v", err)
	}
	return raw
}

// newWORMClient builds a GOVERNANCE-mode worm.Client against the ephemeral MinIO.
func newWORMClient(t *testing.T, endpoint, bucket string) *Client {
	t.Helper()
	c, err := New(Config{
		Endpoint:         endpoint,
		AccessKey:        itMinioUser,
		SecretKey:        itMinioPass,
		Bucket:           bucket,
		DefaultRetention: 48 * time.Hour,
		// RetentionMode left empty → normalizes to GOVERNANCE. No compliance here.
	}, itDEKProvider{}, zerolog.Nop())
	if err != nil {
		t.Fatalf("worm.New: %v", err)
	}
	return c
}

// TestAssertObjectLock_FailsClosedOnPlainBucket is the core Wave 2 assertion: a
// pre-existing bucket created WITHOUT object-lock is caught by the positive
// AssertObjectLock probe (ErrObjectLockNotEnabled), and a Seal against it is
// refused because EnsureBucket fails closed — no chunk is written with no
// retention. The mirror case proves the probe PASSES on a real object-lock bucket.
func TestAssertObjectLock_FailsClosedOnPlainBucket(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	endpoint := startMinIO(t, ctx)
	raw := rawClient(t, endpoint)

	// --- Plain bucket: object-lock OFF ----------------------------------
	plainBucket := "dr-plain-no-lock"
	if err := raw.MakeBucket(ctx, plainBucket, miniogo.MakeBucketOptions{}); err != nil {
		t.Fatalf("make plain bucket: %v", err)
	}
	plainClient := newWORMClient(t, endpoint, plainBucket)

	// AssertObjectLock must FAIL CLOSED with ErrObjectLockNotEnabled.
	if err := plainClient.AssertObjectLock(ctx); !errors.Is(err, ErrObjectLockNotEnabled) {
		t.Fatalf("AssertObjectLock on plain bucket = %v, want ErrObjectLockNotEnabled", err)
	}

	// EnsureBucket must FAIL on the pre-existing plain bucket (SetObjectLockConfig
	// / the assertion refuses it) — it must NOT silently "fix" a misprovisioned
	// bucket into a WORM one.
	if err := plainClient.EnsureBucket(ctx); err == nil {
		t.Fatal("EnsureBucket on a pre-existing plain bucket succeeded; want fail-closed error")
	} else {
		t.Logf("EnsureBucket fail-closed on plain bucket as expected: %v", err)
	}

	// A Seal against the plain bucket must be refused by the assertion at
	// bucket-preflight time (we call EnsureBucket before seal, as production wiring
	// does). Prove no object landed with no retention: the bucket stays empty.
	if err := plainClient.EnsureBucket(ctx); err == nil {
		t.Fatal("EnsureBucket unexpectedly succeeded on second call")
	}
	// Confirm nothing was written to the plain bucket by the refused path.
	objectsCh := raw.ListObjects(ctx, plainBucket, miniogo.ListObjectsOptions{Recursive: true})
	for obj := range objectsCh {
		t.Fatalf("plain bucket unexpectedly contains an object %q — a chunk was written with no retention", obj.Key)
	}

	// --- Real object-lock bucket: assertion PASSES ----------------------
	lockBucket := "dr-recovery-points-it"
	lockClient := newWORMClient(t, endpoint, lockBucket)
	if err := lockClient.EnsureBucket(ctx); err != nil {
		t.Fatalf("EnsureBucket on a lock-capable bucket: %v", err)
	}
	if err := lockClient.AssertObjectLock(ctx); err != nil {
		t.Fatalf("AssertObjectLock on a real object-lock bucket = %v, want nil", err)
	}

	// Positive cross-check straight from the wire: object-lock reports Enabled and
	// the default mode is GOVERNANCE (what this client is configured for).
	objectLock, mode, _, _, err := raw.GetObjectLockConfig(ctx, lockBucket)
	if err != nil {
		t.Fatalf("GetObjectLockConfig on lock bucket: %v", err)
	}
	if objectLock != "Enabled" {
		t.Fatalf("object-lock marker = %q, want \"Enabled\"", objectLock)
	}
	if mode == nil || *mode != miniogo.Governance {
		t.Fatalf("default object-lock mode = %v, want GOVERNANCE", mode)
	}
}

// TestSeal_GovernanceImmutability proves the ransomware-immutability guarantee end
// to end against the ephemeral MinIO: a GOVERNANCE-sealed chunk's locked VERSION
// cannot be destroyed by ordinary credentials (no governance bypass) while it is
// within retention, and the version survives the refused delete.
func TestSeal_GovernanceImmutability(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	endpoint := startMinIO(t, ctx)
	raw := rawClient(t, endpoint)

	bucket := "dr-recovery-points-gov"
	c := newWORMClient(t, endpoint, bucket)
	if err := c.EnsureBucket(ctx); err != nil {
		t.Fatalf("EnsureBucket: %v", err)
	}

	tenantID := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	plaintext := []byte("durable recovery chunk — governance immutable")
	res, err := c.Seal(ctx, bytes.NewReader(plaintext), SealOptions{
		TenantID:    tenantID,
		StreamID:    "stream-gov",
		MarkerLSN:   "0/GOV1",
		RetainUntil: time.Now().Add(48 * time.Hour).UTC(),
	})
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if res.VersionID == "" {
		t.Fatal("sealed object has no version id — object-lock requires a versioned bucket")
	}

	// Bytes at rest must be ciphertext, not plaintext.
	obj, err := raw.GetObject(ctx, bucket, res.Key, miniogo.GetObjectOptions{})
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	atRest := new(bytes.Buffer)
	_, _ = atRest.ReadFrom(obj)
	_ = obj.Close()
	if bytes.Contains(atRest.Bytes(), plaintext) {
		t.Fatal("object at rest contains plaintext — encryption is a no-op")
	}

	// A destructive delete of the locked VERSION (no governance bypass) must be
	// REFUSED by object-lock and surface as ErrObjectLocked through the client.
	delErr := c.DeleteVersion(ctx, res.Key, res.VersionID)
	if delErr == nil {
		t.Fatal("version delete succeeded — GOVERNANCE object-lock is not enforced")
	}
	if !errors.Is(delErr, ErrObjectLocked) {
		t.Fatalf("DeleteVersion on retained governance chunk = %v, want ErrObjectLocked", delErr)
	}
	t.Logf("GOVERNANCE version delete blocked as expected: %v", delErr)

	// The locked version must still exist after the refused delete.
	if _, err := raw.StatObject(ctx, bucket, res.Key, miniogo.StatObjectOptions{VersionID: res.VersionID}); err != nil {
		t.Fatalf("locked version gone after blocked delete: %v", err)
	}

	// Round-trip decrypt proves the retained bytes are the real chunk.
	got, err := c.Get(ctx, tenantID, "stream-gov", res.Key)
	if err != nil {
		t.Fatalf("Get/decrypt: %v", err)
	}
	if !bytes.Equal(got, plaintext) {
		t.Fatalf("decrypted chunk = %q, want %q", got, plaintext)
	}
}

// NOTE: The un-bypassable COMPLIANCE-mode write test is intentionally DEFERRED to
// a dedicated regulated environment. A compliance-locked object cannot be
// reclaimed on a normal cadence (not even by root) until retention expires, so it
// must NEVER be created against a shared or ephemeral dev store. This file writes
// GOVERNANCE objects only.
