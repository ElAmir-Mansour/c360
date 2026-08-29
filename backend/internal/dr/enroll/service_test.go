package enroll

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/siem/sources"
	siemenroll "github.com/clario360/platform/internal/siem/sources/enroll"
)

type fakeAgentReader struct {
	agents map[uuid.UUID]*model.DRAgent
	err    error
}

func (f *fakeAgentReader) GetAgent(_ context.Context, tenantID, agentID uuid.UUID) (*model.DRAgent, error) {
	if f.err != nil {
		return nil, f.err
	}
	agent := f.agents[agentID]
	if agent == nil || agent.TenantID != tenantID.String() {
		return nil, model.ErrNotFound
	}
	return agent, nil
}

type fakeMinter struct {
	got siemenroll.MintParams
}

func (f *fakeMinter) Mint(_ context.Context, p siemenroll.MintParams) (siemenroll.MintResult, error) {
	f.got = p
	return siemenroll.MintResult{JWT: "jwt", JTI: uuid.New(), ExpiresAt: time.Unix(1000, 0).UTC()}, nil
}

type fakeParser struct {
	claims *siemenroll.Claims
	err    error
}

func (f fakeParser) Parse(context.Context, string) (*siemenroll.Claims, error) {
	return f.claims, f.err
}

type fakeExchange struct {
	got siemenroll.ExchangeInput
	out *siemenroll.ExchangeOutput
	err error
}

func (f *fakeExchange) Exchange(_ context.Context, in siemenroll.ExchangeInput) (*siemenroll.ExchangeOutput, error) {
	f.got = in
	if f.err != nil {
		return nil, f.err
	}
	return f.out, nil
}

func TestMintTokenUsesSIEMTokenShapeForDRAgent(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	agentID := uuid.New()
	siteID := uuid.New()
	site := siteID.String()
	minter := &fakeMinter{}
	svc := NewService(minter, nil, nil, &fakeAgentReader{agents: map[uuid.UUID]*model.DRAgent{
		agentID: {ID: agentID.String(), TenantID: tenantID.String(), SiteID: &site, Status: model.AgentStatusProvisioning},
	}}, Config{})

	out, err := svc.MintToken(context.Background(), MintInput{
		TenantID: tenantID,
		AgentID:  agentID,
		SiteID:   &siteID,
		Purpose:  sources.PurposeEnroll,
		TTL:      10 * time.Minute,
	})
	require.NoError(t, err)
	require.Equal(t, "jwt", out.JWT)
	require.Equal(t, agentID, out.AgentID)
	require.Equal(t, tenantID, out.TenantID)
	require.NotNil(t, out.SiteID)
	require.Equal(t, siteID, *out.SiteID)

	require.Equal(t, agentID, minter.got.SourceID)
	require.Equal(t, tenantID, minter.got.TenantID)
	require.Equal(t, sources.PurposeEnroll, minter.got.Purpose)
	require.Equal(t, 10*time.Minute, minter.got.TTL)
	require.Equal(t, DefaultIssuer, minter.got.Issuer)
	require.Equal(t, DefaultAudience, minter.got.Audience)
}

func TestExchangePrevalidatesTenantSiteAndDelegatesSIEMShape(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	agentID := uuid.New()
	siteID := uuid.New()
	site := siteID.String()
	exchanger := &fakeExchange{out: &siemenroll.ExchangeOutput{
		CertPEM:    "cert",
		CAChainPEM: "chain",
		Serial:     "serial-1",
		ExpiresAt:  time.Unix(2000, 0).UTC(),
		SourceID:   agentID,
	}}
	svc := NewService(nil, fakeParser{claims: &siemenroll.Claims{
		Sub: agentID.String(),
		Tnt: tenantID.String(),
		Pur: string(sources.PurposeEnroll),
	}}, exchanger, &fakeAgentReader{agents: map[uuid.UUID]*model.DRAgent{
		agentID: {ID: agentID.String(), TenantID: tenantID.String(), SiteID: &site, Status: model.AgentStatusProvisioning},
	}}, Config{})

	out, err := svc.Exchange(context.Background(), ExchangeInput{
		Token:    "token",
		CSRPEM:   "csr",
		IP:       "203.0.113.10",
		TenantID: &tenantID,
		SiteID:   &siteID,
	})
	require.NoError(t, err)
	require.Equal(t, "token", exchanger.got.Token)
	require.Equal(t, "csr", exchanger.got.CSRPEM)
	require.Equal(t, "203.0.113.10", exchanger.got.IP)
	require.Equal(t, "cert", out.CertPEM)
	require.Equal(t, "chain", out.CAChainPEM)
	require.Equal(t, "serial-1", out.Serial)
	require.Equal(t, agentID, out.AgentID)
	require.Equal(t, tenantID, out.TenantID)
	require.NotNil(t, out.SiteID)
	require.Equal(t, siteID, *out.SiteID)
}

func TestExchangeRejectsSiteMismatchBeforeConsumingToken(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	agentID := uuid.New()
	agentSiteID := uuid.New()
	requestSiteID := uuid.New()
	site := agentSiteID.String()
	exchanger := &fakeExchange{err: errors.New("should not be called")}
	svc := NewService(nil, fakeParser{claims: &siemenroll.Claims{
		Sub: agentID.String(),
		Tnt: tenantID.String(),
		Pur: string(sources.PurposeEnroll),
	}}, exchanger, &fakeAgentReader{agents: map[uuid.UUID]*model.DRAgent{
		agentID: {ID: agentID.String(), TenantID: tenantID.String(), SiteID: &site, Status: model.AgentStatusProvisioning},
	}}, Config{})

	_, err := svc.Exchange(context.Background(), ExchangeInput{
		Token:  "token",
		CSRPEM: "csr",
		SiteID: &requestSiteID,
	})
	require.ErrorIs(t, err, sources.ErrTenantMismatch)
	require.Empty(t, exchanger.got.Token)
}

func TestSourceAdapterAttachCertActivatesDRAgent(t *testing.T) {
	t.Parallel()
	tenantID := uuid.New()
	agentID := uuid.New()
	store := &fakeLifecycleStore{agents: map[uuid.UUID]*model.DRAgent{
		agentID: {ID: agentID.String(), TenantID: tenantID.String(), Status: model.AgentStatusProvisioning},
	}}
	adapter := NewSourceAdapter(store, nil, nil)
	issuedAt := time.Unix(10, 0).UTC()
	expiresAt := time.Unix(20, 0).UTC()

	src, err := adapter.AttachCert(context.Background(), tenantID, agentID, "thumb", "serial", issuedAt, expiresAt, sources.StatusActive)
	require.NoError(t, err)
	require.Equal(t, agentID, src.ID)
	require.Equal(t, tenantID, src.TenantID)
	require.Equal(t, sources.StatusActive, src.Status)
	require.Equal(t, "thumb", src.MTLSThumbprint)
	require.Equal(t, "serial", src.CertSerial)
}

type fakeLifecycleStore struct {
	agents map[uuid.UUID]*model.DRAgent
}

func (f *fakeLifecycleStore) GetAgent(_ context.Context, tenantID, agentID uuid.UUID) (*model.DRAgent, error) {
	agent := f.agents[agentID]
	if agent == nil || agent.TenantID != tenantID.String() {
		return nil, model.ErrNotFound
	}
	return agent, nil
}

func (f *fakeLifecycleStore) SetAgentCert(_ context.Context, tenantID, agentID uuid.UUID, status, thumbprint, serial string, issuedAt, expiresAt time.Time) error {
	agent, err := f.GetAgent(context.Background(), tenantID, agentID)
	if err != nil {
		return err
	}
	agent.Status = status
	agent.MTLSThumbprint = &thumbprint
	agent.CertSerial = &serial
	agent.CertIssuedAt = &issuedAt
	agent.CertExpiresAt = &expiresAt
	return nil
}
