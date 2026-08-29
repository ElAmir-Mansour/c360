package action

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
)

// HTTP auth modes for the generic http_call action.
const (
	httpAuthNone   = "none"
	httpAuthBearer = "bearer"  // static bearer token from config
	httpAuthBasic  = "basic"   // basic user:pass from config
	httpAuthAPIKey = "api_key" // an API key placed in a named header
	httpAuthSystem = "system"  // per-tenant Clario system token (minted)
)

// validHTTPAuthModes is the closed set of supported auth modes.
var validHTTPAuthModes = map[string]bool{
	httpAuthNone:   true,
	httpAuthBearer: true,
	httpAuthBasic:  true,
	httpAuthAPIKey: true,
	httpAuthSystem: true,
}

// HTTPCallExecutor implements the http_call action (§4.6): a generic HTTP call to
// any service behind the gateway (or any reachable URL), with configurable
// method, headers, body, auth mode, an optional per-tenant Clario system token,
// and bounded retry/backoff on transient failures (5xx / 429 / network). It is a
// superset of the integration webhook client's behaviour, reusing that retry +
// signing style (webhook.BackoffForAttempt).
//
// Config (ActionRef.Config):
//
//	url          (string, required)   the absolute request URL
//	method       (string, optional)   HTTP method; defaults to POST
//	headers      (object<string>,opt) extra request headers
//	body         (any, optional)      JSON request body (objects/arrays/scalars)
//	auth         (string, optional)   none|bearer|basic|api_key|system (default none)
//	token        (string, bearer)     static bearer token when auth=bearer
//	username     (string, basic)      basic-auth username when auth=basic
//	password     (string, basic)      basic-auth password when auth=basic
//	api_key      (string, api_key)    the API key value when auth=api_key
//	api_key_header(string, api_key)   header to carry the key (default X-API-Key)
//	send_tenant_header (bool, opt)     send X-Tenant-ID (default true for auth=system)
//	max_attempts (number, optional)   bounded retry cap (default 3, min 1, max 6)
type HTTPCallExecutor struct {
	client *http.Client
	minter TokenMinter // optional; only needed for auth=system
	// backoff returns the wait before the Nth (1-based) retry. Injectable so
	// tests don't sleep real seconds; defaults to webhook-style backoff.
	backoff func(attempt int) time.Duration
}

// NewHTTPCallExecutor constructs the executor. client may be nil (a default is
// used). minter may be nil if no http_call ever uses auth=system.
func NewHTTPCallExecutor(client *http.Client, minter TokenMinter) *HTTPCallExecutor {
	if client == nil {
		client = defaultHTTPClient()
	}
	return &HTTPCallExecutor{client: client, minter: minter, backoff: defaultBackoff}
}

// defaultBackoff mirrors the integration webhook client's bounded backoff
// (webhook.BackoffForAttempt) so http_call retries behave the same way.
func defaultBackoff(attempt int) time.Duration {
	switch attempt {
	case 1:
		return time.Second
	case 2:
		return 5 * time.Second
	default:
		return 25 * time.Second
	}
}

// Execute performs the configured HTTP call with bounded retry and records the
// final response (status + truncated body) in the run log.
func (e *HTTPCallExecutor) Execute(ctx context.Context, step *model.RunStep) (service.Output, error) {
	cfg, err := stepConfig(step, model.ActionHTTPCall)
	if err != nil {
		return service.Output{}, err
	}
	url, err := cfgString(cfg, "url")
	if err != nil {
		return service.Output{}, err
	}
	method, err := cfgStringOpt(cfg, "method", http.MethodPost)
	if err != nil {
		return service.Output{}, err
	}
	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = http.MethodPost
	}
	headers, err := cfgStringMap(cfg, "headers")
	if err != nil {
		return service.Output{}, err
	}
	authMode, err := cfgStringOpt(cfg, "auth", httpAuthNone)
	if err != nil {
		return service.Output{}, err
	}
	authMode = strings.ToLower(strings.TrimSpace(authMode))
	if authMode == "" {
		authMode = httpAuthNone
	}
	if !validHTTPAuthModes[authMode] {
		return service.Output{}, invalidConfig("auth %q must be one of none|bearer|basic|api_key|system", authMode)
	}

	var bodyBytes []byte
	if raw, ok := cfg["body"]; ok && raw != nil {
		bodyBytes, err = json.Marshal(raw)
		if err != nil {
			return service.Output{}, invalidConfig("body is not JSON-serialisable: %v", err)
		}
	}

	maxAttempts := 3
	if v, ok := cfg["max_attempts"]; ok && v != nil {
		n, ok := toInt(v)
		if !ok {
			return service.Output{}, invalidConfig("max_attempts must be a number, got %T", v)
		}
		maxAttempts = n
	}
	if maxAttempts < 1 {
		maxAttempts = 1
	}
	if maxAttempts > 6 {
		maxAttempts = 6
	}

	// Resolve auth headers once (a minted token / static credential is stable
	// across retries of the same call).
	authHeaders, err := e.authHeaders(ctx, cfg, authMode)
	if err != nil {
		return service.Output{}, err
	}

	var (
		lastStatus int
		lastBody   string
		lastErr    error
	)
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if attempt > 1 {
			// Honour context cancellation while backing off.
			select {
			case <-ctx.Done():
				return service.Output{}, unavailable(ctx.Err(), "http_call aborted during backoff before attempt %d", attempt)
			case <-time.After(e.backoff(attempt - 1)):
			}
		}

		status, respBody, doErr := e.doOnce(ctx, method, url, bodyBytes, headers, authHeaders)
		lastStatus, lastBody, lastErr = status, respBody, doErr

		switch {
		case doErr != nil:
			// Transport error (network/timeout) — retry if attempts remain.
			if attempt < maxAttempts {
				continue
			}
			return service.Output{}, unavailable(doErr, "%s %s after %d attempt(s)", method, url, attempt)
		case status >= 200 && status < 300:
			return service.Output{Data: map[string]any{
				"action":        model.ActionHTTPCall,
				"method":        method,
				"url":           url,
				"status_code":   status,
				"response_body": truncate(respBody, 4096),
				"attempts":      attempt,
			}}, nil
		case statusIsRetryable(status):
			if attempt < maxAttempts {
				continue
			}
			return service.Output{}, unavailable(nil, "%s %s returned %d after %d attempt(s): %s", method, url, status, attempt, truncate(respBody, 512))
		default:
			// Permanent client error (4xx other than 429): do not retry.
			return service.Output{}, fmt.Errorf("http_call: %s %s returned %d: %s", method, url, status, truncate(respBody, 512))
		}
	}

	// Unreachable in practice (the loop always returns), but keep a definite
	// terminal error rather than a zero value.
	if lastErr != nil {
		return service.Output{}, unavailable(lastErr, "%s %s exhausted retries", method, url)
	}
	return service.Output{}, unavailable(nil, "%s %s exhausted retries (last status %d): %s", method, url, lastStatus, truncate(lastBody, 512))
}

// doOnce performs a single HTTP attempt and returns the status, body, and any
// transport error.
func (e *HTTPCallExecutor) doOnce(ctx context.Context, method, url string, body []byte, headers, authHeaders map[string]string) (int, string, error) {
	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		// A malformed method/URL is permanent, not a transport blip; surface as-is.
		return 0, "", fmt.Errorf("build request: %w", err)
	}
	if len(body) > 0 && req.Header.Get("Content-Type") == "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	for k, v := range authHeaders {
		req.Header.Set(k, v)
	}

	resp, err := e.client.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	return resp.StatusCode, string(respBody), nil
}

// authHeaders resolves the request auth headers for the configured mode. For
// auth=system it mints the per-tenant Clario token and adds X-Tenant-ID.
func (e *HTTPCallExecutor) authHeaders(ctx context.Context, cfg map[string]any, mode string) (map[string]string, error) {
	out := map[string]string{}
	switch mode {
	case httpAuthNone:
		return out, nil
	case httpAuthBearer:
		token, err := cfgString(cfg, "token")
		if err != nil {
			return nil, err
		}
		out["Authorization"] = "Bearer " + token
		return out, nil
	case httpAuthBasic:
		user, err := cfgString(cfg, "username")
		if err != nil {
			return nil, err
		}
		pass, err := cfgStringOpt(cfg, "password", "")
		if err != nil {
			return nil, err
		}
		creds := base64.StdEncoding.EncodeToString([]byte(user + ":" + pass))
		out["Authorization"] = "Basic " + creds
		return out, nil
	case httpAuthAPIKey:
		key, err := cfgString(cfg, "api_key")
		if err != nil {
			return nil, err
		}
		header, err := cfgStringOpt(cfg, "api_key_header", "X-API-Key")
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(header) == "" {
			header = "X-API-Key"
		}
		out[header] = key
		return out, nil
	case httpAuthSystem:
		if e.minter == nil {
			return nil, invalidConfig("auth=system requires a token minter, none configured")
		}
		tenantID, err := tenantFromContext(ctx)
		if err != nil {
			return nil, err
		}
		token, err := e.minter.MintSystemToken(tenantID)
		if err != nil {
			return nil, unavailable(err, "minting system token for tenant %s", tenantID)
		}
		out["Authorization"] = "Bearer " + token
		sendTenant, err := cfgBool(cfg, "send_tenant_header", true)
		if err != nil {
			return nil, err
		}
		if sendTenant {
			out["X-Tenant-ID"] = tenantID
		}
		return out, nil
	default:
		return nil, invalidConfig("unsupported auth mode %q", mode)
	}
}

// toInt coerces a JSON-decoded numeric (float64) or int to int.
func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	default:
		return 0, false
	}
}

// truncate caps a string for safe recording in the run log.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}
