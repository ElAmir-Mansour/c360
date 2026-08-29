package service

import "testing"

func TestRemediationStateForAction(t *testing.T) {
	cases := []struct {
		action      string
		wantRemed   string
		wantMapping string
		wantOK      bool
	}{
		{"revoke", "revoked", "revoked", true},
		{"apply", "applied", "pending_review", true},
		{"dismiss", "dismissed", "", true},
		{"", "", "", false},
		{"bogus", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.action, func(t *testing.T) {
			remed, mapping, ok := remediationStateForAction(tc.action)
			if ok != tc.wantOK {
				t.Fatalf("ok: got %v want %v", ok, tc.wantOK)
			}
			if remed != tc.wantRemed {
				t.Errorf("remediationStatus: got %q want %q", remed, tc.wantRemed)
			}
			if mapping != tc.wantMapping {
				t.Errorf("mappingStatus: got %q want %q", mapping, tc.wantMapping)
			}
		})
	}
}
