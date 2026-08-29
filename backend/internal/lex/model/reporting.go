package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// Package note (Phase 4 — Reporting & KPIs, CAP-133..151).
//
// These models are the READ-side shapes returned by the reporting service. They
// are computed from the REAL Phase-0..3 source tables (legal_cases,
// legal_investigations, contracts, legal_consultations,
// legal_requests / legal_request_execution_state,
// legal_sla_clocks) via GROUP BY aggregates, plus the duration_fact table that
// the reporting consumer populates from CloudEvents/source reconstruction. C-2
// SLA KPIs read request-processing facts so transition coverage is observable.

// ReportFilters is the common filter envelope echoed back in every report so the
// caller can see exactly which window/scope produced the numbers. All fields are
// optional; an empty value means "no constraint".
type ReportFilters struct {
	From       *time.Time `json:"from,omitempty"`
	To         *time.Time `json:"to,omitempty"`
	Department *string    `json:"department,omitempty"`
	Status     *string    `json:"status,omitempty"`
	Type       *string    `json:"type,omitempty"`
}

// CountBucket is a single {key,count} aggregate row. Used for by-type / by-dept /
// by-status breakdowns rendered as tables or charts.
type CountBucket struct {
	Key   string `json:"key"`
	Count int    `json:"count"`
}

// --- CASE reports (CAP-133..138) -------------------------------------------

// CaseReport is the litigation-case analytics rollup over legal_cases.
//
//	Total           CAP-133 total case count.
//	ByType          CAP-134 grouped by case_type.
//	ByDepartment    CAP-135 grouped by department.
//	ByStatus        CAP-136 grouped by status.
//	Closed          CAP-137 count of status='closed'.
//	UnderProcedure  CAP-138 count of status='under_procedure'.
type CaseReport struct {
	GeneratedAt    time.Time     `json:"generated_at"`
	Filters        ReportFilters `json:"filters"`
	Total          int           `json:"total"`
	ByType         []CountBucket `json:"by_type"`
	ByDepartment   []CountBucket `json:"by_department"`
	ByStatus       []CountBucket `json:"by_status"`
	ByCompanyRole  []CountBucket `json:"by_company_status"`
	Closed         int           `json:"closed"`
	UnderProcedure int           `json:"under_procedure"`
}

// --- INVESTIGATION reports -------------------------------------------------

// InvestigationSLAReport is the SLA outcome rollup for investigations in the
// selected report scope. ComplianceRatePct excludes pending clocks from the
// denominator, matching the other SLA reports.
type InvestigationSLAReport struct {
	OnTime            int     `json:"on_time"`
	Breached          int     `json:"breached"`
	Pending           int     `json:"pending"`
	ComplianceRatePct float64 `json:"compliance_rate_pct"`
}

// InvestigationReportItem is the deliberately non-sensitive drill-down
// projection returned to report readers. Investigation subject, investigator,
// findings, recommendations and metadata are intentionally excluded because
// lex:report:read does not imply permission to read investigation PII.
type InvestigationReportItem struct {
	ID                  uuid.UUID           `json:"id"`
	InvestigationNumber string              `json:"investigation_number"`
	Status              InvestigationStatus `json:"status"`
	Category            string              `json:"category"`
	Priority            LegalPriority       `json:"priority"`
	Department          *string             `json:"department,omitempty"`
	CreatedAt           time.Time           `json:"created_at"`
	ResolvedAt          *time.Time          `json:"resolved_at,omitempty"`
	AgeDays             float64             `json:"age_days"`
	SLAOutcome          *SLAClockOutcome    `json:"sla_outcome,omitempty"`
}

// InvestigationReport is the reports-page investigation portfolio payload.
// Category is metadata.category when explicitly classified, then the linked
// legal case's case_type, then "unspecified". Average approval duration is computed
// from the immutable register->approved duration fact rather than updated_at.
type InvestigationReport struct {
	GeneratedAt                time.Time                 `json:"generated_at"`
	Filters                    ReportFilters             `json:"filters"`
	Total                      int                       `json:"total"`
	ByStatus                   []CountBucket             `json:"by_status"`
	ByCategory                 []CountBucket             `json:"by_category"`
	Open                       int                       `json:"open"`
	Closed                     int                       `json:"closed"`
	AvgOpenAgeDays             float64                   `json:"avg_open_age_days"`
	AvgRegisterToApprovedHours float64                   `json:"avg_register_to_approved_hours"`
	ApprovalSampleSize         int                       `json:"approval_sample_size"`
	SLA                        InvestigationSLAReport    `json:"sla"`
	Items                      []InvestigationReportItem `json:"items"`
	ItemsTruncated             bool                      `json:"items_truncated"`
}

// --- CASE & INVESTIGATION CONTROL PANEL ------------------------------------

// CaseControlResolutionWindow is the half-open lifecycle-event window used by
// the control panel's resolved-case KPI. A half-open range prevents an event on
// a refresh boundary from being counted twice by downstream snapshot consumers.
type CaseControlResolutionWindow struct {
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
}

// CaseControlRecentCase is the deliberately compact case projection rendered by
// the monitoring table. It excludes case metadata and audit/user identifiers,
// while retaining the bilingual title and the two pre-aggregated list fields.
type CaseControlRecentCase struct {
	ID                uuid.UUID           `json:"id"`
	CaseNumber        string              `json:"case_number"`
	Title             forms.LocalizedText `json:"title"`
	CaseType          string              `json:"case_type"`
	CompanyStatus     CaseCompanyStatus   `json:"company_status"`
	Status            CaseStatus          `json:"status"`
	Priority          LegalPriority       `json:"priority"`
	ResponsibleLawyer *string             `json:"responsible_lawyer,omitempty"`
	Department        *string             `json:"department,omitempty"`
	NextHearingDate   *time.Time          `json:"next_hearing_date,omitempty"`
	PartyCount        int                 `json:"party_count"`
	UpdatedAt         time.Time           `json:"updated_at"`
}

// CaseControlActiveInvestigation is the active-work projection. Subject,
// lead-investigator and findings can contain PII, so the endpoint that returns
// this shape MUST require both case-view and investigation-view permissions.
type CaseControlActiveInvestigation struct {
	ID                  uuid.UUID           `json:"id"`
	InvestigationNumber string              `json:"investigation_number"`
	Subject             string              `json:"subject"`
	LeadInvestigator    string              `json:"lead_investigator"`
	Status              InvestigationStatus `json:"status"`
	Priority            LegalPriority       `json:"priority"`
	Department          *string             `json:"department,omitempty"`
	Findings            string              `json:"findings"`
	Recommendations     string              `json:"recommendations"`
	CreatedAt           time.Time           `json:"created_at"`
	UpdatedAt           time.Time           `json:"updated_at"`
}

// CaseControlRecentInvestigation is the deliberately minimal recent-work row.
// It excludes investigation subject, findings, recommendations and department
// so expanding the list to six rows does not expand the endpoint's sensitive
// data footprint. CaseType is projected from the optionally linked legal case.
type CaseControlRecentInvestigation struct {
	ID                  uuid.UUID           `json:"id"`
	InvestigationNumber string              `json:"investigation_number"`
	CaseType            *string             `json:"case_type,omitempty"`
	LeadInvestigator    string              `json:"lead_investigator"`
	Status              InvestigationStatus `json:"status"`
	Priority            LegalPriority       `json:"priority"`
	UpdatedAt           time.Time           `json:"updated_at"`
}

// CaseControlCases is the complete litigation portfolio slice needed by the
// control panel. The status/type/company-role buckets cover the full live
// tenant portfolio; no list-page limit participates in these metrics.
type CaseControlCases struct {
	Total             int                     `json:"total"`
	Active            int                     `json:"active"`
	UnderReview       int                     `json:"under_review"`
	DueIn30Days       int                     `json:"due_in_30_days"`
	Closed            int                     `json:"closed"`
	Cancelled         int                     `json:"cancelled"`
	OnHold            int                     `json:"on_hold"`
	ResolvedLast7Days int                     `json:"resolved_last_7_days"`
	ByType            []CountBucket           `json:"by_type"`
	ByStatus          []CountBucket           `json:"by_status"`
	ByCompanyRole     []CountBucket           `json:"by_company_role"`
	Recent            []CaseControlRecentCase `json:"recent"`
}

// CaseControlInvestigations carries exact portfolio counts, the two newest
// in-flight records and a six-row minimal recent feed. Ongoing means every
// non-terminal investigation status, including rejected records awaiting rework.
type CaseControlInvestigations struct {
	Total      int                              `json:"total"`
	Ongoing    int                              `json:"ongoing"`
	ByStatus   []CountBucket                    `json:"by_status"`
	ByCaseType []CountBucket                    `json:"by_case_type"`
	Active     []CaseControlActiveInvestigation `json:"active"`
	Recent     []CaseControlRecentInvestigation `json:"recent"`
}

// CaseControlDashboard is the consolidated read model for
// GET /dashboard/cases-control.
type CaseControlDashboard struct {
	GeneratedAt      time.Time                   `json:"generated_at"`
	ResolutionWindow CaseControlResolutionWindow `json:"resolution_window"`
	Cases            CaseControlCases            `json:"cases"`
	Investigations   CaseControlInvestigations   `json:"investigations"`
}

// --- CONTRACT reports (CAP-139..142) ---------------------------------------

// ContractAnalyticsReport is the contract analytics rollup over contracts.
//
//	Total                 CAP-139 total contract count.
//	AvgReviewDurationHours CAP-140 average review turnaround in working hours.
//	                       Primary source: contracts created_at -> status_changed_at
//	                       on reaching active; refined by duration_fact when present.
//	ByDepartment          CAP-141 grouped by department.
//	ByType                CAP-142 grouped by type.
type ContractAnalyticsReport struct {
	GeneratedAt            time.Time     `json:"generated_at"`
	Filters                ReportFilters `json:"filters"`
	Total                  int           `json:"total"`
	AvgReviewDurationHours float64       `json:"avg_review_duration_hours"`
	ReviewSampleSize       int           `json:"review_sample_size"`
	ByDepartment           []CountBucket `json:"by_department"`
	ByType                 []CountBucket `json:"by_type"`
	ByStatus               []CountBucket `json:"by_status"`

	// --- v2 additive fields (reports upgrade). Everything above is unchanged
	// so the payload stays backward-compatible; see reporting_contract.go for
	// the new shapes.
	//
	//	TotalValue            SUM(total_value) over the filtered scope (raw sum
	//	                      across currencies, no FX conversion).
	//	TotalValueByCurrency  the same sum split per currency code.
	//	SpendByType/Dept      per-type / per-department value rollups.
	//	ExpiryCliff           dense 24-month {month,count,value} expiry series.
	//	CycleTime             draft->active avg/p50/p90 days (nil only when the
	//	                      rollup could not be computed).
	TotalValue           float64                 `json:"total_value"`
	TotalValueByCurrency map[string]float64      `json:"total_value_by_currency"`
	SpendByType          []ValueBucket           `json:"spend_by_type"`
	SpendByDepartment    []ValueBucket           `json:"spend_by_department"`
	ExpiryCliff          []ExpiryCliffPoint      `json:"expiry_cliff"`
	CycleTime            *ContractCycleTimeStats `json:"cycle_time,omitempty"`
}

// --- CONSULTATION reports (CAP-143..145) -----------------------------------

// ConsultationReport is the consultation analytics rollup over
// legal_consultations.
//
//	Total                     CAP-143 total consultation count.
//	ByDepartment              CAP-144 grouped by department.
//	AvgCompletionTimeHours    CAP-145 average created_at -> responded_at in working
//	                          hours (only responded consultations contribute).
type ConsultationReport struct {
	GeneratedAt            time.Time     `json:"generated_at"`
	Filters                ReportFilters `json:"filters"`
	Total                  int           `json:"total"`
	ByDepartment           []CountBucket `json:"by_department"`
	ByType                 []CountBucket `json:"by_type"`
	ByStatus               []CountBucket `json:"by_status"`
	AvgCompletionTimeHours float64       `json:"avg_completion_time_hours"`
	CompletionSampleSize   int           `json:"completion_sample_size"`
}

// --- PERFORMANCE KPIs (CAP-146..150) ---------------------------------------

// PerformanceKPIs is the operational performance scorecard.
//
//	AvgRequestProcessingHours   CAP-146 average request processing time
//	                            (clock_started_at -> delivered_at) in working hours.
//	ClosedCaseRatio             CAP-147 closed cases / total cases (0..1).
//	ApprovedContractRatio       CAP-148 active(approved) contracts / total (0..1).
//	OverdueRequests             CAP-149 count of breached SLA clocks.
//	EstimatedDurationAdherence  CAP-150 on-time / resolved request-processing SLA outcomes (0..1).
type PerformanceKPIs struct {
	GeneratedAt                time.Time     `json:"generated_at"`
	Filters                    ReportFilters `json:"filters"`
	AvgRequestProcessingHours  float64       `json:"avg_request_processing_hours"`
	RequestProcessingSample    int           `json:"request_processing_sample"`
	ClosedCaseRatio            float64       `json:"closed_case_ratio"`
	TotalCases                 int           `json:"total_cases"`
	ClosedCases                int           `json:"closed_cases"`
	ApprovedContractRatio      float64       `json:"approved_contract_ratio"`
	TotalContracts             int           `json:"total_contracts"`
	ApprovedContracts          int           `json:"approved_contracts"`
	OverdueRequests            int           `json:"overdue_requests"`
	EstimatedDurationAdherence float64       `json:"estimated_duration_adherence"`
	ResolvedClocks             int           `json:"resolved_clocks"`
	OnTimeClocks               int           `json:"on_time_clocks"`
}

// --- FLAGSHIP: SLA compliance (CAP-151) ------------------------------------

// SLAComplianceTarget is the policy goal the flagship KPI is measured against.
const SLAComplianceTarget = 90.0

// QuarterSLACompliance is the SLA-compliance rate for one calendar quarter,
// computed from request-processing duration facts bucketed by quarter via the
// working calendar. Rate = completed-on-time / total received x 100.
type QuarterSLACompliance struct {
	// Quarter is the human label, e.g. "2026-Q2".
	Quarter string `json:"quarter"`
	// QuarterStart / QuarterEnd are the inclusive civil bounds of the quarter in
	// the working-calendar timezone (UTC date-normalized).
	QuarterStart time.Time `json:"quarter_start"`
	QuarterEnd   time.Time `json:"quarter_end"`
	Received     int       `json:"received"`
	OnTime       int       `json:"on_time"`
	Breached     int       `json:"breached"`
	Pending      int       `json:"pending"`
	// RatePct is on_time/received*100 (0 when received==0).
	RatePct     float64 `json:"rate_pct"`
	TargetPct   float64 `json:"target_pct"`
	MeetsTarget bool    `json:"meets_target"`
}

// SLAComplianceReport is the flagship quarterly SLA-compliance report.
type SLAComplianceReport struct {
	GeneratedAt time.Time              `json:"generated_at"`
	Filters     ReportFilters          `json:"filters"`
	TargetPct   float64                `json:"target_pct"`
	Quarters    []QuarterSLACompliance `json:"quarters"`
	// Overall is the aggregate rate across all returned quarters.
	OverallRatePct float64 `json:"overall_rate_pct"`
	OverallMeets   bool    `json:"overall_meets_target"`
}

// --- Consolidated legal-affairs dashboard ----------------------------------

// LegalAffairsDashboard is the single fan-out payload for the Phase-4
// /dashboard/legal-affairs endpoint. It composes the headline numbers from each
// sub-report so the UI renders the executive view in one round trip.
type LegalAffairsDashboard struct {
	GeneratedAt        time.Time                `json:"generated_at"`
	Cases              *CaseReport              `json:"cases"`
	Contracts          *ContractAnalyticsReport `json:"contracts"`
	Consultations      *ConsultationReport      `json:"consultations"`
	Performance        *PerformanceKPIs         `json:"performance"`
	SLACompliance      *SLAComplianceReport     `json:"sla_compliance"`
	CurrentQuarterRate float64                  `json:"current_quarter_rate_pct"`
}

// --- duration_fact (processing-time fact table, consumer-populated) --------

// DurationFactKind enumerates the supported processing-time fact subjects. Each
// kind measures elapsed working time between two lifecycle instants for one
// subject entity, so adherence/turnaround reports can read pre-computed durations
// without recomputing them from source-table timestamps every request.
type DurationFactKind string

const (
	DurationFactCaseResolution     DurationFactKind = "case_resolution"
	DurationFactContractReview     DurationFactKind = "contract_review"
	DurationFactConsultationAnswer DurationFactKind = "consultation_answer"
	DurationFactRequestProcessing  DurationFactKind = "request_processing"
)

// DurationFact is one upserted processing-time fact. It is keyed by
// (tenant_id, kind, subject_id) so a later lifecycle transition for the same
// subject refreshes the row in place (idempotent UpsertFromTransition).
type DurationFact struct {
	ID         uuid.UUID        `json:"id"`
	TenantID   uuid.UUID        `json:"tenant_id"`
	Kind       DurationFactKind `json:"kind"`
	SubjectID  uuid.UUID        `json:"subject_id"`
	Department *string          `json:"department,omitempty"`
	Category   *string          `json:"category,omitempty"`
	StartedAt  time.Time        `json:"started_at"`
	EndedAt    time.Time        `json:"ended_at"`
	// DurationMinutes is wall-clock minutes; WorkingMinutes is the working-calendar
	// measure (calendar.Calculator). Reports prefer WorkingMinutes.
	DurationMinutes int `json:"duration_minutes"`
	WorkingMinutes  int `json:"working_minutes"`
	// SLA fields are populated for request_processing facts and drive the
	// flagship quarterly compliance KPI. Other fact kinds leave them nil.
	SLATargetMinutes *int             `json:"sla_target_minutes,omitempty"`
	SLAOutcome       *SLAClockOutcome `json:"sla_outcome,omitempty"`
	OccurredAt       time.Time        `json:"occurred_at"`
	CreatedAt        time.Time        `json:"created_at"`
	UpdatedAt        time.Time        `json:"updated_at"`
}

// DurationFactAggregate is the per-kind/per-bucket average working duration read
// back from duration_fact for refinement of the source-table reports.
type DurationFactAggregate struct {
	Bucket            string  `json:"bucket"`
	SampleSize        int     `json:"sample_size"`
	AvgWorkingMinutes float64 `json:"avg_working_minutes"`
}

// DurationFactSLAOutcome is the minimal projection used to bucket
// request-processing fact outcomes into quarters for CAP-151.
type DurationFactSLAOutcome struct {
	StartedAt  time.Time       `json:"started_at"`
	SLAOutcome SLAClockOutcome `json:"sla_outcome"`
}

// ValidDurationFactKind reports whether k is a recognised fact kind.
func ValidDurationFactKind(k DurationFactKind) bool {
	switch k {
	case DurationFactCaseResolution, DurationFactContractReview,
		DurationFactConsultationAnswer, DurationFactRequestProcessing,
		DurationFactSettlementResolution:
		return true
	default:
		return false
	}
}
