package service

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/observability/tracing"
)

// FileServiceTokenSource mints a bearer credential authorizing a server-to-server
// file-service call as the given tenant. Both the reference-library byte proxy
// and legal-request evidence proxy use short-lived, separately attributable
// service principals; file-service still authenticates every /api/v1/files call.
type FileServiceTokenSource interface {
	// Token returns a bearer token for tenantID. Implementations SHOULD cache and
	// refresh; an error means the byte path is unavailable (handler → 502/volume).
	Token(ctx context.Context, tenantID string) (string, error)
}

// FileServiceClient is a minimal, production-shaped HTTP client for the platform
// file-service byte store (cmd/file-service, GET /api/v1/files/{id}/download). It
// is used ONLY by the reference-library Download proxy for the Option-A byte path
// and reuses file-service's real streaming/checksum contract verbatim. The volume
// fallback (design §2.4) does NOT use this client.
type FileServiceClient struct {
	baseURL     string
	httpClient  *http.Client
	tokenSource FileServiceTokenSource
	logger      zerolog.Logger
}

// FileServiceClientConfig configures the client.
type FileServiceClientConfig struct {
	// BaseURL is the file-service origin (e.g. http://file-service:8091 or the
	// gateway file route). Trailing slash is trimmed.
	BaseURL     string
	HTTPClient  *http.Client
	TokenSource FileServiceTokenSource
}

// NewFileServiceClient builds the client. Returns nil when BaseURL is empty (the
// byte path is then "not configured" and the handler falls back to the volume /
// returns a clear 502), so callers can wire it unconditionally.
func NewFileServiceClient(cfg FileServiceClientConfig, logger zerolog.Logger) *FileServiceClient {
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		return nil
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 120 * time.Second}
	}
	return &FileServiceClient{
		baseURL:     base,
		httpClient:  client,
		tokenSource: cfg.TokenSource,
		logger:      logger.With().Str("component", "lex-file-service-client").Logger(),
	}
}

// WithTokenSource binds (or rebinds) the token source. Used at RegisterRoutes time
// to inject the JWT-minting source once the shared JWTManager is in scope. Returns
// the receiver for chaining; nil-safe.
func (c *FileServiceClient) WithTokenSource(ts FileServiceTokenSource) *FileServiceClient {
	if c == nil {
		return nil
	}
	c.tokenSource = ts
	return c
}

// Ready reports whether the client can actually authenticate a call (base URL set
// AND a token source bound). A configured-but-unbound client is treated as not
// ready so the handler can fall back cleanly.
func (c *FileServiceClient) Ready() bool {
	return c != nil && c.baseURL != "" && c.tokenSource != nil
}

// FileObject is a streamed file-service object plus the integrity/serving metadata
// the reference-library Download handler needs to set validators and stream.
type FileObject struct {
	Body           io.ReadCloser
	ContentType    string
	ContentLength  int64
	ChecksumSHA256 string
	Filename       string
}

// Download fetches file fileID as tenantID from file-service, streaming the body
// back (the caller owns closing Body). It mints a bearer token via the token
// source and sends X-Tenant-ID so file-service resolves the object under the
// library tenant. A 404 upstream maps to a 404 AppError; any other non-2xx (or a
// transport/auth failure) maps to a 502 so the caller never leaks a partial body.
func (c *FileServiceClient) Download(ctx context.Context, tenantID, fileID string) (*FileObject, error) {
	if !c.Ready() {
		return nil, &apperrors.AppError{
			Status:  http.StatusBadGateway,
			Code:    "REFERENCE_LIBRARY_FILE_SERVICE_UNCONFIGURED",
			Message: "reference library file-service byte path is not configured",
		}
	}
	ctx, span := tracing.StartSpan(ctx, "reference_library.file_service.download")
	defer span.End()

	token, err := c.tokenSource.Token(ctx, tenantID)
	if err != nil {
		return nil, c.badGateway("mint file-service service token", err)
	}

	endpoint := fmt.Sprintf("%s/api/v1/files/%s/download", c.baseURL, fileID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, c.badGateway("build file-service request", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Tenant-ID", tenantID)
	req.Header.Set("Accept", "application/pdf, application/octet-stream")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, c.badGateway("file-service request failed", err)
	}
	if resp.StatusCode == http.StatusNotFound {
		_ = resp.Body.Close()
		return nil, notFoundError("reference library file bytes not found")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Drain a bounded slice of the error body for the log, then close.
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		_ = resp.Body.Close()
		return nil, c.badGateway(
			"file-service returned status "+strconv.Itoa(resp.StatusCode),
			fmt.Errorf("body: %s", strings.TrimSpace(string(snippet))),
		)
	}

	obj := &FileObject{
		Body:           resp.Body,
		ContentType:    resp.Header.Get("Content-Type"),
		ContentLength:  resp.ContentLength,
		ChecksumSHA256: resp.Header.Get("X-Checksum-SHA256"),
		Filename:       filenameFromContentDisposition(resp.Header.Get("Content-Disposition")),
	}
	if obj.ContentType == "" {
		obj.ContentType = "application/pdf"
	}
	return obj, nil
}

func (c *FileServiceClient) badGateway(message string, err error) error {
	c.logger.Warn().Err(err).Msg(message)
	return &apperrors.AppError{
		Status:  http.StatusBadGateway,
		Code:    "REFERENCE_LIBRARY_FILE_SERVICE_UNAVAILABLE",
		Message: message,
		Err:     err,
	}
}

// filenameFromContentDisposition extracts the filename parameter from a
// Content-Disposition header, returning "" when absent/unparseable.
func filenameFromContentDisposition(header string) string {
	if header == "" {
		return ""
	}
	if _, params, err := mime.ParseMediaType(header); err == nil {
		return params["filename"]
	}
	return ""
}

// -----------------------------------------------------------------------------
// JWT token source — mints short-lived library-tenant JWTs via the shared RS256
// JWTManager. Because every service validates JWTs with the same public key,
// a token lex mints is accepted by file-service's mw.Auth. Tokens are cached
// per-tenant and refreshed before expiry so a burst of downloads does not re-sign
// on every request. Signing REQUIRES the private key (AUTH_RSA_PRIVATE_KEY_PEM);
// a validation-only lex deployment cannot mint — Token() then errors and the
// handler falls back to the volume path / returns 502 (documented, never faked).
// -----------------------------------------------------------------------------

// referenceLibraryServiceUserID is the stable synthetic principal the reference
// library presents to file-service for server-to-server byte reads. It is not a
// real user; it exists only to make cross-service reads attributable in the
// file_access_log.
const (
	referenceLibraryServiceUserID  = "00000000-0000-0000-0000-00000000c360"
	referenceLibraryServiceEmail   = "reference-library@service.watheeq"
	requestAttachmentServiceUserID = "00000000-0000-0000-0000-00000000c361"
	requestAttachmentServiceEmail  = "legal-request-attachments@service.watheeq"
)

type jwtFileServiceTokenSource struct {
	mgr    *auth.JWTManager
	userID string
	email  string
	roles  []string

	mu    sync.Mutex
	cache map[string]cachedServiceToken
}

type cachedServiceToken struct {
	token     string
	expiresAt time.Time
}

// NewJWTFileServiceTokenSource builds a token source backed by the shared RS256
// JWTManager. Returns nil when mgr is nil so callers can wire it unconditionally.
func NewJWTFileServiceTokenSource(mgr *auth.JWTManager) FileServiceTokenSource {
	return newJWTFileServiceTokenSource(mgr, referenceLibraryServiceUserID, referenceLibraryServiceEmail)
}

// NewJWTRequestFileServiceTokenSource gives legal-request attachment reads a
// distinct synthetic principal. File-service access logs can therefore tell a
// governed request-review download from a reference-library corpus read.
func NewJWTRequestFileServiceTokenSource(mgr *auth.JWTManager) FileServiceTokenSource {
	return newJWTFileServiceTokenSource(mgr, requestAttachmentServiceUserID, requestAttachmentServiceEmail)
}

func newJWTFileServiceTokenSource(mgr *auth.JWTManager, userID, email string) FileServiceTokenSource {
	if mgr == nil {
		return nil
	}
	return &jwtFileServiceTokenSource{
		mgr:    mgr,
		userID: userID,
		email:  email,
		roles:  []string{"service"},
		cache:  make(map[string]cachedServiceToken),
	}
}

func (s *jwtFileServiceTokenSource) Token(_ context.Context, tenantID string) (string, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return "", fmt.Errorf("file-service token: empty tenant id")
	}
	now := time.Now()

	s.mu.Lock()
	if cached, ok := s.cache[tenantID]; ok && now.Before(cached.expiresAt) {
		token := cached.token
		s.mu.Unlock()
		return token, nil
	}
	s.mu.Unlock()

	pair, err := s.mgr.GenerateTokenPair(s.userID, tenantID, s.email, s.roles, "")
	if err != nil {
		return "", fmt.Errorf("mint file-service service token: %w", err)
	}
	// Refresh a minute before the real expiry to avoid racing an in-flight request
	// against a token that expires mid-download.
	refreshAt := pair.ExpiresAt.Add(-1 * time.Minute)
	if !refreshAt.After(now) {
		refreshAt = now.Add(30 * time.Second)
	}

	s.mu.Lock()
	s.cache[tenantID] = cachedServiceToken{token: pair.AccessToken, expiresAt: refreshAt}
	s.mu.Unlock()

	return pair.AccessToken, nil
}
