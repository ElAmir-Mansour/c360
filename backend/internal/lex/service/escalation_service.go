package service

import (
	"context"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// EscalationRecipientResolver is the narrow seam the EscalationService depends on
// to resolve the L1/L2/L3 ladder. It is satisfied by *OrgEntityService so the SLA
// module reuses the org-entity registry (CAP-017/018/019) without importing its
// concrete repository.
type EscalationRecipientResolver interface {
	ResolveEscalationRecipients(ctx context.Context, tenantID, entityID uuid.UUID) (*model.EscalationLadder, error)
}

// EscalationService resolves SLA escalation recipients from the org-entity
// hierarchy. It is a thin coordinator: the L1 section_supervisor / L2
// department_manager / L3 shared_services_manager ladder is materialised by the
// org-entity registry; this service maps an SLA rung level to the recipient set
// the breach/escalation machine and notification outbox consume.
type EscalationService struct {
	resolver EscalationRecipientResolver
}

func NewEscalationService(resolver EscalationRecipientResolver) *EscalationService {
	return &EscalationService{resolver: resolver}
}

// ResolveLadder returns the full L1/L2/L3 escalation ladder for an org entity.
func (s *EscalationService) ResolveLadder(ctx context.Context, tenantID, entityID uuid.UUID) (*model.EscalationLadder, error) {
	if s == nil || s.resolver == nil {
		return nil, internalError("escalation resolver is not configured", nil)
	}
	if entityID == uuid.Nil {
		return nil, validationError("entity_id is required", map[string]string{"entity_id": "required"})
	}
	return s.resolver.ResolveEscalationRecipients(ctx, tenantID, entityID)
}

// RecipientForLevel returns the recipient bound to the requested rung (1/2/3), or
// false when the ladder has no coverage for that level.
func (s *EscalationService) RecipientForLevel(ladder *model.EscalationLadder, level int) (model.EscalationRecipient, bool) {
	if ladder == nil {
		return model.EscalationRecipient{}, false
	}
	for _, recipient := range ladder.Recipients {
		if recipient.Level == level {
			return recipient, true
		}
	}
	return model.EscalationRecipient{}, false
}
