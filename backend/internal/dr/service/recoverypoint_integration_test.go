//go:build integration

// Recovery-point WORM + DEK integration test (WP-4).
//
// This is the real, no-stub proof of the WP-4 deliverable. It stands up MinIO
// with object-locking enabled and Postgres (testcontainers), wires the real
// worm.Client + a deterministic per-tenant DEK provider into the DR Service, and
// drives SealRecoveryPoint / ValidateRecoveryPoint end to end. It asserts:
//
//   - the sealed object exists in the WORM bucket;
//   - a naive delete (no governance bypass) is BLOCKED by object-lock;
//   - the encrypted bytes at rest are NOT the plaintext, and decrypt back to the
//     original via the per-tenant DEK;
//   - rpo_seconds is computed from the chunk's last commit;
//   - the validation match ratio is >= 0.999 (the GA threshold);
//   - the newest validated point carries an object-lock legal-hold (the
//     ransomware-safe floor) and the recovery_point row records it;
//   - the dr.recovery_point.sealed / .validated events land in the outbox.
//
// Run: GOWORK=off go test -tags=integration ./internal/dr/... -count=1
package service_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	miniogo "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/service"
	"github.com/clario360/platform/internal/dr/worm"
	"github.com/clario360/platform/internal/events/outbox"
)

const (
	itTenantID  = "aaaaaaaa-0000-0000-0000-000000000001"
	itMinioUser = "minioadmin"
	itMinioPass = "minioadmin"
	itBucket    = "dr-recovery-points-it"
)

// fixedDEKProvider returns a deterministic 32-byte AES-256 key derived from the
// (tenant, stream) pair. This stands in for the Vault-backed DEKManager — the
// crypto path it exercises is identical (AES-256-GCM with this key), so the
// round-trip and "ciphertext != plaintext" assertions are real. The integration
// proof we care about for WP-4 is the WORM object-lock + the at-rest encryption;
// Vault Transit wrapping of the KEK is exercised by the SIEM crypto suite.
type fixedDEKProvider struct{}

func (fixedDEKProvider) Get(_ context.Context, tenantID uuid.UUID, name string) ([]byte, int, error) {
	sum := sha256.Sum256([]byte("dr-it-dek|" + tenantID.String() + "|" + name))
	return sum[:], 1, nil
}

// startPG spins up postgres:16-alpine and applies all dr_db migrations.
func startPGForRP(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("dr_it"),
		postgresmod.WithUsername("dr"),
		postgresmod.WithPassword("dr"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn := container.MustConnectionString(ctx, "sslmode=disable")
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "migrations", "dr_db")
	migs, err := filepath.Glob(filepath.Join(migDir, "*.up.sql"))
	if err != nil {
		t.Fatalf("glob dr_db migrations: %v", err)
	}
	sort.Strings(migs)
	for _, m := range migs {
		b, err := os.ReadFile(m)
		if err != nil {
			t.Fatalf("read migration %s: %v", m, err)
		}
		if _, err := pool.Exec(ctx, string(b)); err != nil {
			t.Fatalf("apply migration %s: %v", filepath.Base(m), err)
		}
	}
	return ctx, pool
}

// startMinIO spins up MinIO with object-locking available (the bucket is created
// --with-lock by worm.Client.EnsureBucket). Returns the endpoint host:port.
func startMinIO(t *testing.T, ctx context.Context) string {
	t.Helper()

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

// pgTenantRunner runs service callbacks under the tenant RLS transaction context
// against a real pool (the production TenantRunner behaviour).
type pgTenantRunner struct{ pool *pgxpool.Pool }

func (r pgTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r pgTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func seedAppliedFrame(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID, streamID uuid.UUID, seq int64, marker string, payload []byte, appliedAt time.Time) {
	t.Helper()
	sum := sha256.Sum256(payload)
	if err := database.RunWithTenant(ctx, pool, tenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
INSERT INTO dr_applied_frame
    (tenant_id, stream_id, seq, kind, source_marker, payload, payload_sha256, payload_bytes, applied_at)
VALUES ($1,$2,$3,'WAL',$4,$5,$6,$7,$8)`,
			tenantID, streamID, seq, marker, payload, fmt.Sprintf("%x", sum[:]), int64(len(payload)), appliedAt)
		return err
	}); err != nil {
		t.Fatalf("seed applied frame stream=%s seq=%d: %v", streamID, seq, err)
	}
}

func TestRecoveryPointWORMDEKIntegration(t *testing.T) {
	ctx, pool := startPGForRP(t)
	endpoint := startMinIO(t, ctx)

	tenantID := uuid.MustParse(itTenantID)

	// Seed a tenant, a protected site, a consistency group + member, and a
	// streaming replication stream, all directly through the tenant RLS path.
	groupID := uuid.New()
	siteID := uuid.New()
	streamID := uuid.New()
	lastCommit := time.Now().UTC().Add(-42 * time.Second) // → rpo ~42s
	appliedOne := []byte("durable-applied-one|")
	appliedTwo := []byte("durable-applied-two")
	wantPlaintext := append(append([]byte(nil), appliedOne...), appliedTwo...)

	mustExec := func(sql string, args ...any) {
		t.Helper()
		if err := database.RunWithTenant(ctx, pool, tenantID, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, sql, args...)
			return err
		}); err != nil {
			t.Fatalf("seed exec %q: %v", sql, err)
		}
	}
	mustExec(`INSERT INTO consistency_group (id, tenant_id, name) VALUES ($1,$2,$3)`,
		groupID, tenantID, "payments")
	mustExec(`INSERT INTO protected_site (id, tenant_id, name, kind, primary_endpoint) VALUES ($1,$2,$3,'database','pg://primary')`,
		siteID, tenantID, "core-db")
	mustExec(`INSERT INTO consistency_group_member (group_id, site_id, boot_order) VALUES ($1,$2,10)`,
		groupID, siteID)
	mustExec(`INSERT INTO replication_stream (id, tenant_id, site_id, status, applied_seq, source_lsn, applied_at)
	          VALUES ($1,$2,$3,'streaming',2,'0/CURSOR-ONLY',$4)`,
		streamID, tenantID, siteID, lastCommit)
	seedAppliedFrame(t, ctx, pool, tenantID, streamID, 1, "0/APPLIED1", appliedOne, lastCommit.Add(-time.Second))
	seedAppliedFrame(t, ctx, pool, tenantID, streamID, 2, "0/APPLIED2", appliedTwo, lastCommit)

	// Build the real WORM client + DEK provider and wire the service.
	logger := zerolog.Nop()
	wormClient, err := worm.New(worm.Config{
		Endpoint:         endpoint,
		AccessKey:        itMinioUser,
		SecretKey:        itMinioPass,
		Bucket:           itBucket,
		DefaultRetention: 48 * time.Hour,
	}, fixedDEKProvider{}, logger)
	if err != nil {
		t.Fatalf("worm.New: %v", err)
	}

	// Use the REAL transactional outbox so we can assert the dr events land in
	// event_outbox (datastream.dr.events) committed in the same transaction as
	// the recovery_point row.
	if err := outbox.EnsureSchema(ctx, pool); err != nil {
		t.Fatalf("outbox EnsureSchema: %v", err)
	}
	svc := service.NewWithDeps(pgTenantRunner{pool: pool}, repository.New(), service.OutboxStager{}, logger).
		WithRecoveryPoint(wormClient, nil, nil, 1)

	outboxCount := func(eventType string) int {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx,
			`SELECT count(*) FROM event_outbox WHERE topic = $1 AND event_type LIKE '%' || $2`,
			"datastream.dr.events", eventType).Scan(&n); err != nil {
			t.Fatalf("count outbox %s: %v", eventType, err)
		}
		return n
	}

	// --- Seal ------------------------------------------------------------
	point, err := svc.SealRecoveryPoint(ctx, tenantID, groupID, service.SealRecoveryPointInput{})
	if err != nil {
		t.Fatalf("SealRecoveryPoint: %v", err)
	}
	objKey, ok := point.ObjectKeys[streamID.String()]
	if !ok {
		t.Fatalf("object key missing for stream; keys=%v", point.ObjectKeys)
	}
	if point.RPOSeconds < 40 || point.RPOSeconds > 60 {
		t.Fatalf("rpo_seconds = %d, want ~42", point.RPOSeconds)
	}
	if point.ContentHash == "" {
		t.Fatal("content hash empty")
	}
	if point.MarkerLSN != "0/APPLIED2" {
		t.Fatalf("marker_lsn = %q, want durable applied marker 0/APPLIED2", point.MarkerLSN)
	}
	if outboxCount("dr.recovery_point.sealed") != 1 {
		t.Fatalf("sealed outbox events = %d, want 1", outboxCount("dr.recovery_point.sealed"))
	}

	// A raw MinIO client for the at-rest assertions (independent of worm.Client).
	raw, err := miniogo.New(endpoint, &miniogo.Options{
		Creds:  credentials.NewStaticV4(itMinioUser, itMinioPass, ""),
		Secure: false,
	})
	if err != nil {
		t.Fatalf("raw minio client: %v", err)
	}

	// Assert the object exists and capture its locked version.
	stat, err := raw.StatObject(ctx, itBucket, objKey, miniogo.StatObjectOptions{})
	if err != nil {
		t.Fatalf("StatObject: %v", err)
	}
	if stat.Size == 0 {
		t.Fatal("sealed object is empty")
	}
	versionID := stat.VersionID
	if versionID == "" {
		t.Fatal("sealed object has no version id — object-lock requires a versioned bucket")
	}

	// Assert the bytes at rest are ciphertext (NOT the plaintext applied bytes).
	obj, err := raw.GetObject(ctx, itBucket, objKey, miniogo.GetObjectOptions{})
	if err != nil {
		t.Fatalf("GetObject: %v", err)
	}
	atRest, err := io.ReadAll(obj)
	_ = obj.Close()
	if err != nil {
		t.Fatalf("read object: %v", err)
	}
	if bytes.Contains(atRest, wantPlaintext) || bytes.Contains(atRest, []byte("clario-dr.checkpoint")) {
		t.Fatal("object at rest contains plaintext — encryption is a no-op")
	}

	// Assert a destructive delete of the locked VERSION (no governance bypass)
	// is BLOCKED by object-lock. This is the real ransomware-immutability proof:
	// an attacker with ordinary credentials cannot permanently destroy the data
	// version. (A keyless RemoveObject on a versioned bucket only adds a delete
	// marker and leaves the locked version intact, so we target the version.)
	delErr := raw.RemoveObject(ctx, itBucket, objKey, miniogo.RemoveObjectOptions{VersionID: versionID})
	if delErr == nil {
		t.Fatal("version delete succeeded — WORM object-lock (GOVERNANCE) is not enforced")
	}
	t.Logf("WORM version delete blocked as expected: %v", delErr)
	// The locked version must still be present after the refused delete.
	if _, err := raw.StatObject(ctx, itBucket, objKey, miniogo.StatObjectOptions{VersionID: versionID}); err != nil {
		t.Fatalf("locked version gone after blocked delete: %v", err)
	}

	// Assert decrypt round-trips via the DEK (worm.Client.Get).
	plaintext, err := wormClient.Get(ctx, tenantID, streamID.String(), objKey)
	if err != nil {
		t.Fatalf("worm Get/decrypt: %v", err)
	}
	if !bytes.Equal(plaintext, wantPlaintext) {
		t.Fatalf("decrypted chunk = %q, want durable applied bytes %q", plaintext, wantPlaintext)
	}
	t.Logf("decrypt round-trips: %d ciphertext bytes -> %d plaintext bytes", len(atRest), len(plaintext))

	// --- Validate --------------------------------------------------------
	validated, err := svc.ValidateRecoveryPoint(ctx, tenantID, uuid.MustParse(point.ID))
	if err != nil {
		t.Fatalf("ValidateRecoveryPoint: %v", err)
	}
	if validated.ValidationRatio == nil || *validated.ValidationRatio < 0.999 {
		t.Fatalf("validation ratio = %v, want >= 0.999", validated.ValidationRatio)
	}
	if !validated.IsValidated {
		t.Fatal("recovery point not marked validated")
	}
	if !validated.LegalHold {
		t.Fatal("newest validated point does not carry a legal hold")
	}
	if outboxCount("dr.recovery_point.validated") != 1 {
		t.Fatalf("validated outbox events = %d, want 1", outboxCount("dr.recovery_point.validated"))
	}

	// Assert the object-lock legal-hold is really set on the WORM object.
	lh, err := raw.GetObjectLegalHold(ctx, itBucket, objKey, miniogo.GetObjectLegalHoldOptions{})
	if err != nil {
		t.Fatalf("GetObjectLegalHold: %v", err)
	}
	if lh == nil || *lh != miniogo.LegalHoldEnabled {
		t.Fatalf("legal hold = %v, want ON", lh)
	}

	// Assert the recovery_point row records the legal hold + validation.
	var rowValidated, rowLegalHold bool
	var rowRatio float64
	if err := database.RunReadWithTenant(ctx, pool, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx,
			`SELECT is_validated, legal_hold, validation_ratio FROM recovery_point WHERE id = $1`,
			point.ID).Scan(&rowValidated, &rowLegalHold, &rowRatio)
	}); err != nil {
		t.Fatalf("read recovery_point row: %v", err)
	}
	if !rowValidated || !rowLegalHold || rowRatio < 0.999 {
		t.Fatalf("recovery_point row = {validated:%v hold:%v ratio:%v}, want validated+held+>=0.999",
			rowValidated, rowLegalHold, rowRatio)
	}
}
