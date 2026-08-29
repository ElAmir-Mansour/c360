package respond

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const integrationConnectorColumns = `id, tenant_id, kind, provider, name, enabled, endpoint_url,
non_secret_config, field_mapping, webhook_auth_type, webhook_secret_name, created_by,
row_version, created_at, updated_at, deleted_at`

func scanIntegrationConnector(row rowScanner) (*IntegrationConnector, error) {
	var connector IntegrationConnector
	var kind, provider, webhookAuth string
	var nonSecretJSON, mappingJSON []byte
	if err := row.Scan(
		&connector.ID,
		&connector.TenantID,
		&kind,
		&provider,
		&connector.Name,
		&connector.Enabled,
		&connector.EndpointURL,
		&nonSecretJSON,
		&mappingJSON,
		&webhookAuth,
		&connector.WebhookSecretName,
		&connector.CreatedBy,
		&connector.RowVersion,
		&connector.CreatedAt,
		&connector.UpdatedAt,
		&connector.DeletedAt,
	); err != nil {
		return nil, err
	}
	connector.Kind = IntegrationKind(kind)
	connector.Provider = IntegrationProvider(provider)
	connector.WebhookAuthType = IntegrationWebhookAuthType(webhookAuth)
	if len(nonSecretJSON) > 0 {
		if err := json.Unmarshal(nonSecretJSON, &connector.NonSecretConfig); err != nil {
			return nil, fmt.Errorf("respond: unmarshal integration connector config: %w", err)
		}
	}
	if len(mappingJSON) > 0 {
		if err := json.Unmarshal(mappingJSON, &connector.FieldMapping); err != nil {
			return nil, fmt.Errorf("respond: unmarshal integration connector field mapping: %w", err)
		}
	}
	if connector.NonSecretConfig == nil {
		connector.NonSecretConfig = map[string]any{}
	}
	if connector.FieldMapping == nil {
		connector.FieldMapping = map[string]string{}
	}
	return &connector, nil
}

func scanIntegrationSecret(row rowScanner) (*IntegrationConnectorSecret, error) {
	var secret IntegrationConnectorSecret
	if err := row.Scan(
		&secret.ID,
		&secret.TenantID,
		&secret.ConnectorID,
		&secret.Name,
		&secret.SecretRef,
		&secret.EncryptedValue,
		&secret.EncryptedNonce,
		&secret.KeyID,
		&secret.CreatedAt,
		&secret.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &secret, nil
}

func (s *Store) CreateIntegrationConnector(ctx context.Context, db DBTX, connector *IntegrationConnector, secrets []IntegrationConnectorSecret) error {
	if err := connector.Validate(); err != nil {
		return err
	}
	configJSON, err := mapToJSONBytes(connector.NonSecretConfig)
	if err != nil {
		return fmt.Errorf("respond: marshal integration connector config: %w", err)
	}
	mappingJSON, err := json.Marshal(connector.FieldMapping)
	if err != nil {
		return fmt.Errorf("respond: marshal integration connector mapping: %w", err)
	}
	created, err := scanIntegrationConnector(db.QueryRow(ctx, `
INSERT INTO respond_integration_connector (
    tenant_id, kind, provider, name, enabled, endpoint_url, non_secret_config,
    field_mapping, webhook_auth_type, webhook_secret_name, created_by
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING `+integrationConnectorColumns,
		connector.TenantID, connector.Kind, connector.Provider, connector.Name, connector.Enabled,
		connector.EndpointURL, configJSON, mappingJSON, connector.WebhookAuthType,
		connector.WebhookSecretName, connector.CreatedBy,
	))
	if err != nil {
		return fmt.Errorf("respond: create integration connector: %w", err)
	}
	*connector = *created
	for idx := range secrets {
		secrets[idx].TenantID = connector.TenantID
		secrets[idx].ConnectorID = connector.ID
		if err := s.UpsertIntegrationConnectorSecret(ctx, db, &secrets[idx]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) UpsertIntegrationConnectorSecret(ctx context.Context, db DBTX, secret *IntegrationConnectorSecret) error {
	secret.Name = stringFromAny(secret.Name)
	secret.SecretRef = stringFromAny(secret.SecretRef)
	if secret.TenantID == uuid.Nil || secret.ConnectorID == uuid.Nil || secret.Name == "" {
		return fmt.Errorf("tenant_id, connector_id, and secret name are required: %w", ErrValidation)
	}
	if secret.SecretRef == "" && len(secret.EncryptedValue) == 0 {
		return fmt.Errorf("secret %q requires stored material: %w", secret.Name, ErrIntegrationConfig)
	}
	return db.QueryRow(ctx, `
INSERT INTO respond_integration_connector_secret (
    tenant_id, connector_id, secret_name, secret_ref, encrypted_value, encrypted_nonce, key_id
)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (connector_id, secret_name)
DO UPDATE SET secret_ref = EXCLUDED.secret_ref,
              encrypted_value = EXCLUDED.encrypted_value,
              encrypted_nonce = EXCLUDED.encrypted_nonce,
              key_id = EXCLUDED.key_id,
              updated_at = now()
RETURNING id, created_at, updated_at`,
		secret.TenantID,
		secret.ConnectorID,
		secret.Name,
		secret.SecretRef,
		secret.EncryptedValue,
		secret.EncryptedNonce,
		secret.KeyID,
	).Scan(&secret.ID, &secret.CreatedAt, &secret.UpdatedAt)
}

func (s *Store) GetIntegrationConnectorWithSecrets(ctx context.Context, db DBTX, tenantID, connectorID uuid.UUID) (*IntegrationConnector, []IntegrationConnectorSecret, error) {
	connector, err := scanIntegrationConnector(db.QueryRow(ctx, `
SELECT `+integrationConnectorColumns+`
  FROM respond_integration_connector
 WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, connectorID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrIntegrationConnectorNotFound
		}
		return nil, nil, fmt.Errorf("respond: get integration connector: %w", err)
	}
	rows, err := db.Query(ctx, `
SELECT id, tenant_id, connector_id, secret_name, secret_ref, encrypted_value, encrypted_nonce, key_id, created_at, updated_at
  FROM respond_integration_connector_secret
 WHERE tenant_id = $1 AND connector_id = $2
 ORDER BY secret_name ASC`, tenantID, connectorID)
	if err != nil {
		return nil, nil, fmt.Errorf("respond: list integration connector secrets: %w", err)
	}
	defer rows.Close()
	var secrets []IntegrationConnectorSecret
	for rows.Next() {
		secret, err := scanIntegrationSecret(rows)
		if err != nil {
			return nil, nil, fmt.Errorf("respond: scan integration connector secret: %w", err)
		}
		secrets = append(secrets, *secret)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("respond: read integration connector secrets: %w", err)
	}
	return connector, secrets, nil
}

func (s *Store) ListIntegrationConnectors(ctx context.Context, db DBTX, tenantID uuid.UUID, kind *IntegrationKind, provider *IntegrationProvider) ([]IntegrationConnector, error) {
	args := []any{tenantID}
	query := `
SELECT ` + integrationConnectorColumns + `
  FROM respond_integration_connector
 WHERE tenant_id = $1 AND deleted_at IS NULL`
	if kind != nil {
		args = append(args, *kind)
		query += fmt.Sprintf(" AND kind = $%d", len(args))
	}
	if provider != nil {
		args = append(args, *provider)
		query += fmt.Sprintf(" AND provider = $%d", len(args))
	}
	query += " ORDER BY name ASC, created_at ASC"

	rows, err := db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("respond: list integration connectors: %w", err)
	}
	defer rows.Close()
	connectors := []IntegrationConnector{}
	for rows.Next() {
		connector, err := scanIntegrationConnector(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan integration connector: %w", err)
		}
		connectors = append(connectors, *connector)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read integration connectors: %w", err)
	}
	return connectors, nil
}

const integrationLinkColumns = `id, tenant_id, incident_id, connector_id, provider, external_id, external_key,
external_url, external_status, external_priority, sync_direction, last_synced_at,
last_sync_direction, sync_error, created_at, updated_at`

func scanIntegrationLink(row rowScanner) (*IntegrationExternalLink, error) {
	var link IntegrationExternalLink
	var provider, direction string
	if err := row.Scan(
		&link.ID,
		&link.TenantID,
		&link.IncidentID,
		&link.ConnectorID,
		&provider,
		&link.ExternalID,
		&link.ExternalKey,
		&link.ExternalURL,
		&link.ExternalStatus,
		&link.ExternalPriority,
		&direction,
		&link.LastSyncedAt,
		&link.LastSyncDirection,
		&link.SyncError,
		&link.CreatedAt,
		&link.UpdatedAt,
	); err != nil {
		return nil, err
	}
	link.Provider = IntegrationProvider(provider)
	link.SyncDirection = IntegrationSyncDirection(direction)
	return &link, nil
}

func (s *Store) GetIntegrationLinkByIncidentConnector(ctx context.Context, db DBTX, tenantID, incidentID, connectorID uuid.UUID) (*IntegrationExternalLink, error) {
	link, err := scanIntegrationLink(db.QueryRow(ctx, `
SELECT `+integrationLinkColumns+`
  FROM respond_incident_integration_link
 WHERE tenant_id = $1 AND incident_id = $2 AND connector_id = $3`, tenantID, incidentID, connectorID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrIntegrationLinkNotFound
		}
		return nil, fmt.Errorf("respond: get integration link by incident: %w", err)
	}
	return link, nil
}

func (s *Store) GetIntegrationLinkByExternal(ctx context.Context, db DBTX, tenantID, connectorID uuid.UUID, externalID string) (*IntegrationExternalLink, error) {
	link, err := scanIntegrationLink(db.QueryRow(ctx, `
SELECT `+integrationLinkColumns+`
  FROM respond_incident_integration_link
 WHERE tenant_id = $1 AND connector_id = $2 AND external_id = $3`, tenantID, connectorID, externalID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrIntegrationLinkNotFound
		}
		return nil, fmt.Errorf("respond: get integration link by external: %w", err)
	}
	return link, nil
}

func (s *Store) ListIntegrationLinksForIncident(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, limit int) ([]IntegrationExternalLink, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := db.Query(ctx, `
SELECT `+integrationLinkColumns+`
  FROM respond_incident_integration_link
 WHERE tenant_id = $1 AND incident_id = $2
 ORDER BY updated_at DESC, id DESC
 LIMIT $3`, tenantID, incidentID, limit)
	if err != nil {
		return nil, fmt.Errorf("respond: list integration links for incident: %w", err)
	}
	defer rows.Close()
	var out []IntegrationExternalLink
	for rows.Next() {
		link, err := scanIntegrationLink(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan integration link for incident: %w", err)
		}
		out = append(out, *link)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read integration links for incident: %w", err)
	}
	return out, nil
}

func (s *Store) UpsertIntegrationLink(ctx context.Context, db DBTX, link *IntegrationExternalLink) error {
	if link.TenantID == uuid.Nil || link.IncidentID == uuid.Nil || link.ConnectorID == uuid.Nil {
		return fmt.Errorf("tenant_id, incident_id, and connector_id are required: %w", ErrValidation)
	}
	link.ExternalID = stringFromAny(link.ExternalID)
	link.ExternalKey = stringFromAny(link.ExternalKey)
	link.ExternalURL = stringFromAny(link.ExternalURL)
	if link.ExternalID == "" || link.ExternalKey == "" {
		return fmt.Errorf("external_id and external_key are required: %w", ErrValidation)
	}
	if link.SyncDirection == "" {
		link.SyncDirection = IntegrationSyncBidirectional
	}
	upserted, err := scanIntegrationLink(db.QueryRow(ctx, `
INSERT INTO respond_incident_integration_link (
    tenant_id, incident_id, connector_id, provider, external_id, external_key,
    external_url, external_status, external_priority, sync_direction, last_synced_at,
    last_sync_direction, sync_error
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (tenant_id, incident_id, connector_id)
DO UPDATE SET external_id = EXCLUDED.external_id,
              external_key = EXCLUDED.external_key,
              external_url = EXCLUDED.external_url,
              external_status = EXCLUDED.external_status,
              external_priority = EXCLUDED.external_priority,
              sync_direction = EXCLUDED.sync_direction,
              last_synced_at = EXCLUDED.last_synced_at,
              last_sync_direction = EXCLUDED.last_sync_direction,
              sync_error = EXCLUDED.sync_error,
              updated_at = now()
RETURNING `+integrationLinkColumns,
		link.TenantID,
		link.IncidentID,
		link.ConnectorID,
		link.Provider,
		link.ExternalID,
		link.ExternalKey,
		link.ExternalURL,
		link.ExternalStatus,
		link.ExternalPriority,
		link.SyncDirection,
		link.LastSyncedAt,
		link.LastSyncDirection,
		link.SyncError,
	))
	if err != nil {
		return fmt.Errorf("respond: upsert integration link: %w", err)
	}
	*link = *upserted
	return nil
}

func (s *Store) RegisterIntegrationWebhookEvent(ctx context.Context, db DBTX, record *IntegrationWebhookDedupeRecord) (bool, error) {
	if record.TenantID == uuid.Nil || record.ConnectorID == uuid.Nil || record.ExternalEventID == "" {
		return false, fmt.Errorf("tenant_id, connector_id, and external_event_id are required: %w", ErrValidation)
	}
	if record.Status == "" {
		record.Status = IntegrationAuditPending
	}
	if record.ReceivedAt.IsZero() {
		record.ReceivedAt = time.Now().UTC()
	}
	err := db.QueryRow(ctx, `
INSERT INTO respond_integration_webhook_dedupe (
    tenant_id, connector_id, provider, external_event_id, external_id, payload_hash,
    status, received_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (connector_id, external_event_id) DO NOTHING
RETURNING id, received_at`,
		record.TenantID,
		record.ConnectorID,
		record.Provider,
		record.ExternalEventID,
		record.ExternalID,
		record.PayloadHash,
		record.Status,
		record.ReceivedAt,
	).Scan(&record.ID, &record.ReceivedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("respond: register webhook event: %w", err)
	}
	return true, nil
}

func (s *Store) MarkIntegrationWebhookEvent(ctx context.Context, db DBTX, tenantID, connectorID uuid.UUID, eventID string, status IntegrationAuditStatus, lastError string) error {
	var processedAt any
	if status == IntegrationAuditSucceeded || status == IntegrationAuditDuplicate {
		processedAt = time.Now().UTC()
	}
	_, err := db.Exec(ctx, `
UPDATE respond_integration_webhook_dedupe
   SET status = $4,
       processed_at = COALESCE($5, processed_at),
       last_error = $6
 WHERE tenant_id = $1 AND connector_id = $2 AND external_event_id = $3`,
		tenantID, connectorID, eventID, status, processedAt, lastError)
	if err != nil {
		return fmt.Errorf("respond: mark webhook event: %w", err)
	}
	return nil
}

func (s *Store) RecordIntegrationSyncAudit(ctx context.Context, db DBTX, audit *IntegrationSyncAudit) error {
	if audit.TenantID == uuid.Nil || audit.ConnectorID == uuid.Nil || audit.Action == "" || audit.Direction == "" || audit.Status == "" {
		return fmt.Errorf("tenant_id, connector_id, action, direction, and status are required: %w", ErrValidation)
	}
	if audit.Attempt <= 0 {
		audit.Attempt = 1
	}
	if audit.StartedAt.IsZero() {
		audit.StartedAt = time.Now().UTC()
	}
	requestJSON, err := mapToJSONBytes(audit.RequestPayload)
	if err != nil {
		return fmt.Errorf("respond: marshal integration audit request: %w", err)
	}
	err = db.QueryRow(ctx, `
INSERT INTO respond_integration_sync_audit (
    tenant_id, connector_id, incident_id, link_id, provider, direction, action,
    status, request_payload, response_status, response_body, external_event_id,
    external_id, idempotency_key, attempt, next_retry_at, error_message,
    started_at, completed_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, 0), $11, $12, $13, $14, $15, $16, $17, $18, $19)
RETURNING id, created_at`,
		audit.TenantID,
		audit.ConnectorID,
		audit.IncidentID,
		audit.LinkID,
		audit.Provider,
		audit.Direction,
		audit.Action,
		audit.Status,
		requestJSON,
		audit.ResponseStatus,
		audit.ResponseBody,
		audit.ExternalEventID,
		audit.ExternalID,
		audit.IdempotencyKey,
		audit.Attempt,
		audit.NextRetryAt,
		audit.ErrorMessage,
		audit.StartedAt,
		audit.CompletedAt,
	).Scan(&audit.ID, &audit.CreatedAt)
	if err != nil {
		return fmt.Errorf("respond: record integration sync audit: %w", err)
	}
	return nil
}

func (s *Store) ApplyInboundIncidentUpdate(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, update InboundIncidentUpdate) (*Incident, error) {
	var severity *string
	if update.Severity != nil {
		if !update.Severity.Valid() {
			return nil, ErrInvalidSeverity
		}
		value := string(*update.Severity)
		severity = &value
	}
	var status *string
	if update.Status != nil {
		if !update.Status.Valid() {
			return nil, ErrInvalidStatus
		}
		value := string(*update.Status)
		status = &value
	}
	at := update.OccurredAt
	if at.IsZero() {
		at = time.Now().UTC()
	}
	incident, err := scanIncident(db.QueryRow(ctx, `
UPDATE respond_incident
   SET title = CASE WHEN length(trim($3::text)) > 0 THEN trim($3::text) ELSE title END,
       description = CASE WHEN length(trim($4::text)) > 0 THEN trim($4::text) ELSE description END,
       severity = COALESCE($5::text, severity),
       status = COALESCE($6::text, status),
       mitigated_at = CASE WHEN $6::text = 'Mitigated' THEN COALESCE(mitigated_at, $7) ELSE mitigated_at END,
       resolved_at = CASE WHEN $6::text = 'Resolved' THEN COALESCE(resolved_at, $7) ELSE resolved_at END,
       closed_at = CASE WHEN $6::text = 'Closed' THEN COALESCE(closed_at, $7) ELSE closed_at END,
       row_version = row_version + 1,
       updated_at = now()
 WHERE tenant_id = $1 AND id = $2
RETURNING `+incidentColumns,
		tenantID,
		incidentID,
		update.Title,
		update.Description,
		severity,
		status,
		at,
	))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrIncidentNotFound
		}
		return nil, fmt.Errorf("respond: apply inbound incident update: %w", err)
	}
	return incident, nil
}
