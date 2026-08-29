package handler

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/clario360/platform/internal/notification/channel"
)

type webhookTestResult struct {
	Success        bool   `json:"success"`
	ResponseStatus int    `json:"response_status"`
	ResponseBody   string `json:"response_body"`
}

// testResponseSnippetMax bounds how much of the target's response body is echoed
// back to the caller. The webhook test endpoint is authenticated, so an
// unbounded echo turns it into an SSRF exfiltration oracle; combined with the
// internal-IP blocking in ValidateWebhookURL / safeDialControl, this heavy bound
// (and control-char scrubbing) leaves only a minimal, sanitized snippet for
// legitimate debugging.
const testResponseSnippetMax = 512

// deliverWebhookTest sends a one-off test POST to a user-registered webhook URL.
//
// SSRF hardening (Wave B #4): the URL is validated with the same DNS-aware
// validator as the delivery channel, the request uses an SSRF-safe client that
// refuses redirects and re-validates the dialed IP at connect time, HTTPS is
// enforced outside development, and the returned body is bounded + sanitized so
// the endpoint cannot be used to read arbitrary internal responses.
func deliverWebhookTest(ctx context.Context, url string, payload []byte, secret *string, headers map[string]string, environment string) webhookTestResult {
	if err := channel.ValidateWebhookURL(ctx, url, environment); err != nil {
		return webhookTestResult{Success: false, ResponseBody: "invalid webhook URL: " + err.Error()}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return webhookTestResult{Success: false, ResponseBody: "failed to create request: " + err.Error()}
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Clario360-Webhook/1.0")

	// Set custom headers
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	// Sign payload with HMAC-SHA256 if secret is available
	if secret != nil && *secret != "" {
		mac := hmac.New(sha256.New, []byte(*secret))
		mac.Write(payload)
		sig := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-Webhook-Signature", "sha256="+sig)
	}

	client := channel.NewSafeWebhookClient(15 * time.Second)
	resp, err := client.Do(req)
	if err != nil {
		return webhookTestResult{Success: false, ResponseBody: "request failed: " + err.Error()}
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, testResponseSnippetMax))
	return webhookTestResult{
		Success:        resp.StatusCode >= 200 && resp.StatusCode < 300,
		ResponseStatus: resp.StatusCode,
		ResponseBody:   sanitizeSnippet(raw),
	}
}

// sanitizeSnippet strips control characters (keeping printable + spaces) from a
// bounded response body so the echoed snippet cannot smuggle terminal escapes or
// binary content back to the caller.
func sanitizeSnippet(b []byte) string {
	s := string(b)
	return strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' || r == ' ' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, s)
}
