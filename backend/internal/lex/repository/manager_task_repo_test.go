package repository

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/lex/model"
)

func TestManagerTaskGetIsTenantScopedAndDecodesAttachment(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	tenantID := uuid.New()
	taskID := uuid.New()
	fileID := uuid.New()
	want := model.ManagerTask{
		ID: taskID, TenantID: tenantID, Title: "Prepare brief", Description: "Summarize the claim",
		AssigneeID: uuid.New(), Status: model.ManagerTaskStatusAssigned, CreatedBy: uuid.New(),
		Attachment: &model.ManagerTaskFile{
			FileID: fileID, OriginalName: "claim.pdf", ContentType: "application/pdf", SizeBytes: 42,
			ChecksumSHA256: "abc", FileVersion: 1, VirusScanStatus: "clean", UploadedBy: uuid.New(),
		},
		CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	raw, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM legal_manager_tasks mt")+`(?s).*mt\.tenant_id = \$1 AND mt\.id = \$2 AND mt\.deleted_at IS NULL`).
		WithArgs(tenantID, taskID).
		WillReturnRows(pgxmock.NewRows([]string{"row_to_json"}).AddRow(raw))

	got, err := managerTaskGet(context.Background(), mock, tenantID, taskID)
	if err != nil {
		t.Fatalf("managerTaskGet: %v", err)
	}
	if got.TenantID != tenantID || got.ID != taskID || got.Attachment == nil || got.Attachment.FileID != fileID {
		t.Fatalf("managerTaskGet = %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestManagerTaskAuditPersistsTenantAndActor(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	tenantID, taskID, actorID := uuid.New(), uuid.New(), uuid.New()
	from, to := model.ManagerTaskStatusInProgress, model.ManagerTaskStatusSubmitted
	mock.ExpectExec(`INSERT INTO legal_manager_task_audit`).
		WithArgs(pgxmock.AnyArg(), tenantID, taskID, "task.submitted", &from, &to, "result", actorID).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	repo := &ManagerTaskRepository{}
	if err := repo.AppendAudit(context.Background(), mock, tenantID, taskID, actorID, "task.submitted", &from, &to, "result"); err != nil {
		t.Fatalf("AppendAudit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
