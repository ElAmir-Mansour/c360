package migrate

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

type SecretResolver interface {
	Resolve(ctx context.Context, ref string) (string, error)
}

type EnvironmentSecretResolver struct{}

func (EnvironmentSecretResolver) Resolve(_ context.Context, ref string) (string, error) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return "", nil
	}
	value := strings.TrimSpace(os.Getenv(ref))
	if value == "" {
		return "", fmt.Errorf("secret ref %q is empty or not set: %w", ref, ErrConnectorNotConfigured)
	}
	return value, nil
}

type ConnectorExecutor interface {
	Invoke(ctx context.Context, cfg ConnectorConfig, in ConnectorInvocation) (status string, httpStatus int, responseBody string, err error)
}

type HTTPConnectorExecutor struct {
	client  *http.Client
	secrets SecretResolver
}

func NewHTTPConnectorExecutor(secrets SecretResolver, timeout time.Duration) *HTTPConnectorExecutor {
	if secrets == nil {
		secrets = EnvironmentSecretResolver{}
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &HTTPConnectorExecutor{
		client:  &http.Client{Timeout: timeout},
		secrets: secrets,
	}
}

func (e *HTTPConnectorExecutor) Invoke(ctx context.Context, cfg ConnectorConfig, in ConnectorInvocation) (string, int, string, error) {
	if !cfg.Enabled {
		return "failed", 0, "", ErrConnectorNotConfigured
	}
	if strings.TrimSpace(cfg.EndpointURL) == "" {
		return "failed", 0, "", ErrConnectorNotConfigured
	}
	body, err := json.Marshal(map[string]any{
		"action":          in.Action,
		"window_id":       in.WindowID,
		"idempotency_key": in.IdempotencyKey,
		"payload":         in.RequestBody,
	})
	if err != nil {
		return "failed", 0, "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.EndpointURL, bytes.NewReader(body))
	if err != nil {
		return "failed", 0, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", in.IdempotencyKey)
	req.Header.Set("X-Clario360-Connector", cfg.Provider)
	secret, err := e.secrets.Resolve(ctx, cfg.SecretRef)
	if err != nil {
		return "failed", 0, "", err
	}
	switch cfg.AuthType {
	case "", "none":
	case "bearer":
		if secret == "" {
			return "failed", 0, "", ErrConnectorNotConfigured
		}
		req.Header.Set("Authorization", "Bearer "+secret)
	case "basic":
		if secret == "" {
			return "failed", 0, "", ErrConnectorNotConfigured
		}
		req.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(secret)))
	default:
		return "failed", 0, "", fmt.Errorf("auth_type %q: %w", cfg.AuthType, ErrConnectorNotConfigured)
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return "failed", 0, "", fmt.Errorf("%w: %v", ErrConnectorRequestFailed, err)
	}
	defer resp.Body.Close()
	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if readErr != nil {
		return "failed", resp.StatusCode, "", readErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "failed", resp.StatusCode, string(raw), fmt.Errorf("%w: status %d", ErrConnectorRequestFailed, resp.StatusCode)
	}
	return "succeeded", resp.StatusCode, string(raw), nil
}

type SaveConnectorInput struct {
	Name        string `json:"name"`
	Provider    string `json:"provider"`
	EndpointURL string `json:"endpoint_url"`
	AuthType    string `json:"auth_type"`
	SecretRef   string `json:"secret_ref"`
	Enabled     bool   `json:"enabled"`
	Actor       Actor  `json:"-"`
}

type InvokeConnectorInput struct {
	ConnectorID    uuid.UUID      `json:"connector_id"`
	WindowID       uuid.UUID      `json:"window_id"`
	IdempotencyKey string         `json:"idempotency_key"`
	Action         string         `json:"action"`
	Payload        map[string]any `json:"payload"`
	Actor          Actor          `json:"-"`
}

func (s *Service) SaveConnector(ctx context.Context, tenantID uuid.UUID, in SaveConnectorInput) (*ConnectorConfig, error) {
	if !in.Actor.Can(PermMigrateIntegrations) {
		return nil, ErrUnauthorized
	}
	cfg := &ConnectorConfig{
		TenantID:    tenantID,
		Name:        strings.TrimSpace(in.Name),
		Provider:    strings.TrimSpace(in.Provider),
		EndpointURL: strings.TrimSpace(in.EndpointURL),
		AuthType:    strings.TrimSpace(in.AuthType),
		SecretRef:   strings.TrimSpace(in.SecretRef),
		Enabled:     in.Enabled,
		CreatedBy:   in.Actor.UserID,
	}
	if cfg.Name == "" || cfg.EndpointURL == "" {
		return nil, fmt.Errorf("name and endpoint_url are required: %w", ErrValidation)
	}
	if cfg.Provider == "" {
		cfg.Provider = "http_migration_service"
	}
	if cfg.AuthType == "" {
		cfg.AuthType = "none"
	}
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		return s.store.UpsertConnector(ctx, tx, cfg)
	})
	return cfg, err
}

func (s *Service) ListConnectors(ctx context.Context, tenantID uuid.UUID, actor Actor) ([]ConnectorConfig, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var out []ConnectorConfig
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		out, err = s.store.ListConnectors(ctx, tx, tenantID)
		return err
	})
	return out, err
}

func (s *Service) InvokeConnector(ctx context.Context, tenantID uuid.UUID, in InvokeConnectorInput) (*ConnectorInvocation, error) {
	if !in.Actor.Can(PermMigrateCutover) && !in.Actor.Can(PermMigrateIntegrations) {
		return nil, ErrUnauthorized
	}
	in.IdempotencyKey = strings.TrimSpace(in.IdempotencyKey)
	in.Action = strings.TrimSpace(in.Action)
	if in.ConnectorID == uuid.Nil || in.WindowID == uuid.Nil || in.IdempotencyKey == "" || in.Action == "" {
		return nil, fmt.Errorf("connector_id, window_id, idempotency_key, and action are required: %w", ErrValidation)
	}
	var cfg *ConnectorConfig
	var inv *ConnectorInvocation
	var programID uuid.UUID
	created := false
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		existing, err := s.store.GetInvocationByKey(ctx, tx, tenantID, in.IdempotencyKey)
		if err == nil {
			inv = existing
			return nil
		}
		if !errorsIsNotFound(err) {
			return err
		}
		cfg, err = s.store.GetConnector(ctx, tx, tenantID, in.ConnectorID)
		if err != nil {
			return err
		}
		window, err := s.store.GetWindow(ctx, tx, tenantID, in.WindowID)
		if err != nil {
			return err
		}
		programID = window.ProgramID
		inv = &ConnectorInvocation{
			TenantID:       tenantID,
			ConnectorID:    in.ConnectorID,
			WindowID:       in.WindowID,
			IdempotencyKey: in.IdempotencyKey,
			Action:         in.Action,
			RequestBody:    in.Payload,
		}
		if err := s.store.CreateInvocation(ctx, tx, inv); err != nil {
			return err
		}
		created = true
		return nil
	})
	if err != nil || inv == nil || !created {
		return inv, err
	}
	status, httpStatus, response, callErr := s.connectors.Invoke(ctx, *cfg, *inv)
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		finished, err := s.store.FinishInvocation(ctx, tx, tenantID, inv.ID, status, httpStatus, response, errString(callErr))
		if err != nil {
			return err
		}
		inv = finished
		return s.audit(ctx, tx, tenantID, programID, &in.Actor.UserID, "connector.invoked", &inv.ID, "connector_invocation", "Migration connector invoked", map[string]any{"connector_id": in.ConnectorID, "action": in.Action, "status": status, "http_status": httpStatus}, s.now())
	})
	if err != nil {
		return inv, err
	}
	if callErr != nil {
		return inv, callErr
	}
	return inv, nil
}

func errorsIsNotFound(err error) bool {
	return err != nil && (err == ErrNotFound || strings.Contains(err.Error(), ErrNotFound.Error()))
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
