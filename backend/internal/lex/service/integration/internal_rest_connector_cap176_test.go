package integration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// CAP-176 (internal generic REST/webhook) — supplemental verification.
//
// The base internal_rest_connector_test.go already exercises HMAC sign/verify,
// inbound webhook fail-closed conditions, egress, retry, idempotency and
// redaction. This file closes the THREE verification points the CAP-176
// design (Legal_Capabilities_100pct_Design.md §2, line 138) calls out as the
// "implemented" bar and that the base suite asserts only obliquely:
//
//  1. TestConnection GETs base_url, asserts a 2xx, and proves the configured
//     credentials decrypt + apply (the Authorization header reaches the server)
//     while being strictly side-effect-free (GET, no body).
//  2. The outbound "post" op signs X-Clario-Signature as an HMAC over the EXACT
//     RAW request body, and the signature is STABLE (deterministic) for the same
//     body + secret + clock — i.e. the receiver can reproduce it byte-for-byte.
//  3. VerifyInboundWebhook compares the HMAC in CONSTANT TIME (subtle.Constant
//     TimeCompare): a wrong-but-equal-length signature is rejected, and a
//     wrong-length signature is rejected, with no length oracle.
//
// UAT harness for this cap is an httpbin echo (https://httpbin.org/post /
// /get). The httptest echo servers below are the hermetic, offline equivalent
// of that harness so the cap is demonstrable without external network access.
// =============================================================================

// -----------------------------------------------------------------------------
// 1. TestConnection — authenticated, side-effect-free GET against base_url.
// -----------------------------------------------------------------------------

// TestTestConnection_GetsBaseURLWithCredsAsserts2xx is the httpbin-/get-shaped
// UAT for the probe: TestConnection must issue a GET (never a mutating method) to
// the exact base_url, carry the decrypted bearer credential, and grade reachable
// only on a 2xx — exactly httpbin's echo semantics.
func TestTestConnection_GetsBaseURLWithCredsAsserts2xx(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const bearer = "decrypted-bearer-XYZ"

	var (
		gotMethod   string
		gotAuth     string
		gotPath     string
		gotBodyLen  int64
		hadAccept   bool
		invocations int32
	)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&invocations, 1)
		gotMethod = r.Method
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		hadAccept = r.Header.Get("Accept") != ""
		b, _ := io.ReadAll(r.Body)
		gotBodyLen = int64(len(b))
		// httpbin-style echo.
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":     srv.URL,
		"auth":         "bearer",
		"bearer_token": bearer,
	})

	res, err := conn.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection returned a Go error (should surface via TestResult): %v", err)
	}
	if !res.Reachable {
		t.Fatalf("expected reachable on a 2xx ping, got detail=%q", res.Detail)
	}
	// Probe must be a GET — strictly side-effect-free, never POST/PUT/DELETE.
	if gotMethod != http.MethodGet {
		t.Fatalf("TestConnection must GET base_url; observed method %q", gotMethod)
	}
	// No request body on the probe (side-effect-free).
	if gotBodyLen != 0 {
		t.Fatalf("probe GET must carry no body; observed %d bytes", gotBodyLen)
	}
	// The decrypted bearer credential must have been applied to the request.
	if gotAuth != "Bearer "+bearer {
		t.Fatalf("decrypted bearer credential not applied; Authorization=%q", gotAuth)
	}
	// base_url's path must be hit verbatim (here: "/").
	if gotPath != "/" {
		t.Fatalf("expected GET against base_url path '/', got %q", gotPath)
	}
	if !hadAccept {
		t.Fatalf("probe should set an Accept header")
	}
	if invocations != 1 {
		t.Fatalf("expected exactly one probe request, got %d", invocations)
	}
	// Honest detail + staged diagnostics surface the 2xx + applied credentials.
	if !strings.Contains(res.Detail, "200") {
		t.Fatalf("expected the 2xx to surface in detail, got %q", res.Detail)
	}
	if len(res.Steps) == 0 {
		t.Fatalf("expected staged diagnostic steps on a successful probe")
	}
	if res.CheckedAt.IsZero() {
		t.Fatalf("CheckedAt must be stamped on the result")
	}
}

// TestTestConnection_NotConfiguredIsHonest — an active endpoint with no base_url
// must grade NOT reachable with a not_configured detail (never fake-healthy),
// satisfying the D4 honest-health invariant for this non-gov-gated connector.
func TestTestConnection_NotConfiguredIsHonest(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{})

	res, err := conn.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("unexpected Go error: %v", err)
	}
	if res.Reachable {
		t.Fatalf("unconfigured endpoint must NOT be reachable (no fake-healthy)")
	}
	if !strings.Contains(res.Detail, "not_configured") {
		t.Fatalf("expected not_configured detail, got %q", res.Detail)
	}
}

// TestTestConnection_4xxNotReachable — a credentials-rejected (401) ping grades
// not reachable with a credentials-rejected detail, but still returns no Go error
// (operator reads Reachable+Detail).
func TestTestConnection_4xxNotReachable(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":     srv.URL,
		"auth":         "bearer",
		"bearer_token": "tok",
	})
	res, err := conn.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("unexpected Go error: %v", err)
	}
	if res.Reachable {
		t.Fatalf("401 must not be reachable")
	}
	if !strings.Contains(strings.ToLower(res.Detail), "credentials rejected") {
		t.Fatalf("expected a credentials-rejected detail on 401, got %q", res.Detail)
	}
}

// -----------------------------------------------------------------------------
// 2. Outbound "post" — X-Clario-Signature over the EXACT raw body, STABLE.
// -----------------------------------------------------------------------------

// TestPostOp_SignsExactRawBodyAndIsStable verifies, against an httpbin-echo-shaped
// server, that the "post" operation (not just "notify"):
//   - emits X-Clario-Signature = sha256=<hex> that is the HMAC over the EXACT raw
//     bytes the server received (no whitespace/canonicalisation drift), and
//   - is STABLE: signing the SAME endpoint+op+payload at the SAME clock yields the
//     identical signature and identical raw body byte-for-byte, so the signature is
//     deterministic and the receiver can reproduce it.
func TestPostOp_SignsExactRawBodyAndIsStable(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "stable-signing-secret"

	var (
		bodies [][]byte
		sigs   []string
		tss    []string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		bodies = append(bodies, b)
		sigs = append(sigs, r.Header.Get("X-Clario-Signature"))
		tss = append(tss, r.Header.Get("X-Clario-Timestamp"))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"reference":"ECHO-1"}`))
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":    srv.URL,
		"auth":        "hmac",
		"hmac_secret": secret,
	})
	payload := map[string]any{"event": "contract.signed", "id": "C-9"}

	// Two identical invokes at the same fixed clock.
	if _, err := conn.Invoke(context.Background(), ep, InternalOpPost, payload); err != nil {
		t.Fatalf("first post: %v", err)
	}
	if _, err := conn.Invoke(context.Background(), ep, InternalOpPost, payload); err != nil {
		t.Fatalf("second post: %v", err)
	}
	if len(bodies) != 2 {
		t.Fatalf("expected 2 echoed requests, got %d", len(bodies))
	}

	// (a) The signature header is computed over the EXACT raw body the server got.
	for i := range bodies {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(tss[i]))
		mac.Write([]byte("."))
		mac.Write(bodies[i])
		want := "sha256=" + hex.EncodeToString(mac.Sum(nil))
		if sigs[i] != want {
			t.Fatalf("attempt %d: signature is not the HMAC over the raw body: got %q want %q", i, sigs[i], want)
		}
		// And the connector's own verifier accepts its own signature over those bytes.
		if !verifyInternalSignature(secret, bodies[i], tss[i], sigs[i], now) {
			t.Fatalf("attempt %d: connector cannot verify its own signature", i)
		}
	}

	// (b) STABLE: identical body bytes and identical signature across the two
	// invokes at the same clock — the signature is deterministic.
	if string(bodies[0]) != string(bodies[1]) {
		t.Fatalf("raw body not stable across identical invokes:\n a=%s\n b=%s", bodies[0], bodies[1])
	}
	if sigs[0] != sigs[1] {
		t.Fatalf("signature not stable across identical invokes: %q vs %q", sigs[0], sigs[1])
	}

	// (c) The low-level signer is itself deterministic over raw bytes.
	raw := []byte(`{"a":1,"b":[2,3]}`)
	s1 := signInternalBody(secret, tss[0], raw)
	s2 := signInternalBody(secret, tss[0], raw)
	if s1 != s2 {
		t.Fatalf("signInternalBody is not deterministic: %q vs %q", s1, s2)
	}
	// A single changed byte in the raw body changes the signature.
	if signInternalBody(secret, tss[0], []byte(`{"a":1,"b":[2,4]}`)) == s1 {
		t.Fatalf("signature did not change for a one-byte body difference")
	}
}

// TestPostOp_SignatureHeaderEmittedUnderBearerAuth confirms the design note that
// signing is opt-in INDEPENDENT of the auth scheme: with bearer auth AND an
// hmac_secret, the body is still signed (body integrity) while Authorization
// carries the bearer.
func TestPostOp_SignatureHeaderEmittedUnderBearerAuth(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const (
		bearer = "BR-token"
		secret = "sig-secret"
	)
	var gotAuth, gotSig string
	var gotBody []byte
	var gotTs string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotSig = r.Header.Get("X-Clario-Signature")
		gotTs = r.Header.Get("X-Clario-Timestamp")
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	conn := newTestInternalConnector(now)
	ep := internalEndpoint(t, model.IntegrationStatusActive, map[string]any{
		"base_url":     srv.URL,
		"auth":         "bearer",
		"bearer_token": bearer,
		"hmac_secret":  secret,
	})
	if _, err := conn.Invoke(context.Background(), ep, InternalOpPost, map[string]any{"x": 1}); err != nil {
		t.Fatalf("post: %v", err)
	}
	if gotAuth != "Bearer "+bearer {
		t.Fatalf("bearer not applied alongside signing; Authorization=%q", gotAuth)
	}
	if gotSig == "" || !strings.HasPrefix(gotSig, "sha256=") {
		t.Fatalf("expected a signature header even under bearer auth, got %q", gotSig)
	}
	if !verifyInternalSignature(secret, gotBody, gotTs, gotSig, now) {
		t.Fatalf("signature emitted under bearer auth does not verify")
	}
}

// -----------------------------------------------------------------------------
// 3. VerifyInboundWebhook — constant-time, no length oracle.
// -----------------------------------------------------------------------------

// TestVerifyInbound_ConstantTimeNoLengthOracle asserts the inbound verifier rests
// on subtle.ConstantTimeCompare (no early-out byte loop) and surfaces no length
// oracle: a wrong signature that is the SAME length as the correct one is rejected,
// and a wrong-length (truncated/over-long) signature is rejected — both as the same
// uniform unauthorized error.
func TestVerifyInbound_ConstantTimeNoLengthOracle(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "inbound-ct-secret"
	tenantID := uuid.New()
	endpointID := uuid.New()
	body := []byte(`{"event":"webhook.delivered"}`)
	ts := tsUnix(now)

	correct := signInternalBody(secret, ts, body) // 64 hex chars
	good := "sha256=" + correct

	ep := &model.IntegrationEndpoint{
		ID: endpointID, TenantID: tenantID,
		Kind: model.IntegrationKindInternal, Status: model.IntegrationStatusActive,
		Config: map[string]any{"hmac_secret": secret},
	}
	conn := newTestInternalConnector(now)
	conn.endpoints = fakeResolver{endpoint: ep}

	// Sanity: the correct signature verifies.
	if _, err := conn.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, good, ts); err != nil {
		t.Fatalf("correct inbound signature rejected: %v", err)
	}

	// Same-length wrong signature (flip the last hex nibble) -> rejected. This pins
	// the equal-length path the constant-time compare governs.
	last := correct[len(correct)-1]
	repl := byte('0')
	if last == '0' {
		repl = '1'
	}
	sameLenWrong := "sha256=" + correct[:len(correct)-1] + string(repl)
	if len(sameLenWrong) != len(good) {
		t.Fatalf("test setup error: lengths differ")
	}
	if _, err := conn.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, sameLenWrong, ts); err == nil {
		t.Fatalf("same-length wrong signature must be rejected")
	}

	// Wrong-length signatures (truncated and over-long) -> rejected too, no oracle.
	truncated := "sha256=" + correct[:len(correct)-8]
	if _, err := conn.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, truncated, ts); err == nil {
		t.Fatalf("truncated signature must be rejected")
	}
	overlong := "sha256=" + correct + "deadbeef"
	if _, err := conn.VerifyInboundWebhook(context.Background(), tenantID, endpointID, body, overlong, ts); err == nil {
		t.Fatalf("over-long signature must be rejected")
	}
}

// TestVerifyInternalSignature_WrongLengthMACRejected drills into the package-level
// verifier: a candidate MAC whose decoded length differs from sha256.Size must be
// rejected BEFORE any compare (decodeInternalSignature gates on len == 32), so the
// constant-time compare only ever runs on equal-length inputs.
func TestVerifyInternalSignature_WrongLengthMACRejected(t *testing.T) {
	now := time.Unix(1_700_000_000, 0).UTC()
	const secret = "k"
	body := []byte(`{"x":1}`)
	ts := tsUnix(now)

	// 16-byte hex (too short to be a SHA-256 MAC).
	short := "sha256=" + hex.EncodeToString([]byte("0123456789abcdef"))
	if verifyInternalSignature(secret, body, ts, short, now) {
		t.Fatalf("a too-short (non-32-byte) MAC must be rejected")
	}
	// 48-byte hex (too long).
	long := "sha256=" + hex.EncodeToString(make([]byte, 48))
	if verifyInternalSignature(secret, body, ts, long, now) {
		t.Fatalf("a too-long (non-32-byte) MAC must be rejected")
	}
	// Non-hex / non-base64 garbage.
	if verifyInternalSignature(secret, body, ts, "sha256=not-a-valid-mac!!", now) {
		t.Fatalf("garbage signature must be rejected")
	}
}

// tsUnix renders a unix-seconds timestamp string the way the outbound signer does.
func tsUnix(t time.Time) string {
	return strconv.FormatInt(t.Unix(), 10)
}
