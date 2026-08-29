package handler

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ContractArchiveHandler is the transport shell over the contract archive
// lifecycle (CAP-122): archive/unarchive a contract and the advanced search over
// archived contracts. Route wiring (permission tiers, paths) is owned by the
// integrator in handler/routes.go.
type ContractArchiveHandler struct {
	baseHandler
	archive *service.ContractArchiveService
}

func NewContractArchiveHandler(archive *service.ContractArchiveService, logger zerolog.Logger) *ContractArchiveHandler {
	return &ContractArchiveHandler{baseHandler: baseHandler{logger: logger}, archive: archive}
}

type archiveContractRequest struct {
	Reason string `json:"reason"`
}

func (h *ContractArchiveHandler) Archive(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req archiveContractRequest
	// Body is optional (reason may be omitted); ignore decode errors on an empty body.
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	item, err := h.archive.ArchiveContract(r.Context(), tenantID, userID, contractID, req.Reason)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractArchiveHandler) Unarchive(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.archive.UnarchiveContract(r.Context(), tenantID, userID, contractID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ContractArchiveHandler) ListArchived(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filter, err := parseArchiveFilter(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.archive.ListArchived(r.Context(), tenantID, filter)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filter.Page, filter.PerPage, total)
}

func parseArchiveFilter(r *http.Request) (service.ArchiveFilter, error) {
	page, perPage := suiteapi.ParsePagination(r)
	q := r.URL.Query()

	archivedBy, err := parseOptionalUUID(q.Get("archived_by"))
	if err != nil {
		return service.ArchiveFilter{}, fmt.Errorf("invalid archived_by")
	}
	ownerUserID, err := parseOptionalUUID(q.Get("owner_user_id"))
	if err != nil {
		return service.ArchiveFilter{}, fmt.Errorf("invalid owner_user_id")
	}
	archiveFrom, err := parseOptionalDate(q.Get("archive_date_from"))
	if err != nil {
		return service.ArchiveFilter{}, fmt.Errorf("invalid archive_date_from")
	}
	archiveToRaw := strings.TrimSpace(q.Get("archive_date_to"))
	archiveTo, err := parseOptionalDate(archiveToRaw)
	if err != nil {
		return service.ArchiveFilter{}, fmt.Errorf("invalid archive_date_to")
	}
	if archiveTo != nil && len(archiveToRaw) == len("2006-01-02") {
		// The service applies an inclusive <= bound. Move a date-only upper
		// bound to the final instant of that calendar day so records archived
		// after midnight are not unexpectedly omitted.
		inclusiveEnd := archiveTo.AddDate(0, 0, 1).Add(-time.Nanosecond)
		archiveTo = &inclusiveEnd
	}
	if archiveFrom != nil && archiveTo != nil && archiveFrom.After(*archiveTo) {
		return service.ArchiveFilter{}, fmt.Errorf("archive_date_from must not be after archive_date_to")
	}

	archiveStatus := strings.TrimSpace(q.Get("archive_status"))
	if archiveStatus != "" && archiveStatus != service.ArchiveStatusActive && archiveStatus != service.ArchiveStatusArchived {
		return service.ArchiveFilter{}, fmt.Errorf("invalid archive_status")
	}

	filter := service.ArchiveFilter{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(q.Get("search")),
		ArchiveStatus: archiveStatus,
		ArchiveFrom:   archiveFrom,
		ArchiveTo:     archiveTo,
		ArchivedBy:    archivedBy,
		OwnerUserID:   ownerUserID,
		Department:    strings.TrimSpace(q.Get("department")),
		Tag:           strings.TrimSpace(q.Get("tag")),
	}
	if status := strings.TrimSpace(q.Get("status")); status != "" {
		value := model.ContractStatus(status)
		if !validArchiveContractStatus(value) {
			return service.ArchiveFilter{}, fmt.Errorf("invalid status")
		}
		filter.Status = &value
	}
	if contractType := strings.TrimSpace(q.Get("type")); contractType != "" {
		value := model.ContractType(contractType)
		if !validArchiveContractType(value) {
			return service.ArchiveFilter{}, fmt.Errorf("invalid type")
		}
		filter.Type = &value
	}
	return filter, nil
}

func validArchiveContractStatus(value model.ContractStatus) bool {
	switch value {
	case model.ContractStatusDraft,
		model.ContractStatusInternalReview,
		model.ContractStatusLegalReview,
		model.ContractStatusNegotiation,
		model.ContractStatusPendingSignature,
		model.ContractStatusActive,
		model.ContractStatusSuspended,
		model.ContractStatusExpired,
		model.ContractStatusTerminated,
		model.ContractStatusRenewed,
		model.ContractStatusCancelled:
		return true
	default:
		return false
	}
}

func validArchiveContractType(value model.ContractType) bool {
	switch value {
	case model.ContractTypeServiceAgreement,
		model.ContractTypeNDA,
		model.ContractTypeEmployment,
		model.ContractTypeVendor,
		model.ContractTypeLicense,
		model.ContractTypeLease,
		model.ContractTypePartnership,
		model.ContractTypeConsulting,
		model.ContractTypeProcurement,
		model.ContractTypeSLA,
		model.ContractTypeMOU,
		model.ContractTypeAmendment,
		model.ContractTypeRenewal,
		model.ContractTypeOther:
		return true
	default:
		return false
	}
}
