package dto

import "testing"

func TestRemediateRecommendationRequest_Validate(t *testing.T) {
	cases := []struct {
		name    string
		action  string
		wantErr bool
	}{
		{"apply is valid", "apply", false},
		{"revoke is valid", "revoke", false},
		{"dismiss is valid", "dismiss", false},
		{"empty is invalid", "", true},
		{"unknown is invalid", "delete", true},
		{"case-sensitive", "Apply", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := &RemediateRecommendationRequest{Action: tc.action, Note: "n"}
			err := req.Validate()
			if tc.wantErr && err == nil {
				t.Fatalf("expected error for action %q, got nil", tc.action)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error for action %q: %v", tc.action, err)
			}
		})
	}
}
