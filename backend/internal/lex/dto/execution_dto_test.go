package dto

import (
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

// PRD 6.3: a return-incomplete MUST carry one of the four controlled deficiency
// codes. Validate (called after Normalize) rejects a missing or unrecognised
// code, so a free-text-only return can never bypass the categorised-deficiency
// requirement.
func TestReturnIncompleteRequestValidateRequiresReasonCode(t *testing.T) {
	tests := []struct {
		name       string
		reasonCode model.ReturnIncompleteReasonCode
		reason     string
		wantField  string // "" means expect valid
	}{
		{
			name:       "missing reason code with free-text only is rejected",
			reasonCode: "",
			reason:     "please attach the signed board resolution",
			wantField:  "reason_code",
		},
		{
			name:       "unrecognised reason code is rejected",
			reasonCode: model.ReturnIncompleteReasonCode("something_made_up"),
			reason:     "detail",
			wantField:  "reason_code",
		},
		{
			name:       "each controlled code is accepted",
			reasonCode: model.ReturnReasonMissingInformation,
			reason:     "detail",
			wantField:  "",
		},
		{
			name:       "doa non-compliance is accepted",
			reasonCode: model.ReturnReasonDoANonCompliance,
			reason:     "detail",
			wantField:  "",
		},
		{
			name:       "incomplete referral procedures is accepted",
			reasonCode: model.ReturnReasonIncompleteReferralProcedures,
			reason:     "detail",
			wantField:  "",
		},
		{
			name:       "invalid attachments is accepted",
			reasonCode: model.ReturnReasonInvalidAttachments,
			reason:     "detail",
			wantField:  "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := ReturnIncompleteRequest{ReasonCode: tt.reasonCode, Reason: tt.reason}
			req.Normalize()
			fields := req.Validate()
			if tt.wantField == "" {
				if fields != nil {
					t.Fatalf("Validate() = %v, want nil (valid)", fields)
				}
				return
			}
			if fields == nil {
				t.Fatalf("Validate() = nil, want error on field %q", tt.wantField)
			}
			if _, ok := fields[tt.wantField]; !ok {
				t.Fatalf("Validate() = %v, want error on field %q", fields, tt.wantField)
			}
		})
	}
}

// Normalize folds the controlled-code label into Reason, so a valid code never
// leaves Reason empty and Validate therefore passes the reason check.
func TestReturnIncompleteRequestValidateValidCodeFillsReason(t *testing.T) {
	req := ReturnIncompleteRequest{ReasonCode: model.ReturnReasonMissingInformation}
	req.Normalize()
	if req.Reason == "" {
		t.Fatal("Normalize() should have folded the code label into an empty Reason")
	}
	if fields := req.Validate(); fields != nil {
		t.Fatalf("Validate() = %v, want nil for a valid code with folded reason", fields)
	}
}
