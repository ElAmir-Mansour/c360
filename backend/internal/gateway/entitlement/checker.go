// Package entitlement resolves whether a tenant is licensed for a feature, so
// the gateway can gate suite routes by plan (Solution Architecture E2E,
// slide 13 "entitlement check"; slide 18 "Enforcement API — gateway & apps
// query"). Decisions come from the licensing service and are cached in Redis
// for a short window to keep per-request overhead negligible.
package entitlement

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Decision is the gateway-relevant slice of a licensing decision: may this
// tenant use this entitlement key, and if not, why. Cached reports whether the
// decision was served from the gateway's cache rather than resolved upstream
// (used only for metrics).
type Decision struct {
	Allowed bool
	Reason  string
	Cached  bool
}

// Checker resolves an entitlement decision for a tenant. authorization is the
// caller's "Bearer <token>" header, forwarded so the licensing service derives
// the tenant from the same validated token — no second trust domain.
type Checker interface {
	Check(ctx context.Context, tenantID, authorization, key string) (Decision, error)
}

// HTTPChecker calls the licensing service's enforcement API.
type HTTPChecker struct {
	baseURL string
	client  *http.Client
}

// NewHTTPChecker targets the licensing service at baseURL (e.g.
// http://license-service:8096). timeout bounds each call.
func NewHTTPChecker(baseURL string, timeout time.Duration) *HTTPChecker {
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	return &HTTPChecker{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  &http.Client{Timeout: timeout},
	}
}

// checkResponse mirrors suiteapi.WriteData's envelope for the /check route.
type checkResponse struct {
	Data struct {
		Allowed bool   `json:"allowed"`
		Reason  string `json:"reason"`
	} `json:"data"`
}

// Check queries GET /api/v1/licensing/check?key=... forwarding the bearer
// token. A transport or non-2xx response is an error so the caller can decide
// fail-open vs fail-closed; only a well-formed body yields a Decision.
func (c *HTTPChecker) Check(ctx context.Context, tenantID, authorization, key string) (Decision, error) {
	endpoint := fmt.Sprintf("%s/api/v1/licensing/check?key=%s", c.baseURL, url.QueryEscape(key))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Decision{}, fmt.Errorf("building entitlement request: %w", err)
	}
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return Decision{}, fmt.Errorf("calling licensing service: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		return Decision{}, fmt.Errorf("licensing service returned status %d", resp.StatusCode)
	}

	var body checkResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Decision{}, fmt.Errorf("decoding entitlement response: %w", err)
	}
	return Decision{Allowed: body.Data.Allowed, Reason: body.Data.Reason}, nil
}
