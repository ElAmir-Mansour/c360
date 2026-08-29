package dto

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestOpenDocumentEditorSessionRequestNormalize(t *testing.T) {
	var req OpenDocumentEditorSessionRequest
	if err := json.Unmarshal([]byte(`{"mode":"edit","provider":" OnlyOffice ","locale":"","user_display_name":"  Aisha Counsel  ","document_url":" https://files.example.test/draft.docx ","callback_url":" https://lex.example.test/callback ","options":{"autosave":true}}`), &req); err != nil {
		t.Fatalf("decode open request: %v", err)
	}

	req.Normalize()

	if req.Mode != model.DocumentEditorModeEdit {
		t.Fatalf("mode = %q, want edit", req.Mode)
	}
	if req.Provider != "onlyoffice" || req.Locale != "en" {
		t.Fatalf("provider/locale = %q/%q, want onlyoffice/en", req.Provider, req.Locale)
	}
	if req.UserDisplayName != "Aisha Counsel" || req.DocumentURL == "" || req.CallbackURL == "" {
		t.Fatalf("normalized open request = %+v, want trimmed display/document/callback fields", req)
	}
	if got, _ := req.Options["autosave"].(bool); !got {
		t.Fatalf("options = %v, want autosave true", req.Options)
	}
}

func TestDocumentEditorLockRequestsNormalize(t *testing.T) {
	sessionID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	ttl := 900

	acquire := AcquireDocumentEditorLockRequest{
		SessionID:        &sessionID,
		LockType:         " CHECKOUT ",
		Reason:           "  negotiation turn  ",
		ExpiresInSeconds: &ttl,
	}
	acquire.Normalize()

	if acquire.LockType != "checkout" || acquire.Reason != "negotiation turn" || acquire.Metadata == nil {
		t.Fatalf("acquire lock request = %+v, want normalized lock type/reason/metadata", acquire)
	}

	release := ReleaseDocumentEditorLockRequest{
		SessionID: &sessionID,
		Reason:    "  done reviewing  ",
	}
	release.Normalize()
	if release.Reason != "done reviewing" {
		t.Fatalf("release reason = %q, want trimmed", release.Reason)
	}
}

func TestSubmitDocumentEditorPreflightRequestNormalize(t *testing.T) {
	score := 96.5
	req := SubmitDocumentEditorPreflightRequest{
		Status:   " WARNING ",
		Score:    &score,
		Blocking: false,
		Summary:  "  Review warnings before edit  ",
		Checks: []DocumentEditorPreflightCheck{
			{Key: " docx_format ", Status: " PASSED ", Severity: " INFO ", Message: " Ready "},
			{Key: " active_lock ", Status: " FAILED ", Severity: " WARNING ", Message: " Existing checkout "},
		},
	}

	req.Normalize()

	if req.Status != "warning" || req.Summary != "Review warnings before edit" || req.Metadata == nil {
		t.Fatalf("preflight request = %+v, want normalized status/summary/metadata", req)
	}
	if req.Checks[0].Key != "docx_format" || req.Checks[0].Status != "passed" || req.Checks[0].Severity != "info" {
		t.Fatalf("first check = %+v, want normalized check fields", req.Checks[0])
	}
	if req.Checks[1].Metadata == nil {
		t.Fatalf("second check metadata nil, want empty map")
	}
}

func TestDocumentEditorWorkspaceRequestsNormalize(t *testing.T) {
	ttl := 3600
	guest := RequestDocumentEditorGuestReviewLinkRequest{
		ReviewerName:     "  External Counsel  ",
		ReviewerEmail:    " Counsel@Example.COM ",
		Organization:     "  ACME  ",
		Sections:         []string{" 1.1 ", "1.1", " 2.0 "},
		Message:          "  Please review  ",
		ExpiresInSeconds: &ttl,
	}
	guest.Normalize()
	if guest.AccessMode != model.DocumentEditorModeComment || guest.ReviewerEmail != "counsel@example.com" {
		t.Fatalf("guest request = %+v, want comment mode and lowercase email", guest)
	}
	if len(guest.Sections) != 2 || guest.Metadata == nil {
		t.Fatalf("guest sections/metadata = %v/%v, want deduped sections and metadata", guest.Sections, guest.Metadata)
	}

	action := RequestDocumentEditorClauseAIActionRequest{
		Action:           " RISK_REVIEW ",
		ClauseType:       " Liability ",
		SectionReference: " 5.2 ",
		Prompt:           "  tighten fallback  ",
	}
	action.Normalize()
	if action.Action != "risk_review" || action.ClauseType != "liability" || action.Selection == nil || action.Metadata == nil {
		t.Fatalf("clause action request = %+v, want normalized action scope", action)
	}

	control := RequestDocumentEditorPrivilegedControlRequest{
		Control: " Download ",
		Reason:  "  privileged draft  ",
	}
	control.Normalize()
	if control.Control != "download" || control.Reason != "privileged draft" || control.Metadata == nil {
		t.Fatalf("privileged control request = %+v, want normalized control/reason", control)
	}
}

func TestRequestDocumentEditorSnapshotRequestNormalize(t *testing.T) {
	sessionID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	currentVersion := 7
	req := RequestDocumentEditorSnapshotRequest{
		SessionID:      &sessionID,
		ChangeSummary:  "  Before negotiation redlines  ",
		CurrentVersion: &currentVersion,
		Source:         "  word_editor  ",
	}

	req.Normalize()

	if req.ChangeSummary != "Before negotiation redlines" || req.Source != "word_editor" {
		t.Fatalf("snapshot request = %+v, want trimmed summary/source", req)
	}
	if req.Metadata == nil {
		t.Fatalf("snapshot metadata nil, want empty map")
	}
}

func TestDocumentEditorMaturityRequestsNormalize(t *testing.T) {
	sessionID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	guest := RequestDocumentEditorGuestReviewLinkRequest{
		SessionID:     &sessionID,
		ReviewerName:  "  External Reviewer  ",
		ReviewerEmail: "  GUEST@EXAMPLE.TEST  ",
		Organization:  "  Counterparty LLC  ",
		Sections:      []string{" 1.2 ", "1.2", " 2.1 ", ""},
		Message:       "  Please review liability changes.  ",
	}
	guest.Normalize()

	if guest.AccessMode != model.DocumentEditorModeComment {
		t.Fatalf("guest access mode = %q, want comment default", guest.AccessMode)
	}
	if guest.ReviewerName != "External Reviewer" || guest.ReviewerEmail != "guest@example.test" || guest.Organization != "Counterparty LLC" {
		t.Fatalf("guest reviewer fields = %+v, want trimmed/lowercase fields", guest)
	}
	if len(guest.Sections) != 2 || guest.Sections[0] != "1.2" || guest.Sections[1] != "2.1" {
		t.Fatalf("guest sections = %#v, want trimmed unique section list", guest.Sections)
	}
	if guest.Message != "Please review liability changes." || guest.Metadata == nil {
		t.Fatalf("guest message/metadata = %q/%v, want trimmed message and metadata map", guest.Message, guest.Metadata)
	}

	clauseAction := RequestDocumentEditorClauseAIActionRequest{
		Action:           " REWRITE ",
		ClauseType:       " Limitation_Of_Liability ",
		SectionReference: "  4.1  ",
		Prompt:           "  Make it balanced.  ",
	}
	clauseAction.Normalize()
	if clauseAction.Action != "rewrite" || clauseAction.ClauseType != "limitation_of_liability" || clauseAction.SectionReference != "4.1" || clauseAction.Prompt != "Make it balanced." {
		t.Fatalf("clause action request = %+v, want normalized text fields", clauseAction)
	}
	if clauseAction.Selection == nil || clauseAction.Metadata == nil {
		t.Fatalf("clause action selection/metadata nil, want empty maps")
	}

	privileged := RequestDocumentEditorPrivilegedControlRequest{
		Control: " ETHICAL_WALL ",
		Reason:  "  Privileged investigation material  ",
	}
	privileged.Normalize()
	if privileged.Control != "ethical_wall" || privileged.Reason != "Privileged investigation material" || privileged.Metadata == nil {
		t.Fatalf("privileged request = %+v, want normalized control/reason/metadata", privileged)
	}
}
