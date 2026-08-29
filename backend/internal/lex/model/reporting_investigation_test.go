package model

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestInvestigationReportItemJSONDoesNotExposePII(t *testing.T) {
	payload, err := json.Marshal(InvestigationReportItem{InvestigationNumber: "INV-001"})
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	encoded := string(payload)
	for _, forbidden := range []string{"subject", "lead_investigator", "findings", "recommendations", "metadata"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("report item JSON exposes %q: %s", forbidden, encoded)
		}
	}
}
