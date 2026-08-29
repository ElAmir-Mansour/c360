package enroll

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/siem/sources"
)

// AgentLifecycleStore is the DR persistence contract needed by the SIEM
// enrollment service's SourcesReader interface.
type AgentLifecycleStore interface {
	GetAgent(ctx context.Context, tenantID, agentID uuid.UUID) (*model.DRAgent, error)
	SetAgentCert(ctx context.Context, tenantID, agentID uuid.UUID, status, thumbprint, serial string, issuedAt, expiresAt time.Time) error
}

// AgentCredentialWriter optionally stores issued certificate material for
// environments that maintain an agent credentials table. The default adapter
// behavior is to skip credential persistence because the dr_agent table only
// stores certificate metadata.
type AgentCredentialWriter interface {
	InsertAgentCredentials(ctx context.Context, credentials AgentCredentials) error
}

// AgentRevoker optionally marks a prior DR agent certificate as revoked.
type AgentRevoker interface {
	MarkAgentCertRevoked(ctx context.Context, agentID uuid.UUID, reason string) error
}

// AgentCredentials is the DR-shaped certificate material emitted by the SIEM
// enrollment service. The private key never enters the service in the CSR flow.
type AgentCredentials struct {
	AgentID       uuid.UUID
	VaultPKIMount string
	VaultKeyRef   string
	CertPEM       string
	CAChainPEM    string
}

// SourceAdapter makes dr_agent rows look like SIEM sources to the reused
// siem/sources/enroll.Service.
type SourceAdapter struct {
	store      AgentLifecycleStore
	credential AgentCredentialWriter
	revoker    AgentRevoker
}

// NewSourceAdapter constructs the adapter. credential and revoker are optional.
func NewSourceAdapter(store AgentLifecycleStore, credential AgentCredentialWriter, revoker AgentRevoker) *SourceAdapter {
	return &SourceAdapter{store: store, credential: credential, revoker: revoker}
}

// GetByID implements siem/sources/enroll.SourcesReader.
func (a *SourceAdapter) GetByID(ctx context.Context, tenantID, id uuid.UUID) (*sources.Source, error) {
	if a == nil || a.store == nil {
		return nil, ErrNotConfigured
	}
	agent, err := a.store.GetAgent(ctx, tenantID, id)
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return nil, sources.ErrNotFound
		}
		return nil, err
	}
	return sourceFromAgent(agent)
}

// AttachCert implements siem/sources/enroll.SourcesReader.
func (a *SourceAdapter) AttachCert(ctx context.Context, tenantID, id uuid.UUID, thumbprint, serial string, issuedAt, expiresAt time.Time, status sources.Status) (*sources.Source, error) {
	if a == nil || a.store == nil {
		return nil, ErrNotConfigured
	}
	if err := a.store.SetAgentCert(ctx, tenantID, id, agentStatusFromSource(status), thumbprint, serial, issuedAt, expiresAt); err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return nil, sources.ErrNotFound
		}
		return nil, err
	}
	return a.GetByID(ctx, tenantID, id)
}

// InsertCredentials implements siem/sources/enroll.SourcesReader.
func (a *SourceAdapter) InsertCredentials(ctx context.Context, sc sources.SourceCredentials) error {
	if a == nil {
		return ErrNotConfigured
	}
	if a.credential == nil {
		return nil
	}
	return a.credential.InsertAgentCredentials(ctx, AgentCredentials{
		AgentID:       sc.SourceID,
		VaultPKIMount: sc.VaultPKIMount,
		VaultKeyRef:   sc.VaultKeyRef,
		CertPEM:       sc.CertPEM,
		CAChainPEM:    sc.CAChainPEM,
	})
}

// MarkCertRevoked implements siem/sources/enroll.SourcesReader.
func (a *SourceAdapter) MarkCertRevoked(ctx context.Context, id uuid.UUID, reason string) error {
	if a == nil {
		return ErrNotConfigured
	}
	if a.revoker == nil {
		return nil
	}
	return a.revoker.MarkAgentCertRevoked(ctx, id, reason)
}

func sourceFromAgent(agent *model.DRAgent) (*sources.Source, error) {
	if agent == nil {
		return nil, sources.ErrNotFound
	}
	id, err := uuid.Parse(agent.ID)
	if err != nil {
		return nil, fmt.Errorf("%w: stored agent id is not a uuid", sources.ErrValidation)
	}
	tenantID, err := uuid.Parse(agent.TenantID)
	if err != nil {
		return nil, fmt.Errorf("%w: stored tenant id is not a uuid", sources.ErrValidation)
	}
	src := &sources.Source{
		ID:             id,
		TenantID:       tenantID,
		Status:         sourceStatusFromAgent(agent.Status),
		MTLSThumbprint: stringValue(agent.MTLSThumbprint),
		CertSerial:     stringValue(agent.CertSerial),
		CertIssuedAt:   agent.CertIssuedAt,
		CertExpiresAt:  agent.CertExpiresAt,
		CertRevokedAt:  agent.CertRevokedAt,
	}
	if agent.CertRevokedReason != nil {
		src.CertRevokedReason = *agent.CertRevokedReason
	}
	return src, nil
}

func sourceStatusFromAgent(status string) sources.Status {
	switch status {
	case model.AgentStatusProvisioning:
		return sources.StatusProvisioning
	case model.AgentStatusActive:
		return sources.StatusActive
	case model.AgentStatusSilent:
		return sources.StatusSilent
	case model.AgentStatusRotating:
		return sources.StatusRotating
	case model.AgentStatusRevoked:
		return sources.StatusDisabled
	default:
		return sources.StatusError
	}
}

func agentStatusFromSource(status sources.Status) string {
	switch status {
	case sources.StatusProvisioning:
		return model.AgentStatusProvisioning
	case sources.StatusActive:
		return model.AgentStatusActive
	case sources.StatusSilent:
		return model.AgentStatusSilent
	case sources.StatusRotating:
		return model.AgentStatusRotating
	default:
		return string(status)
	}
}

func stringValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
