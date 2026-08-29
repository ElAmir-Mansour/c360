//go:build integration

package core

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/dr/repository"
)

const itTenant = "aaaaaaaa-0000-0000-0000-000000000001"

// startPG spins up postgres:16-alpine (same image as
// internal/license/service/integration_test.go), applies the dr_db migration so
// the replication_stream RPO ledger exists, and returns a pool.
func startPG(t *testing.T) (context.Context, *pgxpool.Pool) {
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

	pool, err := pgxpool.New(ctx, container.MustConnectionString(ctx, "sslmode=disable"))
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "migrations", "dr_db")
	migrations, err := filepath.Glob(filepath.Join(migDir, "*.up.sql"))
	if err != nil {
		t.Fatalf("glob dr_db migrations: %v", err)
	}
	sort.Strings(migrations)
	for _, migPath := range migrations {
		mig, err := os.ReadFile(migPath)
		if err != nil {
			t.Fatalf("read dr_db migration %s: %v", migPath, err)
		}
		if _, err := pool.Exec(ctx, string(mig)); err != nil {
			t.Fatalf("apply dr_db migration %s: %v", migPath, err)
		}
	}
	return ctx, pool
}

func startPGLogical(t *testing.T) (context.Context, *pgxpool.Pool, string) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("logical_it"),
		postgresmod.WithUsername("logical"),
		postgresmod.WithPassword("logical"),
		tc.WithCmd("postgres",
			"-c", "fsync=off",
			"-c", "wal_level=logical",
			"-c", "max_replication_slots=4",
			"-c", "max_wal_senders=4",
		),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start logical postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	connString := container.MustConnectionString(ctx, "sslmode=disable")
	pool, err := pgxpool.New(ctx, connString)
	if err != nil {
		t.Fatalf("open logical pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return ctx, pool, connString
}

// pgCDCTableConfig is the shared table shape for the CDC tests: a users-like
// table with a UUID primary key and an updated_at watermark.
func pgCDCTableConfig(schema string) PGTableConfig {
	return PGTableConfig{
		Schema:     schema,
		Table:      "account",
		Columns:    []string{"id", "name", "balance", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	}
}

func createAccountTable(t *testing.T, ctx context.Context, pool *pgxpool.Pool, schema string) {
	t.Helper()
	if _, err := pool.Exec(ctx, fmt.Sprintf(`CREATE SCHEMA IF NOT EXISTS %q`, schema)); err != nil {
		t.Fatalf("create schema %s: %v", schema, err)
	}
	ddl := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %q.account (
		id UUID PRIMARY KEY,
		name TEXT NOT NULL,
		balance BIGINT NOT NULL,
		updated_at TIMESTAMPTZ NOT NULL
	)`, schema)
	if _, err := pool.Exec(ctx, ddl); err != nil {
		t.Fatalf("create account in %s: %v", schema, err)
	}
}

func seedAccounts(t *testing.T, ctx context.Context, pool *pgxpool.Pool, schema string, n int, base time.Time) {
	t.Helper()
	for i := 0; i < n; i++ {
		_, err := pool.Exec(ctx,
			fmt.Sprintf(`INSERT INTO %q.account (id, name, balance, updated_at) VALUES (gen_random_uuid(), $1, $2, $3)`, schema),
			fmt.Sprintf("acct-%d", i), int64(i*100), base.Add(time.Duration(i)*time.Millisecond))
		if err != nil {
			t.Fatalf("seed account %d: %v", i, err)
		}
	}
}

// newPGCapturer builds the source capturer for a one-shot drain.
func newPGCapturer(t *testing.T, pool *pgxpool.Pool, streamID, srcSchema, resumeWM string) *PGCapturer {
	t.Helper()
	cap, err := NewPGCapturer(pool, streamID, pgCDCTableConfig(srcSchema))
	if err != nil {
		t.Fatalf("capturer: %v", err)
	}
	cap.Continuous = false
	cap.BatchSize = 50
	if resumeWM != "" {
		cap.SetResumeWatermark(resumeWM)
	}
	return cap
}

// runPGReplication captures srcSchema.account and applies into tgtSchema.account
// through the real byte-stream Transport (StreamTransportAdapter over a net.Pipe
// duplex), orchestrated by the Pipeline, with cp as the durable Checkpointer. It
// uses the proven adapter wiring: the pipeline drives Send (capturer frames ship
// over the pipe) and Receive (frames decoded, applied, contiguously
// checkpointed). It returns after the one-shot (non-continuous) capturer drains.
func runPGReplication(t *testing.T, ctx context.Context, pool *pgxpool.Pool, srcSchema, tgtSchema string, cp Checkpointer, streamID string, resumeWM string) error {
	t.Helper()

	cap := newPGCapturer(t, pool, streamID, srcSchema, resumeWM)
	app, err := NewPGApplier(pool, pgCDCTableConfig(tgtSchema))
	if err != nil {
		return fmt.Errorf("applier: %w", err)
	}

	sendT, err := NewStreamTransport(testDEK)
	if err != nil {
		return err
	}
	recvT, err := NewStreamTransport(testDEK)
	if err != nil {
		return err
	}
	sender, receiver := NewPipeConnPair()
	tr, err := NewStreamTransportAdapter(sendT, sender, recvT, receiver)
	if err != nil {
		return fmt.Errorf("adapter: %w", err)
	}

	pipe := NewPipeline(PipelineConfig{EmitEveryFrames: 16, EmitInterval: time.Hour}, nil)
	if err := pipe.Run(ctx, streamID, cap, tr, app, cp, nil); err != nil && !isClosedConnErr(err) {
		return fmt.Errorf("pipeline: %w", err)
	}
	return nil
}

func TestPGCDC_SnapshotAndIncremental(t *testing.T) {
	ctx, pool := startPG(t)
	createAccountTable(t, ctx, pool, "src")
	createAccountTable(t, ctx, pool, "dst")

	base := time.Now().UTC().Truncate(time.Millisecond)
	seedAccounts(t, ctx, pool, "src", 120, base)

	streamID := setupStreamRow(t, ctx, pool)
	store := repository.NewCheckpointStore(repository.New(), pool, itTenant)
	cp, err := NewDBCheckpointer(store, streamID)
	if err != nil {
		t.Fatalf("DBCheckpointer: %v", err)
	}

	// Snapshot phase.
	if err := runPGReplication(t, ctx, pool, "src", "dst", cp, streamID, ""); err != nil {
		t.Fatalf("snapshot replication: %v", err)
	}
	assertPGMatch(t, ctx, pool, "src", "dst", ">=0.999 after snapshot")

	// Mutate + insert at the source after the snapshot, advancing the watermark.
	mutBase := base.Add(time.Hour)
	if _, err := pool.Exec(ctx, `UPDATE src.account SET balance = balance + 1, updated_at = $1 WHERE name = 'acct-5'`, mutBase); err != nil {
		t.Fatalf("mutate: %v", err)
	}
	seedAccountsFrom(t, ctx, pool, "src", 30, mutBase.Add(time.Second), 1000)

	// Resume the incremental phase from the persisted checkpoint watermark.
	wm := lastSourceLSN(t, ctx, pool, streamID)
	if err := runPGReplication(t, ctx, pool, "src", "dst", cp, streamID, wm); err != nil {
		t.Fatalf("incremental replication: %v", err)
	}
	assertPGMatch(t, ctx, pool, "src", "dst", ">=0.999 after incremental")
}

func TestPGCDC_ResumeMidStreamFromCheckpoint(t *testing.T) {
	ctx, pool := startPG(t)
	createAccountTable(t, ctx, pool, "src2")
	createAccountTable(t, ctx, pool, "dst2")

	base := time.Now().UTC().Truncate(time.Millisecond)
	seedAccounts(t, ctx, pool, "src2", 200, base)

	streamID := setupStreamRow(t, ctx, pool)
	store := repository.NewCheckpointStore(repository.New(), pool, itTenant)
	cp, err := NewDBCheckpointer(store, streamID)
	if err != nil {
		t.Fatalf("DBCheckpointer: %v", err)
	}

	// First run: cancel mid-snapshot to simulate a control-plane kill. We bound
	// the run with a short deadline so only part of the snapshot lands; the
	// DBCheckpointer has already persisted the contiguous progress.
	cctx, ccancel := context.WithCancel(ctx)
	cap, err := NewPGCapturer(pool, streamID, pgCDCTableConfig("src2"))
	if err != nil {
		t.Fatalf("capturer: %v", err)
	}
	cap.Continuous = false
	cap.BatchSize = 20
	app, err := NewPGApplier(pool, pgCDCTableConfig("dst2"))
	if err != nil {
		t.Fatalf("applier: %v", err)
	}
	recvT, _ := NewStreamTransport(testDEK)
	sendT, _ := NewStreamTransport(testDEK)
	sender, receiver := NewPipeConnPair()
	tr, err := NewStreamTransportAdapter(sendT, sender, recvT, receiver)
	if err != nil {
		t.Fatalf("adapter: %v", err)
	}
	pipe := NewPipeline(PipelineConfig{EmitEveryFrames: 8}, nil)

	// Cancel once a chunk of rows have been durably checkpointed.
	go func() {
		for {
			select {
			case <-cctx.Done():
				return
			case <-time.After(2 * time.Millisecond):
			}
			c, _ := cp.Load(ctx, streamID)
			if c.AppliedSeq >= 40 {
				ccancel()
				return
			}
		}
	}()
	_ = pipe.Run(cctx, streamID, cap, tr, app, cp, nil)
	ccancel()

	mid, err := cp.Load(ctx, streamID)
	if err != nil {
		t.Fatalf("load mid checkpoint: %v", err)
	}
	if mid.AppliedSeq == 0 {
		t.Fatalf("no progress checkpointed before kill")
	}
	t.Logf("killed after applied_seq=%d", mid.AppliedSeq)

	// Resume: a fresh capturer/applier/pipeline reading the persisted checkpoint
	// must complete the table with no loss and no duplicate-corruption.
	wm := lastSourceLSN(t, ctx, pool, streamID)
	if err := runPGReplication(t, ctx, pool, "src2", "dst2", cp, streamID, wm); err != nil {
		t.Fatalf("resume replication: %v", err)
	}
	assertPGMatch(t, ctx, pool, "src2", "dst2", ">=0.999 after resume")
}

func TestPGOutputLogicalReplication_LiveSlot(t *testing.T) {
	ctx, pool, connString := startPGLogical(t)

	if _, err := pool.Exec(ctx, `CREATE TABLE public.account (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		balance BIGINT NOT NULL,
		updated_at TIMESTAMPTZ NOT NULL
	)`); err != nil {
		t.Fatalf("create logical account table: %v", err)
	}
	if _, err := pool.Exec(ctx, `CREATE PUBLICATION clario_pub FOR TABLE public.account`); err != nil {
		t.Fatalf("create publication: %v", err)
	}
	var slotLSN string
	if err := pool.QueryRow(ctx, `SELECT lsn::text FROM pg_create_logical_replication_slot('clario_pgoutput_it', 'pgoutput')`).Scan(&slotLSN); err != nil {
		t.Fatalf("create logical slot: %v", err)
	}

	base := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	if _, err := pool.Exec(ctx, `INSERT INTO public.account (id, name, balance, updated_at) VALUES ($1, $2, $3, $4)`,
		"acct-1", "alpha", int64(10), base); err != nil {
		t.Fatalf("insert acct-1: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE public.account SET name = $2, balance = $3, updated_at = $4 WHERE id = $1`,
		"acct-1", "alpha2", int64(20), base.Add(time.Second)); err != nil {
		t.Fatalf("update acct-1: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM public.account WHERE id = $1`, "acct-1"); err != nil {
		t.Fatalf("delete acct-1: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO public.account (id, name, balance, updated_at) VALUES ($1, $2, $3, $4)`,
		"acct-2", "beta", int64(30), base.Add(2*time.Second)); err != nil {
		t.Fatalf("insert acct-2: %v", err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE public.account`); err != nil {
		t.Fatalf("truncate account: %v", err)
	}

	args, err := PGOutputPluginArgs("clario_pub")
	if err != nil {
		t.Fatalf("pgoutput args: %v", err)
	}
	src, err := NewPGOutputLogSource(ctx, PGConnLogicalReplicationConfig{
		ConnString: connString,
		SlotName:   "clario_pgoutput_it",
		PluginArgs: args,
	})
	if err != nil {
		t.Fatalf("NewPGOutputLogSource: %v", err)
	}
	t.Cleanup(func() { _ = src.Close() })

	streamCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	after := slotLSN
	records := make([]PGLogRecord, 0, 5)
	for len(records) < 5 {
		rec, err := src.Next(streamCtx, after)
		if err != nil {
			t.Fatalf("Next record %d after %q: %v", len(records)+1, after, err)
		}
		records = append(records, rec)
		after = rec.LSN
		if err := src.AckLSN(streamCtx, rec.LSN); err != nil {
			t.Fatalf("AckLSN %s: %v", rec.LSN, err)
		}
	}

	ops := []PGChangeOp{records[0].Op, records[1].Op, records[2].Op, records[3].Op, records[4].Op}
	wantOps := []PGChangeOp{PGChangeInsert, PGChangeUpdate, PGChangeDelete, PGChangeInsert, PGChangeTruncate}
	for i := range wantOps {
		if ops[i] != wantOps[i] {
			t.Fatalf("ops = %v, want %v", ops, wantOps)
		}
		if records[i].Schema != "public" || records[i].Table != "account" || records[i].LSN == "" {
			t.Fatalf("record %d metadata = %#v", i, records[i])
		}
	}
	if records[0].Values[0] != "acct-1" || records[0].Values[2] != int64(10) {
		t.Fatalf("insert values = %#v", records[0].Values)
	}
	if records[1].Values[1] != "alpha2" || records[1].Values[2] != int64(20) {
		t.Fatalf("update values = %#v", records[1].Values)
	}
	if !equalStringSlice(records[2].KeyColumns, []string{"id"}) || records[2].KeyValues[0] != "acct-1" {
		t.Fatalf("delete key = %v/%v", records[2].KeyColumns, records[2].KeyValues)
	}
}

// setupStreamRow inserts a protected_site + replication_stream so the
// DBCheckpointer's repository adapter has a real RPO-ledger row to advance, and
// returns the stream id (the core StreamID).
func setupStreamRow(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var siteID string
	err := pool.QueryRow(ctx,
		`INSERT INTO protected_site (tenant_id, name, kind, primary_endpoint)
		 VALUES ($1, $2, 'database', 'pg://src') RETURNING id`,
		itTenant, fmt.Sprintf("site-%d", time.Now().UnixNano())).Scan(&siteID)
	if err != nil {
		t.Fatalf("insert protected_site: %v", err)
	}
	var streamID string
	err = pool.QueryRow(ctx,
		`INSERT INTO replication_stream (tenant_id, site_id, status) VALUES ($1, $2, 'seeding') RETURNING id`,
		itTenant, siteID).Scan(&streamID)
	if err != nil {
		t.Fatalf("insert replication_stream: %v", err)
	}
	return streamID
}

func lastSourceLSN(t *testing.T, ctx context.Context, pool *pgxpool.Pool, streamID string) string {
	t.Helper()
	var lsn *string
	if err := pool.QueryRow(ctx, `SELECT source_lsn FROM replication_stream WHERE id = $1`, streamID).Scan(&lsn); err != nil {
		t.Fatalf("read source_lsn: %v", err)
	}
	if lsn == nil {
		return ""
	}
	return *lsn
}

func seedAccountsFrom(t *testing.T, ctx context.Context, pool *pgxpool.Pool, schema string, n int, base time.Time, idOffset int) {
	t.Helper()
	for i := 0; i < n; i++ {
		_, err := pool.Exec(ctx,
			fmt.Sprintf(`INSERT INTO %q.account (id, name, balance, updated_at) VALUES (gen_random_uuid(), $1, $2, $3)`, schema),
			fmt.Sprintf("new-acct-%d", idOffset+i), int64((idOffset+i)*7), base.Add(time.Duration(i)*time.Millisecond))
		if err != nil {
			t.Fatalf("seed new account %d: %v", i, err)
		}
	}
}

// assertPGMatch runs the real per-row content-hash Validator over srcSchema vs
// dstSchema and fails unless the match ratio reaches 0.999. It hashes each side
// with its own schema-qualified config (the exported NewPGRowValidator and its
// content-hash hashTable), then folds the two key->hash maps — exactly the
// §15.3 deterministic per-row content-hash comparison, not a bare count(*).
func assertPGMatch(t *testing.T, ctx context.Context, pool *pgxpool.Pool, srcSchema, dstSchema, phase string) {
	t.Helper()
	srcV, err := NewPGRowValidator(pool, pool, pgCDCTableConfig(srcSchema))
	if err != nil {
		t.Fatalf("src validator: %v", err)
	}
	dstV, err := NewPGRowValidator(pool, pool, pgCDCTableConfig(dstSchema))
	if err != nil {
		t.Fatalf("dst validator: %v", err)
	}
	srcHashes, err := srcV.hashTable(ctx, pool)
	if err != nil {
		t.Fatalf("hash src: %v", err)
	}
	dstHashes, err := dstV.hashTable(ctx, pool)
	if err != nil {
		t.Fatalf("hash dst: %v", err)
	}
	keys := map[string]struct{}{}
	for k := range srcHashes {
		keys[k] = struct{}{}
	}
	for k := range dstHashes {
		keys[k] = struct{}{}
	}
	matched, total := 0, len(keys)
	for k := range keys {
		if sh, ok := srcHashes[k]; ok {
			if dh, ok2 := dstHashes[k]; ok2 && sh == dh {
				matched++
			}
		}
	}
	res := NewValidation(matched, total, fmt.Sprintf("%s vs %s: %d/%d content-matched", srcSchema, dstSchema, matched, total))
	if res.MatchRatio < 0.999 {
		t.Fatalf("%s: match ratio %.5f < 0.999 (%s)", phase, res.MatchRatio, res.Details)
	}
	t.Logf("%s: match ratio %.5f (%s)", phase, res.MatchRatio, res.Details)
}
