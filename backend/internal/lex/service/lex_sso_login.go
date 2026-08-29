package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/federation"
)

// LexSSOLoginService is the wired, suite-local SSO login path for Watheeq/lex
// (CAP-152). It deliberately does NOT reimplement federation: the canonical
// owner of SSO login is the platform IAM FederationService, which persists the
// per-login flow state (state/nonce/PKCE) in Redis, performs the IdP code
// exchange via internal/iam/federation, does just-in-time provisioning /
// identity linking, and mints the platform session (dto.AuthResponse) through
// the existing AuthService/JWTManager.
//
// This service is therefore a thin, correct delegation that:
//
//  1. gives the lex suite a stable suite-local call site for "begin SSO" /
//     "complete SSO" (so lex handlers never import the IAM service internals);
//  2. emits lex-suite audit records (CAP-155/181) around the handshake so the
//     Watheeq audit ledger reflects SSO logins; and
//  3. keeps session minting, JIT provisioning, and Redis flow state in the
//     single canonical IAM implementation (no divergent second copy).
//
// CONTRACT (for the integrator): the delegate is satisfied by
// *internal/iam/service.FederationService — its LoginURL / Callback / ListConnections
// method set matches LexSSOFederation exactly. The integrator injects the live
// IAM FederationService here (constructed once at IAM bootstrap with the IdP
// connection repo, external-identity repo, user/role repos, AuthService, Redis
// and httpClient). When the lex suite runs without a federation service wired
// (delegate nil), Initiate/Complete return ErrSSONotConfigured so callers fall
// back to password / passkey login cleanly.
type LexSSOLoginService struct {
	delegate LexSSOFederation
	audit    *LexAuditEmitter
	logger   zerolog.Logger
	now      func() time.Time
}

// LexSSOFederation is the narrow slice of the platform IAM FederationService the
// lex login path consumes. It is declared lex-side (consumer-defined interface)
// so the lex suite does not take a hard dependency on the concrete IAM service
// type and so tests can inject a stub. *iam/service.FederationService satisfies
// this interface structurally.
type LexSSOFederation interface {
	// LoginURL builds the IdP authorization redirect for a provider and persists
	// the per-login state (state/nonce/PKCE) so the callback can validate it.
	LoginURL(ctx context.Context, tenantID, provider string) (string, error)
	// Callback completes the login: loads the stored flow by state, exchanges the
	// code at the IdP, JIT-provisions/links the user, and returns a platform
	// session (access + refresh tokens).
	Callback(ctx context.Context, provider string, params federation.CallbackParams, ip, userAgent string) (*dto.AuthResponse, error)
	// DiscoverByDomain resolves an email domain to its configured IdP and returns
	// the provider slug plus a ready-to-follow authorization redirect URL.
	DiscoverByDomain(ctx context.Context, domain string) (provider string, authorizeURL string, err error)
}

// NewLexSSOLoginService wraps the canonical IAM FederationService. delegate may
// be nil to represent a deployment with SSO disabled for the lex suite; in that
// case Initiate/Complete return ErrSSONotConfigured.
func NewLexSSOLoginService(delegate LexSSOFederation, audit *LexAuditEmitter, logger zerolog.Logger) *LexSSOLoginService {
	return &LexSSOLoginService{
		delegate: delegate,
		audit:    audit,
		logger:   logger.With().Str("component", "lex-sso-login").Logger(),
		now:      time.Now,
	}
}

// Configured reports whether a federation delegate is wired for this service.
func (s *LexSSOLoginService) Configured() bool {
	return s != nil && s.delegate != nil
}

// Initiate begins the lex SSO flow for the given tenant + provider and returns
// the IdP authorization redirect URL. The IAM delegate persists state/nonce/PKCE
// in Redis keyed by state; the browser is redirected to the returned URL. An
// optional tenantID (uuid.Nil when unknown) is used only for the lex audit
// record — the delegate resolves the canonical tenant from its connection repo
// / default tenant.
func (s *LexSSOLoginService) Initiate(ctx context.Context, tenantID uuid.UUID, tenantSlug, provider string) (string, error) {
	if !s.Configured() {
		return "", ErrSSONotConfigured
	}
	provider = strings.TrimSpace(provider)
	if provider == "" {
		return "", validationError("provider is required", nil)
	}
	url, err := s.delegate.LoginURL(ctx, strings.TrimSpace(tenantSlug), provider)
	if err != nil {
		// The delegate returns a *FederationError with an HTTP status; surface it
		// unchanged so the handler maps it to the right status code.
		s.emitAudit(ctx, tenantID, "sso.login.begin.failed", provider)
		return "", err
	}
	s.emitAudit(ctx, tenantID, "sso.login.begin", provider)
	return url, nil
}

// Discover resolves an email domain to its configured IdP and returns the
// provider slug plus a ready-to-follow authorization redirect URL (state/nonce/
// PKCE already persisted). Used by the lex login form's "continue with SSO"
// affordance when the user types an email before picking a provider.
func (s *LexSSOLoginService) Discover(ctx context.Context, domain string) (provider, authorizeURL string, err error) {
	if !s.Configured() {
		return "", "", ErrSSONotConfigured
	}
	domain = strings.TrimSpace(domain)
	if domain == "" {
		return "", "", validationError("domain is required", nil)
	}
	return s.delegate.DiscoverByDomain(ctx, domain)
}

// Complete validates the IdP callback through the canonical IAM federation path
// and returns the minted platform session (access + refresh tokens). Session
// minting, JIT provisioning, and identity linking all happen inside the IAM
// delegate — this method only adds the lex-suite audit record. tenantID is used
// only for that audit record (uuid.Nil when unknown pre-session).
func (s *LexSSOLoginService) Complete(ctx context.Context, tenantID uuid.UUID, provider string, params federation.CallbackParams, ip, userAgent string) (*dto.AuthResponse, error) {
	if !s.Configured() {
		return nil, ErrSSONotConfigured
	}
	provider = strings.TrimSpace(provider)
	if provider == "" {
		return nil, validationError("provider is required", nil)
	}
	resp, err := s.delegate.Callback(ctx, provider, params, ip, userAgent)
	if err != nil {
		s.emitAudit(ctx, tenantID, "sso.login.failed", provider)
		return nil, err
	}
	s.emitAudit(ctx, tenantID, "sso.login.success", provider)
	return resp, nil
}

func (s *LexSSOLoginService) emitAudit(ctx context.Context, tenantID uuid.UUID, action, provider string) {
	if s.audit == nil {
		return
	}
	severity := "info"
	if strings.HasSuffix(action, ".failed") {
		severity = "warning"
	}
	s.audit.Emit(ctx, LexAuditRecord{
		TenantID:     tenantID,
		Action:       action,
		ResourceType: "sso_login",
		ResourceID:   provider,
		Severity:     severity,
		Detail:       map[string]any{"provider": provider},
	})
}
