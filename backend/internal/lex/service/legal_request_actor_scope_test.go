package service

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/model"
)

func TestBaseRequesterOwnScope(t *testing.T) {
	tests := []struct {
		name  string
		roles []string
		want  bool
	}{
		{name: "hyphenated base requester", roles: []string{"legal-requester"}, want: true},
		{name: "underscored base requester", roles: []string{"legal_requester"}, want: true},
		{name: "requester with harmless auxiliary role", roles: []string{"employee", "legal-requester"}, want: true},
		{name: "requester plus legal director", roles: []string{"legal-requester", "legal-director"}, want: false},
		{name: "requester plus legal auditor", roles: []string{"legal-requester", "legal-auditor"}, want: false},
		{name: "requester plus tenant admin", roles: []string{"legal-requester", "tenant_admin"}, want: false},
		{name: "legal officer", roles: []string{"legal-officer"}, want: false},
		{name: "no roles", roles: nil, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := baseRequesterOwnScope(context.Background(), tt.roles); got != tt.want {
				t.Fatalf("baseRequesterOwnScope(%v) = %v, want %v", tt.roles, got, tt.want)
			}
		})
	}
}

func TestEnforceBaseRequesterOwnRequest(t *testing.T) {
	requesterID := uuid.New()
	otherID := uuid.New()
	request := &model.LegalRequest{CreatedBy: requesterID, RequesterUserID: requesterID}

	requesterContext := auth.WithUser(context.Background(), &auth.ContextUser{
		ID: requesterID.String(), Roles: []string{"legal-requester"},
	})
	if err := enforceBaseRequesterOwnRequest(requesterContext, request); err != nil {
		t.Fatalf("owner was denied: %v", err)
	}

	otherContext := auth.WithUser(context.Background(), &auth.ContextUser{
		ID: otherID.String(), Roles: []string{"legal-requester"},
	})
	mustStatus(t, enforceBaseRequesterOwnRequest(otherContext, request), http.StatusNotFound)

	operatorContext := auth.WithUser(context.Background(), &auth.ContextUser{
		ID: otherID.String(), Roles: []string{"legal-officer"},
	})
	if err := enforceBaseRequesterOwnRequest(operatorContext, request); err != nil {
		t.Fatalf("legal operator lost tenant-wide access: %v", err)
	}

	if err := enforceBaseRequesterOwnRequest(context.Background(), request); err != nil {
		t.Fatalf("internal service call was denied: %v", err)
	}
}
