package service

import (
	"strings"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// applyRejectReturnReason enforces the Al Othaim PRD requirement (PRD 7.0 /
// Diagram B) that a REJECT verdict at a legal-request or lawsuit approval gate
// carries a structured return-reason code drawn from the controlled deficiency
// list (model.ReturnIncompleteReasonCode) — the same vocabulary the execution
// "return incomplete" path already uses. Previously an approver rejecting at the
// approval gate captured only free-text notes; this makes the reason reportable
// and auditable.
//
// The check applies only when the decision resolves to a REJECT verb; an approve
// verdict ignores the field. On success the validated (normalized) code is written
// back onto the request and stamped into the decision metadata so it persists on
// the approver's decision record. The mutated request is returned to the caller.
func applyRejectReturnReason(req dto.WorkflowDecisionRequest) (dto.WorkflowDecisionRequest, error) {
	if !strings.EqualFold(strings.TrimSpace(req.Decision), "reject") {
		return req, nil
	}

	code := ""
	if req.ReturnReasonCode != nil {
		code = strings.ToLower(strings.TrimSpace(*req.ReturnReasonCode))
	}
	if code == "" {
		return req, validationError(
			"a return-reason code is required when rejecting an approval",
			map[string]string{"return_reason_code": "required"},
		)
	}
	if !model.ReturnIncompleteReasonCode(code).Valid() {
		return req, validationError(
			"return_reason_code must be one of missing_information, doa_non_compliance, incomplete_referral_procedures, invalid_attachments",
			map[string]string{"return_reason_code": "invalid"},
		)
	}

	normalized := code
	req.ReturnReasonCode = &normalized
	if req.Metadata == nil {
		req.Metadata = map[string]any{}
	}
	req.Metadata["return_reason_code"] = code
	return req, nil
}
