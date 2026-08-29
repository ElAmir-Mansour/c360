package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// archiveDocReader is the slice of the document repository this handler needs to
// read a document's stamped archive metadata for the GET status endpoint. It is
// satisfied by *repository.DocumentRepository (store.Documents).
type archiveDocReader interface {
	Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalDocument, error)
}

// archiveEndpointLister is the slice of the integration-endpoint repository this
// handler needs to resolve the active e-archive connector for a tenant. It is
// satisfied by *repository.IntegrationEndpointRepository (store.IntegrationEndpoints).
type archiveEndpointLister interface {
	List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error)
}

// DocumentArchiveHandler exposes the document-scoped e-archive action
// (Othaim PRD 14.1). It routes a document/version push through the EXISTING
// integration registry Invoke plumbing (breaker + egress + secret resolution +
// DLQ + metrics + audit) so no custody logic is duplicated. It is intentionally
// mounted at the document write tier (lex:write) — a document owner archives
// their own document without needing integration-admin (lex:integration:manage)
// rights; the generic /integrations/{id}/invoke path keeps that higher tier.
type DocumentArchiveHandler struct {
	baseHandler
	registry  *service.IntegrationRegistryService
	endpoints archiveEndpointLister
	docs      archiveDocReader
}

// NewDocumentArchiveHandler builds the handler. registry + endpoints are
// required; docs powers the GET status read (nil-safe: GET reports no data).
func NewDocumentArchiveHandler(registry *service.IntegrationRegistryService, endpoints archiveEndpointLister, docs archiveDocReader, logger zerolog.Logger) *DocumentArchiveHandler {
	return &DocumentArchiveHandler{
		baseHandler: baseHandler{logger: logger},
		registry:    registry,
		endpoints:   endpoints,
		docs:        docs,
	}
}

// Archive pushes a document (its latest version) to the active e-archive
// connector and returns the sanitized InvokeResult plus the freshly stamped
// archive metadata block for immediate rendering.
//
//	POST /documents/{id}/archive   body (optional): {"force": bool}
//
// 409 NO_ARCHIVE_CONNECTOR when the tenant has no ACTIVE archiving endpoint.
func (h *DocumentArchiveHandler) Archive(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	docID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req struct {
		Force bool `json:"force"`
	}
	// Body is optional — an empty/absent body is a valid non-forced archive.
	_ = suiteapi.DecodeJSON(r, &req)

	if h.registry == nil || h.endpoints == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "ARCHIVE_UNAVAILABLE", "e-archive is not configured on this deployment", nil)
		return
	}

	endpoint, resolveErr := h.resolveActiveEndpoint(r.Context(), tenantID)
	if resolveErr != nil {
		if errors.Is(resolveErr, errNoArchiveConnector) {
			suiteapi.WriteError(w, r, http.StatusConflict, "NO_ARCHIVE_CONNECTOR",
				"no active e-archive connector is configured for this tenant; activate an archiving integration first", nil)
			return
		}
		h.writeError(w, r, resolveErr)
		return
	}

	payload := map[string]any{
		"document_id": docID.String(),
		"force":       req.Force,
	}
	result, invokeErr := h.registry.Invoke(r.Context(), tenantID, userID, endpoint.ID, "archive", payload)
	if invokeErr != nil {
		// A ran-but-failed invoke returns its sanitized result alongside the error.
		h.writeError(w, r, invokeErr)
		return
	}

	resp := map[string]any{
		"result":       result,
		"endpoint_id":  endpoint.ID.String(),
		"connector":    endpoint.Code,
		"archive":      h.readArchiveMetadata(r.Context(), tenantID, docID),
		"reversible":   true,
		"worm_enabled": false,
	}
	suiteapi.WriteData(w, http.StatusOK, resp)
}

// Status returns the document's stamped archive metadata block without a full
// document fetch.
//
//	GET /documents/{id}/archive
//
// 200 with {archived:true, archive:{...}} when archived; 200 {archived:false}
// otherwise.
func (h *DocumentArchiveHandler) Status(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	docID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	archive := h.readArchiveMetadata(r.Context(), tenantID, docID)
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"archived": archive != nil,
		"archive":  archive,
	})
}

// errNoArchiveConnector is the sentinel for "no active archiving endpoint".
var errNoArchiveConnector = errors.New("lex/document-archive: no active archiving connector")

// resolveActiveEndpoint returns the first ACTIVE archiving endpoint for a tenant,
// or errNoArchiveConnector when none exists.
func (h *DocumentArchiveHandler) resolveActiveEndpoint(ctx context.Context, tenantID uuid.UUID) (model.IntegrationEndpoint, error) {
	endpoints, err := h.endpoints.List(ctx, tenantID, string(model.IntegrationKindArchiving), string(model.IntegrationStatusActive))
	if err != nil {
		return model.IntegrationEndpoint{}, err
	}
	if len(endpoints) == 0 {
		return model.IntegrationEndpoint{}, errNoArchiveConnector
	}
	return endpoints[0], nil
}

// readArchiveMetadata loads the document and returns its Metadata["archive"] block
// (nil when unarchived / not found). Never surfaces a load error to the caller —
// the archive status is best-effort context, not an authorization decision.
func (h *DocumentArchiveHandler) readArchiveMetadata(ctx context.Context, tenantID, docID uuid.UUID) map[string]any {
	if h.docs == nil {
		return nil
	}
	doc, err := h.docs.Get(ctx, tenantID, docID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			h.logger.Debug().Err(err).Str("document_id", docID.String()).Msg("read archive metadata failed")
		}
		return nil
	}
	if doc == nil || doc.Metadata == nil {
		return nil
	}
	if archive, ok := doc.Metadata["archive"].(map[string]any); ok {
		return archive
	}
	return nil
}
