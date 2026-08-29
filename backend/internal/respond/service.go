package respond

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
)

type tenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(DBTX) error) error
}

type pgxTenantRunner struct{ pool *pgxpool.Pool }

func (r pgxTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r pgxTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r pgxTenantRunner) RunSystemRead(ctx context.Context, fn func(DBTX) error) error {
	return database.RunSystemRead(ctx, r.pool, func(tx pgx.Tx) error { return fn(tx) })
}

type Service struct {
	tx                     tenantRunner
	repo                   *Repository
	feed                   *TimelineFeed
	entitlements           EntitlementResolver
	notificationEngine     *NotificationEngine
	responderResolver      ResponderResolver
	mobilizationAckTimeout time.Duration
	logger                 zerolog.Logger
	now                    func() time.Time
}

func NewService(pool *pgxpool.Pool, logger zerolog.Logger, entitlements ...EntitlementResolver) *Service {
	return NewServiceWithDeps(pgxTenantRunner{pool: pool}, NewRepository(), NewTimelineFeed(256), logger, entitlements...)
}

func NewServiceWithDeps(tx tenantRunner, repo *Repository, feed *TimelineFeed, logger zerolog.Logger, entitlements ...EntitlementResolver) *Service {
	if feed == nil {
		feed = NewTimelineFeed(256)
	}
	var resolver EntitlementResolver
	if len(entitlements) > 0 {
		resolver = entitlements[0]
	}
	return &Service{
		tx:           tx,
		repo:         repo,
		feed:         feed,
		entitlements: resolver,
		logger:       logger.With().Str("component", "respond-service").Logger(),
		now:          func() time.Time { return time.Now().UTC() },
	}
}

func (s *Service) EnableNotificationMobilization(engine *NotificationEngine, resolver ResponderResolver, ackTimeout time.Duration) {
	s.notificationEngine = engine
	s.responderResolver = resolver
	if ackTimeout > 0 {
		s.mobilizationAckTimeout = ackTimeout
	}
}

type ProductCapability struct {
	ID             string `json:"id"`
	Label          string `json:"label"`
	Description    string `json:"description,omitempty"`
	EntitlementKey string `json:"entitlement_key"`
	Enabled        bool   `json:"enabled"`
}

type ProductResponse struct {
	ID                string              `json:"id"`
	Name              string              `json:"name"`
	EntitlementKey    string              `json:"entitlement_key"`
	EntitlementState  string              `json:"entitlement_state"`
	EntitlementReason string              `json:"entitlement_reason,omitempty"`
	Licensed          bool                `json:"licensed"`
	Capabilities      []ProductCapability `json:"capabilities"`
}

func (s *Service) Product(ctx context.Context, tenantID uuid.UUID, authorization string) (*ProductResponse, error) {
	if s.entitlements == nil {
		return nil, ErrEntitlementUnavailable
	}
	active, reason, err := s.entitlements.Resolve(ctx, tenantID.String(), authorization, EntitlementMajorIncident)
	if err != nil {
		return nil, err
	}
	state := "licensed"
	if !active {
		state = "unlicensed"
	}
	product := &ProductResponse{
		ID:                "respond",
		Name:              "Clario Respond",
		EntitlementKey:    EntitlementMajorIncident,
		EntitlementState:  state,
		EntitlementReason: reason,
		Licensed:          active,
		Capabilities: []ProductCapability{
			{ID: "declaration", Label: "Declaration and triage", Description: "Declare, classify, and severity-score major incidents.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "triage", Label: "Severity triage", Description: "Persist impact assessments, recommendations, overrides, and affected service metadata.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "service-linkage", Label: "Service linkage", Description: "Resolve affected service ownership, tier, and dependency metadata.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "roles", Label: "Incident roles", Description: "Assign and release incident command roles with durable history.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "task-execution", Label: "Task-led response", Description: "Run dependency-aware incident task graphs and live task updates.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "timeline", Label: "Immutable timeline", Description: "Append-only incident history for evidence and post-incident review.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "stakeholder-updates", Label: "Stakeholder updates", Description: "Generate deterministic status updates and scoped stakeholder status pages.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "approval-gates", Label: "Approval gates", Description: "Gate high-impact incident actions behind persisted approvals.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "pir-evidence", Label: "PIR and evidence", Description: "Generate post-incident reviews and regulator-ready evidence exports.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "mobilization", Label: "Responder mobilization", Description: "Assign roles, notify responders, track acknowledgements, and escalate unanswered mobilization requests.", EntitlementKey: EntitlementMajorIncident, Enabled: active && s.notificationEngine != nil},
			{ID: "integrations", Label: "ITSM and comms integrations", Description: "Configure ServiceNow and Slack connectors, sync incidents, and ingest signed ITSM webhooks.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
			{ID: "command-center", Label: "Command center cockpit", Description: "Coordinate status, severity, roles, timeline, and actions from one incident workspace.", EntitlementKey: EntitlementMajorIncident, Enabled: active},
		},
	}
	return product, nil
}

type DeclareIncidentInput struct {
	Title            string
	Description      string
	Severity         Severity
	DetectedAt       *time.Time
	ImpactedServices []string
	Actor            Actor
}

func (s *Service) DeclareIncident(ctx context.Context, tenantID uuid.UUID, in DeclareIncidentInput) (*Incident, error) {
	if !in.Actor.Can(PermRespondDeclare) {
		return nil, ErrUnauthorized
	}
	inc := &Incident{
		TenantID:         tenantID,
		Title:            in.Title,
		Description:      in.Description,
		Severity:         in.Severity,
		Status:           StatusDeclared,
		DeclaredBy:       in.Actor.UserID,
		DeclaredAt:       s.now(),
		DetectedAt:       in.DetectedAt,
		ImpactedServices: in.ImpactedServices,
	}
	if err := inc.ValidateForCreate(); err != nil {
		return nil, err
	}

	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := s.repo.CreateIncident(ctx, tx, inc); err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: inc.ID,
			ActorID:    in.Actor.UserID,
			OccurredAt: inc.DeclaredAt,
			EventType:  EventIncidentDeclared,
			Payload: map[string]any{
				"reference": inc.Reference,
				"title":     inc.Title,
				"severity":  inc.Severity,
				"status":    inc.Status,
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("incident_id", inc.ID.String()).Str("reference", inc.Reference).Msg("respond incident declared")
	return inc, nil
}

func (s *Service) GetIncident(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*Incident, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var inc *Incident
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		inc, err = s.repo.GetIncident(ctx, tx, tenantID, incidentID)
		return err
	})
	return inc, err
}

func (s *Service) ListIncidents(ctx context.Context, tenantID uuid.UUID, actor Actor, status *Status, severity *Severity, limit, offset int) ([]*Incident, int, error) {
	if !actor.Can(PermRespondRead) {
		return nil, 0, ErrUnauthorized
	}
	if status != nil && !status.Valid() {
		return nil, 0, ErrInvalidStatus
	}
	if severity != nil && !severity.Valid() {
		return nil, 0, ErrInvalidSeverity
	}
	var out []*Incident
	var total int
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		total, err = s.repo.CountIncidents(ctx, tx, tenantID, status, severity)
		if err != nil {
			return err
		}
		out, err = s.repo.ListIncidents(ctx, tx, tenantID, status, severity, limit, offset)
		return err
	})
	return out, total, err
}

type UpdateIncidentInput struct {
	IncidentID       uuid.UUID
	Title            string
	Description      string
	ImpactedServices []string
	ExpectedVersion  int
	Actor            Actor
}

func (s *Service) UpdateIncident(ctx context.Context, tenantID uuid.UUID, in UpdateIncidentInput) (*Incident, error) {
	if !in.Actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	var inc *Incident
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		loaded, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		loaded.Title = strings.TrimSpace(in.Title)
		loaded.Description = strings.TrimSpace(in.Description)
		loaded.ImpactedServices = normalizeServices(in.ImpactedServices)
		if loaded.Title == "" {
			return fmt.Errorf("title is required: %w", ErrValidation)
		}
		if err := s.repo.UpdateIncident(ctx, tx, loaded, in.ExpectedVersion); err != nil {
			return err
		}
		inc = loaded
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: inc.ID,
			ActorID:    in.Actor.UserID,
			OccurredAt: s.now(),
			EventType:  EventIncidentUpdated,
			Payload:    map[string]any{"reference": inc.Reference, "version": inc.RowVersion},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	return inc, nil
}

type ChangeSeverityInput struct {
	IncidentID      uuid.UUID
	Severity        Severity
	ExpectedVersion int
	Actor           Actor
}

func (s *Service) ChangeSeverity(ctx context.Context, tenantID uuid.UUID, in ChangeSeverityInput) (*Incident, error) {
	if !in.Actor.Can(PermRespondSeverity) {
		return nil, ErrUnauthorized
	}
	if !in.Severity.Valid() {
		return nil, ErrInvalidSeverity
	}
	var inc *Incident
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		updated, err := s.repo.UpdateSeverity(ctx, tx, tenantID, in.IncidentID, in.Severity, in.ExpectedVersion)
		if err != nil {
			return err
		}
		inc = updated
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: inc.ID,
			ActorID:    in.Actor.UserID,
			OccurredAt: s.now(),
			EventType:  EventSeverityChanged,
			Payload: map[string]any{
				"reference": inc.Reference,
				"from":      current.Severity,
				"to":        inc.Severity,
				"version":   inc.RowVersion,
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	return inc, nil
}

type TransitionIncidentInput struct {
	IncidentID      uuid.UUID
	To              Status
	ExpectedVersion int
	Actor           Actor
}

func (s *Service) TransitionIncident(ctx context.Context, tenantID uuid.UUID, in TransitionIncidentInput) (*Incident, error) {
	if !in.Actor.Can(PermRespondTransition) {
		return nil, ErrUnauthorized
	}
	var inc *Incident
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		current, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		if err := ValidateTransition(current.Status, in.To); err != nil {
			return err
		}
		at := s.now()
		updated, err := s.repo.UpdateStatus(ctx, tx, tenantID, in.IncidentID, current.Status, in.To, in.ExpectedVersion, at)
		if err != nil {
			return err
		}
		inc = updated
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: inc.ID,
			ActorID:    in.Actor.UserID,
			OccurredAt: at,
			EventType:  EventIncidentTransitioned,
			Payload: map[string]any{
				"reference": inc.Reference,
				"from":      current.Status,
				"to":        inc.Status,
				"version":   inc.RowVersion,
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("incident_id", inc.ID.String()).Str("to", string(inc.Status)).Msg("respond incident status transitioned")
	return inc, nil
}

func (s *Service) RecordTimelineEvent(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, eventType string, payload map[string]any) (*TimelineEvent, error) {
	if !actor.Can(PermRespondTimeline) {
		return nil, ErrUnauthorized
	}
	eventType = strings.TrimSpace(eventType)
	if eventType == "" {
		return nil, ErrTimelineEventEmpty
	}
	ev := &TimelineEvent{
		TenantID:   tenantID,
		IncidentID: incidentID,
		ActorID:    actor.UserID,
		OccurredAt: s.now(),
		EventType:  eventType,
		Payload:    payload,
	}
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.repo.GetIncident(ctx, tx, tenantID, incidentID); err != nil {
			return err
		}
		return s.repo.AppendTimelineEvent(ctx, tx, ev)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(*ev)
	return ev, nil
}

func (s *Service) ListTimelineEvents(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, filter TimelineFilter) ([]TimelineEvent, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var events []TimelineEvent
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		events, err = s.repo.ListTimelineEvents(ctx, tx, tenantID, incidentID, filter)
		return err
	})
	return events, err
}

type CockpitResponse struct {
	Incident               *Incident                      `json:"incident"`
	Roles                  []CockpitRoleAssignment        `json:"roles"`
	Tasks                  []CockpitTaskCard              `json:"tasks"`
	Timeline               []CockpitTimelineItem          `json:"timeline"`
	Integrations           []CockpitIntegrationStatus     `json:"integrations"`
	QuickActions           []QuickAction                  `json:"quick_actions"`
	TimelineStreamURL      string                         `json:"timeline_stream_url,omitempty"`
	ServiceLinks           []CockpitServiceLink           `json:"service_links,omitempty"`
	SeverityRecommendation *CockpitSeverityRecommendation `json:"severity_recommendation,omitempty"`
	StakeholderUpdates     []StakeholderUpdateDispatch    `json:"stakeholder_updates,omitempty"`
	Approvals              []CockpitApprovalGate          `json:"approvals,omitempty"`
	PIR                    *CockpitPIR                    `json:"pir,omitempty"`
	EvidenceExports        []CockpitEvidenceExport        `json:"evidence_exports,omitempty"`
	Capabilities           []ProductCapability            `json:"capabilities,omitempty"`
}

type CockpitTimelineItem struct {
	ID         uuid.UUID `json:"id"`
	EventType  string    `json:"event_type"`
	ActorName  string    `json:"actor_name,omitempty"`
	OccurredAt time.Time `json:"occurred_at"`
	Summary    string    `json:"summary"`
}

type QuickAction struct {
	ID             string         `json:"id"`
	Label          string         `json:"label"`
	Endpoint       string         `json:"endpoint"`
	Method         string         `json:"method"`
	Payload        map[string]any `json:"payload,omitempty"`
	Enabled        bool           `json:"enabled"`
	DisabledReason string         `json:"disabled_reason,omitempty"`
}

type CockpitRoleAssignment struct {
	ID                   uuid.UUID            `json:"id"`
	Role                 IncidentRole         `json:"role"`
	UserID               uuid.UUID            `json:"user_id,omitempty"`
	DisplayName          string               `json:"display_name"`
	AcknowledgementState string               `json:"acknowledgement_state,omitempty"`
	AcknowledgedAt       *time.Time           `json:"acknowledged_at,omitempty"`
	AssignedAt           time.Time            `json:"assigned_at,omitempty"`
	AssignedBy           uuid.UUID            `json:"assigned_by,omitempty"`
	EscalationState      string               `json:"escalation_state,omitempty"`
	Status               RoleAssignmentStatus `json:"status,omitempty"`
}

type CockpitTaskCard struct {
	ID           uuid.UUID        `json:"id"`
	Title        string           `json:"title"`
	Status       string           `json:"status"`
	OwnerName    string           `json:"owner_name,omitempty"`
	OwnerID      *uuid.UUID       `json:"owner_id,omitempty"`
	Order        int              `json:"order,omitempty"`
	DueAt        *time.Time       `json:"due_at,omitempty"`
	BlockedBy    []uuid.UUID      `json:"blocked_by,omitempty"`
	Dependencies []uuid.UUID      `json:"dependencies,omitempty"`
	StartedAt    *time.Time       `json:"started_at,omitempty"`
	CompletedAt  *time.Time       `json:"completed_at,omitempty"`
	TaskType     IncidentTaskType `json:"task_type,omitempty"`
}

type CockpitIntegrationStatus struct {
	Provider          string     `json:"provider"`
	ConnectorID       *uuid.UUID `json:"connector_id,omitempty"`
	ExternalReference string     `json:"external_reference,omitempty"`
	SyncState         string     `json:"sync_state"`
	LastSyncedAt      *time.Time `json:"last_synced_at,omitempty"`
	LastError         string     `json:"last_error,omitempty"`
	TicketURL         string     `json:"ticket_url,omitempty"`
	ChannelURL        string     `json:"channel_url,omitempty"`
}

type CockpitServiceLink struct {
	ServiceID     string   `json:"service_id"`
	Name          string   `json:"name,omitempty"`
	OwnerName     string   `json:"owner_name,omitempty"`
	OwnerEmail    string   `json:"owner_email,omitempty"`
	Tier          string   `json:"tier,omitempty"`
	Dependencies  []string `json:"dependencies,omitempty"`
	MetadataState string   `json:"metadata_state"`
}

type CockpitSeverityRecommendation struct {
	RecommendedSeverity Severity                      `json:"recommended_severity"`
	Rationale           []string                      `json:"rationale"`
	Inputs              IncidentImpactAssessmentInput `json:"inputs"`
	ComputedAt          time.Time                     `json:"computed_at"`
}

type CockpitApprovalGate struct {
	ID             uuid.UUID  `json:"id"`
	ActionKey      string     `json:"action_key"`
	Title          string     `json:"title"`
	Status         string     `json:"status"`
	RequestedBy    uuid.UUID  `json:"requested_by,omitempty"`
	RequestedAt    time.Time  `json:"requested_at,omitempty"`
	DecidedBy      *uuid.UUID `json:"decided_by,omitempty"`
	DecidedAt      *time.Time `json:"decided_at,omitempty"`
	DecisionReason string     `json:"decision_reason,omitempty"`
}

type CockpitPIR struct {
	ID                  uuid.UUID              `json:"id"`
	Status              PIRStatus              `json:"status"`
	Summary             string                 `json:"summary,omitempty"`
	ContributingFactors string                 `json:"contributing_factors,omitempty"`
	LessonsLearned      string                 `json:"lessons_learned,omitempty"`
	MTTRSeconds         int                    `json:"mttr_seconds,omitempty"`
	MTTRTargetSeconds   int                    `json:"mttr_target_seconds,omitempty"`
	ActionItems         []CockpitPIRActionItem `json:"action_items,omitempty"`
	SignedOffBy         *uuid.UUID             `json:"signed_off_by,omitempty"`
	SignedOffAt         *time.Time             `json:"signed_off_at,omitempty"`
	GeneratedAt         time.Time              `json:"generated_at,omitempty"`
	UpdatedAt           time.Time              `json:"updated_at,omitempty"`
}

type CockpitPIRActionItem struct {
	ID        uuid.UUID  `json:"id"`
	Title     string     `json:"title"`
	OwnerName string     `json:"owner_name,omitempty"`
	DueAt     *time.Time `json:"due_at,omitempty"`
	Status    string     `json:"status"`
}

type CockpitEvidenceExport struct {
	ID          uuid.UUID      `json:"id"`
	Format      EvidenceFormat `json:"format"`
	Status      string         `json:"status"`
	DownloadURL string         `json:"download_url,omitempty"`
	GeneratedAt time.Time      `json:"generated_at,omitempty"`
	GeneratedBy uuid.UUID      `json:"generated_by,omitempty"`
}

type StakeholderToken struct {
	ID           uuid.UUID  `json:"id"`
	TenantID     uuid.UUID  `json:"tenant_id"`
	IncidentID   uuid.UUID  `json:"incident_id"`
	TokenHash    []byte     `json:"-"`
	Scope        string     `json:"scope"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	NextUpdateAt *time.Time `json:"next_update_at,omitempty"`
	RevokedAt    *time.Time `json:"revoked_at,omitempty"`
	CreatedBy    uuid.UUID  `json:"created_by"`
	CreatedAt    time.Time  `json:"created_at"`
}

type CreateStakeholderTokenInput struct {
	IncidentID   uuid.UUID
	ExpiresAt    *time.Time
	NextUpdateAt *time.Time
	Actor        Actor
}

type StakeholderTokenResponse struct {
	ID           uuid.UUID  `json:"id"`
	IncidentID   uuid.UUID  `json:"incident_id"`
	Token        string     `json:"token"`
	URLPath      string     `json:"url_path"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	NextUpdateAt *time.Time `json:"next_update_at,omitempty"`
}

type StakeholderStatus struct {
	IncidentReference string     `json:"incident_reference"`
	Title             string     `json:"title"`
	Severity          Severity   `json:"severity"`
	Status            Status     `json:"status"`
	ImpactSummary     string     `json:"impact_summary"`
	CurrentPhase      string     `json:"current_phase"`
	NextUpdateAt      *time.Time `json:"next_update_at,omitempty"`
	LastUpdateAt      *time.Time `json:"last_update_at,omitempty"`
}

func (s *Service) Cockpit(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*CockpitResponse, error) {
	actor, err := s.ActorForIncident(ctx, tenantID, incidentID, actor)
	if err != nil {
		return nil, err
	}
	incident, err := s.GetIncident(ctx, tenantID, incidentID, actor)
	if err != nil {
		return nil, err
	}
	events, err := s.ListTimelineEvents(ctx, tenantID, incidentID, actor, TimelineFilter{Limit: 100})
	if err != nil {
		return nil, err
	}
	timeline := make([]CockpitTimelineItem, 0, len(events))
	for _, event := range events {
		timeline = append(timeline, CockpitTimelineItem{
			ID:         event.ID,
			EventType:  event.EventType,
			ActorName:  event.ActorID.String(),
			OccurredAt: event.OccurredAt,
			Summary:    summarizeEvent(event),
		})
	}
	roles, err := s.ListIncidentRoles(ctx, tenantID, incidentID, actor)
	if err != nil {
		return nil, err
	}
	notificationDispatches, err := s.ListIncidentNotificationDispatches(ctx, tenantID, incidentID, actor, 100)
	if err != nil {
		return nil, err
	}
	taskGraph, err := s.ListIncidentTasks(ctx, tenantID, incidentID, actor)
	if err != nil {
		return nil, err
	}
	serviceLinks, err := s.CockpitServiceLinks(ctx, tenantID, incident, actor)
	if err != nil {
		return nil, err
	}
	latestDecision, err := s.CockpitSeverityRecommendation(ctx, tenantID, incidentID, actor)
	if err != nil && !errors.Is(err, ErrIncidentNotFound) {
		return nil, err
	}
	stakeholderUpdates, err := s.ListStakeholderUpdates(ctx, tenantID, incidentID, actor, 10)
	if err != nil {
		return nil, err
	}
	approvals, err := s.ListApprovals(ctx, tenantID, incidentID, actor)
	if err != nil {
		return nil, err
	}
	pir, err := s.GetPIR(ctx, tenantID, incidentID, actor)
	if err != nil && !errors.Is(err, ErrPIRNotFound) {
		return nil, err
	}
	evidenceExports, err := s.ListEvidenceExports(ctx, tenantID, incidentID, actor, 10)
	if err != nil {
		return nil, err
	}
	integrations, err := s.ListIncidentIntegrationStatuses(ctx, tenantID, incidentID, actor, 10)
	if err != nil {
		return nil, err
	}
	return &CockpitResponse{
		Incident:               incident,
		Roles:                  cockpitRoleAssignments(roles, notificationDispatches),
		Tasks:                  cockpitTaskCards(taskGraph),
		Timeline:               timeline,
		Integrations:           integrations,
		QuickActions:           quickActionsForIncident(incident, pir),
		TimelineStreamURL:      fmt.Sprintf("/api/v1/respond/incidents/%s/timeline/stream", incident.ID),
		ServiceLinks:           serviceLinks,
		SeverityRecommendation: latestDecision,
		StakeholderUpdates:     stakeholderUpdates,
		Approvals:              cockpitApprovalGates(approvals),
		PIR:                    cockpitPIR(pir),
		EvidenceExports:        cockpitEvidenceExports(evidenceExports),
	}, nil
}

func (s *Service) CreateStakeholderToken(ctx context.Context, tenantID uuid.UUID, in CreateStakeholderTokenInput) (*StakeholderTokenResponse, error) {
	if !in.Actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	rawToken, tokenHash, err := newStakeholderTokenSecret()
	if err != nil {
		return nil, err
	}

	token := &StakeholderToken{
		TenantID:     tenantID,
		IncidentID:   in.IncidentID,
		TokenHash:    tokenHash,
		Scope:        "status",
		ExpiresAt:    in.ExpiresAt,
		NextUpdateAt: in.NextUpdateAt,
		CreatedBy:    in.Actor.UserID,
		CreatedAt:    s.now(),
	}
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		return s.repo.CreateStakeholderToken(ctx, tx, token)
	})
	if err != nil {
		return nil, err
	}
	return &StakeholderTokenResponse{
		ID:           token.ID,
		IncidentID:   token.IncidentID,
		Token:        rawToken,
		URLPath:      fmt.Sprintf("/respond/stakeholder/%s", rawToken),
		ExpiresAt:    token.ExpiresAt,
		NextUpdateAt: token.NextUpdateAt,
	}, nil
}

func (s *Service) StakeholderStatusByToken(ctx context.Context, token string) (*StakeholderStatus, error) {
	hash, err := hashStakeholderToken(strings.TrimSpace(token))
	if err != nil {
		return nil, err
	}
	var status *StakeholderStatus
	err = s.tx.RunSystemRead(ctx, func(tx DBTX) error {
		var err error
		status, err = s.repo.GetStakeholderStatusByTokenHash(ctx, tx, hash, s.now())
		return err
	})
	return status, err
}

func newStakeholderTokenSecret() (string, []byte, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", nil, fmt.Errorf("respond: generate stakeholder token: %w", err)
	}
	token := base64.RawURLEncoding.EncodeToString(raw[:])
	hash, err := hashStakeholderToken(token)
	if err != nil {
		return "", nil, err
	}
	return token, hash, nil
}

func hashStakeholderToken(token string) ([]byte, error) {
	if token == "" {
		return nil, ErrStakeholderNotFound
	}
	sum := sha256.Sum256([]byte(token))
	return sum[:], nil
}

func summarizeEvent(event TimelineEvent) string {
	switch event.EventType {
	case EventIncidentDeclared:
		return "Incident declared"
	case EventIncidentTransitioned:
		return fmt.Sprintf("Status changed from %v to %v", event.Payload["from"], event.Payload["to"])
	case EventSeverityChanged:
		return fmt.Sprintf("Severity changed from %v to %v", event.Payload["from"], event.Payload["to"])
	default:
		return strings.ReplaceAll(event.EventType, "_", " ")
	}
}

func quickActionsForIncident(incident *Incident, pir *IncidentPIR) []QuickAction {
	actions := make([]QuickAction, 0, 1)
	if next := nextStatus(incident.Status); next != "" {
		enabled := true
		disabledReason := ""
		if next == StatusClosed && !pirSignedOff(pir) {
			enabled = false
			disabledReason = "PIR sign-off is required before closing this incident."
		}
		actions = append(actions, QuickAction{
			ID:             "advance-status",
			Label:          fmt.Sprintf("Advance to %s", next),
			Endpoint:       fmt.Sprintf("/api/v1/respond/incidents/%s/transitions", incident.ID),
			Method:         "POST",
			Enabled:        enabled,
			DisabledReason: disabledReason,
			Payload: map[string]any{
				"to":               next,
				"expected_version": incident.RowVersion,
			},
		})
	}
	return actions
}

func pirSignedOff(pir *IncidentPIR) bool {
	return pir != nil && pir.Status == PIRStatusSignedOff && pir.SignedOffBy != nil && pir.SignedOffAt != nil
}

func nextStatus(status Status) Status {
	next := TransitionTable[status]
	if len(next) == 0 {
		return ""
	}
	return next[0]
}

func mapServiceError(err error) (int, string, string) {
	switch {
	case err == nil:
		return 0, "", ""
	case errors.Is(err, ErrIncidentNotFound):
		return 404, "not_found", "resource not found"
	case errors.Is(err, ErrInvalidSeverity), errors.Is(err, ErrInvalidStatus), errors.Is(err, ErrValidation):
		return 400, "bad_request", err.Error()
	case errors.Is(err, ErrInvalidTransition):
		return 409, "invalid_transition", err.Error()
	case errors.Is(err, ErrVersionConflict):
		return 409, "version_conflict", "the incident was modified by another actor; reload and retry"
	default:
		return 500, "internal_error", "respond request failed"
	}
}

var _ respondService = (*Service)(nil)
