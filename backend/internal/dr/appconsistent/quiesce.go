package appconsistent

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

// QuiesceResult is the outcome of a Quiesce or Thaw call. Output captures the
// provider's combined stdout/stderr (or the agent response body) for the audit
// trail; BarrierToken is an opaque token the provider returns from Quiesce that
// must be echoed back to Thaw so the agent can match the freeze to its release.
type QuiesceResult struct {
	// Output is the captured combined stdout+stderr (script) or response body
	// (http) — recorded in the barrier detail for triage.
	Output string
	// BarrierToken correlates a Quiesce with its Thaw. Script providers return
	// an empty token; HTTP providers return the agent-issued token.
	BarrierToken string
	// MarkerLSN is the source-side consistency marker the stream fence must
	// drain to before the coordinator seals a recovery point. Script providers
	// may emit CLARIO_MARKER_LSN=<lsn> / marker_lsn=<lsn> in stdout; HTTP
	// providers may return {"marker_lsn":"..."}.
	MarkerLSN string
}

// QuiesceProvider freezes and thaws a protected workload so a recovery point can
// capture an application-consistent state. A successful Quiesce means all
// in-flight writes are flushed and caches are drained; Thaw releases the freeze.
//
// Contract:
//   - Quiesce returning a nil error means the workload IS frozen — the caller
//     MUST eventually call Thaw (the Coordinator does so via defer).
//   - Quiesce returning a non-nil error means the workload is NOT frozen — Thaw
//     must not be required (and is a safe no-op if called).
//   - Thaw must be idempotent enough that calling it after a failed Quiesce, or
//     twice, does not corrupt the workload.
type QuiesceProvider interface {
	// Kind is the provider tag persisted on the barrier (ProviderScript|ProviderHTTP).
	Kind() string
	// Quiesce freezes the workload. ctx carries the deadline.
	Quiesce(ctx context.Context) (QuiesceResult, error)
	// Thaw releases the freeze. res is the result Quiesce returned (carries the
	// barrier token for HTTP providers).
	Thaw(ctx context.Context, res QuiesceResult) (QuiesceResult, error)
}

// --- ScriptQuiesceProvider -------------------------------------------------

// ScriptQuiesceProvider runs configured pre-freeze and post-thaw OS commands.
// It is suitable for wrapping fsfreeze, a VSS requestor, or a database FLUSH
// script. A non-zero exit code is a failed quiesce/thaw; the combined
// stdout+stderr is captured for the audit trail.
//
// Commands run through /bin/sh -c (POSIX) so operators can write a normal shell
// command line. The configured timeout bounds each command; when ctx already
// carries a shorter deadline that wins.
type ScriptQuiesceProvider struct {
	// FreezeCmd is the shell command line run to quiesce the workload (e.g.
	// "fsfreeze --freeze /data" or "psql -c 'CHECKPOINT'"). Required.
	FreezeCmd string
	// ThawCmd is the shell command line run to thaw the workload (e.g.
	// "fsfreeze --unfreeze /data"). Required.
	ThawCmd string
	// Shell is the interpreter; defaults to /bin/sh.
	Shell string
	// Timeout bounds each command; defaults to 30s when zero.
	Timeout time.Duration
	// Env, when set, is appended to the command environment.
	Env []string
}

// Kind reports the provider tag.
func (p *ScriptQuiesceProvider) Kind() string { return ProviderScript }

func (p *ScriptQuiesceProvider) shell() string {
	if strings.TrimSpace(p.Shell) != "" {
		return p.Shell
	}
	return "/bin/sh"
}

func (p *ScriptQuiesceProvider) timeout() time.Duration {
	if p.Timeout > 0 {
		return p.Timeout
	}
	return 30 * time.Second
}

// Quiesce runs the configured freeze command. A non-zero exit code is a failed
// quiesce (ErrQuiesceFailed) and the workload is considered NOT frozen.
func (p *ScriptQuiesceProvider) Quiesce(ctx context.Context) (QuiesceResult, error) {
	if strings.TrimSpace(p.FreezeCmd) == "" {
		return QuiesceResult{}, fmt.Errorf("%w: script freeze command is empty", ErrInvalidInput)
	}
	out, err := p.run(ctx, p.FreezeCmd)
	if err != nil {
		return QuiesceResult{Output: out}, fmt.Errorf("%w: freeze command: %v: %s", ErrQuiesceFailed, err, strings.TrimSpace(out))
	}
	return QuiesceResult{Output: out, MarkerLSN: extractMarkerLSN(out)}, nil
}

// Thaw runs the configured thaw command. A non-zero exit code is ErrThawFailed.
func (p *ScriptQuiesceProvider) Thaw(ctx context.Context, _ QuiesceResult) (QuiesceResult, error) {
	if strings.TrimSpace(p.ThawCmd) == "" {
		return QuiesceResult{}, fmt.Errorf("%w: script thaw command is empty", ErrInvalidInput)
	}
	out, err := p.run(ctx, p.ThawCmd)
	if err != nil {
		return QuiesceResult{Output: out}, fmt.Errorf("%w: thaw command: %v: %s", ErrThawFailed, err, strings.TrimSpace(out))
	}
	return QuiesceResult{Output: out}, nil
}

// run executes one shell command line with a bounded context, capturing combined
// stdout+stderr. A non-zero exit (including signals) returns the underlying
// *exec.ExitError so the caller can wrap it.
func (p *ScriptQuiesceProvider) run(ctx context.Context, cmdline string) (string, error) {
	cctx, cancel := context.WithTimeout(ctx, p.timeout())
	defer cancel()

	cmd := exec.CommandContext(cctx, p.shell(), "-c", cmdline)
	if len(p.Env) > 0 {
		cmd.Env = append(cmd.Environ(), p.Env...)
	}
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	err := cmd.Run()
	out := buf.String()
	if err != nil {
		// Distinguish a timeout from a non-zero exit for a clearer audit trail.
		if cctx.Err() == context.DeadlineExceeded {
			return out, fmt.Errorf("timed out after %s", p.timeout())
		}
		return out, err
	}
	return out, nil
}

// --- HTTPQuiesceProvider ---------------------------------------------------

// HTTPQuiesceProvider calls a workload-agent webhook to quiesce and thaw. The
// agent exposes POST {BaseURL}/quiesce and POST {BaseURL}/thaw. Quiesce returns
// a barrier token in its JSON response which Thaw echoes back so the agent can
// match the release to the freeze.
//
// A non-2xx response is a failed quiesce/thaw; the response body is captured.
type HTTPQuiesceProvider struct {
	// BaseURL is the agent base (e.g. "http://10.0.0.4:9099/agent"); the provider
	// POSTs to BaseURL + "/quiesce" and BaseURL + "/thaw". Required.
	BaseURL string
	// Client is the HTTP client; defaults to a client with the provider Timeout.
	Client *http.Client
	// Timeout bounds each request; defaults to 30s when zero.
	Timeout time.Duration
	// AuthToken, when set, is sent as a Bearer Authorization header so the agent
	// can authenticate the control plane.
	AuthToken string
}

// quiesceRequest is the POST body sent to /quiesce and /thaw.
type quiesceRequest struct {
	// Action is "quiesce" or "thaw" so a single handler can branch.
	Action string `json:"action"`
	// BarrierToken correlates a thaw with its quiesce (empty on quiesce).
	BarrierToken string `json:"barrier_token,omitempty"`
}

// quiesceResponse is the JSON the agent returns. A non-empty barrier_token from
// /quiesce is echoed back to /thaw.
type quiesceResponse struct {
	BarrierToken string `json:"barrier_token"`
	MarkerLSN    string `json:"marker_lsn,omitempty"`
	Message      string `json:"message"`
}

// Kind reports the provider tag.
func (p *HTTPQuiesceProvider) Kind() string { return ProviderHTTP }

func (p *HTTPQuiesceProvider) timeout() time.Duration {
	if p.Timeout > 0 {
		return p.Timeout
	}
	return 30 * time.Second
}

func (p *HTTPQuiesceProvider) client() *http.Client {
	if p.Client != nil {
		return p.Client
	}
	return &http.Client{Timeout: p.timeout()}
}

// Quiesce POSTs to {BaseURL}/quiesce and returns the agent-issued barrier token.
func (p *HTTPQuiesceProvider) Quiesce(ctx context.Context) (QuiesceResult, error) {
	if strings.TrimSpace(p.BaseURL) == "" {
		return QuiesceResult{}, fmt.Errorf("%w: http base url is empty", ErrInvalidInput)
	}
	resp, body, err := p.post(ctx, "/quiesce", quiesceRequest{Action: "quiesce"})
	if err != nil {
		return QuiesceResult{Output: body}, fmt.Errorf("%w: %v", ErrQuiesceFailed, err)
	}
	return QuiesceResult{
		Output:       bodyOrMessage(body, resp),
		BarrierToken: resp.BarrierToken,
		MarkerLSN:    strings.TrimSpace(resp.MarkerLSN),
	}, nil
}

// Thaw POSTs to {BaseURL}/thaw echoing the barrier token from Quiesce.
func (p *HTTPQuiesceProvider) Thaw(ctx context.Context, res QuiesceResult) (QuiesceResult, error) {
	if strings.TrimSpace(p.BaseURL) == "" {
		return QuiesceResult{}, fmt.Errorf("%w: http base url is empty", ErrInvalidInput)
	}
	resp, body, err := p.post(ctx, "/thaw", quiesceRequest{Action: "thaw", BarrierToken: res.BarrierToken})
	if err != nil {
		return QuiesceResult{Output: body, BarrierToken: res.BarrierToken}, fmt.Errorf("%w: %v", ErrThawFailed, err)
	}
	return QuiesceResult{Output: bodyOrMessage(body, resp), BarrierToken: res.BarrierToken}, nil
}

// post sends one JSON request and decodes the JSON response. A non-2xx status is
// an error carrying the captured body.
func (p *HTTPQuiesceProvider) post(ctx context.Context, path string, reqBody quiesceRequest) (quiesceResponse, string, error) {
	cctx, cancel := context.WithTimeout(ctx, p.timeout())
	defer cancel()

	payload, err := json.Marshal(reqBody)
	if err != nil {
		return quiesceResponse{}, "", fmt.Errorf("marshaling %s request: %w", path, err)
	}
	url := strings.TrimRight(p.BaseURL, "/") + path
	req, err := http.NewRequestWithContext(cctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return quiesceResponse{}, "", fmt.Errorf("building %s request: %w", path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if strings.TrimSpace(p.AuthToken) != "" {
		req.Header.Set("Authorization", "Bearer "+p.AuthToken)
	}

	httpResp, err := p.client().Do(req)
	if err != nil {
		return quiesceResponse{}, "", fmt.Errorf("posting %s: %w", path, err)
	}
	defer httpResp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(httpResp.Body, 1<<20))
	if err != nil {
		return quiesceResponse{}, "", fmt.Errorf("reading %s response: %w", path, err)
	}
	bodyStr := string(raw)

	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return quiesceResponse{}, bodyStr, fmt.Errorf("agent %s returned status %d: %s", path, httpResp.StatusCode, strings.TrimSpace(bodyStr))
	}

	var decoded quiesceResponse
	if len(bytes.TrimSpace(raw)) > 0 {
		if err := json.Unmarshal(raw, &decoded); err != nil {
			// A 2xx with a non-JSON body is still a successful quiesce/thaw; keep
			// the raw body as the captured output and proceed with no token.
			return quiesceResponse{Message: bodyStr}, bodyStr, nil
		}
	}
	return decoded, bodyStr, nil
}

// bodyOrMessage prefers the structured message, falling back to the raw body.
func bodyOrMessage(body string, resp quiesceResponse) string {
	if strings.TrimSpace(resp.Message) != "" {
		return resp.Message
	}
	return body
}

func extractMarkerLSN(output string) string {
	for _, raw := range strings.Split(output, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		for _, key := range []string{"CLARIO_MARKER_LSN", "marker_lsn", "barrier_lsn", "lsn"} {
			if value, ok := cutMarkerValue(line, key); ok {
				return value
			}
		}
		if looksLikePGMarkerLSN(line) {
			return line
		}
	}
	return ""
}

func cutMarkerValue(line, key string) (string, bool) {
	lower := strings.ToLower(line)
	want := strings.ToLower(key)
	if !strings.HasPrefix(lower, want) {
		return "", false
	}
	rest := strings.TrimSpace(line[len(key):])
	if rest == "" {
		return "", false
	}
	if rest[0] != '=' && rest[0] != ':' {
		return "", false
	}
	value := strings.Trim(strings.TrimSpace(rest[1:]), `"'`)
	if value == "" {
		return "", false
	}
	return value, true
}

func looksLikePGMarkerLSN(value string) bool {
	parts := strings.Split(value, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return false
	}
	for _, p := range parts {
		for _, r := range p {
			switch {
			case r >= '0' && r <= '9':
			case r >= 'a' && r <= 'f':
			case r >= 'A' && r <= 'F':
			default:
				return false
			}
		}
	}
	return true
}
