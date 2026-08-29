package storageoffload

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ArrayClient is the narrow REST surface the generic array-gateway adapter talks
// to. It is deliberately tiny — a single Do — so the adapter can be exercised
// against an httptest.Server in tests without pulling in a vendor SDK, and so no
// heavy new module enters go.mod. A deployment supplies an *http.Client-backed
// implementation pointed at its gateway or concrete vendor adapter (with mTLS /
// token auth configured on the transport).
type ArrayClient interface {
	// Do issues an array management request (method, path under the array
	// endpoint, optional JSON body) and decodes a JSON response into out.
	Do(ctx context.Context, method, path string, body any, out any) error
}

// HTTPArrayClient is the stdlib-only ArrayClient: it talks to the configured
// array gateway/adapter API over net/http with a bearer token. No client-go, no
// vendor SDK.
type HTTPArrayClient struct {
	BaseURL string
	Token   string
	HTTP    *http.Client
}

// NewHTTPArrayClient builds an HTTPArrayClient with a sane default timeout.
func NewHTTPArrayClient(baseURL, token string, hc *http.Client) *HTTPArrayClient {
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	return &HTTPArrayClient{BaseURL: strings.TrimRight(baseURL, "/"), Token: token, HTTP: hc}
}

// Do issues a JSON request against the array management API.
func (c *HTTPArrayClient) Do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("storageoffload array client: marshaling body: %w", err)
		}
		reader = strings.NewReader(string(buf))
	}
	url := c.BaseURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return fmt.Errorf("storageoffload array client: building request: %w", err)
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("storageoffload array client: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("storageoffload array client: %s %s: status %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("storageoffload array client: decoding response: %w", err)
		}
	}
	return nil
}

// arraySnapshotResponse is the common shape the adapters decode from an array's
// snapshot API. Real arrays return more, but the orchestrator only needs the
// handle, state, and (once ready) the captured file list.
type arraySnapshotResponse struct {
	Handle string          `json:"handle"`
	State  string          `json:"state"`
	Files  []ManifestEntry `json:"files"`
}

// arrayProvider is a generic REST-driven adapter for deployments that put a
// vendor-specific gateway behind the common snapshot contract below. It is not a
// vendor SDK and it does not claim native ONTAP/PowerStore API compatibility:
// those integrations must be provided as concrete ArrayClient/gateway wiring.
// When no ArrayClient is wired every call returns ErrProviderUnavailable so the
// orchestrator surfaces a clear configuration error rather than panicking.
type arrayProvider struct {
	kind   string
	client ArrayClient
}

// NewArrayProvider declares a REST-gateway-backed array provider behind the
// StorageOffloadProvider interface. kind is the catalog/provider label; client
// must implement the common snapshot contract this adapter calls. Native vendor
// APIs should be hidden behind a concrete ArrayClient/gateway, not assumed to
// match these generic paths.
func NewArrayProvider(kind string, client ArrayClient) StorageOffloadProvider {
	return &arrayProvider{kind: kind, client: client}
}

func (a *arrayProvider) Name() string { return a.kind }

func (a *arrayProvider) require() error {
	if a.client == nil {
		return fmt.Errorf("%s: %w", a.kind, ErrProviderUnavailable)
	}
	return nil
}

func (a *arrayProvider) CreateSnapshot(ctx context.Context, req SnapshotRequest) (SnapshotInfo, error) {
	if err := a.require(); err != nil {
		return SnapshotInfo{}, err
	}
	body := map[string]any{
		"volume":        req.VolumeName,
		"source":        req.SourceLocation,
		"parent_handle": req.ParentHandle,
	}
	var resp arraySnapshotResponse
	if err := a.client.Do(ctx, http.MethodPost, "/snapshots", body, &resp); err != nil {
		return SnapshotInfo{}, err
	}
	return toSnapshotInfo(req, resp), nil
}

func (a *arrayProvider) SnapshotStatus(ctx context.Context, req SnapshotRequest, handle string) (SnapshotInfo, error) {
	if err := a.require(); err != nil {
		return SnapshotInfo{}, err
	}
	var resp arraySnapshotResponse
	if err := a.client.Do(ctx, http.MethodGet, "/snapshots/"+handle, nil, &resp); err != nil {
		return SnapshotInfo{}, err
	}
	if resp.Handle == "" {
		resp.Handle = handle
	}
	return toSnapshotInfo(req, resp), nil
}

func (a *arrayProvider) ListSnapshots(ctx context.Context, req SnapshotRequest) ([]string, error) {
	if err := a.require(); err != nil {
		return nil, err
	}
	var resp struct {
		Handles []string `json:"handles"`
	}
	if err := a.client.Do(ctx, http.MethodGet, "/volumes/"+req.VolumeName+"/snapshots", nil, &resp); err != nil {
		return nil, err
	}
	return resp.Handles, nil
}

func (a *arrayProvider) ReplicateSnapshot(ctx context.Context, req SnapshotRequest, handle, toTarget, baseTarget string) (int64, error) {
	if err := a.require(); err != nil {
		return 0, err
	}
	body := map[string]any{
		"target":      toTarget,
		"base_target": baseTarget,
	}
	var resp struct {
		BytesTransferred int64 `json:"bytes_transferred"`
	}
	if err := a.client.Do(ctx, http.MethodPost, "/snapshots/"+handle+"/replicate", body, &resp); err != nil {
		return 0, err
	}
	return resp.BytesTransferred, nil
}

func (a *arrayProvider) DeleteSnapshot(ctx context.Context, req SnapshotRequest, handle string) error {
	if err := a.require(); err != nil {
		return err
	}
	return a.client.Do(ctx, http.MethodDelete, "/snapshots/"+handle, nil, nil)
}

func toSnapshotInfo(req SnapshotRequest, resp arraySnapshotResponse) SnapshotInfo {
	info := SnapshotInfo{Handle: resp.Handle}
	switch resp.State {
	case "ready", "online", "completed":
		info.State = ProviderSnapshotReady
	case "creating", "in_progress", "pending":
		info.State = ProviderSnapshotCreating
	case "missing", "not_found":
		info.State = ProviderSnapshotMissing
	default:
		info.State = ProviderSnapshotError
	}
	if info.State == ProviderSnapshotReady && len(resp.Files) > 0 {
		m := &Manifest{Volume: req.VolumeName, Entries: resp.Files}
		info.Manifest = m
		info.ChangedBytes = m.TotalSize()
	}
	return info
}

var _ StorageOffloadProvider = (*arrayProvider)(nil)
