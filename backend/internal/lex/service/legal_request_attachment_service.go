package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

const (
	legalRequestAttachmentEntityType = "legal_request_attachment"
	maxLegalRequestAttachments       = 25
)

// isAcceptableScanStatus fails closed: only a positive clean antivirus verdict
// may be attached to a legal request. Skipped means the scanner was unavailable,
// so it is not evidence that the file is safe.
func isAcceptableScanStatus(status string) bool {
	return strings.EqualFold(strings.TrimSpace(status), "clean")
}

// LegalRequestAttachmentDownload is a request-authorized byte stream. The
// handler owns closing Body.
type LegalRequestAttachmentDownload struct {
	Attachment    *model.LegalRequestAttachment
	Body          io.ReadCloser
	Filename      string
	ContentType   string
	ContentLength int64
}

// LegalRequestAttachmentService owns durable linkage, request-level access
// control and the safe file-service proxy for request attachments.
type LegalRequestAttachmentService struct {
	db        *pgxpool.Pool
	repo      *repository.LegalRequestAttachmentRepository
	requests  *repository.LegalRequestRepository
	policies  *repository.AttachmentPolicyRepository
	catalog   *repository.ServiceCatalogRepository
	files     *RequestFileClient
	approvals *RequestApprovalService
	logger    zerolog.Logger
}

func NewLegalRequestAttachmentService(
	db *pgxpool.Pool,
	repo *repository.LegalRequestAttachmentRepository,
	requests *repository.LegalRequestRepository,
	policies *repository.AttachmentPolicyRepository,
	catalog *repository.ServiceCatalogRepository,
	files *RequestFileClient,
	logger zerolog.Logger,
) *LegalRequestAttachmentService {
	return &LegalRequestAttachmentService{db: db, repo: repo, requests: requests, policies: policies, catalog: catalog, files: files, logger: logger.With().Str("service", "legal-request-attachments").Logger()}
}

func (s *LegalRequestAttachmentService) SetApprovalService(approvals *RequestApprovalService) {
	s.approvals = approvals
}

func (s *LegalRequestAttachmentService) BindFileTokenSource(source FileServiceTokenSource) {
	if s != nil && s.files != nil {
		s.files.BindTokenSource(source)
	}
}

// Prepare verifies every staged file against file-service before the legal
// request transaction starts. Only the uploader may link a protected, clean Lex
// request-attachment object; metadata supplied by the browser is never trusted.
func (s *LegalRequestAttachmentService) Prepare(ctx context.Context, tenantID, userID, requestID uuid.UUID, specs []dto.CreateLegalRequestAttachmentRequest) ([]*model.LegalRequestAttachment, error) {
	if len(specs) == 0 {
		return nil, nil
	}
	if len(specs) > maxLegalRequestAttachments {
		return nil, validationError("too many request attachments", map[string]string{"attachments": "maximum 25 files"})
	}
	if s == nil || s.files == nil || !s.files.Ready() {
		return nil, &apperrors.AppError{Status: http.StatusBadGateway, Code: "LEGAL_REQUEST_FILE_SERVICE_UNCONFIGURED", Message: "legal request file service is not configured"}
	}

	seenFiles := make(map[uuid.UUID]struct{}, len(specs))
	seenSlots := make(map[string]struct{}, len(specs))
	items := make([]*model.LegalRequestAttachment, 0, len(specs))
	for i, spec := range specs {
		if spec.FileID == uuid.Nil {
			return nil, validationError("attachment file_id is required", map[string]string{fmt.Sprintf("attachments.%d.file_id", i): "required"})
		}
		if _, duplicate := seenFiles[spec.FileID]; duplicate {
			return nil, validationError("duplicate attachment file", map[string]string{"attachments": "duplicate file_id"})
		}
		seenFiles[spec.FileID] = struct{}{}
		var slot *string
		if spec.SlotKey != nil {
			value := strings.TrimSpace(*spec.SlotKey)
			if value != "" {
				key := strings.ToLower(value)
				if _, duplicate := seenSlots[key]; duplicate {
					return nil, validationError("duplicate attachment slot", map[string]string{"attachments": "only one file may fill a named slot"})
				}
				seenSlots[key] = struct{}{}
				slot = &value
			}
		}

		metadata, err := s.files.Metadata(ctx, tenantID.String(), spec.FileID.String())
		if err != nil {
			return nil, err
		}
		if metadata.TenantID != tenantID.String() || metadata.UploadedBy != userID.String() {
			return nil, forbiddenError("only the file uploader may attach it to a legal request")
		}
		if metadata.Suite != "lex" || metadata.EntityType == nil || strings.TrimSpace(*metadata.EntityType) != legalRequestAttachmentEntityType {
			return nil, validationError("file was not uploaded as a legal request attachment", map[string]string{fmt.Sprintf("attachments.%d.file_id", i): "invalid attachment type"})
		}
		if !isAcceptableScanStatus(metadata.VirusScanStatus) {
			return nil, conflictError("attachment virus scan must be clean before request submission")
		}
		uploadedBy, err := uuid.Parse(metadata.UploadedBy)
		if err != nil {
			return nil, internalError("parse attachment uploader", err)
		}
		version := metadata.VersionNumber
		if version < 1 {
			version = 1
		}
		items = append(items, &model.LegalRequestAttachment{
			ID: uuid.New(), TenantID: tenantID, LegalRequestID: requestID,
			FileID: spec.FileID, SlotKey: slot, OriginalName: metadata.OriginalName,
			ContentType: metadata.ContentType, SizeBytes: metadata.SizeBytes,
			ChecksumSHA256: metadata.ChecksumSHA256, FileVersion: version,
			VirusScanStatus: metadata.VirusScanStatus, UploadedBy: uploadedBy,
		})
	}
	return items, nil
}

func (s *LegalRequestAttachmentService) Persist(ctx context.Context, q repository.Queryer, items []*model.LegalRequestAttachment) error {
	for _, item := range items {
		if err := s.repo.Create(ctx, q, item); err != nil {
			return err
		}
	}
	return nil
}

// ValidatePolicy enforces the same catalog attachment policy on the server that
// the intake wizard presents. Client-side count/slot checks are UX only.
func (s *LegalRequestAttachmentService) ValidatePolicy(ctx context.Context, tenantID uuid.UUID, requestType string, serviceID *uuid.UUID, items []*model.LegalRequestAttachment) error {
	if s == nil || s.policies == nil {
		return nil
	}
	serviceCode := ""
	if serviceID != nil && *serviceID != uuid.Nil && s.catalog != nil {
		service, err := s.catalog.Get(ctx, tenantID, *serviceID)
		if err != nil && err != pgx.ErrNoRows {
			return internalError("load service catalog for attachment policy", err)
		}
		if service != nil {
			serviceCode = service.Code
		}
	}
	policy, err := s.policies.FindApplicable(ctx, tenantID, requestType, serviceCode)
	if err == pgx.ErrNoRows {
		return nil
	}
	if err != nil {
		return internalError("resolve request attachment policy", err)
	}
	if policy == nil || !policy.Active {
		return nil
	}
	slots := make([]string, 0, len(items))
	for _, item := range items {
		if item.SlotKey != nil {
			slots = append(slots, *item.SlotKey)
		}
	}
	evaluation := evaluateAttachmentPolicy(policy, slots, len(items), time.Now().UTC())
	if !evaluation.Complete {
		return validationError("request attachments do not satisfy the service attachment policy", map[string]string{"attachments": "required attachment count or slots are incomplete"})
	}
	return nil
}

func (s *LegalRequestAttachmentService) List(ctx context.Context, tenantID, userID, requestID uuid.UUID) ([]model.LegalRequestAttachment, error) {
	request, err := s.authorize(ctx, tenantID, userID, requestID)
	if err != nil {
		return nil, err
	}
	_ = request
	items, err := s.repo.List(ctx, tenantID, requestID)
	if err != nil {
		return nil, internalError("list legal request attachments", err)
	}
	return s.refreshLiveMetadata(ctx, tenantID, requestID, items)
}

func (s *LegalRequestAttachmentService) refreshLiveMetadata(ctx context.Context, tenantID, requestID uuid.UUID, items []model.LegalRequestAttachment) ([]model.LegalRequestAttachment, error) {
	if len(items) == 0 {
		return items, nil
	}
	if s == nil || s.files == nil || !s.files.Ready() {
		return nil, &apperrors.AppError{Status: http.StatusBadGateway, Code: "LEGAL_REQUEST_FILE_SERVICE_UNCONFIGURED", Message: "legal request file service is not configured"}
	}
	for i := range items {
		metadata, err := s.files.Metadata(ctx, tenantID.String(), items[i].FileID.String())
		if err != nil {
			return nil, err
		}
		if err := validateLiveRequestAttachmentMetadata(tenantID, &items[i], metadata); err != nil {
			return nil, err
		}
		if metadata.VirusScanStatus != items[i].VirusScanStatus {
			if err := s.repo.UpdateScanStatus(ctx, tenantID, requestID, items[i].ID, metadata.VirusScanStatus); err != nil {
				return nil, internalError("update request attachment scan status", err)
			}
			items[i].VirusScanStatus = metadata.VirusScanStatus
		}
	}
	return items, nil
}

func (s *LegalRequestAttachmentService) ApprovalSnapshot(ctx context.Context, tenantID, requestID uuid.UUID) ([]map[string]any, error) {
	items, err := s.repo.List(ctx, tenantID, requestID)
	if err != nil {
		return nil, err
	}
	items, err = s.refreshLiveMetadata(ctx, tenantID, requestID, items)
	if err != nil {
		return nil, err
	}
	snapshot := make([]map[string]any, 0, len(items))
	for _, attachment := range items {
		if !isAcceptableScanStatus(attachment.VirusScanStatus) {
			return nil, conflictError("all request attachments must have a clean virus scan before approval")
		}
		snapshot = append(snapshot, map[string]any{
			"attachment_id": attachment.ID.String(), "file_id": attachment.FileID.String(),
			"slot_key": attachment.SlotKey, "original_name": attachment.OriginalName,
			"file_version": attachment.FileVersion, "checksum_sha256": attachment.ChecksumSHA256,
			"virus_scan_status": attachment.VirusScanStatus,
		})
	}
	return snapshot, nil
}

func (s *LegalRequestAttachmentService) OpenDownload(ctx context.Context, tenantID, userID, requestID, attachmentID uuid.UUID) (*LegalRequestAttachmentDownload, error) {
	if _, err := s.authorize(ctx, tenantID, userID, requestID); err != nil {
		return nil, err
	}
	if s == nil || s.files == nil || !s.files.Ready() {
		return nil, &apperrors.AppError{Status: http.StatusBadGateway, Code: "LEGAL_REQUEST_FILE_SERVICE_UNCONFIGURED", Message: "legal request file service is not configured"}
	}
	attachment, err := s.repo.Get(ctx, tenantID, requestID, attachmentID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("request attachment not found")
		}
		return nil, internalError("load request attachment", err)
	}
	metadata, err := s.files.Metadata(ctx, tenantID.String(), attachment.FileID.String())
	if err != nil {
		return nil, err
	}
	if err := validateLiveRequestAttachmentMetadata(tenantID, attachment, metadata); err != nil {
		return nil, err
	}
	if metadata.VirusScanStatus != attachment.VirusScanStatus {
		if updateErr := s.repo.UpdateScanStatus(ctx, tenantID, requestID, attachmentID, metadata.VirusScanStatus); updateErr != nil {
			s.logger.Warn().Err(updateErr).Str("attachment_id", attachmentID.String()).Msg("update request attachment scan status")
		}
		attachment.VirusScanStatus = metadata.VirusScanStatus
	}
	if !isAcceptableScanStatus(metadata.VirusScanStatus) {
		return nil, forbiddenError("attachment is not available until its virus scan is clean")
	}
	object, err := s.files.Download(ctx, tenantID.String(), attachment.FileID.String())
	if err != nil {
		return nil, err
	}
	if object.ChecksumSHA256 != "" && !strings.EqualFold(object.ChecksumSHA256, attachment.ChecksumSHA256) {
		object.Body.Close()
		return nil, conflictError("downloaded attachment checksum does not match the reviewed version")
	}
	if err := s.requests.AppendAudit(ctx, s.db, newSpineAuditEntry(tenantID, requestID, actorPtr(userID), "attachment_downloaded", "", "", "", map[string]any{
		"attachment_id": attachment.ID, "file_id": attachment.FileID,
		"file_version": attachment.FileVersion, "checksum_sha256": attachment.ChecksumSHA256,
	})); err != nil {
		s.logger.Warn().Err(err).Str("attachment_id", attachmentID.String()).Msg("append attachment download audit")
	}
	filename := attachment.OriginalName
	if filename == "" {
		filename = object.Filename
	}
	return &LegalRequestAttachmentDownload{Attachment: attachment, Body: object.Body, Filename: filename, ContentType: object.ContentType, ContentLength: object.ContentLength}, nil
}

func normalizedRequestFileVersion(version int) int {
	if version < 1 {
		return 1
	}
	return version
}

func validateLiveRequestAttachmentMetadata(tenantID uuid.UUID, attachment *model.LegalRequestAttachment, metadata *RequestFileMetadata) error {
	if attachment == nil || metadata == nil {
		return conflictError("attachment metadata is unavailable for review")
	}
	entityType := ""
	if metadata.EntityType != nil {
		entityType = strings.TrimSpace(*metadata.EntityType)
	}
	if metadata.ID != attachment.FileID.String() ||
		metadata.TenantID != tenantID.String() ||
		metadata.UploadedBy != attachment.UploadedBy.String() ||
		metadata.Suite != "lex" || entityType != legalRequestAttachmentEntityType ||
		metadata.OriginalName != attachment.OriginalName ||
		metadata.ContentType != attachment.ContentType ||
		metadata.SizeBytes != attachment.SizeBytes ||
		!strings.EqualFold(strings.TrimSpace(metadata.ChecksumSHA256), strings.TrimSpace(attachment.ChecksumSHA256)) ||
		normalizedRequestFileVersion(metadata.VersionNumber) != attachment.FileVersion {
		return conflictError("attachment metadata no longer matches the evidence submitted for review")
	}
	return nil
}

func (s *LegalRequestAttachmentService) authorize(ctx context.Context, tenantID, userID, requestID uuid.UUID) (*model.LegalRequest, error) {
	request, err := s.requests.Get(ctx, tenantID, requestID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("legal request not found")
		}
		return nil, internalError("load legal request for attachment access", err)
	}
	actor := auth.UserFromContext(ctx)
	if actor == nil || actor.ID != userID.String() {
		return nil, forbiddenError("request attachment access requires an authenticated actor")
	}
	if legalRequestAttachmentActorAllowed(ctx, actor, userID, request, false) {
		return request, nil
	}
	if s.approvals != nil {
		allowed, accessErr := s.approvals.ActorCanReviewAttachments(ctx, tenantID, userID, request)
		if accessErr != nil {
			return nil, accessErr
		}
		if legalRequestAttachmentActorAllowed(ctx, actor, userID, request, allowed) {
			return request, nil
		}
	}
	if request.SubjectType != nil && request.SubjectID != nil {
		assigned, assignmentErr := s.requests.ActorAssignedToSubject(ctx, tenantID, userID, *request.SubjectType, *request.SubjectID)
		if assignmentErr != nil {
			return nil, internalError("check linked subject attachment assignment", assignmentErr)
		}
		if legalRequestAttachmentActorAllowed(ctx, actor, userID, request, assigned) {
			return request, nil
		}
	}
	return nil, forbiddenError("you are not a requester, assigned reviewer, or approver for this request")
}

// legalRequestAttachmentActorAllowed is the object-level policy shared by list
// and byte reads. A broad provider role is intentionally insufficient: access
// requires ownership, Legal Director authority, a currently actionable approval
// task, or an explicit downstream case/consultation assignment.
func legalRequestAttachmentActorAllowed(ctx context.Context, actor *auth.ContextUser, userID uuid.UUID, request *model.LegalRequest, canReview bool) bool {
	if actor == nil || actor.ID != userID.String() || request == nil {
		return false
	}
	if request.CreatedBy == userID || request.RequesterUserID == userID {
		return true
	}
	if auth.HasAnyPermissionCtx(ctx, actor.Roles, auth.PermAdminAll, auth.PermLexApprovalAdmin) {
		return true
	}
	return canReview
}
