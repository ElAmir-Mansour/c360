package agent

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	certFileName  = "agent-cert.pem"
	keyFileName   = "agent-key.pem"
	caFileName    = "ca-chain.pem"
	enrollSubPath = "/api/v1/dr/agents/enroll"
)

// Identity is the agent's enrolled mTLS material: the leaf certificate and its
// private key (a tls.Certificate ready to dial the ingest listener) plus the CA
// chain that anchors trust in the control-plane server certificate.
type Identity struct {
	// Certificate is the leaf cert + private key for mTLS client auth.
	Certificate tls.Certificate
	// LeafPEM/KeyPEM/CAChainPEM are the on-disk-persisted PEM blocks.
	LeafPEM    []byte
	KeyPEM     []byte
	CAChainPEM []byte
	// Serial / NotAfter come from the issued leaf for renewal scheduling.
	Serial    string
	NotAfter  time.Time
	NotBefore time.Time
}

// generatedKey is a freshly generated keypair plus the CSR PEM the agent sends
// to the control plane. The private key never leaves the agent.
type generatedKey struct {
	priv   *ecdsa.PrivateKey
	keyPEM []byte
	csrPEM []byte
}

// generateKeyAndCSR creates a P-256 keypair and a PKCS#10 CSR bound to
// commonName (the agent id). The control-plane PKI fills in the real cert
// subject/SANs; the CSR's subject is advisory.
func generateKeyAndCSR(commonName string) (*generatedKey, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("agent: generate keypair: %w", err)
	}
	keyDER, err := x509.MarshalECPrivateKey(priv)
	if err != nil {
		return nil, fmt.Errorf("agent: marshal private key: %w", err)
	}
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	tmpl := &x509.CertificateRequest{
		Subject:            pkix.Name{CommonName: commonName},
		SignatureAlgorithm: x509.ECDSAWithSHA256,
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, tmpl, priv)
	if err != nil {
		return nil, fmt.Errorf("agent: create CSR: %w", err)
	}
	csrPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER})
	return &generatedKey{priv: priv, keyPEM: keyPEM, csrPEM: csrPEM}, nil
}

// enrollResponse mirrors the control-plane enroll endpoint payload (the SIEM/DR
// exchange output). It is wrapped by the suiteapi data envelope.
type enrollResponse struct {
	CertPEM    string `json:"cert_pem"`
	CAChainPEM string `json:"ca_chain_pem"`
	Serial     string `json:"serial"`
	ExpiresAt  string `json:"expires_at"`
	AgentID    string `json:"agent_id"`
	TenantID   string `json:"tenant_id"`
	SiteID     string `json:"site_id,omitempty"`
}

type enrollEnvelope struct {
	Data  enrollResponse `json:"data"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// EnrollConfig is the input to a single enrollment exchange.
type EnrollConfig struct {
	// ControlPlaneURL is the base URL of the DR control-plane HTTP API (the
	// public, token-authenticated enrollment endpoint is reachable here). It must
	// include scheme, e.g. https://dr.control-plane:8097.
	ControlPlaneURL string
	// Token is the single-use enrollment JWT minted by the control plane for this
	// agent.
	Token string
	// AgentID is the dr_agent.id this agent enrolls as; it becomes the CSR common
	// name. The control plane authoritatively binds the cert to the token's
	// subject, so this is advisory but recorded.
	AgentID string
	// TenantID / SiteID are optional assertions echoed to the enroll endpoint for
	// an early mismatch check (the token remains authoritative).
	TenantID string
	SiteID   string
	// CABundlePEM, when set, anchors trust in the control-plane HTTPS endpoint for
	// the enrollment call itself (before the agent has the issued CA chain). When
	// empty the default system roots are used.
	CABundlePEM []byte
	// HTTPClient overrides the client used for the exchange (tests inject one).
	HTTPClient *http.Client
}

// EnrollClient performs the agent-side enrollment exchange against the control
// plane: it generates a keypair + CSR, posts the CSR with the single-use token
// to the enroll endpoint, and parses the issued leaf + CA chain into an
// Identity. It does not persist anything; persistence is the Store's job so the
// two concerns (network exchange vs durable storage) stay testable in isolation.
type EnrollClient struct{}

// NewEnrollClient constructs an EnrollClient.
func NewEnrollClient() *EnrollClient { return &EnrollClient{} }

// Enroll runs the full CSR -> leaf-cert exchange and returns the assembled mTLS
// Identity. The returned Identity's private key is the one just generated, so
// the leaf and key always match.
func (c *EnrollClient) Enroll(ctx context.Context, cfg EnrollConfig) (*Identity, error) {
	if strings.TrimSpace(cfg.ControlPlaneURL) == "" {
		return nil, errors.New("agent: enroll requires a control-plane URL")
	}
	if strings.TrimSpace(cfg.Token) == "" {
		return nil, errors.New("agent: enroll requires an enrollment token")
	}
	cn := cfg.AgentID
	if cn == "" {
		cn = "clario-dr-agent"
	}
	gk, err := generateKeyAndCSR(cn)
	if err != nil {
		return nil, err
	}

	body, err := json.Marshal(map[string]string{
		"token":     cfg.Token,
		"csr_pem":   string(gk.csrPEM),
		"tenant_id": cfg.TenantID,
		"site_id":   cfg.SiteID,
	})
	if err != nil {
		return nil, fmt.Errorf("agent: marshal enroll request: %w", err)
	}

	endpoint := strings.TrimRight(cfg.ControlPlaneURL, "/") + enrollSubPath
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("agent: build enroll request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := cfg.HTTPClient
	if client == nil {
		client, err = enrollHTTPClient(cfg.CABundlePEM)
		if err != nil {
			return nil, err
		}
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("agent: enroll exchange to %s: %w", endpoint, err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("agent: read enroll response: %w", err)
	}

	var env enrollEnvelope
	if uerr := json.Unmarshal(raw, &env); uerr != nil {
		return nil, fmt.Errorf("agent: parse enroll response (status %d): %w: %s", resp.StatusCode, uerr, truncate(raw, 256))
	}
	if resp.StatusCode != http.StatusOK {
		if env.Error != nil {
			return nil, fmt.Errorf("agent: enroll rejected (status %d, code %s): %s", resp.StatusCode, env.Error.Code, env.Error.Message)
		}
		return nil, fmt.Errorf("agent: enroll rejected (status %d): %s", resp.StatusCode, truncate(raw, 256))
	}
	if env.Data.CertPEM == "" {
		return nil, fmt.Errorf("agent: enroll response missing cert_pem (status %d)", resp.StatusCode)
	}

	identity, err := assembleIdentity(env.Data, gk.keyPEM)
	if err != nil {
		return nil, err
	}
	return identity, nil
}

// assembleIdentity builds a tls.Certificate from the issued leaf PEM and the
// agent's private key PEM, and parses the leaf for serial/validity metadata.
func assembleIdentity(data enrollResponse, keyPEM []byte) (*Identity, error) {
	leafPEM := []byte(data.CertPEM)
	// The leaf alone is enough for the client certificate; including the CA chain
	// in the cert PEM lets servers that need it build a path, so concatenate when
	// the issuer chain is present.
	fullChainPEM := leafPEM
	if data.CAChainPEM != "" {
		fullChainPEM = append(append([]byte(nil), leafPEM...), []byte("\n"+data.CAChainPEM)...)
	}

	tlsCert, err := tls.X509KeyPair(fullChainPEM, keyPEM)
	if err != nil {
		return nil, fmt.Errorf("agent: assemble client keypair: %w", err)
	}
	leaf, err := leafFromPEM(leafPEM)
	if err != nil {
		return nil, err
	}
	tlsCert.Leaf = leaf

	notAfter := leaf.NotAfter
	if data.ExpiresAt != "" {
		if t, perr := time.Parse(time.RFC3339, data.ExpiresAt); perr == nil {
			notAfter = t
		}
	}

	return &Identity{
		Certificate: tlsCert,
		LeafPEM:     leafPEM,
		KeyPEM:      keyPEM,
		CAChainPEM:  []byte(data.CAChainPEM),
		Serial:      data.Serial,
		NotAfter:    notAfter,
		NotBefore:   leaf.NotBefore,
	}, nil
}

func leafFromPEM(leafPEM []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(leafPEM)
	if block == nil {
		return nil, errors.New("agent: issued leaf is not valid PEM")
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("agent: parse issued leaf: %w", err)
	}
	return leaf, nil
}

// enrollHTTPClient builds an HTTP client trusting caBundlePEM for the control
// plane's HTTPS endpoint (or the system roots when empty).
func enrollHTTPClient(caBundlePEM []byte) (*http.Client, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if len(caBundlePEM) > 0 {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caBundlePEM) {
			return nil, errors.New("agent: enroll CA bundle has no PEM certificates")
		}
		tlsCfg.RootCAs = pool
	}
	return &http.Client{
		Timeout:   30 * time.Second,
		Transport: &http.Transport{TLSClientConfig: tlsCfg},
	}, nil
}

// IdentityStore persists and loads the agent's enrolled mTLS material so a
// restart reuses an already-issued certificate instead of re-enrolling.
type IdentityStore struct {
	dir string
}

// NewIdentityStore roots the identity store at baseDir (created if absent). The
// cert/key/CA files live directly under baseDir alongside the checkpoint cache
// subdirectory.
func NewIdentityStore(baseDir string) (*IdentityStore, error) {
	if baseDir == "" {
		return nil, errors.New("agent: identity store requires a base directory")
	}
	if err := os.MkdirAll(baseDir, 0o700); err != nil {
		return nil, fmt.Errorf("agent: create identity store %s: %w", baseDir, err)
	}
	return &IdentityStore{dir: baseDir}, nil
}

// Exists reports whether a previously persisted, currently-valid identity is
// present on disk. A cert that is missing, unreadable, or expired returns false
// so the runtime re-enrolls.
func (s *IdentityStore) Exists() bool {
	id, err := s.Load()
	if err != nil || id == nil {
		return false
	}
	if !id.NotAfter.IsZero() && time.Now().UTC().After(id.NotAfter) {
		return false
	}
	return true
}

// Load reads the persisted identity. A missing cert/key returns (nil, nil) so
// the caller knows it must enroll.
func (s *IdentityStore) Load() (*Identity, error) {
	leafPEM, err := os.ReadFile(filepath.Join(s.dir, certFileName))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("agent: read persisted cert: %w", err)
	}
	keyPEM, err := os.ReadFile(filepath.Join(s.dir, keyFileName))
	if err != nil {
		return nil, fmt.Errorf("agent: read persisted key: %w", err)
	}
	caPEM, err := os.ReadFile(filepath.Join(s.dir, caFileName))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("agent: read persisted CA chain: %w", err)
	}

	fullChain := leafPEM
	if len(caPEM) > 0 {
		fullChain = append(append([]byte(nil), leafPEM...), append([]byte("\n"), caPEM...)...)
	}
	tlsCert, err := tls.X509KeyPair(fullChain, keyPEM)
	if err != nil {
		return nil, fmt.Errorf("agent: load persisted keypair: %w", err)
	}
	leaf, err := leafFromPEM(leafPEM)
	if err != nil {
		return nil, err
	}
	tlsCert.Leaf = leaf
	return &Identity{
		Certificate: tlsCert,
		LeafPEM:     leafPEM,
		KeyPEM:      keyPEM,
		CAChainPEM:  caPEM,
		Serial:      leaf.SerialNumber.String(),
		NotAfter:    leaf.NotAfter,
		NotBefore:   leaf.NotBefore,
	}, nil
}

// Save atomically persists the identity's cert, key, and CA chain. The private
// key file is written 0600; the cert/CA 0644.
func (s *IdentityStore) Save(id *Identity) error {
	if id == nil {
		return errors.New("agent: cannot persist a nil identity")
	}
	if len(id.LeafPEM) == 0 || len(id.KeyPEM) == 0 {
		return errors.New("agent: identity is missing cert or key PEM")
	}
	if err := writeFileAtomic(filepath.Join(s.dir, keyFileName), id.KeyPEM, 0o600); err != nil {
		return err
	}
	if err := writeFileAtomic(filepath.Join(s.dir, certFileName), id.LeafPEM, 0o644); err != nil {
		return err
	}
	if len(id.CAChainPEM) > 0 {
		if err := writeFileAtomic(filepath.Join(s.dir, caFileName), id.CAChainPEM, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// writeFileAtomic writes data to path via a temp file + rename so a crash can
// never leave a half-written cert or key on disk.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return fmt.Errorf("agent: create temp %s: %w", path, err)
	}
	tmpName := tmp.Name()
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.Remove(tmpName)
		}
	}()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("agent: write temp %s: %w", path, err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("agent: sync temp %s: %w", path, err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("agent: close temp %s: %w", path, err)
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		return fmt.Errorf("agent: chmod temp %s: %w", path, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("agent: publish %s: %w", path, err)
	}
	cleanup = false
	return nil
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "..."
}
