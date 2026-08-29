package service

import (
	"testing"

	"github.com/clario360/platform/internal/filemanager/model"
)

func TestProtectedFileActorAllowed(t *testing.T) {
	record := &model.FileRecord{UploadedBy: "requester-1"}
	tests := []struct {
		name   string
		userID string
		roles  []string
		want   bool
	}{
		{name: "uploader", userID: "requester-1", roles: []string{"legal-requester"}, want: true},
		{name: "lex service proxy", userID: "request-attachment-service", roles: []string{"service"}, want: true},
		{name: "platform administrator uses governed proxy", userID: "admin-1", roles: []string{"super-admin"}, want: false},
		{name: "tenant file administrator uses governed proxy", userID: "file-admin-1", roles: []string{"tenant-admin"}, want: false},
		{name: "unrelated legal provider", userID: "provider-1", roles: []string{"legal-officer"}, want: false},
		{name: "other requester", userID: "requester-2", roles: []string{"legal-requester"}, want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := protectedFileActorAllowed(record, tc.userID, tc.roles); got != tc.want {
				t.Fatalf("protectedFileActorAllowed() = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestProtectedFileActorAllowedRejectsMissingRecord(t *testing.T) {
	if protectedFileActorAllowed(nil, "requester-1", []string{"service"}) {
		t.Fatal("missing record must not be authorized")
	}
}
