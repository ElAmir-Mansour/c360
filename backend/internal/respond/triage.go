package respond

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	SeverityRecommendationRuleVersion = "respond-severity-rules-v1"
	EventSeverityTriaged              = "respond.incident.severity_triaged"
)

type UserImpactScope string

const (
	UserScopeNone       UserImpactScope = "none"
	UserScopeIndividual UserImpactScope = "individual_users"
	UserScopeLimited    UserImpactScope = "limited_user_group"
	UserScopeLarge      UserImpactScope = "large_user_group"
	UserScopeAll        UserImpactScope = "all_users"
)

func (s UserImpactScope) Valid() bool {
	switch s {
	case UserScopeNone, UserScopeIndividual, UserScopeLimited, UserScopeLarge, UserScopeAll:
		return true
	default:
		return false
	}
}

type BusinessCriticality string

const (
	BusinessCriticalityNone             BusinessCriticality = "none"
	BusinessCriticalityNonCritical      BusinessCriticality = "non_critical"
	BusinessCriticalityImportant        BusinessCriticality = "important_degraded"
	BusinessCriticalityCriticalDegraded BusinessCriticality = "critical_degraded"
	BusinessCriticalityCriticalStopped  BusinessCriticality = "critical_stopped"
)

func (c BusinessCriticality) Valid() bool {
	switch c {
	case BusinessCriticalityNone, BusinessCriticalityNonCritical, BusinessCriticalityImportant,
		BusinessCriticalityCriticalDegraded, BusinessCriticalityCriticalStopped:
		return true
	default:
		return false
	}
}

type RevenueImpact string

const (
	RevenueImpactNone     RevenueImpact = "none"
	RevenueImpactLow      RevenueImpact = "low"
	RevenueImpactMaterial RevenueImpact = "material"
	RevenueImpactSevere   RevenueImpact = "severe"
)

func (i RevenueImpact) Valid() bool {
	switch i {
	case RevenueImpactNone, RevenueImpactLow, RevenueImpactMaterial, RevenueImpactSevere:
		return true
	default:
		return false
	}
}

type RegulatoryExposure string

const (
	RegulatoryExposureNone      RegulatoryExposure = "none"
	RegulatoryExposureUnlikely  RegulatoryExposure = "unlikely"
	RegulatoryExposurePotential RegulatoryExposure = "potential"
	RegulatoryExposureConfirmed RegulatoryExposure = "confirmed"
)

func (e RegulatoryExposure) Valid() bool {
	switch e {
	case RegulatoryExposureNone, RegulatoryExposureUnlikely, RegulatoryExposurePotential, RegulatoryExposureConfirmed:
		return true
	default:
		return false
	}
}

type IncidentImpactAssessmentInput struct {
	UserScope           UserImpactScope     `json:"user_scope"`
	BusinessCriticality BusinessCriticality `json:"business_criticality"`
	RevenueImpact       RevenueImpact       `json:"revenue_impact"`
	RegulatoryExposure  RegulatoryExposure  `json:"regulatory_exposure"`
	AffectedServiceKeys []string            `json:"affected_service_keys"`
	Notes               string              `json:"notes,omitempty"`
}

type SeverityRecommendation struct {
	Severity            Severity            `json:"severity"`
	RuleVersion         string              `json:"rule_version"`
	DimensionSeverities map[string]Severity `json:"dimension_severities"`
	Reasons             []string            `json:"reasons"`
}

type IncidentImpactAssessment struct {
	ID                  uuid.UUID           `json:"id"`
	TenantID            uuid.UUID           `json:"tenant_id"`
	IncidentID          uuid.UUID           `json:"incident_id"`
	UserScope           UserImpactScope     `json:"user_scope"`
	BusinessCriticality BusinessCriticality `json:"business_criticality"`
	RevenueImpact       RevenueImpact       `json:"revenue_impact"`
	RegulatoryExposure  RegulatoryExposure  `json:"regulatory_exposure"`
	AffectedServiceKeys []string            `json:"affected_service_keys"`
	Notes               string              `json:"notes,omitempty"`
	AssessedBy          uuid.UUID           `json:"assessed_by"`
	AssessedAt          time.Time           `json:"assessed_at"`
	CreatedAt           time.Time           `json:"created_at"`
}

type SeverityDecision struct {
	ID                  uuid.UUID      `json:"id"`
	TenantID            uuid.UUID      `json:"tenant_id"`
	IncidentID          uuid.UUID      `json:"incident_id"`
	ImpactAssessmentID  uuid.UUID      `json:"impact_assessment_id"`
	PreviousSeverity    Severity       `json:"previous_severity"`
	RecommendedSeverity Severity       `json:"recommended_severity"`
	ChosenSeverity      Severity       `json:"chosen_severity"`
	OverrideRecommended bool           `json:"override_recommended"`
	OverrideReason      string         `json:"override_reason,omitempty"`
	RuleVersion         string         `json:"rule_version"`
	RuleTrace           map[string]any `json:"rule_trace"`
	IncidentRowVersion  int            `json:"incident_row_version"`
	DecidedBy           uuid.UUID      `json:"decided_by"`
	DecidedAt           time.Time      `json:"decided_at"`
	CreatedAt           time.Time      `json:"created_at"`
}

type TriageIncidentInput struct {
	IncidentID      uuid.UUID                     `json:"incident_id"`
	Assessment      IncidentImpactAssessmentInput `json:"assessment"`
	ChosenSeverity  Severity                      `json:"chosen_severity"`
	OverrideReason  string                        `json:"override_reason,omitempty"`
	ExpectedVersion int                           `json:"expected_version"`
	Actor           Actor                         `json:"actor"`
}

type TriageResult struct {
	Incident         *Incident                 `json:"incident"`
	Assessment       *IncidentImpactAssessment `json:"assessment"`
	Decision         *SeverityDecision         `json:"decision"`
	Recommendation   SeverityRecommendation    `json:"recommendation"`
	AffectedServices []ServiceMetadata         `json:"affected_services"`
}

func RecommendSeverity(in IncidentImpactAssessmentInput) (SeverityRecommendation, error) {
	in = in.normalized()
	if err := in.validate(); err != nil {
		return SeverityRecommendation{}, err
	}
	dimensions := map[string]Severity{
		"user_scope":           severityForUserScope(in.UserScope),
		"business_criticality": severityForBusinessCriticality(in.BusinessCriticality),
		"revenue_impact":       severityForRevenueImpact(in.RevenueImpact),
		"regulatory_exposure":  severityForRegulatoryExposure(in.RegulatoryExposure),
	}
	recommended := SeveritySEV4
	for _, name := range recommendationDimensionOrder() {
		if severityRank(dimensions[name]) < severityRank(recommended) {
			recommended = dimensions[name]
		}
	}
	reasons := make([]string, 0, len(dimensions))
	for _, name := range recommendationDimensionOrder() {
		if dimensions[name] == recommended {
			reasons = append(reasons, fmt.Sprintf("%s=%s drives %s", name, dimensionValue(in, name), recommended))
		}
	}
	return SeverityRecommendation{
		Severity:            recommended,
		RuleVersion:         SeverityRecommendationRuleVersion,
		DimensionSeverities: dimensions,
		Reasons:             reasons,
	}, nil
}

func (s *Service) TriageIncident(ctx context.Context, tenantID uuid.UUID, in TriageIncidentInput) (*TriageResult, error) {
	if !in.Actor.Can(PermRespondSeverity) || !in.Actor.Can(PermRespondTransition) {
		return nil, ErrUnauthorized
	}
	if tenantID == uuid.Nil || in.IncidentID == uuid.Nil {
		return nil, fmt.Errorf("tenant_id and incident_id are required: %w", ErrValidation)
	}
	if in.ExpectedVersion <= 0 {
		return nil, fmt.Errorf("expected_version must be greater than zero: %w", ErrValidation)
	}
	if !in.ChosenSeverity.Valid() {
		return nil, ErrInvalidSeverity
	}
	assessmentInput := in.Assessment.normalized()
	recommendation, err := RecommendSeverity(assessmentInput)
	if err != nil {
		return nil, err
	}
	overrideReason := strings.TrimSpace(in.OverrideReason)
	override := in.ChosenSeverity != recommendation.Severity
	if override && overrideReason == "" {
		return nil, fmt.Errorf("override_reason is required when chosen severity differs from recommendation: %w", ErrValidation)
	}

	var result *TriageResult
	var events []TimelineEvent
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		if err := ValidateTransition(current.Status, StatusTriaged); err != nil {
			return err
		}
		serviceKeys := assessmentInput.AffectedServiceKeys
		if len(serviceKeys) == 0 {
			serviceKeys = normalizeServiceKeys(current.ImpactedServices)
		}
		if len(serviceKeys) == 0 {
			return fmt.Errorf("at least one affected service is required for triage: %w", ErrValidation)
		}
		services, err := s.repo.GetServiceMetadataByKeys(ctx, tx, tenantID, serviceKeys)
		if err != nil {
			return err
		}

		at := s.now()
		updated, err := s.repo.ApplyTriageDecision(ctx, tx, tenantID, in.IncidentID, current.Status, in.ChosenSeverity, serviceKeys, in.ExpectedVersion, at)
		if err != nil {
			return err
		}
		assessment := &IncidentImpactAssessment{
			TenantID:            tenantID,
			IncidentID:          in.IncidentID,
			UserScope:           assessmentInput.UserScope,
			BusinessCriticality: assessmentInput.BusinessCriticality,
			RevenueImpact:       assessmentInput.RevenueImpact,
			RegulatoryExposure:  assessmentInput.RegulatoryExposure,
			AffectedServiceKeys: serviceKeys,
			Notes:               strings.TrimSpace(assessmentInput.Notes),
			AssessedBy:          in.Actor.UserID,
			AssessedAt:          at,
		}
		if err := s.repo.CreateImpactAssessment(ctx, tx, assessment); err != nil {
			return err
		}
		decision := &SeverityDecision{
			TenantID:            tenantID,
			IncidentID:          in.IncidentID,
			ImpactAssessmentID:  assessment.ID,
			PreviousSeverity:    current.Severity,
			RecommendedSeverity: recommendation.Severity,
			ChosenSeverity:      in.ChosenSeverity,
			OverrideRecommended: override,
			OverrideReason:      overrideReason,
			RuleVersion:         recommendation.RuleVersion,
			RuleTrace:           recommendation.ruleTrace(),
			IncidentRowVersion:  updated.RowVersion,
			DecidedBy:           in.Actor.UserID,
			DecidedAt:           at,
		}
		if err := s.repo.CreateSeverityDecision(ctx, tx, decision); err != nil {
			return err
		}
		if err := s.repo.ReplaceIncidentAffectedServices(ctx, tx, tenantID, in.IncidentID, in.Actor.UserID, services, at); err != nil {
			return err
		}

		if current.Severity != updated.Severity {
			event := TimelineEvent{
				TenantID:   tenantID,
				IncidentID: updated.ID,
				ActorID:    in.Actor.UserID,
				OccurredAt: at,
				EventType:  EventSeverityChanged,
				Payload: map[string]any{
					"reference": updated.Reference,
					"from":      current.Severity,
					"to":        updated.Severity,
					"version":   updated.RowVersion,
				},
			}
			if err := s.repo.AppendTimelineEvent(ctx, tx, &event); err != nil {
				return err
			}
			events = append(events, event)
		}

		transitionEvent := TimelineEvent{
			TenantID:   tenantID,
			IncidentID: updated.ID,
			ActorID:    in.Actor.UserID,
			OccurredAt: at,
			EventType:  EventIncidentTransitioned,
			Payload: map[string]any{
				"reference": updated.Reference,
				"from":      current.Status,
				"to":        updated.Status,
				"version":   updated.RowVersion,
			},
		}
		if err := s.repo.AppendTimelineEvent(ctx, tx, &transitionEvent); err != nil {
			return err
		}
		events = append(events, transitionEvent)

		triageEvent := TimelineEvent{
			TenantID:   tenantID,
			IncidentID: updated.ID,
			ActorID:    in.Actor.UserID,
			OccurredAt: at,
			EventType:  EventSeverityTriaged,
			Payload: map[string]any{
				"reference":            updated.Reference,
				"recommended_severity": recommendation.Severity,
				"chosen_severity":      in.ChosenSeverity,
				"override_recommended": override,
				"impact_assessment_id": assessment.ID,
				"severity_decision_id": decision.ID,
				"affected_services":    serviceKeys,
				"rule_version":         recommendation.RuleVersion,
			},
		}
		if err := s.repo.AppendTimelineEvent(ctx, tx, &triageEvent); err != nil {
			return err
		}
		events = append(events, triageEvent)

		result = &TriageResult{
			Incident:         updated,
			Assessment:       assessment,
			Decision:         decision,
			Recommendation:   recommendation,
			AffectedServices: services,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, event := range events {
		s.feed.Publish(event)
	}
	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("incident_id", result.Incident.ID.String()).
		Str("recommended_severity", string(result.Decision.RecommendedSeverity)).
		Str("chosen_severity", string(result.Decision.ChosenSeverity)).
		Bool("override_recommended", result.Decision.OverrideRecommended).
		Msg("respond incident triaged")
	return result, nil
}

func (s *Service) LatestSeverityDecision(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*SeverityDecision, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var decision *SeverityDecision
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		decision, err = s.repo.LatestSeverityDecision(ctx, tx, tenantID, incidentID)
		return err
	})
	return decision, err
}

func (in IncidentImpactAssessmentInput) normalized() IncidentImpactAssessmentInput {
	in.UserScope = UserImpactScope(strings.ToLower(strings.TrimSpace(string(in.UserScope))))
	in.BusinessCriticality = BusinessCriticality(strings.ToLower(strings.TrimSpace(string(in.BusinessCriticality))))
	in.RevenueImpact = RevenueImpact(strings.ToLower(strings.TrimSpace(string(in.RevenueImpact))))
	in.RegulatoryExposure = RegulatoryExposure(strings.ToLower(strings.TrimSpace(string(in.RegulatoryExposure))))
	in.AffectedServiceKeys = normalizeServiceKeys(in.AffectedServiceKeys)
	in.Notes = strings.TrimSpace(in.Notes)
	return in
}

func (in IncidentImpactAssessmentInput) validate() error {
	if !in.UserScope.Valid() {
		return fmt.Errorf("user_scope is invalid: %w", ErrValidation)
	}
	if !in.BusinessCriticality.Valid() {
		return fmt.Errorf("business_criticality is invalid: %w", ErrValidation)
	}
	if !in.RevenueImpact.Valid() {
		return fmt.Errorf("revenue_impact is invalid: %w", ErrValidation)
	}
	if !in.RegulatoryExposure.Valid() {
		return fmt.Errorf("regulatory_exposure is invalid: %w", ErrValidation)
	}
	return nil
}

func severityForUserScope(scope UserImpactScope) Severity {
	switch scope {
	case UserScopeAll:
		return SeveritySEV1
	case UserScopeLarge:
		return SeveritySEV2
	case UserScopeLimited:
		return SeveritySEV3
	default:
		return SeveritySEV4
	}
}

func severityForBusinessCriticality(criticality BusinessCriticality) Severity {
	switch criticality {
	case BusinessCriticalityCriticalStopped:
		return SeveritySEV1
	case BusinessCriticalityCriticalDegraded:
		return SeveritySEV2
	case BusinessCriticalityImportant:
		return SeveritySEV3
	default:
		return SeveritySEV4
	}
}

func severityForRevenueImpact(impact RevenueImpact) Severity {
	switch impact {
	case RevenueImpactSevere:
		return SeveritySEV1
	case RevenueImpactMaterial:
		return SeveritySEV2
	case RevenueImpactLow:
		return SeveritySEV3
	default:
		return SeveritySEV4
	}
}

func severityForRegulatoryExposure(exposure RegulatoryExposure) Severity {
	switch exposure {
	case RegulatoryExposureConfirmed:
		return SeveritySEV1
	case RegulatoryExposurePotential:
		return SeveritySEV2
	case RegulatoryExposureUnlikely:
		return SeveritySEV3
	default:
		return SeveritySEV4
	}
}

func severityRank(severity Severity) int {
	switch severity {
	case SeveritySEV1:
		return 1
	case SeveritySEV2:
		return 2
	case SeveritySEV3:
		return 3
	case SeveritySEV4:
		return 4
	default:
		return 99
	}
}

func recommendationDimensionOrder() []string {
	return []string{"user_scope", "business_criticality", "revenue_impact", "regulatory_exposure"}
}

func dimensionValue(in IncidentImpactAssessmentInput, name string) string {
	switch name {
	case "user_scope":
		return string(in.UserScope)
	case "business_criticality":
		return string(in.BusinessCriticality)
	case "revenue_impact":
		return string(in.RevenueImpact)
	case "regulatory_exposure":
		return string(in.RegulatoryExposure)
	default:
		return ""
	}
}

func (r SeverityRecommendation) ruleTrace() map[string]any {
	dimensions := make(map[string]string, len(r.DimensionSeverities))
	for _, name := range recommendationDimensionOrder() {
		dimensions[name] = string(r.DimensionSeverities[name])
	}
	return map[string]any{
		"dimension_severities": dimensions,
		"reasons":              r.Reasons,
	}
}

func (s *Store) ApplyTriageDecision(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, from Status, severity Severity, serviceKeys []string, expectedVersion int, at time.Time) (*Incident, error) {
	serviceKeys = normalizeServiceKeys(serviceKeys)
	servicesJSON, err := json.Marshal(serviceKeys)
	if err != nil {
		return nil, fmt.Errorf("respond: marshal affected service keys: %w", err)
	}
	updated, err := scanIncident(db.QueryRow(ctx, `
UPDATE respond_incident
   SET severity = $4,
       status = $5,
       impacted_services = $6,
       row_version = row_version + 1,
       updated_at = $8
 WHERE tenant_id = $1 AND id = $2 AND status = $3 AND row_version = $7
RETURNING `+incidentColumns,
		tenantID,
		incidentID,
		from,
		severity,
		StatusTriaged,
		servicesJSON,
		expectedVersion,
		at,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrVersionConflict
		}
		return nil, fmt.Errorf("respond: apply triage decision %s: %w", incidentID, err)
	}
	return updated, nil
}

func (s *Store) CreateImpactAssessment(ctx context.Context, db DBTX, assessment *IncidentImpactAssessment) error {
	if assessment == nil {
		return fmt.Errorf("impact assessment is required: %w", ErrValidation)
	}
	input := IncidentImpactAssessmentInput{
		UserScope:           assessment.UserScope,
		BusinessCriticality: assessment.BusinessCriticality,
		RevenueImpact:       assessment.RevenueImpact,
		RegulatoryExposure:  assessment.RegulatoryExposure,
		AffectedServiceKeys: assessment.AffectedServiceKeys,
		Notes:               assessment.Notes,
	}.normalized()
	if err := input.validate(); err != nil {
		return err
	}
	assessment.UserScope = input.UserScope
	assessment.BusinessCriticality = input.BusinessCriticality
	assessment.RevenueImpact = input.RevenueImpact
	assessment.RegulatoryExposure = input.RegulatoryExposure
	assessment.AffectedServiceKeys = input.AffectedServiceKeys
	assessment.Notes = input.Notes
	if assessment.TenantID == uuid.Nil || assessment.IncidentID == uuid.Nil || assessment.AssessedBy == uuid.Nil {
		return fmt.Errorf("tenant_id, incident_id, and assessed_by are required: %w", ErrValidation)
	}
	if assessment.AssessedAt.IsZero() {
		assessment.AssessedAt = time.Now().UTC()
	}
	keysJSON, err := json.Marshal(assessment.AffectedServiceKeys)
	if err != nil {
		return fmt.Errorf("respond: marshal impact assessment service keys: %w", err)
	}
	err = db.QueryRow(ctx, `
INSERT INTO respond_incident_impact_assessment (
    tenant_id, incident_id, user_scope, business_criticality, revenue_impact,
    regulatory_exposure, affected_service_keys, notes, assessed_by, assessed_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING id, created_at`,
		assessment.TenantID,
		assessment.IncidentID,
		assessment.UserScope,
		assessment.BusinessCriticality,
		assessment.RevenueImpact,
		assessment.RegulatoryExposure,
		keysJSON,
		assessment.Notes,
		assessment.AssessedBy,
		assessment.AssessedAt,
	).Scan(&assessment.ID, &assessment.CreatedAt)
	if err != nil {
		return fmt.Errorf("respond: create impact assessment: %w", err)
	}
	return nil
}

func (s *Store) CreateSeverityDecision(ctx context.Context, db DBTX, decision *SeverityDecision) error {
	if decision == nil {
		return fmt.Errorf("severity decision is required: %w", ErrValidation)
	}
	if decision.TenantID == uuid.Nil || decision.IncidentID == uuid.Nil || decision.ImpactAssessmentID == uuid.Nil || decision.DecidedBy == uuid.Nil {
		return fmt.Errorf("tenant_id, incident_id, impact_assessment_id, and decided_by are required: %w", ErrValidation)
	}
	if !decision.PreviousSeverity.Valid() || !decision.RecommendedSeverity.Valid() || !decision.ChosenSeverity.Valid() {
		return ErrInvalidSeverity
	}
	decision.OverrideReason = strings.TrimSpace(decision.OverrideReason)
	decision.OverrideRecommended = decision.ChosenSeverity != decision.RecommendedSeverity
	if decision.OverrideRecommended && decision.OverrideReason == "" {
		return fmt.Errorf("override_reason is required when chosen severity differs from recommendation: %w", ErrValidation)
	}
	if decision.RuleVersion == "" {
		decision.RuleVersion = SeverityRecommendationRuleVersion
	}
	if decision.RuleTrace == nil {
		decision.RuleTrace = map[string]any{}
	}
	if decision.IncidentRowVersion <= 0 {
		return fmt.Errorf("incident_row_version must be greater than zero: %w", ErrValidation)
	}
	if decision.DecidedAt.IsZero() {
		decision.DecidedAt = time.Now().UTC()
	}
	traceJSON, err := json.Marshal(decision.RuleTrace)
	if err != nil {
		return fmt.Errorf("respond: marshal severity rule trace: %w", err)
	}
	err = db.QueryRow(ctx, `
INSERT INTO respond_incident_severity_decision (
    tenant_id, incident_id, impact_assessment_id, previous_severity,
    recommended_severity, chosen_severity, override_recommended, override_reason,
    rule_version, rule_trace, incident_row_version, decided_by, decided_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
RETURNING id, created_at`,
		decision.TenantID,
		decision.IncidentID,
		decision.ImpactAssessmentID,
		decision.PreviousSeverity,
		decision.RecommendedSeverity,
		decision.ChosenSeverity,
		decision.OverrideRecommended,
		decision.OverrideReason,
		decision.RuleVersion,
		traceJSON,
		decision.IncidentRowVersion,
		decision.DecidedBy,
		decision.DecidedAt,
	).Scan(&decision.ID, &decision.CreatedAt)
	if err != nil {
		return fmt.Errorf("respond: create severity decision: %w", err)
	}
	return nil
}

func (s *Store) GetSeverityDecision(ctx context.Context, db DBTX, tenantID, decisionID uuid.UUID) (*SeverityDecision, error) {
	return scanSeverityDecision(db.QueryRow(ctx, `
SELECT id, tenant_id, incident_id, impact_assessment_id, previous_severity,
       recommended_severity, chosen_severity, override_recommended, override_reason,
       rule_version, rule_trace, incident_row_version, decided_by, decided_at, created_at
  FROM respond_incident_severity_decision
 WHERE tenant_id = $1 AND id = $2`, tenantID, decisionID))
}

func (s *Store) LatestSeverityDecision(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) (*SeverityDecision, error) {
	return scanSeverityDecision(db.QueryRow(ctx, `
SELECT id, tenant_id, incident_id, impact_assessment_id, previous_severity,
       recommended_severity, chosen_severity, override_recommended, override_reason,
       rule_version, rule_trace, incident_row_version, decided_by, decided_at, created_at
  FROM respond_incident_severity_decision
 WHERE tenant_id = $1 AND incident_id = $2
 ORDER BY decided_at DESC, id DESC
 LIMIT 1`, tenantID, incidentID))
}

func scanSeverityDecision(row rowScanner) (*SeverityDecision, error) {
	var decision SeverityDecision
	var previous, recommended, chosen string
	var traceJSON []byte
	if err := row.Scan(
		&decision.ID,
		&decision.TenantID,
		&decision.IncidentID,
		&decision.ImpactAssessmentID,
		&previous,
		&recommended,
		&chosen,
		&decision.OverrideRecommended,
		&decision.OverrideReason,
		&decision.RuleVersion,
		&traceJSON,
		&decision.IncidentRowVersion,
		&decision.DecidedBy,
		&decision.DecidedAt,
		&decision.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrIncidentNotFound
		}
		return nil, fmt.Errorf("respond: scan severity decision: %w", err)
	}
	decision.PreviousSeverity = Severity(previous)
	decision.RecommendedSeverity = Severity(recommended)
	decision.ChosenSeverity = Severity(chosen)
	if len(traceJSON) > 0 {
		if err := json.Unmarshal(traceJSON, &decision.RuleTrace); err != nil {
			return nil, fmt.Errorf("respond: unmarshal severity rule trace: %w", err)
		}
	}
	if decision.RuleTrace == nil {
		decision.RuleTrace = map[string]any{}
	}
	return &decision, nil
}

func (s *Store) GetImpactAssessment(ctx context.Context, db DBTX, tenantID, assessmentID uuid.UUID) (*IncidentImpactAssessment, error) {
	return scanImpactAssessment(db.QueryRow(ctx, `
SELECT id, tenant_id, incident_id, user_scope, business_criticality, revenue_impact,
       regulatory_exposure, affected_service_keys, notes, assessed_by, assessed_at, created_at
  FROM respond_incident_impact_assessment
 WHERE tenant_id = $1 AND id = $2`, tenantID, assessmentID))
}

func scanImpactAssessment(row rowScanner) (*IncidentImpactAssessment, error) {
	var assessment IncidentImpactAssessment
	var userScope, businessCriticality, revenueImpact, regulatoryExposure string
	var keysJSON []byte
	if err := row.Scan(
		&assessment.ID,
		&assessment.TenantID,
		&assessment.IncidentID,
		&userScope,
		&businessCriticality,
		&revenueImpact,
		&regulatoryExposure,
		&keysJSON,
		&assessment.Notes,
		&assessment.AssessedBy,
		&assessment.AssessedAt,
		&assessment.CreatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrIncidentNotFound
		}
		return nil, fmt.Errorf("respond: scan impact assessment: %w", err)
	}
	assessment.UserScope = UserImpactScope(userScope)
	assessment.BusinessCriticality = BusinessCriticality(businessCriticality)
	assessment.RevenueImpact = RevenueImpact(revenueImpact)
	assessment.RegulatoryExposure = RegulatoryExposure(regulatoryExposure)
	if len(keysJSON) > 0 {
		if err := json.Unmarshal(keysJSON, &assessment.AffectedServiceKeys); err != nil {
			return nil, fmt.Errorf("respond: unmarshal assessment affected services: %w", err)
		}
	}
	if assessment.AffectedServiceKeys == nil {
		assessment.AffectedServiceKeys = []string{}
	}
	return &assessment, nil
}
