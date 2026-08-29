package migrate

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jung-kurt/gofpdf"
)

type EvidenceExport struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	Body        []byte `json:"-"`
	SizeBytes   int    `json:"size_bytes"`
}

// ExportEvidence preserves the legacy (English) signature so existing callers stay
// unchanged; ExportEvidenceLocalized is the locale-aware entrypoint.
func (s *Service) ExportEvidence(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, format string) (*EvidenceExport, error) {
	return s.ExportEvidenceLocalized(ctx, tenantID, programID, actor, format, localeEN)
}

// ExportEvidenceLocalized exports the flat audit-trail evidence for a program in the
// requested locale. The CSV form is a machine-readable data export and keeps stable
// English column keys; the PDF form is localized (labels + alignment) via
// buildPDFExportLocalized. An empty locale resolves to the tenant/product default
// (Arabic). See the gofpdf/HTML->PDF notes in evidence_report.go for the Arabic
// glyph-shaping caveat on the gofpdf path.
func (s *Service) ExportEvidenceLocalized(ctx context.Context, tenantID, programID uuid.UUID, actor Actor, format, locale string) (*EvidenceExport, error) {
	if !actor.Can(PermMigrateEvidenceExport) && !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var program *Program
	var events []AuditEvent
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		program, err = s.store.GetProgram(ctx, tx, tenantID, programID)
		if err != nil {
			return err
		}
		events, err = s.store.RecentAudit(ctx, tx, tenantID, programID, 200)
		return err
	})
	if err != nil {
		return nil, err
	}
	switch format {
	case "csv":
		return buildCSVExport(*program, events)
	case "pdf":
		return buildPDFExportLocalized(*program, events, locale)
	default:
		return nil, fmt.Errorf("format must be csv or pdf: %w", ErrValidation)
	}
}

func buildCSVExport(program Program, events []AuditEvent) (*EvidenceExport, error) {
	buf := &bytes.Buffer{}
	w := csv.NewWriter(buf)
	if err := w.Write([]string{"program_reference", "program_name", "occurred_at", "action", "subject_type", "subject_id", "actor_id", "summary", "detail_json"}); err != nil {
		return nil, err
	}
	for _, ev := range events {
		detail, _ := json.Marshal(ev.Detail)
		subject := ""
		if ev.SubjectID != nil {
			subject = ev.SubjectID.String()
		}
		actor := ""
		if ev.ActorID != nil {
			actor = ev.ActorID.String()
		}
		if err := w.Write([]string{
			program.Reference,
			program.Name,
			ev.OccurredAt.Format(time.RFC3339),
			ev.Action,
			ev.SubjectType,
			subject,
			actor,
			ev.Summary,
			string(detail),
		}); err != nil {
			return nil, err
		}
	}
	w.Flush()
	if err := w.Error(); err != nil {
		return nil, err
	}
	return &EvidenceExport{
		Filename:    fmt.Sprintf("%s-migration-evidence.csv", program.Reference),
		ContentType: "text/csv",
		Body:        buf.Bytes(),
		SizeBytes:   buf.Len(),
	}, nil
}

// buildPDFExport preserves the legacy (English) signature; buildPDFExportLocalized
// is the locale-aware entrypoint.
func buildPDFExport(program Program, events []AuditEvent) (*EvidenceExport, error) {
	return buildPDFExportLocalized(program, events, localeEN)
}

// buildPDFExportLocalized renders the flat audit-trail PDF in the requested locale,
// resolving column headers / labels through migrateReportLabels and aligning cells
// for the locale. See the gofpdf/HTML->PDF notes in evidence_report.go: Arabic here
// is scaffolding — a shaped Arabic PDF needs the HTML->PDF path.
func buildPDFExportLocalized(program Program, events []AuditEvent, locale string) (*EvidenceExport, error) {
	locale = normalizeReportLocale(locale)
	align := alignFor(locale)
	lbl := func(key string) string { return localizeLabel(migrateReportLabels, key, locale) }

	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetTitle(lbl("flat_title"), false)
	pdf.SetAuthor("Clario360", false)
	pdf.AddPage()
	pdf.SetFont("Helvetica", "B", 16)
	pdf.CellFormat(0, 10, lbl("flat_title"), "", 1, align, false, 0, "")
	pdf.Ln(2)
	pdf.SetFont("Helvetica", "", 10)
	pdf.CellFormat(0, 6, fmt.Sprintf(lbl("flat_program"), program.Reference, program.Name), "", 1, align, false, 0, "")
	pdf.CellFormat(0, 6, fmt.Sprintf(lbl("flat_generated"), time.Now().UTC().Format(time.RFC3339)), "", 1, align, false, 0, "")
	pdf.Ln(4)
	pdf.SetFont("Helvetica", "B", 10)
	pdf.CellFormat(44, 7, lbl("col_occurred"), "1", 0, align, false, 0, "")
	pdf.CellFormat(45, 7, lbl("col_action"), "1", 0, align, false, 0, "")
	pdf.CellFormat(35, 7, lbl("col_subject"), "1", 0, align, false, 0, "")
	pdf.CellFormat(66, 7, lbl("col_summary"), "1", 1, align, false, 0, "")
	pdf.SetFont("Helvetica", "", 8)
	for i, ev := range events {
		if i > 120 {
			pdf.CellFormat(0, 6, fmt.Sprintf(lbl("rows_omitted"), strconv.Itoa(len(events)-i)), "", 1, align, false, 0, "")
			break
		}
		subject := ev.SubjectType
		if ev.SubjectID != nil {
			subject += " " + ev.SubjectID.String()[:8]
		}
		pdf.CellFormat(44, 6, ev.OccurredAt.Format("2006-01-02 15:04"), "1", 0, align, false, 0, "")
		pdf.CellFormat(45, 6, ev.Action, "1", 0, align, false, 0, "")
		pdf.CellFormat(35, 6, subject, "1", 0, align, false, 0, "")
		pdf.CellFormat(66, 6, ev.Summary, "1", 1, align, false, 0, "")
	}
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return &EvidenceExport{
		Filename:    fmt.Sprintf("%s-migration-evidence.pdf", program.Reference),
		ContentType: "application/pdf",
		Body:        buf.Bytes(),
		SizeBytes:   buf.Len(),
	}, nil
}
