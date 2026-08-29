package service

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

const managerTaskAttachmentEntityType = "manager_task_attachment"

type ManagerTaskService struct {
	db     *pgxpool.Pool
	repo   *repository.ManagerTaskRepository
	files  *RequestFileClient
	logger zerolog.Logger
	now    func() time.Time
}

func NewManagerTaskService(db *pgxpool.Pool, repo *repository.ManagerTaskRepository, files *RequestFileClient, logger zerolog.Logger) *ManagerTaskService {
	return &ManagerTaskService{db: db, repo: repo, files: files, logger: logger.With().Str("service", "lex-manager-tasks").Logger(), now: time.Now}
}

func (s *ManagerTaskService) BindFileTokenSource(source FileServiceTokenSource) {
	if s != nil && s.files != nil {
		s.files.BindTokenSource(source)
	}
}

func (s *ManagerTaskService) Create(ctx context.Context, tenantID, actorID uuid.UUID, roles []string, req dto.CreateManagerTaskRequest) (*model.ManagerTask, error) {
	if !managerTaskCanCreate(roles) {
		return nil, forbiddenError("only a legal director or section manager may create tasks")
	}
	req.Normalize()
	fields := map[string]string{}
	if req.Title == "" {
		fields["title"] = "required"
	}
	if req.Description == "" {
		fields["description"] = "required"
	}
	if req.AssigneeID == uuid.Nil {
		fields["assignee_id"] = "required"
	}
	if len(req.Title) > 200 {
		fields["title"] = "maximum 200 characters"
	}
	if len(req.Description) > 10000 {
		fields["description"] = "maximum 10000 characters"
	}
	if len(fields) > 0 {
		return nil, validationError("invalid manager task", fields)
	}

	task := &model.ManagerTask{
		ID: uuid.New(), TenantID: tenantID, Title: req.Title, Description: req.Description,
		AssigneeID: req.AssigneeID, Status: model.ManagerTaskStatusAssigned, CreatedBy: actorID,
	}
	if req.AttachmentFileID != nil {
		attachment, err := s.prepareAttachment(ctx, tenantID, actorID, *req.AttachmentFileID)
		if err != nil {
			return nil, err
		}
		task.Attachment = attachment
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start manager task transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := database.SetTenantContext(ctx, tx, tenantID); err != nil {
		return nil, internalError("set manager task tenant context", err)
	}
	if err := s.repo.Create(ctx, tx, task); err != nil {
		return nil, internalError("create manager task", err)
	}
	to := task.Status
	if err := s.repo.AppendAudit(ctx, tx, tenantID, task.ID, actorID, "task.created", nil, &to, ""); err != nil {
		return nil, internalError("audit manager task create", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit manager task create", err)
	}
	return task, nil
}

func (s *ManagerTaskService) Get(ctx context.Context, tenantID, actorID uuid.UUID, roles []string, id uuid.UUID) (*model.ManagerTask, error) {
	task, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("manager task not found")
		}
		return nil, internalError("load manager task", err)
	}
	if !managerTaskCanSee(task, actorID, roles) {
		return nil, forbiddenError("manager task is not assigned to this user")
	}
	return task, nil
}

func (s *ManagerTaskService) List(ctx context.Context, tenantID, actorID uuid.UUID, roles []string, filters model.ManagerTaskListFilters) ([]model.ManagerTask, int, error) {
	all := managerTaskOversight(roles)
	items, total, err := s.repo.List(ctx, tenantID, actorID, all, filters)
	if err != nil {
		return nil, 0, internalError("list manager tasks", err)
	}
	return items, total, nil
}

func (s *ManagerTaskService) Start(ctx context.Context, tenantID, actorID, id uuid.UUID) (*model.ManagerTask, error) {
	return s.mutate(ctx, tenantID, actorID, id, "task.started", func(task *model.ManagerTask) (string, error) {
		return "", applyManagerTaskStart(task, actorID)
	})
}

func (s *ManagerTaskService) Submit(ctx context.Context, tenantID, actorID, id uuid.UUID, req dto.SubmitManagerTaskRequest) (*model.ManagerTask, error) {
	req.Normalize()
	if req.Result == "" {
		return nil, validationError("result is required", map[string]string{"result": "required"})
	}
	return s.mutate(ctx, tenantID, actorID, id, "task.submitted", func(task *model.ManagerTask) (string, error) {
		return req.Result, applyManagerTaskSubmit(task, actorID, req.Result, s.now().UTC())
	})
}

func (s *ManagerTaskService) Decide(ctx context.Context, tenantID, actorID, id uuid.UUID, roles []string, req dto.DecideManagerTaskRequest) (*model.ManagerTask, error) {
	if !managerTaskCanDecide(roles) {
		return nil, forbiddenError("only a legal director or section manager may review task results")
	}
	req.Normalize()
	if req.Decision != "accept" && req.Decision != "return" {
		return nil, validationError("decision must be accept or return", map[string]string{"decision": "invalid"})
	}
	if req.Decision == "return" && req.Note == "" {
		return nil, validationError("correction note is required", map[string]string{"note": "required"})
	}
	return s.mutate(ctx, tenantID, actorID, id, "task."+req.Decision, func(task *model.ManagerTask) (string, error) {
		return req.Note, applyManagerTaskDecision(task, actorID, roles, req.Decision, req.Note, s.now().UTC())
	})
}

func (s *ManagerTaskService) mutate(ctx context.Context, tenantID, actorID, id uuid.UUID, action string, apply func(*model.ManagerTask) (string, error)) (*model.ManagerTask, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start manager task transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := database.SetTenantContext(ctx, tx, tenantID); err != nil {
		return nil, internalError("set manager task tenant context", err)
	}
	task, err := s.repo.Lock(ctx, tx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("manager task not found")
		}
		return nil, internalError("lock manager task", err)
	}
	from := task.Status
	note, err := apply(task)
	if err != nil {
		return nil, err
	}
	if err := s.repo.Update(ctx, tx, task); err != nil {
		return nil, internalError("update manager task", err)
	}
	to := task.Status
	if err := s.repo.AppendAudit(ctx, tx, tenantID, id, actorID, action, &from, &to, note); err != nil {
		return nil, internalError("audit manager task", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit manager task", err)
	}
	return task, nil
}

func (s *ManagerTaskService) prepareAttachment(ctx context.Context, tenantID, actorID, fileID uuid.UUID) (*model.ManagerTaskFile, error) {
	if s.files == nil || !s.files.Ready() {
		return nil, &apperrors.AppError{Status: http.StatusBadGateway, Code: "MANAGER_TASK_FILE_SERVICE_UNCONFIGURED", Message: "manager task file service is not configured"}
	}
	metadata, err := s.files.Metadata(ctx, tenantID.String(), fileID.String())
	if err != nil {
		return nil, err
	}
	entityType := ""
	if metadata.EntityType != nil {
		entityType = strings.TrimSpace(*metadata.EntityType)
	}
	if metadata.ID != fileID.String() || metadata.TenantID != tenantID.String() || metadata.UploadedBy != actorID.String() {
		return nil, forbiddenError("only the file uploader may attach it to a manager task")
	}
	if metadata.Suite != "lex" || entityType != managerTaskAttachmentEntityType {
		return nil, validationError("file was not uploaded as a manager task attachment", map[string]string{"attachment_file_id": "invalid attachment type"})
	}
	if !isAcceptableScanStatus(metadata.VirusScanStatus) {
		return nil, conflictError("attachment virus scan must be clean before task creation")
	}
	uploadedBy, err := uuid.Parse(metadata.UploadedBy)
	if err != nil {
		return nil, internalError("parse manager task attachment uploader", err)
	}
	return &model.ManagerTaskFile{
		FileID: fileID, OriginalName: metadata.OriginalName, ContentType: metadata.ContentType,
		SizeBytes: metadata.SizeBytes, ChecksumSHA256: metadata.ChecksumSHA256,
		FileVersion: normalizedRequestFileVersion(metadata.VersionNumber), VirusScanStatus: metadata.VirusScanStatus,
		UploadedBy: uploadedBy,
	}, nil
}

func managerTaskCanSee(task *model.ManagerTask, actorID uuid.UUID, roles []string) bool {
	return task != nil && (task.AssigneeID == actorID || task.CreatedBy == actorID || managerTaskOversight(roles))
}

func applyManagerTaskStart(task *model.ManagerTask, actorID uuid.UUID) error {
	if task == nil || task.AssigneeID != actorID {
		return forbiddenError("only the assignee may start this task")
	}
	if task.Status != model.ManagerTaskStatusAssigned && task.Status != model.ManagerTaskStatusCorrectionRequired {
		return conflictError("task cannot be started from status " + string(task.Status))
	}
	task.Status = model.ManagerTaskStatusInProgress
	return nil
}

func applyManagerTaskSubmit(task *model.ManagerTask, actorID uuid.UUID, result string, now time.Time) error {
	if task == nil || task.AssigneeID != actorID {
		return forbiddenError("only the assignee may submit this task")
	}
	if task.Status != model.ManagerTaskStatusInProgress {
		return conflictError("task must be in progress before submission")
	}
	task.Status, task.Result, task.SubmittedAt = model.ManagerTaskStatusSubmitted, &result, &now
	task.CorrectionNote, task.ReviewedBy, task.ReviewedAt = nil, nil, nil
	return nil
}

func applyManagerTaskDecision(task *model.ManagerTask, actorID uuid.UUID, roles []string, decision, note string, now time.Time) error {
	if task == nil || task.Status != model.ManagerTaskStatusSubmitted {
		return conflictError("only submitted tasks can be reviewed")
	}
	if !managerTaskCanReview(task, actorID, roles) {
		return forbiddenError("only the task creator or legal director may review this submission, and assignees cannot review their own work")
	}
	if decision != "accept" && decision != "return" {
		return validationError("decision must be accept or return", map[string]string{"decision": "invalid"})
	}
	task.ReviewedBy, task.ReviewedAt = &actorID, &now
	if decision == "accept" {
		task.Status, task.CorrectionNote = model.ManagerTaskStatusAccepted, nil
		return nil
	}
	if decision == "return" {
		task.Status, task.CorrectionNote = model.ManagerTaskStatusCorrectionRequired, &note
		return nil
	}
	return nil
}

func managerTaskOversight(roles []string) bool {
	return managerTaskHasRole(roles, "legal-director") || managerTaskAdmin(roles)
}

// managerTaskCanCreate lists the legal-side supervisory roles that may assign an
// ad-hoc task. Creating also confers review of the tasks that role created —
// managerTaskCanReview grants tenant-wide review only to the director/admin, so
// a section manager or supervisor still reviews nothing but their own.
//
// legal-dept-manager is deliberately absent: it is a BUSINESS-tier requesting
// manager, and the legal team's internal task board is not theirs to see.
func managerTaskCanCreate(roles []string) bool {
	return managerTaskHasRole(roles, "legal-director") ||
		managerTaskHasRole(roles, "legal-cases-manager") ||
		managerTaskHasRole(roles, "legal-contracts-manager") ||
		managerTaskHasRole(roles, "legal-shared-services-manager") ||
		managerTaskHasRole(roles, "legal-case-supervisor") ||
		managerTaskHasRole(roles, "legal-contracts-supervisor") ||
		managerTaskAdmin(roles)
}

func managerTaskCanDecide(roles []string) bool {
	return managerTaskCanCreate(roles)
}

func managerTaskCanReview(task *model.ManagerTask, actorID uuid.UUID, roles []string) bool {
	if task == nil || task.AssigneeID == actorID || !managerTaskCanDecide(roles) {
		return false
	}
	if managerTaskHasRole(roles, "legal-director") || managerTaskAdmin(roles) {
		return true
	}
	return task.CreatedBy == actorID
}

func managerTaskHasRole(roles []string, wanted string) bool {
	wanted = normalizeWorkflowRole(wanted)
	for _, role := range roles {
		if normalizeWorkflowRole(role) == wanted {
			return true
		}
	}
	return false
}

func managerTaskAdmin(roles []string) bool {
	for _, role := range roles {
		switch normalizeWorkflowRole(role) {
		case "super_admin", "tenant_admin":
			return true
		}
	}
	return false
}
