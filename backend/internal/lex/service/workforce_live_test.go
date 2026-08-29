package service

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// TestWorkforceLiveMeasurement is an opt-in dev-data contract probe. It uses the
// same tenant-scoped repositories and service as the HTTP endpoint, without
// introducing a production-only diagnostic route.
func TestWorkforceLiveMeasurement(t *testing.T) {
	lexDSN := os.Getenv("LEX_WORKFORCE_LIVE_DSN")
	platformDSN := os.Getenv("LEX_WORKFORCE_PLATFORM_DSN")
	tenantRaw := os.Getenv("LEX_WORKFORCE_TENANT_ID")
	if lexDSN == "" || platformDSN == "" || tenantRaw == "" {
		t.Skip("set LEX_WORKFORCE_LIVE_DSN, LEX_WORKFORCE_PLATFORM_DSN, and LEX_WORKFORCE_TENANT_ID")
	}
	tenantID, err := uuid.Parse(tenantRaw)
	if err != nil {
		t.Fatalf("parse tenant id: %v", err)
	}
	ctx := context.Background()
	lexPool, err := pgxpool.New(ctx, lexDSN)
	if err != nil {
		t.Fatalf("open lex database: %v", err)
	}
	defer lexPool.Close()
	platformPool, err := pgxpool.New(ctx, platformDSN)
	if err != nil {
		t.Fatalf("open platform database: %v", err)
	}
	defer platformPool.Close()

	scopeRepository := repository.NewWorkforceScopeRepository(lexPool)
	dataRepository := repository.NewWorkforceRepository(lexPool)
	directory := NewPlatformCoreWorkforceUserDirectory(platformPool)
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeRepository), dataRepository, NewReportingCalendarPort(nil))
	svc.SetUserDirectory(directory)

	report, err := svc.Report(ctx, tenantID, uuid.New(), WorkforceReportQuery{
		Scope: model.ScopeModeTenant, HasWorkforceAccess: true, HasExecutiveRole: true,
	})
	if err != nil {
		t.Fatalf("build live workforce report: %v", err)
	}
	if report.Coverage.ItemsTotal == 0 {
		t.Fatal("live workforce probe returned no attributable-domain records")
	}

	zeroContribution := make([]string, 0)
	for _, domain := range repository.WorkforceAttributableDomains {
		result, readErr := dataRepository.ReadDomain(ctx, tenantID, domain, report.Scope.UserIDs, true, defaultWorkforceRels)
		if readErr != nil {
			t.Fatalf("read live domain %s: %v", domain, readErr)
		}
		t.Logf("domain=%s total=%d attributed=%d rows=%d", domain, result.Coverage.Total, result.Coverage.Attributed, len(result.Attributions))
		if result.Coverage.Attributed == 0 {
			zeroContribution = append(zeroContribution, domain)
		}
	}

	t.Run("avatar_payload", func(t *testing.T) {
		avatarIDs := make([]uuid.UUID, 0, 15)
		err := database.RunReadWithTenant(ctx, platformPool, tenantID, func(tx pgx.Tx) error {
			rows, queryErr := tx.Query(ctx, `
				SELECT id
				FROM users
				WHERE tenant_id = $1
				  AND id = ANY($2::uuid[])
				  AND deleted_at IS NULL
				  AND NULLIF(BTRIM(avatar_url), '') IS NOT NULL
				ORDER BY id
				LIMIT 15`, tenantID, report.Scope.UserIDs)
			if queryErr != nil {
				return queryErr
			}
			defer rows.Close()
			for rows.Next() {
				var id uuid.UUID
				if scanErr := rows.Scan(&id); scanErr != nil {
					return scanErr
				}
				avatarIDs = append(avatarIDs, id)
			}
			return rows.Err()
		})
		if err != nil {
			t.Fatalf("find live avatar users: %v", err)
		}
		if len(avatarIDs) != 15 {
			t.Skipf("avatar_payload_measurement=NOT_FOUND qualifying_users=%d want=15", len(avatarIDs))
		}

		resolved, err := directory.ResolveUsers(ctx, tenantID, avatarIDs)
		if err != nil {
			t.Fatalf("resolve live avatar users: %v", err)
		}
		for _, id := range avatarIDs {
			if user, ok := resolved[id]; !ok || strings.TrimSpace(user.AvatarURL) == "" {
				t.Skipf("avatar_payload_measurement=NOT_FOUND resolver returned fewer than 15 non-empty avatars")
			}
		}
		payload, err := json.Marshal(resolved)
		if err != nil {
			t.Fatalf("marshal avatar resolver payload: %v", err)
		}
		if len(payload) > 200*1024 {
			t.Fatalf("15-user avatar resolver payload is %d bytes; avatar_url must be removed", len(payload))
		}
		t.Logf("avatar_payload_measurement=FOUND avatar_users=15 avatar_payload_bytes=%d", len(payload))
	})
	t.Logf("attribution_pct=%d items=%d/%d zero_contribution=%v", report.Coverage.AttributionPct, report.Coverage.ItemsAttributed, report.Coverage.ItemsTotal, zeroContribution)
}
