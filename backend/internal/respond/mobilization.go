package respond

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrResponderResolutionInvalid = errors.New("respond responder resolution request is invalid")
	ErrResponderDirectoryInvalid  = errors.New("respond responder directory entry is invalid")
)

type ResolvedResponder struct {
	UserID         uuid.UUID      `json:"user_id"`
	DisplayName    string         `json:"display_name,omitempty"`
	Email          string         `json:"email,omitempty"`
	Phone          string         `json:"phone,omitempty"`
	ChatHandle     string         `json:"chat_handle,omitempty"`
	TeamKey        string         `json:"team_key,omitempty"`
	ServiceKey     string         `json:"service_key,omitempty"`
	Roles          []IncidentRole `json:"roles,omitempty"`
	OnCall         bool           `json:"on_call"`
	EscalationRank int            `json:"escalation_rank"`
	Source         string         `json:"source"`
}

type ResponderResolutionRequest struct {
	TenantID      uuid.UUID
	IncidentID    uuid.UUID
	Role          IncidentRole
	TeamKeys      []string
	ServiceKeys   []string
	IncludeOnCall bool
	At            time.Time
	Limit         int
}

func (r *ResponderResolutionRequest) normalize(now func() time.Time) error {
	if r.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required: %w", ErrResponderResolutionInvalid)
	}
	if r.Role != "" && !r.Role.Valid() {
		return ErrInvalidIncidentRole
	}
	r.TeamKeys = normalizeLookupKeys(r.TeamKeys)
	r.ServiceKeys = normalizeLookupKeys(r.ServiceKeys)
	if r.Role == "" && len(r.TeamKeys) == 0 && len(r.ServiceKeys) == 0 && !r.IncludeOnCall {
		return fmt.Errorf("role, team, service, or on-call criterion is required: %w", ErrResponderResolutionInvalid)
	}
	if r.At.IsZero() {
		if now == nil {
			r.At = time.Now().UTC()
		} else {
			r.At = now()
		}
	}
	if r.Limit <= 0 || r.Limit > 200 {
		r.Limit = 50
	}
	return nil
}

// MetastoreResponderResolver is intentionally small and stable so Prompt 3's
// Metastore service can provide service ownership, team membership, and on-call
// coverage without changing Respond mobilization code.
type MetastoreResponderResolver interface {
	ResolveIncidentResponders(ctx context.Context, request ResponderResolutionRequest) ([]ResolvedResponder, error)
}

type ResponderResolver interface {
	ResolveResponders(ctx context.Context, request ResponderResolutionRequest) ([]ResolvedResponder, error)
}

type PersistentResponderResolver struct {
	tx               tenantRunner
	store            *Store
	metastore        MetastoreResponderResolver
	serviceMetastore MetastoreClient
	now              func() time.Time
}

type ResponderResolverOption func(*PersistentResponderResolver)

func WithMetastoreResponderResolver(resolver MetastoreResponderResolver) ResponderResolverOption {
	return func(r *PersistentResponderResolver) {
		r.metastore = resolver
	}
}

func WithServiceMetastore(client MetastoreClient) ResponderResolverOption {
	return func(r *PersistentResponderResolver) {
		r.serviceMetastore = client
	}
}

func WithResponderResolverClock(now func() time.Time) ResponderResolverOption {
	return func(r *PersistentResponderResolver) {
		if now != nil {
			r.now = now
		}
	}
}

func NewPersistentResponderResolver(tx tenantRunner, store *Store, opts ...ResponderResolverOption) (*PersistentResponderResolver, error) {
	if tx == nil {
		return nil, errors.New("respond responder resolver tenant runner is required")
	}
	if store == nil {
		store = NewStore()
	}
	resolver := &PersistentResponderResolver{
		tx:    tx,
		store: store,
		now:   func() time.Time { return time.Now().UTC() },
	}
	for _, opt := range opts {
		opt(resolver)
	}
	return resolver, nil
}

func (r *PersistentResponderResolver) ResolveResponders(ctx context.Context, request ResponderResolutionRequest) ([]ResolvedResponder, error) {
	if err := request.normalize(r.now); err != nil {
		return nil, err
	}

	serviceOwners, err := r.enrichFromServiceMetastore(ctx, &request)
	if err != nil {
		return nil, err
	}

	resolved := serviceOwners
	if err := r.tx.RunReadWithTenant(ctx, request.TenantID, func(tx DBTX) error {
		directoryResponders, err := r.store.ResolveResponderDirectory(ctx, tx, request)
		if err != nil {
			return err
		}
		resolved = append(resolved, directoryResponders...)
		return err
	}); err != nil {
		return nil, err
	}

	if r.metastore != nil {
		external, err := r.metastore.ResolveIncidentResponders(ctx, request)
		if err != nil {
			return nil, fmt.Errorf("respond: resolve responders from metastore: %w", err)
		}
		resolved = append(resolved, external...)
	}

	return dedupeResponders(resolved, request.Limit), nil
}

func (r *PersistentResponderResolver) enrichFromServiceMetastore(ctx context.Context, request *ResponderResolutionRequest) ([]ResolvedResponder, error) {
	if r.serviceMetastore == nil || len(request.ServiceKeys) == 0 {
		return nil, nil
	}
	var resolved []ResolvedResponder
	for _, serviceKey := range request.ServiceKeys {
		service, err := r.serviceMetastore.ResolveService(ctx, request.TenantID, serviceKey)
		if err != nil {
			return nil, fmt.Errorf("respond: resolve service ownership for %s: %w", serviceKey, err)
		}
		if service == nil {
			return nil, fmt.Errorf("respond service metadata for %s is empty: %w", serviceKey, ErrServiceNotFound)
		}
		if service.OwnerTeam != "" {
			request.TeamKeys = normalizeLookupKeys(append(request.TeamKeys, service.OwnerTeam))
		}
		for _, owner := range service.Owners {
			ownerID, err := uuid.Parse(strings.TrimSpace(owner))
			if err != nil {
				continue
			}
			resolved = append(resolved, ResolvedResponder{
				UserID:         ownerID,
				TeamKey:        service.OwnerTeam,
				ServiceKey:     service.Key,
				EscalationRank: 0,
				Source:         "respond_metastore",
			})
		}
	}
	return resolved, nil
}

type ResponderDirectoryEntry struct {
	TenantID       uuid.UUID      `json:"tenant_id"`
	UserID         uuid.UUID      `json:"user_id"`
	DisplayName    string         `json:"display_name,omitempty"`
	Email          string         `json:"email,omitempty"`
	Phone          string         `json:"phone,omitempty"`
	ChatHandle     string         `json:"chat_handle,omitempty"`
	TeamKey        string         `json:"team_key,omitempty"`
	ServiceKey     string         `json:"service_key,omitempty"`
	Roles          []IncidentRole `json:"roles,omitempty"`
	OnCall         bool           `json:"on_call"`
	EscalationRank int            `json:"escalation_rank"`
	Active         bool           `json:"active"`
	UpdatedBy      uuid.UUID      `json:"updated_by"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

func (e *ResponderDirectoryEntry) normalize() error {
	e.DisplayName = strings.TrimSpace(e.DisplayName)
	e.Email = strings.TrimSpace(strings.ToLower(e.Email))
	e.Phone = strings.TrimSpace(e.Phone)
	e.ChatHandle = strings.TrimSpace(e.ChatHandle)
	e.TeamKey = strings.TrimSpace(e.TeamKey)
	e.ServiceKey = strings.TrimSpace(e.ServiceKey)
	e.Roles = normalizeIncidentRoles(e.Roles)
	if e.TenantID == uuid.Nil || e.UserID == uuid.Nil {
		return fmt.Errorf("tenant_id and user_id are required: %w", ErrResponderDirectoryInvalid)
	}
	for _, role := range e.Roles {
		if !role.Valid() {
			return ErrInvalidIncidentRole
		}
	}
	if e.EscalationRank < 0 {
		return fmt.Errorf("escalation_rank must be non-negative: %w", ErrResponderDirectoryInvalid)
	}
	return nil
}

const responderDirectoryColumns = `tenant_id, user_id, display_name, email, phone, chat_handle,
team_key, service_key, roles, on_call, escalation_rank, active, updated_by, created_at, updated_at`

func scanResponderDirectoryEntry(row rowScanner) (*ResponderDirectoryEntry, error) {
	var entry ResponderDirectoryEntry
	var rolesJSON []byte
	if err := row.Scan(
		&entry.TenantID,
		&entry.UserID,
		&entry.DisplayName,
		&entry.Email,
		&entry.Phone,
		&entry.ChatHandle,
		&entry.TeamKey,
		&entry.ServiceKey,
		&rolesJSON,
		&entry.OnCall,
		&entry.EscalationRank,
		&entry.Active,
		&entry.UpdatedBy,
		&entry.CreatedAt,
		&entry.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(rolesJSON) > 0 {
		var roles []IncidentRole
		if err := json.Unmarshal(rolesJSON, &roles); err != nil {
			return nil, fmt.Errorf("respond: unmarshal responder roles: %w", err)
		}
		entry.Roles = normalizeIncidentRoles(roles)
	}
	if entry.Roles == nil {
		entry.Roles = []IncidentRole{}
	}
	return &entry, nil
}

func (s *Store) UpsertResponderDirectoryEntry(ctx context.Context, db DBTX, entry *ResponderDirectoryEntry) error {
	if entry == nil {
		return fmt.Errorf("responder directory entry is required: %w", ErrResponderDirectoryInvalid)
	}
	if err := entry.normalize(); err != nil {
		return err
	}
	rolesJSON, err := json.Marshal(entry.Roles)
	if err != nil {
		return fmt.Errorf("respond: marshal responder roles: %w", err)
	}
	if entry.UpdatedBy == uuid.Nil {
		entry.UpdatedBy = entry.UserID
	}
	err = db.QueryRow(ctx, `
INSERT INTO respond_responder_directory (
    tenant_id, user_id, display_name, email, phone, chat_handle, team_key, service_key,
    roles, on_call, escalation_rank, active, updated_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (tenant_id, user_id, team_key, service_key)
DO UPDATE SET display_name = EXCLUDED.display_name,
              email = EXCLUDED.email,
              phone = EXCLUDED.phone,
              chat_handle = EXCLUDED.chat_handle,
              roles = EXCLUDED.roles,
              on_call = EXCLUDED.on_call,
              escalation_rank = EXCLUDED.escalation_rank,
              active = EXCLUDED.active,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
RETURNING `+responderDirectoryColumns,
		entry.TenantID,
		entry.UserID,
		entry.DisplayName,
		entry.Email,
		entry.Phone,
		entry.ChatHandle,
		entry.TeamKey,
		entry.ServiceKey,
		rolesJSON,
		entry.OnCall,
		entry.EscalationRank,
		entry.Active,
		entry.UpdatedBy,
	).Scan(
		&entry.TenantID,
		&entry.UserID,
		&entry.DisplayName,
		&entry.Email,
		&entry.Phone,
		&entry.ChatHandle,
		&entry.TeamKey,
		&entry.ServiceKey,
		&rolesJSON,
		&entry.OnCall,
		&entry.EscalationRank,
		&entry.Active,
		&entry.UpdatedBy,
		&entry.CreatedAt,
		&entry.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("respond: upsert responder directory entry: %w", err)
	}
	if len(rolesJSON) > 0 {
		var roles []IncidentRole
		if err := json.Unmarshal(rolesJSON, &roles); err != nil {
			return fmt.Errorf("respond: unmarshal saved responder roles: %w", err)
		}
		entry.Roles = normalizeIncidentRoles(roles)
	}
	return nil
}

func (s *Store) ResolveResponderDirectory(ctx context.Context, db DBTX, request ResponderResolutionRequest) ([]ResolvedResponder, error) {
	if err := request.normalize(func() time.Time { return time.Now().UTC() }); err != nil {
		return nil, err
	}
	args := []any{request.TenantID}
	criteria := make([]string, 0, 4)
	if request.Role != "" {
		args = append(args, string(request.Role))
		criteria = append(criteria, fmt.Sprintf("roles ? $%d", len(args)))
	}
	if len(request.TeamKeys) > 0 {
		args = append(args, request.TeamKeys)
		criteria = append(criteria, fmt.Sprintf("team_key = ANY($%d)", len(args)))
	}
	if len(request.ServiceKeys) > 0 {
		args = append(args, request.ServiceKeys)
		criteria = append(criteria, fmt.Sprintf("service_key = ANY($%d)", len(args)))
	}
	if request.IncludeOnCall {
		criteria = append(criteria, "on_call = true")
	}

	where := "tenant_id = $1 AND active = true"
	if len(criteria) > 0 {
		where += " AND (" + strings.Join(criteria, " OR ") + ")"
	}
	args = append(args, request.Limit)

	rows, err := db.Query(ctx, `SELECT `+responderDirectoryColumns+`
FROM respond_responder_directory
WHERE `+where+fmt.Sprintf(`
ORDER BY escalation_rank ASC, display_name ASC, user_id ASC
LIMIT $%d`, len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("respond: resolve responder directory: %w", err)
	}
	defer rows.Close()

	out := make([]ResolvedResponder, 0)
	for rows.Next() {
		entry, err := scanResponderDirectoryEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan responder directory: %w", err)
		}
		out = append(out, entry.toResolvedResponder("respond_responder_directory"))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read responder directory: %w", err)
	}
	return out, nil
}

func (s *Store) GetResponderDirectoryEntry(ctx context.Context, db DBTX, tenantID, userID uuid.UUID, teamKey, serviceKey string) (*ResponderDirectoryEntry, error) {
	entry, err := scanResponderDirectoryEntry(db.QueryRow(ctx, `SELECT `+responderDirectoryColumns+`
FROM respond_responder_directory
WHERE tenant_id = $1 AND user_id = $2 AND team_key = $3 AND service_key = $4`,
		tenantID, userID, strings.TrimSpace(teamKey), strings.TrimSpace(serviceKey)))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("responder %s: %w", userID, ErrResponderDirectoryInvalid)
		}
		return nil, fmt.Errorf("respond: get responder directory entry: %w", err)
	}
	return entry, nil
}

func (s *Store) ListResponderDirectoryEntriesForUser(ctx context.Context, db DBTX, tenantID, userID uuid.UUID) ([]ResponderDirectoryEntry, error) {
	rows, err := db.Query(ctx, `SELECT `+responderDirectoryColumns+`
FROM respond_responder_directory
WHERE tenant_id = $1 AND user_id = $2 AND active = true
ORDER BY escalation_rank ASC, team_key ASC, service_key ASC`, tenantID, userID)
	if err != nil {
		return nil, fmt.Errorf("respond: list responder directory entries for user: %w", err)
	}
	defer rows.Close()

	var out []ResponderDirectoryEntry
	for rows.Next() {
		entry, err := scanResponderDirectoryEntry(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan responder directory entry for user: %w", err)
		}
		out = append(out, *entry)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read responder directory entries for user: %w", err)
	}
	return out, nil
}

func (e ResponderDirectoryEntry) toResolvedResponder(source string) ResolvedResponder {
	return ResolvedResponder{
		UserID:         e.UserID,
		DisplayName:    e.DisplayName,
		Email:          e.Email,
		Phone:          e.Phone,
		ChatHandle:     e.ChatHandle,
		TeamKey:        e.TeamKey,
		ServiceKey:     e.ServiceKey,
		Roles:          append([]IncidentRole(nil), e.Roles...),
		OnCall:         e.OnCall,
		EscalationRank: e.EscalationRank,
		Source:         source,
	}
}

func dedupeResponders(in []ResolvedResponder, limit int) []ResolvedResponder {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	byUser := make(map[uuid.UUID]ResolvedResponder, len(in))
	order := make([]uuid.UUID, 0, len(in))
	for _, responder := range in {
		if responder.UserID == uuid.Nil {
			continue
		}
		responder.DisplayName = strings.TrimSpace(responder.DisplayName)
		responder.Email = strings.TrimSpace(strings.ToLower(responder.Email))
		responder.Phone = strings.TrimSpace(responder.Phone)
		responder.ChatHandle = strings.TrimSpace(responder.ChatHandle)
		responder.TeamKey = strings.TrimSpace(responder.TeamKey)
		responder.ServiceKey = strings.TrimSpace(responder.ServiceKey)
		responder.Roles = normalizeIncidentRoles(responder.Roles)
		responder.Source = strings.TrimSpace(responder.Source)
		if responder.Source == "" {
			responder.Source = "metastore"
		}
		if existing, ok := byUser[responder.UserID]; ok {
			byUser[responder.UserID] = mergeResponder(existing, responder)
			continue
		}
		byUser[responder.UserID] = responder
		order = append(order, responder.UserID)
	}
	out := make([]ResolvedResponder, 0, len(order))
	for _, userID := range order {
		out = append(out, byUser[userID])
		if len(out) == limit {
			break
		}
	}
	return out
}

func mergeResponder(existing, next ResolvedResponder) ResolvedResponder {
	if existing.DisplayName == "" {
		existing.DisplayName = next.DisplayName
	}
	if existing.Email == "" {
		existing.Email = next.Email
	}
	if existing.Phone == "" {
		existing.Phone = next.Phone
	}
	if existing.ChatHandle == "" {
		existing.ChatHandle = next.ChatHandle
	}
	if existing.TeamKey == "" {
		existing.TeamKey = next.TeamKey
	}
	if existing.ServiceKey == "" {
		existing.ServiceKey = next.ServiceKey
	}
	existing.OnCall = existing.OnCall || next.OnCall
	if next.EscalationRank < existing.EscalationRank {
		existing.EscalationRank = next.EscalationRank
	}
	existing.Roles = normalizeIncidentRoles(append(existing.Roles, next.Roles...))
	if next.Source != "" && !strings.Contains(existing.Source, next.Source) {
		if existing.Source == "" {
			existing.Source = next.Source
		} else {
			existing.Source += "," + next.Source
		}
	}
	return existing
}

func normalizeLookupKeys(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, key := range in {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, key)
	}
	return out
}

func normalizeIncidentRoles(in []IncidentRole) []IncidentRole {
	seen := make(map[IncidentRole]struct{}, len(in))
	out := make([]IncidentRole, 0, len(in))
	for _, role := range in {
		role = IncidentRole(strings.TrimSpace(string(role)))
		if role == "" {
			continue
		}
		if _, ok := seen[role]; ok {
			continue
		}
		seen[role] = struct{}{}
		out = append(out, role)
	}
	return out
}

var _ ResponderResolver = (*PersistentResponderResolver)(nil)
