package integration

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Inbound SCIM 2.0 server (kind=hr; SCIM PUSH provisioning).
//
// An external IdP (Entra/Okta/Keycloak) PUSHES users + groups to lex via the
// SCIM 2.0 protocol. This server is the inbound counterpart to the HRConnector's
// outbound scim_client pull. It is mounted OUTSIDE the JWT chain and authenticates
// each request with a PER-TENANT BEARER token whose sha256 hash is stored in
// lex_scim_tokens (the raw token is shown to the operator once at issue time).
//
//   GET    /scim/v2/ServiceProviderConfig   (discovery; bearer-gated)
//   GET    /scim/v2/ResourceTypes
//   GET    /scim/v2/Schemas
//   GET    /scim/v2/Users        (list; minimal — provisioning is push)
//   POST   /scim/v2/Users        (create)
//   GET    /scim/v2/Users/{id}
//   PUT    /scim/v2/Users/{id}   (replace)
//   PATCH  /scim/v2/Users/{id}   (active=false → soft-deactivate)
//   DELETE /scim/v2/Users/{id}   (soft-deactivate)
//   ...same verbs for /Groups
//
// SECURITY. The bearer is resolved to a tenant+endpoint by HASH (never compared in
// cleartext); on resolution the request is processed tenant-scoped. Tokens are
// never logged. active=false is a reversible soft-deactivation, never a hard
// delete. Idempotency uses lex_hr_identity_map keyed on the SCIM externalId.
// =============================================================================

// scimTenantCtxKey carries the resolved SCIM token (tenant + endpoint) on the
// request context after the bearer middleware authenticates.
type scimTenantCtxKey struct{}

// SCIMServer is the inbound SCIM 2.0 HTTP server. It resolves the per-tenant
// bearer, then provisions org entities/roles via the same repositories the
// HRConnector uses, recording idempotency in lex_hr_identity_map.
type SCIMServer struct {
	idMap   hrIdentityStore
	orgRepo hrOrgStore
	logger  zerolog.Logger
	now     func() time.Time
}

// NewSCIMServer builds the inbound SCIM server. Both repositories are required.
func NewSCIMServer(idMap hrIdentityStore, orgRepo hrOrgStore, logger zerolog.Logger) *SCIMServer {
	return &SCIMServer{
		idMap:   idMap,
		orgRepo: orgRepo,
		logger:  logger.With().Str("component", "lex-scim-server").Logger(),
		now:     time.Now,
	}
}

// Routes returns the SCIM 2.0 router for mounting at /scim/v2 OUTSIDE the JWT
// chain. The bearer middleware authenticates every request (including discovery).
func (s *SCIMServer) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(s.bearerAuth)

	r.Get("/ServiceProviderConfig", s.serviceProviderConfig)
	r.Get("/ResourceTypes", s.resourceTypes)
	r.Get("/Schemas", s.schemas)

	r.Route("/Users", func(r chi.Router) {
		r.Get("/", s.listUsers)
		r.Post("/", s.createUser)
		r.Get("/{id}", s.getUser)
		r.Put("/{id}", s.putUser)
		r.Patch("/{id}", s.patchUser)
		r.Delete("/{id}", s.deleteResource(repository.HRExternalKindUser))
	})
	r.Route("/Groups", func(r chi.Router) {
		r.Get("/", s.listGroups)
		r.Post("/", s.createGroup)
		r.Get("/{id}", s.getGroup)
		r.Put("/{id}", s.putGroup)
		r.Patch("/{id}", s.patchGroup)
		r.Delete("/{id}", s.deleteResource(repository.HRExternalKindGroup))
	})
	return r
}

// =============================================================================
// Bearer auth middleware — resolves tenant + endpoint from the token hash.
// =============================================================================

func (s *SCIMServer) bearerAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw := strings.TrimSpace(r.Header.Get("Authorization"))
		const prefix = "Bearer "
		if !strings.HasPrefix(raw, prefix) {
			s.scimError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}
		token := strings.TrimSpace(raw[len(prefix):])
		if token == "" {
			s.scimError(w, http.StatusUnauthorized, "empty bearer token")
			return
		}
		hash := repository.HashSCIMToken(token)
		tok, err := s.idMap.ResolveTokenByHash(r.Context(), hash, s.now().UTC())
		if err != nil {
			// Do not distinguish "no such token" from "revoked/expired" to avoid
			// an oracle; never log the token.
			s.scimError(w, http.StatusUnauthorized, "invalid bearer token")
			return
		}
		_ = s.idMap.TouchTokenUsed(r.Context(), tok.TenantID, tok.ID, s.now().UTC())
		ctx := context.WithValue(r.Context(), scimTenantCtxKey{}, tok)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func scimTokenFromCtx(ctx context.Context) (*repository.SCIMToken, bool) {
	tok, ok := ctx.Value(scimTenantCtxKey{}).(*repository.SCIMToken)
	return tok, ok
}

// =============================================================================
// Discovery endpoints (SCIM 2.0 §4).
// =============================================================================

func (s *SCIMServer) serviceProviderConfig(w http.ResponseWriter, r *http.Request) {
	cfg := map[string]any{
		"schemas":               []string{"urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"},
		"documentationUri":      "",
		"patch":                 map[string]any{"supported": true},
		"bulk":                  map[string]any{"supported": false, "maxOperations": 0, "maxPayloadSize": 0},
		"filter":                map[string]any{"supported": true, "maxResults": 200},
		"changePassword":        map[string]any{"supported": false},
		"sort":                  map[string]any{"supported": false},
		"etag":                  map[string]any{"supported": false},
		"authenticationSchemes": []map[string]any{{"type": "oauthbearertoken", "name": "OAuth Bearer Token", "description": "Per-tenant bearer token"}},
	}
	s.writeSCIM(w, http.StatusOK, cfg)
}

func (s *SCIMServer) resourceTypes(w http.ResponseWriter, r *http.Request) {
	types := []map[string]any{
		{
			"schemas":     []string{"urn:ietf:params:scim:schemas:core:2.0:ResourceType"},
			"id":          "User",
			"name":        "User",
			"endpoint":    "/Users",
			"schema":      "urn:ietf:params:scim:schemas:core:2.0:User",
			"description": "User Account",
		},
		{
			"schemas":     []string{"urn:ietf:params:scim:schemas:core:2.0:ResourceType"},
			"id":          "Group",
			"name":        "Group",
			"endpoint":    "/Groups",
			"schema":      "urn:ietf:params:scim:schemas:core:2.0:Group",
			"description": "Group",
		},
	}
	s.writeSCIMList(w, types)
}

func (s *SCIMServer) schemas(w http.ResponseWriter, r *http.Request) {
	schemas := []map[string]any{
		{"id": "urn:ietf:params:scim:schemas:core:2.0:User", "name": "User"},
		{"id": "urn:ietf:params:scim:schemas:core:2.0:Group", "name": "Group"},
	}
	s.writeSCIMList(w, schemas)
}

// =============================================================================
// Users.
// =============================================================================

// scimUser is the subset of the SCIM 2.0 User schema we consume.
type scimUser struct {
	Schemas     []string       `json:"schemas,omitempty"`
	ID          string         `json:"id,omitempty"`
	ExternalID  string         `json:"externalId,omitempty"`
	UserName    string         `json:"userName,omitempty"`
	DisplayName string         `json:"displayName,omitempty"`
	Active      *bool          `json:"active,omitempty"`
	Name        *scimName      `json:"name,omitempty"`
	Meta        map[string]any `json:"meta,omitempty"`
	// Lex extension carries optional provisioning hints (org code, role, lex user id).
	Lex *scimLexExtension `json:"urn:clario360:lex:1.0:User,omitempty"`
}

type scimName struct {
	Formatted  string `json:"formatted,omitempty"`
	GivenName  string `json:"givenName,omitempty"`
	FamilyName string `json:"familyName,omitempty"`
}

type scimLexExtension struct {
	OrgCode          string `json:"orgCode,omitempty"`
	RoleKey          string `json:"roleKey,omitempty"`
	LexUserID        string `json:"lexUserId,omitempty"`
	ParentOrgCode    string `json:"parentOrgCode,omitempty"`
	EntityType       string `json:"entityType,omitempty"`
	ManagerLexUserID string `json:"managerLexUserId,omitempty"`
}

func (s *SCIMServer) listUsers(w http.ResponseWriter, r *http.Request) {
	// Provisioning is push; list returns an empty, well-formed page so an IdP's
	// pre-sync reconciliation call succeeds without exposing the directory.
	s.writeSCIMListResources(w, []map[string]any{})
}

func (s *SCIMServer) createUser(w http.ResponseWriter, r *http.Request) {
	tok, ok := scimTokenFromCtx(r.Context())
	if !ok {
		s.scimError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var u scimUser
	if err := decodeJSON(r, &u); err != nil {
		s.scimError(w, http.StatusBadRequest, "invalid SCIM payload")
		return
	}
	rec := u.toRecord()
	if rec.ExternalID == "" {
		s.scimError(w, http.StatusBadRequest, "userName or externalId is required")
		return
	}
	resID, err := s.provision(r.Context(), tok, rec)
	if err != nil {
		s.scimError(w, http.StatusInternalServerError, "provisioning failed")
		return
	}
	s.writeSCIM(w, http.StatusCreated, s.userResource(rec, resID))
}

func (s *SCIMServer) getUser(w http.ResponseWriter, r *http.Request) {
	s.getResource(w, r, repository.HRExternalKindUser)
}

func (s *SCIMServer) putUser(w http.ResponseWriter, r *http.Request) {
	tok, ok := scimTokenFromCtx(r.Context())
	if !ok {
		s.scimError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var u scimUser
	if err := decodeJSON(r, &u); err != nil {
		s.scimError(w, http.StatusBadRequest, "invalid SCIM payload")
		return
	}
	rec := u.toRecord()
	rec.ExternalID = firstNonEmpty(chi.URLParam(r, "id"), rec.ExternalID)
	if rec.ExternalID == "" {
		s.scimError(w, http.StatusBadRequest, "id is required")
		return
	}
	resID, err := s.provision(r.Context(), tok, rec)
	if err != nil {
		s.scimError(w, http.StatusInternalServerError, "provisioning failed")
		return
	}
	s.writeSCIM(w, http.StatusOK, s.userResource(rec, resID))
}

func (s *SCIMServer) patchUser(w http.ResponseWriter, r *http.Request) {
	s.patchActive(w, r, repository.HRExternalKindUser)
}

// =============================================================================
// Groups.
// =============================================================================

type scimGroup struct {
	Schemas     []string          `json:"schemas,omitempty"`
	ID          string            `json:"id,omitempty"`
	ExternalID  string            `json:"externalId,omitempty"`
	DisplayName string            `json:"displayName,omitempty"`
	Meta        map[string]any    `json:"meta,omitempty"`
	Lex         *scimLexExtension `json:"urn:clario360:lex:1.0:Group,omitempty"`
}

func (s *SCIMServer) listGroups(w http.ResponseWriter, r *http.Request) {
	s.writeSCIMListResources(w, []map[string]any{})
}

func (s *SCIMServer) createGroup(w http.ResponseWriter, r *http.Request) {
	tok, ok := scimTokenFromCtx(r.Context())
	if !ok {
		s.scimError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var g scimGroup
	if err := decodeJSON(r, &g); err != nil {
		s.scimError(w, http.StatusBadRequest, "invalid SCIM payload")
		return
	}
	rec := g.toRecord()
	if rec.ExternalID == "" {
		s.scimError(w, http.StatusBadRequest, "displayName or externalId is required")
		return
	}
	resID, err := s.provision(r.Context(), tok, rec)
	if err != nil {
		s.scimError(w, http.StatusInternalServerError, "provisioning failed")
		return
	}
	s.writeSCIM(w, http.StatusCreated, s.groupResource(rec, resID))
}

func (s *SCIMServer) getGroup(w http.ResponseWriter, r *http.Request) {
	s.getResource(w, r, repository.HRExternalKindGroup)
}

func (s *SCIMServer) putGroup(w http.ResponseWriter, r *http.Request) {
	tok, ok := scimTokenFromCtx(r.Context())
	if !ok {
		s.scimError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	var g scimGroup
	if err := decodeJSON(r, &g); err != nil {
		s.scimError(w, http.StatusBadRequest, "invalid SCIM payload")
		return
	}
	rec := g.toRecord()
	rec.ExternalID = firstNonEmpty(chi.URLParam(r, "id"), rec.ExternalID)
	if rec.ExternalID == "" {
		s.scimError(w, http.StatusBadRequest, "id is required")
		return
	}
	resID, err := s.provision(r.Context(), tok, rec)
	if err != nil {
		s.scimError(w, http.StatusInternalServerError, "provisioning failed")
		return
	}
	s.writeSCIM(w, http.StatusOK, s.groupResource(rec, resID))
}

func (s *SCIMServer) patchGroup(w http.ResponseWriter, r *http.Request) {
	s.patchActive(w, r, repository.HRExternalKindGroup)
}

// =============================================================================
// Shared resource ops.
// =============================================================================

// getResource returns the stored mapping for an external id (404 when unknown).
func (s *SCIMServer) getResource(w http.ResponseWriter, r *http.Request, kind repository.HRExternalKind) {
	tok, ok := scimTokenFromCtx(r.Context())
	if !ok {
		s.scimError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id := chi.URLParam(r, "id")
	m, err := s.idMap.GetMapping(r.Context(), s.idMap.Pool(), tok.TenantID, tok.EndpointID, id)
	if err != nil {
		s.scimError(w, http.StatusNotFound, "resource not found")
		return
	}
	res := map[string]any{
		"id":         m.ExternalID,
		"externalId": m.ExternalID,
		"active":     m.Active,
		"meta":       map[string]any{"resourceType": scimResourceType(kind), "lastModified": m.LastSyncedAt.UTC().Format(time.RFC3339)},
	}
	s.writeSCIM(w, http.StatusOK, res)
}

// patchActive handles the dominant SCIM PATCH case used by IdPs: setting
// active=false to deprovision. Any PATCH that resolves to active=false
// soft-deactivates; active=true reactivation re-runs provisioning is not possible
// from a bare PATCH (no attributes), so it just clears the deactivation.
func (s *SCIMServer) patchActive(w http.ResponseWriter, r *http.Request, kind repository.HRExternalKind) {
	tok, ok := scimTokenFromCtx(r.Context())
	if !ok {
		s.scimError(w, http.StatusUnauthorized, "unauthenticated")
		return
	}
	id := chi.URLParam(r, "id")
	active, err := parseScimPatchActive(r)
	if err != nil {
		s.scimError(w, http.StatusBadRequest, "invalid PATCH payload")
		return
	}
	if active != nil && !*active {
		if derr := s.idMap.SoftDeactivate(r.Context(), s.idMap.Pool(), tok.TenantID, tok.EndpointID, id, s.now().UTC()); derr != nil && derr != pgx.ErrNoRows {
			s.scimError(w, http.StatusInternalServerError, "deactivation failed")
			return
		}
	}
	m, gerr := s.idMap.GetMapping(r.Context(), s.idMap.Pool(), tok.TenantID, tok.EndpointID, id)
	if gerr != nil {
		s.scimError(w, http.StatusNotFound, "resource not found")
		return
	}
	s.writeSCIM(w, http.StatusOK, map[string]any{
		"id":         m.ExternalID,
		"externalId": m.ExternalID,
		"active":     m.Active,
		"meta":       map[string]any{"resourceType": scimResourceType(kind)},
	})
}

// deleteResource soft-deactivates the mapping (SCIM DELETE is treated as
// deprovision, not hard delete, for audit + reactivation).
func (s *SCIMServer) deleteResource(kind repository.HRExternalKind) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tok, ok := scimTokenFromCtx(r.Context())
		if !ok {
			s.scimError(w, http.StatusUnauthorized, "unauthenticated")
			return
		}
		id := chi.URLParam(r, "id")
		if err := s.idMap.SoftDeactivate(r.Context(), s.idMap.Pool(), tok.TenantID, tok.EndpointID, id, s.now().UTC()); err != nil && err != pgx.ErrNoRows {
			s.scimError(w, http.StatusInternalServerError, "deactivation failed")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// provision reconciles one inbound SCIM resource into the org registry + identity
// map. Groups become OrgEntity rows; users with a resolvable org+role+lex-user
// become UpsertRole bindings; otherwise the user is recorded as a known (unbound)
// identity. Idempotency is keyed on the SCIM externalId via content hash.
func (s *SCIMServer) provision(ctx context.Context, tok *repository.SCIMToken, rec hrRecord) (uuid.UUID, error) {
	tenantID := tok.TenantID
	hash := rec.contentHash()

	// Skip no-op replays.
	if existing, err := s.idMap.GetMapping(ctx, s.idMap.Pool(), tenantID, tok.EndpointID, rec.ExternalID); err == nil {
		if existing.ContentHash == hash && existing.Active {
			return existing.LexID, nil
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, err
	}

	switch rec.kind() {
	case repository.HRExternalKindGroup, repository.HRExternalKindOrgUnit:
		entity, err := s.upsertEntity(ctx, tok, rec)
		if err != nil {
			return uuid.Nil, err
		}
		if managerID, parseErr := uuid.Parse(strings.TrimSpace(rec.ManagerLexUserID)); parseErr == nil {
			role := &model.OrgRole{ID: uuid.New(), TenantID: tenantID, EntityID: entity.ID, RoleKey: managerRoleKeyForHR(entity.EntityType), UserID: managerID, Label: forms.LocalizedText{AR: rec.DisplayName, EN: rec.DisplayName}}
			if err := s.orgRepo.UpsertRole(ctx, s.idMap.Pool(), role); err != nil {
				return uuid.Nil, err
			}
		}
		_, err = s.idMap.UpsertMapping(ctx, s.idMap.Pool(), &repository.HRIdentityMapping{
			TenantID: tenantID, EndpointID: tok.EndpointID, ExternalID: rec.ExternalID,
			ExternalKind: rec.kind(), LexKind: repository.HRLexKindOrgEntity, LexID: entity.ID,
			ExternalCode: entity.Code, ContentHash: hash, Active: true, LastSyncedAt: s.now().UTC(),
		})
		return entity.ID, err

	default: // user
		roleKey, hasRole := normalizeRoleKey(rec.RoleKey)
		code := strings.ToUpper(strings.TrimSpace(rec.OrgCode))
		userID, uerr := uuid.Parse(strings.TrimSpace(rec.LexUserID))
		if code != "" && uerr == nil {
			if entity, getErr := s.orgRepo.GetByCode(ctx, tenantID, code); getErr == nil {
				if memberships, ok := s.orgRepo.(hrMembershipStore); ok {
					var managerID *uuid.UUID
					if parsed, managerErr := uuid.Parse(strings.TrimSpace(rec.ManagerLexUserID)); managerErr == nil {
						managerID = &parsed
					}
					membership := &model.OrgMembership{ID: uuid.New(), TenantID: tenantID, EntityID: entity.ID, UserID: userID, EmployeeCode: rec.ExternalID, Title: map[string]string{"en": rec.DisplayName, "ar": rec.DisplayName}, ManagerUserID: managerID, Active: rec.Active, Metadata: map[string]any{"source": "scim_push"}}
					if err := memberships.UpsertMembership(ctx, s.idMap.Pool(), membership); err != nil {
						return uuid.Nil, err
					}
				}
			}
		}
		if hasRole && code != "" && uerr == nil {
			if entity, gerr := s.orgRepo.GetByCode(ctx, tenantID, code); gerr == nil {
				role := &model.OrgRole{
					TenantID: tenantID, EntityID: entity.ID, RoleKey: roleKey, UserID: userID,
					Label: forms.LocalizedText{AR: rec.DisplayName, EN: rec.DisplayName},
				}
				if rerr := s.orgRepo.UpsertRole(ctx, s.idMap.Pool(), role); rerr != nil {
					return uuid.Nil, rerr
				}
				_, merr := s.idMap.UpsertMapping(ctx, s.idMap.Pool(), &repository.HRIdentityMapping{
					TenantID: tenantID, EndpointID: tok.EndpointID, ExternalID: rec.ExternalID,
					ExternalKind: rec.kind(), LexKind: repository.HRLexKindOrgRole, LexID: role.ID,
					ExternalCode: code, ContentHash: hash, Active: true, LastSyncedAt: s.now().UTC(),
				})
				return role.ID, merr
			}
		}
		// Unbound identity (no resolvable role binding): record for reconciliation.
		_, merr := s.idMap.UpsertMapping(ctx, s.idMap.Pool(), &repository.HRIdentityMapping{
			TenantID: tenantID, EndpointID: tok.EndpointID, ExternalID: rec.ExternalID,
			ExternalKind: rec.kind(), LexKind: repository.HRLexKindOrgRole, LexID: uuid.Nil,
			ExternalCode: code, ContentHash: hash, Active: true, LastSyncedAt: s.now().UTC(),
			Metadata: map[string]any{"unbound": true, "source": "scim_push"},
		})
		return uuid.Nil, merr
	}
}

// upsertEntity upserts a group/org-unit OrgEntity by (tenant, code).
func (s *SCIMServer) upsertEntity(ctx context.Context, tok *repository.SCIMToken, rec hrRecord) (*model.OrgEntity, error) {
	tenantID := tok.TenantID
	code := strings.ToUpper(strings.TrimSpace(rec.OrgCode))
	if code == "" {
		code = strings.ToUpper(strings.TrimSpace(rec.ExternalID))
	}
	name := forms.LocalizedText{AR: rec.DisplayName, EN: rec.DisplayName}
	parentID, path := hrParent(ctx, s.orgRepo, tenantID, rec.ParentOrgCode)
	if existing, err := s.orgRepo.GetByCode(ctx, tenantID, code); err == nil && existing != nil {
		existing.Name = name
		existing.ParentID, existing.Path = parentID, path
		existing.EntityType = hrEntityType(rec.EntityType)
		existing.Active = true
		if uerr := s.orgRepo.Update(ctx, s.idMap.Pool(), existing); uerr != nil {
			return nil, uerr
		}
		return existing, nil
	}
	entity := &model.OrgEntity{
		ID: uuid.New(), TenantID: tenantID, EntityType: hrEntityType(rec.EntityType),
		Code: code, Name: name, ParentID: parentID, Path: path, Active: true,
		Metadata: map[string]any{"source": "scim_push"},
	}
	if err := s.orgRepo.Create(ctx, s.idMap.Pool(), entity); err != nil {
		return nil, err
	}
	return entity, nil
}

// =============================================================================
// SCIM record adapters + response builders.
// =============================================================================

func (u scimUser) toRecord() hrRecord {
	display := firstNonEmpty(u.DisplayName, u.UserName)
	if display == "" && u.Name != nil {
		display = firstNonEmpty(u.Name.Formatted, strings.TrimSpace(u.Name.GivenName+" "+u.Name.FamilyName))
	}
	active := true
	if u.Active != nil {
		active = *u.Active
	}
	rec := hrRecord{
		ExternalID:  firstNonEmpty(u.ExternalID, u.UserName, u.ID),
		Resource:    "user",
		DisplayName: display,
		Active:      active,
	}
	if u.Lex != nil {
		rec.OrgCode = u.Lex.OrgCode
		rec.RoleKey = u.Lex.RoleKey
		rec.LexUserID = u.Lex.LexUserID
		rec.ManagerLexUserID = u.Lex.ManagerLexUserID
	}
	return rec
}

func (g scimGroup) toRecord() hrRecord {
	rec := hrRecord{
		ExternalID:  firstNonEmpty(g.ExternalID, g.DisplayName, g.ID),
		Resource:    "group",
		DisplayName: g.DisplayName,
		Active:      true,
		OrgCode:     firstNonEmpty(g.ExternalID, g.DisplayName),
	}
	if g.Lex != nil {
		rec.OrgCode = firstNonEmpty(g.Lex.OrgCode, rec.OrgCode)
		rec.ParentOrgCode, rec.EntityType, rec.ManagerLexUserID = g.Lex.ParentOrgCode, g.Lex.EntityType, g.Lex.ManagerLexUserID
	}
	return rec
}

func (s *SCIMServer) userResource(rec hrRecord, lexID uuid.UUID) map[string]any {
	return map[string]any{
		"schemas":     []string{"urn:ietf:params:scim:schemas:core:2.0:User"},
		"id":          rec.ExternalID,
		"externalId":  rec.ExternalID,
		"userName":    rec.DisplayName,
		"displayName": rec.DisplayName,
		"active":      rec.Active,
		"meta": map[string]any{
			"resourceType": "User",
			"lastModified": s.now().UTC().Format(time.RFC3339),
			"location":     "/scim/v2/Users/" + rec.ExternalID,
		},
	}
}

func (s *SCIMServer) groupResource(rec hrRecord, lexID uuid.UUID) map[string]any {
	return map[string]any{
		"schemas":     []string{"urn:ietf:params:scim:schemas:core:2.0:Group"},
		"id":          rec.ExternalID,
		"externalId":  rec.ExternalID,
		"displayName": rec.DisplayName,
		"meta": map[string]any{
			"resourceType": "Group",
			"lastModified": s.now().UTC().Format(time.RFC3339),
			"location":     "/scim/v2/Groups/" + rec.ExternalID,
		},
	}
}

func scimResourceType(kind repository.HRExternalKind) string {
	if kind == repository.HRExternalKindGroup || kind == repository.HRExternalKindOrgUnit {
		return "Group"
	}
	return "User"
}

// =============================================================================
// SCIM JSON helpers.
// =============================================================================

func decodeJSON(r *http.Request, v any) error {
	if r.Body == nil {
		return errors.New("empty body")
	}
	defer r.Body.Close()
	dec := json.NewDecoder(io.LimitReader(r.Body, 4<<20))
	return dec.Decode(v)
}

func (s *SCIMServer) writeSCIM(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/scim+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func (s *SCIMServer) writeSCIMList(w http.ResponseWriter, items []map[string]any) {
	s.writeSCIM(w, http.StatusOK, map[string]any{
		"schemas":      []string{"urn:ietf:params:scim:api:messages:2.0:ListResponse"},
		"totalResults": len(items),
		"Resources":    items,
	})
}

func (s *SCIMServer) writeSCIMListResources(w http.ResponseWriter, items []map[string]any) {
	s.writeSCIM(w, http.StatusOK, map[string]any{
		"schemas":      []string{"urn:ietf:params:scim:api:messages:2.0:ListResponse"},
		"totalResults": len(items),
		"startIndex":   1,
		"itemsPerPage": len(items),
		"Resources":    items,
	})
}

func (s *SCIMServer) scimError(w http.ResponseWriter, status int, detail string) {
	w.Header().Set("Content-Type", "application/scim+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"schemas": []string{"urn:ietf:params:scim:api:messages:2.0:Error"},
		"status":  status,
		"detail":  detail,
	})
}

// parseScimPatchActive inspects a SCIM PATCH body for an active=false (or true)
// operation. It tolerates the two common shapes: replace op with {active:bool}
// value, and a top-level {active:bool}. Returns nil when active is not addressed.
func parseScimPatchActive(r *http.Request) (*bool, error) {
	var body struct {
		Schemas    []string `json:"schemas"`
		Operations []struct {
			Op    string          `json:"op"`
			Path  string          `json:"path"`
			Value json.RawMessage `json:"value"`
		} `json:"Operations"`
		Active *bool `json:"active"`
	}
	if err := decodeJSON(r, &body); err != nil {
		return nil, err
	}
	if body.Active != nil {
		return body.Active, nil
	}
	for _, op := range body.Operations {
		if !strings.EqualFold(op.Op, "replace") && !strings.EqualFold(op.Op, "add") {
			continue
		}
		// path == "active" with a bool value, OR value == {"active": bool}.
		if strings.EqualFold(strings.TrimSpace(op.Path), "active") {
			var b bool
			if err := json.Unmarshal(op.Value, &b); err == nil {
				return &b, nil
			}
		}
		var obj struct {
			Active *bool `json:"active"`
		}
		if err := json.Unmarshal(op.Value, &obj); err == nil && obj.Active != nil {
			return obj.Active, nil
		}
	}
	return nil, nil
}

// =============================================================================
// SCIM token issuance (used by POST /integrations/{id}/scim-token; the handler
// owned by the integrator calls IssueSCIMToken on the registry, which delegates
// here). Generates a cryptographically-random raw token, stores only its hash +
// a non-secret prefix, and returns the raw token ONCE.
// =============================================================================

// IssuedSCIMToken is returned exactly once at issue/rotate time. RawToken is the
// only place the cleartext bearer is exposed; it is never persisted or logged.
type IssuedSCIMToken struct {
	RawToken string               `json:"token"`
	Record   repository.SCIMToken `json:"record"`
}

// IssueSCIMToken generates and persists a new SCIM bearer for the endpoint. When
// rotate is true, every existing non-revoked token on the endpoint is revoked
// after the new one is stored (rotate-with-grace is the caller's choice; here we
// revoke immediately for a clean cut-over). The raw token is returned ONCE.
func (s *SCIMServer) IssueSCIMToken(ctx context.Context, q repository.Queryer, tenantID, endpointID uuid.UUID, createdBy *uuid.UUID, label string, rotate bool, expiresAt *time.Time) (*IssuedSCIMToken, error) {
	raw, prefix, err := generateSCIMToken()
	if err != nil {
		return nil, err
	}
	hash := repository.HashSCIMToken(raw)
	tok := &repository.SCIMToken{
		TenantID:    tenantID,
		EndpointID:  endpointID,
		TokenPrefix: prefix,
		Label:       strings.TrimSpace(label),
		CreatedBy:   createdBy,
		ExpiresAt:   expiresAt,
	}
	if rotate {
		if err := s.idMap.RevokeTokensForEndpoint(ctx, q, tenantID, endpointID, s.now().UTC()); err != nil {
			return nil, err
		}
	}
	if err := s.idMap.IssueToken(ctx, q, tok, hash); err != nil {
		return nil, err
	}
	return &IssuedSCIMToken{RawToken: raw, Record: *tok}, nil
}

// generateSCIMToken mints a 256-bit URL-safe random bearer with a recognisable,
// non-secret prefix ("lexscim_") plus a short visible discriminator.
func generateSCIMToken() (raw, prefix string, err error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", "", err
	}
	body := base64.RawURLEncoding.EncodeToString(buf)
	raw = "lexscim_" + body
	// Prefix shows the brand + first 4 body chars so an operator can identify the
	// active token without exposing the secret.
	disc := body
	if len(disc) > 4 {
		disc = disc[:4]
	}
	prefix = "lexscim_" + disc
	return raw, prefix, nil
}
