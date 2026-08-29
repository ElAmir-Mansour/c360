package handler

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/service"
)

// marketplaceService is the operations the marketplace handler needs. The
// concrete *service.MarketplaceService satisfies it. Kept as an interface so the
// handler is unit-testable with a fake.
type marketplaceService interface {
	Browse(ctx context.Context, tenantID string, f service.MarketplaceBrowseFilter) ([]*model.MarketplaceItem, error)
	Versions(ctx context.Context, tenantID, kind, key string) ([]*model.MarketplaceItem, error)
	GetItem(ctx context.Context, tenantID, id string) (*model.MarketplaceItem, error)
	Publish(ctx context.Context, req service.PublishItemRequest) (*model.MarketplaceItem, error)
	Review(ctx context.Context, tenantID, itemID, reviewedBy, reason string) (*model.MarketplaceItem, error)
	Install(ctx context.Context, tenantID, userID, itemID, nameOverride, descOverride string) (*service.InstallResult, error)
}

// MarketplaceHandler serves the governed marketplace HTTP surface.
type MarketplaceHandler struct {
	service marketplaceService
	logger  zerolog.Logger
}

// NewMarketplaceHandler creates a MarketplaceHandler.
func NewMarketplaceHandler(svc marketplaceService, logger zerolog.Logger) *MarketplaceHandler {
	return &MarketplaceHandler{
		service: svc,
		logger:  logger.With().Str("handler", "workflow_marketplace").Logger(),
	}
}

// Routes returns a chi.Router mounting the marketplace endpoints. RBAC is applied
// by the mounting group (marketplaceRBAC): browse=read, publish/install=write,
// review=admin.
func (h *MarketplaceHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/", h.Browse)
	r.Post("/", h.Publish)
	r.Get("/{key}", h.Versions)
	r.Post("/{id}/review", h.Review)
	r.Post("/{id}/install", h.Install)

	return r
}

// Browse handles GET / — lists items visible to the tenant (globals + own),
// filtered by kind / category / maturity / status. Defaults to the gallery view
// (latest version per key) unless ?all_versions=true.
func (h *MarketplaceHandler) Browse(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	q := r.URL.Query()
	f := service.MarketplaceBrowseFilter{
		Kind:         q.Get("kind"),
		Category:     q.Get("category"),
		Maturity:     q.Get("maturity"),
		Status:       q.Get("status"),
		LatestPerKey: q.Get("all_versions") != "true",
	}

	items, err := h.service.Browse(r.Context(), user.TenantID, f)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Msg("failed to browse marketplace")
		handleServiceError(w, err)
		return
	}

	out := make([]marketplaceItemResponse, len(items))
	for i, it := range items {
		out[i] = toMarketplaceItemResponse(it)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"items": out,
		"total": len(out),
	})
}

// Versions handles GET /{key} — lists every version of one logical item, newest
// semver first. The optional ?kind= selects template (default) or connector.
func (h *MarketplaceHandler) Versions(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	key := urlParam(r, "key")
	if key == "" {
		writeError(w, http.StatusBadRequest, "INVALID_KEY", "item key is required")
		return
	}
	kind := r.URL.Query().Get("kind")

	items, err := h.service.Versions(r.Context(), user.TenantID, kind, key)
	if err != nil {
		h.logger.Error().Err(err).Str("key", key).Msg("failed to list marketplace item versions")
		handleServiceError(w, err)
		return
	}

	out := make([]marketplaceItemResponse, len(items))
	for i, it := range items {
		out[i] = toMarketplaceItemResponse(it)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"key":      key,
		"versions": out,
		"total":    len(out),
	})
}

// publishRequestBody is the POST / body.
type publishRequestBody struct {
	Kind            string            `json:"kind"`
	Key             string            `json:"key"`
	TitleI18n       map[string]string `json:"title_i18n"`
	DescriptionI18n map[string]string `json:"description_i18n"`
	Category        string            `json:"category"`
	Tags            []string          `json:"tags"`
	Version         string            `json:"version"`
	Maturity        string            `json:"maturity"`
	Publisher       string            `json:"publisher"`
	Payload         json.RawMessage   `json:"payload"`
	Source          string            `json:"source"`
	// Global, when true and the caller is permitted, publishes a platform-global
	// item. Default false publishes a tenant-private item. (Cross-tenant global
	// publish is additionally gated at the RBAC layer as a write action; a
	// stricter platform-only gate can be layered later.)
	Global bool `json:"global"`
}

// Publish handles POST / — publishes (creates/versions) a marketplace item. The
// item is born unreviewed (not installable) until it passes the four-eyes review.
func (h *MarketplaceHandler) Publish(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}

	var body publishRequestBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_BODY", "invalid request body")
		return
	}

	scope := user.TenantID
	if body.Global {
		scope = "" // platform-global item.
	}

	item, err := h.service.Publish(r.Context(), service.PublishItemRequest{
		TenantScope:     scope,
		Kind:            body.Kind,
		Key:             body.Key,
		TitleI18n:       body.TitleI18n,
		DescriptionI18n: body.DescriptionI18n,
		Category:        body.Category,
		Tags:            body.Tags,
		Version:         body.Version,
		Maturity:        body.Maturity,
		Publisher:       body.Publisher,
		Payload:         body.Payload,
		Source:          body.Source,
		PublishedBy:     user.ID,
	})
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Str("key", body.Key).Msg("failed to publish marketplace item")
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, toMarketplaceItemResponse(item))
}

// reviewRequestBody is the POST /{id}/review body.
type reviewRequestBody struct {
	Reason string `json:"reason"`
}

// Review handles POST /{id}/review — the four-eyes gate. The acting user is the
// reviewer; the service rejects a self-review (reviewer == publisher) fail-closed.
func (h *MarketplaceHandler) Review(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "item id is required")
		return
	}

	var body reviewRequestBody
	if r.Body != nil && r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}

	item, err := h.service.Review(r.Context(), user.TenantID, id, user.ID, body.Reason)
	if err != nil {
		h.logger.Error().Err(err).Str("marketplace_item_id", id).Msg("failed to review marketplace item")
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, toMarketplaceItemResponse(item))
}

// installRequestBody is the POST /{id}/install body.
type installRequestBody struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// Install handles POST /{id}/install — installs a reviewed item into the tenant.
// Idempotent: re-installing the same version returns 200 with the existing
// record; a first install returns 201.
func (h *MarketplaceHandler) Install(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "item id is required")
		return
	}

	var body installRequestBody
	if r.Body != nil && r.ContentLength > 0 {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}

	res, err := h.service.Install(r.Context(), user.TenantID, user.ID, id, body.Name, body.Description)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", user.TenantID).Str("marketplace_item_id", id).Msg("failed to install marketplace item")
		handleServiceError(w, err)
		return
	}

	resp := map[string]interface{}{
		"item":         toMarketplaceItemResponse(res.Item),
		"already_done": res.AlreadyDone,
	}
	if res.Install != nil {
		resp["install"] = res.Install
	}
	if res.Definition != nil {
		resp["definition"] = dto.DefinitionToResponse(res.Definition)
	}
	if res.ConnectorKey != "" {
		resp["connector_key"] = res.ConnectorKey
	}

	status := http.StatusCreated
	if res.AlreadyDone {
		status = http.StatusOK
	}
	writeJSON(w, status, resp)
}

// marketplaceItemResponse is the API response shape for a marketplace item. The
// raw payload is omitted from the LIST/browse view for brevity but surfaced on a
// version listing so a gallery preview can render it.
type marketplaceItemResponse struct {
	ID              string            `json:"id"`
	TenantID        string            `json:"tenant_id,omitempty"`
	Global          bool              `json:"global"`
	Kind            string            `json:"kind"`
	Key             string            `json:"key"`
	Title           string            `json:"title"`
	Description     string            `json:"description"`
	TitleI18n       map[string]string `json:"title_i18n,omitempty"`
	DescriptionI18n map[string]string `json:"description_i18n,omitempty"`
	Category        string            `json:"category"`
	Tags            []string          `json:"tags"`
	Version         string            `json:"version"`
	Maturity        string            `json:"maturity"`
	Publisher       string            `json:"publisher"`
	Status          string            `json:"status"`
	Installable     bool              `json:"installable"`
	Source          string            `json:"source"`
	Checksum        string            `json:"checksum"`
	PublishedBy     string            `json:"published_by"`
	ReviewedBy      *string           `json:"reviewed_by,omitempty"`
	CreatedAt       string            `json:"created_at"`
}

func toMarketplaceItemResponse(it *model.MarketplaceItem) marketplaceItemResponse {
	resp := marketplaceItemResponse{
		ID:              it.ID,
		TenantID:        it.TenantScope,
		Global:          it.TenantScope == "",
		Kind:            it.Kind,
		Key:             it.Key,
		Title:           it.Title,
		Description:     it.Description,
		TitleI18n:       it.TitleI18n,
		DescriptionI18n: it.DescriptionI18n,
		Category:        it.Category,
		Tags:            it.Tags,
		Version:         it.Version,
		Maturity:        it.Maturity,
		Publisher:       it.Publisher,
		Status:          it.Status,
		Installable:     it.Status == model.MarketplaceStatusPublished,
		Source:          it.Source,
		Checksum:        it.Checksum,
		PublishedBy:     it.PublishedBy,
		ReviewedBy:      it.ReviewedBy,
		CreatedAt:       it.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
	if resp.Tags == nil {
		resp.Tags = []string{}
	}
	return resp
}
