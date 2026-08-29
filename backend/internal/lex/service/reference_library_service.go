package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/observability/tracing"
)

// defaultReferenceLibraryCacheTTL bounds how long a corpus fingerprint (and thus
// the read-through list/facets cache derived from it) is trusted before a cheap
// re-check. The corpus is static/global so a coarse TTL is safe; the fingerprint
// still busts the cache the instant an ingestion UPSERT changes count/updated_at.
const defaultReferenceLibraryCacheTTL = 60 * time.Second

// defaultMaxFileServiceBytes caps how many bytes the Option-A file-service byte
// path will buffer for a single download (so Range/conditional serve uniformly).
// It is far above any single corpus PDF; exceeding it is treated as a misconfig
// and fails rather than risking OOM.
const defaultMaxFileServiceBytes int64 = 256 << 20 // 256 MiB

// ReferenceLibraryConfig injects the deployment-time knobs the reference library
// needs. Both byte paths are wired: the Second-Brain AI base URL for /search +
// /ask proxies, the mounted-volume corpus dir (design §2.4 dev-runnable path),
// and the file-service byte path (design §2.3 Option A) via FileServiceURL +
// DefaultLibraryTenantID. Any may be empty; the service then returns clear, honest
// errors (503 unconfigured AI, 404/502 downloads) rather than faking behaviour.
type ReferenceLibraryConfig struct {
	AIServiceURL string
	StorageDir   string
	// DefaultLibraryTenantID is the canonical owner tenant used for the Option-A
	// file-service proxy when a catalog row does not carry its own library_tenant_id.
	DefaultLibraryTenantID string
	// FileServiceURL is the file-service origin for the Option-A byte path. Empty
	// disables the file-service path (volume fallback / 502).
	FileServiceURL      string
	HTTPClient          *http.Client
	CacheTTL            time.Duration
	MaxFileServiceBytes int64
}

// ReferenceLibraryService is the read-only application layer for the global
// reference catalog. It has NO publisher and exposes NO writes/governance.
type ReferenceLibraryService struct {
	repo         *repository.ReferenceLibraryRepository
	auditRepo    *repository.ReferenceLibraryAuditRepository
	feedbackRepo *repository.ReferenceLibraryFeedbackRepository
	fileClient   *FileServiceClient
	metrics      *ReferenceLibraryMetrics

	aiBaseURL              string
	storageDir             string
	defaultLibraryTenantID string
	httpClient             *http.Client
	streamClient           *http.Client
	maxFileServiceBytes    int64

	cache  *referenceLibraryCache
	logger zerolog.Logger
}

func NewReferenceLibraryService(repo *repository.ReferenceLibraryRepository, cfg ReferenceLibraryConfig, logger zerolog.Logger) *ReferenceLibraryService {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Second}
	}
	ttl := cfg.CacheTTL
	if ttl <= 0 {
		ttl = defaultReferenceLibraryCacheTTL
	}
	maxBytes := cfg.MaxFileServiceBytes
	if maxBytes <= 0 {
		maxBytes = defaultMaxFileServiceBytes
	}
	// The streaming client deliberately carries NO total timeout: an SSE answer can
	// run for many seconds and a client-level Timeout would truncate it mid-stream.
	// Cancellation is driven entirely by the request context (client disconnect →
	// ctx cancel → upstream torn down). It reuses the non-stream client's Transport
	// so connection pooling / TLS config are shared.
	streamClient := &http.Client{Transport: client.Transport}
	return &ReferenceLibraryService{
		repo:                   repo,
		aiBaseURL:              strings.TrimRight(strings.TrimSpace(cfg.AIServiceURL), "/"),
		storageDir:             strings.TrimSpace(cfg.StorageDir),
		defaultLibraryTenantID: strings.TrimSpace(cfg.DefaultLibraryTenantID),
		httpClient:             client,
		streamClient:           streamClient,
		maxFileServiceBytes:    maxBytes,
		cache:                  newReferenceLibraryCache(ttl),
		logger:                 logger.With().Str("service", "lex-reference-library").Logger(),
	}
}

// WithAudit binds the durable access-log repository (best-effort). Nil-safe.
func (s *ReferenceLibraryService) WithAudit(repo *repository.ReferenceLibraryAuditRepository) *ReferenceLibraryService {
	s.auditRepo = repo
	return s
}

// WithFeedback binds the durable ask-feedback repository (best-effort). Nil-safe.
func (s *ReferenceLibraryService) WithFeedback(repo *repository.ReferenceLibraryFeedbackRepository) *ReferenceLibraryService {
	s.feedbackRepo = repo
	return s
}

// WithFileService binds the Option-A file-service byte client. Nil-safe.
func (s *ReferenceLibraryService) WithFileService(c *FileServiceClient) *ReferenceLibraryService {
	s.fileClient = c
	return s
}

// WithMetrics binds the Prometheus collectors. Nil-safe.
func (s *ReferenceLibraryService) WithMetrics(m *ReferenceLibraryMetrics) *ReferenceLibraryService {
	s.metrics = m
	return s
}

// BindFileServiceTokenSource wires the JWT-minting token source into the file
// client once the shared JWTManager is in scope (RegisterRoutes time). Nil-safe
// on both the client and the source: an unbound client stays not-ready and the
// download handler falls back to the volume path / returns a clear 502.
func (s *ReferenceLibraryService) BindFileServiceTokenSource(ts FileServiceTokenSource) {
	if s == nil || s.fileClient == nil || ts == nil {
		return
	}
	s.fileClient.WithTokenSource(ts)
}

// Fingerprint returns an opaque corpus-version string used to derive cache
// validators (ETags) and to bust the read-through cache the moment the corpus
// changes. It is cached for the configured TTL so browse traffic does not hit the
// DB on every request; a changed fingerprint clears the payload caches.
func (s *ReferenceLibraryService) Fingerprint(ctx context.Context) (string, error) {
	if fp, ok := s.cache.fingerprint(); ok {
		return fp, nil
	}
	count, maxUpdated, err := s.repo.Fingerprint(ctx)
	if err != nil {
		return "", internalError("reference library fingerprint", err)
	}
	fp := fmt.Sprintf("%d-%d", count, maxUpdated.UnixNano())
	s.cache.setFingerprint(fp)
	return fp, nil
}

// List returns a page of published catalog rows plus the total. Results are served
// from the read-through cache keyed by (fingerprint, normalized-query); a corpus
// change (new fingerprint) transparently invalidates the cache.
func (s *ReferenceLibraryService) List(ctx context.Context, filters model.ReferenceLibraryListFilters) ([]model.ReferenceLibraryDocument, int, error) {
	ctx, span := tracing.StartSpan(ctx, "reference_library.list")
	defer span.End()

	fp, err := s.Fingerprint(ctx)
	if err != nil {
		return nil, 0, err
	}
	key := fp + "|" + referenceLibraryQueryKey(filters)
	if items, total, ok := s.cache.getList(key); ok {
		s.metrics.RecordCache("list", "hit")
		return items, total, nil
	}
	s.metrics.RecordCache("list", "miss")

	items, total, err := s.repo.List(ctx, filters)
	if err != nil {
		return nil, 0, internalError("list reference library", err)
	}
	s.cache.setList(key, items, total)
	s.metrics.RecordCache("list", "store")
	return items, total, nil
}

// Get resolves a single published catalog row, mapping absence to a 404.
func (s *ReferenceLibraryService) Get(ctx context.Context, id uuid.UUID) (*model.ReferenceLibraryDocument, error) {
	item, err := s.repo.Get(ctx, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("reference library document not found")
		}
		return nil, internalError("get reference library document", err)
	}
	return item, nil
}

// Facets returns category / doc_type / tag buckets with counts, served from the
// fingerprint-keyed read-through cache.
func (s *ReferenceLibraryService) Facets(ctx context.Context) (*model.ReferenceLibraryFacets, error) {
	ctx, span := tracing.StartSpan(ctx, "reference_library.facets")
	defer span.End()

	fp, err := s.Fingerprint(ctx)
	if err != nil {
		return nil, err
	}
	if facets, ok := s.cache.getFacets(fp); ok {
		s.metrics.RecordCache("facets", "hit")
		return facets, nil
	}
	s.metrics.RecordCache("facets", "miss")

	facets, err := s.repo.Facets(ctx)
	if err != nil {
		return nil, internalError("reference library facets", err)
	}
	s.cache.setFacets(fp, facets)
	s.metrics.RecordCache("facets", "store")
	return facets, nil
}

// GetForDownload resolves the catalog row for the byte-download path. It reuses
// the same published/non-deleted filter as Get (a download of an unpublished or
// deleted document is a 404).
func (s *ReferenceLibraryService) GetForDownload(ctx context.Context, id uuid.UUID) (*model.ReferenceLibraryDocument, error) {
	return s.Get(ctx, id)
}

// -----------------------------------------------------------------------------
// Byte resolution — the cross-tenant download path. ResolveBytes picks the store
// the catalog row points at (byte_source): the platform file-service (Option A,
// design §2.3) or the mounted read-only volume (fallback, design §2.4). Both are
// returned as an io.ReadSeeker so the handler serves Range + conditional GET
// uniformly via http.ServeContent.
// -----------------------------------------------------------------------------

// ReferenceLibraryContent is an opened document body plus the serving metadata
// the download handler needs. The Reader is ALWAYS seekable (a *os.File on the
// volume path; a buffered bytes.Reader on the file-service path) so Range works
// on both. Callers MUST Close it.
type ReferenceLibraryContent struct {
	ByteSource  string
	ContentType string
	ModTime     time.Time
	Size        int64
	reader      io.ReadSeeker
	closer      io.Closer
}

// NewReferenceLibraryContent constructs a content handle. Exported so tests can
// build a byte source without a real file-service or on-disk corpus. closer may
// be nil.
func NewReferenceLibraryContent(reader io.ReadSeeker, closer io.Closer, size int64, contentType, byteSource string, modTime time.Time) *ReferenceLibraryContent {
	return &ReferenceLibraryContent{
		ByteSource:  byteSource,
		ContentType: contentType,
		ModTime:     modTime,
		Size:        size,
		reader:      reader,
		closer:      closer,
	}
}

// Reader returns the seekable body.
func (c *ReferenceLibraryContent) Reader() io.ReadSeeker { return c.reader }

// Close releases the underlying handle (best-effort, nil-safe).
func (c *ReferenceLibraryContent) Close() error {
	if c == nil || c.closer == nil {
		return nil
	}
	return c.closer.Close()
}

// ResolveBytes opens the document's bytes from whichever store byte_source names.
// file-service (Option A) is used when byte_source == "file-service" (or is empty
// but a file_id is present); otherwise the mounted volume is used. When the
// file-service path is selected but not wired (client not ready), it degrades to
// the volume path if a storage_key exists, else returns a clear 502.
func (s *ReferenceLibraryService) ResolveBytes(ctx context.Context, doc *model.ReferenceLibraryDocument) (*ReferenceLibraryContent, error) {
	if doc == nil {
		return nil, notFoundError("reference library document has no downloadable bytes")
	}
	ctx, span := tracing.StartSpan(ctx, "reference_library.resolve_bytes")
	defer span.End()

	source := strings.TrimSpace(doc.ByteSource)
	useFileService := source == "file-service" || (source == "" && doc.FileID != nil)

	if useFileService {
		if s.fileClient.Ready() && doc.FileID != nil {
			return s.resolveFileServiceBytes(ctx, doc)
		}
		// file-service selected but not wired: fall back to the volume path when a
		// storage_key exists; otherwise surface a clear, honest 502.
		if doc.StorageKey == nil || strings.TrimSpace(*doc.StorageKey) == "" {
			return nil, &apperrors.AppError{
				Status:  http.StatusBadGateway,
				Code:    "REFERENCE_LIBRARY_FILE_SERVICE_UNCONFIGURED",
				Message: "reference library file-service byte path is not configured",
			}
		}
	}
	return s.resolveVolumeBytes(doc)
}

func (s *ReferenceLibraryService) resolveFileServiceBytes(ctx context.Context, doc *model.ReferenceLibraryDocument) (*ReferenceLibraryContent, error) {
	tenantID := s.libraryTenantID(doc)
	if tenantID == "" {
		return nil, &apperrors.AppError{
			Status:  http.StatusBadGateway,
			Code:    "REFERENCE_LIBRARY_NO_LIBRARY_TENANT",
			Message: "reference library document has no library tenant for the file-service byte path",
		}
	}
	obj, err := s.fileClient.Download(ctx, tenantID, doc.FileID.String())
	if err != nil {
		return nil, err
	}
	defer obj.Body.Close()

	// Buffer the (non-seekable) file-service stream so the handler can serve Range
	// + conditional GET uniformly. Bounded to guard against a misconfigured store.
	limited := io.LimitReader(obj.Body, s.maxFileServiceBytes+1)
	data, err := io.ReadAll(limited)
	if err != nil {
		return nil, s.badGateway("read file-service body failed", err)
	}
	if int64(len(data)) > s.maxFileServiceBytes {
		return nil, s.badGateway("file-service object exceeds reference library size cap",
			fmt.Errorf("object larger than %d bytes", s.maxFileServiceBytes))
	}

	contentType := obj.ContentType
	if contentType == "" {
		contentType = "application/pdf"
	}
	modTime := doc.UpdatedAt
	return NewReferenceLibraryContent(bytes.NewReader(data), nil, int64(len(data)), contentType, "file-service", modTime), nil
}

func (s *ReferenceLibraryService) resolveVolumeBytes(doc *model.ReferenceLibraryDocument) (*ReferenceLibraryContent, error) {
	path, err := s.LocalStoragePath(doc)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, notFoundError("reference library file bytes not found")
		}
		return nil, internalError("open reference library bytes", err)
	}
	stat, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, internalError("stat reference library bytes", err)
	}
	return NewReferenceLibraryContent(file, file, stat.Size(), "application/pdf", "volume", stat.ModTime()), nil
}

// libraryTenantID resolves the canonical owner tenant for the Option-A proxy:
// the row's own library_tenant_id when set, else the deployment default.
func (s *ReferenceLibraryService) libraryTenantID(doc *model.ReferenceLibraryDocument) string {
	if doc.LibraryTenantID != nil && *doc.LibraryTenantID != uuid.Nil {
		return doc.LibraryTenantID.String()
	}
	return s.defaultLibraryTenantID
}

// LocalStoragePath resolves the on-disk absolute path for a document's bytes on
// the mounted-volume path (design §2.4). It fails CLOSED: an unset storage dir, a
// missing storage_key, or any attempt to escape the corpus directory (path
// traversal) returns an error rather than a path.
func (s *ReferenceLibraryService) LocalStoragePath(doc *model.ReferenceLibraryDocument) (string, error) {
	if s.storageDir == "" {
		return "", &apperrors.AppError{
			Status:  http.StatusServiceUnavailable,
			Code:    "REFERENCE_LIBRARY_STORAGE_UNCONFIGURED",
			Message: "reference library storage directory is not configured",
		}
	}
	if doc == nil || doc.StorageKey == nil || strings.TrimSpace(*doc.StorageKey) == "" {
		return "", notFoundError("reference library document has no downloadable bytes")
	}
	key := strings.TrimSpace(*doc.StorageKey)
	// Clean the key relative to a virtual root so any ".." segments collapse and
	// cannot climb out of the corpus directory, then join under the real base.
	cleaned := filepath.Clean("/" + key)
	base := filepath.Clean(s.storageDir)
	full := filepath.Join(base, cleaned)
	rel, err := filepath.Rel(base, full)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", &apperrors.AppError{
			Status:  http.StatusBadRequest,
			Code:    "REFERENCE_LIBRARY_INVALID_KEY",
			Message: "reference library storage key is invalid",
		}
	}
	return full, nil
}

// -----------------------------------------------------------------------------
// Per-access audit (design §4). RecordAccess writes ONE durable, queryable audit
// row (best-effort, off the request path) and ALWAYS emits a structured audit log
// line, so downloads and Second-Brain calls are attributable even when the audit
// table is unavailable.
// -----------------------------------------------------------------------------

// RecordAccess records a reference-library access. The structured log is emitted
// synchronously (guaranteed); the durable insert runs in the background so it
// never adds latency to or fails the read it audits.
func (s *ReferenceLibraryService) RecordAccess(entry model.ReferenceLibraryAccessEntry) {
	event := s.logger.Info().
		Str("audit", "reference_library_access").
		Str("action", entry.Action).
		Str("outcome", entry.Outcome).
		Str("byte_source", entry.ByteSource).
		Int("status_code", entry.StatusCode).
		Int64("bytes_served", entry.BytesServed).
		Str("client_ip", entry.ClientIP)
	if entry.DocumentID != nil {
		event = event.Str("document_id", entry.DocumentID.String())
	}
	if entry.TenantID != nil {
		event = event.Str("tenant_id", entry.TenantID.String())
	}
	if entry.UserID != nil {
		event = event.Str("user_id", entry.UserID.String())
	}
	if entry.UserEmail != "" {
		event = event.Str("user_email", entry.UserEmail)
	}
	if entry.QueryHash != "" {
		event = event.Str("query_hash", entry.QueryHash)
	}
	event.Msg("reference library access")

	if s.auditRepo == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.auditRepo.Insert(ctx, entry); err != nil {
			s.logger.Warn().Err(err).Str("action", entry.Action).Msg("reference library: persist access audit failed")
		}
	}()
}

// RecordAskFeedback records a thumbs up/down (+ optional comment + citations) on a
// Second-Brain /ask answer. Like RecordAccess it is best-effort: the structured log
// is emitted synchronously (guaranteed even when the feedback table is unavailable)
// and the durable insert runs in the background so it never adds latency to or fails
// the POST (which returns 204 either way).
func (s *ReferenceLibraryService) RecordAskFeedback(entry model.ReferenceLibraryAskFeedbackEntry) {
	sample := entry.Question
	if len(sample) > 120 {
		sample = sample[:120]
	}
	event := s.logger.Info().
		Str("audit", "reference_library_ask_feedback").
		Str("rating", entry.Rating).
		Bool("has_comment", entry.Comment != "").
		Str("question_sample", sample)
	if entry.TenantID != nil {
		event = event.Str("tenant_id", entry.TenantID.String())
	}
	if entry.UserID != nil {
		event = event.Str("user_id", entry.UserID.String())
	}
	event.Msg("reference library ask feedback")

	if s.feedbackRepo == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := s.feedbackRepo.Insert(ctx, entry); err != nil {
			s.logger.Warn().Err(err).Str("rating", entry.Rating).Msg("reference library: persist ask feedback failed")
		}
	}()
}

// -----------------------------------------------------------------------------
// Second-Brain AI proxy (design §7 P2). Never fabricates: when the AI service is
// unconfigured the handler returns a clear 503; when it is configured but errors
// these methods surface a 502.
// -----------------------------------------------------------------------------

// AIConfigured reports whether the Second-Brain AI service base URL is set.
func (s *ReferenceLibraryService) AIConfigured() bool { return s.aiBaseURL != "" }

// Search proxies a contents (semantic) search to GET {AI}/search.
func (s *ReferenceLibraryService) Search(ctx context.Context, query string, topK int, docIDs []string) (*dto.ReferenceLibrarySearchResponse, error) {
	ctx, span := tracing.StartSpan(ctx, "reference_library.ai.search")
	defer span.End()

	q := url.Values{}
	q.Set("q", strings.TrimSpace(query))
	if topK > dto.ReferenceLibraryMaxTopK {
		topK = dto.ReferenceLibraryMaxTopK
	}
	if topK > 0 {
		q.Set("top_k", strconv.Itoa(topK))
	}
	for _, id := range docIDs {
		if id = strings.TrimSpace(id); id != "" {
			q.Add("doc_ids", id)
		}
	}
	endpoint := s.aiBaseURL + "/search?" + q.Encode()

	var out dto.ReferenceLibrarySearchResponse
	if err := s.callSecondBrain(ctx, http.MethodGet, endpoint, nil, &out); err != nil {
		s.metrics.RecordAI("search", "upstream_error")
		return nil, err
	}
	if out.Data == nil {
		out.Data = []dto.ReferenceLibrarySearchHit{}
	}
	s.metrics.RecordAI("search", "ok")
	return &out, nil
}

// Ask proxies a grounded Q&A request to POST {AI}/ask.
func (s *ReferenceLibraryService) Ask(ctx context.Context, req dto.ReferenceLibraryAskRequest) (*dto.ReferenceLibraryAskResponse, error) {
	ctx, span := tracing.StartSpan(ctx, "reference_library.ai.ask")
	defer span.End()

	body, err := json.Marshal(req)
	if err != nil {
		return nil, internalError("encode ask request", err)
	}
	var out dto.ReferenceLibraryAskResponse
	if err := s.callSecondBrain(ctx, http.MethodPost, s.aiBaseURL+"/ask", body, &out); err != nil {
		s.metrics.RecordAI("ask", "upstream_error")
		return nil, err
	}
	if out.Citations == nil {
		out.Citations = []dto.ReferenceLibraryCitation{}
	}
	s.metrics.RecordAI("ask", "ok")
	return &out, nil
}

// Articles proxies a document's article/section index (فهرس المواد) from
// GET {AI}/articles?doc_id={id}. It is OPTIONAL enrichment: the index is a
// nice-to-have table of contents, not core metadata, so ANY failure to obtain it
// degrades to a graceful empty result ({data:[]}) with a nil error rather than
// surfacing a 503/502. Specifically it returns an empty index when the AI service
// is unconfigured, when the upstream returns a non-2xx, or on a transport failure —
// the frontend then simply hides the articles panel.
func (s *ReferenceLibraryService) Articles(ctx context.Context, id uuid.UUID) (*dto.ReferenceLibraryArticlesResponse, error) {
	ctx, span := tracing.StartSpan(ctx, "reference_library.ai.articles")
	defer span.End()

	empty := &dto.ReferenceLibraryArticlesResponse{Data: []dto.ReferenceLibraryArticle{}}
	if !s.AIConfigured() {
		return empty, nil
	}
	q := url.Values{}
	q.Set("doc_id", id.String())
	endpoint := s.aiBaseURL + "/articles?" + q.Encode()

	var out dto.ReferenceLibraryArticlesResponse
	if err := s.callSecondBrain(ctx, http.MethodGet, endpoint, nil, &out); err != nil {
		// Optional enrichment: a non-2xx or transport failure is NOT surfaced — the
		// panel is hidden, not errored. Record + debug-log for observability only.
		s.metrics.RecordAI("articles", "upstream_error")
		s.logger.Debug().Err(err).Str("doc_id", id.String()).Msg("reference library: articles proxy unavailable; returning empty index")
		return empty, nil
	}
	if out.Data == nil {
		out.Data = []dto.ReferenceLibraryArticle{}
	}
	s.metrics.RecordAI("articles", "ok")
	return &out, nil
}

// AskStreamSession is a handle to an OPEN upstream SSE stream from the Second-Brain
// POST /ask/stream endpoint. The handler proxies Body byte-for-byte to the browser
// (flushing after every chunk) and MUST Close() it when done. StatusCode is the
// upstream HTTP status: on a non-2xx the handler drains Body for an error message
// and emits a terminal SSE error frame instead of proxying a half-open stream.
type AskStreamSession struct {
	Body       io.ReadCloser
	StatusCode int
}

// Close releases the upstream body (best-effort, nil-safe).
func (s *AskStreamSession) Close() error {
	if s == nil || s.Body == nil {
		return nil
	}
	return s.Body.Close()
}

// AskStream opens a STREAMING grounded-Q&A request to POST {AI}/ask/stream and
// returns the still-open upstream SSE body for the handler to proxy verbatim. It is
// the streaming twin of Ask: same JSON body ({question,top_k,doc_ids}), same
// never-fabricate contract. Unlike Ask it does NOT buffer the response — the body
// is handed back live so tokens reach the browser as they are produced. The request
// is bound to ctx (the request context), so a client disconnect cancels the upstream
// call; and it uses the no-total-timeout streaming client so a long answer is not
// truncated. A dial/connect failure is surfaced as a 502 AppError (the handler then
// emits a terminal SSE error frame). The caller MUST Close the returned session.
func (s *ReferenceLibraryService) AskStream(ctx context.Context, req dto.ReferenceLibraryAskRequest) (*AskStreamSession, error) {
	ctx, span := tracing.StartSpan(ctx, "reference_library.ai.ask_stream")
	defer span.End()

	body, err := json.Marshal(req)
	if err != nil {
		return nil, internalError("encode ask stream request", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, s.aiBaseURL+"/ask/stream", bytes.NewReader(body))
	if err != nil {
		return nil, internalError("build ask stream request", err)
	}
	httpReq.Header.Set("Accept", "text/event-stream")
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := s.streamClient.Do(httpReq)
	if err != nil {
		s.metrics.RecordAI("ask_stream", "upstream_error")
		return nil, s.badGateway("second brain stream request failed", err)
	}
	return &AskStreamSession{Body: resp.Body, StatusCode: resp.StatusCode}, nil
}

func (s *ReferenceLibraryService) callSecondBrain(ctx context.Context, method, endpoint string, body []byte, out any) error {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	httpReq, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return internalError("build second brain request", err)
	}
	httpReq.Header.Set("Accept", "application/json")
	if body != nil {
		httpReq.Header.Set("Content-Type", "application/json")
	}

	resp, err := s.httpClient.Do(httpReq)
	if err != nil {
		return s.badGateway("second brain request failed", err)
	}
	defer resp.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return s.badGateway("read second brain response failed", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return s.badGateway("second brain returned status "+strconv.Itoa(resp.StatusCode), fmt.Errorf("body: %s", strings.TrimSpace(string(payload))))
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return s.badGateway("decode second brain response failed", err)
	}
	return nil
}

func (s *ReferenceLibraryService) badGateway(message string, err error) error {
	s.logger.Warn().Err(err).Msg(message)
	return &apperrors.AppError{
		Status:  http.StatusBadGateway,
		Code:    "SECOND_BRAIN_UNAVAILABLE",
		Message: message,
		Err:     err,
	}
}

// referenceLibraryQueryKey is the canonical cache key for a browse query — the
// normalized filter tuple. It is stable across equivalent requests so the
// read-through cache hits regardless of param order/case.
func referenceLibraryQueryKey(f model.ReferenceLibraryListFilters) string {
	return strings.Join([]string{
		"s=" + strings.ToLower(strings.TrimSpace(f.Search)),
		"c=" + strings.TrimSpace(f.Category),
		"t=" + strings.TrimSpace(f.DocType),
		"g=" + strings.TrimSpace(f.Tag),
		"p=" + strconv.Itoa(f.Page),
		"n=" + strconv.Itoa(f.PerPage),
	}, "|")
}

// -----------------------------------------------------------------------------
// In-process read-through cache for the static/global corpus. Keyed by the corpus
// fingerprint so an ingestion UPSERT transparently invalidates every entry.
// -----------------------------------------------------------------------------

type referenceLibraryCache struct {
	ttl time.Duration
	mu  sync.Mutex

	fp     string
	fpAt   time.Time
	facets *model.ReferenceLibraryFacets
	fpFor  string // fingerprint the facets/list caches were populated under
	lists  map[string]cachedReferenceList
}

type cachedReferenceList struct {
	items []model.ReferenceLibraryDocument
	total int
}

func newReferenceLibraryCache(ttl time.Duration) *referenceLibraryCache {
	return &referenceLibraryCache{ttl: ttl, lists: make(map[string]cachedReferenceList)}
}

func (c *referenceLibraryCache) fingerprint() (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.fp != "" && time.Since(c.fpAt) < c.ttl {
		return c.fp, true
	}
	return "", false
}

func (c *referenceLibraryCache) setFingerprint(fp string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if fp != c.fpFor {
		// Corpus changed → drop payload caches populated under the old fingerprint.
		c.facets = nil
		c.lists = make(map[string]cachedReferenceList)
		c.fpFor = fp
	}
	c.fp = fp
	c.fpAt = time.Now()
}

func (c *referenceLibraryCache) getList(key string) ([]model.ReferenceLibraryDocument, int, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.lists[key]
	if !ok {
		return nil, 0, false
	}
	return entry.items, entry.total, true
}

func (c *referenceLibraryCache) setList(key string, items []model.ReferenceLibraryDocument, total int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lists[key] = cachedReferenceList{items: items, total: total}
}

func (c *referenceLibraryCache) getFacets(fp string) (*model.ReferenceLibraryFacets, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.facets != nil && c.fpFor == fp {
		return c.facets, true
	}
	return nil, false
}

func (c *referenceLibraryCache) setFacets(fp string, facets *model.ReferenceLibraryFacets) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.fpFor = fp
	c.facets = facets
}
