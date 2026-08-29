//go:build integration

package respond

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"
)

func startRespondPostgres(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("respond_it"),
		postgresmod.WithUsername("respond"),
		postgresmod.WithPassword("respond"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	pool, err := pgxpool.New(ctx, container.MustConnectionString(ctx, "sslmode=disable"))
	if err != nil {
		t.Fatalf("open postgres pool: %v", err)
	}
	t.Cleanup(pool.Close)

	applyRespondMigrations(t, ctx, pool, ".up.sql")
	return ctx, pool
}

func applyRespondMigrations(t *testing.T, ctx context.Context, pool *pgxpool.Pool, suffix string) {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve caller")
	}
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations", "respond_db")
	migrations, err := filepath.Glob(filepath.Join(migDir, "*"+suffix))
	if err != nil {
		t.Fatalf("glob migrations: %v", err)
	}
	sort.Strings(migrations)
	if suffix == ".down.sql" {
		for i, j := 0, len(migrations)-1; i < j; i, j = i+1, j-1 {
			migrations[i], migrations[j] = migrations[j], migrations[i]
		}
	}
	for _, migration := range migrations {
		sql, err := os.ReadFile(migration)
		if err != nil {
			t.Fatalf("read migration %s: %v", filepath.Base(migration), err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("apply migration %s: %v", filepath.Base(migration), err)
		}
	}
}

func TestIntegrationMigrationsRollBack(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	applyRespondMigrations(t, ctx, pool, ".down.sql")
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (
		SELECT 1 FROM information_schema.tables WHERE table_name = 'respond_incident'
	)`).Scan(&exists); err != nil {
		t.Fatalf("check table existence: %v", err)
	}
	if exists {
		t.Fatalf("respond_incident table still exists after rollback")
	}
}

func TestIntegrationConcurrentDeclarationReferencesAreUnique(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{PermRespondDeclare}}

	const count = 24
	refs := make(chan string, count)
	errs := make(chan error, count)
	var wg sync.WaitGroup
	for i := 0; i < count; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
				Title:       "payment outage",
				Severity:    SeveritySEV2,
				Description: "checkout failures",
				Actor:       actor,
			})
			if err != nil {
				errs <- err
				return
			}
			refs <- inc.Reference
		}()
	}
	wg.Wait()
	close(refs)
	close(errs)
	for err := range errs {
		t.Fatalf("declare incident: %v", err)
	}
	seen := map[string]bool{}
	for ref := range refs {
		if seen[ref] {
			t.Fatalf("duplicate reference %s", ref)
		}
		seen[ref] = true
	}
	if len(seen) != count {
		t.Fatalf("references = %d, want %d", len(seen), count)
	}
}

func TestIntegrationOptimisticConflictAndAppendOnlyTimeline(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{
		PermRespondDeclare, PermRespondSeverity, PermRespondTransition, PermRespondTimeline, PermRespondRead,
	}}

	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:    "core banking degraded",
		Severity: SeveritySEV1,
		Actor:    actor,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	if _, err := svc.ChangeSeverity(ctx, tenantID, ChangeSeverityInput{
		IncidentID:      inc.ID,
		Severity:        SeveritySEV2,
		ExpectedVersion: inc.RowVersion,
		Actor:           actor,
	}); err != nil {
		t.Fatalf("change severity: %v", err)
	}

	if _, err := svc.TransitionIncident(ctx, tenantID, TransitionIncidentInput{
		IncidentID:      inc.ID,
		To:              StatusTriaged,
		ExpectedVersion: inc.RowVersion,
		Actor:           actor,
	}); !errors.Is(err, ErrVersionConflict) {
		t.Fatalf("transition with stale version error = %v, want ErrVersionConflict", err)
	}

	ev, err := svc.RecordTimelineEvent(ctx, tenantID, inc.ID, actor, "respond.test.event", map[string]any{"ok": true})
	if err != nil {
		t.Fatalf("record timeline event: %v", err)
	}
	if _, err := pool.Exec(ctx, `UPDATE respond_incident_timeline_event SET payload = '{}' WHERE id = $1`, ev.ID); err == nil {
		t.Fatalf("timeline update unexpectedly succeeded")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM respond_incident_timeline_event WHERE id = $1`, ev.ID); err == nil {
		t.Fatalf("timeline delete unexpectedly succeeded")
	}
}

func TestIntegrationTimelineFeedAndBackfill(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	feed := NewTimelineFeed(2)
	svc := NewServiceWithDeps(pgxTenantRunner{pool: pool}, NewRepository(), feed, zerolog.Nop())
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{PermRespondDeclare, PermRespondTimeline, PermRespondRead}}
	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{Title: "api outage", Severity: SeveritySEV3, Actor: actor})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	subCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	ch := feed.Subscribe(subCtx, inc.ID)
	ev, err := svc.RecordTimelineEvent(ctx, tenantID, inc.ID, actor, "respond.note", map[string]any{"message": "war room opened"})
	if err != nil {
		t.Fatalf("record timeline event: %v", err)
	}
	select {
	case got := <-ch:
		if got.ID != ev.ID {
			t.Fatalf("live event id = %s, want %s", got.ID, ev.ID)
		}
	case <-time.After(time.Second):
		t.Fatalf("timed out waiting for live event")
	}

	events, err := svc.ListTimelineEvents(ctx, tenantID, inc.ID, actor, TimelineFilter{Limit: 10})
	if err != nil {
		t.Fatalf("list timeline: %v", err)
	}
	if len(events) < 2 {
		t.Fatalf("timeline events = %d, want declaration plus recorded event", len(events))
	}
}

func TestIntegrationCockpitReturnsPersistedIntegrationLinks(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{PermRespondDeclare, PermRespondRead}}

	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:       "payments unavailable",
		Description: "card payments are unavailable",
		Severity:    SeveritySEV1,
		Actor:       actor,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	repo := NewRepository()
	runner := pgxTenantRunner{pool: pool}
	syncedAt := time.Now().UTC().Truncate(time.Second)
	connector := &IntegrationConnector{
		TenantID:    tenantID,
		Kind:        IntegrationKindITSM,
		Provider:    IntegrationProviderServiceNow,
		Name:        "ServiceNow major incident",
		Enabled:     true,
		EndpointURL: "https://example.service-now.com/api/now/table/incident",
		CreatedBy:   actor.UserID,
	}
	link := &IntegrationExternalLink{
		TenantID:          tenantID,
		IncidentID:        inc.ID,
		Provider:          IntegrationProviderServiceNow,
		ExternalID:        "sys-001",
		ExternalKey:       "INC0012345",
		ExternalURL:       "https://example.service-now.com/nav_to.do?uri=incident.do?sys_id=sys-001",
		ExternalStatus:    "In Progress",
		ExternalPriority:  "1",
		SyncDirection:     IntegrationSyncBidirectional,
		LastSyncedAt:      &syncedAt,
		LastSyncDirection: string(IntegrationSyncOutbound),
	}
	if err := runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := repo.CreateIntegrationConnector(ctx, tx, connector, nil); err != nil {
			return err
		}
		link.ConnectorID = connector.ID
		return repo.UpsertIntegrationLink(ctx, tx, link)
	}); err != nil {
		t.Fatalf("seed integration link: %v", err)
	}

	cockpit, err := svc.Cockpit(ctx, tenantID, inc.ID, actor)
	if err != nil {
		t.Fatalf("cockpit: %v", err)
	}
	if len(cockpit.Integrations) != 1 {
		t.Fatalf("cockpit integrations = %d, want 1", len(cockpit.Integrations))
	}
	got := cockpit.Integrations[0]
	if got.Provider != string(IntegrationProviderServiceNow) ||
		got.ExternalReference != "INC0012345" ||
		got.SyncState != "synced" ||
		got.TicketURL != link.ExternalURL ||
		got.ConnectorID == nil ||
		*got.ConnectorID != connector.ID ||
		got.LastSyncedAt == nil {
		t.Fatalf("cockpit integration = %+v", got)
	}
}

func TestIntegrationStakeholderTokenStatus(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	svc := NewService(pool, zerolog.Nop())
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{
		PermRespondDeclare, PermRespondUpdate, PermRespondRead,
	}}

	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:            "payments degraded",
		Description:      "Checkout card payments are degraded for EMEA customers.",
		Severity:         SeveritySEV1,
		ImpactedServices: []string{"payments-api"},
		Actor:            actor,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	token, err := svc.CreateStakeholderToken(ctx, tenantID, CreateStakeholderTokenInput{
		IncidentID: inc.ID,
		Actor:      actor,
	})
	if err != nil {
		t.Fatalf("create stakeholder token: %v", err)
	}
	if token.Token == "" || token.URLPath == "" {
		t.Fatalf("stakeholder token response missing token/url: %+v", token)
	}

	status, err := svc.StakeholderStatusByToken(ctx, token.Token)
	if err != nil {
		t.Fatalf("stakeholder status: %v", err)
	}
	if status.IncidentReference != inc.Reference || status.Title != inc.Title || status.ImpactSummary != inc.Description {
		t.Fatalf("stakeholder status = %+v, want incident projection for %s", status, inc.Reference)
	}

	if _, err := svc.StakeholderStatusByToken(ctx, "invalid-token"); !errors.Is(err, ErrStakeholderNotFound) {
		t.Fatalf("invalid token error = %v, want ErrStakeholderNotFound", err)
	}
}
