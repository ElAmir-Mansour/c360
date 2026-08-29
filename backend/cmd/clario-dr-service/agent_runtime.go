package main

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/framestore"
	dringest "github.com/clario360/platform/internal/dr/ingest"
	"github.com/clario360/platform/internal/dr/model"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/siem/sources"
	siemenroll "github.com/clario360/platform/internal/siem/sources/enroll"
	"github.com/clario360/platform/internal/siem/sources/pki"
	siemcrypto "github.com/clario360/platform/internal/siem/store/crypto"
	"github.com/clario360/platform/internal/vault"
)

// drAgentRuntime is the DR agent lifecycle adapter shared by enrollment and
// mTLS ingest identity lookup.
type drAgentRuntime struct {
	pool *pgxpool.Pool
	repo *drrepo.Repository
}

func (s drAgentRuntime) GetAgent(ctx context.Context, tenantID, agentID uuid.UUID) (*model.DRAgent, error) {
	var agent *model.DRAgent
	err := database.RunReadWithTenant(ctx, s.pool, tenantID, func(tx pgx.Tx) error {
		var err error
		agent, err = s.repo.GetAgent(ctx, tx, tenantID.String(), agentID.String())
		return err
	})
	return agent, err
}

func (s drAgentRuntime) SetAgentCert(ctx context.Context, tenantID, agentID uuid.UUID, status, thumbprint, serial string, issuedAt, expiresAt time.Time) error {
	return database.RunWithTenant(ctx, s.pool, tenantID, func(tx pgx.Tx) error {
		return s.repo.SetAgentCert(ctx, tx, tenantID.String(), agentID.String(), status, thumbprint, serial, issuedAt, expiresAt)
	})
}

func (s drAgentRuntime) GetByThumbprint(ctx context.Context, thumbprint string) (*model.DRAgent, error) {
	var agent *model.DRAgent
	err := database.RunSystemRead(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		agent, err = s.repo.GetAgentByThumbprint(ctx, tx, thumbprint)
		return err
	})
	return agent, err
}

func (s drAgentRuntime) MarkAgentCertRevoked(ctx context.Context, agentID uuid.UUID, reason string) error {
	return database.RunSystemTx(ctx, s.pool, func(tx pgx.Tx) error {
		return s.repo.MarkAgentCertRevoked(ctx, tx, agentID.String(), reason)
	})
}

// durableDRTokenManager wraps the SIEM token manager and writes every issued
// JTI into dr_db, giving DR enrollment a durable replay backstop in addition to
// Redis's atomic claim.
type durableDRTokenManager struct {
	tokens *siemenroll.TokenManager
	store  *drEnrollmentTokenStore
}

func (m durableDRTokenManager) Mint(ctx context.Context, p siemenroll.MintParams) (siemenroll.MintResult, error) {
	if m.tokens == nil || m.store == nil {
		return siemenroll.MintResult{}, errors.New("dr enrollment token manager not configured")
	}
	out, err := m.tokens.Mint(ctx, p)
	if err != nil {
		return siemenroll.MintResult{}, err
	}
	if err := m.store.Insert(ctx, sources.EnrollmentTokenRecord{
		JTI:       out.JTI,
		SourceID:  p.SourceID,
		TenantID:  p.TenantID,
		Purpose:   p.Purpose,
		ExpiresAt: out.ExpiresAt,
	}); err != nil {
		return siemenroll.MintResult{}, err
	}
	return out, nil
}

func (m durableDRTokenManager) Parse(ctx context.Context, token string) (*siemenroll.Claims, error) {
	return m.tokens.Parse(ctx, token)
}

// drEnrollmentTokenStore satisfies the SIEM enrollment service's durable token
// repository contract using dr_enrollment_token in dr_db.
type drEnrollmentTokenStore struct {
	pool *pgxpool.Pool
}

func (s *drEnrollmentTokenStore) Insert(ctx context.Context, t sources.EnrollmentTokenRecord) error {
	return database.RunSystemTx(ctx, s.pool, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
INSERT INTO dr_enrollment_token (jti, agent_id, tenant_id, purpose, expires_at)
VALUES ($1, $2, $3, $4, $5)`,
			t.JTI, t.SourceID, t.TenantID, string(t.Purpose), t.ExpiresAt)
		if err != nil {
			return fmt.Errorf("dr enrollment token insert: %w", err)
		}
		return nil
	})
}

func (s *drEnrollmentTokenStore) MarkConsumed(ctx context.Context, jti uuid.UUID, ip string, now time.Time) (*sources.EnrollmentTokenRecord, error) {
	var rec sources.EnrollmentTokenRecord
	var purpose string
	var consumedAt *time.Time
	var consumedFromIP *string
	err := database.RunSystemTx(ctx, s.pool, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
UPDATE dr_enrollment_token
SET consumed_at = $2, consumed_from_ip = NULLIF($3, '')::inet
WHERE jti = $1 AND consumed_at IS NULL AND expires_at > $2
RETURNING jti, agent_id, tenant_id, purpose, issued_at, expires_at, consumed_at, consumed_from_ip`,
			jti, now, ip,
		).Scan(&rec.JTI, &rec.SourceID, &rec.TenantID, &purpose, &rec.IssuedAt, &rec.ExpiresAt, &consumedAt, &consumedFromIP)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("%w: jti %s", sources.ErrTokenConsumed, jti)
	}
	if err != nil {
		return nil, fmt.Errorf("dr enrollment token consume: %w", err)
	}
	rec.Purpose = sources.Purpose(purpose)
	rec.ConsumedAt = consumedAt
	if consumedFromIP != nil {
		rec.ConsumedFromIP = *consumedFromIP
	}
	return &rec, nil
}

type drRevocationStore struct {
	pool *pgxpool.Pool
	repo *drrepo.Repository
}

func (s drRevocationStore) Insert(ctx context.Context, rv sources.Revocation) error {
	if s.pool == nil || s.repo == nil {
		return fmt.Errorf("dr revocation store: dependency not configured")
	}
	return database.RunSystemTx(ctx, s.pool, func(tx pgx.Tx) error {
		return s.repo.InsertAgentCertRevocation(ctx, tx, model.AgentCertRevocation{
			Thumbprint: rv.Thumbprint,
			AgentID:    rv.SourceID.String(),
			CertSerial: rv.CertSerial,
			RevokedAt:  rv.RevokedAt,
			Reason:     rv.Reason,
		})
	})
}

func (s drRevocationStore) ListSince(ctx context.Context, since time.Time) ([]sources.Revocation, error) {
	if s.pool == nil || s.repo == nil {
		return nil, fmt.Errorf("dr revocation store: dependency not configured")
	}
	var rows []model.AgentCertRevocation
	if err := database.RunSystemRead(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		rows, err = s.repo.ListAgentCertRevocationsSince(ctx, tx, since)
		return err
	}); err != nil {
		return nil, err
	}
	out := make([]sources.Revocation, 0, len(rows))
	for _, row := range rows {
		agentID, err := uuid.Parse(row.AgentID)
		if err != nil {
			return nil, fmt.Errorf("dr revocation store: stored agent id is not a uuid: %w", err)
		}
		out = append(out, sources.Revocation{
			Thumbprint: row.Thumbprint,
			SourceID:   agentID,
			CertSerial: row.CertSerial,
			RevokedAt:  row.RevokedAt,
			Reason:     row.Reason,
		})
	}
	return out, nil
}

type noopDREnrollEmitter struct{}

func (noopDREnrollEmitter) EmitCertEvent(context.Context, uuid.UUID, uuid.UUID, string, any) error {
	return nil
}

type drVaultPKIAdapter struct {
	vc vault.Client
}

func (a drVaultPKIAdapter) EnsurePKIMount(ctx context.Context, mountPath string, defaultTTL, maxTTL time.Duration) error {
	return a.vc.EnsurePKIMount(ctx, mountPath, defaultTTL, maxTTL)
}

func (a drVaultPKIAdapter) GenerateRootCA(ctx context.Context, mountPath, commonName string, ttl time.Duration) (string, error) {
	return a.vc.GenerateRootCA(ctx, mountPath, commonName, ttl)
}

func (a drVaultPKIAdapter) EnsureIntermediate(ctx context.Context, rootMount, intermediateMount, commonName string, ttl time.Duration) (string, error) {
	return a.vc.EnsureIntermediate(ctx, rootMount, intermediateMount, commonName, ttl)
}

func (a drVaultPKIAdapter) EnsurePKIRole(ctx context.Context, mountPath, roleName string, settings pki.PKIRoleSettings) error {
	return a.vc.EnsurePKIRole(ctx, mountPath, roleName, vault.PKIRoleSettings{
		AllowedDomains:   settings.AllowedDomains,
		AllowSubdomains:  settings.AllowSubdomains,
		AllowBareDomains: settings.AllowBareDomains,
		AllowLocalhost:   settings.AllowLocalhost,
		AllowIPSANs:      settings.AllowIPSans,
		EnforceHostnames: settings.EnforceHostnames,
		KeyType:          settings.KeyType,
		KeyBits:          settings.KeyBits,
		MaxTTL:           settings.MaxTTL,
		DefaultTTL:       settings.DefaultTTL,
		ClientFlag:       settings.ClientFlag,
		ServerFlag:       settings.ServerFlag,
	})
}

func (a drVaultPKIAdapter) IssueLeaf(ctx context.Context, mountPath, roleName, csrPEM, commonName string, ttl time.Duration) (pki.LeafCert, error) {
	leaf, err := a.vc.IssueLeaf(ctx, mountPath, roleName, csrPEM, commonName, ttl)
	if err != nil {
		return pki.LeafCert{}, err
	}
	return pki.LeafCert{
		CertPEM:    leaf.CertPEM,
		CAChainPEM: leaf.CAChainPEM,
		Serial:     leaf.Serial,
		NotBefore:  leaf.NotBefore,
		NotAfter:   leaf.NotAfter,
	}, nil
}

func (a drVaultPKIAdapter) RevokeLeaf(ctx context.Context, mountPath, serial string) error {
	return a.vc.RevokeLeaf(ctx, mountPath, serial)
}

type noopDRVaultPKI struct{}

func (noopDRVaultPKI) EnsurePKIMount(context.Context, string, time.Duration, time.Duration) error {
	return nil
}
func (noopDRVaultPKI) GenerateRootCA(context.Context, string, string, time.Duration) (string, error) {
	return "", nil
}
func (noopDRVaultPKI) EnsureIntermediate(context.Context, string, string, string, time.Duration) (string, error) {
	return "", nil
}
func (noopDRVaultPKI) EnsurePKIRole(context.Context, string, string, pki.PKIRoleSettings) error {
	return nil
}
func (noopDRVaultPKI) IssueLeaf(context.Context, string, string, string, string, time.Duration) (pki.LeafCert, error) {
	return pki.LeafCert{}, errors.New("dr enrollment: Vault PKI unavailable")
}
func (noopDRVaultPKI) RevokeLeaf(context.Context, string, string) error { return nil }

type drTransportDEKProvider struct {
	mgr siemcrypto.DEKManager
}

func (p drTransportDEKProvider) DEK(ctx context.Context, identity dringest.Identity, streamID string) ([]byte, error) {
	if p.mgr == nil {
		return nil, fmt.Errorf("%w: ingest transport DEK", dringest.ErrNotConfigured)
	}
	dek, _, err := p.mgr.Get(ctx, identity.TenantID, "dr-ingest-"+streamID)
	if err != nil {
		return nil, err
	}
	return append([]byte(nil), dek...), nil
}

type drFrameApplierFactory struct {
	repo *drrepo.Repository
	db   *pgxpool.Pool
	// observers receive every durably-applied frame so the streaming ransomware
	// detector sees exactly the bytes the apply path stored. Empty in tests that
	// exercise only the store path.
	observers []frameObserver
}

func (f drFrameApplierFactory) ApplierFor(_ context.Context, identity dringest.Identity, _ string) (core.Applier, error) {
	return drFrameStoreApplier{
		store:     framestore.New(f.repo, f.db),
		tenantID:  identity.TenantID,
		observers: f.observers,
	}, nil
}

type drFrameStoreApplier struct {
	store     *framestore.Store
	tenantID  uuid.UUID
	observers []frameObserver
}

func (a drFrameStoreApplier) Apply(ctx context.Context, f core.Frame) (uint64, error) {
	if _, err := a.store.AppendFrame(ctx, a.tenantID, f); err != nil {
		return 0, err
	}
	// After the frame is durably stored, fold it into each intelligence observer
	// (ransomware detection). Observers run on their own transaction; an observer
	// error must not fail the apply path (the frame is already committed), so it
	// is reported via the observer's own logging/metrics, not returned here.
	for _, obs := range a.observers {
		_ = obs.Observe(ctx, nil, a.tenantID.String(), f)
	}
	return f.Seq, nil
}

func (drFrameStoreApplier) Kind() core.FrameKind { return core.FrameKindWAL }

func (drFrameStoreApplier) AcceptsKind(kind core.FrameKind) bool { return kind.Valid() }

type drCheckpointFactory struct {
	repo *drrepo.Repository
	db   *pgxpool.Pool
}

func (f drCheckpointFactory) CheckpointerFor(_ context.Context, identity dringest.Identity, streamID string) (core.Checkpointer, error) {
	store := drrepo.NewCheckpointStore(f.repo, f.db, identity.TenantID.String())
	return core.NewDBCheckpointer(store, streamID)
}

type drStreamAuthorizer struct {
	repo *drrepo.Repository
	db   *pgxpool.Pool
}

func (a drStreamAuthorizer) AuthorizeStream(ctx context.Context, identity dringest.Identity, streamID string) error {
	var stream *model.ReplicationStream
	if err := database.RunReadWithTenant(ctx, a.db, identity.TenantID, func(tx pgx.Tx) error {
		var err error
		stream, err = a.repo.GetStream(ctx, tx, identity.TenantID.String(), streamID)
		return err
	}); err != nil {
		return err
	}
	if identity.SiteID != nil && stream.SiteID != identity.SiteID.String() {
		return fmt.Errorf("agent site %s cannot ship stream for site %s", identity.SiteID.String(), stream.SiteID)
	}
	switch stream.Status {
	case model.StreamStatusPending, model.StreamStatusSeeding, model.StreamStatusStreaming, model.StreamStatusDegraded:
		return nil
	default:
		return fmt.Errorf("stream %s is not ingestible in status %s", streamID, stream.Status)
	}
}
