package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// CAP-069 / CAP-175 — Najiz (ناجز) court-portal reconciliation plan.
//
// MANUAL NOW: defendant-side company-representative registration is always
// preserved as operator-entered data plus najiz_status/najiz_reference.
//
// API LATER: this adapter is the court-portal seam behind a port. The defendant
// service calls it when a Najiz integration endpoint is registered AND active for
// the tenant; otherwise the port reports "not configured" and the service keeps
// the honest manual-entry + najiz_status behavior (no faked sync).
//
// This is distinct from the e-signature Najiz/Nafath custody path; it reconciles
// court-portal representation state for litigation defendant cases only.
//
// The endpoint URL and credentials are read from lex_integration_endpoints
// (kind="najiz") via the integration repository, which FieldCrypto-DECRYPTS the
// Config map on read (CAP-179). We deliberately resolve through the repository,
// NOT IntegrationRegistryService.Get/List, because the registry service REDACTS
// config before returning it to callers — the adapter needs the plaintext URL +
// secret to open the connection.
//
// Mirrors the HTTP-dispatcher pattern of obligation_reminder_http.go and the
// "thin delegate seam" shape of sso_seam.go.
// =============================================================================

// ErrNajizNotConfigured is the sentinel returned when no active Najiz endpoint
// is registered for the tenant. The defendant service treats this as "fall back
// to manual entry + status" rather than an error.
var ErrNajizNotConfigured = errors.New("lex/najiz: no active Najiz integration endpoint configured for tenant")

// ErrNajizWritesDisabled is returned when an active endpoint is configured for
// READ-only operation (the default) and a WRITE operation (add-representative)
// is attempted. The defendant service treats this as "keep the manual path":
// the company-representative registration stays operator-entered until a tenant
// EXPLICITLY opts the endpoint into bi-directional writes (allow_writes=true).
// Until MoJ Takamul write-scope onboarding exists, writes stay gated.
var ErrNajizWritesDisabled = errors.New("lex/najiz: endpoint is read-only; representative writes are gated until allow_writes is enabled")

// najizMaxRetries is the number of ADDITIONAL attempts after the first on a
// transient failure (so up to najizMaxRetries+1 total dispatches).
const najizMaxRetries = 2

// najizBaseBackoff is the first inter-attempt delay; it doubles each retry and
// is overridden by a server-supplied Retry-After when present.
const najizBaseBackoff = 200 * time.Millisecond

// najizMaxBackoff caps the exponential/Retry-After backoff so a hostile or
// mis-configured server can never wedge a request for minutes.
const najizMaxBackoff = 5 * time.Second

// NajizRepresentativeRequest is the input to the add-representative call.
type NajizRepresentativeRequest struct {
	// CaseID is the lex legal case the incoming lawsuit hangs off.
	CaseID uuid.UUID
	// DefendantCaseID is the defendant (incoming-lawsuit) registration.
	DefendantCaseID uuid.UUID
	// CompanyRepresentative is the name/identifier of the representative the
	// company is registering on the portal as its litigation agent.
	CompanyRepresentative string
	// NationalID / IqamaID of the representative, when supplied by the operator
	// (optional; the Najiz portal commonly keys on it).
	NationalID string
	// CourtName is the serving court, when known.
	CourtName string
	// PlaintiffName is the opposing party, for portal correlation.
	PlaintiffName string
	// NajizReference is an existing portal case reference, when known.
	NajizReference string
}

// NajizRepresentativeResult is the normalized outcome of an add-representative
// attempt. Status maps onto model.NajizSyncStatus so the defendant service can
// stamp the row directly.
type NajizRepresentativeResult struct {
	// Status is the resulting Najiz sync status (synced on success, failed on a
	// rejected attempt). The service maps this onto the defendant row.
	Status model.NajizSyncStatus
	// Reference is the portal-assigned reference for the representation, if any.
	Reference string
	// EndpointID / EndpointCode identify which registered endpoint served the
	// call (audit / metadata).
	EndpointID   uuid.UUID
	EndpointCode string
	// Detail is a human-readable note (provider message / status text).
	Detail string
	// Metadata is non-sensitive provider annotation for the defendant row's
	// metadata blob (never echoes credentials).
	Metadata map[string]any
}

// NajizCaseSyncRequest is the input to the READ-first case/hearing/representative
// pull. NajizReference scopes the fetch to a single portal case when known;
// otherwise the adapter pulls the cases the configured org is party to.
type NajizCaseSyncRequest struct {
	// CaseID is the lex legal case the sync correlates against (audit / metadata).
	CaseID uuid.UUID
	// NajizReference scopes the read to one portal case when supplied.
	NajizReference string
}

// NajizHearing is a normalized hearing/session record pulled from the portal.
type NajizHearing struct {
	Reference   string    `json:"reference"`
	Court       string    `json:"court"`
	ScheduledAt time.Time `json:"scheduled_at"`
	Status      string    `json:"status"`
	Detail      string    `json:"detail,omitempty"`
}

// NajizRepresentativeRecord is a normalized representative as the portal holds it.
type NajizRepresentativeRecord struct {
	Name       string `json:"name"`
	NationalID string `json:"national_id,omitempty"`
	Role       string `json:"role,omitempty"`
	Reference  string `json:"reference,omitempty"`
}

// NajizCaseSyncResult is the normalized outcome of a READ-first pull. It carries
// the portal's view of the case, scheduled hearings, and registered
// representatives so the defendant service can RECONCILE (never blindly
// overwrite) operator-entered data.
type NajizCaseSyncResult struct {
	Reference       string                      `json:"reference"`
	CourtName       string                      `json:"court_name,omitempty"`
	PlaintiffName   string                      `json:"plaintiff_name,omitempty"`
	PortalStatus    string                      `json:"portal_status,omitempty"`
	Hearings        []NajizHearing              `json:"hearings"`
	Representatives []NajizRepresentativeRecord `json:"representatives"`
	EndpointID      uuid.UUID                   `json:"-"`
	EndpointCode    string                      `json:"-"`
	// Sandbox is true when the result was produced by the bundled sandbox/mock
	// transport rather than a live MoJ endpoint — callers MUST surface this so a
	// demo is never mistaken for live reconciliation.
	Sandbox  bool           `json:"sandbox"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// NajizCourtPort is the seam the defendant service depends on (CAP-069). Real
// connectors implement these against a live Najiz endpoint; the bundled HTTP
// adapter resolves a configured endpoint and dispatches to it, returning
// ErrNajizNotConfigured when no active endpoint exists so the caller can fall
// back to manual entry.
type NajizCourtPort interface {
	// SyncCase performs the READ-first pull of case/hearing/representative state
	// from the portal. This is the primary, always-allowed direction: even a
	// read-only endpoint serves it. Returns ErrNajizNotConfigured when no active
	// Najiz endpoint is registered for the tenant.
	SyncCase(ctx context.Context, tenantID uuid.UUID, req NajizCaseSyncRequest) (*NajizCaseSyncResult, error)
	// AddRepresentative registers a company representative on the Najiz portal
	// for the given defendant case. This is a WRITE and is GATED: it returns
	// ErrNajizWritesDisabled unless the endpoint config sets allow_writes=true,
	// and ErrNajizNotConfigured when no active Najiz endpoint is registered.
	AddRepresentative(ctx context.Context, tenantID uuid.UUID, req NajizRepresentativeRequest) (*NajizRepresentativeResult, error)
	// Health returns an honest verdict for the tenant's Najiz wiring (configured /
	// not_configured / read_only), NEVER fabricating live MoJ success.
	Health(ctx context.Context, tenantID uuid.UUID) NajizHealth
}

// NajizHealth is the honest connectivity verdict for the tenant's Najiz wiring.
type NajizHealth struct {
	Configured    bool `json:"configured"`
	WritesAllowed bool `json:"writes_allowed"`
	Sandbox       bool `json:"sandbox"`
	// Verdict is one of: not_configured, planned, read_only, read_write.
	Verdict      string    `json:"verdict"`
	Detail       string    `json:"detail"`
	EndpointCode string    `json:"endpoint_code,omitempty"`
	CheckedAt    time.Time `json:"checked_at"`
}

// HTTPNajizCourtAdapter is the bundled NajizCourtPort. It resolves the tenant's
// active Najiz endpoint from lex_integration_endpoints (decrypted config) and
// POSTs an add-representative request to it.
type HTTPNajizCourtAdapter struct {
	endpoints najizEndpointLister
	client    *http.Client
	logger    zerolog.Logger
	now       func() time.Time
}

// najizEndpointLister is the narrow read seam the adapter needs from the
// integration-endpoint repository. *repository.IntegrationEndpointRepository
// satisfies it; tests substitute an in-memory fake so the adapter is exercisable
// without a database.
type najizEndpointLister interface {
	List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error)
}

// HTTPNajizCourtAdapterConfig parametrises the adapter. Only the repository is
// required; the HTTP client and timeout default sensibly.
type HTTPNajizCourtAdapterConfig struct {
	Endpoints *repository.IntegrationEndpointRepository
	Client    *http.Client
	Timeout   time.Duration
	Logger    zerolog.Logger
}

// NewHTTPNajizCourtAdapter builds the adapter. The repository must be wired with
// FieldCrypto (repo.WithFieldCrypto) so Config is decrypted on read.
func NewHTTPNajizCourtAdapter(cfg HTTPNajizCourtAdapterConfig) *HTTPNajizCourtAdapter {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copied := *client
		copied.Timeout = timeout
		client = &copied
	}
	a := &HTTPNajizCourtAdapter{
		client: client,
		logger: cfg.Logger.With().Str("component", "lex-najiz-adapter").Logger(),
		now:    time.Now,
	}
	// Avoid the typed-nil-interface trap: only assign when the concrete pointer is
	// non-nil so resolveActive's a.endpoints == nil guard stays correct.
	if cfg.Endpoints != nil {
		a.endpoints = cfg.Endpoints
	}
	return a
}

// newNajizAdapterForTest builds an adapter around an arbitrary endpoint lister
// and (optionally) an injected clock/client. It exists so the in-package tests
// can exercise the adapter without a database. It is unexported on purpose.
func newNajizAdapterForTest(lister najizEndpointLister, client *http.Client, now func() time.Time) *HTTPNajizCourtAdapter {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	if now == nil {
		now = time.Now
	}
	return &HTTPNajizCourtAdapter{
		endpoints: lister,
		client:    client,
		logger:    zerolog.Nop(),
		now:       now,
	}
}

// AddRepresentative resolves the active Najiz endpoint and POSTs the
// add-representative payload. Returns ErrNajizNotConfigured when no active
// endpoint is registered (graceful manual fallback for the caller).
func (a *HTTPNajizCourtAdapter) AddRepresentative(ctx context.Context, tenantID uuid.UUID, req NajizRepresentativeRequest) (*NajizRepresentativeResult, error) {
	endpoint, err := a.resolveActive(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	cfg := parseNajizEndpointConfig(endpoint.Config)
	if cfg.BaseURL == "" {
		// Endpoint is active but mis-configured: treat as not-configured so the
		// service keeps the manual path rather than hard-failing the operator's
		// representative entry.
		a.logger.Warn().
			Str("endpoint_id", endpoint.ID.String()).
			Str("endpoint_code", endpoint.Code).
			Msg("active Najiz endpoint has no base_url; falling back to manual entry")
		return nil, ErrNajizNotConfigured
	}
	// WRITE GATE: representative registration is bi-directional and is OFF by
	// default. Until a tenant has MoJ Takamul write-scope onboarding and opts in
	// via allow_writes=true, the company-representative stays manual-entry. This
	// is the honest "no faked write to Najiz" posture.
	if !cfg.AllowWrites {
		return nil, ErrNajizWritesDisabled
	}

	if strings.TrimSpace(req.CompanyRepresentative) == "" {
		return nil, validationError("company_representative is required", map[string]string{"company_representative": "required"})
	}

	now := a.now().UTC()
	payload := najizAddRepresentativeRequest{
		TenantID:              tenantID.String(),
		CaseID:                req.CaseID.String(),
		DefendantCaseID:       req.DefendantCaseID.String(),
		CompanyRepresentative: strings.TrimSpace(req.CompanyRepresentative),
		NationalID:            strings.TrimSpace(req.NationalID),
		CourtName:             strings.TrimSpace(req.CourtName),
		PlaintiffName:         strings.TrimSpace(req.PlaintiffName),
		NajizReference:        strings.TrimSpace(req.NajizReference),
		RequestedAt:           now,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, internalError("marshal najiz add-representative request", err)
	}

	// Idempotency: a stable key derived from the immutable identity of the write
	// (tenant + defendant case + representative). A retry — at this layer or by
	// the operator — carries the SAME key so the portal (or sandbox) can dedup
	// and never double-register the representative.
	idempotencyKey := najizIdempotencyKey(tenantID, req)

	url := najizJoinPath(cfg.BaseURL, cfg.AddRepresentativePath)
	respBody, err := a.dispatch(ctx, http.MethodPost, url, body, cfg, tenantID, idempotencyKey, "add-representative")
	if err != nil {
		return nil, err
	}

	var providerResp najizAddRepresentativeResponse
	if len(bytes.TrimSpace(respBody)) > 0 {
		if err := json.Unmarshal(respBody, &providerResp); err != nil {
			return nil, internalError("decode najiz response", err)
		}
	}

	status := model.NajizSyncStatus(strings.ToLower(strings.TrimSpace(providerResp.Status)))
	if !status.Valid() {
		// A 2xx with no/invalid status field still means the portal accepted it.
		status = model.NajizSyncStatusSynced
	}
	reference := strings.TrimSpace(providerResp.Reference)
	if reference == "" {
		reference = strings.TrimSpace(req.NajizReference)
	}
	detail := strings.TrimSpace(providerResp.Detail)
	if detail == "" {
		detail = "registered on Najiz portal"
	}

	return &NajizRepresentativeResult{
		Status:       status,
		Reference:    reference,
		EndpointID:   endpoint.ID,
		EndpointCode: endpoint.Code,
		Detail:       detail,
		Metadata: mergeMetadata(providerResp.Metadata, map[string]any{
			"najiz_adapter":         "http",
			"najiz_endpoint_id":     endpoint.ID.String(),
			"najiz_endpoint_code":   endpoint.Code,
			"najiz_dispatched_at":   now.Format(time.RFC3339Nano),
			"najiz_idempotency_key": idempotencyKey,
			"najiz_sandbox":         cfg.Sandbox,
		}),
	}, nil
}

// SyncCase performs the READ-first pull of case/hearing/representative state.
// This is the primary, always-allowed direction (a read-only endpoint serves
// it). When the endpoint is configured for sandbox mode it returns a clearly
// marked mock payload so demos/UAT pass without a live MoJ connection.
func (a *HTTPNajizCourtAdapter) SyncCase(ctx context.Context, tenantID uuid.UUID, req NajizCaseSyncRequest) (*NajizCaseSyncResult, error) {
	endpoint, err := a.resolveActive(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	cfg := parseNajizEndpointConfig(endpoint.Config)
	if cfg.BaseURL == "" && !cfg.Sandbox {
		a.logger.Warn().
			Str("endpoint_id", endpoint.ID.String()).
			Str("endpoint_code", endpoint.Code).
			Msg("active Najiz endpoint has no base_url; falling back to manual entry")
		return nil, ErrNajizNotConfigured
	}

	// Sandbox/mock transport: faithful shaped response, never a live MoJ call.
	if cfg.Sandbox {
		result := najizSandboxSync(req)
		result.EndpointID = endpoint.ID
		result.EndpointCode = endpoint.Code
		return result, nil
	}

	url := najizJoinPath(cfg.BaseURL, cfg.CaseSyncPath)
	if ref := strings.TrimSpace(req.NajizReference); ref != "" {
		// Scope to a single portal case. Reference is appended as a path-safe
		// query param so the read is idempotent and cacheable.
		url = url + "?reference=" + neturlQueryEscape(ref)
	}
	// Reads are idempotent by nature; no idempotency key needed, but we still
	// retry transient failures.
	respBody, err := a.dispatch(ctx, http.MethodGet, url, nil, cfg, tenantID, "", "case-sync")
	if err != nil {
		return nil, err
	}

	var providerResp najizCaseSyncResponse
	if len(bytes.TrimSpace(respBody)) > 0 {
		if err := json.Unmarshal(respBody, &providerResp); err != nil {
			return nil, internalError("decode najiz case-sync response", err)
		}
	}

	result := providerResp.normalize()
	result.EndpointID = endpoint.ID
	result.EndpointCode = endpoint.Code
	result.Sandbox = false
	if result.Reference == "" {
		result.Reference = strings.TrimSpace(req.NajizReference)
	}
	return result, nil
}

// Health returns an honest verdict for the tenant's Najiz wiring. It NEVER opens
// a live MoJ connection or fabricates success — it reports the registry/config
// state so a readiness probe can tell apart "not configured", "read-only", and
// "read+write enabled" (the last only when a tenant has opted in).
func (a *HTTPNajizCourtAdapter) Health(ctx context.Context, tenantID uuid.UUID) NajizHealth {
	now := a.now().UTC()
	endpoint, err := a.resolveActive(ctx, tenantID)
	if err != nil {
		return NajizHealth{
			Configured: false,
			Verdict:    "not_configured",
			Detail:     "no active Najiz endpoint; company-representative is manual-entry until MoJ Takamul onboarding",
			CheckedAt:  now,
		}
	}
	cfg := parseNajizEndpointConfig(endpoint.Config)
	if cfg.BaseURL == "" && !cfg.Sandbox {
		return NajizHealth{
			Configured:   false,
			Verdict:      "planned",
			Detail:       "endpoint registered but no base_url; awaiting MoJ Takamul/Etimad credentials",
			EndpointCode: endpoint.Code,
			CheckedAt:    now,
		}
	}
	verdict := "read_only"
	detail := "read-first sync enabled; representative writes gated (allow_writes=false) pending MoJ Takamul write-scope"
	if cfg.AllowWrites {
		verdict = "read_write"
		detail = "read-first sync + representative writes enabled"
	}
	return NajizHealth{
		Configured:    true,
		WritesAllowed: cfg.AllowWrites,
		Sandbox:       cfg.Sandbox,
		Verdict:       verdict,
		Detail:        detail,
		EndpointCode:  endpoint.Code,
		CheckedAt:     now,
	}
}

// resolveActive returns the single active Najiz endpoint for the tenant, or
// ErrNajizNotConfigured. When multiple active endpoints exist (operator error)
// the first by (kind, code) order wins — the repository's List is already so
// ordered. Planned/disabled/error endpoints are ignored so the manual fallback
// stays in effect until an operator activates one.
func (a *HTTPNajizCourtAdapter) resolveActive(ctx context.Context, tenantID uuid.UUID) (*model.IntegrationEndpoint, error) {
	if a.endpoints == nil {
		return nil, ErrNajizNotConfigured
	}
	rows, err := a.endpoints.List(ctx, tenantID, string(model.IntegrationKindNajiz), string(model.IntegrationStatusActive))
	if err != nil {
		return nil, internalError("resolve najiz integration endpoint", err)
	}
	if len(rows) == 0 {
		return nil, ErrNajizNotConfigured
	}
	endpoint := rows[0]
	return &endpoint, nil
}

// najizEndpointConfig extracts the connection settings from the decrypted Config
// map. Keys are intentionally tolerant (base_url / url, api_key / token) so the
// operator-registered endpoint shape from CAP-174 seeding works without a strict
// schema migration.
type najizEndpointConfig struct {
	BaseURL               string
	AddRepresentativePath string
	CaseSyncPath          string
	APIKey                string
	OrgID                 string
	// AllowWrites gates the bi-directional add-representative call. Default false
	// (read-only) — honest posture until MoJ Takamul write-scope onboarding.
	AllowWrites bool
	// Sandbox routes reads through the bundled mock transport so demos/UAT pass
	// without any live MoJ connection. It NEVER applies to live writes.
	Sandbox bool
}

func parseNajizEndpointConfig(config map[string]any) najizEndpointConfig {
	cfg := najizEndpointConfig{
		BaseURL:               firstConfigString(config, "base_url", "url", "endpoint"),
		AddRepresentativePath: firstConfigString(config, "add_representative_path", "representative_path", "path"),
		CaseSyncPath:          firstConfigString(config, "case_sync_path", "sync_path", "cases_path"),
		APIKey:                firstConfigString(config, "api_key", "token", "secret"),
		OrgID:                 firstConfigString(config, "org_id", "organization_id", "entity_id"),
		AllowWrites:           configBool(config, "allow_writes", "writes_enabled", "bidirectional"),
		Sandbox:               configBool(config, "sandbox", "mock", "uat"),
	}
	if cfg.AddRepresentativePath == "" {
		cfg.AddRepresentativePath = "/representatives"
	}
	if cfg.CaseSyncPath == "" {
		cfg.CaseSyncPath = "/cases"
	}
	return cfg
}

// configBool reads a boolean-ish config flag, tolerating bool, "true"/"1"/"yes"
// strings, and numeric truthiness (operator-registered config is loosely typed).
func configBool(config map[string]any, keys ...string) bool {
	for _, k := range keys {
		v, ok := config[k]
		if !ok {
			continue
		}
		switch t := v.(type) {
		case bool:
			return t
		case string:
			switch strings.ToLower(strings.TrimSpace(t)) {
			case "true", "1", "yes", "on", "enabled":
				return true
			}
		case float64:
			return t != 0
		case int:
			return t != 0
		}
	}
	return false
}

func firstConfigString(config map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func najizJoinPath(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	path = strings.TrimSpace(path)
	if path == "" {
		return base
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

// dispatch performs a single Najiz HTTP call with context timeout, transient
// retry+backoff, and provider-internal-leak-free error mapping. body is nil for
// reads. idempotencyKey, when non-empty, is sent so a retried write dedups.
// op labels the call for logs. It returns the (limited) response body on 2xx.
func (a *HTTPNajizCourtAdapter) dispatch(ctx context.Context, method, url string, body []byte, cfg najizEndpointConfig, tenantID uuid.UUID, idempotencyKey, op string) ([]byte, error) {
	var lastErr error
	backoff := najizBaseBackoff

	for attempt := 0; attempt <= najizMaxRetries; attempt++ {
		if attempt > 0 {
			// Honor context cancellation while waiting between attempts.
			timer := time.NewTimer(backoff)
			select {
			case <-ctx.Done():
				timer.Stop()
				return nil, internalError("najiz "+op+" cancelled during backoff", ctx.Err())
			case <-timer.C:
			}
			if backoff *= 2; backoff > najizMaxBackoff {
				backoff = najizMaxBackoff
			}
		}

		var reader io.Reader
		if body != nil {
			reader = bytes.NewReader(body)
		}
		httpReq, err := http.NewRequestWithContext(ctx, method, url, reader)
		if err != nil {
			return nil, validationError("najiz endpoint url is invalid", map[string]string{"base_url": "invalid"})
		}
		if body != nil {
			httpReq.Header.Set("Content-Type", "application/json")
		}
		httpReq.Header.Set("Accept", "application/json")
		if cfg.APIKey != "" {
			httpReq.Header.Set("Authorization", "Bearer "+cfg.APIKey)
		}
		if cfg.OrgID != "" {
			httpReq.Header.Set("X-Najiz-Org-ID", cfg.OrgID)
		}
		if idempotencyKey != "" {
			httpReq.Header.Set("Idempotency-Key", idempotencyKey)
			httpReq.Header.Set("X-Idempotency-Key", idempotencyKey)
		}
		httpReq.Header.Set("X-Clario360-Tenant-ID", tenantID.String())

		resp, err := a.client.Do(httpReq)
		if err != nil {
			// Transport error: retry unless the context is done.
			lastErr = err
			if ctx.Err() != nil {
				return nil, internalError("najiz "+op+" timed out", ctx.Err())
			}
			a.logger.Warn().Err(err).Str("op", op).Int("attempt", attempt).Msg("najiz transport error; will retry if attempts remain")
			continue
		}

		respBody, readErr := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if readErr != nil {
			lastErr = readErr
			continue
		}

		switch {
		case resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices:
			return respBody, nil
		case isNajizTransientStatus(resp.StatusCode):
			// 429 / 5xx: retry. Respect Retry-After when present.
			if ra := parseNajizRetryAfter(resp.Header.Get("Retry-After")); ra > 0 {
				backoff = ra
				if backoff > najizMaxBackoff {
					backoff = najizMaxBackoff
				}
			}
			lastErr = fmt.Errorf("status %d", resp.StatusCode)
			a.logger.Warn().Str("op", op).Int("status", resp.StatusCode).Int("attempt", attempt).Msg("najiz transient status; will retry if attempts remain")
			continue
		default:
			// Non-transient 4xx (incl. validation/auth). FAIL CLOSED and map to a
			// stable internal error WITHOUT echoing the raw provider body verbatim
			// to the caller (it may carry provider internals); we log it instead.
			a.logger.Error().Str("op", op).Int("status", resp.StatusCode).Str("provider_body", truncateNajiz(string(respBody), 512)).Msg("najiz rejected request")
			return nil, internalError("najiz portal rejected "+op, fmt.Errorf("status %d", resp.StatusCode))
		}
	}

	if lastErr == nil {
		lastErr = errors.New("exhausted retries")
	}
	return nil, internalError("najiz "+op+" failed after retries", lastErr)
}

// isNajizTransientStatus reports whether an HTTP status should be retried.
func isNajizTransientStatus(code int) bool {
	if code == http.StatusTooManyRequests {
		return true
	}
	return code >= 500 && code <= 599
}

// parseNajizRetryAfter parses a Retry-After header (delay-seconds form only;
// HTTP-date form is ignored as Najiz uses seconds). Returns 0 when absent/invalid.
func parseNajizRetryAfter(v string) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if secs, err := strconv.Atoi(v); err == nil && secs >= 0 {
		return time.Duration(secs) * time.Second
	}
	return 0
}

func truncateNajiz(s string, max int) string {
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}

// najizIdempotencyKey derives a stable, retry-safe key from the immutable
// identity of an add-representative write. The same logical write always yields
// the same key so the portal can dedup a retried registration.
func najizIdempotencyKey(tenantID uuid.UUID, req NajizRepresentativeRequest) string {
	h := sha256.Sum256([]byte(strings.Join([]string{
		tenantID.String(),
		req.DefendantCaseID.String(),
		strings.ToLower(strings.TrimSpace(req.CompanyRepresentative)),
		strings.TrimSpace(req.NationalID),
	}, "|")))
	return "najiz-rep-" + hex.EncodeToString(h[:16])
}

// neturlQueryEscape escapes a value for use in a query string without pulling in
// net/url for one call (keeps the import surface tight and avoids escaping the
// already-built base path). It percent-encodes the few characters that matter
// for a reference token.
func neturlQueryEscape(v string) string {
	var b strings.Builder
	for _, r := range v {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_', r == '.', r == '~':
			b.WriteRune(r)
		default:
			for _, by := range []byte(string(r)) {
				fmt.Fprintf(&b, "%%%02X", by)
			}
		}
	}
	return b.String()
}

// najizSandboxSync produces a faithful, clearly-marked MOCK case-sync payload so
// console "try it"/UAT/demos pass without any live MoJ connection. It mirrors the
// live response shape exactly (same normalize path) but is flagged Sandbox=true.
func najizSandboxSync(req NajizCaseSyncRequest) *NajizCaseSyncResult {
	ref := strings.TrimSpace(req.NajizReference)
	if ref == "" {
		ref = "SANDBOX-" + req.CaseID.String()[:8]
	}
	base := time.Date(2026, 7, 1, 9, 0, 0, 0, time.UTC)
	return &NajizCaseSyncResult{
		Reference:     ref,
		CourtName:     "محكمة الرياض التجارية (Sandbox)",
		PlaintiffName: "Sandbox Plaintiff Co.",
		PortalStatus:  "scheduled",
		Hearings: []NajizHearing{
			{Reference: ref + "-H1", Court: "محكمة الرياض التجارية", ScheduledAt: base, Status: "scheduled", Detail: "first session"},
			{Reference: ref + "-H2", Court: "محكمة الرياض التجارية", ScheduledAt: base.Add(14 * 24 * time.Hour), Status: "scheduled"},
		},
		Representatives: []NajizRepresentativeRecord{
			{Name: "Operator-entered representative", Role: "company_agent", Reference: ref + "-R1"},
		},
		Sandbox: true,
		Metadata: map[string]any{
			"najiz_adapter": "sandbox",
			"najiz_note":    "mock data — NOT a live MoJ Najiz reconciliation",
		},
	}
}

// najizCaseSyncResponse is the wire response from the Najiz case-sync read.
type najizCaseSyncResponse struct {
	Reference     string `json:"reference"`
	CourtName     string `json:"court_name"`
	PlaintiffName string `json:"plaintiff_name"`
	Status        string `json:"status"`
	Hearings      []struct {
		Reference   string `json:"reference"`
		Court       string `json:"court"`
		ScheduledAt string `json:"scheduled_at"`
		Status      string `json:"status"`
		Detail      string `json:"detail"`
	} `json:"hearings"`
	Representatives []struct {
		Name       string `json:"name"`
		NationalID string `json:"national_id"`
		Role       string `json:"role"`
		Reference  string `json:"reference"`
	} `json:"representatives"`
	Metadata map[string]any `json:"metadata"`
}

func (r najizCaseSyncResponse) normalize() *NajizCaseSyncResult {
	out := &NajizCaseSyncResult{
		Reference:       strings.TrimSpace(r.Reference),
		CourtName:       strings.TrimSpace(r.CourtName),
		PlaintiffName:   strings.TrimSpace(r.PlaintiffName),
		PortalStatus:    strings.TrimSpace(r.Status),
		Hearings:        make([]NajizHearing, 0, len(r.Hearings)),
		Representatives: make([]NajizRepresentativeRecord, 0, len(r.Representatives)),
		Metadata:        r.Metadata,
	}
	for _, h := range r.Hearings {
		var sched time.Time
		if ts := strings.TrimSpace(h.ScheduledAt); ts != "" {
			if t, err := time.Parse(time.RFC3339, ts); err == nil {
				sched = t.UTC()
			}
		}
		out.Hearings = append(out.Hearings, NajizHearing{
			Reference:   strings.TrimSpace(h.Reference),
			Court:       strings.TrimSpace(h.Court),
			ScheduledAt: sched,
			Status:      strings.TrimSpace(h.Status),
			Detail:      strings.TrimSpace(h.Detail),
		})
	}
	for _, rep := range r.Representatives {
		out.Representatives = append(out.Representatives, NajizRepresentativeRecord{
			Name:       strings.TrimSpace(rep.Name),
			NationalID: strings.TrimSpace(rep.NationalID),
			Role:       strings.TrimSpace(rep.Role),
			Reference:  strings.TrimSpace(rep.Reference),
		})
	}
	return out
}

// najizAddRepresentativeRequest is the wire request to the Najiz endpoint.
type najizAddRepresentativeRequest struct {
	TenantID              string    `json:"tenant_id"`
	CaseID                string    `json:"case_id"`
	DefendantCaseID       string    `json:"defendant_case_id"`
	CompanyRepresentative string    `json:"company_representative"`
	NationalID            string    `json:"national_id,omitempty"`
	CourtName             string    `json:"court_name,omitempty"`
	PlaintiffName         string    `json:"plaintiff_name,omitempty"`
	NajizReference        string    `json:"najiz_reference,omitempty"`
	RequestedAt           time.Time `json:"requested_at"`
}

// najizAddRepresentativeResponse is the wire response from the Najiz endpoint.
type najizAddRepresentativeResponse struct {
	Status    string         `json:"status"`
	Reference string         `json:"reference"`
	Detail    string         `json:"detail"`
	Metadata  map[string]any `json:"metadata"`
}

// Compile-time assertion that the HTTP adapter satisfies the port.
var _ NajizCourtPort = (*HTTPNajizCourtAdapter)(nil)
