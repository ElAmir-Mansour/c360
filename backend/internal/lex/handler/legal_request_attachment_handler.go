package handler

import (
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// LegalRequestAttachmentHandler exposes request-authorized attachment reads.
// It deliberately proxies bytes instead of returning the generic file-service
// URL, so object-level request/task authorization cannot be bypassed.
type LegalRequestAttachmentHandler struct {
	baseHandler
	service *service.LegalRequestAttachmentService
}

func NewLegalRequestAttachmentHandler(svc *service.LegalRequestAttachmentService, logger zerolog.Logger) *LegalRequestAttachmentHandler {
	return &LegalRequestAttachmentHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

func (h *LegalRequestAttachmentHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.List(r.Context(), tenantID, userID, requestID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *LegalRequestAttachmentHandler) Download(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	attachmentID, err := suiteapi.UUIDParam(r, "attachmentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	download, err := h.service.OpenDownload(r.Context(), tenantID, userID, requestID, attachmentID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	defer download.Body.Close()

	disposition := "attachment"
	if strings.EqualFold(r.URL.Query().Get("disposition"), "inline") {
		disposition = "inline"
	}
	filename := strings.TrimSpace(download.Filename)
	if filename == "" {
		filename = download.Attachment.ID.String()
	}
	w.Header().Set("Content-Type", download.ContentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": filename}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	if download.ContentLength >= 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(download.ContentLength, 10))
	}
	if _, err := io.Copy(w, download.Body); err != nil {
		h.logger.Warn().Err(err).Str("attachment_id", attachmentID.String()).Msg("stream legal request attachment")
	}
}
