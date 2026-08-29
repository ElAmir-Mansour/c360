//go:build integration

package respond

import (
	"testing"

	"github.com/google/uuid"
)

func TestIntegrationMetastoreServiceMetadataLookup(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	tenantID := uuid.New()
	metastore := NewSQLMetastore(pool)

	if _, err := metastore.UpsertService(ctx, tenantID, ServiceMetadata{
		Key:       "ledger-db",
		Name:      "Ledger Database",
		OwnerTeam: "core-ledger",
		Owners:    []string{"ledger-primary@example.com"},
		Tier:      ServiceTierMissionCritical,
	}); err != nil {
		t.Fatalf("upsert ledger-db: %v", err)
	}
	if _, err := metastore.UpsertService(ctx, tenantID, ServiceMetadata{
		Key:       "payments-api",
		Name:      "Payments API",
		OwnerTeam: "payments",
		Owners:    []string{"payments-primary@example.com", "payments-secondary@example.com"},
		Tier:      ServiceTierBusinessCritical,
		Dependencies: []ServiceDependency{
			{ServiceKey: "ledger-db", Kind: ServiceDependencyHard},
		},
	}); err != nil {
		t.Fatalf("upsert payments-api: %v", err)
	}

	got, err := metastore.ResolveService(ctx, tenantID, " Payments-API ")
	if err != nil {
		t.Fatalf("resolve payments-api: %v", err)
	}
	if got.Key != "payments-api" || got.OwnerTeam != "payments" || got.Tier != ServiceTierBusinessCritical {
		t.Fatalf("service metadata = %+v", got)
	}
	if len(got.Dependencies) != 1 || got.Dependencies[0].ServiceKey != "ledger-db" || got.Dependencies[0].Kind != ServiceDependencyHard {
		t.Fatalf("dependencies = %+v, want ledger-db hard dependency", got.Dependencies)
	}

	services, err := metastore.ListServices(ctx, tenantID, 10, 0)
	if err != nil {
		t.Fatalf("list services: %v", err)
	}
	if len(services) != 2 {
		t.Fatalf("services = %d, want 2", len(services))
	}
}
