//go:build integration

package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// WS6 — intake email webhook security acceptance.
//
// The email webhook (IngestEmail) is the only UNTRUSTED surface in lex: it is
// registered OUTSIDE the JWT/TenantGuard chain and carries no bearer token and
// no tenant context. Its sole authentication is the HMAC-SHA256 signature header
// verified against the addressed mailbox's ingest secret, before any
// mailbox/tenant detail leaks. These tests pin that contract end-to-end against
// the real app + migrations:
//
//   - a valid HMAC accepts (202) and creates a routed intake message + request;
//   - a forged signature is rejected (401);
//   - a stale timestamp (outside the replay tolerance) is rejected (401);
//   - an unknown mailbox returns the SAME uniform 401 as a bad signature, with
//     no entity-existence oracle (no 404, identical code/message);
//   - a duplicate Message-ID is idempotent (same message id, no second request);
//   - a mailbox secret of tenant A cannot intake into tenant B's mailbox
//     (cross-tenant isolation: the secret only verifies for its own mailbox).

const (
	intakeWebhookLexPath     = "/api/v1/lex/intake/email/webhook"
	intakeWebhookWatheeqPath = "/api/v1/watheeq/intake/email/webhook"
)

// uniqueMailboxAddress returns a fresh, lowercase intake address. Mailboxes are
// resolved globally by address (RLS-bypass system read), so each test must use a
// distinct address to stay isolated from sibling tests sharing the container.
func uniqueMailboxAddress(prefix string) string {
	return fmt.Sprintf("%s+%s@intake.clario.test", prefix, uuid.NewString())
}

// createIntakeMailbox registers an active mailbox owned by the harness tenant and
// returns it. The plaintext ingest secret is what the webhook HMAC is keyed by.
func createIntakeMailbox(t *testing.T, h *lexHarness, address, requestType, secret string) model.IntakeMailbox {
	t.Helper()
	req := dto.CreateIntakeMailboxRequest{
		Address:      address,
		RequestType:  requestType,
		IngestSecret: secret,
	}
	return mustData[model.IntakeMailbox](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/intake/mailboxes", req), http.StatusCreated)
}

// signIntakeBody returns the lowercase hex HMAC-SHA256 over (timestamp + "." +
// rawBody) keyed by secret — the exact construction verifyIntakeSignature checks.
func signIntakeBody(secret string, rawBody []byte, timestamp string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(rawBody)
	return hex.EncodeToString(mac.Sum(nil))
}

// postIntakeWebhook POSTs an UNAUTHENTICATED webhook delivery. It deliberately
// does NOT use h.doJSON (which attaches the bearer token): the public webhook
// must work — and be authenticated — with no JWT. The signature is computed over
// the EXACT marshalled bytes that are sent, mirroring the handler reading the raw
// body before decoding. A blank signature/timestamp is sent only when asked.
func postIntakeWebhook(t *testing.T, h *lexHarness, path, secret string, payload dto.IntakeEmailWebhookRequest, timestamp string, forgeSignature bool) *http.Response {
	t.Helper()
	rawBody, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal webhook payload: %v", err)
	}

	signature := ""
	if timestamp != "" {
		signature = signIntakeBody(secret, rawBody, timestamp)
		if forgeSignature {
			// Flip the signature to a same-length but wrong value: keep the shape
			// valid (decodes to 32 bytes) so the rejection is on hmac.Equal, not on a
			// malformed header.
			signature = signIntakeBody(secret+"-tampered", rawBody, timestamp)
		}
	}

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, h.env.server.URL+path, bytes.NewReader(rawBody))
	if err != nil {
		t.Fatalf("build webhook request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if signature != "" {
		req.Header.Set("X-Clario360-Signature", signature)
	}
	if timestamp != "" {
		req.Header.Set("X-Clario360-Timestamp", timestamp)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		t.Fatalf("execute webhook request: %v", err)
	}
	return resp
}

func nowTimestamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func samplePayload(to, messageID string) dto.IntakeEmailWebhookRequest {
	return dto.IntakeEmailWebhookRequest{
		MessageID: messageID,
		From:      "external.counsel@example.com",
		To:        to,
		Subject:   "New legal request from intake",
		Body:      "Please review the attached agreement and advise.",
	}
}

// countRequestsForMessage counts legal_requests whose metadata back-links the
// given provider Message-ID, in the harness tenant's RLS context. Used to assert
// idempotency: a duplicate delivery must NOT spawn a second request.
func countRequestsForMessage(t *testing.T, h *lexHarness, messageID string) int {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var count int
	err := h.env.db.QueryRow(ctx,
		`SELECT count(*) FROM legal_requests WHERE tenant_id = $1 AND metadata->>'intake_message_id' = $2`,
		h.tenantID, messageID,
	).Scan(&count)
	if err != nil {
		t.Fatalf("count legal_requests for message %s: %v", messageID, err)
	}
	return count
}

func TestIntakeWebhookValidSignatureRoutesRequest(t *testing.T) {
	t.Parallel()
	h := newLexHarness(t)

	address := uniqueMailboxAddress("valid")
	secret := "wf6-intake-secret-" + uuid.NewString()
	mailbox := createIntakeMailbox(t, h, address, "contract_review", secret)

	messageID := "<msg-" + uuid.NewString() + "@example.com>"
	payload := samplePayload(address, messageID)
	ts := nowTimestamp()

	resp := postIntakeWebhook(t, h, intakeWebhookLexPath, secret, payload, ts, false)
	msg := mustData[model.IntakeMessage](t, resp, http.StatusAccepted)

	if msg.Status != model.IntakeMessageStatusRouted {
		t.Fatalf("intake message status = %q, want %q", msg.Status, model.IntakeMessageStatusRouted)
	}
	if msg.LegalRequestID == nil || *msg.LegalRequestID == uuid.Nil {
		t.Fatalf("routed intake message has no legal_request_id")
	}
	if msg.ProviderMessageID != messageID {
		t.Fatalf("provider_message_id = %q, want %q", msg.ProviderMessageID, messageID)
	}
	if msg.MailboxID == nil || *msg.MailboxID != mailbox.ID {
		t.Fatalf("intake message mailbox_id = %v, want %s", msg.MailboxID, mailbox.ID)
	}

	// The routed request is readable through the authenticated spine (proving the
	// public webhook landed a real, tenant-scoped legal_request).
	got := mustData[model.LegalRequest](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/legal-requests/%s", *msg.LegalRequestID), nil), http.StatusOK)
	if got.ID != *msg.LegalRequestID {
		t.Fatalf("fetched legal request id = %s, want %s", got.ID, *msg.LegalRequestID)
	}
	if got.RequestType != "contract_review" {
		t.Fatalf("routed request_type = %q, want inherited mailbox default %q", got.RequestType, "contract_review")
	}

	if n := countRequestsForMessage(t, h, messageID); n != 1 {
		t.Fatalf("legal_requests for message = %d, want exactly 1", n)
	}
}

func TestIntakeWebhookForgedSignatureRejected(t *testing.T) {
	t.Parallel()
	h := newLexHarness(t)

	address := uniqueMailboxAddress("forged")
	secret := "wf6-intake-secret-" + uuid.NewString()
	createIntakeMailbox(t, h, address, "contract_review", secret)

	messageID := "<msg-" + uuid.NewString() + "@example.com>"
	payload := samplePayload(address, messageID)
	ts := nowTimestamp()

	resp := postIntakeWebhook(t, h, intakeWebhookLexPath, secret, payload, ts, true)
	env := mustError(t, resp, http.StatusUnauthorized)
	if env.Error.Code != "UNAUTHORIZED" {
		t.Fatalf("forged signature error code = %q, want UNAUTHORIZED", env.Error.Code)
	}

	// No message must have been ingested and no request spawned.
	if n := countRequestsForMessage(t, h, messageID); n != 0 {
		t.Fatalf("forged delivery spawned %d legal_requests, want 0", n)
	}
}

func TestIntakeWebhookStaleTimestampRejected(t *testing.T) {
	t.Parallel()
	h := newLexHarness(t)

	address := uniqueMailboxAddress("stale")
	secret := "wf6-intake-secret-" + uuid.NewString()
	createIntakeMailbox(t, h, address, "contract_review", secret)

	messageID := "<msg-" + uuid.NewString() + "@example.com>"
	payload := samplePayload(address, messageID)
	// 30 minutes in the past: far outside the 5-minute replay tolerance. The
	// signature itself is COMPUTED CORRECTLY over this stale timestamp, so the
	// only thing rejecting it is the freshness window.
	staleTS := time.Now().UTC().Add(-30 * time.Minute).Format(time.RFC3339)

	resp := postIntakeWebhook(t, h, intakeWebhookLexPath, secret, payload, staleTS, false)
	env := mustError(t, resp, http.StatusUnauthorized)
	if env.Error.Code != "UNAUTHORIZED" {
		t.Fatalf("stale timestamp error code = %q, want UNAUTHORIZED", env.Error.Code)
	}

	if n := countRequestsForMessage(t, h, messageID); n != 0 {
		t.Fatalf("stale delivery spawned %d legal_requests, want 0", n)
	}
}

// TestIntakeWebhookUnknownMailboxNoOracle pins the WS5 de-oracle guarantee: an
// unknown mailbox must be INDISTINGUISHABLE from a bad signature. An attacker
// probing addresses must not be able to tell a real-but-unauthorized mailbox
// from a non-existent one (which would otherwise be a 404 vs 401 enumeration
// oracle). Both must be the identical uniform 401.
func TestIntakeWebhookUnknownMailboxUniformResponse(t *testing.T) {
	t.Parallel()
	h := newLexHarness(t)

	// (a) A real mailbox hit with a FORGED signature -> 401.
	realAddress := uniqueMailboxAddress("oracle-real")
	secret := "wf6-intake-secret-" + uuid.NewString()
	createIntakeMailbox(t, h, realAddress, "contract_review", secret)

	forgedPayload := samplePayload(realAddress, "<msg-"+uuid.NewString()+"@example.com>")
	forgedResp := postIntakeWebhook(t, h, intakeWebhookLexPath, secret, forgedPayload, nowTimestamp(), true)
	forgedEnv := mustError(t, forgedResp, http.StatusUnauthorized)

	// (b) An UNKNOWN mailbox (never registered) with a well-formed signature over
	// some arbitrary secret -> must be the SAME 401, never a 404.
	unknownAddress := uniqueMailboxAddress("oracle-unknown")
	unknownSecret := "does-not-matter-" + uuid.NewString()
	unknownPayload := samplePayload(unknownAddress, "<msg-"+uuid.NewString()+"@example.com>")
	unknownResp := postIntakeWebhook(t, h, intakeWebhookLexPath, unknownSecret, unknownPayload, nowTimestamp(), false)
	unknownEnv := mustError(t, unknownResp, http.StatusUnauthorized)

	// The de-oracle contract: identical status (already asserted as 401 by both
	// mustError calls), identical error code, and identical message — no field may
	// betray whether the mailbox exists.
	if forgedEnv.Error.Code != unknownEnv.Error.Code {
		t.Fatalf("oracle leak: forged code %q != unknown code %q", forgedEnv.Error.Code, unknownEnv.Error.Code)
	}
	if forgedEnv.Error.Message != unknownEnv.Error.Message {
		t.Fatalf("oracle leak: forged message %q != unknown message %q", forgedEnv.Error.Message, unknownEnv.Error.Message)
	}
	if unknownEnv.Error.Code != "UNAUTHORIZED" {
		t.Fatalf("unknown mailbox code = %q, want UNAUTHORIZED", unknownEnv.Error.Code)
	}
}

// TestIntakeWebhookDuplicateMessageIDIdempotent verifies Message-ID dedup: a
// redelivered (valid, fresh) webhook with the same Message-ID returns the
// already-ingested message and does NOT spawn a second legal_request.
func TestIntakeWebhookDuplicateMessageIDIdempotent(t *testing.T) {
	t.Parallel()
	h := newLexHarness(t)

	address := uniqueMailboxAddress("dup")
	secret := "wf6-intake-secret-" + uuid.NewString()
	createIntakeMailbox(t, h, address, "contract_review", secret)

	messageID := "<msg-" + uuid.NewString() + "@example.com>"
	payload := samplePayload(address, messageID)

	first := mustData[model.IntakeMessage](t, postIntakeWebhook(t, h, intakeWebhookLexPath, secret, payload, nowTimestamp(), false), http.StatusAccepted)
	if first.LegalRequestID == nil {
		t.Fatalf("first delivery did not route a request")
	}

	// Redeliver with a fresh timestamp (so freshness is satisfied) but the SAME
	// Message-ID. The signature is recomputed over the same body; dedup must make
	// this idempotent.
	second := mustData[model.IntakeMessage](t, postIntakeWebhook(t, h, intakeWebhookLexPath, secret, payload, nowTimestamp(), false), http.StatusAccepted)

	if second.ID != first.ID {
		t.Fatalf("duplicate delivery returned new message id %s, want existing %s", second.ID, first.ID)
	}
	if second.LegalRequestID == nil || first.LegalRequestID == nil || *second.LegalRequestID != *first.LegalRequestID {
		t.Fatalf("duplicate delivery linked a different legal_request: first=%v second=%v", first.LegalRequestID, second.LegalRequestID)
	}
	if n := countRequestsForMessage(t, h, messageID); n != 1 {
		t.Fatalf("idempotency violated: %d legal_requests for message, want exactly 1", n)
	}
}

// TestIntakeWebhookCrossTenantIsolation verifies a mailbox secret cannot be used
// to intake into ANOTHER tenant. Tenant A and tenant B each register a mailbox.
// A delivery to tenant B's address signed with tenant A's secret must be rejected
// (the HMAC is keyed by B's secret, so A's secret never verifies) — and a
// delivery to A's address signed with B's secret likewise fails. There is no path
// by which tenant A's secret authorizes an intake landing in tenant B.
func TestIntakeWebhookCrossTenantIsolation(t *testing.T) {
	t.Parallel()
	tenantA := newLexHarness(t)
	tenantB := newLexHarness(t)

	addressA := uniqueMailboxAddress("xtenant-a")
	secretA := "tenant-a-secret-" + uuid.NewString()
	createIntakeMailbox(t, tenantA, addressA, "contract_review", secretA)

	addressB := uniqueMailboxAddress("xtenant-b")
	secretB := "tenant-b-secret-" + uuid.NewString()
	createIntakeMailbox(t, tenantB, addressB, "contract_review", secretB)

	// Tenant A's secret targeting tenant B's mailbox: the body is correctly signed
	// with A's secret, but B's mailbox verifies against B's secret -> 401, and
	// nothing is ingested into tenant B.
	crossMessageID := "<msg-" + uuid.NewString() + "@example.com>"
	crossPayload := samplePayload(addressB, crossMessageID)
	crossResp := postIntakeWebhook(t, tenantA, intakeWebhookLexPath, secretA, crossPayload, nowTimestamp(), false)
	mustError(t, crossResp, http.StatusUnauthorized)

	// No intake landed in tenant B from the cross-tenant attempt.
	if n := countRequestsForMessage(t, tenantB, crossMessageID); n != 0 {
		t.Fatalf("cross-tenant delivery spawned %d legal_requests in tenant B, want 0", n)
	}

	// Sanity: tenant B's OWN secret on tenant B's mailbox succeeds and lands in
	// tenant B (proving the prior rejection was the secret mismatch, not a broken
	// mailbox), and tenant A sees nothing of it.
	okMessageID := "<msg-" + uuid.NewString() + "@example.com>"
	okPayload := samplePayload(addressB, okMessageID)
	okMsg := mustData[model.IntakeMessage](t, postIntakeWebhook(t, tenantB, intakeWebhookLexPath, secretB, okPayload, nowTimestamp(), false), http.StatusAccepted)
	if okMsg.TenantID != tenantB.tenantID {
		t.Fatalf("intake landed in tenant %s, want tenant B %s", okMsg.TenantID, tenantB.tenantID)
	}
	if n := countRequestsForMessage(t, tenantB, okMessageID); n != 1 {
		t.Fatalf("tenant B own-secret delivery created %d legal_requests, want 1", n)
	}
	if n := countRequestsForMessage(t, tenantA, okMessageID); n != 0 {
		t.Fatalf("tenant A sees %d legal_requests for tenant B message, want 0 (isolation)", n)
	}
}

// TestIntakeWebhookWatheeqAliasParity confirms the webhook is mounted on BOTH
// suite prefixes with identical behavior (mirroring the JWT routes). The same
// valid delivery to the /watheeq alias accepts and routes.
func TestIntakeWebhookWatheeqAliasParity(t *testing.T) {
	t.Parallel()
	h := newLexHarness(t)

	address := uniqueMailboxAddress("watheeq")
	secret := "wf6-intake-secret-" + uuid.NewString()
	createIntakeMailbox(t, h, address, "contract_review", secret)

	messageID := "<msg-" + uuid.NewString() + "@example.com>"
	payload := samplePayload(address, messageID)
	msg := mustData[model.IntakeMessage](t, postIntakeWebhook(t, h, intakeWebhookWatheeqPath, secret, payload, nowTimestamp(), false), http.StatusAccepted)
	if msg.Status != model.IntakeMessageStatusRouted || msg.LegalRequestID == nil {
		t.Fatalf("watheeq alias delivery did not route: status=%q request=%v", msg.Status, msg.LegalRequestID)
	}

	// A forged signature on the alias is rejected the same way.
	forgedID := "<msg-" + uuid.NewString() + "@example.com>"
	forgedResp := postIntakeWebhook(t, h, intakeWebhookWatheeqPath, secret, samplePayload(address, forgedID), nowTimestamp(), true)
	mustError(t, forgedResp, http.StatusUnauthorized)
	if n := countRequestsForMessage(t, h, forgedID); n != 0 {
		t.Fatalf("forged watheeq delivery spawned %d requests, want 0", n)
	}
}
