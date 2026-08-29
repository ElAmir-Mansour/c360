package service

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
)

func TestRequestApprovalTaskCanBeDecided(t *testing.T) {
	actorID := uuid.New()
	authorID := uuid.New()
	otherID := uuid.New()
	actor := actorID.String()
	other := otherID.String()
	directorRole := "legal_director"

	ctx := auth.WithUser(context.Background(), &auth.ContextUser{
		ID:    actor,
		Roles: []string{"legal-director"},
	})
	request := &model.LegalRequest{CreatedBy: authorID}
	baseTask := workflowmodel.HumanTask{
		Status:       workflowmodel.TaskStatusPending,
		AssigneeRole: &directorRole,
	}

	tests := []struct {
		name    string
		ctx     context.Context
		request *model.LegalRequest
		task    *workflowmodel.HumanTask
		want    bool
	}{
		{name: "matching normalized role", ctx: ctx, request: request, task: &baseTask, want: true},
		{name: "same direct assignee", ctx: ctx, request: request, task: &workflowmodel.HumanTask{Status: workflowmodel.TaskStatusPending, AssigneeID: &actor}, want: true},
		{name: "different direct assignee", ctx: ctx, request: request, task: &workflowmodel.HumanTask{Status: workflowmodel.TaskStatusPending, AssigneeID: &other}, want: false},
		{name: "claimed by another user", ctx: ctx, request: request, task: &workflowmodel.HumanTask{Status: workflowmodel.TaskStatusClaimed, ClaimedBy: &other}, want: false},
		{name: "closed task", ctx: ctx, request: request, task: &workflowmodel.HumanTask{Status: workflowmodel.TaskStatusCompleted}, want: false},
		{name: "author separation of duties", ctx: ctx, request: &model.LegalRequest{CreatedBy: actorID}, task: &baseTask, want: false},
		{
			name:    "missing request approval capability",
			ctx:     auth.WithUser(context.Background(), &auth.ContextUser{ID: actor, Roles: []string{"legal-officer"}}),
			request: request,
			task:    &workflowmodel.HumanTask{Status: workflowmodel.TaskStatusPending},
			want:    false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := requestApprovalTaskCanBeDecided(tc.ctx, tc.request, actorID, tc.task); got != tc.want {
				t.Fatalf("requestApprovalTaskCanBeDecided() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestNormalizeApprovalActorRoles(t *testing.T) {
	got := normalizeApprovalActorRoles([]string{" Legal-Director ", "legal_director", "", "SUPER-ADMIN"})
	want := []string{"legal_director", "super_admin"}
	if len(got) != len(want) {
		t.Fatalf("normalizeApprovalActorRoles() = %#v, want %#v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("normalizeApprovalActorRoles()[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}
