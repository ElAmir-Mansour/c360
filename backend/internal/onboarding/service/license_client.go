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

	"github.com/clario360/platform/internal/catalog"
)

// LicenseAssigner assigns a tenant's default (trial) license during
// provisioning, scoped to the suites selected in the onboarding wizard.
// It is an interface so the provisioner can be tested without a live
// license-service, and so the step no-ops cleanly when licensing integration is
// not configured (assigner == nil).
type LicenseAssigner interface {
	// AssignBaseTrial assigns the shared trial plan ONLY (grants every plan key);
	// it writes NO scope overrides. Scoping is owned exclusively by the wizard
	// (SaveSuites/Complete via RescopeLicense). This makes the async pipeline
	// incapable of revoking a customer's chosen suite.
	AssignBaseTrial(ctx context.Context, tenantID string, seats int) error
	// RescopeLicense re-scopes an already-assigned trial to the customer's final
	// suite selection (called when the wizard suites step is saved): it re-grants
	// the selected keys (removing any revoke override) and revokes the rest.
	RescopeLicense(ctx context.Context, tenantID string, activeSuites []string, seats int) error
}

// httpLicenseAssigner calls the license-service internal API (service-token
// guarded) to assign the shared `trial` plan, then revokes the self-serve keys
// the customer did NOT select so the trial is scoped to their selection.
// (Overrides can only revoke — see internal/catalog.UnselectedEntitlementKeys.)
type httpLicenseAssigner struct {
	baseURL    string // license-service base, e.g. http://127.0.0.1:8096
	token      string // shared LICENSE_INTERNAL_TOKEN
	client     *http.Client
	trialDays  int
	trialSeats int64
	graceDays  int
	logger     zerolog.Logger
}

// NewHTTPLicenseAssigner builds the assigner. Returns nil if baseURL or token is
// empty so the provisioner step is skipped (licensing integration disabled).
func NewHTTPLicenseAssigner(baseURL, token string, logger zerolog.Logger) LicenseAssigner {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" || strings.TrimSpace(token) == "" {
		return nil
	}
	return &httpLicenseAssigner{
		baseURL:    baseURL,
		token:      token,
		client:     &http.Client{Timeout: 15 * time.Second},
		trialDays:  14,
		trialSeats: 5,
		graceDays:  7,
		logger:     logger,
	}
}

// AssignBaseTrial assigns the shared trial plan ONLY (grants every plan key);
// it writes NO scope overrides. Scoping is owned exclusively by the wizard
// (SaveSuites/Complete via RescopeLicense). This makes the async pipeline
// incapable of revoking a customer's chosen suite.
func (a *httpLicenseAssigner) AssignBaseTrial(ctx context.Context, tenantID string, seats int) error {
	if seats <= 0 {
		seats = int(a.trialSeats)
	}
	// Assign the shared trial plan (grants every self-serve key + seats). This is
	// the ONLY async license write; it writes NO overrides, so it can never revoke
	// a suite the customer selected in the wizard. Re-POSTing the trial plan is
	// override-preserving (AssignLicense never touches entitlement_overrides), so
	// it is safe to land in any interleaving relative to the wizard's scoped writes.
	expires := time.Now().UTC().Add(time.Duration(a.trialDays) * 24 * time.Hour)
	if err := a.do(ctx, http.MethodPost,
		fmt.Sprintf("/internal/licensing/tenants/%s/license", tenantID),
		map[string]any{
			"plan_key":   "trial",
			"seats":      int64(seats),
			"expires_at": expires.Format(time.RFC3339),
			"grace_days": a.graceDays,
		}); err != nil {
		return fmt.Errorf("assign trial license: %w", err)
	}
	a.logger.Info().Str("tenant_id", tenantID).Int("seats", seats).
		Msg("assigned base trial license (full grant; scoping owned by wizard)")
	return nil
}

func (a *httpLicenseAssigner) RescopeLicense(ctx context.Context, tenantID string, activeSuites []string, seats int) error {
	if seats <= 0 {
		seats = int(a.trialSeats)
	}
	expires := time.Now().UTC().Add(time.Duration(a.trialDays) * 24 * time.Hour)
	if err := a.do(ctx, http.MethodPost,
		fmt.Sprintf("/internal/licensing/tenants/%s/license", tenantID),
		map[string]any{
			"plan_key":   "trial",
			"seats":      int64(seats),
			"expires_at": expires.Format(time.RFC3339),
			"grace_days": a.graceDays,
		}); err != nil {
		return fmt.Errorf("update trial license seats: %w", err)
	}

	// Re-grant the selected keys: delete any revoke override (idempotent — a 404
	// means the key was never revoked, which is fine).
	for _, key := range catalog.EntitlementKeysForSuites(activeSuites) {
		if err := a.do(ctx, http.MethodDelete,
			fmt.Sprintf("/internal/licensing/tenants/%s/overrides/%s", tenantID, key), nil); err != nil {
			return fmt.Errorf("re-grant selected key %s: %w", key, err)
		}
	}
	// Revoke everything not selected.
	revoked := catalog.UnselectedEntitlementKeys(activeSuites)
	for _, key := range revoked {
		zero := int64(0)
		if err := a.do(ctx, http.MethodPut,
			fmt.Sprintf("/internal/licensing/tenants/%s/overrides/%s", tenantID, key),
			map[string]any{"limit": &zero, "reason": "trial scope: not selected at onboarding"}); err != nil {
			return fmt.Errorf("revoke unselected key %s: %w", key, err)
		}
	}
	a.logger.Info().Str("tenant_id", tenantID).Strs("suites", activeSuites).
		Strs("revoked_keys", revoked).Msg("re-scoped trial license to selected suites")
	return nil
}

func (a *httpLicenseAssigner) do(ctx context.Context, method, path string, body any) error {
	buf, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.baseURL+path, bytes.NewReader(buf))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Service-Token", a.token)
	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("call %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	// Deleting an override that doesn't exist is a no-op (the key was never
	// revoked), so a 404 on DELETE is success.
	if resp.StatusCode == http.StatusNotFound && method == http.MethodDelete {
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("%s %s -> %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(snippet)))
	}
	return nil
}
