package middleware

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
)

// Timeout sets a per-request deadline. The timeout is looked up from routeOverrides
// by longest-prefix match; if no override matches, defaultTimeout is used.
// The proxy's Transport.ResponseHeaderTimeout handles upstream timeouts;
// this middleware catches cases where the overall handler is slow to complete.
//
// WebSocket upgrades and Server-Sent Events (Accept: text/event-stream) are
// exempt: both are long-lived by design (governed AI drafting streams run to
// LEX_LLM_TIMEOUT ~60s), so a fixed request deadline would truncate them
// mid-stream and inject a JSON 504 that corrupts the event feed. Time-to-first-
// byte for those streams is still bounded by Transport.ResponseHeaderTimeout.
func Timeout(defaultTimeout time.Duration, routeOverrides map[string]time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if isWebSocketUpgrade(r) || isEventStream(r) {
				next.ServeHTTP(w, r)
				return
			}

			timeout := defaultTimeout
			if routeOverrides != nil {
				bestLen := 0
				for prefix, d := range routeOverrides {
					if strings.HasPrefix(r.URL.Path, prefix) && len(prefix) > bestLen {
						bestLen = len(prefix)
						timeout = d
					}
				}
			}

			if timeout <= 0 {
				next.ServeHTTP(w, r)
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), timeout)
			defer cancel()

			r = r.WithContext(ctx)

			// The handler runs in a detached goroutine so we can react to the
			// deadline. It shares the ResponseWriter with the timeout path, so
			// both go through a mutex-guarded wrapper: whoever commits the
			// header first wins, and once the deadline fires every later write
			// from the abandoned handler goroutine is dropped. Without the guard
			// the two goroutines raced on the ResponseWriter → data race,
			// "superfluous WriteHeader" spam, and corrupted output.
			tw := &timeoutResponseWriter{ResponseWriter: w}
			done := make(chan struct{})
			go func() {
				defer close(done)
				next.ServeHTTP(tw, r)
			}()

			select {
			case <-done:
				// Handler finished before timeout — all good.
			case <-ctx.Done():
				tw.writeTimeout(r.Header.Get("X-Request-ID"))
			}
		})
	}
}

// timeoutResponseWriter serializes access to the underlying ResponseWriter so
// the detached handler goroutine and the timeout path never touch it
// concurrently. After the deadline fires (timedOut) all handler writes become
// no-ops, so the goroutine can safely outlive ServeHTTP without touching a
// recycled writer.
type timeoutResponseWriter struct {
	http.ResponseWriter
	mu        sync.Mutex
	committed bool
	timedOut  bool
}

func (tw *timeoutResponseWriter) WriteHeader(code int) {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	if tw.committed || tw.timedOut {
		return
	}
	tw.committed = true
	tw.ResponseWriter.WriteHeader(code)
}

func (tw *timeoutResponseWriter) Write(b []byte) (int, error) {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	if tw.timedOut {
		// Deadline already fired and the 504 (or a committed stream) was
		// written; silently drop late bytes from the abandoned handler.
		return len(b), nil
	}
	if !tw.committed {
		tw.committed = true
		tw.ResponseWriter.WriteHeader(http.StatusOK)
	}
	return tw.ResponseWriter.Write(b)
}

// Flush forwards streaming flushes (SSE, chunked exports) to the underlying
// writer so the proxy's flush chain still reaches the client, unless the
// deadline already fired.
func (tw *timeoutResponseWriter) Flush() {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	if tw.timedOut {
		return
	}
	if f, ok := tw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// writeTimeout emits the gateway 504 exactly once. If the handler already
// committed a response we cannot inject an error into the live stream, so we
// only flip timedOut (which mutes further handler writes) and let the
// connection close.
func (tw *timeoutResponseWriter) writeTimeout(reqID string) {
	tw.mu.Lock()
	defer tw.mu.Unlock()
	if tw.timedOut {
		return
	}
	tw.timedOut = true
	if tw.committed {
		return
	}
	tw.committed = true
	// writeGWError targets the underlying writer directly; we hold the lock,
	// so no concurrent handler write can interleave with it.
	writeGWError(tw.ResponseWriter, http.StatusGatewayTimeout, "GATEWAY_TIMEOUT",
		"request processing exceeded the time limit", reqID)
}

func isWebSocketUpgrade(r *http.Request) bool {
	if !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		return false
	}
	for _, value := range strings.Split(r.Header.Get("Connection"), ",") {
		if strings.EqualFold(strings.TrimSpace(value), "upgrade") {
			return true
		}
	}
	return false
}

// isEventStream reports whether the client asked for a Server-Sent Events
// stream (Accept: text/event-stream), including multi-value Accept headers.
func isEventStream(r *http.Request) bool {
	return strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/event-stream")
}
