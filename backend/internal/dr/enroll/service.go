// Package enroll adapts the SIEM enrollment/token/PKI flow to ClarioDR agents.
package enroll

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/siem/sources"
	siemenroll "github.com/clario360/platform/internal/siem/sources/enroll"
)

const (
	// DefaultIssuer is the issuer claim used for DR enrollment tokens.
	DefaultIssuer = "clario-dr-service"
	// DefaultAudience is the audience claim expected by the DR capture agent.
	DefaultAudience = "clario-dr-agent"
)

var (
	// ErrNotConfigured is returned when a caller uses a path whose dependency
	// was intentionally left unwired by main.
	ErrNotConfigured = errors.New("dr enroll: dependency not configured")
)

// TokenMinter is implemented by *siem/sources/enroll.TokenManager.
type TokenMinter interface {
	Mint(ctx context.Context, p siemenroll.MintParams) (siemenroll.MintResult, error)
}

// TokenParser is implemented by *siem/sources/enroll.TokenManager.
type TokenParser interface {
	Parse(ctx context.Context, token string) (*siemenroll.Claims, error)
}

// ExchangeDelegate is implemented by *siem/sources/enroll.Service.
type ExchangeDelegate interface {
	Exchange(ctx context.Context, in siemenroll.ExchangeInput) (*siemenroll.ExchangeOutput, error)
}

// AgentReader is the tenant-scoped DR agent read surface needed for input
// validation before minting or exchanging a token.
type AgentReader interface {
	GetAgent(ctx context.Context, tenantID, agentID uuid.UUID) (*model.DRAgent, error)
}

// Config tunes token defaults. Zero values use the DR defaults.
type Config struct {
	Issuer     string
	Audience   string
	DefaultTTL time.Duration
	MaxTTL     time.Duration
	Logger     zerolog.Logger
}

// Service wraps the existing SIEM token and enrollment exchange primitives with
// DR-agent lifecycle validation.
type Service struct {
	tokens     TokenMinter
	parser     TokenParser
	exchange   ExchangeDelegate
	agents     AgentReader
	issuer     string
	audience   string
	defaultTTL time.Duration
	maxTTL     time.Duration
	logger     zerolog.Logger
}

// NewService constructs a Service. Dependencies may be nil only for code paths
// that will not be used; MintToken requires tokens+agents, Exchange requires
// parser+exchange+agents.
func NewService(tokens TokenMinter, parser TokenParser, exchange ExchangeDelegate, agents AgentReader, cfg Config) *Service {
	if cfg.Issuer == "" {
		cfg.Issuer = DefaultIssuer
	}
	if cfg.Audience == "" {
		cfg.Audience = DefaultAudience
	}
	if cfg.DefaultTTL <= 0 {
		cfg.DefaultTTL = 15 * time.Minute
	}
	return &Service{
		tokens:     tokens,
		parser:     parser,
		exchange:   exchange,
		agents:     agents,
		issuer:     cfg.Issuer,
		audience:   cfg.Audience,
		defaultTTL: cfg.DefaultTTL,
		maxTTL:     cfg.MaxTTL,
		logger:     cfg.Logger.With().Str("component", "dr-enroll").Logger(),
	}
}

// MintInput requests a single-use enrollment or rotation token for a DR agent.
type MintInput struct {
	TenantID uuid.UUID
	AgentID  uuid.UUID
	SiteID   *uuid.UUID
	Purpose  sources.Purpose
	TTL      time.Duration
}

// MintOutput is the admin-visible token response. JWT is shown once.
type MintOutput struct {
	JWT       string          `json:"jwt"`
	JTI       uuid.UUID       `json:"jti"`
	AgentID   uuid.UUID       `json:"agent_id"`
	TenantID  uuid.UUID       `json:"tenant_id"`
	SiteID    *uuid.UUID      `json:"site_id,omitempty"`
	Purpose   sources.Purpose `json:"purpose"`
	ExpiresAt time.Time       `json:"expires_at"`
}

// MintToken validates the target DR agent and mints a SIEM-shaped enrollment
// JWT whose subject is the dr_agent.id.
func (s *Service) MintToken(ctx context.Context, in MintInput) (*MintOutput, error) {
	if s == nil || s.tokens == nil || s.agents == nil {
		return nil, ErrNotConfigured
	}
	if in.TenantID == uuid.Nil {
		return nil, fmt.Errorf("%w: tenant_id is required", sources.ErrValidation)
	}
	if in.AgentID == uuid.Nil {
		return nil, fmt.Errorf("%w: agent_id is required", sources.ErrValidation)
	}
	purpose, err := normalizePurpose(in.Purpose)
	if err != nil {
		return nil, err
	}
	ttl := in.TTL
	if ttl <= 0 {
		ttl = s.defaultTTL
	}
	if s.maxTTL > 0 && ttl > s.maxTTL {
		return nil, fmt.Errorf("%w: ttl exceeds maximum", sources.ErrValidation)
	}

	agent, err := s.agents.GetAgent(ctx, in.TenantID, in.AgentID)
	if err != nil {
		return nil, err
	}
	if err := validateAgentForPurpose(agent, purpose); err != nil {
		return nil, err
	}
	siteID, err := agentSiteID(agent)
	if err != nil {
		return nil, err
	}
	if err := validateSiteInput(siteID, in.SiteID); err != nil {
		return nil, err
	}

	minted, err := s.tokens.Mint(ctx, siemenroll.MintParams{
		SourceID: in.AgentID,
		TenantID: in.TenantID,
		Purpose:  purpose,
		TTL:      ttl,
		Issuer:   s.issuer,
		Audience: s.audience,
	})
	if err != nil {
		return nil, err
	}
	return &MintOutput{
		JWT:       minted.JWT,
		JTI:       minted.JTI,
		AgentID:   in.AgentID,
		TenantID:  in.TenantID,
		SiteID:    siteID,
		Purpose:   purpose,
		ExpiresAt: minted.ExpiresAt,
	}, nil
}

// ExchangeInput is the DR enrollment request body plus caller metadata. The
// token remains the authority; TenantID/SiteID are optional assertions that are
// checked before the SIEM exchange consumes the token.
type ExchangeInput struct {
	Token    string
	CSRPEM   string
	IP       string
	TenantID *uuid.UUID
	SiteID   *uuid.UUID
}

// ExchangeOutput mirrors the SIEM exchange response with DR agent identity.
type ExchangeOutput struct {
	CertPEM    string     `json:"cert_pem"`
	CAChainPEM string     `json:"ca_chain_pem"`
	Serial     string     `json:"serial"`
	ExpiresAt  time.Time  `json:"expires_at"`
	AgentID    uuid.UUID  `json:"agent_id"`
	TenantID   uuid.UUID  `json:"tenant_id"`
	SiteID     *uuid.UUID `json:"site_id,omitempty"`
}

// Exchange pre-validates tenant/site/agent lifecycle, then delegates the
// single-use claim, CSR validation, and leaf issuance to the SIEM enrollment
// service.
func (s *Service) Exchange(ctx context.Context, in ExchangeInput) (*ExchangeOutput, error) {
	if s == nil || s.parser == nil || s.exchange == nil || s.agents == nil {
		return nil, ErrNotConfigured
	}
	if in.Token == "" {
		return nil, fmt.Errorf("%w: token is required", sources.ErrValidation)
	}
	if in.CSRPEM == "" {
		return nil, fmt.Errorf("%w: csr_pem is required", sources.ErrValidation)
	}

	claims, err := s.parser.Parse(ctx, in.Token)
	if err != nil {
		return nil, err
	}
	tenantID, agentID, purpose, err := parseClaims(claims)
	if err != nil {
		return nil, err
	}
	if in.TenantID != nil && *in.TenantID != tenantID {
		return nil, fmt.Errorf("%w: request tenant does not match token tenant", sources.ErrTenantMismatch)
	}

	agent, err := s.agents.GetAgent(ctx, tenantID, agentID)
	if err != nil {
		return nil, err
	}
	if err := validateAgentForPurpose(agent, purpose); err != nil {
		return nil, err
	}
	siteID, err := agentSiteID(agent)
	if err != nil {
		return nil, err
	}
	if err := validateSiteInput(siteID, in.SiteID); err != nil {
		return nil, err
	}

	out, err := s.exchange.Exchange(ctx, siemenroll.ExchangeInput{
		Token:  in.Token,
		CSRPEM: in.CSRPEM,
		IP:     in.IP,
	})
	if err != nil {
		return nil, err
	}
	if out.SourceID != agentID {
		return nil, fmt.Errorf("%w: exchange returned agent %s for token subject %s", sources.ErrValidation, out.SourceID, agentID)
	}
	return &ExchangeOutput{
		CertPEM:    out.CertPEM,
		CAChainPEM: out.CAChainPEM,
		Serial:     out.Serial,
		ExpiresAt:  out.ExpiresAt,
		AgentID:    agentID,
		TenantID:   tenantID,
		SiteID:     siteID,
	}, nil
}

func normalizePurpose(p sources.Purpose) (sources.Purpose, error) {
	if p == "" {
		return sources.PurposeEnroll, nil
	}
	switch p {
	case sources.PurposeEnroll, sources.PurposeRotate:
		return p, nil
	default:
		return "", fmt.Errorf("%w: unsupported purpose %q", sources.ErrValidation, p)
	}
}

func parseClaims(c *siemenroll.Claims) (tenantID, agentID uuid.UUID, purpose sources.Purpose, err error) {
	if c == nil {
		return uuid.Nil, uuid.Nil, "", fmt.Errorf("%w: empty claims", sources.ErrTokenInvalid)
	}
	tenantID, err = uuid.Parse(c.Tnt)
	if err != nil {
		return uuid.Nil, uuid.Nil, "", fmt.Errorf("%w: tnt is not a uuid", sources.ErrTokenInvalid)
	}
	agentID, err = uuid.Parse(c.Sub)
	if err != nil {
		return uuid.Nil, uuid.Nil, "", fmt.Errorf("%w: sub is not a uuid", sources.ErrTokenInvalid)
	}
	purpose, err = normalizePurpose(sources.Purpose(c.Pur))
	if err != nil {
		return uuid.Nil, uuid.Nil, "", fmt.Errorf("%w: bad purpose", sources.ErrTokenInvalid)
	}
	return tenantID, agentID, purpose, nil
}

func validateAgentForPurpose(agent *model.DRAgent, purpose sources.Purpose) error {
	if agent == nil {
		return fmt.Errorf("%w: agent not found", sources.ErrTenantMismatch)
	}
	switch purpose {
	case sources.PurposeEnroll:
		if agent.Status != model.AgentStatusProvisioning {
			return fmt.Errorf("%w: agent not provisioning", sources.ErrInvalidState)
		}
	case sources.PurposeRotate:
		switch agent.Status {
		case model.AgentStatusActive, model.AgentStatusSilent, model.AgentStatusRotating:
		default:
			return fmt.Errorf("%w: agent not rotatable", sources.ErrInvalidState)
		}
	default:
		return fmt.Errorf("%w: unsupported purpose", sources.ErrValidation)
	}
	return nil
}

func agentSiteID(agent *model.DRAgent) (*uuid.UUID, error) {
	if agent == nil || agent.SiteID == nil || *agent.SiteID == "" {
		return nil, nil
	}
	siteID, err := uuid.Parse(*agent.SiteID)
	if err != nil {
		return nil, fmt.Errorf("%w: stored site_id is not a uuid", sources.ErrValidation)
	}
	return &siteID, nil
}

func validateSiteInput(agentSite, requested *uuid.UUID) error {
	if requested == nil {
		return nil
	}
	if *requested == uuid.Nil {
		return fmt.Errorf("%w: site_id must not be nil", sources.ErrValidation)
	}
	if agentSite == nil || *agentSite != *requested {
		return fmt.Errorf("%w: request site does not match agent site", sources.ErrTenantMismatch)
	}
	return nil
}
