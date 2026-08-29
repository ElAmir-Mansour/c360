package provider

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// --- in-test PKI helpers (ephemeral only; nothing touches a real endpoint) ---

type testCA struct {
	cert    *x509.Certificate
	key     *ecdsa.PrivateKey
	certPEM []byte
}

func newTestCA(t *testing.T) *testCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("ca key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "clario-dr-test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		IsCA:                  true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("ca cert: %v", err)
	}
	cert, _ := x509.ParseCertificate(der)
	return &testCA{
		cert:    cert,
		key:     key,
		certPEM: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
	}
}

// issue signs a leaf cert (server or client) for the given DNS/IP SANs.
func (ca *testCA) issue(t *testing.T, cn string, isServer bool, dnsNames []string, ips []net.IP) (certPEM, keyPEM []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("leaf key: %v", err)
	}
	eku := x509.ExtKeyUsageClientAuth
	if isServer {
		eku = x509.ExtKeyUsageServerAuth
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{eku},
		DNSNames:     dnsNames,
		IPAddresses:  ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatalf("leaf cert: %v", err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("leaf key marshal: %v", err)
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	return certPEM, keyPEM
}

// serverTLSConfig produces a *tls.Config presenting a CA-signed leaf for
// 127.0.0.1, optionally requiring+verifying a client cert (mTLS).
func (ca *testCA) serverTLSConfig(t *testing.T, requireClient bool) *tls.Config {
	t.Helper()
	certPEM, keyPEM := ca.issue(t, "127.0.0.1", true, []string{"localhost"}, []net.IP{net.ParseIP("127.0.0.1")})
	pair, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatalf("server keypair: %v", err)
	}
	cfg := &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12}
	if requireClient {
		pool := x509.NewCertPool()
		pool.AppendCertsFromPEM(ca.certPEM)
		cfg.ClientCAs = pool
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
	}
	return cfg
}

func ed25519SigningKeyPEM(t *testing.T) (privPEM string, pub ed25519.PublicKey) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("ed25519: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("ed25519 marshal: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})), pub
}

// startEnsureServer starts a TLS test server that returns a fixed ensure result
// and records the last request headers + body.
type capturedReq struct {
	headers http.Header
	body    []byte
}

func startEnsureServer(t *testing.T, tlsCfg *tls.Config, sink *capturedReq) *httptest.Server {
	t.Helper()
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if sink != nil {
			sink.headers = r.Header.Clone()
			sink.body = body
		}
		switch r.URL.Path {
		case "/api/v1/dr/provider/ensure":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"data": map[string]any{"external_id": "vmware:dr-vm-1", "metadata": map[string]string{"vm": "dr-vm-1"}},
			})
		case "/api/v1/dr/provider/teardown":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.NotFound(w, r)
		}
	}))
	srv.TLS = tlsCfg
	srv.StartTLS()
	t.Cleanup(srv.Close)
	return srv
}

func baseVSphereCfg(endpoint, caPEM string) Config {
	return Config{
		Kind:          KindVSphere,
		Endpoint:      endpoint,
		CredentialRef: "vault:vsphere",
		Datacenter:    "dc1",
		CABundlePEM:   caPEM,
	}
}

// --- (1) TRANSPORT: pinned CA success, unpinned/self-signed rejected ---------

func TestGatewayPinnedCASucceeds(t *testing.T) {
	ca := newTestCA(t)
	srv := startEnsureServer(t, ca.serverTLSConfig(t, false), nil)

	adapter, err := NewRegistry().Build(baseVSphereCfg(srv.URL, string(ca.certPEM)))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	res, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"})
	if err != nil {
		t.Fatalf("Ensure with pinned CA: %v", err)
	}
	if res.ExternalID != "vmware:dr-vm-1" {
		t.Fatalf("result = %+v", res)
	}
}

func TestGatewayUnpinnedServerCertRejected(t *testing.T) {
	// Server is signed by CA-A; the client pins a DIFFERENT CA-B.
	serverCA := newTestCA(t)
	otherCA := newTestCA(t)
	srv := startEnsureServer(t, serverCA.serverTLSConfig(t, false), nil)

	adapter, err := NewRegistry().Build(baseVSphereCfg(srv.URL, string(otherCA.certPEM)))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	_, err = adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"})
	if err == nil {
		t.Fatalf("expected TLS verification failure against an unpinned server cert")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "certificate") && !strings.Contains(strings.ToLower(err.Error()), "authority") {
		t.Fatalf("expected cert-authority error, got: %v", err)
	}
}

// --- (2) HTTPS-ONLY -----------------------------------------------------------

func TestGatewayRejectsPlaintextEndpoint(t *testing.T) {
	ca := newTestCA(t)
	cfg := baseVSphereCfg("http://gateway.internal:8080", string(ca.certPEM))
	adapter, err := NewRegistry().Build(cfg)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if err := adapter.Validate(cfg); !errors.Is(err, ErrInsecureEndpoint) {
		t.Fatalf("Validate(http://) = %v, want ErrInsecureEndpoint", err)
	}
	if _, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"}); !errors.Is(err, ErrInsecureEndpoint) {
		t.Fatalf("Ensure(http://) = %v, want ErrInsecureEndpoint", err)
	}
}

func TestGatewayRejectsPlaintextPathOverride(t *testing.T) {
	ca := newTestCA(t)
	cfg := baseVSphereCfg("https://gateway.internal", string(ca.certPEM))
	cfg.Settings = map[string]string{"ensure_path": "http://gateway.internal/insecure"}
	adapter, err := NewRegistry().Build(cfg)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if err := adapter.Validate(cfg); !errors.Is(err, ErrInsecureEndpoint) {
		t.Fatalf("Validate(plaintext override) = %v, want ErrInsecureEndpoint", err)
	}
}

// --- (1) MinVersion floor enforced -------------------------------------------

func TestGatewayMinTLSFloorEnforced(t *testing.T) {
	ca := newTestCA(t)
	// Server that only speaks TLS 1.2 (max = 1.2).
	stls := ca.serverTLSConfig(t, false)
	stls.MaxVersion = tls.VersionTLS12
	srv := startEnsureServer(t, stls, nil)

	// Client demands a 1.3 floor -> handshake must fail (protocol version).
	cfg := baseVSphereCfg(srv.URL, string(ca.certPEM))
	cfg.MinTLSVersion = "1.3"
	adapter, err := NewRegistry().Build(cfg)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	_, err = adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"})
	if err == nil {
		t.Fatalf("expected TLS floor (1.3) to reject a 1.2-only server")
	}

	// Same server accepted when the client floor is 1.2.
	cfg.MinTLSVersion = "1.2"
	adapter, err = NewRegistry().Build(cfg)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if _, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"}); err != nil {
		t.Fatalf("Ensure with 1.2 floor should succeed: %v", err)
	}
}

func TestBuildRejectsMalformedPEM(t *testing.T) {
	cases := map[string]Config{
		"bad ca":      {Kind: KindVSphere, CABundlePEM: "-----BEGIN CERTIFICATE-----\nnotpem\n-----END CERTIFICATE-----"},
		"bad signing": {Kind: KindVSphere, SigningKeyPEM: "-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----"},
		"bad min tls": {Kind: KindVSphere, MinTLSVersion: "1.1"},
		"half mtls":   {Kind: KindVSphere, ClientCertPEM: "x"},
	}
	for name, cfg := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := NewRegistry().Build(cfg); err == nil {
				t.Fatalf("expected Build to fail closed on %s", name)
			}
		})
	}
}

// --- (1) mTLS required-cert path ---------------------------------------------

func TestGatewayMutualTLS(t *testing.T) {
	ca := newTestCA(t)
	srv := startEnsureServer(t, ca.serverTLSConfig(t, true /* require client cert */), nil)

	// Without a client identity the mTLS server rejects the handshake.
	noClient := baseVSphereCfg(srv.URL, string(ca.certPEM))
	adapter, err := NewRegistry().Build(noClient)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if _, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"}); err == nil {
		t.Fatalf("expected mTLS server to reject a client with no certificate")
	}

	// With a CA-signed client identity the handshake succeeds.
	clientCert, clientKey := ca.issue(t, "clario-dr-client", false, nil, nil)
	withClient := baseVSphereCfg(srv.URL, string(ca.certPEM))
	withClient.ClientCertPEM = string(clientCert)
	withClient.ClientKeyPEM = string(clientKey)
	adapter, err = NewRegistry().Build(withClient)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if _, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"}); err != nil {
		t.Fatalf("Ensure with mTLS client identity: %v", err)
	}
}

// --- (3) REAL DETACHED SIGNING: present, verifies, tamper fails --------------

func TestGatewaySignatureHeaderPresentAndVerifies(t *testing.T) {
	ca := newTestCA(t)
	signKeyPEM, signPub := ed25519SigningKeyPEM(t)
	sink := &capturedReq{}
	srv := startEnsureServer(t, ca.serverTLSConfig(t, false), sink)

	cfg := baseVSphereCfg(srv.URL, string(ca.certPEM))
	cfg.SigningKeyPEM = signKeyPEM
	cfg.SigningKeyID = "dr-key-2026"
	adapter, err := NewRegistry().Build(cfg)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if _, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"}); err != nil {
		t.Fatalf("Ensure: %v", err)
	}

	sig := sink.headers.Get(HeaderSignature)
	alg := sink.headers.Get(HeaderSignatureAlg)
	ts := sink.headers.Get(HeaderTimestamp)
	nonce := sink.headers.Get(HeaderNonce)
	if sig == "" || alg != SigAlgEd25519 || ts == "" || nonce == "" {
		t.Fatalf("missing signature headers: sig=%q alg=%q ts=%q nonce=%q", sig, alg, ts, nonce)
	}
	if kid := sink.headers.Get(HeaderSignatureKeyID); kid != "dr-key-2026" {
		t.Fatalf("key-id header = %q", kid)
	}

	// Verifies with the public key against the exact body the server received.
	if err := VerifyGatewaySignature(signPub, alg, sink.body, ts, nonce, sig); err != nil {
		t.Fatalf("signature must verify: %v", err)
	}
	// Also verifies via the exported public-key PEM path (receiver provisioning).
	pubPEM, err := adapter.(*GatewayAdapter).SignerPublicKeyPEM()
	if err != nil || pubPEM == "" {
		t.Fatalf("SignerPublicKeyPEM: pem=%q err=%v", pubPEM, err)
	}
	if err := VerifyGatewaySignature(pubPEM, alg, sink.body, ts, nonce, sig); err != nil {
		t.Fatalf("verify via public-key PEM: %v", err)
	}

	// TAMPER: a mutated body MUST fail verification.
	tampered := append([]byte(nil), sink.body...)
	tampered[len(tampered)/2] ^= 0xFF
	if err := VerifyGatewaySignature(signPub, alg, tampered, ts, nonce, sig); !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("tampered body must fail verification, got: %v", err)
	}
	// Mutated timestamp/nonce also fail (replay/clock binding).
	if err := VerifyGatewaySignature(signPub, alg, sink.body, ts, nonce+"x", sig); !errors.Is(err, ErrSignatureInvalid) {
		t.Fatalf("mutated nonce must fail verification, got: %v", err)
	}
}

// --- (4) IDEMPOTENCY + BOUNDED RETRIES ---------------------------------------

// flakyServer returns `failures` transient responses then a success.
func startFlakyServer(t *testing.T, tlsCfg *tls.Config, status int, failures int32, keys *[]string) *httptest.Server {
	t.Helper()
	var seen int32
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if keys != nil {
			*keys = append(*keys, r.Header.Get(HeaderIdempotencyKey))
		}
		n := atomic.AddInt32(&seen, 1)
		if n <= failures {
			w.WriteHeader(status)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"external_id": "vmware:ok"}})
	}))
	srv.TLS = tlsCfg
	srv.StartTLS()
	t.Cleanup(srv.Close)
	return srv
}

func TestGatewayRetriesTransientThenSucceeds(t *testing.T) {
	ca := newTestCA(t)
	var keys []string
	// Two 503s then a 200 -> succeeds within the cap (4 attempts).
	srv := startFlakyServer(t, ca.serverTLSConfig(t, false), http.StatusServiceUnavailable, 2, &keys)

	adapter, err := NewRegistry().Build(baseVSphereCfg(srv.URL, string(ca.certPEM)))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	res, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"})
	if err != nil {
		t.Fatalf("Ensure should recover after transient 503s: %v", err)
	}
	if res.ExternalID != "vmware:ok" {
		t.Fatalf("result = %+v", res)
	}
	if len(keys) != 3 {
		t.Fatalf("expected 3 attempts (2 fail + 1 ok), got %d", len(keys))
	}
	// Idempotency-Key identical across retries.
	for i, k := range keys {
		if k == "" || k != keys[0] {
			t.Fatalf("idempotency key drifted at attempt %d: %q vs %q", i, k, keys[0])
		}
	}
}

func TestGatewayRetriesBoundedOnPermanent5xx(t *testing.T) {
	ca := newTestCA(t)
	var keys []string
	// Always 500 -> must give up after exactly gatewayMaxAttempts.
	srv := startFlakyServer(t, ca.serverTLSConfig(t, false), http.StatusInternalServerError, 1<<30, &keys)

	adapter, err := NewRegistry().Build(baseVSphereCfg(srv.URL, string(ca.certPEM)))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if _, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"}); err == nil {
		t.Fatalf("expected failure after exhausting retries")
	}
	if len(keys) != gatewayMaxAttempts {
		t.Fatalf("expected exactly %d attempts, got %d", gatewayMaxAttempts, len(keys))
	}
	for _, k := range keys {
		if k != keys[0] {
			t.Fatalf("idempotency key must be stable across retries")
		}
	}
}

func TestGatewayDoesNotRetry4xx(t *testing.T) {
	ca := newTestCA(t)
	var keys []string
	// Always 400 -> a definitive client error is NOT retried.
	srv := startFlakyServer(t, ca.serverTLSConfig(t, false), http.StatusBadRequest, 1<<30, &keys)

	adapter, err := NewRegistry().Build(baseVSphereCfg(srv.URL, string(ca.certPEM)))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if _, err := adapter.Ensure(context.Background(), EnsureRequest{IdempotencyKey: "k", SiteID: "s", StreamID: "st"}); err == nil {
		t.Fatalf("expected a 400 to fail")
	}
	if len(keys) != 1 {
		t.Fatalf("4xx must not be retried; expected 1 attempt, got %d", len(keys))
	}
}

func TestDeriveIdempotencyKeyStableAndDistinct(t *testing.T) {
	body1 := []byte(`{"a":1}`)
	body2 := []byte(`{"a":2}`)
	k1 := deriveIdempotencyKey("vsphere", "ensure", body1)
	k1b := deriveIdempotencyKey("vsphere", "ensure", body1)
	if k1 != k1b {
		t.Fatalf("idempotency key must be stable for identical inputs")
	}
	if deriveIdempotencyKey("vsphere", "teardown", body1) == k1 {
		t.Fatalf("distinct operation must yield a distinct key")
	}
	if deriveIdempotencyKey("cloud", "ensure", body1) == k1 {
		t.Fatalf("distinct provider must yield a distinct key")
	}
	if deriveIdempotencyKey("vsphere", "ensure", body2) == k1 {
		t.Fatalf("distinct body must yield a distinct key")
	}
	if !strings.HasPrefix(k1, "dr-") {
		t.Fatalf("idempotency key prefix = %q", k1)
	}
}
