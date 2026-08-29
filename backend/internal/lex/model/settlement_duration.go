package model

// settlement_duration.go declares the processing-time fact kind for the
// Settlements / ADR vertical (contract C-2). It lives in its own file so the
// Settlements maturation unit can own the constant without editing the shared
// reporting.go enum block.
//
// INTEGRATOR ACTION REQUIRED: add DurationFactSettlementResolution to the
// ValidDurationFactKind switch in model/reporting.go so the fact store accepts it:
//
//	case DurationFactCaseResolution, DurationFactContractReview,
//		DurationFactConsultationAnswer, DurationFactRequestProcessing,
//		DurationFactSettlementResolution:
//		return true
//
// Until that one-line edit lands, SettlementService's best-effort recorder logs a
// validation warning and skips the settlement-resolution fact (it never fails the
// approval transaction); the matter-closed case_resolution fact is unaffected.
const (
	// DurationFactSettlementResolution measures elapsed working time from a
	// settlement being opened (CreatedAt) to it clearing the approval chain
	// (approved_at). Subject is the settlement ID.
	DurationFactSettlementResolution DurationFactKind = "settlement_resolution"
)
