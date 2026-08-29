package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// httpStatusFromError maps a service error to its HTTP status for audit/metrics.
func httpStatusFromError(err error) int { return apperrors.HTTPStatus(err) }

// referenceLibraryServicer is the handler's dependency contract. The concrete
// *service.ReferenceLibraryService satisfies it; a fake satisfies it in tests so
// the serving-hardening (ETag/conditional/Range/caching/gating) is unit-testable
// without a database, file-service, or on-disk corpus.
type referenceLibraryServicer interface {
	Fingerprint(ctx context.Context) (string, error)
	List(ctx context.Context, filters model.ReferenceLibraryListFilters) ([]model.ReferenceLibraryDocument, int, error)
	Get(ctx context.Context, id uuid.UUID) (*model.ReferenceLibraryDocument, error)
	Facets(ctx context.Context) (*model.ReferenceLibraryFacets, error)
	GetForDownload(ctx context.Context, id uuid.UUID) (*model.ReferenceLibraryDocument, error)
	ResolveBytes(ctx context.Context, doc *model.ReferenceLibraryDocument) (*service.ReferenceLibraryContent, error)
	RecordAccess(entry model.ReferenceLibraryAccessEntry)
	AIConfigured() bool
	Search(ctx context.Context, query string, topK int, docIDs []string) (*dto.ReferenceLibrarySearchResponse, error)
	Ask(ctx context.Context, req dto.ReferenceLibraryAskRequest) (*dto.ReferenceLibraryAskResponse, error)
	AskStream(ctx context.Context, req dto.ReferenceLibraryAskRequest) (*service.AskStreamSession, error)
	Articles(ctx context.Context, id uuid.UUID) (*dto.ReferenceLibraryArticlesResponse, error)
	RecordAskFeedback(entry model.ReferenceLibraryAskFeedbackEntry)
}

// browseCacheControl is the Cache-Control for the metadata browse surfaces. The
// corpus is static/global but can change on re-ingestion, so a short max-age with
// an ETag (conditional revalidation) is correct: clients revalidate cheaply and
// get a 304 while the corpus is unchanged.
const browseCacheControl = "public, max-age=60"

// referenceLibraryAIRateLimitPerMin is the dedicated per-tenant sliding-window
// budget for the Second-Brain /search + /ask proxies (the LLM-cost surface),
// applied on top of the coarse suite-wide limiter.
const referenceLibraryAIRateLimitPerMin = 20

// downloadCacheControl marks the byte responses immutable for a year: the bytes
// are content-addressed by content_hash (a changed PDF is a new row/hash), so a
// long-lived immutable cache is safe and eliminates re-downloads of static law.
const downloadCacheControl = "public, max-age=31536000, immutable"

// ReferenceLibraryHandler serves the GLOBAL, read-only WatheeqTech reference
// library. Every route is cross-tenant (the catalog has no tenant_id); reads are
// gated entirely by the route's RequireAnyPermission(lex:reference:view, lex:read)
// and never touch userID for authorization. The handler adds production serving
// hardening: strong ETags + Cache-Control + conditional GET (304) on browse, and
// ETag/Last-Modified/Cache-Control/Range/304 on downloads, plus per-access audit
// and per-route metrics.
type ReferenceLibraryHandler struct {
	baseHandler
	service referenceLibraryServicer
	metrics *service.ReferenceLibraryMetrics
}

func NewReferenceLibraryHandler(svc referenceLibraryServicer, metrics *service.ReferenceLibraryMetrics, logger zerolog.Logger) *ReferenceLibraryHandler {
	return &ReferenceLibraryHandler{
		baseHandler: baseHandler{logger: logger},
		service:     svc,
		metrics:     metrics,
	}
}

// List handles GET /reference-library — paginated metadata browse/search, with a
// strong ETag over (corpus fingerprint, normalized query) and conditional GET.
func (h *ReferenceLibraryHandler) List(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("list", outcome, started) }()

	page, perPage := suiteapi.ParsePagination(r)
	query := dto.ReferenceLibraryListQuery{
		Search:   searchQueryParam(r),
		Category: strings.TrimSpace(r.URL.Query().Get("category")),
		DocType:  strings.TrimSpace(r.URL.Query().Get("doc_type")),
		Tag:      strings.TrimSpace(r.URL.Query().Get("tag")),
		Page:     page,
		PerPage:  perPage,
	}
	query.Normalize()

	fingerprint, err := h.service.Fingerprint(r.Context())
	if err != nil {
		outcome = "error"
		h.writeError(w, r, err)
		return
	}
	etag := browseETag("list", fingerprint, query.CacheKey())
	setBrowseValidators(w, etag)
	if referenceLibraryNotModified(r, etag, time.Time{}) {
		outcome = "not_modified"
		w.WriteHeader(http.StatusNotModified)
		return
	}

	items, total, err := h.service.List(r.Context(), query.ToFilters())
	if err != nil {
		outcome = "error"
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, dto.NewReferenceLibraryDocumentDTOs(items), query.Page, query.PerPage, total)
}

// Facets handles GET /reference-library/facets — category/doc_type/tag counts,
// cached with a fingerprint ETag + conditional GET.
func (h *ReferenceLibraryHandler) Facets(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("facets", outcome, started) }()

	fingerprint, err := h.service.Fingerprint(r.Context())
	if err != nil {
		outcome = "error"
		h.writeError(w, r, err)
		return
	}
	etag := browseETag("facets", fingerprint, "")
	setBrowseValidators(w, etag)
	if referenceLibraryNotModified(r, etag, time.Time{}) {
		outcome = "not_modified"
		w.WriteHeader(http.StatusNotModified)
		return
	}

	facets, err := h.service.Facets(r.Context())
	if err != nil {
		outcome = "error"
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, facets)
}

// Get handles GET /reference-library/{id} — a single catalog row with a strong
// ETag (fingerprint + id) + conditional GET.
func (h *ReferenceLibraryHandler) Get(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("get", outcome, started) }()

	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	fingerprint, ferr := h.service.Fingerprint(r.Context())
	if ferr != nil {
		outcome = "error"
		h.writeError(w, r, ferr)
		return
	}
	etag := browseETag("get", fingerprint, id.String())
	setBrowseValidators(w, etag)
	if referenceLibraryNotModified(r, etag, time.Time{}) {
		outcome = "not_modified"
		w.WriteHeader(http.StatusNotModified)
		return
	}

	item, err := h.service.Get(r.Context(), id)
	if err != nil {
		outcome = outcomeFromError(err)
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dto.NewReferenceLibraryDocumentDTO(*item))
}

// Download handles GET /reference-library/{id}/download — streams the PDF bytes
// cross-tenant from the file-service (Option A) or the mounted volume (fallback),
// with a strong ETag (content_hash), Last-Modified, an immutable Cache-Control,
// conditional GET (304 without fetching bytes), and Range support (via
// http.ServeContent). Every access — including a 304 and a not-found — is audited.
func (h *ReferenceLibraryHandler) Download(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("download", outcome, started) }()

	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}

	doc, err := h.service.GetForDownload(r.Context(), id)
	if err != nil {
		outcome = outcomeFromError(err)
		h.auditDownload(r, &id, "", outcome, httpStatusFromError(err), 0)
		h.writeError(w, r, err)
		return
	}

	etag := downloadETag(doc)
	modTime := doc.UpdatedAt
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", downloadCacheControl)
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", "inline; filename=\""+id.String()+".pdf\"")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if doc.ContentHash != nil && *doc.ContentHash != "" {
		w.Header().Set("X-Checksum-SHA256", *doc.ContentHash)
	}

	// Conditional short-circuit BEFORE opening bytes — a 304 never fetches from
	// file-service or reads the volume.
	if referenceLibraryNotModified(r, etag, modTime) {
		outcome = "not_modified"
		h.auditDownload(r, &id, "", outcome, http.StatusNotModified, 0)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	content, err := h.service.ResolveBytes(r.Context(), doc)
	if err != nil {
		outcome = outcomeFromError(err)
		h.metrics.RecordDownload("", outcome, 0)
		h.auditDownload(r, &id, "", outcome, httpStatusFromError(err), 0)
		h.writeError(w, r, err)
		return
	}
	defer content.Close()

	if content.ContentType != "" {
		w.Header().Set("Content-Type", content.ContentType)
	}
	// http.ServeContent honours Range + If-Range using the ETag/Last-Modified we
	// set, and does NOT override our Cache-Control/ETag/Content-Disposition.
	filename := strings.TrimSpace(doc.TitleEN)
	if filename == "" {
		filename = id.String()
	}
	http.ServeContent(w, r, filename+".pdf", modTime, content.Reader())

	h.metrics.RecordDownload(content.ByteSource, "ok", content.Size)
	h.auditDownload(r, &id, content.ByteSource, "ok", http.StatusOK, content.Size)
}

// Search handles GET /reference-library/search — a PROXY to the Second-Brain AI
// service's contents (semantic) search. It never fabricates: when the AI service
// is unconfigured it returns a clear 503.
func (h *ReferenceLibraryHandler) Search(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("search", outcome, started) }()

	if !h.service.AIConfigured() {
		outcome = "unconfigured"
		h.metrics.RecordAI("search", "unconfigured")
		writeSecondBrainUnconfigured(w)
		return
	}
	q := searchQueryParam(r)
	topK := 0
	if raw := strings.TrimSpace(r.URL.Query().Get("top_k")); raw != "" {
		if parsed, perr := strconv.Atoi(raw); perr == nil && parsed > 0 {
			topK = parsed
		}
	}
	// Bound the doc_ids filter so a caller cannot force an unbounded fan-out.
	docIDs := suiteapi.ParseCSVParam(r, "doc_ids")
	if len(docIDs) > dto.ReferenceLibraryMaxDocIDs {
		docIDs = docIDs[:dto.ReferenceLibraryMaxDocIDs]
	}
	resp, err := h.service.Search(r.Context(), q, topK, docIDs)
	if err != nil {
		outcome = "upstream_error"
		h.auditQuery(r, model.ReferenceLibraryActionSearch, q, outcome, httpStatusFromError(err))
		h.writeError(w, r, err)
		return
	}
	h.auditQuery(r, model.ReferenceLibraryActionSearch, q, "ok", http.StatusOK)
	// The AI contract is {data, meta} at the top level (NOT the lex {data}
	// envelope), so write it through verbatim.
	suiteapi.WriteJSON(w, http.StatusOK, resp)
}

// Ask handles POST /reference-library/ask — a PROXY to the Second-Brain AI
// service's grounded Q&A. Returns 503 when the AI service is unconfigured.
func (h *ReferenceLibraryHandler) Ask(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("ask", outcome, started) }()

	var req dto.ReferenceLibraryAskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	if fields := req.Validate(); fields != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "invalid ask request", fields)
		return
	}
	if !h.service.AIConfigured() {
		outcome = "unconfigured"
		h.metrics.RecordAI("ask", "unconfigured")
		writeSecondBrainUnconfigured(w)
		return
	}
	resp, err := h.service.Ask(r.Context(), req)
	if err != nil {
		outcome = "upstream_error"
		h.auditQuery(r, model.ReferenceLibraryActionAsk, req.Question, outcome, httpStatusFromError(err))
		h.writeError(w, r, err)
		return
	}
	h.auditQuery(r, model.ReferenceLibraryActionAsk, req.Question, "ok", http.StatusOK)
	// The AI /ask contract is {answer, citations, model, latency_ms} at the top
	// level, so write it through verbatim (not the lex {data} envelope).
	suiteapi.WriteJSON(w, http.StatusOK, resp)
}

// Articles handles GET /reference-library/{id}/articles — the document's article/
// section index (فهرس المواد), proxied verbatim from GET {AI}/articles?doc_id={id}.
// It is OPTIONAL enrichment gated on the plain read permission (NOT the stricter AI
// rate-limit group — it serves read metadata, not the LLM): when the AI service is
// unset or errors, the service returns {data:[]} and this handler responds 200 so
// the frontend simply hides the panel rather than showing an error. It never 503s.
func (h *ReferenceLibraryHandler) Articles(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("articles", outcome, started) }()

	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	resp, err := h.service.Articles(r.Context(), id)
	if err != nil {
		// Articles is graceful-empty by contract; a defensive degrade keeps the panel
		// optional even if the service ever surfaces an error.
		outcome = "error"
		suiteapi.WriteJSON(w, http.StatusOK, &dto.ReferenceLibraryArticlesResponse{Data: []dto.ReferenceLibraryArticle{}})
		return
	}
	// The AI /articles contract is {data:[...]} at the top level (NOT the lex {data}
	// envelope), so write it through verbatim.
	suiteapi.WriteJSON(w, http.StatusOK, resp)
}

// AskFeedback handles POST /reference-library/ask/feedback — captures a thumbs
// up/down (+ optional comment + citations) on a Second-Brain /ask answer. It
// validates the rating, bounds the question/comment, records the feedback
// best-effort (durable insert off the request path + a guaranteed structured log
// line), and returns 204. The tenant/user attribution is taken from the
// authenticated request context (baseAuditEntry), never the body.
func (h *ReferenceLibraryHandler) AskFeedback(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("ask_feedback", outcome, started) }()

	var req dto.ReferenceLibraryAskFeedbackRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	if fields := req.Validate(); fields != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "invalid feedback", fields)
		return
	}

	base := h.baseAuditEntry(r)
	entry := model.ReferenceLibraryAskFeedbackEntry{
		TenantID: base.TenantID,
		UserID:   base.UserID,
		Question: req.Question,
		Rating:   req.Rating,
		Comment:  req.Comment,
	}
	if len(req.Citations) > 0 {
		if raw, mErr := json.Marshal(req.Citations); mErr == nil {
			entry.Citations = raw
		}
	}
	h.service.RecordAskFeedback(entry)
	w.WriteHeader(http.StatusNoContent)
}

// AskStream handles POST /reference-library/ask/stream — the STREAMING twin of
// Ask. It proxies the Second-Brain SSE (text/event-stream) to the browser,
// flushing after every chunk so tokens render live. Same permission gate +
// dedicated AI rate limit (both on the route) + per-access audit as Ask, and the
// same never-fabricate 503 when the AI service is unconfigured. Once the SSE
// headers are committed, transport failures surface as an in-band terminal
// `error` frame rather than an HTTP status the browser can no longer receive.
func (h *ReferenceLibraryHandler) AskStream(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	outcome := "ok"
	defer func() { h.metrics.ObserveRequest("ask_stream", outcome, started) }()

	var req dto.ReferenceLibraryAskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	if fields := req.Validate(); fields != nil {
		outcome = "bad_request"
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "VALIDATION_ERROR", "invalid ask request", fields)
		return
	}
	if !h.service.AIConfigured() {
		outcome = "unconfigured"
		h.metrics.RecordAI("ask_stream", "unconfigured")
		writeSecondBrainUnconfigured(w)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		outcome = "no_flush"
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "STREAM_UNSUPPORTED", "streaming not supported", nil)
		return
	}

	session, err := h.service.AskStream(r.Context(), req)
	if err != nil {
		// Dial/transport failure BEFORE any bytes are written — still a normal HTTP error.
		outcome = "upstream_error"
		h.auditQuery(r, model.ReferenceLibraryActionAsk, req.Question, outcome, httpStatusFromError(err))
		h.writeError(w, r, err)
		return
	}
	defer session.Close()

	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream; charset=utf-8")
	hdr.Set("Cache-Control", "no-cache, no-transform")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-Accel-Buffering", "no") // defeat nginx/proxy response buffering

	// Upstream returned a non-2xx (e.g. its own 503 "llm not configured"): the SSE
	// transport itself is 200, and the failure is delivered as an in-band error frame.
	if session.StatusCode >= http.StatusBadRequest {
		outcome = "upstream_error"
		w.WriteHeader(http.StatusOK)
		writeSSEError(w, flusher, drainErrorMessage(session.Body))
		h.auditQuery(r, model.ReferenceLibraryActionAsk, req.Question, outcome, session.StatusCode)
		return
	}

	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	ctx := r.Context()
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done(): // client disconnected → upstream request is already cancelling
			outcome = "client_closed"
			return
		default:
		}
		n, rerr := session.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				outcome = "client_closed"
				return
			}
			flusher.Flush()
		}
		if rerr != nil {
			if rerr == io.EOF {
				break
			}
			outcome = "upstream_error"
			writeSSEError(w, flusher, "stream interrupted")
			h.auditQuery(r, model.ReferenceLibraryActionAsk, req.Question, outcome, http.StatusBadGateway)
			return
		}
	}
	h.auditQuery(r, model.ReferenceLibraryActionAsk, req.Question, "ok", http.StatusOK)
}

// drainErrorMessage reads a short upstream error body and extracts a message,
// tolerating either {"error":"…"} JSON or plain text.
func drainErrorMessage(body io.Reader) string {
	raw, _ := io.ReadAll(io.LimitReader(body, 4096))
	if len(raw) == 0 {
		return "second brain unavailable"
	}
	var payload struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(raw, &payload) == nil && payload.Error != "" {
		return payload.Error
	}
	return strings.TrimSpace(string(raw))
}

// writeSSEError emits a terminal `error` + `done` SSE frame pair on an
// already-open text/event-stream response (matches the Second-Brain frame shape).
func writeSSEError(w io.Writer, flusher http.Flusher, message string) {
	payload, _ := json.Marshal(map[string]string{"error": message})
	fmt.Fprintf(w, "event: error\ndata: %s\n\n", payload)
	fmt.Fprint(w, "event: done\ndata: {}\n\n")
	flusher.Flush()
}

// -----------------------------------------------------------------------------
// Audit + serving helpers.
// -----------------------------------------------------------------------------

func (h *ReferenceLibraryHandler) auditDownload(r *http.Request, docID *uuid.UUID, byteSource, outcome string, status int, bytes int64) {
	entry := h.baseAuditEntry(r)
	entry.Action = model.ReferenceLibraryActionDownload
	entry.DocumentID = docID
	entry.ByteSource = byteSource
	entry.Outcome = outcome
	entry.StatusCode = status
	entry.BytesServed = bytes
	h.service.RecordAccess(entry)
}

func (h *ReferenceLibraryHandler) auditQuery(r *http.Request, action, query, outcome string, status int) {
	entry := h.baseAuditEntry(r)
	entry.Action = action
	entry.Outcome = outcome
	entry.StatusCode = status
	entry.QueryHash = hashQuery(query)
	entry.QuerySample = querySample(query)
	h.service.RecordAccess(entry)
}

// baseAuditEntry captures the request-scoped who/where fields shared by every
// audit action. Tenant/user come from the (already-authenticated) request context.
func (h *ReferenceLibraryHandler) baseAuditEntry(r *http.Request) model.ReferenceLibraryAccessEntry {
	entry := model.ReferenceLibraryAccessEntry{
		ClientIP:  referenceLibraryClientIP(r),
		UserAgent: truncate(r.UserAgent(), 512),
	}
	if user := auth.UserFromContext(r.Context()); user != nil {
		entry.UserEmail = user.Email
		if uid, err := uuid.Parse(user.ID); err == nil {
			entry.UserID = &uid
		}
	}
	if tenant := auth.TenantFromContext(r.Context()); tenant != "" {
		if tid, err := uuid.Parse(tenant); err == nil {
			entry.TenantID = &tid
		}
	}
	return entry
}

// setBrowseValidators sets the ETag + Cache-Control for a browse response so a
// conforming client can revalidate with If-None-Match.
func setBrowseValidators(w http.ResponseWriter, etag string) {
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", browseCacheControl)
}

// browseETag builds a strong, quoted ETag over a surface + corpus fingerprint +
// query key. fnv is sufficient (non-security identity); the fingerprint guarantees
// the ETag changes the moment the corpus changes.
func browseETag(surface, fingerprint, queryKey string) string {
	h := fnv.New64a()
	_, _ = h.Write([]byte(surface + "\x00" + fingerprint + "\x00" + queryKey))
	return "\"rl-" + strconv.FormatUint(h.Sum64(), 16) + "\""
}

// downloadETag prefers the content hash (a strong SHA-256 validator) and falls
// back to a derived id+updated_at fingerprint when the row carries no hash yet.
func downloadETag(doc *model.ReferenceLibraryDocument) string {
	if doc.ContentHash != nil && strings.TrimSpace(*doc.ContentHash) != "" {
		return "\"" + strings.TrimSpace(*doc.ContentHash) + "\""
	}
	h := fnv.New64a()
	_, _ = h.Write([]byte(doc.ID.String() + "\x00" + doc.UpdatedAt.UTC().Format(time.RFC3339Nano)))
	return "\"rl-doc-" + strconv.FormatUint(h.Sum64(), 16) + "\""
}

// referenceLibraryNotModified implements RFC 7232 conditional-GET precedence:
// If-None-Match wins when present; otherwise If-Modified-Since (when a modTime is
// available) decides.
func referenceLibraryNotModified(r *http.Request, etag string, modTime time.Time) bool {
	if inm := r.Header.Get("If-None-Match"); inm != "" {
		return etagMatches(inm, etag)
	}
	if ims := r.Header.Get("If-Modified-Since"); ims != "" && !modTime.IsZero() {
		if t, err := http.ParseTime(ims); err == nil {
			return !modTime.Truncate(time.Second).After(t)
		}
	}
	return false
}

// etagMatches reports whether the current etag satisfies an If-None-Match header
// value (a comma list, possibly "*", with optional weak "W/" markers).
func etagMatches(ifNoneMatch, etag string) bool {
	ifNoneMatch = strings.TrimSpace(ifNoneMatch)
	if ifNoneMatch == "*" {
		return true
	}
	current := strings.TrimPrefix(etag, "W/")
	for _, candidate := range strings.Split(ifNoneMatch, ",") {
		candidate = strings.TrimSpace(candidate)
		candidate = strings.TrimPrefix(candidate, "W/")
		if candidate == current {
			return true
		}
	}
	return false
}

func referenceLibraryClientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); ip != "" {
		if comma := strings.IndexByte(ip, ','); comma >= 0 {
			return strings.TrimSpace(ip[:comma])
		}
		return ip
	}
	if ip := strings.TrimSpace(r.Header.Get("X-Real-IP")); ip != "" {
		return ip
	}
	return r.RemoteAddr
}

func hashQuery(query string) string {
	query = strings.TrimSpace(query)
	if query == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(query))
	return hex.EncodeToString(sum[:])
}

func querySample(query string) string {
	return truncate(strings.TrimSpace(query), 120)
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

// outcomeFromError maps a service error to a metrics/audit outcome label.
func outcomeFromError(err error) string {
	switch httpStatusFromError(err) {
	case http.StatusNotFound:
		return "not_found"
	case http.StatusBadRequest:
		return "bad_request"
	case http.StatusServiceUnavailable:
		return "unconfigured"
	case http.StatusBadGateway:
		return "upstream_error"
	default:
		return "error"
	}
}

// writeSecondBrainUnconfigured emits the exact 503 shape the frontend agent
// builds to when LEX_AI_SERVICE_URL is unset.
func writeSecondBrainUnconfigured(w http.ResponseWriter) {
	suiteapi.WriteJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "second brain not configured"})
}
