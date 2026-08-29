package residency

import "testing"

func TestEnforceRegion_DecisionTable(t *testing.T) {
	cases := []struct {
		name           string
		tenantRegion   string
		serviceRegion  string
		allowedRegions []string
		want           Decision
	}{
		{"enforcement-disabled (empty service)", "ksa-central", "", nil, Allow},
		{"tenant-unrestricted (empty tenant)", "", "ksa-central", nil, Allow},
		{"both-empty", "", "", nil, Allow},
		{"same-region", "ksa-central", "ksa-central", nil, Allow},
		{"same-region-case-insensitive", "KSA-Central", "ksa-central", nil, Allow},
		{"same-region-whitespace", " ksa-central ", "ksa-central", nil, Allow},
		{"cross-region-denied", "eu-west", "ksa-central", nil, Deny},
		{"cross-region-allowed-by-allowlist", "ksa-west", "ksa-central", []string{"ksa-west"}, Allow},
		{"allowlist-case-insensitive", "KSA-West", "ksa-central", []string{"ksa-west"}, Allow},
		{"allowlist-miss-denied", "us-east", "ksa-central", []string{"ksa-west"}, Deny},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := EnforceRegion(tc.tenantRegion, tc.serviceRegion, tc.allowedRegions...)
			if got != tc.want {
				t.Errorf("EnforceRegion(%q,%q,%v) = %v, want %v",
					tc.tenantRegion, tc.serviceRegion, tc.allowedRegions, got, tc.want)
			}
		})
	}
}

func TestDecision_String(t *testing.T) {
	if Allow.String() != "allow" {
		t.Errorf("Allow.String() = %q", Allow.String())
	}
	if Deny.String() != "deny" {
		t.Errorf("Deny.String() = %q", Deny.String())
	}
}
