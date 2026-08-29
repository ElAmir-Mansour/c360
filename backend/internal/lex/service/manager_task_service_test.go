package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

func TestManagerTaskLifecycle(t *testing.T) {
	assigneeID := uuid.New()
	creatorID := uuid.New()
	directorID := uuid.New()
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	task := &model.ManagerTask{
		ID: uuid.New(), AssigneeID: assigneeID, CreatedBy: creatorID,
		Status: model.ManagerTaskStatusAssigned,
	}

	if err := applyManagerTaskStart(task, assigneeID); err != nil {
		t.Fatalf("start assigned task: %v", err)
	}
	if task.Status != model.ManagerTaskStatusInProgress {
		t.Fatalf("start status = %q, want in_progress", task.Status)
	}
	if err := applyManagerTaskSubmit(task, assigneeID, "First result", now); err != nil {
		t.Fatalf("submit in-progress task: %v", err)
	}
	if task.Status != model.ManagerTaskStatusSubmitted || task.Result == nil || *task.Result != "First result" || task.SubmittedAt == nil {
		t.Fatalf("submitted task = %+v", task)
	}

	if err := applyManagerTaskDecision(task, directorID, []string{"legal-director"}, "return", "Add the missing evidence", now.Add(time.Hour)); err != nil {
		t.Fatalf("return submitted task: %v", err)
	}
	if task.Status != model.ManagerTaskStatusCorrectionRequired || task.CorrectionNote == nil || *task.CorrectionNote != "Add the missing evidence" {
		t.Fatalf("returned task = %+v", task)
	}
	if err := applyManagerTaskStart(task, assigneeID); err != nil {
		t.Fatalf("restart returned task: %v", err)
	}
	if err := applyManagerTaskSubmit(task, assigneeID, "Corrected result", now.Add(2*time.Hour)); err != nil {
		t.Fatalf("resubmit corrected task: %v", err)
	}
	if task.CorrectionNote != nil || task.ReviewedBy != nil || task.ReviewedAt != nil {
		t.Fatalf("resubmit must clear prior review metadata: %+v", task)
	}
	if err := applyManagerTaskDecision(task, directorID, []string{"legal-director"}, "accept", "", now.Add(3*time.Hour)); err != nil {
		t.Fatalf("accept resubmitted task: %v", err)
	}
	if task.Status != model.ManagerTaskStatusAccepted || task.ReviewedBy == nil || *task.ReviewedBy != directorID {
		t.Fatalf("accepted task = %+v", task)
	}
}

func TestManagerTaskLifecycleEnforcesActorsAndState(t *testing.T) {
	assigneeID := uuid.New()
	creatorID := uuid.New()
	otherID := uuid.New()
	now := time.Now().UTC()

	mustStatus(t, applyManagerTaskStart(&model.ManagerTask{AssigneeID: assigneeID, Status: model.ManagerTaskStatusAssigned}, otherID), http.StatusForbidden)
	mustStatus(t, applyManagerTaskSubmit(&model.ManagerTask{AssigneeID: assigneeID, Status: model.ManagerTaskStatusAssigned}, assigneeID, "result", now), http.StatusConflict)
	mustStatus(t, applyManagerTaskDecision(&model.ManagerTask{CreatedBy: creatorID, AssigneeID: creatorID, Status: model.ManagerTaskStatusSubmitted}, creatorID, []string{"legal-cases-manager"}, "accept", "", now), http.StatusForbidden)
	mustStatus(t, applyManagerTaskDecision(&model.ManagerTask{CreatedBy: creatorID, AssigneeID: assigneeID, Status: model.ManagerTaskStatusSubmitted}, otherID, []string{"legal-cases-manager"}, "accept", "", now), http.StatusForbidden)
	mustStatus(t, applyManagerTaskDecision(&model.ManagerTask{CreatedBy: creatorID, AssigneeID: assigneeID, Status: model.ManagerTaskStatusInProgress}, otherID, []string{"legal-director"}, "accept", "", now), http.StatusConflict)
	creatorTask := &model.ManagerTask{CreatedBy: creatorID, AssigneeID: assigneeID, Status: model.ManagerTaskStatusSubmitted}
	if err := applyManagerTaskDecision(creatorTask, creatorID, []string{"legal-cases-manager"}, "accept", "", now); err != nil {
		t.Fatalf("section manager must review a subordinate's submitted task: %v", err)
	}
}

func TestManagerTaskRoleAndVisibilityPolicy(t *testing.T) {
	assigneeID := uuid.New()
	creatorID := uuid.New()
	task := &model.ManagerTask{AssigneeID: assigneeID, CreatedBy: creatorID}

	if !managerTaskOversight([]string{"legal-director"}) || !managerTaskOversight([]string{"tenant_admin"}) {
		t.Fatal("director and tenant admin must have tenant-wide oversight visibility")
	}
	if managerTaskOversight([]string{"legal-contracts-manager"}) || managerTaskOversight([]string{"legal-cases-manager"}) {
		t.Fatal("section managers must remain scoped to tasks they created or received")
	}
	if managerTaskOversight([]string{"legal-specialist"}) {
		t.Fatal("ordinary assignee role must not have oversight visibility")
	}
	if !managerTaskCanSee(task, assigneeID, nil) || !managerTaskCanSee(task, creatorID, nil) {
		t.Fatal("assignee and creator must see their task")
	}
	if managerTaskCanSee(task, uuid.New(), []string{"legal-specialist"}) {
		t.Fatal("unrelated ordinary user must not see the task")
	}
	for _, role := range []string{
		"legal-director", "legal-cases-manager", "legal-contracts-manager",
		"legal-shared-services-manager", "legal-case-supervisor", "legal-contracts-supervisor",
		"tenant_admin",
	} {
		if !managerTaskCanCreate([]string{role}) {
			t.Errorf("%s must be able to create manager tasks", role)
		}
	}
	if managerTaskCanCreate([]string{"legal-requester"}) {
		t.Fatal("business requesters use support requests and must not assign manager tasks")
	}
	// legal-dept-manager is a BUSINESS-tier requesting manager, not legal staff.
	if managerTaskCanCreate([]string{"legal-dept-manager"}) {
		t.Fatal("business-tier department managers must not assign legal manager tasks")
	}
	// Widening creation must NOT widen visibility: only the director/admin see
	// the whole tenant's board.
	for _, role := range []string{
		"legal-shared-services-manager", "legal-case-supervisor", "legal-contracts-supervisor",
	} {
		if managerTaskOversight([]string{role}) {
			t.Errorf("%s must stay scoped to tasks it created or received", role)
		}
	}
	// A supervisor may review what it created, never a peer's task.
	if !managerTaskCanReview(task, creatorID, []string{"legal-case-supervisor"}) {
		t.Fatal("supervisor must review the task it created")
	}
	if managerTaskCanReview(task, uuid.New(), []string{"legal-case-supervisor"}) {
		t.Fatal("supervisor must not review a task it did not create")
	}
}

func TestManagerTaskPrepareAttachmentUsesVerifiedFileMetadata(t *testing.T) {
	tenantID := uuid.New()
	uploaderID := uuid.New()
	fileID := uuid.New()
	entityType := managerTaskAttachmentEntityType

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/files/"+fileID.String() {
			http.NotFound(w, r)
			return
		}
		if r.Header.Get("Authorization") != "Bearer file-token" || r.Header.Get("X-Tenant-ID") != tenantID.String() {
			http.Error(w, "missing service identity", http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"id":%q,"tenant_id":%q,"original_name":"brief.pdf","content_type":"application/pdf","size_bytes":42,"checksum_sha256":"abc","virus_scan_status":"clean","uploaded_by":%q,"suite":"lex","entity_type":%q,"version_number":2}`,
			fileID.String(), tenantID.String(), uploaderID.String(), entityType)
	}))
	t.Cleanup(srv.Close)

	client := NewRequestFileClient(srv.URL)
	client.BindTokenSource(staticTokenSource{token: "file-token"})
	svc := NewManagerTaskService(nil, nil, client, zerolog.Nop())

	got, err := svc.prepareAttachment(context.Background(), tenantID, uploaderID, fileID)
	if err != nil {
		t.Fatalf("prepareAttachment: %v", err)
	}
	if got.FileID != fileID || got.OriginalName != "brief.pdf" || got.FileVersion != 2 || got.UploadedBy != uploaderID {
		t.Fatalf("attachment snapshot = %+v", got)
	}
	mustStatus(t, func() error {
		_, err := svc.prepareAttachment(context.Background(), tenantID, uuid.New(), fileID)
		return err
	}(), http.StatusForbidden)
}
