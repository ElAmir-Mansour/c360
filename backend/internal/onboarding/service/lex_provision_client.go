package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// LexProvisioner applies the Watheeq "Legal Affairs starter template" to a tenant
// during provisioning, when the customer subscribed to Watheeq/Lex. It is an
// interface so the provisioner is testable without a live lex-service, and so the
// step no-ops cleanly when the integration is not configured (provisioner == nil).
type LexProvisioner interface {
	// ProvisionLegalAffairs applies the config template (service catalog + SLA,
	// working calendar, org registry + escalation, request-approval templates) to
	// the tenant. When adminUserID is non-empty (and platform_core is reachable on
	// the lex side), it also seeds the 14 legal roles for the tenant and assigns the
	// admin user the 'legal-system-admin' role. Idempotent — safe to call on an
	// already-provisioned tenant.
	ProvisionLegalAffairs(ctx context.Context, tenantID string, adminUserID string) error
}

// httpLexProvisioner calls the lex-service internal API (service-token guarded,
// mirrors the license-service internal client) to apply the Legal Affairs template.
type httpLexProvisioner struct {
	baseURL string // lex-service base, e.g. http://127.0.0.1:8088
	token   string // shared LEX_INTERNAL_TOKEN
	client  *http.Client
	logger  zerolog.Logger
}

// NewHTTPLexProvisioner builds the provisioner. Returns nil if baseURL or token
// is empty so the provisioning step is skipped (lex integration disabled).
func NewHTTPLexProvisioner(baseURL, token string, logger zerolog.Logger) LexProvisioner {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" || strings.TrimSpace(token) == "" {
		return nil
	}
	return &httpLexProvisioner{
		baseURL: baseURL,
		token:   token,
		client:  &http.Client{Timeout: 30 * time.Second},
		logger:  logger,
	}
}

func (p *httpLexProvisioner) ProvisionLegalAffairs(ctx context.Context, tenantID string, adminUserID string) error {
	payload := map[string]any{"tenant_id": tenantID, "include_sample_data": false}
	if strings.TrimSpace(adminUserID) != "" {
		payload["admin_user_id"] = adminUserID
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal lex provision request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL+"/internal/lex/provision", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build lex provision request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Service-Token", p.token)

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("call lex provision: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("lex provision returned %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	p.logger.Info().Str("tenant_id", tenantID).Msg("provisioned Watheeq Legal Affairs starter template")
	return nil
}
