package consumer

import (
	"encoding/json"
	"testing"
)

// TestEventSchemaContract asserts that a representative payload for each
// high-value event type — the shape a well-behaved producer emits — satisfies
// the consumer's typed schema (no missing required fields), and that a payload
// with the field renamed/removed is detected. This is the contract test guarding
// against silent rule-match loss from producer schema drift (#13).
func TestEventSchemaContract(t *testing.T) {
	cases := []struct {
		name        string
		eventType   string
		payload     map[string]interface{}
		wantMissing []string
	}{
		{
			name:      "cyber alert created satisfies schema",
			eventType: "com.clario360.cyber.alert.created",
			payload:   map[string]interface{}{"id": "a1", "title": "Suspicious login", "severity": "critical"},
		},
		{
			name:      "quality check failed satisfies schema",
			eventType: "com.clario360.data.quality.check_failed",
			payload:   map[string]interface{}{"rule_id": "r1", "severity": "high"},
		},
		{
			name:      "contradiction detected satisfies schema",
			eventType: "com.clario360.data.contradiction.detected",
			payload:   map[string]interface{}{"id": "c1", "title": "Conflict", "severity": "high"},
		},
		{
			name:      "clause risk flagged satisfies schema",
			eventType: "com.clario360.lex.clause.risk_flagged",
			payload:   map[string]interface{}{"contract_id": "k1", "contract_title": "MSA", "severity": "critical"},
		},
		{
			name:      "playbook deviations satisfy schema",
			eventType: "com.clario360.lex.playbook.deviations_detected",
			payload: map[string]interface{}{
				"contract_id": "k1", "playbook_name": "Standard", "max_severity": "high",
				"missing_required_count": 2, "missing_count": 2, "altered_count": 1, "extra_count": 0,
			},
		},
		{
			name:      "meeting reminder satisfies schema",
			eventType: "com.clario360.acta.meeting.reminder",
			payload:   map[string]interface{}{"meeting_id": "m1", "title": "Board", "hours_until": 1},
		},
		{
			name:      "meeting reminder with zero hours_until still satisfies (present)",
			eventType: "com.clario360.acta.meeting.reminder",
			payload:   map[string]interface{}{"meeting_id": "m1", "title": "Board", "hours_until": 0},
		},
		{
			name:      "contract expiring satisfies schema",
			eventType: "com.clario360.lex.contract.expiring",
			payload:   map[string]interface{}{"id": "k1", "title": "NDA", "days_until_expiry": 7},
		},
		{
			name:      "enterprise contract expiring satisfies schema",
			eventType: "com.clario360.enterprise.lex.contract.expiring",
			payload:   map[string]interface{}{"id": "k1", "title": "NDA", "days_until_expiry": 3},
		},
		{
			name:      "unregistered type is never flagged",
			eventType: "com.clario360.iam.user.registered",
			payload:   map[string]interface{}{"user_id": "u1"},
		},
		// Negative cases: a producer renaming/dropping the branched-on field.
		{
			name:        "cyber alert with renamed severity is detected",
			eventType:   "com.clario360.cyber.alert.created",
			payload:     map[string]interface{}{"id": "a1", "title": "Suspicious login", "sev": "critical"},
			wantMissing: []string{"severity"},
		},
		{
			name:        "contract expiring with dropped days_until_expiry is detected",
			eventType:   "com.clario360.lex.contract.expiring",
			payload:     map[string]interface{}{"id": "k1", "title": "NDA"},
			wantMissing: []string{"days_until_expiry"},
		},
		{
			name:        "playbook deviation missing both fields is detected",
			eventType:   "com.clario360.lex.playbook.deviations_detected",
			payload:     map[string]interface{}{"contract_id": "k1"},
			wantMissing: []string{"max_severity", "missing_required_count"},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.payload)
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}
			got := CheckEventSchema(tc.eventType, raw)
			if !equalStringSets(got, tc.wantMissing) {
				t.Fatalf("CheckEventSchema(%q) = %v, want %v", tc.eventType, got, tc.wantMissing)
			}
		})
	}
}

func equalStringSets(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := make(map[string]int, len(a))
	for _, s := range a {
		seen[s]++
	}
	for _, s := range b {
		seen[s]--
	}
	for _, v := range seen {
		if v != 0 {
			return false
		}
	}
	return true
}
