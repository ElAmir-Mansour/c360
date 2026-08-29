// Package dr exposes the in-process demo seeder for the ClarioDR control plane.
//
// SeedDRDemo populates a realistic, INTERNALLY CONSISTENT slice of disaster-
// recovery data for the demo tenant ("Abdullah Al Othaim Investment Company")
// so the /dr console is alive out of the box: protected sites, consistency
// groups + boot order, live replication streams with RPO/lag, sealed+validated
// recovery points, authored runbooks with a task DAG, a weekly drill schedule,
// one COMPLETED drill run and one COMPLETED real failover (each with passed
// steps + a sealed NCA attestation), a hash-chained attestation ledger with two
// Merkle checkpoints, and a dependency-aware boot graph.
//
// It MIRRORS the lex seed pattern (internal/lex/seed_legal_affairs.go): it runs
// in-process at clario-dr-service startup, gated to the demo tenant, and is
//   - IDEMPOTENT: every insert is ON CONFLICT DO NOTHING and the whole run is
//     guarded by a check-exists on protected_site, so restarts never duplicate.
//   - NON-FATAL: the caller logs and continues on error; a seed failure must NOT
//     crash the dr-service (unlike lex, where seeding is fatal).
//
// All writes run inside a single database.RunSystemTx (app.bypass_rls = on),
// the same system-path discipline the BCM compliance-pack seeder uses, so the
// FORCE-RLS tenant tables accept the seed rows.
package dr

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/attestledger"
)

// sha256Hex returns the lower-case hex SHA-256 of s. Used for the demo content
// hashes (recovery-point/attestation tamper-evidence) and the demo checkpoint
// Merkle fold, all of which need a stable 64-hex digest.
func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// DemoTenantID is the demo tenant the DR console is seeded for — "Abdullah Al
// Othaim Investment Company", the SAME tenant the lex suite seeds its
// legal-affairs data into (internal/lex/seed.go apexLegalTenantID), so the
// recovery runbooks/drills/attestations and the legal data share one tenant in
// the demo console.
const DemoTenantID = "aaaaaaaa-0000-0000-0000-000000000001"

// demoActor is the system principal recorded as initiated_by/approved_by/
// created_by on the seeded runs and runbooks. It is a fixed, well-known id so
// re-seeds reference the same actor.
const demoActor = "aaaaaaaa-0000-0000-0000-0000000000a1"

// SeedDRDemo seeds the demo tenant's DR data. It is idempotent (a no-op once
// protected_site already holds rows for the tenant) and returns an error the
// caller is expected to LOG-and-continue on — it must never be fatal.
func SeedDRDemo(ctx context.Context, pool *pgxpool.Pool, tenantID string) error {
	if pool == nil {
		return fmt.Errorf("dr demo seed: nil pool")
	}
	if _, err := uuid.Parse(tenantID); err != nil {
		return fmt.Errorf("dr demo seed: invalid tenant id %q: %w", tenantID, err)
	}

	return database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error {
		// Idempotency guard (lex pattern): if the tenant already has any protected
		// site, the demo set is present — return without touching anything so live
		// edits and prior seeds are never clobbered.
		var existing int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM protected_site WHERE tenant_id = $1`, tenantID,
		).Scan(&existing); err != nil {
			return fmt.Errorf("dr demo seed: count sites: %w", err)
		}
		if existing > 0 {
			return nil
		}
		return seedDRDemoData(ctx, tx, tenantID)
	})
}

// seedDRDemoData performs the ordered, FK-consistent inserts inside the system
// transaction. Stable UUIDs are minted per call (not hard-coded) but every
// cross-reference uses the freshly-minted id, so the graph is internally
// consistent. All inserts are ON CONFLICT DO NOTHING for belt-and-braces
// idempotency on top of the outer check-exists guard.
func seedDRDemoData(ctx context.Context, tx pgx.Tx, tenantID string) error {
	now := time.Now().UTC()

	// ---- deterministic ids for the two consistency groups + their assets ----
	// Group A: Core Banking (Riyadh DR) — an ERP VM + its PostgreSQL database.
	// Group B: Channels (Jeddah DR)     — a customer-channels app VM.
	var (
		grpCoreBanking = uuid.NewString()
		grpChannels    = uuid.NewString()

		siteERP      = uuid.NewString() // vm  (Core Banking)
		siteDB       = uuid.NewString() // database (Core Banking)
		siteChannels = uuid.NewString() // vm  (Channels)
	)

	// (1) protected_site — 2 in Core Banking + 1 in Channels.
	sites := []struct {
		id       string
		name     string
		kind     string
		endpoint string
		rto, rpo int
	}{
		{siteERP, "Core Banking ERP (Riyadh)", "vm", "vsphere://riyadh-dc/core-erp-vm", 900, 300},
		{siteDB, "Core Banking PostgreSQL (Riyadh)", "database", "pg://riyadh-dc/core-banking-db:5432", 600, 60},
		{siteChannels, "Customer Channels App (Jeddah)", "vm", "vsphere://jeddah-dc/channels-app-vm", 1200, 300},
	}
	for _, s := range sites {
		if _, err := tx.Exec(ctx, `
			INSERT INTO protected_site (id, tenant_id, name, kind, primary_endpoint,
				rto_objective_seconds, rpo_objective_seconds)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT (tenant_id, name) DO NOTHING`,
			s.id, tenantID, s.name, s.kind, s.endpoint, s.rto, s.rpo); err != nil {
			return fmt.Errorf("seed protected_site %q: %w", s.name, err)
		}
	}

	// (2) consistency_group — 2 groups (KSA-flavoured names).
	groups := []struct {
		id, name string
	}{
		{grpCoreBanking, "Core Banking — Riyadh DR"},
		{grpChannels, "Customer Channels — Jeddah DR"},
	}
	for _, g := range groups {
		if _, err := tx.Exec(ctx, `
			INSERT INTO consistency_group (id, tenant_id, name)
			VALUES ($1,$2,$3)
			ON CONFLICT (tenant_id, name) DO NOTHING`,
			g.id, tenantID, g.name); err != nil {
			return fmt.Errorf("seed consistency_group %q: %w", g.name, err)
		}
	}

	// (3) consistency_group_member — Core Banking boots DB (10) then ERP (20);
	// Channels has the single app vm.
	members := []struct {
		group, site string
		bootOrder   int
	}{
		{grpCoreBanking, siteDB, 10},
		{grpCoreBanking, siteERP, 20},
		{grpChannels, siteChannels, 10},
	}
	for _, m := range members {
		if _, err := tx.Exec(ctx, `
			INSERT INTO consistency_group_member (group_id, site_id, boot_order)
			VALUES ($1,$2,$3)
			ON CONFLICT (group_id, site_id) DO NOTHING`,
			m.group, m.site, m.bootOrder); err != nil {
			return fmt.Errorf("seed consistency_group_member: %w", err)
		}
	}

	// (4) replication_stream — one per protected site, all streaming with a live
	// applied_at so the console renders a real RPO/lag (now - applied_at).
	streams := []struct {
		site       string
		appliedSeq int64
		lsn        string
		appliedAgo time.Duration
	}{
		{siteERP, 150000, "0/3A1F2C8", 45 * time.Second},
		{siteDB, 85000, "0/1C7E4B0", 18 * time.Second},
		{siteChannels, 61000, "0/0F2A990", 70 * time.Second},
	}
	for _, st := range streams {
		appliedAt := now.Add(-st.appliedAgo)
		if _, err := tx.Exec(ctx, `
			INSERT INTO replication_stream (tenant_id, site_id, status, applied_seq, source_lsn, applied_at)
			VALUES ($1,$2,'streaming',$3,$4,$5)
			ON CONFLICT (site_id) DO NOTHING`,
			tenantID, st.site, st.appliedSeq, st.lsn, appliedAt); err != nil {
			return fmt.Errorf("seed replication_stream: %w", err)
		}
	}

	// (5) recovery_point — a sealed history per group; the newest ones validated.
	// Core Banking gets 4, Channels gets 2. Keys reference plausible WORM objects.
	rpCoreLatest := uuid.NewString()
	type rpRow struct {
		id         string
		group      string
		marker     string
		rpoSeconds int
		objKeys    map[string]string
		ratio      *float64
		validated  bool
		sealedAgo  time.Duration
	}
	ratio := 0.9995
	rps := []rpRow{
		{rpCoreLatest, grpCoreBanking, "0/3A1F2C8", 42,
			map[string]string{siteDB: "rp/core/db/000150000.seg", siteERP: "rp/core/erp/000150000.seg"},
			&ratio, true, 30 * time.Minute},
		{uuid.NewString(), grpCoreBanking, "0/39A0010", 58,
			map[string]string{siteDB: "rp/core/db/000148500.seg", siteERP: "rp/core/erp/000148500.seg"},
			&ratio, true, 6 * time.Hour},
		{uuid.NewString(), grpCoreBanking, "0/3811AA0", 75,
			map[string]string{siteDB: "rp/core/db/000142000.seg", siteERP: "rp/core/erp/000142000.seg"},
			&ratio, true, 24 * time.Hour},
		{uuid.NewString(), grpCoreBanking, "0/37005C0", 90,
			map[string]string{siteDB: "rp/core/db/000139000.seg", siteERP: "rp/core/erp/000139000.seg"},
			nil, false, 48 * time.Hour},
		{uuid.NewString(), grpChannels, "0/0F2A990", 64,
			map[string]string{siteChannels: "rp/channels/app/000061000.seg"},
			&ratio, true, 90 * time.Minute},
		{uuid.NewString(), grpChannels, "0/0E10120", 80,
			map[string]string{siteChannels: "rp/channels/app/000058000.seg"},
			nil, false, 12 * time.Hour},
	}
	for _, rp := range rps {
		keysJSON, err := json.Marshal(rp.objKeys)
		if err != nil {
			return fmt.Errorf("marshal recovery_point object_keys: %w", err)
		}
		sealedAt := now.Add(-rp.sealedAgo)
		contentHash := sha256Hex(fmt.Sprintf("%s|%s|%s", rp.group, rp.marker, sealedAt.Format(time.RFC3339)))
		retentionUntil := now.Add(90 * 24 * time.Hour)
		if _, err := tx.Exec(ctx, `
			INSERT INTO recovery_point (id, tenant_id, group_id, marker_lsn, rpo_seconds,
				object_keys, content_hash, validation_ratio, is_validated, sealed_at, retention_until)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
			ON CONFLICT (id) DO NOTHING`,
			rp.id, tenantID, rp.group, rp.marker, rp.rpoSeconds,
			keysJSON, contentHash, rp.ratio, rp.validated, sealedAt, retentionUntil); err != nil {
			return fmt.Errorf("seed recovery_point: %w", err)
		}
	}

	// (6) network_mapping — production + isolated per Core Banking group; Channels
	// gets a production profile.
	netMaps := []struct {
		group, profile, primaryCIDR, recoveryCIDR string
	}{
		{grpCoreBanking, "production", "10.20.0.0/16", "10.120.0.0/16"},
		{grpCoreBanking, "isolated", "10.20.0.0/16", "192.168.50.0/24"},
		{grpChannels, "production", "10.30.0.0/16", "10.130.0.0/16"},
		{grpChannels, "isolated", "10.30.0.0/16", "192.168.60.0/24"},
	}
	for _, nm := range netMaps {
		if _, err := tx.Exec(ctx, `
			INSERT INTO network_mapping (tenant_id, group_id, profile, primary_cidr, recovery_cidr)
			VALUES ($1,$2,$3,$4,$5)
			ON CONFLICT DO NOTHING`,
			tenantID, nm.group, nm.profile, nm.primaryCIDR, nm.recoveryCIDR); err != nil {
			return fmt.Errorf("seed network_mapping: %w", err)
		}
	}

	// (7) recovery_target — where each member boots, in boot order, with a real
	// http/tcp health probe spec.
	targets := []struct {
		group, site string
		bootOrder   int
		endpoint    string
		probe       map[string]any
	}{
		{grpCoreBanking, siteDB, 10, "pg://riyadh-dr/core-banking-db:5432",
			map[string]any{"type": "tcp", "target": "core-banking-db:5432", "timeout": 5, "retries": 3}},
		{grpCoreBanking, siteERP, 20, "https://riyadh-dr/core-erp",
			map[string]any{"type": "http", "target": "https://core-erp/health", "expected": 200, "timeout": 5, "retries": 3}},
		{grpChannels, siteChannels, 10, "https://jeddah-dr/channels-app",
			map[string]any{"type": "http", "target": "https://channels-app/healthz", "expected": 200, "timeout": 5, "retries": 3}},
	}
	for _, t := range targets {
		probeJSON, err := json.Marshal(t.probe)
		if err != nil {
			return fmt.Errorf("marshal recovery_target probe: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO recovery_target (tenant_id, group_id, site_id, boot_order, recovery_endpoint, health_probe)
			VALUES ($1,$2,$3,$4,$5,$6)
			ON CONFLICT (group_id, site_id) DO NOTHING`,
			tenantID, t.group, t.site, t.bootOrder, t.endpoint, probeJSON); err != nil {
			return fmt.Errorf("seed recovery_target: %w", err)
		}
	}

	// (8)+(9) Runbook studio — an authored (published) Core Banking runbook with a
	// 6-task DAG, plus a draft registry-imported Channels runbook.
	rbAuthored := uuid.NewString()
	rbRegistry := uuid.NewString()
	runbooks := []struct {
		id, group, name, desc, status, source string
	}{
		{rbAuthored, grpCoreBanking, "Core Banking Failover Runbook",
			"Authored recovery orchestration for the Core Banking consistency group (Riyadh DR).",
			"published", "authored"},
		{rbRegistry, grpChannels, "Customer Channels Recovery (Registry)",
			"Auto-generated recovery runbook materialized from the Channels consistency group.",
			"draft", "registry"},
	}
	for _, rb := range runbooks {
		if _, err := tx.Exec(ctx, `
			INSERT INTO dr_studio_runbook (id, tenant_id, group_id, name, description, status, source_runbook, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT (tenant_id, name) DO NOTHING`,
			rb.id, tenantID, rb.group, rb.name, rb.desc, rb.status, rb.source, demoActor); err != nil {
			return fmt.Errorf("seed dr_studio_runbook %q: %w", rb.name, err)
		}
	}

	// 6 tasks on the authored runbook, forming a DAG via predecessors[].
	// quiesce -> checkpoint -> {boot_db -> boot_erp} -> health_gate -> cutover_comms.
	taskQuiesce := uuid.NewString()
	taskCheckpoint := uuid.NewString()
	taskBootDB := uuid.NewString()
	taskBootERP := uuid.NewString()
	taskHealthGate := uuid.NewString()
	taskComms := uuid.NewString()
	tasks := []struct {
		id, key, name, ttype string
		owner, team          string
		instructions         string
		planned              int
		action               string
		predecessors         []string
	}{
		{taskQuiesce, "quiesce", "Quiesce source workloads", "manual", "DBA on-call", "Core Banking Ops",
			"Quiesce application writes and confirm the source DB is in a consistent state.", 120, "", nil},
		{taskCheckpoint, "checkpoint", "Confirm sync checkpoint", "milestone", "DR Coordinator", "DR",
			"Confirm the pinned recovery point's validation ratio meets the GA threshold.", 60, "",
			[]string{taskQuiesce}},
		{taskBootDB, "boot_db", "Boot PostgreSQL at DR", "automated", "Automation", "Platform",
			"Restore and boot the Core Banking database at the Riyadh DR site.", 240,
			"dr.boot_target:core-banking-db", []string{taskCheckpoint}},
		{taskBootERP, "boot_erp", "Boot ERP at DR", "automated", "Automation", "Platform",
			"Boot the Core Banking ERP VM once the database is healthy.", 300,
			"dr.boot_target:core-erp", []string{taskBootDB}},
		{taskHealthGate, "health_gate", "Health gate approval", "approval_gate", "DR Lead", "DR",
			"Approve cutover after all workload health probes are green.", 0,
			"dr:failover", []string{taskBootERP}},
		{taskComms, "cutover_comms", "Cutover communications", "comms", "Comms", "Corporate Comms",
			"Notify stakeholders that Core Banking has cut over to the Riyadh DR site.", 30, "",
			[]string{taskHealthGate}},
	}
	for _, t := range tasks {
		predecessors := t.predecessors
		if predecessors == nil {
			predecessors = []string{}
		}
		params := map[string]any{}
		paramsJSON, err := json.Marshal(params)
		if err != nil {
			return fmt.Errorf("marshal dr_studio_task params: %w", err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO dr_studio_task (id, tenant_id, runbook_id, task_key, name, task_type,
				owner, team, instructions, planned_duration_seconds, automation_action, predecessors, params)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
			ON CONFLICT (runbook_id, task_key) DO NOTHING`,
			t.id, tenantID, rbAuthored, t.key, t.name, t.ttype,
			t.owner, t.team, t.instructions, t.planned, t.action, predecessors, paramsJSON); err != nil {
			return fmt.Errorf("seed dr_studio_task %q: %w", t.key, err)
		}
	}

	// (10) dr_drill_schedule — weekly Saturday 02:00 isolated drill for Core Banking.
	drillScheduleID := uuid.NewString()
	nextRun := nextSaturday0200(now)
	if _, err := tx.Exec(ctx, `
		INSERT INTO dr_drill_schedule (id, tenant_id, group_id, name, cron_expr, profile,
			rto_objective_seconds, enabled, next_run, last_fired_at)
		VALUES ($1,$2,$3,$4,$5,'isolated',$6,true,$7,$8)
		ON CONFLICT (tenant_id, name) DO NOTHING`,
		drillScheduleID, tenantID, grpCoreBanking, "Weekly Core Banking DR Drill",
		"0 2 * * 6", 900, nextRun, now.Add(-7*24*time.Hour)); err != nil {
		return fmt.Errorf("seed dr_drill_schedule: %w", err)
	}

	// (11) failover_run — a COMPLETED drill (now-2d) and a COMPLETED real failover
	// (now-7d), both for Core Banking, each pinned to the latest validated point.
	drillRunID := uuid.NewString()
	realRunID := uuid.NewString()
	runs := []struct {
		id          string
		mode        string
		initiatedAt time.Time
		rtoActual   int
	}{
		{drillRunID, "drill", now.Add(-2 * 24 * time.Hour), 890},
		{realRunID, "real", now.Add(-7 * 24 * time.Hour), 840},
	}
	for _, r := range runs {
		completedAt := r.initiatedAt.Add(time.Duration(r.rtoActual) * time.Second)
		if _, err := tx.Exec(ctx, `
			INSERT INTO failover_run (id, tenant_id, group_id, mode, status, recovery_point_id,
				rto_objective_seconds, initiated_by, approved_by, initiated_at, completed_at, rto_actual_seconds)
			VALUES ($1,$2,$3,$4,'COMPLETED',$5,$6,$7,$8,$9,$10,$11)
			ON CONFLICT (id) DO NOTHING`,
			r.id, tenantID, grpCoreBanking, r.mode, rpCoreLatest,
			900, demoActor, demoActor, r.initiatedAt, completedAt, r.rtoActual); err != nil {
			return fmt.Errorf("seed failover_run (%s): %w", r.mode, err)
		}

		// (12) failover_step — 6 passed steps per run, on the FSM step keys.
		steps := []struct {
			key       string
			offsetSec int
			durSec    int
		}{
			{"quiesce", 0, 30},
			{"gate1", 30, 20},
			{"gate2", 50, 25},
			{"boot:" + siteDB, 75, 240},
			{"boot:" + siteERP, 315, 300},
			{"gate4", 615, 60}, // attestation gate
		}
		for _, s := range steps {
			startedAt := r.initiatedAt.Add(time.Duration(s.offsetSec) * time.Second)
			finishedAt := startedAt.Add(time.Duration(s.durSec) * time.Second)
			detail := map[string]any{"result": "passed"}
			detailJSON, err := json.Marshal(detail)
			if err != nil {
				return fmt.Errorf("marshal failover_step detail: %w", err)
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO failover_step (run_id, step, status, detail, started_at, finished_at)
				VALUES ($1,$2,'passed',$3,$4,$5)
				ON CONFLICT (run_id, step) DO NOTHING`,
				r.id, s.key, detailJSON, startedAt, finishedAt); err != nil {
				return fmt.Errorf("seed failover_step %q: %w", s.key, err)
			}
		}

		// (13) attestation — one sealed NCA-ready report per run (UNIQUE per run).
		reportKey := fmt.Sprintf("attestations/%s/%s/report.json", tenantID, r.id)
		attHash := sha256Hex(fmt.Sprintf("attestation|%s|%d", r.id, r.rtoActual))
		if _, err := tx.Exec(ctx, `
			INSERT INTO attestation (tenant_id, run_id, rto_objective_seconds, rto_actual_seconds,
				rpo_seconds, validation_ratio, report_object_key, content_hash)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
			ON CONFLICT (run_id) DO NOTHING`,
			tenantID, r.id, 900, r.rtoActual, 42, ratio, reportKey, attHash); err != nil {
			return fmt.Errorf("seed attestation (%s): %w", r.mode, err)
		}
	}

	// (14) dr_attestation_ledger — a valid 5-entry hash chain (genesis +
	// recovery-point validation + drill attestation + failover attestation +
	// anchor checkpoint). Built with the SAME chain primitives the production
	// recorder uses (attestledger.ComputeEntryHash / HashPayload / GenesisPrevHash)
	// so VerifyChain accepts it.
	ledgerSpecs := []ledgerSpec{
		{"recovery_point_validation", rpCoreLatest,
			map[string]any{"group": grpCoreBanking, "validation_ratio": ratio, "marker_lsn": "0/3A1F2C8"}},
		{"drill_attestation", drillRunID,
			map[string]any{"mode": "drill", "rto_actual_seconds": 890, "rpo_seconds": 42, "validation_ratio": ratio}},
		{"failover_attestation", realRunID,
			map[string]any{"mode": "real", "rto_actual_seconds": 840, "rpo_seconds": 42, "validation_ratio": ratio}},
		{"anchor_checkpoint", "checkpoint-1",
			map[string]any{"from_seq": 1, "to_seq": 4, "anchored": true}},
	}
	ledgerEntries, err := buildLedgerEntries(tenantID, ledgerSpecs, now)
	if err != nil {
		return fmt.Errorf("build attestation ledger chain: %w", err)
	}
	for _, e := range ledgerEntries {
		if _, err := tx.Exec(ctx, `
			INSERT INTO dr_attestation_ledger (tenant_id, seq, entry_type, subject_id, payload,
				payload_hash, prev_hash, entry_hash, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			ON CONFLICT (tenant_id, seq) DO NOTHING`,
			e.TenantID, e.Seq, e.EntryType, e.SubjectID, []byte(e.Payload),
			e.PayloadHash, e.PrevHash, e.EntryHash, e.CreatedAt); err != nil {
			return fmt.Errorf("seed dr_attestation_ledger seq=%d: %w", e.Seq, err)
		}
	}

	// (15) dr_attestation_checkpoint — two Merkle checkpoints over the ledger
	// (seq 1-2 and seq 3-4), the second WORM-anchored.
	checkpoints := []struct {
		from, to    int64
		entryCount  int
		wormKey     *string
		wormVersion *string
	}{
		{1, 2, 2, nil, nil},
		{3, 4, 2, strPtr(fmt.Sprintf("ledger/%s/checkpoints/2.json", tenantID)), strPtr("v1")},
	}
	for _, cp := range checkpoints {
		root, rerr := merkleRootForRange(ledgerEntries, cp.from, cp.to)
		if rerr != nil {
			return fmt.Errorf("compute checkpoint merkle root: %w", rerr)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO dr_attestation_checkpoint (tenant_id, from_seq, to_seq, merkle_root,
				entry_count, worm_object_key, worm_version_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7)
			ON CONFLICT DO NOTHING`,
			tenantID, cp.from, cp.to, root, cp.entryCount, cp.wormKey, cp.wormVersion); err != nil {
			return fmt.Errorf("seed dr_attestation_checkpoint [%d,%d]: %w", cp.from, cp.to, err)
		}
	}

	// (16) dr_boot_service — the dependency-aware boot graph vertices for Core
	// Banking: database (tcp probe) + erp api (http probe), linked to their sites.
	svcDB := uuid.NewString()
	svcERP := uuid.NewString()
	bootServices := []struct {
		id, name, kind, probeKind, probeTarget string
		probeExpect, bootTimeout, retries      int
		site, action                           string
	}{
		{svcDB, "database", "database", "tcp", "core-banking-db:5432", 0, 60, 3, siteDB,
			"cmd:dr-boot --service core-banking-db"},
		{svcERP, "erp", "api", "http", "https://core-erp/health", 200, 90, 3, siteERP,
			"cmd:dr-boot --service core-erp"},
	}
	for _, bs := range bootServices {
		if _, err := tx.Exec(ctx, `
			INSERT INTO dr_boot_service (id, tenant_id, group_id, name, kind, probe_kind, probe_target,
				probe_expect_status, boot_timeout_seconds, health_retries, boot_action, site_id)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			ON CONFLICT (group_id, name) DO NOTHING`,
			bs.id, tenantID, grpCoreBanking, bs.name, bs.kind, bs.probeKind, bs.probeTarget,
			bs.probeExpect, bs.bootTimeout, bs.retries, bs.action, bs.site); err != nil {
			return fmt.Errorf("seed dr_boot_service %q: %w", bs.name, err)
		}
	}

	// (17) dr_boot_dependency — erp depends_on database (the DAG edge).
	if _, err := tx.Exec(ctx, `
		INSERT INTO dr_boot_dependency (tenant_id, group_id, service_id, depends_on_id)
		VALUES ($1,$2,$3,$4)
		ON CONFLICT (service_id, depends_on_id) DO NOTHING`,
		tenantID, grpCoreBanking, svcERP, svcDB); err != nil {
		return fmt.Errorf("seed dr_boot_dependency: %w", err)
	}

	return nil
}

// ledgerSpec is the semantic content of one seeded attestation-ledger entry;
// the seq/hashes are derived by buildLedgerEntries via the chain primitives.
type ledgerSpec struct {
	entryType string
	subjectID string
	payload   map[string]any
}

// buildLedgerEntries constructs a valid hash-chained slice of ledger entries
// (genesis at seq 1) using the production chain primitives, so the seeded chain
// passes attestledger.VerifyChain. created_at is staggered so the entries sort
// stably by seq and read as a believable timeline.
func buildLedgerEntries(tenantID string, specs []ledgerSpec, now time.Time) ([]*attestledger.Entry, error) {
	tid, err := uuid.Parse(tenantID)
	if err != nil {
		return nil, err
	}
	entries := make([]*attestledger.Entry, 0, len(specs))
	var prev *attestledger.Entry
	for i, sp := range specs {
		e := &attestledger.Entry{
			TenantID:  tid,
			EntryType: sp.entryType,
			SubjectID: sp.subjectID,
			CreatedAt: now.Add(time.Duration(i-len(specs)) * time.Minute),
		}
		if err := attestledger.LinkEntry(e, sp.payload, prev); err != nil {
			return nil, err
		}
		entries = append(entries, e)
		prev = e
	}
	return entries, nil
}

// merkleRootForRange folds the entry_hash leaves of [from,to] into a single
// hash. This is a deterministic, demo-grade root (not the production Merkle tree
// in attestledger/merkle.go); it is sufficient to give the checkpoint rows a
// stable 64-hex root that satisfies the schema CHECK and reads as anchored.
func merkleRootForRange(entries []*attestledger.Entry, from, to int64) (string, error) {
	acc := ""
	matched := 0
	for _, e := range entries {
		if e.Seq < from || e.Seq > to {
			continue
		}
		acc = sha256Hex(acc + e.EntryHash)
		matched++
	}
	if matched == 0 {
		return "", fmt.Errorf("no ledger entries in range [%d,%d]", from, to)
	}
	return acc, nil
}

// nextSaturday0200 returns the next Saturday 02:00 UTC at or after now, matching
// the cron "0 2 * * 6" the demo drill schedule advertises.
func nextSaturday0200(now time.Time) time.Time {
	candidate := time.Date(now.Year(), now.Month(), now.Day(), 2, 0, 0, 0, time.UTC)
	for candidate.Weekday() != time.Saturday || !candidate.After(now) {
		candidate = candidate.Add(24 * time.Hour)
		candidate = time.Date(candidate.Year(), candidate.Month(), candidate.Day(), 2, 0, 0, 0, time.UTC)
	}
	return candidate
}

func strPtr(s string) *string { return &s }
