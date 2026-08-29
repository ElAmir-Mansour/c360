//go:build integration

package integration

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestLiveMigrationsAndSeed(t *testing.T) {
	h := newDemoHarness(t)
	seedTenantID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	contracts := h.scalarInt(t, `SELECT COUNT(*) FROM contracts WHERE tenant_id = $1 AND deleted_at IS NULL`, seedTenantID)
	// Twenty portfolio fixtures plus the draft contract spawned when the seeded
	// contract-review request is submitted and routed.
	if contracts != 21 {
		t.Fatalf("seeded contracts = %d, want 21", contracts)
	}

	clauses := h.scalarInt(t, `SELECT COUNT(*) FROM contract_clauses WHERE tenant_id = $1`, seedTenantID)
	if clauses != 60 {
		t.Fatalf("seeded clauses = %d, want 60", clauses)
	}

	alerts := h.scalarInt(t, `SELECT COUNT(*) FROM compliance_alerts WHERE tenant_id = $1`, seedTenantID)
	if alerts != 10 {
		t.Fatalf("seeded alerts = %d, want 10", alerts)
	}

	rules := h.scalarInt(t, `SELECT COUNT(*) FROM compliance_rules WHERE tenant_id = $1 AND deleted_at IS NULL`, seedTenantID)
	if rules != 5 {
		t.Fatalf("seeded compliance rules = %d, want 5", rules)
	}

	documents := h.scalarInt(t, `SELECT COUNT(*) FROM legal_documents WHERE tenant_id = $1 AND deleted_at IS NULL`, seedTenantID)
	if documents != 22 {
		t.Fatalf("seeded legal documents = %d, want 22", documents)
	}

	documentVersions := h.scalarInt(t, `SELECT COUNT(*) FROM document_versions WHERE tenant_id = $1`, seedTenantID)
	if documentVersions != 31 {
		t.Fatalf("seeded document versions = %d, want 31", documentVersions)
	}

	autoRenewContracts := h.scalarInt(t, `SELECT COUNT(*) FROM contracts WHERE tenant_id = $1 AND auto_renew = true AND deleted_at IS NULL`, seedTenantID)
	if autoRenewContracts != 3 {
		t.Fatalf("seeded auto-renew contracts = %d, want 3", autoRenewContracts)
	}

	expiringActive := h.scalarInt(t, `SELECT COUNT(*) FROM contracts WHERE tenant_id = $1 AND status = 'active' AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + 30 AND deleted_at IS NULL`, seedTenantID)
	if expiringActive != 8 {
		t.Fatalf("seeded active contracts expiring in 30 days = %d, want 8", expiringActive)
	}

	stats := mustData[model.ContractStats](t, h.doJSON(t, http.MethodGet, "/api/v1/lex/contracts/stats", nil), http.StatusOK)
	if stats.ByType[string(model.ContractTypeServiceAgreement)] != 5 {
		t.Fatalf("service_agreement count = %d, want 5", stats.ByType[string(model.ContractTypeServiceAgreement)])
	}
	if stats.ByType[string(model.ContractTypeNDA)] != 4 {
		t.Fatalf("nda count = %d, want 4", stats.ByType[string(model.ContractTypeNDA)])
	}
	if stats.ByStatus[string(model.ContractStatusActive)] != 14 {
		t.Fatalf("active contract count = %d, want 14", stats.ByStatus[string(model.ContractStatusActive)])
	}
	if stats.ByStatus[string(model.ContractStatusExpired)] != 2 {
		t.Fatalf("expired contract count = %d, want 2", stats.ByStatus[string(model.ContractStatusExpired)])
	}
	if stats.Expiring30Days != 8 {
		t.Fatalf("stats expiring 30 days = %d, want 8", stats.Expiring30Days)
	}
}

// TestOthaimPRDCatalogAndSLATargets proves that the provisioned tenant sees the
// exact active service/approval/channel/SLA baseline from the client PRD, not
// merely that the migration and demo seed complete without an error.
func TestOthaimPRDCatalogAndSLATargets(t *testing.T) {
	h := newDemoHarness(t)
	tenantID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	type expectedService struct {
		name              string
		audience          string
		requesterApproval bool
		providerApproval  bool
		mailbox           string
	}
	expectedServices := map[string]expectedService{
		model.ServiceCodeLegalConsultation: {
			name: "Legal Consultations", audience: "department_managers",
			requesterApproval: true, providerApproval: false, mailbox: "contract-legal@othaim.com",
		},
		model.ServiceCodeContractReview: {
			name: "Review of Contracts and Agreements", audience: "all_employees",
			requesterApproval: true, providerApproval: true, mailbox: "contract-legal@othaim.com",
		},
		model.ServiceCodeLegalOpinion: {
			name: "Providing Preliminary Legal Study", audience: "department_managers",
			requesterApproval: true, providerApproval: false, mailbox: "case-legal@othaim.com",
		},
		model.ServiceCodeLitigationSupport: {
			name: "Judicial Case Study", audience: "all_employees",
			requesterApproval: true, providerApproval: true, mailbox: "case-legal@othaim.com",
		},
		model.ServiceCodeEnforcementRequest: {
			name: "Submission of Execution Request", audience: "all_employees",
			requesterApproval: true, providerApproval: true, mailbox: "case-legal@othaim.com",
		},
		model.ServiceCodeViolationStudy: {
			name: "Investigation of Violation or Breach", audience: "department_managers",
			requesterApproval: true, providerApproval: true, mailbox: "case-legal@othaim.com",
		},
		model.ServiceCodeFieldInspection: {
			name: "Field Inspection and Incident Documentation", audience: "department_managers",
			requesterApproval: true, providerApproval: true, mailbox: "case-legal@othaim.com",
		},
		model.ServiceCodePowerOfAttorney: {
			name: "Issuing Power of Attorney and Delegations", audience: "department_managers",
			requesterApproval: true, providerApproval: true, mailbox: "am@othaim.com",
		},
	}

	rows, err := h.env.db.Query(t.Context(), `
SELECT code, name->>'en', available_to, requester_approval_required,
       provider_approval_required, channel, metadata->>'intake_mailbox'
FROM legal_service_catalog
WHERE tenant_id = $1 AND active AND deleted_at IS NULL
ORDER BY code`, tenantID)
	if err != nil {
		t.Fatalf("query active PRD services: %v", err)
	}
	defer rows.Close()

	seenServices := make(map[string]bool, len(expectedServices))
	for rows.Next() {
		var code, name, channel, mailbox string
		var audience []string
		var requesterApproval, providerApproval bool
		if err := rows.Scan(&code, &name, &audience, &requesterApproval, &providerApproval, &channel, &mailbox); err != nil {
			t.Fatalf("scan active PRD service: %v", err)
		}
		want, ok := expectedServices[code]
		if !ok {
			t.Errorf("unexpected active service %s", code)
			continue
		}
		seenServices[code] = true
		if name != want.name {
			t.Errorf("%s name = %q, want %q", code, name, want.name)
		}
		if len(audience) != 1 || audience[0] != want.audience {
			t.Errorf("%s audience = %#v, want [%s]", code, audience, want.audience)
		}
		if requesterApproval != want.requesterApproval || providerApproval != want.providerApproval {
			t.Errorf("%s approvals = requester:%v provider:%v, want requester:%v provider:%v",
				code, requesterApproval, providerApproval, want.requesterApproval, want.providerApproval)
		}
		if channel != string(model.ServiceChannelBoth) {
			t.Errorf("%s channel = %q, want both", code, channel)
		}
		if mailbox != want.mailbox {
			t.Errorf("%s mailbox = %q, want %q", code, mailbox, want.mailbox)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate active PRD services: %v", err)
	}
	if len(seenServices) != len(expectedServices) {
		t.Fatalf("active PRD services = %d, want %d; seen=%v", len(seenServices), len(expectedServices), seenServices)
	}

	expectedSLA := map[string]int{
		"LEGAL_CONSULTATION|emergency": 2,
		"LEGAL_CONSULTATION|urgent":    4, "LEGAL_CONSULTATION|normal": 6,
		"CONTRACT_REVIEW|emergency": 1,
		"CONTRACT_REVIEW|urgent":    3, "CONTRACT_REVIEW|normal": 5,
		"LEGAL_OPINION|emergency": 2,
		"LEGAL_OPINION|urgent":    5, "LEGAL_OPINION|normal": 15,
		"LITIGATION_SUPPORT|emergency": 5,
		"LITIGATION_SUPPORT|urgent":    10, "LITIGATION_SUPPORT|normal": 30,
		"ENFORCEMENT_REQUEST|emergency": 5,
		"ENFORCEMENT_REQUEST|urgent":    10, "ENFORCEMENT_REQUEST|normal": 20,
		"VIOLATION_STUDY|emergency": 5,
		"VIOLATION_STUDY|urgent":    10, "VIOLATION_STUDY|normal": 20,
		"FIELD_INSPECTION|emergency": 5,
		"FIELD_INSPECTION|urgent":    10, "FIELD_INSPECTION|normal": 20,
		"POWER_OF_ATTORNEY|emergency": 5,
		"POWER_OF_ATTORNEY|urgent":    10, "POWER_OF_ATTORNEY|normal": 20,
	}
	slaRows, err := h.env.db.Query(t.Context(), `
SELECT service_code, priority, turnaround_working_days, ack_window_value, ack_window_unit
FROM legal_sla_targets
WHERE tenant_id = $1 AND active AND deleted_at IS NULL`, tenantID)
	if err != nil {
		t.Fatalf("query active PRD SLA targets: %v", err)
	}
	defer slaRows.Close()

	seenSLA := make(map[string]bool, len(expectedSLA))
	for slaRows.Next() {
		var code, priority, ackUnit string
		var turnaround, ackValue int
		if err := slaRows.Scan(&code, &priority, &turnaround, &ackValue, &ackUnit); err != nil {
			t.Fatalf("scan active PRD SLA target: %v", err)
		}
		key := code + "|" + priority
		wantTurnaround, ok := expectedSLA[key]
		if !ok {
			t.Errorf("unexpected active SLA target %s", key)
			continue
		}
		seenSLA[key] = true
		if turnaround != wantTurnaround {
			t.Errorf("%s turnaround = %d, want %d", key, turnaround, wantTurnaround)
		}
		wantAckValue, wantAckUnit := 1, "working_days"
		if priority == "emergency" {
			wantAckValue, wantAckUnit = 2, "working_hours"
		} else if priority == "urgent" {
			wantAckValue, wantAckUnit = 4, "working_hours"
		}
		if ackValue != wantAckValue || ackUnit != wantAckUnit {
			t.Errorf("%s acknowledgement = %d %s, want %d %s", key, ackValue, ackUnit, wantAckValue, wantAckUnit)
		}
	}
	if err := slaRows.Err(); err != nil {
		t.Fatalf("iterate active PRD SLA targets: %v", err)
	}
	if len(seenSLA) != len(expectedSLA) {
		t.Fatalf("active PRD SLA targets = %d, want %d; seen=%v", len(seenSLA), len(expectedSLA), seenSLA)
	}
}
