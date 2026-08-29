package vault

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakePKI is an httptest mock of the subset of Vault PKI HTTP API we use.
type fakePKI struct {
	mu              sync.Mutex
	server          *httptest.Server
	mounts          map[string]string // mountPath/ -> type
	rootCA          map[string]string // mountPath -> pem
	intermediateCSR map[string]string // mountPath -> last csr
	intermediateCA  map[string]string // mountPath -> pem
	roles           map[string]map[string]any
	leafIssued      int32
	leafRevoked     int32
	nextSerial      int32
	rootSignFail    bool
	leafSignFail    bool
}

func newFakePKI(t *testing.T) *fakePKI {
	t.Helper()
	fp := &fakePKI{
		mounts:          make(map[string]string),
		rootCA:          make(map[string]string),
		intermediateCSR: make(map[string]string),
		intermediateCA:  make(map[string]string),
		roles:           make(map[string]map[string]any),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/sys/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"initialized":true,"sealed":false,"standby":false}`))
	})
	mux.HandleFunc("/v1/sys/mounts", fp.handleMountsList)
	mux.HandleFunc("/v1/sys/mounts/", fp.handleMounts)
	mux.HandleFunc("/v1/", fp.handlePKI)
	fp.server = httptest.NewServer(mux)
	t.Cleanup(fp.server.Close)
	return fp
}

func (f *fakePKI) URL() string { return f.server.URL }

func (f *fakePKI) handleMountsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method", http.StatusMethodNotAllowed)
		return
	}
	f.mu.Lock()
	data := map[string]any{}
	for path, kind := range f.mounts {
		data[path] = map[string]any{"type": kind}
	}
	f.mu.Unlock()
	// Vault returns the mount table inside "data" + at the top level depending on version.
	_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
}

func (f *fakePKI) handleMounts(w http.ResponseWriter, r *http.Request) {
	// path: /v1/sys/mounts/<mountPath>
	mp := strings.TrimPrefix(r.URL.Path, "/v1/sys/mounts/")
	mp = strings.Trim(mp, "/")
	switch r.Method {
	case http.MethodPost, http.MethodPut:
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		typ, _ := body["type"].(string)
		f.mu.Lock()
		f.mounts[mp+"/"] = typ
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	default:
		http.Error(w, "method", http.StatusMethodNotAllowed)
	}
}

// handlePKI is the catch-all for /v1/<mount>/<sub...>.
func (f *fakePKI) handlePKI(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/v1/")
	parts := strings.SplitN(rel, "/", 2)
	if len(parts) < 2 {
		http.NotFound(w, r)
		return
	}
	mount, sub := parts[0], parts[1]

	switch {
	case sub == "ca/pem" && r.Method == http.MethodGet:
		f.mu.Lock()
		pem := f.rootCA[mount]
		if pem == "" {
			pem = f.intermediateCA[mount]
		}
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/pkix-cert")
		_, _ = w.Write([]byte(pem))
	case sub == "root/generate/internal" && (r.Method == http.MethodPost || r.Method == http.MethodPut):
		f.mu.Lock()
		// Idempotency check at the service layer means we should only get here when no root yet.
		if existing := f.rootCA[mount]; existing != "" {
			f.mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"certificate": existing}})
			return
		}
		pem := fmt.Sprintf("-----BEGIN CERTIFICATE-----\nROOT-%s\n-----END CERTIFICATE-----", mount)
		f.rootCA[mount] = pem
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"certificate": pem}})
	case sub == "intermediate/generate/internal" && (r.Method == http.MethodPost || r.Method == http.MethodPut):
		csr := fmt.Sprintf("-----BEGIN CERTIFICATE REQUEST-----\nCSR-%s\n-----END CERTIFICATE REQUEST-----", mount)
		f.mu.Lock()
		f.intermediateCSR[mount] = csr
		f.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"csr": csr}})
	case sub == "root/sign-intermediate" && (r.Method == http.MethodPost || r.Method == http.MethodPut):
		f.mu.Lock()
		fail := f.rootSignFail
		f.mu.Unlock()
		if fail {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"errors":["denied"]}`))
			return
		}
		// Derive intermediate identifier from the most recent CSR we generated; mock pins
		// the signed cert to whichever intermediate mount called /generate/internal last.
		f.mu.Lock()
		var lastInter string
		for k := range f.intermediateCSR {
			lastInter = k
		}
		f.mu.Unlock()
		if lastInter == "" {
			lastInter = mount
		}
		pem := fmt.Sprintf("-----BEGIN CERTIFICATE-----\nINTER-%s\n-----END CERTIFICATE-----", lastInter)
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"certificate": pem}})
	case sub == "intermediate/set-signed" && (r.Method == http.MethodPost || r.Method == http.MethodPut):
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		cert, _ := body["certificate"].(string)
		f.mu.Lock()
		f.intermediateCA[mount] = cert
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	case strings.HasPrefix(sub, "roles/") && (r.Method == http.MethodPost || r.Method == http.MethodPut):
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		role := strings.TrimPrefix(sub, "roles/")
		f.mu.Lock()
		f.roles[mount+"/"+role] = body
		f.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	case strings.HasPrefix(sub, "sign/") && (r.Method == http.MethodPost || r.Method == http.MethodPut):
		f.mu.Lock()
		fail := f.leafSignFail
		f.mu.Unlock()
		if fail {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`{"errors":["denied"]}`))
			return
		}
		atomic.AddInt32(&f.leafIssued, 1)
		serial := fmt.Sprintf("aa:bb:cc:%02x", atomic.AddInt32(&f.nextSerial, 1))
		certPEM := fmt.Sprintf("-----BEGIN CERTIFICATE-----\nLEAF-%s\n-----END CERTIFICATE-----", serial)
		caPEM := fmt.Sprintf("-----BEGIN CERTIFICATE-----\nCA-%s\n-----END CERTIFICATE-----", mount)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": map[string]any{
				"certificate":   certPEM,
				"issuing_ca":    caPEM,
				"ca_chain":      []any{caPEM},
				"serial_number": serial,
				"expiration":    float64(time.Now().Add(8760 * time.Hour).Unix()),
			},
		})
	case sub == "revoke" && (r.Method == http.MethodPost || r.Method == http.MethodPut):
		atomic.AddInt32(&f.leafRevoked, 1)
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"revocation_time": time.Now().Unix()}})
	default:
		http.NotFound(w, r)
	}
}

func newPKIClient(t *testing.T, fp *fakePKI) Client {
	t.Helper()
	c, err := NewClient(context.Background(), devConfig(fp.URL()))
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// -------- tests --------

func TestEnsurePKIMount_CreatesAndIsIdempotent(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()

	if err := c.EnsurePKIMount(ctx, "pki-siem-root", time.Hour, 10*time.Hour); err != nil {
		t.Fatalf("first call: %v", err)
	}
	if err := c.EnsurePKIMount(ctx, "pki-siem-root", time.Hour, 10*time.Hour); err != nil {
		t.Fatalf("second call (idempotent): %v", err)
	}
	fp.mu.Lock()
	defer fp.mu.Unlock()
	if fp.mounts["pki-siem-root/"] != "pki" {
		t.Errorf("expected mount recorded as pki, got %q", fp.mounts["pki-siem-root/"])
	}
}

func TestEnsurePKIMount_RejectsBadInputs(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()

	cases := []struct {
		name               string
		mount              string
		defaultTTL, maxTTL time.Duration
	}{
		{"empty_mount", "", time.Hour, time.Hour},
		{"zero_default_ttl", "pki", 0, time.Hour},
		{"zero_max_ttl", "pki", time.Hour, 0},
		{"max_less_than_default", "pki", 10 * time.Hour, time.Hour},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if err := c.EnsurePKIMount(ctx, tc.mount, tc.defaultTTL, tc.maxTTL); err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}

func TestEnsurePKIMount_RejectsExistingNonPKIType(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	fp.mu.Lock()
	fp.mounts["pki-siem-root/"] = "kv"
	fp.mu.Unlock()
	c := newPKIClient(t, fp)
	if err := c.EnsurePKIMount(context.Background(), "pki-siem-root", time.Hour, 10*time.Hour); err == nil {
		t.Fatal("expected error for non-pki mount conflict")
	}
}

func TestGenerateRootCA_IdempotentReturnsExisting(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()

	pem1, err := c.GenerateRootCA(ctx, "pki-siem-root", "Clario360 SIEM Root CA", 10*time.Hour)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	pem2, err := c.GenerateRootCA(ctx, "pki-siem-root", "Clario360 SIEM Root CA", 10*time.Hour)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if pem1 != pem2 || pem1 == "" {
		t.Errorf("expected idempotent PEM; got %q vs %q", pem1, pem2)
	}
	if !strings.Contains(pem1, "BEGIN CERTIFICATE") {
		t.Errorf("expected PEM content, got %q", pem1)
	}
}

func TestGenerateRootCA_RejectsBadInputs(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()

	if _, err := c.GenerateRootCA(ctx, "", "cn", time.Hour); err == nil {
		t.Error("expected error for empty mount")
	}
	if _, err := c.GenerateRootCA(ctx, "pki", "", time.Hour); err == nil {
		t.Error("expected error for empty common name")
	}
	if _, err := c.GenerateRootCA(ctx, "pki", "cn", 0); err == nil {
		t.Error("expected error for zero ttl")
	}
}

func TestEnsureIntermediate_FullFlow(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()

	if _, err := c.GenerateRootCA(ctx, "pki-siem-root", "Clario360 SIEM Root CA", 10*time.Hour); err != nil {
		t.Fatalf("root: %v", err)
	}
	pem1, err := c.EnsureIntermediate(ctx, "pki-siem-root", "pki-siem-intermediate-t1", "Tenant T1 Intermediate", 5*time.Hour)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if !strings.Contains(pem1, "INTER-pki-siem-intermediate-t1") {
		t.Errorf("expected intermediate PEM in chain, got %q", pem1)
	}
	if !strings.Contains(pem1, "ROOT-pki-siem-root") {
		t.Errorf("expected root PEM appended to chain, got %q", pem1)
	}
	// Second call must be idempotent — returns existing intermediate.
	pem2, err := c.EnsureIntermediate(ctx, "pki-siem-root", "pki-siem-intermediate-t1", "Tenant T1 Intermediate", 5*time.Hour)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if pem2 == "" {
		t.Errorf("expected non-empty intermediate PEM on idempotent call")
	}
}

func TestEnsureIntermediate_RootSignFails(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	fp.rootSignFail = true
	c := newPKIClient(t, fp)
	ctx := context.Background()
	if _, err := c.GenerateRootCA(ctx, "pki-siem-root", "cn", 10*time.Hour); err != nil {
		t.Fatalf("root: %v", err)
	}
	if _, err := c.EnsureIntermediate(ctx, "pki-siem-root", "pki-int", "cn", time.Hour); err == nil {
		t.Fatal("expected error when root sign fails")
	}
}

func TestEnsureIntermediate_RejectsBadInputs(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()
	cases := []struct {
		root, inter, cn string
		ttl             time.Duration
	}{
		{"", "i", "cn", time.Hour},
		{"r", "", "cn", time.Hour},
		{"r", "i", "", time.Hour},
		{"r", "i", "cn", 0},
	}
	for i, tc := range cases {
		if _, err := c.EnsureIntermediate(ctx, tc.root, tc.inter, tc.cn, tc.ttl); err == nil {
			t.Errorf("case %d: expected error", i)
		}
	}
}

func TestEnsurePKIRole_HappyPath(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()
	settings := PKIRoleSettings{
		AllowedDomains:   []string{"collectors.siem.t1.clario360.local"},
		AllowSubdomains:  true,
		AllowBareDomains: true,
		KeyType:          "ec",
		KeyBits:          256,
		MaxTTL:           8784 * time.Hour,
		DefaultTTL:       8760 * time.Hour,
		ClientFlag:       true,
		ServerFlag:       false,
	}
	if err := c.EnsurePKIRole(ctx, "pki-int-t1", "collector-leaf", settings); err != nil {
		t.Fatalf("first call: %v", err)
	}
	if err := c.EnsurePKIRole(ctx, "pki-int-t1", "collector-leaf", settings); err != nil {
		t.Fatalf("idempotent call: %v", err)
	}
	fp.mu.Lock()
	defer fp.mu.Unlock()
	body, ok := fp.roles["pki-int-t1/collector-leaf"]
	if !ok {
		t.Fatal("role not recorded")
	}
	if body["key_type"] != "ec" {
		t.Errorf("expected key_type=ec, got %v", body["key_type"])
	}
	if body["client_flag"] != true {
		t.Errorf("expected client_flag=true")
	}
}

func TestEnsurePKIRole_RejectsBadInputs(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()
	good := PKIRoleSettings{KeyType: "ec", KeyBits: 256, MaxTTL: time.Hour, DefaultTTL: time.Hour}

	if err := c.EnsurePKIRole(ctx, "", "r", good); err == nil {
		t.Error("expected error empty mount")
	}
	if err := c.EnsurePKIRole(ctx, "m", "", good); err == nil {
		t.Error("expected error empty role")
	}
	bad := good
	bad.KeyType = ""
	if err := c.EnsurePKIRole(ctx, "m", "r", bad); err == nil {
		t.Error("expected error empty key_type")
	}
	bad = good
	bad.KeyBits = 0
	if err := c.EnsurePKIRole(ctx, "m", "r", bad); err == nil {
		t.Error("expected error zero key_bits")
	}
	bad = good
	bad.MaxTTL = 0
	if err := c.EnsurePKIRole(ctx, "m", "r", bad); err == nil {
		t.Error("expected error zero MaxTTL")
	}
}

func TestIssueLeaf_HappyPath(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()
	csr := "-----BEGIN CERTIFICATE REQUEST-----\nFAKE\n-----END CERTIFICATE REQUEST-----"
	leaf, err := c.IssueLeaf(ctx, "pki-int-t1", "collector-leaf", csr, "source-id", time.Hour)
	if err != nil {
		t.Fatalf("IssueLeaf: %v", err)
	}
	if !strings.Contains(leaf.CertPEM, "BEGIN CERTIFICATE") {
		t.Errorf("expected cert PEM, got %q", leaf.CertPEM)
	}
	if leaf.Serial == "" {
		t.Errorf("expected serial number")
	}
	if leaf.CAChainPEM == "" {
		t.Errorf("expected ca chain")
	}
	if leaf.NotAfter.IsZero() {
		t.Errorf("expected non-zero NotAfter")
	}
}

func TestIssueLeaf_RejectsBadInputs(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()

	cases := []struct {
		mount, role, csr, cn string
		ttl                  time.Duration
	}{
		{"", "r", "csr", "cn", time.Hour},
		{"m", "", "csr", "cn", time.Hour},
		{"m", "r", "", "cn", time.Hour},
		{"m", "r", "csr", "", time.Hour},
		{"m", "r", "csr", "cn", 0},
	}
	for i, tc := range cases {
		if _, err := c.IssueLeaf(ctx, tc.mount, tc.role, tc.csr, tc.cn, tc.ttl); err == nil {
			t.Errorf("case %d: expected error", i)
		}
	}
}

func TestIssueLeaf_Failure(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	fp.leafSignFail = true
	c := newPKIClient(t, fp)
	csr := "-----BEGIN CERTIFICATE REQUEST-----\nFAKE\n-----END CERTIFICATE REQUEST-----"
	_, err := c.IssueLeaf(context.Background(), "pki", "role", csr, "cn", time.Hour)
	if err == nil {
		t.Fatal("expected error on sign failure")
	}
	if !errors.Is(err, ErrTransitDenied) {
		t.Errorf("expected ErrTransitDenied, got %v", err)
	}
}

func TestRevokeLeaf_Idempotent(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	ctx := context.Background()
	if err := c.RevokeLeaf(ctx, "pki-int-t1", "aa:bb:cc:01"); err != nil {
		t.Fatalf("first revoke: %v", err)
	}
	if err := c.RevokeLeaf(ctx, "pki-int-t1", "aa:bb:cc:01"); err != nil {
		t.Fatalf("second revoke (idempotent): %v", err)
	}
	if atomic.LoadInt32(&fp.leafRevoked) != 2 {
		t.Errorf("expected 2 revoke calls, got %d", fp.leafRevoked)
	}
}

func TestRevokeLeaf_RejectsBadInputs(t *testing.T) {
	t.Parallel()
	fp := newFakePKI(t)
	c := newPKIClient(t, fp)
	if err := c.RevokeLeaf(context.Background(), "", "s"); err == nil {
		t.Error("expected error empty mount")
	}
	if err := c.RevokeLeaf(context.Background(), "m", ""); err == nil {
		t.Error("expected error empty serial")
	}
}

func TestPemList_Variants(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   any
		want string
	}{
		{nil, ""},
		{"hello", "hello"},
		{"  multi  ", "multi"},
		{[]any{"a", "b"}, "a\nb"},
		{[]any{"", "c"}, "c"},
		{42, ""},
	}
	for i, tc := range cases {
		if got := pemList(tc.in); got != tc.want {
			t.Errorf("case %d: got %q want %q", i, got, tc.want)
		}
	}
}

func TestPkiExpiration_Variants(t *testing.T) {
	t.Parallel()
	now := time.Now().Unix()
	cases := []struct {
		in   map[string]interface{}
		zero bool
	}{
		{map[string]interface{}{}, true},
		{map[string]interface{}{"expiration": float64(now)}, false},
		{map[string]interface{}{"expiration": int64(now)}, false},
		{map[string]interface{}{"expiration": int(now)}, false},
		{map[string]interface{}{"expiration": json.Number(fmt.Sprintf("%d", now))}, false},
		{map[string]interface{}{"expiration": "garbage"}, true},
		{map[string]interface{}{"expiration": float64(0)}, true},
	}
	for i, tc := range cases {
		got := pkiExpiration(tc.in)
		if got.IsZero() != tc.zero {
			t.Errorf("case %d: want zero=%v got %v", i, tc.zero, got)
		}
	}
}

// pkiMountPath has its own unit so we keep it covered even when other tests churn.
func TestPkiMountPath(t *testing.T) {
	t.Parallel()
	cases := []struct {
		mount, sub, want string
	}{
		{"pki", "issue/role", "pki/issue/role"},
		{"/pki/", "/issue/role/", "pki/issue/role"},
		{"pki-siem-root", "ca/pem", "pki-siem-root/ca/pem"},
	}
	for _, tc := range cases {
		if got := pkiMountPath(tc.mount, tc.sub); got != tc.want {
			t.Errorf("pkiMountPath(%q,%q)=%q want %q", tc.mount, tc.sub, got, tc.want)
		}
	}
}
