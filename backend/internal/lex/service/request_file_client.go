package service

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	apperrors "github.com/clario360/platform/internal/errors"
)

// RequestFileMetadata is the subset of file-service metadata trusted when a
// file is linked to a legal request.
type RequestFileMetadata struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenant_id"`
	OriginalName    string  `json:"original_name"`
	SanitizedName   string  `json:"sanitized_name"`
	ContentType     string  `json:"content_type"`
	SizeBytes       int64   `json:"size_bytes"`
	ChecksumSHA256  string  `json:"checksum_sha256"`
	VirusScanStatus string  `json:"virus_scan_status"`
	UploadedBy      string  `json:"uploaded_by"`
	Suite           string  `json:"suite"`
	EntityType      *string `json:"entity_type,omitempty"`
	EntityID        *string `json:"entity_id,omitempty"`
	VersionNumber   int     `json:"version_number"`
}

// RequestFileClient performs service-authenticated metadata and byte reads.
// Browser callers never receive or use the underlying generic file endpoint.
type RequestFileClient struct {
	baseURL     string
	httpClient  *http.Client
	tokenSource FileServiceTokenSource
}

func NewRequestFileClient(baseURL string) *RequestFileClient {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil
	}
	return &RequestFileClient{baseURL: baseURL, httpClient: &http.Client{Timeout: 120 * time.Second}}
}

func (c *RequestFileClient) BindTokenSource(source FileServiceTokenSource) {
	if c != nil {
		c.tokenSource = source
	}
}

func (c *RequestFileClient) Ready() bool {
	return c != nil && c.baseURL != "" && c.tokenSource != nil
}

func (c *RequestFileClient) Metadata(ctx context.Context, tenantID, fileID string) (*RequestFileMetadata, error) {
	resp, err := c.do(ctx, tenantID, http.MethodGet, "/api/v1/files/"+fileID, "application/json")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var metadata RequestFileMetadata
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&metadata); err != nil {
		return nil, requestFileUnavailable("decode file metadata", err)
	}
	return &metadata, nil
}

func (c *RequestFileClient) Download(ctx context.Context, tenantID, fileID string) (*FileObject, error) {
	resp, err := c.do(ctx, tenantID, http.MethodGet, "/api/v1/files/"+fileID+"/download", "application/octet-stream")
	if err != nil {
		return nil, err
	}
	obj := &FileObject{
		Body:           resp.Body,
		ContentType:    resp.Header.Get("Content-Type"),
		ContentLength:  resp.ContentLength,
		ChecksumSHA256: resp.Header.Get("X-Checksum-SHA256"),
		Filename:       requestFilenameFromDisposition(resp.Header.Get("Content-Disposition")),
	}
	if obj.ContentType == "" {
		obj.ContentType = "application/octet-stream"
	}
	return obj, nil
}

func (c *RequestFileClient) do(ctx context.Context, tenantID, method, path, accept string) (*http.Response, error) {
	if !c.Ready() {
		return nil, &apperrors.AppError{Status: http.StatusBadGateway, Code: "LEGAL_REQUEST_FILE_SERVICE_UNCONFIGURED", Message: "legal request file service is not configured"}
	}
	token, err := c.tokenSource.Token(ctx, tenantID)
	if err != nil {
		return nil, requestFileUnavailable("mint file-service token", err)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, nil)
	if err != nil {
		return nil, requestFileUnavailable("build file-service request", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-Tenant-ID", tenantID)
	req.Header.Set("Accept", accept)
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, requestFileUnavailable("file-service request failed", err)
	}
	if resp.StatusCode == http.StatusNotFound {
		resp.Body.Close()
		return nil, notFoundError("attached file not found")
	}
	if resp.StatusCode == http.StatusForbidden {
		resp.Body.Close()
		return nil, forbiddenError("attached file is unavailable")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		resp.Body.Close()
		return nil, requestFileUnavailable("file-service returned status "+strconv.Itoa(resp.StatusCode), fmt.Errorf("body: %s", strings.TrimSpace(string(snippet))))
	}
	return resp, nil
}

func requestFileUnavailable(message string, err error) error {
	return &apperrors.AppError{Status: http.StatusBadGateway, Code: "LEGAL_REQUEST_FILE_SERVICE_UNAVAILABLE", Message: message, Err: err}
}

func requestFilenameFromDisposition(header string) string {
	if _, params, err := mime.ParseMediaType(header); err == nil {
		return params["filename"]
	}
	return ""
}
