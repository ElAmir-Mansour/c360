package bootgraph

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"runtime"
	"testing"
	"time"
)

func TestTCPProbe_RealListener_UpIsHealthy_ClosedIsUnhealthy(t *testing.T) {
	// Bind an ephemeral TCP listener — a REAL socket. While it is open the probe
	// must succeed (a connection establishes); after it is closed the probe must
	// fail (connection refused / timeout).
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	addr := ln.Addr().String()

	// Accept loop so the kernel completes the handshake while the listener is up.
	go func() {
		for {
			conn, aerr := ln.Accept()
			if aerr != nil {
				return
			}
			_ = conn.Close()
		}
	}()

	probe := TCPProbe{}
	svc := Service{Name: "db", ProbeKind: ProbeTCP, ProbeTarget: addr}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := probe.Check(ctx, svc); err != nil {
		t.Fatalf("probe against OPEN listener: got error %v, want healthy", err)
	}

	// Close the listener; the address should now refuse connections.
	if cerr := ln.Close(); cerr != nil {
		t.Fatalf("closing listener: %v", cerr)
	}

	ctx2, cancel2 := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel2()
	if err := probe.Check(ctx2, svc); err == nil {
		t.Fatal("probe against CLOSED listener: got healthy, want error")
	}
}

func TestTCPProbe_RejectsWrongKindAndEmptyTarget(t *testing.T) {
	if err := (TCPProbe{}).Check(context.Background(), Service{ProbeKind: ProbeHTTP}); !errors.Is(err, ErrInvalidProbe) {
		t.Fatalf("wrong kind: err = %v, want ErrInvalidProbe", err)
	}
	if err := (TCPProbe{}).Check(context.Background(), Service{ProbeKind: ProbeTCP, ProbeTarget: ""}); !errors.Is(err, ErrInvalidProbe) {
		t.Fatalf("empty target: err = %v, want ErrInvalidProbe", err)
	}
}

func TestHTTPProbe_RealServer_StatusGating(t *testing.T) {
	// A real httptest server. 200 -> healthy when expecting 2xx; an explicit
	// expected status that does not match -> unhealthy; 500 -> unhealthy.
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("/boom", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	probe := HTTPProbe{Client: srv.Client()}

	// 2xx default expectation.
	healthy := Service{Name: "web", ProbeKind: ProbeHTTP, ProbeTarget: srv.URL + "/healthz"}
	if err := probe.Check(context.Background(), healthy); err != nil {
		t.Fatalf("200 with 2xx expectation: got %v, want healthy", err)
	}

	// 500 is not 2xx -> unhealthy.
	boom := Service{Name: "web", ProbeKind: ProbeHTTP, ProbeTarget: srv.URL + "/boom"}
	if err := probe.Check(context.Background(), boom); err == nil {
		t.Fatal("500 with 2xx expectation: got healthy, want error")
	}

	// Explicit expected status mismatch -> unhealthy.
	mismatch := Service{Name: "web", ProbeKind: ProbeHTTP, ProbeTarget: srv.URL + "/healthz", ProbeExpectStatus: 204}
	if err := probe.Check(context.Background(), mismatch); err == nil {
		t.Fatal("200 with expect-204: got healthy, want error")
	}

	// Explicit expected status match -> healthy.
	match := Service{Name: "web", ProbeKind: ProbeHTTP, ProbeTarget: srv.URL + "/healthz", ProbeExpectStatus: 200}
	if err := probe.Check(context.Background(), match); err != nil {
		t.Fatalf("200 with expect-200: got %v, want healthy", err)
	}
}

func TestHTTPProbe_UnreachableIsUnhealthy(t *testing.T) {
	// Point at a port nothing listens on; the GET must fail.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("net.Listen: %v", err)
	}
	addr := ln.Addr().String()
	_ = ln.Close() // free the port so the connection is refused

	svc := Service{Name: "web", ProbeKind: ProbeHTTP, ProbeTarget: "http://" + addr + "/"}
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	if err := (HTTPProbe{}).Check(ctx, svc); err == nil {
		t.Fatal("probe against unbound port: got healthy, want error")
	}
}

func TestScriptProbe_ExitCodeGating(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("script probe test uses POSIX true/false")
	}
	// `true` exits 0 -> healthy; `false` exits 1 -> unhealthy. Real os/exec.
	ok := Service{Name: "worker", ProbeKind: ProbeScript, ProbeTarget: "true"}
	if err := (ScriptProbe{}).Check(context.Background(), ok); err != nil {
		t.Fatalf("`true`: got %v, want healthy", err)
	}
	bad := Service{Name: "worker", ProbeKind: ProbeScript, ProbeTarget: "false"}
	if err := (ScriptProbe{}).Check(context.Background(), bad); err == nil {
		t.Fatal("`false`: got healthy, want error")
	}
}

func TestCheckerFor_SelectsConcreteProbeAndRejectsUnknown(t *testing.T) {
	if _, ok := CheckerFor(Service{ProbeKind: ProbeHTTP}).(HTTPProbe); !ok {
		t.Error("http -> want HTTPProbe")
	}
	if _, ok := CheckerFor(Service{ProbeKind: ProbeTCP}).(TCPProbe); !ok {
		t.Error("tcp -> want TCPProbe")
	}
	if _, ok := CheckerFor(Service{ProbeKind: ProbeScript}).(ScriptProbe); !ok {
		t.Error("script -> want ScriptProbe")
	}
	// An unknown kind must yield an always-FAIL checker (never an always-true one).
	if err := CheckerFor(Service{ProbeKind: "bogus"}).Check(context.Background(), Service{ProbeKind: "bogus"}); !errors.Is(err, ErrInvalidProbe) {
		t.Fatalf("unknown kind: err = %v, want ErrInvalidProbe", err)
	}
}
