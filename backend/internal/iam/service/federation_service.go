package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/federation"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
)

const (
	ssoStatePrefix    = "sso:state:"
	defaultSSOFlowTTL = 10 * time.Minute
)

// FederationError mirrors OAuthError so the handler can map it to an HTTP status.
type FederationError struct {
	Status  int
	Code    string
	Message string
}

func (e *FederationError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

// ProviderFactory builds a federation.Provider for a connection. It is a field
// so tests can inject a stub provider without hitting a live IdP.
type ProviderFactory func(conn model.IdPConnection) (federation.Provider, error)

// FederationService orchestrates external IdP login: it builds the IdP redirect,
// handles the callback, performs just-in-time provisioning / identity linking,
// and issues a platform session via the existing AuthService/JWTManager.
type FederationService struct {
	connRepo     repository.IdPConnectionRepository
	identityRepo repository.ExternalIdentityRepository
	userRepo     repository.UserRepository
	roleRepo     repository.RoleRepository
	authSvc      *AuthService
	redis        *redis.Client
	logger       zerolog.Logger

	newProvider ProviderFactory
	flowTTL     time.Duration
	// defaultTenantID is used to resolve connections when the login URL does not
	// carry a tenant (single-tenant deployments). May be empty.
	defaultTenantID string
}

// NewFederationService constructs the federation service. httpClient is used by
// the default OIDC provider factory.
func NewFederationService(
	connRepo repository.IdPConnectionRepository,
	identityRepo repository.ExternalIdentityRepository,
	userRepo repository.UserRepository,
	roleRepo repository.RoleRepository,
	authSvc *AuthService,
	redisClient *redis.Client,
	httpClient *http.Client,
	defaultTenantID string,
	logger zerolog.Logger,
) *FederationService {
	return &FederationService{
		connRepo:     connRepo,
		identityRepo: identityRepo,
		userRepo:     userRepo,
		roleRepo:     roleRepo,
		authSvc:      authSvc,
		redis:        redisClient,
		logger:       logger,
		newProvider: func(conn model.IdPConnection) (federation.Provider, error) {
			return federation.NewProvider(conn, httpClient)
		},
		flowTTL:         defaultSSOFlowTTL,
		defaultTenantID: defaultTenantID,
	}
}

// SetProviderFactory overrides the provider factory (used by tests).
func (s *FederationService) SetProviderFactory(f ProviderFactory) { s.newProvider = f }

// storedSSOFlow is the per-login state persisted between /login and /callback.
type storedSSOFlow struct {
	TenantID     string `json:"tenant_id"`
	Provider     string `json:"provider"`
	State        string `json:"state"`
	Nonce        string `json:"nonce"`
	CodeVerifier string `json:"code_verifier"`
	RedirectURL  string `json:"redirect_url"`
}

// LoginURL builds the IdP authorization redirect for a provider and persists the
// per-login state (state/nonce/PKCE verifier) so the callback can validate it.
func (s *FederationService) LoginURL(ctx context.Context, tenantID, provider string) (string, error) {
	conn, prov, err := s.resolveProvider(ctx, tenantID, provider)
	if err != nil {
		return "", err
	}

	state, err := randomToken(32)
	if err != nil {
		return "", &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "failed to generate state"}
	}
	nonce, err := randomToken(32)
	if err != nil {
		return "", &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "failed to generate nonce"}
	}
	verifier, err := randomToken(48)
	if err != nil {
		return "", &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "failed to generate PKCE verifier"}
	}

	authReq := federation.AuthRequest{
		RedirectURL:  conn.RedirectURL,
		State:        state,
		Nonce:        nonce,
		CodeVerifier: verifier,
	}

	urlStr, err := prov.AuthCodeURL(ctx, authReq)
	if err != nil {
		return "", &FederationError{Status: http.StatusBadGateway, Code: "IDP_ERROR", Message: fmt.Sprintf("failed to build authorization URL: %v", err)}
	}

	flow := storedSSOFlow{
		TenantID:     conn.TenantID,
		Provider:     conn.Provider,
		State:        state,
		Nonce:        nonce,
		CodeVerifier: verifier,
		RedirectURL:  conn.RedirectURL,
	}
	if err := s.storeFlow(ctx, state, flow); err != nil {
		return "", &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "failed to persist login state"}
	}

	return urlStr, nil
}

// DiscoverByDomain resolves an email domain (e.g. "acme.com") to the IdP
// connection mapped to it and returns the provider slug plus a ready-to-use
// authorization redirect URL. It reuses LoginURL so the same state/nonce/PKCE
// persistence applies, meaning the returned URL can be followed directly.
// Returns a 404 FederationError when no domain mapping exists.
func (s *FederationService) DiscoverByDomain(ctx context.Context, domain string) (provider string, authorizeURL string, err error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	if domain == "" {
		return "", "", &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "domain is required"}
	}

	conn, cerr := s.connRepo.GetByEmailDomain(ctx, domain)
	if cerr != nil {
		return "", "", &FederationError{Status: http.StatusNotFound, Code: "PROVIDER_NOT_FOUND", Message: "no identity provider is mapped to that email domain"}
	}

	url, lerr := s.LoginURL(ctx, conn.TenantID, conn.Provider)
	if lerr != nil {
		return "", "", lerr
	}
	return conn.Provider, url, nil
}

// Callback completes the login: it loads the stored flow by state, exchanges the
// code at the IdP, verifies the ID token, JIT-provisions or links the user, and
// returns a platform session (access + refresh tokens).
func (s *FederationService) Callback(ctx context.Context, provider string, params federation.CallbackParams, ip, userAgent string) (*dto.AuthResponse, error) {
	if params.Error != "" {
		return nil, &FederationError{Status: http.StatusUnauthorized, Code: "IDP_ERROR", Message: fmt.Sprintf("identity provider error: %s", params.Error)}
	}
	state := params.State
	if state == "" {
		state = params.RelayState
	}
	if state == "" {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "missing state"}
	}

	flow, err := s.loadFlow(ctx, state)
	if err != nil {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_STATE", Message: "login state is invalid, expired, or already used"}
	}
	// One-time use: delete state immediately to prevent replay.
	_ = s.deleteFlow(ctx, state)

	if flow.Provider != provider {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_STATE", Message: "state does not match provider"}
	}

	conn, prov, err := s.resolveProvider(ctx, flow.TenantID, flow.Provider)
	if err != nil {
		return nil, err
	}

	authReq := federation.AuthRequest{
		RedirectURL:  flow.RedirectURL,
		State:        flow.State,
		Nonce:        flow.Nonce,
		CodeVerifier: flow.CodeVerifier,
	}

	claims, err := prov.Exchange(ctx, authReq, params)
	if err != nil {
		return nil, &FederationError{Status: http.StatusUnauthorized, Code: "IDP_EXCHANGE_FAILED", Message: fmt.Sprintf("identity verification failed: %v", err)}
	}
	if claims == nil || claims.Subject == "" {
		return nil, &FederationError{Status: http.StatusUnauthorized, Code: "INVALID_ASSERTION", Message: "identity provider returned no subject"}
	}

	user, err := s.provisionOrLink(ctx, conn, claims)
	if err != nil {
		return nil, err
	}

	authResp, err := s.authSvc.IssueTokens(ctx, user, ip, userAgent)
	if err != nil {
		return nil, &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "failed to issue platform session"}
	}
	return authResp, nil
}

// provisionOrLink maps the external subject to a platform user: it links to an
// existing external identity, or links to an existing user by email, or (when
// JIT is allowed) creates a new user. The result always has roles populated.
func (s *FederationService) provisionOrLink(ctx context.Context, conn model.IdPConnection, claims *federation.ExternalClaims) (*model.User, error) {
	// 1. Existing external identity → load the linked platform user.
	existing, err := s.identityRepo.GetBySubject(ctx, conn.TenantID, conn.Provider, claims.Subject)
	if err == nil {
		user, uerr := s.userRepo.GetByID(ctx, existing.UserID)
		if uerr != nil {
			return nil, &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "linked user not found"}
		}
		_ = s.identityRepo.TouchLastLogin(ctx, existing.ID)
		return user, nil
	}

	// 2. Match by email within the tenant → link the existing user.
	if claims.Email != "" {
		if user, uerr := s.userRepo.GetByEmail(ctx, conn.TenantID, claims.Email); uerr == nil {
			if err := s.linkIdentity(ctx, conn, user.ID, claims); err != nil {
				return nil, err
			}
			return user, nil
		}
	}

	// 3. Just-in-time provisioning of a new platform user.
	if !conn.AllowJITProvisioning {
		return nil, &FederationError{Status: http.StatusForbidden, Code: "JIT_DISABLED", Message: "no platform account is linked to this identity and just-in-time provisioning is disabled"}
	}

	email := claims.Email
	if email == "" {
		// Synthesize a stable, unique placeholder email from the subject.
		email = strings.ToLower(claims.Subject) + "@" + conn.Provider + ".sso.local"
	}

	first, last := splitFederatedName(claims)
	newUser := &model.User{
		TenantID:      conn.TenantID,
		Email:         strings.ToLower(strings.TrimSpace(email)),
		FirstName:     first,
		LastName:      last,
		Status:        model.UserStatusActive,
		EmailVerified: true,
		// Federated accounts have no local password; PasswordHash stays empty
		// which makes password login impossible for this account.
	}
	if err := s.userRepo.Create(ctx, newUser); err != nil {
		return nil, &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: fmt.Sprintf("failed to provision user: %v", err)}
	}

	// Assign the connection's default role (best-effort).
	roleSlug := conn.DefaultRoleSlug
	if roleSlug == "" {
		roleSlug = "viewer"
	}
	if role, rerr := s.roleRepo.GetBySlug(ctx, conn.TenantID, roleSlug); rerr == nil && role != nil {
		if aerr := s.roleRepo.AssignToUser(ctx, newUser.ID, role.ID, conn.TenantID, newUser.ID); aerr != nil {
			s.logger.Warn().Err(aerr).Str("role", roleSlug).Msg("failed to assign default role to federated user")
		}
	} else {
		s.logger.Warn().Str("role", roleSlug).Msg("default role for federated user not found")
	}

	if err := s.linkIdentity(ctx, conn, newUser.ID, claims); err != nil {
		return nil, err
	}

	// Re-fetch so roles are populated for token issuance.
	created, err := s.userRepo.GetByID(ctx, newUser.ID)
	if err != nil {
		return nil, &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "failed to load provisioned user"}
	}
	return created, nil
}

func (s *FederationService) linkIdentity(ctx context.Context, conn model.IdPConnection, userID string, claims *federation.ExternalClaims) error {
	identity := &model.ExternalIdentity{
		TenantID:        conn.TenantID,
		UserID:          userID,
		Provider:        conn.Provider,
		ExternalSubject: claims.Subject,
		Email:           claims.Email,
		DisplayName:     claims.Name,
	}
	if err := s.identityRepo.Create(ctx, identity); err != nil {
		return &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: fmt.Sprintf("failed to link identity: %v", err)}
	}
	return nil
}

// ListConnections returns the configured (enabled) IdP connections for a tenant.
func (s *FederationService) ListConnections(ctx context.Context, tenantID string) ([]model.IdPConnection, error) {
	if tenantID == "" {
		tenantID = s.defaultTenantID
	}
	return s.connRepo.ListByTenant(ctx, tenantID)
}

func (s *FederationService) resolveProvider(ctx context.Context, tenantID, provider string) (model.IdPConnection, federation.Provider, error) {
	if tenantID == "" {
		tenantID = s.defaultTenantID
	}
	if tenantID == "" {
		return model.IdPConnection{}, nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "tenant could not be determined for SSO"}
	}

	conn, err := s.connRepo.GetByProvider(ctx, tenantID, provider)
	if err != nil {
		return model.IdPConnection{}, nil, &FederationError{Status: http.StatusNotFound, Code: "PROVIDER_NOT_FOUND", Message: "no enabled identity provider with that name"}
	}
	prov, err := s.newProvider(*conn)
	if err != nil {
		return model.IdPConnection{}, nil, &FederationError{Status: http.StatusInternalServerError, Code: "PROVIDER_CONFIG_ERROR", Message: fmt.Sprintf("identity provider is misconfigured: %v", err)}
	}
	return *conn, prov, nil
}

func (s *FederationService) storeFlow(ctx context.Context, state string, flow storedSSOFlow) error {
	if s.redis == nil {
		return fmt.Errorf("redis is required for sso flow state")
	}
	data, err := json.Marshal(flow)
	if err != nil {
		return err
	}
	return s.redis.Set(ctx, ssoStatePrefix+state, data, s.flowTTL).Err()
}

func (s *FederationService) loadFlow(ctx context.Context, state string) (*storedSSOFlow, error) {
	if s.redis == nil {
		return nil, fmt.Errorf("redis is required for sso flow state")
	}
	raw, err := s.redis.Get(ctx, ssoStatePrefix+state).Bytes()
	if err != nil {
		return nil, err
	}
	var flow storedSSOFlow
	if err := json.Unmarshal(raw, &flow); err != nil {
		return nil, err
	}
	return &flow, nil
}

func (s *FederationService) deleteFlow(ctx context.Context, state string) error {
	if s.redis == nil {
		return nil
	}
	return s.redis.Del(ctx, ssoStatePrefix+state).Err()
}

func splitFederatedName(claims *federation.ExternalClaims) (first, last string) {
	if claims.GivenName != "" || claims.FamilyName != "" {
		return claims.GivenName, claims.FamilyName
	}
	name := strings.TrimSpace(claims.Name)
	if name == "" {
		return "SSO", "User"
	}
	parts := strings.Fields(name)
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.Join(parts[1:], " ")
}

func randomToken(n int) (string, error) {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
