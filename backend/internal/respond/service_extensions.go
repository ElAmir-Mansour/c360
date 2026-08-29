package respond

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const (
	EventRoleAssigned = "respond.role.assigned"
	EventRoleReleased = "respond.role.released"
)

func (s *Service) ActorForIncident(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (Actor, error) {
	if actor.UserID == uuid.Nil {
		return actor, nil
	}
	var roles []RoleAssignment
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		roles, err = s.repo.ListActiveRoleAssignments(ctx, tx, tenantID, incidentID)
		return err
	})
	if err != nil {
		return actor, err
	}
	seen := make(map[IncidentRole]struct{}, len(actor.IncidentRoles)+len(roles))
	enriched := append([]IncidentRole(nil), actor.IncidentRoles...)
	for _, role := range actor.IncidentRoles {
		seen[role] = struct{}{}
	}
	for _, assignment := range roles {
		if assignment.ResponderID != actor.UserID {
			continue
		}
		if _, ok := seen[assignment.Role]; ok {
			continue
		}
		seen[assignment.Role] = struct{}{}
		enriched = append(enriched, assignment.Role)
	}
	actor.IncidentRoles = enriched
	return actor, nil
}

func (s *Service) ListIncidentRoles(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) ([]RoleAssignment, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var roles []RoleAssignment
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		roles, err = s.repo.ListActiveRoleAssignments(ctx, tx, tenantID, incidentID)
		return err
	})
	return roles, err
}

func (s *Service) AssignRole(ctx context.Context, tenantID uuid.UUID, actor Actor, in AssignRoleInput) (*RoleAssignment, error) {
	if !actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	in.TenantID = tenantID
	in.AssignedBy = actor.UserID
	if in.AssignedAt.IsZero() {
		in.AssignedAt = s.now()
	}
	var assignment *RoleAssignment
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID); err != nil {
			return err
		}
		var err error
		assignment, err = s.repo.AssignIncidentRole(ctx, tx, in)
		if err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: in.IncidentID,
			ActorID:    actor.UserID,
			OccurredAt: assignment.AssignedAt,
			EventType:  EventRoleAssigned,
			Payload: map[string]any{
				"assignment_id": assignment.ID.String(),
				"role":          assignment.Role,
				"responder_id":  assignment.ResponderID.String(),
				"source":        assignment.Source,
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	return assignment, nil
}

func (s *Service) ReleaseRole(ctx context.Context, tenantID uuid.UUID, actor Actor, in ReleaseRoleInput) (*RoleAssignment, error) {
	if !actor.Can(PermRespondUpdate) {
		return nil, ErrUnauthorized
	}
	in.TenantID = tenantID
	in.ReleasedBy = actor.UserID
	if in.ReleasedAt.IsZero() {
		in.ReleasedAt = s.now()
	}
	var assignment *RoleAssignment
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		assignment, err = s.repo.ReleaseIncidentRole(ctx, tx, in)
		if err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: in.IncidentID,
			ActorID:    actor.UserID,
			OccurredAt: in.ReleasedAt,
			EventType:  EventRoleReleased,
			Payload: map[string]any{
				"assignment_id":  assignment.ID.String(),
				"role":           assignment.Role,
				"responder_id":   assignment.ResponderID.String(),
				"release_reason": assignment.ReleaseReason,
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	return assignment, nil
}

func (s *Service) ListApprovals(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) ([]IncidentApproval, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var approvals []IncidentApproval
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		approvals, err = s.repo.ListIncidentApprovals(ctx, tx, tenantID, incidentID)
		return err
	})
	return approvals, err
}

func (s *Service) ListStakeholderUpdates(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, limit int) ([]StakeholderUpdateDispatch, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var updates []StakeholderUpdateDispatch
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		updates, err = s.repo.ListStakeholderUpdateDispatches(ctx, tx, tenantID, incidentID, limit)
		return err
	})
	return updates, err
}

func (s *Service) ListEvidenceExports(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, limit int) ([]EvidenceExport, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var exports []EvidenceExport
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		exports, err = s.repo.ListEvidenceExports(ctx, tx, tenantID, incidentID, limit)
		return err
	})
	return exports, err
}

func (s *Service) ListIncidentIntegrationStatuses(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor, limit int) ([]CockpitIntegrationStatus, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var links []IntegrationExternalLink
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		links, err = s.repo.ListIntegrationLinksForIncident(ctx, tx, tenantID, incidentID, limit)
		return err
	})
	if err != nil {
		return nil, err
	}
	statuses := make([]CockpitIntegrationStatus, 0, len(links))
	for _, link := range links {
		connectorID := link.ConnectorID
		status := CockpitIntegrationStatus{
			Provider:          string(link.Provider),
			ConnectorID:       &connectorID,
			ExternalReference: integrationExternalReference(link),
			SyncState:         integrationSyncState(link),
			LastSyncedAt:      link.LastSyncedAt,
			LastError:         link.SyncError,
		}
		switch link.Provider {
		case IntegrationProviderSlack:
			status.ChannelURL = link.ExternalURL
		default:
			status.TicketURL = link.ExternalURL
		}
		statuses = append(statuses, status)
	}
	return statuses, nil
}

func (s *Service) CockpitServiceLinks(ctx context.Context, tenantID uuid.UUID, incident *Incident, actor Actor) ([]CockpitServiceLink, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	if incident == nil {
		return nil, fmt.Errorf("incident is required: %w", ErrValidation)
	}
	var services []ServiceMetadata
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		services, err = s.repo.ListIncidentAffectedServices(ctx, tx, tenantID, incident.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	byKey := make(map[string]ServiceMetadata, len(services))
	for _, service := range services {
		byKey[service.Key] = service
	}
	links := make([]CockpitServiceLink, 0, len(incident.ImpactedServices))
	for _, serviceID := range incident.ImpactedServices {
		key := strings.TrimSpace(serviceID)
		if key == "" {
			continue
		}
		if service, ok := byKey[key]; ok {
			deps := make([]string, 0, len(service.Dependencies))
			for _, dep := range service.Dependencies {
				deps = append(deps, dep.ServiceKey)
			}
			ownerName := ""
			if len(service.Owners) > 0 {
				ownerName = strings.Join(service.Owners, ", ")
			}
			links = append(links, CockpitServiceLink{
				ServiceID:     service.Key,
				Name:          service.Name,
				OwnerName:     ownerName,
				OwnerEmail:    "",
				Tier:          string(service.Tier),
				Dependencies:  deps,
				MetadataState: "resolved",
			})
			continue
		}
		links = append(links, CockpitServiceLink{
			ServiceID:     key,
			Name:          key,
			MetadataState: "unresolved",
		})
	}
	return links, nil
}

func integrationExternalReference(link IntegrationExternalLink) string {
	if strings.TrimSpace(link.ExternalKey) != "" {
		return link.ExternalKey
	}
	return link.ExternalID
}

func integrationSyncState(link IntegrationExternalLink) string {
	if strings.TrimSpace(link.SyncError) != "" {
		return "failed"
	}
	if link.LastSyncedAt != nil {
		return "synced"
	}
	return "linked"
}

func (s *Service) CockpitSeverityRecommendation(ctx context.Context, tenantID, incidentID uuid.UUID, actor Actor) (*CockpitSeverityRecommendation, error) {
	decision, err := s.LatestSeverityDecision(ctx, tenantID, incidentID, actor)
	if err != nil {
		return nil, err
	}
	var assessment *IncidentImpactAssessment
	err = s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		assessment, err = s.repo.GetImpactAssessment(ctx, tx, tenantID, decision.ImpactAssessmentID)
		return err
	})
	if err != nil {
		return nil, err
	}
	rec, err := RecommendSeverity(IncidentImpactAssessmentInput{
		UserScope:           assessment.UserScope,
		BusinessCriticality: assessment.BusinessCriticality,
		RevenueImpact:       assessment.RevenueImpact,
		RegulatoryExposure:  assessment.RegulatoryExposure,
		AffectedServiceKeys: assessment.AffectedServiceKeys,
		Notes:               assessment.Notes,
	})
	if err != nil {
		return nil, err
	}
	return &CockpitSeverityRecommendation{
		RecommendedSeverity: rec.Severity,
		Rationale:           rec.Reasons,
		Inputs: IncidentImpactAssessmentInput{
			UserScope:           assessment.UserScope,
			BusinessCriticality: assessment.BusinessCriticality,
			RevenueImpact:       assessment.RevenueImpact,
			RegulatoryExposure:  assessment.RegulatoryExposure,
			AffectedServiceKeys: assessment.AffectedServiceKeys,
			Notes:               assessment.Notes,
		},
		ComputedAt: decision.DecidedAt,
	}, nil
}

func cockpitRoleAssignments(assignments []RoleAssignment, dispatches []NotificationDispatch) []CockpitRoleAssignment {
	latestByAssignment := latestNotificationDispatchByAssignment(dispatches)
	out := make([]CockpitRoleAssignment, 0, len(assignments))
	for _, assignment := range assignments {
		displayName := assignment.ResponderID.String()
		var ackState, escalationState string
		var acknowledgedAt *time.Time
		if dispatch, ok := latestByAssignment[assignment.ID]; ok {
			ackState = string(dispatch.AckState)
			escalationState = string(dispatch.EscalationState)
			acknowledgedAt = dispatch.AcknowledgedAt
		}
		out = append(out, CockpitRoleAssignment{
			ID:                   assignment.ID,
			Role:                 assignment.Role,
			UserID:               assignment.ResponderID,
			DisplayName:          displayName,
			AcknowledgementState: ackState,
			AcknowledgedAt:       acknowledgedAt,
			AssignedAt:           assignment.AssignedAt,
			AssignedBy:           assignment.AssignedBy,
			EscalationState:      escalationState,
			Status:               assignment.Status,
		})
	}
	return out
}

func latestNotificationDispatchByAssignment(dispatches []NotificationDispatch) map[uuid.UUID]NotificationDispatch {
	out := make(map[uuid.UUID]NotificationDispatch)
	for _, dispatch := range dispatches {
		if dispatch.RoleAssignmentID == nil {
			continue
		}
		existing, ok := out[*dispatch.RoleAssignmentID]
		if !ok || dispatch.CreatedAt.After(existing.CreatedAt) {
			out[*dispatch.RoleAssignmentID] = dispatch
		}
	}
	return out
}

func cockpitTaskCards(graph *IncidentTaskGraph) []CockpitTaskCard {
	if graph == nil {
		return []CockpitTaskCard{}
	}
	out := make([]CockpitTaskCard, 0, len(graph.Tasks))
	for _, task := range graph.Tasks {
		ownerName := ""
		if task.OwnerID != nil && *task.OwnerID != uuid.Nil {
			ownerName = task.OwnerID.String()
		} else if task.OwnerRole != "" {
			ownerName = string(task.OwnerRole)
		} else if task.Team != "" {
			ownerName = task.Team
		}
		out = append(out, CockpitTaskCard{
			ID:           task.ID,
			Title:        task.Title,
			Status:       cockpitTaskStatus(task.Status),
			OwnerName:    ownerName,
			OwnerID:      task.OwnerID,
			Order:        task.Position,
			DueAt:        task.DueAt,
			BlockedBy:    blockedByForTask(task, graph.Progress.BlockedTasks),
			Dependencies: task.Dependencies,
			StartedAt:    task.StartedAt,
			CompletedAt:  task.FinishedAt,
			TaskType:     task.TaskType,
		})
	}
	return out
}

func cockpitTaskStatus(status IncidentTaskStatus) string {
	switch status {
	case TaskStatusRunnable:
		return "ready"
	case TaskStatusRunning:
		return "in_progress"
	case TaskStatusComplete:
		return "completed"
	case TaskStatusSkipped:
		return "cancelled"
	default:
		return string(status)
	}
}

func blockedByForTask(task IncidentTask, blocked []uuid.UUID) []uuid.UUID {
	for _, id := range blocked {
		if id == task.ID {
			return task.Dependencies
		}
	}
	return nil
}

func cockpitApprovalGates(approvals []IncidentApproval) []CockpitApprovalGate {
	out := make([]CockpitApprovalGate, 0, len(approvals))
	for _, approval := range approvals {
		title := strings.TrimSpace(approval.ActionKey)
		if title == "" {
			title = string(approval.Action)
		}
		if raw, ok := approval.Metadata["title"].(string); ok && strings.TrimSpace(raw) != "" {
			title = strings.TrimSpace(raw)
		}
		out = append(out, CockpitApprovalGate{
			ID:             approval.ID,
			ActionKey:      approval.ActionKey,
			Title:          title,
			Status:         string(approval.Decision),
			RequestedBy:    approval.RequestedBy,
			RequestedAt:    approval.RequestedAt,
			DecidedBy:      approval.DecidedBy,
			DecidedAt:      approval.DecidedAt,
			DecisionReason: approval.DecisionReason,
		})
	}
	return out
}

func cockpitPIR(pir *IncidentPIR) *CockpitPIR {
	if pir == nil {
		return nil
	}
	items := make([]CockpitPIRActionItem, 0, len(pir.ActionItems))
	for _, item := range pir.ActionItems {
		owner := ""
		if item.OwnerID != nil && *item.OwnerID != uuid.Nil {
			owner = item.OwnerID.String()
		}
		items = append(items, CockpitPIRActionItem{
			ID:        item.ID,
			Title:     item.Title,
			OwnerName: owner,
			DueAt:     item.DueAt,
			Status:    string(item.Status),
		})
	}
	return &CockpitPIR{
		ID:                  pir.ID,
		Status:              pir.Status,
		Summary:             pir.Summary,
		ContributingFactors: strings.Join(pir.ContributingFactors, "\n"),
		LessonsLearned:      strings.Join(pir.LessonsLearned, "\n"),
		MTTRSeconds:         pir.MTTR.ActualSeconds,
		MTTRTargetSeconds:   pir.MTTR.TargetSeconds,
		ActionItems:         items,
		SignedOffBy:         pir.SignedOffBy,
		SignedOffAt:         pir.SignedOffAt,
		GeneratedAt:         pir.GeneratedAt,
		UpdatedAt:           pir.UpdatedAt,
	}
}

func cockpitEvidenceExports(exports []EvidenceExport) []CockpitEvidenceExport {
	out := make([]CockpitEvidenceExport, 0, len(exports))
	for _, export := range exports {
		out = append(out, CockpitEvidenceExport{
			ID:          export.ID,
			Format:      export.Format,
			Status:      "generated",
			GeneratedAt: export.GeneratedAt,
			GeneratedBy: export.GeneratedBy,
		})
	}
	return out
}
