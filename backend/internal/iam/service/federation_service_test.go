package service

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/iam/federation"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
)

// ---- in-memory fakes specific to the federation test ----------------------

type fedUserRepo struct {
	users map[string]*model.User
}

func newFedUserRepo(seed ...*model.User) *fedUserRepo {
	m := map[string]*model.User{}
	for _, u := range seed {
		m[u.ID] = u
	}
	return &fedUserRepo{users: m}
}

func (f *fedUserRepo) Create(_ context.Context, u *model.User) error {
	if u.ID == "" {
		u.ID = uuid.NewString()
	}
	u.CreatedAt = time.Now()
	u.UpdatedAt = time.Now()
	cp := *u
	f.users[u.ID] = &cp
	return nil
}
func (f *fedUserRepo) GetByID(_ context.Context, id string) (*model.User, error) {
	u, ok := f.users[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	cp := *u
	return &cp, nil
}
func (f *fedUserRepo) GetByEmail(_ context.Context, tenantID, email string) (*model.User, error) {
	for _, u := range f.users {
		if u.TenantID == tenantID && u.Email == email {
			cp := *u
			return &cp, nil
		}
	}
	return nil, model.ErrNotFound
}
func (f *fedUserRepo) GetByEmailGlobal(_ context.Context, email string) (*model.User, error) {
	for _, u := range f.users {
		if u.Email == email {
			cp := *u
			return &cp, nil
		}
	}
	return nil, model.ErrNotFound
}
func (f *fedUserRepo) List(context.Context, string, repository.UserFilter) ([]model.User, int, error) {
	return nil, 0, nil
}
func (f *fedUserRepo) Update(context.Context, *model.User) error        { return nil }
func (f *fedUserRepo) SoftDelete(context.Context, string, string) error { return nil }
func (f *fedUserRepo) UpdateStatus(context.Context, string, model.UserStatus, string) error {
	return nil
}
func (f *fedUserRepo) UpdatePassword(context.Context, string, string) error   { return nil }
func (f *fedUserRepo) UpdateMFA(context.Context, string, bool, *string) error { return nil }
func (f *fedUserRepo) UpdateLastLogin(context.Context, string) error          { return nil }
func (f *fedUserRepo) CountByTenant(context.Context, string) (int, error)     { return len(f.users), nil }

type fedRoleRepo struct{}

func (fedRoleRepo) Create(context.Context, *model.Role) error { return nil }
func (fedRoleRepo) GetByID(context.Context, string) (*model.Role, error) {
	return nil, model.ErrNotFound
}
func (fedRoleRepo) GetBySlug(_ context.Context, tenantID, slug string) (*model.Role, error) {
	return &model.Role{ID: "role-" + slug, TenantID: tenantID, Slug: slug, Permissions: []string{"*:read"}}, nil
}
func (fedRoleRepo) List(context.Context, string) ([]model.Role, error) { return nil, nil }
func (fedRoleRepo) Update(context.Context, *model.Role) error          { return nil }
func (fedRoleRepo) Delete(context.Context, string) error               { return nil }
func (fedRoleRepo) AssignToUser(context.Context, string, string, string, string) error {
	return nil
}
func (fedRoleRepo) RemoveFromUser(context.Context, string, string) error       { return nil }
func (fedRoleRepo) GetUserRoles(context.Context, string) ([]model.Role, error) { return nil, nil }
func (fedRoleRepo) ListUserIDsByRole(context.Context, string, string) ([]string, error) {
	return nil, nil
}
func (fedRoleRepo) SeedSystemRoles(context.Context, string) error { return nil }

type fedSessionRepo struct{ sessions map[string]*model.Session }

func (f *fedSessionRepo) Create(_ context.Context, s *model.Session) error {
	if s.ID == "" {
		s.ID = uuid.NewString()
	}
	f.sessions[s.ID] = s
	return nil
}
func (f *fedSessionRepo) GetByTokenHash(context.Context, string) (*model.Session, error) {
	return nil, model.ErrNotFound
}
func (f *fedSessionRepo) GetByUserID(context.Context, string, string) ([]model.Session, error) {
	return nil, nil
}
func (f *fedSessionRepo) UpdateLastActive(context.Context, string) error { return nil }
func (f *fedSessionRepo) Delete(context.Context, string) error           { return nil }
func (f *fedSessionRepo) DeleteByUserID(context.Context, string) error   { return nil }
func (f *fedSessionRepo) DeleteExpired(context.Context) (int64, error)   { return 0, nil }

type fedTenantRepo struct{ tenants map[string]*model.Tenant }

func (f *fedTenantRepo) Create(context.Context, *model.Tenant) error { return nil }
func (f *fedTenantRepo) GetByID(_ context.Context, id string) (*model.Tenant, error) {
	t, ok := f.tenants[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	cp := *t
	return &cp, nil
}
func (f *fedTenantRepo) GetBySlug(context.Context, string) (*model.Tenant, error) {
	return nil, model.ErrNotFound
}
func (f *fedTenantRepo) List(context.Context, int, int, repository.TenantListParams) ([]model.Tenant, int, error) {
	return nil, 0, nil
}
func (f *fedTenantRepo) Update(context.Context, *model.Tenant) error { return nil }

type fedConnRepo struct {
	conns map[string]*model.IdPConnection
} // key: tenant|provider

func (f *fedConnRepo) GetByProvider(_ context.Context, tenantID, provider string) (*model.IdPConnection, error) {
	c, ok := f.conns[tenantID+"|"+provider]
	if !ok {
		return nil, model.ErrNotFound
	}
	cp := *c
	return &cp, nil
}
func (f *fedConnRepo) ListByTenant(_ context.Context, tenantID string) ([]model.IdPConnection, error) {
	var out []model.IdPConnection
	for _, c := range f.conns {
		if c.TenantID == tenantID {
			out = append(out, *c)
		}
	}
	return out, nil
}

// GetByEmailDomain mocks domain→connection resolution. Test fixtures may key
// an entry as "domain|"+domain to register a domain mapping.
func (f *fedConnRepo) GetByEmailDomain(_ context.Context, domain string) (*model.IdPConnection, error) {
	c, ok := f.conns["domain|"+domain]
	if !ok {
		return nil, model.ErrNotFound
	}
	cp := *c
	return &cp, nil
}

type fedIdentityRepo struct{ identities []*model.ExternalIdentity }

func (f *fedIdentityRepo) GetBySubject(_ context.Context, tenantID, provider, sub string) (*model.ExternalIdentity, error) {
	for _, e := range f.identities {
		if e.TenantID == tenantID && e.Provider == provider && e.ExternalSubject == sub {
			cp := *e
			return &cp, nil
		}
	}
	return nil, model.ErrNotFound
}
func (f *fedIdentityRepo) ListByUser(_ context.Context, userID string) ([]model.ExternalIdentity, error) {
	var out []model.ExternalIdentity
	for _, e := range f.identities {
		if e.UserID == userID {
			out = append(out, *e)
		}
	}
	return out, nil
}
func (f *fedIdentityRepo) Create(_ context.Context, e *model.ExternalIdentity) error {
	if e.ID == "" {
		e.ID = uuid.NewString()
	}
	e.CreatedAt = time.Now()
	cp := *e
	f.identities = append(f.identities, &cp)
	return nil
}
func (f *fedIdentityRepo) TouchLastLogin(context.Context, string) error { return nil }
func (f *fedIdentityRepo) Delete(context.Context, string, string, string) error {
	return nil
}

// stubProvider returns fixed claims, simulating a verified IdP assertion.
type stubProvider struct {
	kind   model.IdPKind
	claims *federation.ExternalClaims
}

func (s *stubProvider) Kind() model.IdPKind { return s.kind }
func (s *stubProvider) AuthCodeURL(_ context.Context, req federation.AuthRequest) (string, error) {
	return "https://idp.example.com/authorize?state=" + req.State + "&nonce=" + req.Nonce, nil
}
func (s *stubProvider) Exchange(_ context.Context, _ federation.AuthRequest, _ federation.CallbackParams) (*federation.ExternalClaims, error) {
	return s.claims, nil
}

// ---- the test -------------------------------------------------------------

func newFederationTest(t *testing.T, claims *federation.ExternalClaims, conn model.IdPConnection, seedUsers ...*model.User) (*FederationService, *fedUserRepo, *fedIdentityRepo, *miniredis.Miniredis) {
	t.Helper()
	redisSrv := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: redisSrv.Addr()})

	jwtMgr, err := auth.NewJWTManager(config.AuthConfig{
		JWTIssuer:       "clario360-test",
		AccessTokenTTL:  15 * time.Minute,
		RefreshTokenTTL: 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager: %v", err)
	}

	userRepo := newFedUserRepo(seedUsers...)
	roleRepo := fedRoleRepo{}
	sessionRepo := &fedSessionRepo{sessions: map[string]*model.Session{}}
	tenantRepo := &fedTenantRepo{tenants: map[string]*model.Tenant{
		conn.TenantID: {ID: conn.TenantID, Name: "Acme", Slug: "acme"},
	}}
	connRepo := &fedConnRepo{conns: map[string]*model.IdPConnection{
		conn.TenantID + "|" + conn.Provider: &conn,
	}}
	identityRepo := &fedIdentityRepo{}

	authSvc := NewAuthService(userRepo, sessionRepo, roleRepo, tenantRepo, jwtMgr, rdb, nil, zerolog.New(ioDiscard{}), 4, 24*time.Hour)

	fed := NewFederationService(connRepo, identityRepo, userRepo, roleRepo, authSvc, rdb, nil, "", zerolog.New(ioDiscard{}))
	fed.SetProviderFactory(func(c model.IdPConnection) (federation.Provider, error) {
		return &stubProvider{kind: c.Kind, claims: claims}, nil
	})
	return fed, userRepo, identityRepo, redisSrv
}

func sampleConn() model.IdPConnection {
	return model.IdPConnection{
		ID:                   "conn-1",
		TenantID:             "tenant-1",
		Provider:             "nafath",
		Kind:                 model.IdPKindNafath,
		Enabled:              true,
		ClientID:             "rp",
		RedirectURL:          "https://app/cb",
		DefaultRoleSlug:      "viewer",
		AllowJITProvisioning: true,
		Scopes:               []string{"openid", "profile"},
	}
}

// TestFederation_FullLoginCallback_JITProvision proves the complete flow:
// login builds an IdP redirect with state, callback exchanges + verifies via the
// provider, a NEW platform user is provisioned just-in-time and linked, and a
// platform session (access + refresh) is issued.
func TestFederation_FullLoginCallback_JITProvision(t *testing.T) {
	claims := &federation.ExternalClaims{
		Subject: "national-12345",
		Email:   "newuser@example.com",
		Name:    "New User",
	}
	conn := sampleConn()
	fed, userRepo, identityRepo, redisSrv := newFederationTest(t, claims, conn)
	defer redisSrv.Close()

	ctx := context.Background()

	// 1. Login builds the IdP redirect and persists state.
	loginURL, err := fed.LoginURL(ctx, conn.TenantID, conn.Provider)
	if err != nil {
		t.Fatalf("LoginURL: %v", err)
	}
	if loginURL == "" {
		t.Fatalf("expected non-empty login URL")
	}
	// Extract state to feed into the callback.
	state := redisStateOnly(t, redisSrv)

	// 2. Callback completes the flow.
	authResp, err := fed.Callback(ctx, conn.Provider, federation.CallbackParams{Code: "code", State: state}, "1.2.3.4", "test-agent")
	if err != nil {
		t.Fatalf("Callback: %v", err)
	}
	if authResp.AccessToken == "" || authResp.RefreshToken == "" {
		t.Fatalf("expected platform tokens to be issued")
	}

	// 3. A user was provisioned and linked.
	if len(userRepo.users) != 1 {
		t.Fatalf("expected 1 provisioned user, got %d", len(userRepo.users))
	}
	if len(identityRepo.identities) != 1 {
		t.Fatalf("expected 1 linked external identity, got %d", len(identityRepo.identities))
	}
	if identityRepo.identities[0].ExternalSubject != claims.Subject {
		t.Fatalf("linked identity subject mismatch")
	}
}

// TestFederation_LinksExistingUserByEmail proves that an external identity is
// linked to a pre-existing platform user matched by email (no duplicate user).
func TestFederation_LinksExistingUserByEmail(t *testing.T) {
	existing := &model.User{
		ID: "user-existing", TenantID: "tenant-1", Email: "staff@example.com",
		FirstName: "Staff", LastName: "Member", Status: model.UserStatusActive,
		Roles: []model.Role{{ID: "r1", Slug: "analyst", Permissions: []string{"data:read"}}},
	}
	claims := &federation.ExternalClaims{Subject: "ext-staff", Email: "staff@example.com", Name: "Staff Member"}
	conn := sampleConn()
	fed, userRepo, identityRepo, redisSrv := newFederationTest(t, claims, conn, existing)
	defer redisSrv.Close()

	ctx := context.Background()
	if _, err := fed.LoginURL(ctx, conn.TenantID, conn.Provider); err != nil {
		t.Fatalf("LoginURL: %v", err)
	}
	state := redisStateOnly(t, redisSrv)

	authResp, err := fed.Callback(ctx, conn.Provider, federation.CallbackParams{Code: "c", State: state}, "", "")
	if err != nil {
		t.Fatalf("Callback: %v", err)
	}
	if authResp.User.ID != "user-existing" {
		t.Fatalf("expected to link existing user, got %q", authResp.User.ID)
	}
	if len(userRepo.users) != 1 {
		t.Fatalf("expected no new user to be created, got %d", len(userRepo.users))
	}
	if len(identityRepo.identities) != 1 {
		t.Fatalf("expected identity to be linked, got %d", len(identityRepo.identities))
	}
}

// TestFederation_SecondLoginReusesLink proves a previously-linked subject signs
// in without creating a new user or a new link.
func TestFederation_SecondLoginReusesLink(t *testing.T) {
	claims := &federation.ExternalClaims{Subject: "repeat-sub", Email: "repeat@example.com", Name: "Repeat User"}
	conn := sampleConn()
	fed, userRepo, identityRepo, redisSrv := newFederationTest(t, claims, conn)
	defer redisSrv.Close()
	ctx := context.Background()

	// First login provisions + links.
	_, _ = fed.LoginURL(ctx, conn.TenantID, conn.Provider)
	state1 := redisStateOnly(t, redisSrv)
	if _, err := fed.Callback(ctx, conn.Provider, federation.CallbackParams{Code: "c", State: state1}, "", ""); err != nil {
		t.Fatalf("first callback: %v", err)
	}
	usersAfterFirst := len(userRepo.users)
	linksAfterFirst := len(identityRepo.identities)

	// Second login reuses the link.
	_, _ = fed.LoginURL(ctx, conn.TenantID, conn.Provider)
	state2 := redisStateOnly(t, redisSrv)
	if _, err := fed.Callback(ctx, conn.Provider, federation.CallbackParams{Code: "c", State: state2}, "", ""); err != nil {
		t.Fatalf("second callback: %v", err)
	}
	if len(userRepo.users) != usersAfterFirst {
		t.Fatalf("second login created an extra user")
	}
	if len(identityRepo.identities) != linksAfterFirst {
		t.Fatalf("second login created an extra link")
	}
}

// TestFederation_StateReplayRejected proves the one-time state cannot be reused.
func TestFederation_StateReplayRejected(t *testing.T) {
	claims := &federation.ExternalClaims{Subject: "s", Email: "s@example.com"}
	conn := sampleConn()
	fed, _, _, redisSrv := newFederationTest(t, claims, conn)
	defer redisSrv.Close()
	ctx := context.Background()

	_, _ = fed.LoginURL(ctx, conn.TenantID, conn.Provider)
	state := redisStateOnly(t, redisSrv)

	if _, err := fed.Callback(ctx, conn.Provider, federation.CallbackParams{Code: "c", State: state}, "", ""); err != nil {
		t.Fatalf("first callback should succeed: %v", err)
	}
	// Replaying the same state must fail (one-time use).
	if _, err := fed.Callback(ctx, conn.Provider, federation.CallbackParams{Code: "c", State: state}, "", ""); err == nil {
		t.Fatalf("expected replayed state to be rejected")
	}
}

// TestFederation_JITDisabled_UnknownSubjectDenied proves JIT-off blocks unknown subjects.
func TestFederation_JITDisabled_UnknownSubjectDenied(t *testing.T) {
	claims := &federation.ExternalClaims{Subject: "unknown", Email: "unknown@example.com"}
	conn := sampleConn()
	conn.AllowJITProvisioning = false
	fed, _, _, redisSrv := newFederationTest(t, claims, conn)
	defer redisSrv.Close()
	ctx := context.Background()

	_, _ = fed.LoginURL(ctx, conn.TenantID, conn.Provider)
	state := redisStateOnly(t, redisSrv)

	_, err := fed.Callback(ctx, conn.Provider, federation.CallbackParams{Code: "c", State: state}, "", "")
	if err == nil {
		t.Fatalf("expected denial when JIT provisioning is disabled")
	}
}

// redisStateOnly returns the single SSO state key currently stored in redis.
func redisStateOnly(t *testing.T, srv *miniredis.Miniredis) string {
	t.Helper()
	for _, k := range srv.Keys() {
		if len(k) > len(ssoStatePrefix) && k[:len(ssoStatePrefix)] == ssoStatePrefix {
			return k[len(ssoStatePrefix):]
		}
	}
	t.Fatalf("no sso state key found in redis")
	return ""
}
