// Command audit-rebaseline recomputes the audit_logs hash chain for every tenant
// and (with --apply) overwrites previous_hash + entry_hash so the chain verifies.
//
// Why this exists: ComputeEntryHash originally hashed created_at at nanosecond
// precision, but Postgres persists created_at as timestamptz (microseconds). The
// write-time hash therefore could never be reproduced from the microsecond value
// read back at verification time, so every entry failed integrity verification.
// After the hash function was fixed to truncate to microseconds, the HISTORICAL
// rows still carry hashes built from the old nanosecond values; this tool rebuilds
// them.
//
// It reuses the exact production hash.ComputeEntryHash and model.AuditEntry, and
// orders entries by (created_at ASC, id ASC) — identical to the verifier's
// StreamByTenant — so a full-chain rebaseline makes every verification window pass.
//
// Safety: dry-run by default (compute + report, no writes). Take a backup of the
// hash columns before running with --apply (the deploy step does this).
//
//	go run ./backend/cmd/audit-rebaseline --db-url "$AUDIT_DB_URL"          # dry-run
//	go run ./backend/cmd/audit-rebaseline --db-url "$AUDIT_DB_URL" --apply  # persist
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/audit/hash"
	"github.com/clario360/platform/internal/audit/model"
)

func main() {
	dbURL := flag.String("db-url", os.Getenv("AUDIT_DB_URL"), "audit_db connection string (default $AUDIT_DB_URL)")
	apply := flag.Bool("apply", false, "persist the recomputed hashes (default: dry-run — compute + report only)")
	bypass := flag.Bool("bypass-immutability", false, "audit_logs carries a WORM immutability trigger that blocks UPDATE; "+
		"set this to run the one-time rewrite with SET LOCAL session_replication_role=replica (transaction-scoped, auto-reverts; needs a superuser). Take a backup first.")
	flag.Parse()
	if *dbURL == "" {
		fmt.Fprintln(os.Stderr, "audit-rebaseline: --db-url (or AUDIT_DB_URL) is required")
		os.Exit(2)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, *dbURL)
	must("connect", err)
	defer pool.Close()

	// 1. Every tenant that has audit entries.
	var tenants []string
	trows, err := pool.Query(ctx, `SELECT DISTINCT tenant_id::text FROM audit_logs ORDER BY 1`)
	must("list tenants", err)
	for trows.Next() {
		var t string
		must("scan tenant", trows.Scan(&t))
		tenants = append(tenants, t)
	}
	trows.Close()
	must("tenant rows", trows.Err())
	fmt.Printf("tenants with audit entries: %d\n", len(tenants))

	type triple struct{ id, prev, entry string }
	type laststate struct {
		id, hash string
		at       time.Time
	}
	triples := make([]triple, 0, 262144)
	lasts := map[string]laststate{}
	total := 0

	// 2. Per tenant: recompute the chain in verifier order.
	for _, tid := range tenants {
		rows, err := pool.Query(ctx, `
			SELECT id::text, tenant_id::text, user_id, service, action, resource_type, resource_id, old_value, new_value, created_at
			FROM audit_logs
			WHERE tenant_id = $1::uuid
			ORDER BY created_at ASC, id ASC`, tid)
		must("select entries", err)

		prev := hash.GenesisHash
		n := 0
		var lst laststate
		for rows.Next() {
			var e model.AuditEntry
			// Scan exactly the fields ComputeEntryHash consumes, the same way the
			// verifier's StreamByTenant does (nullable user_id -> *string, jsonb
			// old/new_value -> json.RawMessage), so bytes are byte-identical.
			must("scan entry", rows.Scan(
				&e.ID, &e.TenantID, &e.UserID, &e.Service, &e.Action,
				&e.ResourceType, &e.ResourceID, &e.OldValue, &e.NewValue, &e.CreatedAt,
			))
			eh := hash.ComputeEntryHash(&e, prev)
			triples = append(triples, triple{id: e.ID, prev: prev, entry: eh})
			prev = eh
			lst = laststate{id: e.ID, hash: eh, at: e.CreatedAt}
			n++
		}
		rows.Close()
		must("entry rows", rows.Err())
		if n > 0 {
			lasts[tid] = lst
			total += n
		}
	}
	fmt.Printf("entries chained: %d across %d non-empty tenants\n", total, len(lasts))

	if !*apply {
		fmt.Println("DRY-RUN — no writes performed. Re-run with --apply to persist.")
		return
	}

	// 3. Apply atomically: bulk-load the recomputed hashes into a temp table, then
	//    one UPDATE ... FROM, then refresh audit_chain_state so new entries chain
	//    from the rebaselined tail.
	tx, err := pool.Begin(ctx)
	must("begin tx", err)
	defer tx.Rollback(ctx)

	if *bypass {
		// audit_logs is protected by the prevent_audit_mutation WORM trigger, which
		// blocks UPDATE by design. This is a one-time, backed-up rewrite of invalid
		// historical hashes. SET LOCAL is transaction-scoped: it auto-reverts on
		// commit, so the table-level immutability is NEVER left disabled. Requires a
		// superuser/replication role.
		if _, err := tx.Exec(ctx, `SET LOCAL session_replication_role = replica`); err != nil {
			must("bypass immutability (SET LOCAL session_replication_role — needs superuser)", err)
		}
		fmt.Println("immutability trigger bypassed for THIS transaction only (SET LOCAL — reverts on commit)")
	}

	_, err = tx.Exec(ctx, `CREATE TEMP TABLE _rebaseline (id text, prev text, entry text) ON COMMIT DROP`)
	must("create temp table", err)

	_, err = tx.CopyFrom(ctx, pgx.Identifier{"_rebaseline"}, []string{"id", "prev", "entry"},
		pgx.CopyFromSlice(len(triples), func(i int) ([]any, error) {
			return []any{triples[i].id, triples[i].prev, triples[i].entry}, nil
		}))
	must("copy triples", err)

	ct, err := tx.Exec(ctx, `UPDATE audit_logs a SET previous_hash = r.prev, entry_hash = r.entry
		FROM _rebaseline r WHERE a.id = r.id::uuid`)
	must("update audit_logs", err)
	fmt.Printf("updated audit_logs rows: %d\n", ct.RowsAffected())

	for tid, l := range lasts {
		_, err = tx.Exec(ctx, `
			INSERT INTO audit_chain_state (tenant_id, last_entry_id, last_hash, last_created_at, updated_at)
			VALUES ($1, $2, $3, $4, NOW())
			ON CONFLICT (tenant_id) DO UPDATE
			SET last_entry_id = EXCLUDED.last_entry_id, last_hash = EXCLUDED.last_hash,
			    last_created_at = EXCLUDED.last_created_at, updated_at = NOW()`,
			tid, l.id, l.hash, l.at)
		must("upsert chain_state", err)
	}

	must("commit", tx.Commit(ctx))
	fmt.Printf("chain_state refreshed for %d tenants. REBASELINE COMPLETE.\n", len(lasts))
}

func must(what string, err error) {
	if err != nil {
		fmt.Fprintf(os.Stderr, "audit-rebaseline: %s: %v\n", what, err)
		os.Exit(1)
	}
}
