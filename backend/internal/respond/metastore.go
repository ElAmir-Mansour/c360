package respond

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrServiceNotFound = errors.New("respond service metadata not found")

type ServiceTier string

const (
	ServiceTierMissionCritical  ServiceTier = "mission_critical"
	ServiceTierBusinessCritical ServiceTier = "business_critical"
	ServiceTierImportant        ServiceTier = "important"
	ServiceTierStandard         ServiceTier = "standard"
)

func (t ServiceTier) Valid() bool {
	switch t {
	case ServiceTierMissionCritical, ServiceTierBusinessCritical, ServiceTierImportant, ServiceTierStandard:
		return true
	default:
		return false
	}
}

type ServiceLifecycleStatus string

const (
	ServiceLifecycleActive  ServiceLifecycleStatus = "active"
	ServiceLifecycleRetired ServiceLifecycleStatus = "retired"
)

func (s ServiceLifecycleStatus) Valid() bool {
	switch s {
	case ServiceLifecycleActive, ServiceLifecycleRetired:
		return true
	default:
		return false
	}
}

type ServiceDependencyKind string

const (
	ServiceDependencyHard ServiceDependencyKind = "hard"
	ServiceDependencySoft ServiceDependencyKind = "soft"
)

func (k ServiceDependencyKind) Valid() bool {
	switch k {
	case ServiceDependencyHard, ServiceDependencySoft:
		return true
	default:
		return false
	}
}

type ServiceDependency struct {
	ServiceKey string                `json:"service_key"`
	Kind       ServiceDependencyKind `json:"kind"`
}

type ServiceMetadata struct {
	ID              uuid.UUID              `json:"id"`
	TenantID        uuid.UUID              `json:"tenant_id"`
	Key             string                 `json:"key"`
	Name            string                 `json:"name"`
	Description     string                 `json:"description,omitempty"`
	OwnerTeam       string                 `json:"owner_team"`
	Owners          []string               `json:"owners"`
	Tier            ServiceTier            `json:"tier"`
	LifecycleStatus ServiceLifecycleStatus `json:"lifecycle_status"`
	Dependencies    []ServiceDependency    `json:"dependencies"`
	RowVersion      int                    `json:"row_version"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
}

type MetastoreClient interface {
	ResolveService(ctx context.Context, tenantID uuid.UUID, serviceKey string) (*ServiceMetadata, error)
	ListServices(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]ServiceMetadata, error)
	UpsertService(ctx context.Context, tenantID uuid.UUID, metadata ServiceMetadata) (*ServiceMetadata, error)
}

type SQLMetastore struct {
	tx   tenantRunner
	repo *Repository
}

func NewSQLMetastore(pool *pgxpool.Pool) *SQLMetastore {
	return NewSQLMetastoreWithDeps(pgxTenantRunner{pool: pool}, NewRepository())
}

func NewSQLMetastoreWithDeps(tx tenantRunner, repo *Repository) *SQLMetastore {
	if repo == nil {
		repo = NewRepository()
	}
	return &SQLMetastore{tx: tx, repo: repo}
}

func (m *SQLMetastore) ResolveService(ctx context.Context, tenantID uuid.UUID, serviceKey string) (*ServiceMetadata, error) {
	serviceKey = normalizeServiceKey(serviceKey)
	if serviceKey == "" {
		return nil, fmt.Errorf("service_key is required: %w", ErrValidation)
	}
	var service *ServiceMetadata
	err := m.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		service, err = m.repo.GetServiceMetadataByKey(ctx, tx, tenantID, serviceKey)
		return err
	})
	return service, err
}

func (m *SQLMetastore) ListServices(ctx context.Context, tenantID uuid.UUID, limit, offset int) ([]ServiceMetadata, error) {
	var services []ServiceMetadata
	err := m.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		services, err = m.repo.ListServiceMetadata(ctx, tx, tenantID, limit, offset)
		return err
	})
	return services, err
}

func (m *SQLMetastore) UpsertService(ctx context.Context, tenantID uuid.UUID, metadata ServiceMetadata) (*ServiceMetadata, error) {
	metadata.TenantID = tenantID
	if err := metadata.normalizeAndValidate(); err != nil {
		return nil, err
	}
	err := m.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		return m.repo.UpsertServiceMetadata(ctx, tx, &metadata)
	})
	if err != nil {
		return nil, err
	}
	return &metadata, nil
}

func (m *ServiceMetadata) normalizeAndValidate() error {
	m.Key = normalizeServiceKey(m.Key)
	m.Name = strings.TrimSpace(m.Name)
	m.Description = strings.TrimSpace(m.Description)
	m.OwnerTeam = strings.TrimSpace(m.OwnerTeam)
	if m.LifecycleStatus == "" {
		m.LifecycleStatus = ServiceLifecycleActive
	}
	m.Owners = normalizeStringSet(m.Owners)
	m.Dependencies = normalizeServiceDependencies(m.Dependencies)

	if m.TenantID == uuid.Nil {
		return fmt.Errorf("tenant_id is required: %w", ErrValidation)
	}
	if m.Key == "" {
		return fmt.Errorf("service_key is required: %w", ErrValidation)
	}
	if strings.ContainsAny(m.Key, " \t\r\n") {
		return fmt.Errorf("service_key cannot contain whitespace: %w", ErrValidation)
	}
	if m.Name == "" {
		return fmt.Errorf("service name is required: %w", ErrValidation)
	}
	if m.OwnerTeam == "" {
		return fmt.Errorf("owner_team is required: %w", ErrValidation)
	}
	if !m.Tier.Valid() {
		return fmt.Errorf("service tier is invalid: %w", ErrValidation)
	}
	if !m.LifecycleStatus.Valid() {
		return fmt.Errorf("service lifecycle status is invalid: %w", ErrValidation)
	}
	for _, dep := range m.Dependencies {
		if dep.ServiceKey == "" {
			return fmt.Errorf("dependency service_key is required: %w", ErrValidation)
		}
		if dep.ServiceKey == m.Key {
			return fmt.Errorf("service cannot depend on itself: %w", ErrValidation)
		}
		if !dep.Kind.Valid() {
			return fmt.Errorf("dependency kind is invalid: %w", ErrValidation)
		}
	}
	return nil
}

func normalizeServiceKey(key string) string {
	return strings.ToLower(strings.TrimSpace(key))
}

func normalizeServiceKeys(keys []string) []string {
	seen := make(map[string]struct{}, len(keys))
	out := make([]string, 0, len(keys))
	for _, key := range keys {
		key = normalizeServiceKey(key)
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

func normalizeStringSet(in []string) []string {
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, item := range in {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	sort.Strings(out)
	return out
}

func normalizeServiceDependencies(in []ServiceDependency) []ServiceDependency {
	seen := make(map[string]struct{}, len(in))
	out := make([]ServiceDependency, 0, len(in))
	for _, dep := range in {
		dep.ServiceKey = normalizeServiceKey(dep.ServiceKey)
		if dep.Kind == "" {
			dep.Kind = ServiceDependencyHard
		}
		if dep.ServiceKey == "" {
			continue
		}
		if _, ok := seen[dep.ServiceKey]; ok {
			continue
		}
		seen[dep.ServiceKey] = struct{}{}
		out = append(out, dep)
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].ServiceKey < out[j].ServiceKey
	})
	return out
}

const serviceMetadataColumns = `id, tenant_id, service_key, name, description, owner_team,
tier, lifecycle_status, owners, row_version, created_at, updated_at`

func scanServiceMetadata(row rowScanner) (*ServiceMetadata, error) {
	var service ServiceMetadata
	var tier, lifecycleStatus string
	var ownersJSON []byte
	if err := row.Scan(
		&service.ID,
		&service.TenantID,
		&service.Key,
		&service.Name,
		&service.Description,
		&service.OwnerTeam,
		&tier,
		&lifecycleStatus,
		&ownersJSON,
		&service.RowVersion,
		&service.CreatedAt,
		&service.UpdatedAt,
	); err != nil {
		return nil, err
	}
	service.Tier = ServiceTier(tier)
	service.LifecycleStatus = ServiceLifecycleStatus(lifecycleStatus)
	if len(ownersJSON) > 0 {
		if err := json.Unmarshal(ownersJSON, &service.Owners); err != nil {
			return nil, fmt.Errorf("respond: unmarshal service owners: %w", err)
		}
	}
	if service.Owners == nil {
		service.Owners = []string{}
	}
	service.Dependencies = []ServiceDependency{}
	return &service, nil
}

func (s *Store) UpsertServiceMetadata(ctx context.Context, db DBTX, service *ServiceMetadata) error {
	if service == nil {
		return fmt.Errorf("service metadata is required: %w", ErrValidation)
	}
	if err := service.normalizeAndValidate(); err != nil {
		return err
	}
	ownersJSON, err := json.Marshal(service.Owners)
	if err != nil {
		return fmt.Errorf("respond: marshal service owners: %w", err)
	}
	saved, err := scanServiceMetadata(db.QueryRow(ctx, `
INSERT INTO respond_service_registry (
    tenant_id, service_key, name, description, owner_team, tier, lifecycle_status, owners
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (tenant_id, service_key)
DO UPDATE SET name = EXCLUDED.name,
              description = EXCLUDED.description,
              owner_team = EXCLUDED.owner_team,
              tier = EXCLUDED.tier,
              lifecycle_status = EXCLUDED.lifecycle_status,
              owners = EXCLUDED.owners,
              row_version = respond_service_registry.row_version + 1,
              updated_at = now()
RETURNING `+serviceMetadataColumns,
		service.TenantID,
		service.Key,
		service.Name,
		service.Description,
		service.OwnerTeam,
		service.Tier,
		service.LifecycleStatus,
		ownersJSON,
	))
	if err != nil {
		return fmt.Errorf("respond: upsert service metadata %s: %w", service.Key, err)
	}

	if _, err := db.Exec(ctx, `
DELETE FROM respond_service_dependency
 WHERE tenant_id = $1 AND service_id = $2`,
		service.TenantID,
		saved.ID,
	); err != nil {
		return fmt.Errorf("respond: replace service dependencies for %s: %w", service.Key, err)
	}
	for _, dep := range service.Dependencies {
		if _, err := db.Exec(ctx, `
INSERT INTO respond_service_dependency (tenant_id, service_id, dependency_key, dependency_kind)
VALUES ($1, $2, $3, $4)
ON CONFLICT (tenant_id, service_id, dependency_key)
DO UPDATE SET dependency_kind = EXCLUDED.dependency_kind`,
			service.TenantID,
			saved.ID,
			dep.ServiceKey,
			dep.Kind,
		); err != nil {
			return fmt.Errorf("respond: insert service dependency %s -> %s: %w", service.Key, dep.ServiceKey, err)
		}
	}

	full, err := s.GetServiceMetadataByKey(ctx, db, service.TenantID, service.Key)
	if err != nil {
		return err
	}
	*service = *full
	return nil
}

func (s *Store) GetServiceMetadataByKey(ctx context.Context, db DBTX, tenantID uuid.UUID, serviceKey string) (*ServiceMetadata, error) {
	services, err := s.GetServiceMetadataByKeys(ctx, db, tenantID, []string{serviceKey})
	if err != nil {
		return nil, err
	}
	return &services[0], nil
}

func (s *Store) GetServiceMetadataByKeys(ctx context.Context, db DBTX, tenantID uuid.UUID, serviceKeys []string) ([]ServiceMetadata, error) {
	serviceKeys = normalizeServiceKeys(serviceKeys)
	if len(serviceKeys) == 0 {
		return []ServiceMetadata{}, nil
	}
	rows, err := db.Query(ctx, `SELECT `+serviceMetadataColumns+`
FROM respond_service_registry
WHERE tenant_id = $1 AND service_key = ANY($2::text[])
ORDER BY service_key`, tenantID, serviceKeys)
	if err != nil {
		return nil, fmt.Errorf("respond: list service metadata by key: %w", err)
	}
	defer rows.Close()

	byKey := make(map[string]ServiceMetadata, len(serviceKeys))
	var services []ServiceMetadata
	for rows.Next() {
		service, serr := scanServiceMetadata(rows)
		if serr != nil {
			return nil, fmt.Errorf("respond: scan service metadata: %w", serr)
		}
		services = append(services, *service)
		byKey[service.Key] = *service
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read service metadata: %w", err)
	}
	if len(services) != len(serviceKeys) {
		for _, key := range serviceKeys {
			if _, ok := byKey[key]; !ok {
				return nil, fmt.Errorf("service %s: %w", key, ErrServiceNotFound)
			}
		}
	}
	if err := s.loadServiceDependencies(ctx, db, tenantID, services); err != nil {
		return nil, err
	}
	byKey = make(map[string]ServiceMetadata, len(services))
	for _, service := range services {
		byKey[service.Key] = service
	}
	ordered := make([]ServiceMetadata, 0, len(serviceKeys))
	for _, key := range serviceKeys {
		ordered = append(ordered, byKey[key])
	}
	return ordered, nil
}

func (s *Store) ListServiceMetadata(ctx context.Context, db DBTX, tenantID uuid.UUID, limit, offset int) ([]ServiceMetadata, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := db.Query(ctx, `SELECT `+serviceMetadataColumns+`
FROM respond_service_registry
WHERE tenant_id = $1
ORDER BY service_key
LIMIT $2 OFFSET $3`, tenantID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("respond: list service metadata: %w", err)
	}
	defer rows.Close()

	var services []ServiceMetadata
	for rows.Next() {
		service, serr := scanServiceMetadata(rows)
		if serr != nil {
			return nil, fmt.Errorf("respond: scan service metadata: %w", serr)
		}
		services = append(services, *service)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read service metadata: %w", err)
	}
	if err := s.loadServiceDependencies(ctx, db, tenantID, services); err != nil {
		return nil, err
	}
	return services, nil
}

func (s *Store) loadServiceDependencies(ctx context.Context, db DBTX, tenantID uuid.UUID, services []ServiceMetadata) error {
	if len(services) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(services))
	index := make(map[uuid.UUID]int, len(services))
	for i, service := range services {
		ids = append(ids, service.ID)
		index[service.ID] = i
		services[i].Dependencies = []ServiceDependency{}
	}
	rows, err := db.Query(ctx, `
SELECT service_id, dependency_key, dependency_kind
FROM respond_service_dependency
WHERE tenant_id = $1 AND service_id = ANY($2::uuid[])
ORDER BY service_id, dependency_key`, tenantID, ids)
	if err != nil {
		return fmt.Errorf("respond: list service dependencies: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var serviceID uuid.UUID
		var dependency ServiceDependency
		var kind string
		if err := rows.Scan(&serviceID, &dependency.ServiceKey, &kind); err != nil {
			return fmt.Errorf("respond: scan service dependency: %w", err)
		}
		dependency.Kind = ServiceDependencyKind(kind)
		if i, ok := index[serviceID]; ok {
			services[i].Dependencies = append(services[i].Dependencies, dependency)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("respond: read service dependencies: %w", err)
	}
	return nil
}

func (s *Store) ReplaceIncidentAffectedServices(ctx context.Context, db DBTX, tenantID, incidentID, actorID uuid.UUID, services []ServiceMetadata, at time.Time) error {
	if actorID == uuid.Nil {
		return fmt.Errorf("actor_id is required: %w", ErrValidation)
	}
	if _, err := db.Exec(ctx, `
DELETE FROM respond_incident_affected_service
 WHERE tenant_id = $1 AND incident_id = $2`, tenantID, incidentID); err != nil {
		return fmt.Errorf("respond: replace incident affected services: %w", err)
	}
	for _, service := range services {
		snapshot, err := json.Marshal(service)
		if err != nil {
			return fmt.Errorf("respond: marshal service metadata snapshot: %w", err)
		}
		if _, err := db.Exec(ctx, `
INSERT INTO respond_incident_affected_service (
    tenant_id, incident_id, service_id, service_key, metadata_snapshot, attached_by, attached_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			tenantID,
			incidentID,
			service.ID,
			service.Key,
			snapshot,
			actorID,
			at,
		); err != nil {
			return fmt.Errorf("respond: insert incident affected service %s: %w", service.Key, err)
		}
	}
	return nil
}

func (s *Store) ListIncidentAffectedServices(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID) ([]ServiceMetadata, error) {
	rows, err := db.Query(ctx, `
SELECT metadata_snapshot
FROM respond_incident_affected_service
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY service_key`, tenantID, incidentID)
	if err != nil {
		return nil, fmt.Errorf("respond: list incident affected services: %w", err)
	}
	defer rows.Close()

	var services []ServiceMetadata
	for rows.Next() {
		var snapshot []byte
		if err := rows.Scan(&snapshot); err != nil {
			return nil, fmt.Errorf("respond: scan affected service: %w", err)
		}
		var service ServiceMetadata
		if err := json.Unmarshal(snapshot, &service); err != nil {
			return nil, fmt.Errorf("respond: unmarshal affected service snapshot: %w", err)
		}
		services = append(services, service)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read affected services: %w", err)
	}
	return services, nil
}

var _ MetastoreClient = (*SQLMetastore)(nil)
