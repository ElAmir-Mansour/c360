package bootgraph

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os/exec"
	"strings"
)

// HealthChecker probes a single service and reports whether it is healthy. The
// orchestrator calls Check after issuing a service's boot and gates tier
// advancement on every service in the tier returning a nil error. The context
// is the per-attempt deadline (the orchestrator bounds each attempt with the
// service's boot timeout), so an implementation MUST honour ctx and never block
// past it. Returning a non-nil error means "not healthy (this attempt)".
type HealthChecker interface {
	Check(ctx context.Context, svc Service) error
}

// CheckerFor returns the concrete HealthChecker for a service's probe kind. It
// is the production factory the orchestrator uses; the real HTTP/TCP/script
// probes below are all context-bounded and perform real I/O. An unknown kind
// yields a checker that always reports ErrInvalidProbe (so a misconfigured
// service fails its gate rather than silently passing — no always-true detector).
func CheckerFor(svc Service) HealthChecker {
	switch svc.ProbeKind {
	case ProbeHTTP:
		return HTTPProbe{}
	case ProbeTCP:
		return TCPProbe{}
	case ProbeScript:
		return ScriptProbe{}
	default:
		return invalidProbe{}
	}
}

// HTTPProbe performs a real HTTP(S) GET against the service's ProbeTarget and
// considers the service healthy when the response status matches the expected
// status (or is any 2xx when ProbeExpectStatus is 0). It uses net/http with a
// per-request context deadline; the body is drained-and-closed so connections
// are reusable.
type HTTPProbe struct {
	// Client is optional; when nil a default client whose timeout is bounded by
	// the request context is used. Tests inject a client pointed at httptest.
	Client *http.Client
}

// Check implements HealthChecker for an HTTP probe.
func (p HTTPProbe) Check(ctx context.Context, svc Service) error {
	if svc.ProbeKind != ProbeHTTP {
		return fmt.Errorf("%q: %w", svc.ProbeKind, ErrInvalidProbe)
	}
	target := strings.TrimSpace(svc.ProbeTarget)
	if target == "" {
		return fmt.Errorf("http probe for %q: empty target: %w", svc.Name, ErrInvalidProbe)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return fmt.Errorf("http probe for %q: building request: %w", svc.Name, err)
	}
	client := p.Client
	if client == nil {
		client = &http.Client{}
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("http probe for %q: %w", svc.Name, err)
	}
	defer func() {
		// Drain so the connection can be reused, then close.
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	}()

	if svc.ProbeExpectStatus > 0 {
		if resp.StatusCode != svc.ProbeExpectStatus {
			return fmt.Errorf("http probe for %q: status %d, want %d", svc.Name, resp.StatusCode, svc.ProbeExpectStatus)
		}
		return nil
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("http probe for %q: status %d not 2xx", svc.Name, resp.StatusCode)
	}
	return nil
}

// TCPProbe dials the service's ProbeTarget (host:port) and considers the service
// healthy when a TCP connection establishes within the context deadline. It uses
// a real net.Dialer bounded by the context; the connection is closed immediately
// (this is a liveness probe, not a protocol handshake).
type TCPProbe struct{}

// Check implements HealthChecker for a TCP probe.
func (TCPProbe) Check(ctx context.Context, svc Service) error {
	if svc.ProbeKind != ProbeTCP {
		return fmt.Errorf("%q: %w", svc.ProbeKind, ErrInvalidProbe)
	}
	addr := strings.TrimSpace(svc.ProbeTarget)
	if addr == "" {
		return fmt.Errorf("tcp probe for %q: empty target: %w", svc.Name, ErrInvalidProbe)
	}
	var d net.Dialer
	conn, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("tcp probe for %q: dialing %s: %w", svc.Name, addr, err)
	}
	_ = conn.Close()
	return nil
}

// ScriptProbe runs the service's ProbeTarget as a local command (space-split
// argv) and considers the service healthy when the command exits zero within the
// context deadline. It uses os/exec with the context, so a hung script is killed
// when the deadline passes.
type ScriptProbe struct{}

// Check implements HealthChecker for a script probe.
func (ScriptProbe) Check(ctx context.Context, svc Service) error {
	if svc.ProbeKind != ProbeScript {
		return fmt.Errorf("%q: %w", svc.ProbeKind, ErrInvalidProbe)
	}
	line := strings.TrimSpace(svc.ProbeTarget)
	if line == "" {
		return fmt.Errorf("script probe for %q: empty command: %w", svc.Name, ErrInvalidProbe)
	}
	fields := strings.Fields(line)
	cmd := exec.CommandContext(ctx, fields[0], fields[1:]...)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("script probe for %q: %w", svc.Name, err)
	}
	return nil
}

// invalidProbe is returned by CheckerFor for an unrecognised probe kind; it
// always reports ErrInvalidProbe so a misconfigured service fails its gate.
type invalidProbe struct{}

func (invalidProbe) Check(_ context.Context, svc Service) error {
	return fmt.Errorf("%q: %w", svc.ProbeKind, ErrInvalidProbe)
}

// compile-time checks.
var (
	_ HealthChecker = HTTPProbe{}
	_ HealthChecker = TCPProbe{}
	_ HealthChecker = ScriptProbe{}
	_ HealthChecker = invalidProbe{}
)
