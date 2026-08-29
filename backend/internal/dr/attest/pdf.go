package attest

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/clario360/platform/internal/dr/model"
)

const (
	pdfLineWidth    = 92
	pdfLinesPerPage = 48
)

// ReportFormats contains the machine-readable JSON and human-readable PDF
// exports for the same attestation payload.
type ReportFormats struct {
	JSON []byte
	PDF  []byte
}

// ReportBundle is the WORM-sealed object stored at attestation.report_object_key.
// It preserves the historical report shape (content_hash + payload at top
// level) while attaching the PDF export under exports.
type ReportBundle struct {
	ContentHash string        `json:"content_hash"`
	Payload     ReportPayload `json:"payload"`
	Exports     ReportExports `json:"exports"`
}

// ReportExports describes the rendered artifacts embedded in the sealed bundle.
type ReportExports struct {
	JSONMediaType string `json:"json_media_type"`
	PDFMediaType  string `json:"pdf_media_type"`
	PDFSHA256     string `json:"pdf_sha256"`
	PDFBase64     string `json:"pdf_base64"`
}

// BuildReportFormats assembles one attestation and renders both canonical JSON
// and an NCA-ready PDF export. The content hash remains the hash of Payload, so
// both formats are anchored to the same tamper-evident value.
func (b *Builder) BuildReportFormats(ctx context.Context, run *model.FailoverRun) (*Report, ReportFormats, error) {
	report, renderedJSON, err := b.BuildReport(ctx, run)
	if err != nil {
		return nil, ReportFormats{}, err
	}
	renderedPDF, err := RenderPDF(report)
	if err != nil {
		return nil, ReportFormats{}, err
	}
	return report, ReportFormats{JSON: renderedJSON, PDF: renderedPDF}, nil
}

// RenderBundle renders the WORM-sealed attestation object. The object remains a
// valid Report JSON document for older readers while embedding the PDF export
// with a hash for independent verification.
func RenderBundle(report *Report, formats ReportFormats) ([]byte, error) {
	if report == nil {
		return nil, errors.New("attest: report is required")
	}
	if len(formats.JSON) == 0 {
		renderedJSON, err := RenderJSON(report)
		if err != nil {
			return nil, err
		}
		formats.JSON = renderedJSON
	}
	if len(formats.PDF) == 0 {
		renderedPDF, err := RenderPDF(report)
		if err != nil {
			return nil, err
		}
		formats.PDF = renderedPDF
	}
	pdfHash := sha256.Sum256(formats.PDF)
	bundle := ReportBundle{
		ContentHash: report.ContentHash,
		Payload:     report.Payload,
		Exports: ReportExports{
			JSONMediaType: "application/json",
			PDFMediaType:  "application/pdf",
			PDFSHA256:     hex.EncodeToString(pdfHash[:]),
			PDFBase64:     base64.StdEncoding.EncodeToString(formats.PDF),
		},
	}
	rendered, err := json.Marshal(bundle)
	if err != nil {
		return nil, fmt.Errorf("attest: marshal report bundle: %w", err)
	}
	return rendered, nil
}

// RenderPDF renders the attestation as a compact, deterministic PDF document.
func RenderPDF(report *Report) ([]byte, error) {
	if report == nil {
		return nil, errors.New("attest: report is required")
	}
	lines := pdfLines(report)
	return makePDF(lines), nil
}

func pdfLines(report *Report) []string {
	payload := report.Payload
	lines := []string{
		"NCA Disaster Recovery Attestation",
		"Report kind: " + payload.ReportKind,
		"Schema version: " + payload.SchemaVersion,
		"Content hash: " + report.ContentHash,
		"Generated at: " + pdfTime(payload.GeneratedAt),
		"",
		"Tenant and run",
		"Tenant ID: " + payload.TenantID,
		"Run ID: " + payload.Run.ID,
		"Consistency group ID: " + payload.Run.GroupID,
		"Mode: " + payload.Run.Mode,
		"Status: " + payload.Run.Status,
		"Initiated by: " + payload.Approvals.InitiatedBy,
		"Initiated at: " + pdfTime(payload.Approvals.InitiatedAt),
		"Approved by: " + pdfString(payload.Approvals.ApprovedBy),
		"Approved at: " + pdfTimePtr(payload.Approvals.ApprovedAt),
		"",
		"RTO objective vs actual",
		fmt.Sprintf("Objective seconds: %d", payload.RTO.ObjectiveSeconds),
		fmt.Sprintf("Actual seconds: %d", payload.RTO.ActualSeconds),
		"Completed at: " + pdfTime(payload.RTO.CompletedAt),
		"",
		"RPO and validation",
		fmt.Sprintf("Achieved RPO seconds: %d", payload.RPO.Seconds),
		fmt.Sprintf("Validation ratio: %.4f", payload.Validation.Ratio),
		fmt.Sprintf("Validation passed: %t", payload.Validation.Passed),
		"",
		"Recovery point",
		"Recovery point ID: " + payload.RecoveryPoint.ID,
		"Marker LSN: " + payload.RecoveryPoint.MarkerLSN,
		"Recovery point content hash: " + payload.RecoveryPoint.ContentHash,
		"Sealed at: " + pdfTime(payload.RecoveryPoint.SealedAt),
	}
	if payload.PreviousContentHash != "" {
		lines = append(lines, "Previous attestation hash: "+payload.PreviousContentHash)
	}

	keys := make([]string, 0, len(payload.RecoveryPoint.ObjectKeys))
	for streamID := range payload.RecoveryPoint.ObjectKeys {
		keys = append(keys, streamID)
	}
	sort.Strings(keys)
	if len(keys) > 0 {
		lines = append(lines, "", "Sealed object keys")
		for _, streamID := range keys {
			appendWrapped(&lines, streamID+": "+payload.RecoveryPoint.ObjectKeys[streamID])
		}
	}

	if len(payload.Timeline) > 0 {
		lines = append(lines, "", "Failover timeline")
		for _, step := range payload.Timeline {
			line := fmt.Sprintf("%s | %s | start %s | finish %s",
				step.Step, step.Status, pdfTime(step.StartedAt), pdfTimePtr(step.FinishedAt))
			appendWrapped(&lines, line)
		}
	}
	return lines
}

func appendWrapped(lines *[]string, line string) {
	for _, part := range wrapPDFLine(line, pdfLineWidth) {
		*lines = append(*lines, part)
	}
}

func wrapPDFLine(line string, width int) []string {
	line = strings.TrimSpace(line)
	if line == "" || len(line) <= width {
		return []string{line}
	}
	words := strings.Fields(line)
	var out []string
	current := ""
	flush := func() {
		if current != "" {
			out = append(out, current)
			current = ""
		}
	}
	for _, word := range words {
		for len(word) > width {
			flush()
			out = append(out, word[:width])
			word = word[width:]
		}
		if current == "" {
			current = word
			continue
		}
		if len(current)+1+len(word) > width {
			flush()
			current = word
			continue
		}
		current += " " + word
	}
	flush()
	return out
}

func pdfTime(t time.Time) string {
	if t.IsZero() {
		return "n/a"
	}
	return t.UTC().Format(time.RFC3339)
}

func pdfTimePtr(t *time.Time) string {
	if t == nil {
		return "n/a"
	}
	return pdfTime(*t)
}

func pdfString(s *string) string {
	if s == nil || strings.TrimSpace(*s) == "" {
		return "n/a"
	}
	return strings.TrimSpace(*s)
}

func makePDF(lines []string) []byte {
	if len(lines) == 0 {
		lines = []string{""}
	}
	pages := chunkLines(lines, pdfLinesPerPage)
	fontID := 3

	var kids strings.Builder
	for i := range pages {
		if i > 0 {
			kids.WriteByte(' ')
		}
		fmt.Fprintf(&kids, "%d 0 R", pageObjectID(i))
	}

	objects := map[int]string{
		1: fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", 2),
		2: fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", kids.String(), len(pages)),
		3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	for i, page := range pages {
		pageID := pageObjectID(i)
		contentID := contentObjectID(i)
		content := pageContent(page)
		objects[pageID] = fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>", fontID, contentID)
		objects[contentID] = fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content)
	}

	maxObjectID := contentObjectID(len(pages) - 1)
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n%Clario360\n")
	offsets := make([]int, maxObjectID+1)
	for id := 1; id <= maxObjectID; id++ {
		offsets[id] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", id, objects[id])
	}
	xrefStart := buf.Len()
	fmt.Fprintf(&buf, "xref\n0 %d\n", maxObjectID+1)
	buf.WriteString("0000000000 65535 f \n")
	for id := 1; id <= maxObjectID; id++ {
		fmt.Fprintf(&buf, "%010d 00000 n \n", offsets[id])
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", maxObjectID+1, xrefStart)
	return buf.Bytes()
}

func pageObjectID(page int) int {
	return 4 + page*2
}

func contentObjectID(page int) int {
	return pageObjectID(page) + 1
}

func chunkLines(lines []string, size int) [][]string {
	var chunks [][]string
	for len(lines) > 0 {
		n := size
		if len(lines) < n {
			n = len(lines)
		}
		chunks = append(chunks, lines[:n])
		lines = lines[n:]
	}
	return chunks
}

func pageContent(lines []string) string {
	var content strings.Builder
	content.WriteString("BT\n/F1 10 Tf\n50 760 Td\n14 TL\n")
	for i, line := range lines {
		if i > 0 {
			content.WriteString("T*\n")
		}
		content.WriteByte('(')
		content.WriteString(escapePDFText(line))
		content.WriteString(") Tj\n")
	}
	content.WriteString("ET\n")
	return content.String()
}

func escapePDFText(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch r {
		case '\\', '(', ')':
			b.WriteByte('\\')
			b.WriteRune(r)
		case '\t', '\n', '\r':
			b.WriteByte(' ')
		default:
			if r < 32 || r > 126 {
				b.WriteByte('?')
			} else {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}
