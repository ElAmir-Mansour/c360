//go:build integration

package respond

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestIntegrationTriagePersistsOverrideProvenanceAndLinksServices(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{
		PermRespondDeclare, PermRespondRead, PermRespondSeverity, PermRespondTransition,
	}}
	metastore := NewSQLMetastore(pool)
	seedRespondService(t, ctx, metastore, tenantID, ServiceMetadata{
		Key:       "ledger-db",
		Name:      "Ledger Database",
		OwnerTeam: "core-ledger",
		Tier:      ServiceTierMissionCritical,
	})
	seedRespondService(t, ctx, metastore, tenantID, ServiceMetadata{
		Key:       "payments-api",
		Name:      "Payments API",
		OwnerTeam: "payments",
		Tier:      ServiceTierBusinessCritical,
		Dependencies: []ServiceDependency{
			{ServiceKey: "ledger-db", Kind: ServiceDependencyHard},
		},
	})

	svc := NewService(pool, zerolog.Nop())
	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:            "payments outage",
		Description:      "card payments failing",
		Severity:         SeveritySEV3,
		ImpactedServices: []string{"payments-api"},
		Actor:            actor,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	result, err := svc.TriageIncident(ctx, tenantID, TriageIncidentInput{
		IncidentID: inc.ID,
		Assessment: IncidentImpactAssessmentInput{
			UserScope:           UserScopeAll,
			BusinessCriticality: BusinessCriticalityCriticalStopped,
			RevenueImpact:       RevenueImpactSevere,
			RegulatoryExposure:  RegulatoryExposureConfirmed,
			AffectedServiceKeys: []string{"payments-api"},
			Notes:               "MIM chose SEV2 because the affected processor is already failing over successfully.",
		},
		ChosenSeverity:  SeveritySEV2,
		OverrideReason:  "Failover is active and customer transactions are recovering.",
		ExpectedVersion: inc.RowVersion,
		Actor:           actor,
	})
	if err != nil {
		t.Fatalf("triage incident: %v", err)
	}
	if result.Incident.Status != StatusTriaged {
		t.Fatalf("status = %s, want %s", result.Incident.Status, StatusTriaged)
	}
	if result.Decision.RecommendedSeverity != SeveritySEV1 || result.Decision.ChosenSeverity != SeveritySEV2 || !result.Decision.OverrideRecommended {
		t.Fatalf("decision = %+v, want SEV1 recommendation overridden to SEV2", result.Decision)
	}
	if len(result.AffectedServices) != 1 || result.AffectedServices[0].Key != "payments-api" {
		t.Fatalf("affected services = %+v", result.AffectedServices)
	}

	repo := NewRepository()
	var persistedDecision *SeverityDecision
	var persistedAssessment *IncidentImpactAssessment
	var affected []ServiceMetadata
	var events []TimelineEvent
	if err := (pgxTenantRunner{pool: pool}).RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		persistedDecision, err = repo.GetSeverityDecision(ctx, tx, tenantID, result.Decision.ID)
		if err != nil {
			return err
		}
		persistedAssessment, err = repo.GetImpactAssessment(ctx, tx, tenantID, result.Assessment.ID)
		if err != nil {
			return err
		}
		affected, err = repo.ListIncidentAffectedServices(ctx, tx, tenantID, inc.ID)
		if err != nil {
			return err
		}
		events, err = repo.ListTimelineEvents(ctx, tx, tenantID, inc.ID, TimelineFilter{Limit: 20})
		return err
	}); err != nil {
		t.Fatalf("read persisted triage records: %v", err)
	}

	if persistedDecision.OverrideReason != "Failover is active and customer transactions are recovering." {
		t.Fatalf("override reason = %q", persistedDecision.OverrideReason)
	}
	if persistedDecision.RuleVersion != SeverityRecommendationRuleVersion {
		t.Fatalf("rule version = %q, want %q", persistedDecision.RuleVersion, SeverityRecommendationRuleVersion)
	}
	if persistedDecision.RuleTrace["dimension_severities"] == nil {
		t.Fatalf("rule trace missing dimension severities: %+v", persistedDecision.RuleTrace)
	}
	if len(persistedAssessment.AffectedServiceKeys) != 1 || persistedAssessment.AffectedServiceKeys[0] != "payments-api" {
		t.Fatalf("assessment affected service keys = %+v", persistedAssessment.AffectedServiceKeys)
	}
	if len(affected) != 1 || affected[0].OwnerTeam != "payments" || len(affected[0].Dependencies) != 1 {
		t.Fatalf("persisted affected service metadata = %+v", affected)
	}
	if !hasTimelineEvent(events, EventIncidentTransitioned) || !hasTimelineEvent(events, EventSeverityTriaged) || !hasTimelineEvent(events, EventSeverityChanged) {
		t.Fatalf("timeline events missing triage provenance events: %+v", events)
	}
}

func TestIntegrationTriageRejectsInvalidInput(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	tenantID := uuid.New()
	actor := Actor{UserID: uuid.New(), GlobalPermissions: []string{
		PermRespondDeclare, PermRespondRead, PermRespondSeverity, PermRespondTransition,
	}}
	metastore := NewSQLMetastore(pool)
	seedRespondService(t, ctx, metastore, tenantID, ServiceMetadata{
		Key:       "payments-api",
		Name:      "Payments API",
		OwnerTeam: "payments",
		Tier:      ServiceTierBusinessCritical,
	})

	svc := NewService(pool, zerolog.Nop())
	inc, err := svc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:            "payments degraded",
		Severity:         SeveritySEV3,
		ImpactedServices: []string{"payments-api"},
		Actor:            actor,
	})
	if err != nil {
		t.Fatalf("declare incident: %v", err)
	}

	_, err = svc.TriageIncident(ctx, tenantID, TriageIncidentInput{
		IncidentID: inc.ID,
		Assessment: IncidentImpactAssessmentInput{
			UserScope:           UserImpactScope("everyone"),
			BusinessCriticality: BusinessCriticalityNone,
			RevenueImpact:       RevenueImpactNone,
			RegulatoryExposure:  RegulatoryExposureNone,
			AffectedServiceKeys: []string{"payments-api"},
		},
		ChosenSeverity:  SeveritySEV4,
		ExpectedVersion: inc.RowVersion,
		Actor:           actor,
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid dimension error = %v, want ErrValidation", err)
	}

	_, err = svc.TriageIncident(ctx, tenantID, TriageIncidentInput{
		IncidentID: inc.ID,
		Assessment: IncidentImpactAssessmentInput{
			UserScope:           UserScopeAll,
			BusinessCriticality: BusinessCriticalityCriticalStopped,
			RevenueImpact:       RevenueImpactSevere,
			RegulatoryExposure:  RegulatoryExposureConfirmed,
			AffectedServiceKeys: []string{"payments-api"},
		},
		ChosenSeverity:  SeveritySEV2,
		ExpectedVersion: inc.RowVersion,
		Actor:           actor,
	})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("missing override reason error = %v, want ErrValidation", err)
	}

	_, err = svc.TriageIncident(ctx, tenantID, TriageIncidentInput{
		IncidentID: inc.ID,
		Assessment: IncidentImpactAssessmentInput{
			UserScope:           UserScopeLimited,
			BusinessCriticality: BusinessCriticalityImportant,
			RevenueImpact:       RevenueImpactLow,
			RegulatoryExposure:  RegulatoryExposureUnlikely,
			AffectedServiceKeys: []string{"unknown-service"},
		},
		ChosenSeverity:  SeveritySEV3,
		ExpectedVersion: inc.RowVersion,
		Actor:           actor,
	})
	if !errors.Is(err, ErrServiceNotFound) {
		t.Fatalf("unknown service error = %v, want ErrServiceNotFound", err)
	}

	reloaded, err := svc.GetIncident(ctx, tenantID, inc.ID, actor)
	if err != nil {
		t.Fatalf("reload incident: %v", err)
	}
	if reloaded.Status != StatusDeclared || reloaded.RowVersion != inc.RowVersion {
		t.Fatalf("incident mutated after rejected triage: status=%s version=%d", reloaded.Status, reloaded.RowVersion)
	}
}

func seedRespondService(t *testing.T, ctx context.Context, metastore *SQLMetastore, tenantID uuid.UUID, service ServiceMetadata) {
	t.Helper()
	if service.Owners == nil {
		service.Owners = []string{service.OwnerTeam + "@example.com"}
	}
	if _, err := metastore.UpsertService(ctx, tenantID, service); err != nil {
		t.Fatalf("seed service %s: %v", service.Key, err)
	}
}

func hasTimelineEvent(events []TimelineEvent, eventType string) bool {
	for _, event := range events {
		if event.EventType == eventType {
			return true
		}
	}
	return false
}
