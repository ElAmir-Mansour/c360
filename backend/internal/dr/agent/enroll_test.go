package agent

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// testCA is a real in-memory certificate authority used to prove the enroll
// client's CSR is genuinely signed into a usable leaf certificate.
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
		Subject:               pkix.Name{CommonName: "Clario DR Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("ca self-sign: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse ca: %v", err)
	}
	return &testCA{
		cert:    cert,
		key:     key,
		certPEM: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
	}
}

// signCSR signs a PEM CSR into a client-auth leaf certificate, returning the
// leaf PEM and its serial. This is the real PKI step the control plane performs.
func (ca *testCA) signCSR(t *testing.T, csrPEM string) (leafPEM string, serial string) {
	t.Helper()
	block, _ := pem.Decode([]byte(csrPEM))
	if block == nil {
		t.Fatal("CSR is not valid PEM")
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		t.Fatalf("parse CSR: %v", err)
	}
	if err := csr.CheckSignature(); err != nil {
		t.Fatalf("CSR signature invalid: %v", err)
	}
	sn, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	tmpl := &x509.Certificate{
		SerialNumber: sn,
		Subject:      csr.Subject,
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, csr.PublicKey, ca.key)
	if err != nil {
		t.Fatalf("sign CSR: %v", err)
	}
	leaf := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return string(leaf), sn.String()
}

func TestGenerateKeyAndCSR_ProducesValidSignedCSR(t *testing.T) {
	gk, err := generateKeyAndCSR("agent-123")
	if err != nil {
		t.Fatalf("generateKeyAndCSR: %v", err)
	}
	block, _ := pem.Decode(gk.csrPEM)
	if block == nil {
		t.Fatal("CSR PEM did not decode")
	}
	csr, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		t.Fatalf("parse generated CSR: %v", err)
	}
	if err := csr.CheckSignature(); err != nil {
		t.Fatalf("generated CSR self-signature invalid: %v", err)
	}
	if csr.Subject.CommonName != "agent-123" {
		t.Fatalf("CSR CN = %q, want agent-123", csr.Subject.CommonName)
	}
	// The private key PEM must be present and parse.
	kb, _ := pem.Decode(gk.keyPEM)
	if kb == nil {
		t.Fatal("key PEM did not decode")
	}
	if _, err := x509.ParseECPrivateKey(kb.Bytes); err != nil {
		t.Fatalf("parse generated key: %v", err)
	}
}

func TestEnrollClient_ExchangeSignsCSRToLeaf(t *testing.T) {
	ca := newTestCA(t)

	var gotToken string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != enrollSubPath {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var req struct {
			Token  string `json:"token"`
			CSRPEM string `json:"csr_pem"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		gotToken = req.Token
		leafPEM, serial := ca.signCSR(t, req.CSRPEM)
		resp := map[string]any{"data": map[string]string{
			"cert_pem":     leafPEM,
			"ca_chain_pem": string(ca.certPEM),
			"serial":       serial,
			"expires_at":   time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
			"agent_id":     "agent-xyz",
			"tenant_id":    "tenant-1",
		}}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	id, err := NewEnrollClient().Enroll(context.Background(), EnrollConfig{
		ControlPlaneURL: srv.URL,
		Token:           "single-use-token",
		AgentID:         "agent-xyz",
		HTTPClient:      srv.Client(),
	})
	if err != nil {
		t.Fatalf("Enroll: %v", err)
	}
	if gotToken != "single-use-token" {
		t.Fatalf("server saw token %q, want single-use-token", gotToken)
	}

	// The assembled tls.Certificate must have a usable leaf whose key matches the
	// generated private key (X509KeyPair succeeded), and chain back to the CA.
	if id.Certificate.Leaf == nil {
		t.Fatal("assembled identity has no parsed leaf")
	}
	roots := x509.NewCertPool()
	roots.AddCert(ca.cert)
	if _, err := id.Certificate.Leaf.Verify(x509.VerifyOptions{
		Roots:     roots,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		t.Fatalf("issued leaf does not verify against the CA: %v", err)
	}
	if id.Serial == "" {
		t.Fatal("identity serial is empty")
	}
	if len(id.CAChainPEM) == 0 {
		t.Fatal("identity CA chain is empty")
	}
}

func TestEnrollClient_RejectsErrorResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]string{"code": "token_consumed", "message": "token already used"},
		})
	}))
	defer srv.Close()

	_, err := NewEnrollClient().Enroll(context.Background(), EnrollConfig{
		ControlPlaneURL: srv.URL,
		Token:           "used-token",
		AgentID:         "a",
		HTTPClient:      srv.Client(),
	})
	if err == nil {
		t.Fatal("expected error on consumed token, got nil")
	}
}

func TestEnrollClient_RequiresTokenAndURL(t *testing.T) {
	_, err := NewEnrollClient().Enroll(context.Background(), EnrollConfig{Token: "t"})
	if err == nil {
		t.Fatal("expected error when control-plane URL is empty")
	}
	_, err = NewEnrollClient().Enroll(context.Background(), EnrollConfig{ControlPlaneURL: "https://x"})
	if err == nil {
		t.Fatal("expected error when token is empty")
	}
}

func TestIdentityStore_PersistAndReload(t *testing.T) {
	ca := newTestCA(t)
	gk, err := generateKeyAndCSR("persist-agent")
	if err != nil {
		t.Fatalf("gen: %v", err)
	}
	leafPEM, serial := ca.signCSR(t, string(gk.csrPEM))
	id, err := assembleIdentity(enrollResponse{
		CertPEM:    leafPEM,
		CAChainPEM: string(ca.certPEM),
		Serial:     serial,
	}, gk.keyPEM)
	if err != nil {
		t.Fatalf("assemble: %v", err)
	}

	dir := t.TempDir()
	store, err := NewIdentityStore(dir)
	if err != nil {
		t.Fatalf("NewIdentityStore: %v", err)
	}
	if store.Exists() {
		t.Fatal("store should be empty before save")
	}
	if err := store.Save(id); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if !store.Exists() {
		t.Fatal("store should report a valid identity after save")
	}

	// Reopen and reload (process-restart): the identity must come back usable.
	reopened, err := NewIdentityStore(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	loaded, err := reopened.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if loaded == nil {
		t.Fatal("reloaded identity is nil")
	}
	if loaded.Certificate.Leaf == nil {
		t.Fatal("reloaded identity has no parsed leaf")
	}
	roots := x509.NewCertPool()
	roots.AddCert(ca.cert)
	if _, err := loaded.Certificate.Leaf.Verify(x509.VerifyOptions{
		Roots:     roots,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		t.Fatalf("reloaded leaf does not verify: %v", err)
	}
}

func TestIdentityStore_ExistsFalseWhenExpired(t *testing.T) {
	ca := newTestCA(t)
	gk, _ := generateKeyAndCSR("expired-agent")

	// Sign a leaf that is already expired.
	block, _ := pem.Decode(gk.csrPEM)
	csr, _ := x509.ParseCertificateRequest(block.Bytes)
	sn, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	tmpl := &x509.Certificate{
		SerialNumber: sn,
		Subject:      csr.Subject,
		NotBefore:    time.Now().Add(-2 * time.Hour),
		NotAfter:     time.Now().Add(-time.Hour), // expired
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, _ := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, csr.PublicKey, ca.key)
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})

	id, err := assembleIdentity(enrollResponse{CertPEM: string(leafPEM), CAChainPEM: string(ca.certPEM)}, gk.keyPEM)
	if err != nil {
		t.Fatalf("assemble expired: %v", err)
	}
	dir := t.TempDir()
	store, _ := NewIdentityStore(dir)
	if err := store.Save(id); err != nil {
		t.Fatalf("save: %v", err)
	}
	if store.Exists() {
		t.Fatal("Exists must be false for an expired certificate so the agent re-enrolls")
	}
}
