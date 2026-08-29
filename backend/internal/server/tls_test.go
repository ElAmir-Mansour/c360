package server

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/config"
)

// genSelfSigned writes a self-signed cert+key for "localhost"/127.0.0.1 to dir
// and returns their paths plus a CertPool that trusts the cert.
func genSelfSigned(t *testing.T, dir string) (certPath, keyPath string, pool *x509.CertPool) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	tmpl := x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}

	certPath = filepath.Join(dir, "tls.crt")
	keyPath = filepath.Join(dir, "tls.key")

	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if err := os.WriteFile(certPath, certPEM, 0o600); err != nil {
		t.Fatalf("write cert: %v", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal key: %v", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}

	pool = x509.NewCertPool()
	if !pool.AppendCertsFromPEM(certPEM) {
		t.Fatal("append cert to pool")
	}
	return certPath, keyPath, pool
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port
}

// newTestServer builds a minimal *Server without going through New() (which
// requires DB/Redis/JWT). It exercises only the Start() TLS-vs-plain selection.
func newTestServer(cfg *config.Config) *Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/ping", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("pong"))
	})
	return &Server{
		HTTPServer: &http.Server{
			Addr:    cfg.Server.Addr(),
			Handler: mux,
		},
		Logger: zerolog.Nop(),
		Config: cfg,
	}
}

func TestStart_ServesOverTLS(t *testing.T) {
	dir := t.TempDir()
	certPath, keyPath, pool := genSelfSigned(t, dir)
	port := freePort(t)

	cfg := &config.Config{}
	cfg.Server.Host = "127.0.0.1"
	cfg.Server.Port = port
	cfg.Server.ShutdownTimeout = 5 * time.Second
	cfg.Server.TLSEnabled = true
	cfg.Server.TLSCertPath = certPath
	cfg.Server.TLSKeyPath = keyPath

	if !cfg.Server.TLSReady() {
		t.Fatal("expected TLSReady true")
	}

	srv := newTestServer(cfg)
	go func() { _ = srv.Start() }()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = srv.HTTPServer.Shutdown(ctx)
	}()

	client := &http.Client{
		Transport: &http.Transport{TLSClientConfig: &tls.Config{RootCAs: pool}},
		Timeout:   3 * time.Second,
	}
	url := "https://127.0.0.1:" + itoa(port) + "/ping"

	resp := waitForGet(t, client, url, true)
	defer resp.Body.Close()
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.Code)
	}
	if resp.Body == nil {
		t.Fatal("nil body")
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "pong" {
		t.Errorf("body = %q, want pong", string(body))
	}

	// A plain-HTTP request to the TLS port must NOT be served as a normal HTTP
	// 200: the TLS server rejects the cleartext request (transport error or a
	// 4xx "client sent an HTTP request to an HTTPS server").
	plainResp, err := client.Get("http://127.0.0.1:" + itoa(port) + "/ping")
	if err == nil {
		defer plainResp.Body.Close()
		if plainResp.StatusCode == http.StatusOK {
			t.Errorf("plain HTTP to TLS port unexpectedly returned 200")
		}
	}
}

func TestStart_ServesPlainHTTP_WhenTLSDisabled(t *testing.T) {
	port := freePort(t)
	cfg := &config.Config{}
	cfg.Server.Host = "127.0.0.1"
	cfg.Server.Port = port
	cfg.Server.ShutdownTimeout = 5 * time.Second
	// TLS disabled (default).

	if cfg.Server.TLSReady() {
		t.Fatal("expected TLSReady false")
	}

	srv := newTestServer(cfg)
	go func() { _ = srv.Start() }()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = srv.HTTPServer.Shutdown(ctx)
	}()

	client := &http.Client{Timeout: 3 * time.Second}
	url := "http://127.0.0.1:" + itoa(port) + "/ping"

	resp := waitForGet(t, client, url, false)
	defer resp.Body.Close()
	if resp.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.Code)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "pong" {
		t.Errorf("body = %q, want pong", string(body))
	}
}

// respWrap pairs a status code + body for the helper.
type respWrap struct {
	Code int
	Body io.ReadCloser
}

// waitForGet retries the request until the server is up (handles the race with
// the goroutine starting the listener).
func waitForGet(t *testing.T, c *http.Client, url string, _ bool) *respWrap {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	var lastErr error
	for time.Now().Before(deadline) {
		resp, err := c.Get(url)
		if err == nil {
			return &respWrap{Code: resp.StatusCode, Body: resp.Body}
		}
		lastErr = err
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("server never became reachable at %s: %v", url, lastErr)
	return nil
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [20]byte
	pos := len(b)
	for i > 0 {
		pos--
		b[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(b[pos:])
}
