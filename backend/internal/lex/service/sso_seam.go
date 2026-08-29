package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/federation"
	iammodel "github.com/clario360/platform/internal/iam/model"
)

// LexSSOSeam is the thin, documented integration point that routes a Watheeq/lex
// suite login through the existing platform IdP-federation machinery
// (internal/iam/federation) rather than rebuilding SSO (CAP-152). It deliberately
// owns NO protocol logic: AuthCodeURL/Exchange are delegated to a
// federation.Provider that the integrator constructs from a tenant's
// iammodel.IdPConnection via federation.NewProvider. This file exists so the lex
// suite has a stable, suite-local call site (and audit hook) for "begin SSO" /
// "complete SSO" without coupling lex handlers to the IAM service internals.
//
// Wiring note (for the integrator): the lex login route should resolve the
// tenant's IdPConnection (Nafath/OIDC/SAML), call federation.NewProvider, wrap it
// with NewLexSSOSeam, and use BeginLogin/CompleteLogin. Session/JWT minting stays
// in the IAM service — this seam only performs the IdP handshake and returns the
// verified external identity for the IAM session exchange to consume.
//
// Nafath-as-OIDC LOGIN vs Nafath identity-CONFIRMATION (keep these distinct):
//   - LOGIN: Nafath National Single-Sign-On is an OIDC IdP. To use it for lex
//     sign-in the tenant registers a Nafath IdPConnection (iammodel.IdPKindOIDC
//     with the Nafath issuer/authorize/token/jwks endpoints) and this seam drives
//     the standard OIDC code+PKCE handshake via federation.NewProvider/oidc.go.
//     The OIDC protocol logic lives in internal/iam/federation (owned by the
//     iam-fed-sso work), NOT here — this seam is only the suite-local call site +
//     audit hook. CompleteLogin returns the verified ExternalClaims (subject =
//     the citizen's Nafath sub / national id) which IAM maps to a lex user.
//   - CONFIRMATION: the ExtNafath number-match flow used as an e-sign / DoA basis
//     is a SEPARATE concern handled by the nafath_verify connector
//     (service/integration/nafath_verify_connector.go). That path confirms IDENTITY
//     for a specific transaction (identity_confirmed) and is NOT a login and NOT a
//     signature — a legally binding signature still pairs the confirmation with a
//     TSP (emdha). Do not conflate an SSO login session with an e-sign basis.
//
// For the OIDC login path, callers SHOULD request an acr/assurance high enough for
// their use case at the IdP (federation.AuthRequest), but the binding e-sign LoA
// gate (app-push number-match minimum) is enforced on the CONFIRMATION side, in
// the nafath_verify connector, not in this login seam.
type LexSSOSeam struct {
	provider federation.Provider
	audit    *LexAuditEmitter
	logger   zerolog.Logger
	now      func() time.Time
}

// ErrSSONotConfigured is returned when no federation provider is wired for the
// tenant (SSO disabled). Callers fall back to password / passkey login.
var ErrSSONotConfigured = errors.New("lex/sso: no identity provider configured for tenant")

// NewLexSSOSeam wraps a federation.Provider. provider may be nil to represent a
// tenant with SSO disabled; BeginLogin/CompleteLogin then return
// ErrSSONotConfigured so callers can fall back cleanly.
func NewLexSSOSeam(provider federation.Provider, audit *LexAuditEmitter, logger zerolog.Logger) *LexSSOSeam {
	return &LexSSOSeam{
		provider: provider,
		audit:    audit,
		logger:   logger.With().Str("component", "lex-sso-seam").Logger(),
		now:      time.Now,
	}
}

// Configured reports whether an external IdP is wired for this seam.
func (s *LexSSOSeam) Configured() bool {
	return s != nil && s.provider != nil
}

// Kind reports the underlying provider protocol, or empty when unconfigured.
func (s *LexSSOSeam) Kind() iammodel.IdPKind {
	if !s.Configured() {
		return ""
	}
	return s.provider.Kind()
}

// BeginLogin produces the IdP redirect URL for the lex login flow. The caller
// must persist req (state/nonce/verifier) bound to the browser session so the
// callback can be validated.
func (s *LexSSOSeam) BeginLogin(ctx context.Context, tenantID uuid.UUID, req federation.AuthRequest) (string, error) {
	if !s.Configured() {
		return "", ErrSSONotConfigured
	}
	url, err := s.provider.AuthCodeURL(ctx, req)
	if err != nil {
		return "", internalError("begin lex SSO login", err)
	}
	s.emitAudit(ctx, tenantID, "sso.login.begin", "")
	return url, nil
}

// CompleteLogin validates the IdP callback and returns the verified external
// identity claims. It does NOT mint a session/JWT — that remains the IAM
// service's responsibility; the lex login route hands these claims to the IAM
// session-exchange path. The returned email/subject feed the IAM JIT/lookup.
func (s *LexSSOSeam) CompleteLogin(ctx context.Context, tenantID uuid.UUID, req federation.AuthRequest, params federation.CallbackParams) (*federation.ExternalClaims, error) {
	if !s.Configured() {
		return nil, ErrSSONotConfigured
	}
	claims, err := s.provider.Exchange(ctx, req, params)
	if err != nil {
		s.emitAudit(ctx, tenantID, "sso.login.failed", strings.TrimSpace(params.Error))
		return nil, internalError("complete lex SSO login", err)
	}
	subject := ""
	if claims != nil {
		subject = claims.Subject
	}
	s.emitAudit(ctx, tenantID, "sso.login.success", subject)
	return claims, nil
}

func (s *LexSSOSeam) emitAudit(ctx context.Context, tenantID uuid.UUID, action, resourceID string) {
	if s.audit == nil {
		return
	}
	s.audit.Emit(ctx, LexAuditRecord{
		TenantID:     tenantID,
		Action:       action,
		ResourceType: "sso_login",
		ResourceID:   resourceID,
		Detail:       map[string]any{"provider_kind": string(s.Kind())},
	})
}
