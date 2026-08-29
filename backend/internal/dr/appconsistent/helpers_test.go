package appconsistent

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"
)

// fileExists reports whether a path exists, used by the coordinator tests to
// observe the side effects of the REAL freeze/thaw shell commands.
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// fakeAgent is a REAL httptest server modelling a workload quiesce agent. It
// tracks freeze state and the token echoed on thaw so a coordinator test can
// assert the full HTTP protocol round-trip.
type fakeAgent struct {
	srv *httptest.Server
	url string

	mu          sync.Mutex
	frozen      bool
	issuedToken string
	thawToken   string
}

func newFakeAgent(t *testing.T) *fakeAgent {
	t.Helper()
	a := &fakeAgent{issuedToken: "tok-" + t.Name()}
	a.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req quiesceRequest
		_ = json.NewDecoder(r.Body).Decode(&req)
		a.mu.Lock()
		defer a.mu.Unlock()
		switch r.URL.Path {
		case "/quiesce":
			a.frozen = true
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(quiesceResponse{BarrierToken: a.issuedToken, Message: "frozen"})
		case "/thaw":
			a.thawToken = req.BarrierToken
			a.frozen = false
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(quiesceResponse{Message: "thawed"})
		default:
			http.NotFound(w, r)
		}
	}))
	a.url = a.srv.URL
	return a
}

func (a *fakeAgent) isFrozen() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.frozen
}

func (a *fakeAgent) thawedWithToken() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.thawToken == a.issuedToken
}

func (a *fakeAgent) close() { a.srv.Close() }
