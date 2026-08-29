package metastore

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// store_integration_test.go exercises the REAL SQL store against a real Postgres,
// validating the model<->column alignment the in-memory fake cannot: the child
// table round-trips (owners/environments/dependencies/cloud accounts), the
// metadata-revision FOR UPDATE finalize, the runbook-link upsert, and the
// ON DELETE CASCADE. It is guarded by METASTORE_DB_DSN so it is a no-op in normal
// CI; run it with a throwaway Postgres DSN (a superuser bypasses the FORCE RLS
// policies, so no tenant context is needed to drive the raw store).
func connectStore(t *testing.T) (context.Context, *pgx.Conn) {
	t.Helper()
	dsn := os.Getenv("METASTORE_DB_DSN")
	if dsn == "" {
		t.Skip("set METASTORE_DB_DSN to run the metastore store integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { conn.Close(ctx) })

	up, err := os.ReadFile("../../../migrations/dr_db/000037_recover_metastore.up.sql")
	if err != nil {
		t.Fatalf("reading up migration: %v", err)
	}
	if _, err := conn.Exec(ctx, string(up)); err != nil {
		t.Fatalf("applying up migration: %v", err)
	}
	t.Cleanup(func() {
		down, derr := os.ReadFile("../../../migrations/dr_db/000037_recover_metastore.down.sql")
		if derr == nil {
			_, _ = conn.Exec(context.Background(), string(down))
		}
	})
	return ctx, conn
}

func TestStore_RoundTrip_FullLifecycle(t *testing.T) {
	ctx, conn := connectStore(t)
	st := NewStore()
	tenant := uuid.NewString()
	now := time.Unix(1700000000, 0).UTC()

	app := Application{
		TenantID:         tenant,
		AppKey:           "core-banking",
		Name:             "Core Banking",
		Description:      "primary ledger",
		RecoveryTier:     TierMissionCritical,
		RTOTargetSeconds: 3600,
		Owners:           []Owner{{Role: OwnerBusiness, Name: "Layla", Contact: "layla@bank"}},
		Environments:     []Environment{{Key: "dr-jed", Kind: EnvDisasterRecovery, Region: "me-central-2", IsRecoveryTarget: true}},
		Dependencies:     []Dependency{{DependsOnAppKey: "identity", Criticality: DependencyHard}},
		CloudAccounts:    []CloudAccount{{Provider: ProviderAWS, AccountRef: "1234567890", Region: "me-central-2"}},
	}

	id, err := st.InsertApplication(ctx, conn, tenant, app, now)
	if err != nil {
		t.Fatalf("InsertApplication: %v", err)
	}
	app.ID = id
	if err := st.ReplaceChildren(ctx, conn, tenant, id, app); err != nil {
		t.Fatalf("ReplaceChildren: %v", err)
	}
	rev, hash, err := st.FinalizeRevision(ctx, conn, tenant, id, MetadataHash(app), now)
	if err != nil {
		t.Fatalf("FinalizeRevision: %v", err)
	}
	if rev != 1 || hash == "" {
		t.Fatalf("finalize rev/hash = (%d,%q), want (1, non-empty)", rev, hash)
	}

	got, err := st.GetApplicationByID(ctx, conn, tenant, id)
	if err != nil {
		t.Fatalf("GetApplicationByID: %v", err)
	}
	if len(got.Owners) != 1 || len(got.Environments) != 1 || len(got.Dependencies) != 1 || len(got.CloudAccounts) != 1 {
		t.Fatalf("children not round-tripped: %+v", got)
	}
	if got.Environments[0].Key != "dr-jed" || !got.Environments[0].IsRecoveryTarget {
		t.Fatalf("environment round-trip wrong: %+v", got.Environments)
	}

	// Re-finalize identical metadata → no revision bump (idempotent).
	rev2, _, err := st.FinalizeRevision(ctx, conn, tenant, id, MetadataHash(app), now)
	if err != nil {
		t.Fatalf("FinalizeRevision (idempotent): %v", err)
	}
	if rev2 != 1 {
		t.Fatalf("re-finalize rev = %d, want 1 (idempotent)", rev2)
	}

	// Change metadata → revision advances.
	app.RTOTargetSeconds = 7200
	if err := st.ReplaceChildren(ctx, conn, tenant, id, app); err != nil {
		t.Fatalf("ReplaceChildren #2: %v", err)
	}
	if err := st.UpdateApplicationScalars(ctx, conn, tenant, id, app, now); err != nil {
		t.Fatalf("UpdateApplicationScalars: %v", err)
	}
	rev3, _, err := st.FinalizeRevision(ctx, conn, tenant, id, MetadataHash(app), now)
	if err != nil {
		t.Fatalf("FinalizeRevision #3: %v", err)
	}
	if rev3 != 2 {
		t.Fatalf("post-change rev = %d, want 2", rev3)
	}

	// Runbook link upsert + read.
	runbookID := uuid.NewString()
	if err := st.UpsertRunbookLink(ctx, conn, tenant, id, runbookID, rev3, MetadataHash(app), now); err != nil {
		t.Fatalf("UpsertRunbookLink: %v", err)
	}
	link, err := st.GetRunbookLink(ctx, conn, id, runbookID)
	if err != nil {
		t.Fatalf("GetRunbookLink: %v", err)
	}
	if link.SourceRevision != rev3 {
		t.Fatalf("link revision = %d, want %d", link.SourceRevision, rev3)
	}

	// List returns the app with children.
	page, err := st.ListApplications(ctx, conn, tenant, 25, 0)
	if err != nil {
		t.Fatalf("ListApplications: %v", err)
	}
	if page.Total != 1 || len(page.Applications) != 1 {
		t.Fatalf("list total/len = %d/%d, want 1/1", page.Total, len(page.Applications))
	}

	// Duplicate app_key is rejected.
	if _, err := st.InsertApplication(ctx, conn, tenant, app, now); err != ErrAlreadyExists {
		t.Fatalf("duplicate insert err = %v, want ErrAlreadyExists", err)
	}

	// Delete cascades to children + link.
	if err := st.DeleteApplication(ctx, conn, tenant, id); err != nil {
		t.Fatalf("DeleteApplication: %v", err)
	}
	if _, err := st.GetApplicationByID(ctx, conn, tenant, id); err != ErrNotFound {
		t.Fatalf("get after delete err = %v, want ErrNotFound", err)
	}
	if _, err := st.GetRunbookLink(ctx, conn, id, runbookID); err != ErrRunbookNotLinked {
		t.Fatalf("link after cascade err = %v, want ErrRunbookNotLinked", err)
	}
}
