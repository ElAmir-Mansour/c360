package migrate

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jung-kurt/gofpdf"

	"github.com/clario360/platform/internal/forms"
)

// evidence_report.go (Wave 6, P10b) produces a STRUCTURED, regulator-ready
// evidence report for a migration program. Unlike the flat 200-row audit dump
// ExportEvidence produces, this report is a sectioned document that reconstructs
// the whole migration control story: the program, its waves + move groups, each
// cutover run and its per-task outcomes, the go/no-go gate decisions + their
// recorded evidence, the rollback runs + their provenance, the workflow-backed
// approvals, and the connector invocations the runs drove. The machine-readable
// JSON form is the primary artifact; a sectioned PDF renders the same document
// (NOT a truncated table).

// EvidenceReport is the top-level structured document.
type EvidenceReport struct {
	GeneratedAt time.Time           `json:"generated_at"`
	Program     Program             `json:"program"`
	Summary     EvidenceSummary     `json:"summary"`
	Waves       []WaveEvidence      `json:"waves"`
	Approvals   []ApprovalEvidence  `json:"approvals"`
	Rollbacks   []RollbackEvidence  `json:"rollbacks"`
	Connectors  []ConnectorEvidence `json:"connector_invocations"`
}

// EvidenceSummary is the at-a-glance rollup a reviewer reads first.
type EvidenceSummary struct {
	WaveCount            int `json:"wave_count"`
	MoveGroupCount       int `json:"move_group_count"`
	WorkloadCount        int `json:"workload_count"`
	WindowCount          int `json:"window_count"`
	CutoverRunCount      int `json:"cutover_run_count"`
	RollbackRunCount     int `json:"rollback_run_count"`
	CompletedWaves       int `json:"completed_waves"`
	RolledBackWaves      int `json:"rolled_back_waves"`
	ApprovalCount        int `json:"approval_count"`
	ConnectorInvocations int `json:"connector_invocation_count"`
	GateChecksRecorded   int `json:"gate_checks_recorded"`
	GoDecisions          int `json:"go_decisions"`
	NoGoDecisions        int `json:"no_go_decisions"`
}

// WaveEvidence is one wave's slice of the report: its move groups (with
// workloads), its runbook binding provenance, and each cutover window's run +
// gate + task-outcome evidence.
type WaveEvidence struct {
	Wave       Wave             `json:"wave"`
	MoveGroups []MoveGroup      `json:"move_groups"`
	Runbook    *RunbookBinding  `json:"runbook_binding,omitempty"`
	Windows    []WindowEvidence `json:"windows"`
}

// WindowEvidence is one cutover window's evidence: the window (with its go/no-go
// decision), the go/no-go and readiness/validation gate checks with their
// recorded evidence, and the live cutover run's per-task outcomes.
type WindowEvidence struct {
	Window     CutoverWindow       `json:"window"`
	GateChecks []GateCheck         `json:"gate_checks"`
	CutoverRun *CutoverRunEvidence `json:"cutover_run,omitempty"`
}

// CutoverRunEvidence records a live cutover run's identity, terminal status, and
// per-task outcomes as reported by the DR engine (when reachable). The task
// outcomes are the REAL run-task completion states, not a canned string.
type CutoverRunEvidence struct {
	DRRunbookID uuid.UUID     `json:"dr_runbook_id"`
	DRRunID     *uuid.UUID    `json:"dr_run_id,omitempty"`
	Status      string        `json:"status"`
	Tasks       []TaskOutcome `json:"tasks,omitempty"`
}

// TaskOutcome is one runbook task's outcome in a run.
type TaskOutcome struct {
	TaskKey  string `json:"task_key"`
	Name     string `json:"name"`
	TaskType string `json:"task_type"`
	Required bool   `json:"required"`
	Status   string `json:"status"`
}

// ApprovalEvidence is one workflow-backed approval binding, projected to the
// fields a reviewer needs (who requested, who decided, the outcome).
type ApprovalEvidence struct {
	SubjectType          ApprovalSubjectType     `json:"subject_type"`
	SubjectID            uuid.UUID               `json:"subject_id"`
	WorkflowInstanceID   string                  `json:"workflow_instance_id"`
	WorkflowDefinitionID string                  `json:"workflow_definition_id"`
	Status               ApprovalBindingStatus   `json:"status"`
	Decision             ApprovalDecisionOutcome `json:"decision,omitempty"`
	Rationale            string                  `json:"rationale,omitempty"`
	RequestedBy          *uuid.UUID              `json:"requested_by,omitempty"`
	DecidedBy            *uuid.UUID              `json:"decided_by,omitempty"`
	DecidedAt            *time.Time              `json:"decided_at,omitempty"`
}

// RollbackEvidence is one executed rollback's provenance + outcome.
type RollbackEvidence struct {
	WindowID    uuid.UUID         `json:"window_id"`
	WaveID      uuid.UUID         `json:"wave_id"`
	DRRunbookID uuid.UUID         `json:"dr_runbook_id"`
	DRRunID     uuid.UUID         `json:"dr_run_id"`
	TriggeredBy uuid.UUID         `json:"triggered_by"`
	Reason      string            `json:"reason"`
	Status      RollbackRunStatus `json:"status"`
	CreatedAt   time.Time         `json:"created_at"`
}

// ConnectorEvidence is one connector invocation a cutover/rollback run drove (or
// a manual invocation), with its outcome — proof the integration actually ran.
type ConnectorEvidence struct {
	ConnectorID uuid.UUID                 `json:"connector_id"`
	WindowID    uuid.UUID                 `json:"window_id"`
	Action      string                    `json:"action"`
	Source      ConnectorInvocationSource `json:"source"`
	Status      string                    `json:"status"`
	HTTPStatus  int                       `json:"http_status,omitempty"`
	DRRunID     *uuid.UUID                `json:"dr_run_id,omitempty"`
	TaskKey     string                    `json:"task_key,omitempty"`
	Error       string                    `json:"error_message,omitempty"`
	CreatedAt   time.Time                 `json:"created_at"`
}

// EvidenceReport assembles the structured evidence report for a program. It reads
// the whole program aggregate in ONE tenant read transaction (waves + move groups
// + windows + gate checks + rollback runs + approvals + connector invocations),
// then hydrates each cutover/rollback run's live task outcomes from the DR engine
// when it is reachable (degrading gracefully to the persisted status when not).
func (s *Service) EvidenceReport(ctx context.Context, tenantID, programID uuid.UUID, actor Actor) (*EvidenceReport, error) {
	if !actor.Can(PermMigrateEvidenceExport) && !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}

	report := &EvidenceReport{GeneratedAt: s.now()}
	// runsToHydrate collects (window, binding) pairs whose live run task outcomes we
	// fetch from the DR engine AFTER the read tx (a network call must not run inside
	// the DB transaction).
	type pendingRun struct {
		windowIdx [2]int // [waveIdx, windowIdx]
		runID     uuid.UUID
	}
	var pending []pendingRun

	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		program, err := s.store.GetProgram(ctx, tx, tenantID, programID)
		if err != nil {
			return err
		}
		report.Program = *program

		waves, _, err := s.store.ListWaves(ctx, tx, tenantID, programID, 500, 0)
		if err != nil {
			return err
		}
		windows, _, err := s.store.ListWindows(ctx, tx, tenantID, programID, 500, 0)
		if err != nil {
			return err
		}
		windowsByWave := map[uuid.UUID][]CutoverWindow{}
		for _, wnd := range windows {
			windowsByWave[wnd.WaveID] = append(windowsByWave[wnd.WaveID], wnd)
		}

		summary := EvidenceSummary{WaveCount: len(waves), WindowCount: len(windows)}
		moveGroupSeen := map[uuid.UUID]struct{}{}

		for wi, wave := range waves {
			we := WaveEvidence{Wave: wave}

			groups, _, err := s.store.ListMoveGroupsForWave(ctx, tx, tenantID, wave.ID, 500, 0)
			if err != nil {
				return err
			}
			we.MoveGroups = groups
			for _, g := range groups {
				if _, ok := moveGroupSeen[g.ID]; !ok {
					moveGroupSeen[g.ID] = struct{}{}
					summary.MoveGroupCount++
					summary.WorkloadCount += len(g.Workloads)
				}
			}

			if parent, perr := s.store.GetParentBindingForWave(ctx, tx, tenantID, wave.ID); perr == nil {
				we.Runbook = parent
			} else if !errors.Is(perr, ErrNotFound) {
				return perr
			}

			switch wave.Status {
			case WaveCompleted:
				summary.CompletedWaves++
			case WaveRolledBack:
				summary.RolledBackWaves++
			}

			for _, wnd := range windowsByWave[wave.ID] {
				wnde := WindowEvidence{Window: wnd}
				checks, err := s.store.ListGateChecks(ctx, tx, tenantID, wnd.ID, nil)
				if err != nil {
					return err
				}
				wnde.GateChecks = checks
				summary.GateChecksRecorded += len(checks)
				switch wnd.Decision {
				case DecisionGo:
					summary.GoDecisions++
				case DecisionNoGo:
					summary.NoGoDecisions++
				}
				if wnd.DRRunbookID != nil {
					wnde.CutoverRun = &CutoverRunEvidence{DRRunbookID: *wnd.DRRunbookID, DRRunID: wnd.DRRunID}
					if wnd.DRRunID != nil {
						summary.CutoverRunCount++
						pending = append(pending, pendingRun{
							windowIdx: [2]int{wi, len(we.Windows)},
							runID:     *wnd.DRRunID,
						})
					}
				}
				we.Windows = append(we.Windows, wnde)
			}
			report.Waves = append(report.Waves, we)
		}

		// Approvals (workflow-backed) for the program.
		bindings, err := s.store.ListApprovalBindingsForProgram(ctx, tx, tenantID, programID)
		if err != nil {
			return err
		}
		for _, b := range bindings {
			report.Approvals = append(report.Approvals, ApprovalEvidence{
				SubjectType:          b.SubjectType,
				SubjectID:            b.SubjectID,
				WorkflowInstanceID:   b.WorkflowInstanceID,
				WorkflowDefinitionID: b.WorkflowDefinitionID,
				Status:               b.Status,
				Decision:             b.Decision,
				Rationale:            b.Rationale,
				RequestedBy:          b.RequestedBy,
				DecidedBy:            b.DecidedBy,
				DecidedAt:            b.DecidedAt,
			})
		}
		summary.ApprovalCount = len(report.Approvals)

		// Rollback runs (provenance) for the program.
		rollbacks, err := s.store.ListRollbackRunsForProgram(ctx, tx, tenantID, programID)
		if err != nil {
			return err
		}
		for _, r := range rollbacks {
			report.Rollbacks = append(report.Rollbacks, RollbackEvidence{
				WindowID:    r.WindowID,
				WaveID:      r.WaveID,
				DRRunbookID: r.DRRunbookID,
				DRRunID:     r.DRRunID,
				TriggeredBy: r.TriggeredBy,
				Reason:      r.Reason,
				Status:      r.Status,
				CreatedAt:   r.CreatedAt,
			})
		}
		summary.RollbackRunCount = len(report.Rollbacks)

		// Connector invocations (per window, deduped into one program-wide list).
		for _, wnd := range windows {
			invs, err := s.store.ListInvocationsForWindow(ctx, tx, tenantID, wnd.ID)
			if err != nil {
				return err
			}
			for _, inv := range invs {
				report.Connectors = append(report.Connectors, ConnectorEvidence{
					ConnectorID: inv.ConnectorID,
					WindowID:    inv.WindowID,
					Action:      inv.Action,
					Source:      inv.Source,
					Status:      inv.Status,
					HTTPStatus:  inv.HTTPStatus,
					DRRunID:     inv.DRRunID,
					TaskKey:     inv.TaskKey,
					Error:       inv.ErrorMessage,
					CreatedAt:   inv.CreatedAt,
				})
			}
		}
		summary.ConnectorInvocations = len(report.Connectors)
		report.Summary = summary
		return nil
	})
	if err != nil {
		return nil, err
	}

	// Hydrate each cutover run's per-task outcomes from the DR engine. A network
	// error / unreachable engine degrades to the persisted status already recorded
	// on the CutoverRunEvidence — the report is still complete from migrate's own
	// database.
	if s.dr != nil {
		for _, p := range pending {
			live, lerr := s.dr.GetRun(ctx, tenantID, p.runID)
			if lerr != nil {
				continue // degrade: persisted run identity already recorded
			}
			cr := report.Waves[p.windowIdx[0]].Windows[p.windowIdx[1]].CutoverRun
			if cr == nil {
				continue
			}
			cr.Status = live.Status
			statusByTask := map[string]string{}
			for _, tr := range live.TaskRuns {
				statusByTask[tr.TaskID] = tr.Status
			}
			for _, t := range live.Tasks {
				cr.Tasks = append(cr.Tasks, TaskOutcome{
					TaskKey:  t.TaskKey,
					Name:     t.Name,
					TaskType: t.TaskType,
					Required: t.Required,
					Status:   statusByTask[t.ID.String()],
				})
			}
		}
	}
	return report, nil
}

// Report localization notes
// ==========================
//
// Report string LITERALS for BOTH migrate evidence generators (this structured
// report and the flat buildPDFExport in evidence.go) are routed through
// migrateReportLabels — a per-report label table keyed by a stable slug and
// resolved by the report's locale. Format strings (with %d / %s placeholders) are
// stored bilingually so whole summary/header sentences localize cleanly.
// buildStructuredPDFReportLocalized / buildPDFExportLocalized are the locale-aware
// entrypoints; the legacy no-locale functions keep their signatures (English) so
// existing callers (router.go) stay unchanged.
//
// gofpdf LIMITATION (do not "fix" here): the vendored gofpdf ships only the core
// Latin PDF fonts and performs NO Arabic glyph shaping or bidi reordering, so the
// Arabic strings render with missing glyphs. The locale threading + right-alignment
// ('R') here is the SAFE, compiling scaffolding only. For a shaped, customer-/
// regulator-facing Arabic PDF, render the report as HTML (dir="rtl", reusing the
// notification email RTL CSS) and convert with headless Chrome / wkhtmltopdf — see
// internal/recover RenderEvidenceHTML for the reference "HTML half". gofpdf stays
// for internal/English artifacts.

const (
	localeEN = "en"
	localeAR = "ar"
)

// reportLocaleDefault is the tenant/product default locale for customer-/regulator-
// facing reports (Watheeq / KSA tenants default to Arabic). Applied when a caller
// passes an empty locale. The legacy wrappers pass localeEN explicitly so their
// output never regresses while the gofpdf Arabic-shaping gap is open.
const reportLocaleDefault = localeAR

// normalizeReportLocale collapses an arbitrary locale tag to the two supported
// report locales, defaulting to the tenant/product default when unset.
func normalizeReportLocale(locale string) string {
	switch locale {
	case localeAR:
		return localeAR
	case localeEN:
		return localeEN
	case "":
		return reportLocaleDefault
	default:
		if len(locale) >= 2 && locale[:2] == "ar" {
			return localeAR
		}
		return localeEN
	}
}

// alignFor returns the gofpdf cell/multicell alignment for a locale ("R" right-
// aligns Arabic text, "L" left-aligns Latin).
func alignFor(locale string) string {
	if locale == localeAR {
		return "R"
	}
	return "L"
}

// localizeLabel resolves a report label slug to text in the requested locale via
// forms.LocalizedText (the canonical backend bilingual string type, with built-in
// other-locale fallback). An unknown slug falls back to the slug itself. Slugs
// whose value is a format string are consumed with fmt.Sprintf by the caller.
func localizeLabel(cat map[string]forms.LocalizedText, key, locale string) string {
	if lt, ok := cat[key]; ok {
		return lt.Localize(locale)
	}
	return key
}

// migrateReportLabels is the per-report label table for the migrate evidence
// documents. Arabic copy follows the Saudi-MSA termbase: runbook = دليل التشغيل,
// approval (sign-off) = اعتماد, workflow = سير العمل, status = الحالة, cutover =
// التحويل النهائي. migrate-domain coinages (wave = موجة, move group = مجموعة النقل,
// connector = موصّل) are glossed consistently. Product names, IDs and enum tokens
// stay verbatim.
var migrateReportLabels = map[string]forms.LocalizedText{
	// Structured report.
	"struct_title":    {EN: "Clario Migrate Evidence Report", AR: "Clario Migrate — تقرير الأدلة"},
	"program_line":    {EN: "Program: %s — %s", AR: "البرنامج: %s — %s"},
	"owner_line":      {EN: "Owner: %s", AR: "المسؤول: %s"},
	"status_line":     {EN: "Status: %s", AR: "الحالة: %s"},
	"generated_line":  {EN: "Generated: %s", AR: "أُنشئ في: %s"},
	"summary":         {EN: "Summary", AR: "الملخص"},
	"summary_waves":   {EN: "Waves: %d (completed %d, rolled back %d)", AR: "الموجات: %d (مكتملة %d، متراجَع عنها %d)"},
	"summary_groups":  {EN: "Move groups: %d, Workloads: %d, Windows: %d", AR: "مجموعات النقل: %d، أعباء العمل: %d، النوافذ: %d"},
	"summary_runs":    {EN: "Cutover runs: %d, Rollback runs: %d", AR: "عمليات التحويل: %d، عمليات التراجع: %d"},
	"summary_gates":   {EN: "Go/No-Go decisions: %d go, %d no-go; Gate checks recorded: %d", AR: "قرارات المضي/عدم المضي: %d مضي، %d عدم مضي؛ فحوص البوابة المسجَّلة: %d"},
	"summary_approv":  {EN: "Workflow approvals: %d, Connector invocations: %d", AR: "اعتمادات سير العمل: %d، استدعاءات الموصّلات: %d"},
	"wave_heading":    {EN: "Wave %s — %s [%s]", AR: "الموجة %s — %s [%s]"},
	"runbook_binding": {EN: "Runbook binding: %s (dr_runbook_id %s, status %s)", AR: "ربط دليل التشغيل: %s (dr_runbook_id %s، الحالة %s)"},
	"move_groups":     {EN: "Move groups", AR: "مجموعات النقل"},
	"move_group_line": {EN: "  - %s %s [%s] (%d workload(s))", AR: "  - %s %s [%s] (%d عبء عمل)"},
	"window_heading":  {EN: "Window %s — %s", AR: "النافذة %s — %s"},
	"gonogo_line":     {EN: "  Go/No-Go decision: %s%s", AR: "  قرار المضي/عدم المضي: %s%s"},
	"gate_line":       {EN: "  Gate [%s] %s: %s%s", AR: "  البوابة [%s] %s: %s%s"},
	"cutover_line":    {EN: "  Cutover run: dr_run_id %s, status %s", AR: "  عملية التحويل: dr_run_id %s، الحالة %s"},
	"task_line":       {EN: "    task %s [%s] required=%v -> %s", AR: "    المهمة %s [%s] مطلوبة=%v -> %s"},
	"approvals":       {EN: "Workflow Approvals", AR: "اعتمادات سير العمل"},
	"approval_line":   {EN: "- %s %s: %s (decision %s) instance %s", AR: "- %s %s: %s (القرار %s) المثيل %s"},
	"rollbacks":       {EN: "Rollback Runs", AR: "عمليات التراجع"},
	"rollback_line":   {EN: "- window %s wave %s: %s — reason: %s (triggered_by %s, dr_run_id %s)", AR: "- النافذة %s الموجة %s: %s — السبب: %s (triggered_by %s، dr_run_id %s)"},
	"connectors":      {EN: "Connector Invocations", AR: "استدعاءات الموصّلات"},
	"connector_line":  {EN: "- connector %s action %s [%s]: %s%s", AR: "- الموصّل %s الإجراء %s [%s]: %s%s"},
	"connector_http":  {EN: "%s (HTTP %d)", AR: "%s (HTTP %d)"},
	// Flat export (evidence.go buildPDFExport).
	"flat_title":     {EN: "Clario Migrate Evidence", AR: "Clario Migrate — الأدلة"},
	"flat_program":   {EN: "Program: %s · %s", AR: "البرنامج: %s · %s"},
	"flat_generated": {EN: "Generated: %s", AR: "أُنشئ في: %s"},
	"col_occurred":   {EN: "Occurred", AR: "وقت الحدوث"},
	"col_action":     {EN: "Action", AR: "الإجراء"},
	"col_subject":    {EN: "Subject", AR: "الموضوع"},
	"col_summary":    {EN: "Summary", AR: "الملخص"},
	"rows_omitted":   {EN: "Additional rows omitted from PDF: %s", AR: "صفوف إضافية محذوفة من ملف PDF: %s"},
}

// buildStructuredPDFReport renders the structured evidence report as a SECTIONED
// PDF. It preserves the legacy (English) signature; buildStructuredPDFReportLocalized
// is the locale-aware entrypoint.
func buildStructuredPDFReport(report *EvidenceReport) (*EvidenceExport, error) {
	return buildStructuredPDFReportLocalized(report, localeEN)
}

// buildStructuredPDFReportLocalized renders the structured evidence report as a
// SECTIONED PDF (program header, summary, then a section per wave with its windows /
// gate decisions / cutover-run task outcomes, then approvals / rollbacks / connector
// invocations) in the requested locale, resolving labels through migrateReportLabels
// and aligning text for the locale. It is NOT the truncated 120-row table the flat
// export produced — every section is fully written, paginating naturally. See the
// gofpdf/HTML->PDF notes above for the Arabic-shaping caveat.
func buildStructuredPDFReportLocalized(report *EvidenceReport, locale string) (*EvidenceExport, error) {
	locale = normalizeReportLocale(locale)
	align := alignFor(locale)
	lbl := func(key string) string { return localizeLabel(migrateReportLabels, key, locale) }

	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetTitle(lbl("struct_title"), false)
	pdf.SetAuthor("Clario360", false)
	pdf.SetAutoPageBreak(true, 15)
	pdf.AddPage()

	heading := func(text string) {
		pdf.Ln(3)
		pdf.SetFont("Helvetica", "B", 12)
		pdf.MultiCell(0, 6, text, "", align, false)
		pdf.SetFont("Helvetica", "", 9)
	}
	sub := func(text string) {
		pdf.SetFont("Helvetica", "B", 10)
		pdf.MultiCell(0, 5, text, "", align, false)
		pdf.SetFont("Helvetica", "", 9)
	}
	line := func(text string) {
		pdf.MultiCell(0, 5, text, "", align, false)
	}

	pdf.SetFont("Helvetica", "B", 16)
	pdf.MultiCell(0, 9, lbl("struct_title"), "", align, false)
	pdf.SetFont("Helvetica", "", 9)
	line(fmt.Sprintf(lbl("program_line"), report.Program.Reference, report.Program.Name))
	line(fmt.Sprintf(lbl("owner_line"), report.Program.Owner))
	line(fmt.Sprintf(lbl("status_line"), string(report.Program.Status)))
	line(fmt.Sprintf(lbl("generated_line"), report.GeneratedAt.Format(time.RFC3339)))

	heading(lbl("summary"))
	s := report.Summary
	line(fmt.Sprintf(lbl("summary_waves"), s.WaveCount, s.CompletedWaves, s.RolledBackWaves))
	line(fmt.Sprintf(lbl("summary_groups"), s.MoveGroupCount, s.WorkloadCount, s.WindowCount))
	line(fmt.Sprintf(lbl("summary_runs"), s.CutoverRunCount, s.RollbackRunCount))
	line(fmt.Sprintf(lbl("summary_gates"), s.GoDecisions, s.NoGoDecisions, s.GateChecksRecorded))
	line(fmt.Sprintf(lbl("summary_approv"), s.ApprovalCount, s.ConnectorInvocations))

	for _, we := range report.Waves {
		heading(fmt.Sprintf(lbl("wave_heading"), we.Wave.Reference, we.Wave.Name, we.Wave.Status))
		if we.Runbook != nil {
			line(fmt.Sprintf(lbl("runbook_binding"), we.Runbook.Role, we.Runbook.DRRunbookID, we.Runbook.Status))
		}
		if len(we.MoveGroups) > 0 {
			sub(lbl("move_groups"))
			for _, g := range we.MoveGroups {
				line(fmt.Sprintf(lbl("move_group_line"), g.Reference, g.Name, g.Status, len(g.Workloads)))
			}
		}
		for _, wnde := range we.Windows {
			sub(fmt.Sprintf(lbl("window_heading"), wnde.Window.Reference, wnde.Window.Name))
			line(fmt.Sprintf(lbl("gonogo_line"), decisionLabel(wnde.Window.Decision), rationaleSuffix(wnde.Window.Rationale)))
			for _, c := range wnde.GateChecks {
				line(fmt.Sprintf(lbl("gate_line"), c.Kind, c.Name, c.Status, evidenceSuffix(c.Evidence)))
			}
			if wnde.CutoverRun != nil {
				line(fmt.Sprintf(lbl("cutover_line"), runIDLabel(wnde.CutoverRun.DRRunID), wnde.CutoverRun.Status))
				for _, t := range wnde.CutoverRun.Tasks {
					line(fmt.Sprintf(lbl("task_line"), t.TaskKey, t.TaskType, t.Required, t.Status))
				}
			}
		}
	}

	if len(report.Approvals) > 0 {
		heading(lbl("approvals"))
		for _, a := range report.Approvals {
			line(fmt.Sprintf(lbl("approval_line"), a.SubjectType, a.SubjectID, a.Status, decisionOrPending(a.Decision), a.WorkflowInstanceID))
		}
	}

	if len(report.Rollbacks) > 0 {
		heading(lbl("rollbacks"))
		for _, r := range report.Rollbacks {
			line(fmt.Sprintf(lbl("rollback_line"), r.WindowID, r.WaveID, r.Status, r.Reason, r.TriggeredBy, r.DRRunID))
		}
	}

	if len(report.Connectors) > 0 {
		heading(lbl("connectors"))
		for _, c := range report.Connectors {
			outcome := c.Status
			if c.HTTPStatus > 0 {
				outcome = fmt.Sprintf(lbl("connector_http"), c.Status, c.HTTPStatus)
			}
			line(fmt.Sprintf(lbl("connector_line"), c.ConnectorID, c.Action, c.Source, outcome, errorSuffix(c.Error)))
		}
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return &EvidenceExport{
		Filename:    fmt.Sprintf("%s-migration-evidence-report.pdf", report.Program.Reference),
		ContentType: "application/pdf",
		Body:        buf.Bytes(),
		SizeBytes:   buf.Len(),
	}, nil
}

func decisionLabel(d Decision) string {
	if d == "" {
		return "pending"
	}
	return string(d)
}

func decisionOrPending(d ApprovalDecisionOutcome) string {
	if d == "" {
		return "pending"
	}
	return string(d)
}

func runIDLabel(id *uuid.UUID) string {
	if id == nil {
		return "-"
	}
	return id.String()
}

func rationaleSuffix(s string) string {
	if s == "" {
		return ""
	}
	return " — rationale: " + s
}

func evidenceSuffix(s string) string {
	if s == "" {
		return ""
	}
	return " (evidence: " + s + ")"
}

func errorSuffix(s string) string {
	if s == "" {
		return ""
	}
	return " — error: " + s
}
