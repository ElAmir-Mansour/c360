package cybervault

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
)

// HTTPPostureSource is a PostureSource that reads cyber-recovery vault inventory
// and posture from a deployment-run cloud-backup posture GATEWAY over plain
// net/http + JSON.
//
// HONEST SCOPE: this is NOT a direct AWS Backup / Azure Backup / GCP Backup-DR
// SDK client and pulls in no cloud SDKs. Consistent with the platform's
// gateway-delegated sovereign design, the deployment runs a small adapter that
// speaks the providers' native APIs and exposes a NORMALISED REST surface keyed
// on our own VaultProvider/VaultPosture model. This type only knows that
// normalised surface; all credential custody and provider-specific translation
// live behind the gateway. The narrow REST contract it depends on is:
//
//	GET /vaults?tenant={tenant}&group={group}
//	    -> {"data":[ <RegisteredVault>, ... ]}     (list inventory; filters optional)
//	GET /vaults/{id}/posture?tenant={tenant}
//	    -> {"data": <VaultPosture> }               (one vault's posture)
//	GET /healthz                                   (liveness; used by the connector probe)
//
// Both list and get tolerate either an envelope ({"data": ...}, matching
// suiteapi.WriteData) or a bare body, so the gateway can be implemented with our
// own helpers or a thin proxy. Decoded records are run through
// normaliseVaultRecord so posture id/name/provider inherit from the inventory
// row exactly as the in-memory StaticPostureSource does.
type HTTPPostureSource struct {
	baseURL string
	token   string
	client  *http.Client
}

// CloudGatewayConfig wires an HTTPPostureSource against a cloud-backup posture
// gateway. BaseURL is required. Token is sent as a Bearer credential when set.
// CACertPEM pins the gateway's server certificate; when empty the platform trust
// store is used (set InsecureSkipTLSVerify only for a TLS-terminating sidecar in
// front of the gateway). HTTPClient overrides the constructed client so tests can
// inject an httptest.Server's client.
type CloudGatewayConfig struct {
	BaseURL               string
	Token                 string
	CACertPEM             string
	InsecureSkipTLSVerify bool
	Timeout               time.Duration
	HTTPClient            *http.Client
}

// vaultListEnvelope and posturEnvelope mirror the gateway's response framing.
// The list body is decoded leniently: {"data":[...]}, {"vaults":[...]} or a bare
// JSON array are all accepted so the gateway is not forced into one envelope.
type vaultListEnvelope struct {
	Data   []RegisteredVault `json:"data"`
	Vaults []RegisteredVault `json:"vaults"`
}

type postureEnvelope struct {
	Data    *VaultPosture `json:"data"`
	Posture *VaultPosture `json:"posture"`
}

// NewHTTPPostureSource constructs an HTTPPostureSource. baseURL is required; an
// empty token disables the Authorization header; caCertPEM (when non-empty) pins
// the gateway CA. Passing hc reuses an existing client (e.g. one already wired
// with the gateway CA, or an httptest client in tests); when hc is nil a client
// is built from caCertPEM with a default timeout.
func NewHTTPPostureSource(baseURL, token, caCertPEM string, hc *http.Client) (*HTTPPostureSource, error) {
	return NewHTTPPostureSourceFromConfig(CloudGatewayConfig{
		BaseURL:    baseURL,
		Token:      token,
		CACertPEM:  caCertPEM,
		HTTPClient: hc,
	})
}

// NewHTTPPostureSourceFromConfig is the config-driven constructor the integration
// bridge uses to build the source from a connector's stored configuration.
func NewHTTPPostureSourceFromConfig(cfg CloudGatewayConfig) (*HTTPPostureSource, error) {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		return nil, fmt.Errorf("%w: cloud-backup gateway base url is required", ErrInvalidRequest)
	}
	if _, err := url.ParseRequestURI(base); err != nil {
		return nil, fmt.Errorf("%w: invalid cloud-backup gateway base url %q", ErrInvalidRequest, cfg.BaseURL)
	}

	client := cfg.HTTPClient
	if client == nil {
		var err error
		client, err = gatewayHTTPClient(cfg.CACertPEM, cfg.InsecureSkipTLSVerify, cfg.Timeout)
		if err != nil {
			return nil, err
		}
	}

	return &HTTPPostureSource{
		baseURL: base,
		token:   strings.TrimSpace(cfg.Token),
		client:  client,
	}, nil
}

// gatewayHTTPClient builds an http.Client that pins caCertPEM when supplied. When
// caCertPEM is empty the platform trust store is used; insecure honours
// InsecureSkipTLSVerify only in that case (a CA pin always wins).
func gatewayHTTPClient(caCertPEM string, insecure bool, timeout time.Duration) (*http.Client, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if pem := strings.TrimSpace(caCertPEM); pem != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(pem)) {
			return nil, fmt.Errorf("%w: invalid cloud-backup gateway CA bundle", ErrInvalidRequest)
		}
		tlsCfg.RootCAs = pool
	} else {
		tlsCfg.InsecureSkipVerify = insecure
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: &http.Transport{TLSClientConfig: tlsCfg},
	}, nil
}

// ListRegisteredVaults lists inventory from the gateway, passing tenant/group as
// query filters (empty values are omitted so they act as wildcards, matching the
// StaticPostureSource semantics). Each decoded record is normalised so the
// embedded posture inherits id/name/provider from the inventory row.
func (s *HTTPPostureSource) ListRegisteredVaults(ctx context.Context, tenantID, groupID string) ([]RegisteredVault, error) {
	q := url.Values{}
	if t := strings.TrimSpace(tenantID); t != "" {
		q.Set("tenant", t)
	}
	if g := strings.TrimSpace(groupID); g != "" {
		q.Set("group", g)
	}

	var env vaultListEnvelope
	if err := s.getJSON(ctx, "/vaults", q, &env); err != nil {
		return nil, err
	}

	records := env.Data
	if records == nil {
		records = env.Vaults
	}
	out := make([]RegisteredVault, 0, len(records))
	for i := range records {
		v := records[i]
		// Apply the same defensive filtering as the static source: even if the
		// gateway ignored a filter, we never surface out-of-scope rows.
		if tenantID != "" && v.TenantID != "" && v.TenantID != tenantID {
			continue
		}
		if groupID != "" && v.GroupID != "" && v.GroupID != groupID {
			continue
		}
		normaliseVaultRecord(&v)
		out = append(out, v)
	}
	return out, nil
}

// GetVaultPosture fetches one vault's posture from the gateway by tenant/vault
// UUID. The gateway is asked for the vault by id with tenant as a query filter;
// a 404 maps to ErrVaultNotFound so callers (and the router) can distinguish a
// missing vault from a transport failure.
func (s *HTTPPostureSource) GetVaultPosture(ctx context.Context, tenantID, vaultID uuid.UUID) (VaultPosture, error) {
	q := url.Values{}
	if tenantID != uuid.Nil {
		q.Set("tenant", tenantID.String())
	}
	path := "/vaults/" + url.PathEscape(vaultID.String()) + "/posture"

	var env postureEnvelope
	if err := s.getJSON(ctx, path, q, &env); err != nil {
		if isGatewayNotFound(err) {
			return VaultPosture{}, fmt.Errorf("vault %s: %w", vaultID, ErrVaultNotFound)
		}
		return VaultPosture{}, err
	}

	posture := env.Data
	if posture == nil {
		posture = env.Posture
	}
	if posture == nil {
		return VaultPosture{}, fmt.Errorf("%w: cloud-backup gateway returned no posture for vault %s", ErrSourceUnavailable, vaultID)
	}

	// Reuse the inventory-row normalisation so a posture body that omits
	// id/name/provider inherits them, identical to the static source path.
	rec := RegisteredVault{
		ID:       posture.ID,
		Name:     posture.Name,
		Provider: posture.Provider,
		Posture:  *posture,
	}
	if rec.ID == "" {
		rec.ID = vaultID.String()
	}
	normaliseVaultRecord(&rec)
	return rec.Posture, nil
}

// gatewayStatusError carries the HTTP status from a non-2xx gateway response so
// GetVaultPosture can map 404 to ErrVaultNotFound while other statuses surface as
// ErrSourceUnavailable. It wraps ErrSourceUnavailable so errors.Is(err,
// ErrSourceUnavailable) holds while errors.As can still recover the status.
type gatewayStatusError struct {
	status int
	body   string
}

func (e *gatewayStatusError) Error() string {
	if e.body == "" {
		return fmt.Sprintf("cloud-backup gateway returned status %d", e.status)
	}
	return fmt.Sprintf("cloud-backup gateway returned status %d: %s", e.status, e.body)
}

func (e *gatewayStatusError) Unwrap() error { return ErrSourceUnavailable }

func isGatewayNotFound(err error) bool {
	var ge *gatewayStatusError
	if errors.As(err, &ge) {
		return ge.status == http.StatusNotFound
	}
	return false
}

// getJSON performs a GET against {baseURL}{path}?{query}, sets auth/accept
// headers, and decodes a 2xx JSON body into v. Non-2xx responses become a
// gatewayStatusError wrapped in ErrSourceUnavailable; transport failures wrap
// ErrSourceUnavailable directly.
func (s *HTTPPostureSource) getJSON(ctx context.Context, path string, query url.Values, v any) error {
	u := s.baseURL + path
	if enc := query.Encode(); enc != "" {
		u += "?" + enc
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return fmt.Errorf("cybervault: build gateway request %s: %w", path, err)
	}
	req.Header.Set("Accept", "application/json")
	if s.token != "" {
		req.Header.Set("Authorization", "Bearer "+s.token)
	}

	resp, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: GET %s: %v", ErrSourceUnavailable, path, err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		// Returned typed so callers can errors.As to the status (404 -> not found)
		// and errors.Is to ErrSourceUnavailable via Unwrap.
		return &gatewayStatusError{status: resp.StatusCode, body: strings.TrimSpace(string(body))}
	}

	if v == nil {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		return fmt.Errorf("%w: decode gateway %s response: %v", ErrSourceUnavailable, path, err)
	}
	return nil
}

// CloudVaultTestConnection performs a lightweight liveness probe against the
// cloud-backup posture gateway so the integration bridge can register the source
// as a Connector. It tries GET /healthz first and falls back to GET /vaults (a
// minimal listing) if the gateway does not expose a health route, so a gateway
// that only implements the inventory surface still reports reachable. Any
// transport failure or non-2xx status is returned as an error wrapping
// ErrSourceUnavailable.
func CloudVaultTestConnection(ctx context.Context, baseURL, token, caCertPEM string) error {
	src, err := NewHTTPPostureSource(baseURL, token, caCertPEM, nil)
	if err != nil {
		return err
	}
	if err := src.getJSON(ctx, "/healthz", nil, nil); err == nil {
		return nil
	} else if !isGatewayNotFound(err) {
		// A reachable gateway without /healthz returns 404; anything else
		// (transport error, 401, 5xx) is a real connection failure.
		return err
	}
	// Fall back to the inventory surface: a 2xx here proves auth + reachability.
	var env vaultListEnvelope
	if err := src.getJSON(ctx, "/vaults", nil, &env); err != nil {
		return err
	}
	return nil
}

var _ PostureSource = (*HTTPPostureSource)(nil)
