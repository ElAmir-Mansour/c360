//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// TestLegalRequesterSeesOnlyOwnRequests proves self-service visibility is a
// backend boundary, not an optional UI filter. It also proves a forged
// requester_user_id query cannot widen the list and direct IDs stay opaque.
func TestLegalRequesterSeesOnlyOwnRequests(t *testing.T) {
	t.Parallel()

	operator := newLexHarness(t)
	requesterID := uuid.New()
	otherRequesterID := uuid.New()
	requester := operator.withToken(operator.env.mustToken(t, operator.tenantID, requesterID, "legal-requester"))

	create := func(actor *lexHarness, requesterUserID *uuid.UUID, label string) model.LegalRequest {
		t.Helper()
		return mustData[model.LegalRequest](t, actor.doJSON(t, http.MethodPost, "/api/v1/lex/legal-requests", dto.CreateLegalRequestRequest{
			RequestType:     fmt.Sprintf("visibility_%s_%s", label, uuid.NewString()[:8]),
			Title:           forms.LocalizedText{EN: label, AR: label},
			Description:     "Request visibility integration fixture.",
			RequesterUserID: requesterUserID,
			RequesterName:   label,
			Priority:        model.RequestPriorityNormal,
		}), http.StatusCreated)
	}

	own := create(requester, nil, "Own request")
	other := create(operator, &otherRequesterID, "Another request")

	page := mustPaginated[model.LegalRequest](t, requester.doJSON(t, http.MethodGet,
		"/api/v1/lex/legal-requests?page=1&per_page=100", nil,
	), http.StatusOK)
	if page.Pagination.Total != 1 || len(page.Data) != 1 || page.Data[0].ID != own.ID {
		t.Fatalf("requester list = total %d rows %+v, want only %s", page.Pagination.Total, page.Data, own.ID)
	}
	ownByClientName := mustPaginated[model.LegalRequest](t, requester.doJSON(t, http.MethodGet,
		"/api/v1/lex/legal-requests?page=1&per_page=100&search=Own%20request", nil,
	), http.StatusOK)
	if ownByClientName.Pagination.Total != 1 || len(ownByClientName.Data) != 1 || ownByClientName.Data[0].ID != own.ID {
		t.Fatalf("requester-name search = total %d rows %+v, want only %s", ownByClientName.Pagination.Total, ownByClientName.Data, own.ID)
	}
	hiddenByClientName := mustPaginated[model.LegalRequest](t, requester.doJSON(t, http.MethodGet,
		"/api/v1/lex/legal-requests?page=1&per_page=100&search=Another%20request", nil,
	), http.StatusOK)
	if hiddenByClientName.Pagination.Total != 0 || len(hiddenByClientName.Data) != 0 {
		t.Fatalf("requester-name search widened own-record scope: total %d rows %+v, want none", hiddenByClientName.Pagination.Total, hiddenByClientName.Data)
	}

	forged := mustPaginated[model.LegalRequest](t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests?page=1&per_page=100&requester_user_id=%s", otherRequesterID), nil,
	), http.StatusOK)
	if forged.Pagination.Total != 0 || len(forged.Data) != 0 {
		t.Fatalf("forged requester filter widened scope: total %d rows %+v, want none", forged.Pagination.Total, forged.Data)
	}

	mustData[model.LegalRequest](t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s", own.ID), nil,
	), http.StatusOK)
	ownAttachments := mustData[[]model.LegalRequestAttachment](t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s/attachments", own.ID), nil,
	), http.StatusOK)
	if len(ownAttachments) != 0 {
		t.Fatalf("new request attachment list = %+v, want empty", ownAttachments)
	}
	mustError(t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s", other.ID), nil,
	), http.StatusNotFound)
	mustError(t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s/attachments", other.ID), nil,
	), http.StatusForbidden)
	mustError(t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s/audit", other.ID), nil,
	), http.StatusNotFound)
	mustError(t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s/notes", other.ID), nil,
	), http.StatusNotFound)
	mustError(t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s/feedback", other.ID), dto.SubmitLegalRequestFeedbackRequest{Rating: 5},
	), http.StatusNotFound)
	mustError(t, requester.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/requests/%s/execution", other.ID), nil,
	), http.StatusNotFound)
	crossOwnerDescription := "cross-owner update must not succeed"
	mustError(t, requester.doJSON(t, http.MethodPut,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s", other.ID), dto.UpdateLegalRequestRequest{
			Description: &crossOwnerDescription,
		}), http.StatusNotFound)
	mustError(t, requester.doJSON(t, http.MethodPost,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s/submit", other.ID), dto.SubmitLegalRequestRequest{},
	), http.StatusNotFound)

	// A handling lawyer assigned on the routed downstream subject can review the
	// originating request evidence, while another provider with the same role is
	// denied. This is explicit work assignment, not tenant-wide legal visibility.
	reviewerID := uuid.New()
	unrelatedProviderID := uuid.New()
	linkedCase := operator.createLegalCase(t, "Attachment assignment", model.CaseCompanyStatusPlaintiff)
	if _, err := operator.env.db.Exec(t.Context(), `UPDATE legal_cases SET handling_officer_id = $3 WHERE tenant_id = $1 AND id = $2`, operator.tenantID, linkedCase.ID, reviewerID); err != nil {
		t.Fatalf("assign handling officer: %v", err)
	}
	if _, err := operator.env.db.Exec(t.Context(), `UPDATE legal_requests SET subject_type = 'legal_case', subject_id = $3 WHERE tenant_id = $1 AND id = $2`, operator.tenantID, other.ID, linkedCase.ID); err != nil {
		t.Fatalf("link assigned case to request: %v", err)
	}
	reviewer := operator.withToken(operator.env.mustToken(t, operator.tenantID, reviewerID, "legal-officer"))
	assignedAttachments := mustData[[]model.LegalRequestAttachment](t, reviewer.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s/attachments", other.ID), nil,
	), http.StatusOK)
	if len(assignedAttachments) != 0 {
		t.Fatalf("assigned provider attachment list = %+v, want empty", assignedAttachments)
	}
	unrelatedProvider := operator.withToken(operator.env.mustToken(t, operator.tenantID, unrelatedProviderID, "legal-officer"))
	mustError(t, unrelatedProvider.doJSON(t, http.MethodGet,
		fmt.Sprintf("/api/v1/lex/legal-requests/%s/attachments", other.ID), nil,
	), http.StatusForbidden)

	operatorPage := mustPaginated[model.LegalRequest](t, operator.doJSON(t, http.MethodGet,
		"/api/v1/lex/legal-requests?page=1&per_page=100", nil,
	), http.StatusOK)
	if operatorPage.Pagination.Total != 2 {
		t.Fatalf("operator list total = %d, want tenant-wide 2", operatorPage.Pagination.Total)
	}
}
