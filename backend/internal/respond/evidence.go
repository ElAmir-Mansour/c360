package respond

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

const EventEvidenceExported = "respond.evidence.exported"

type EvidenceFormat string

const (
	EvidenceFormatCSV EvidenceFormat = "csv"
	EvidenceFormatPDF EvidenceFormat = "pdf"
)

func (f EvidenceFormat) valid() bool {
	switch f {
	case EvidenceFormatCSV, EvidenceFormatPDF:
		return true
	default:
		return false
	}
}

type EvidenceExportInput struct {
	IncidentID uuid.UUID
	Format     EvidenceFormat
	Actor      Actor
}

type EvidenceExport struct {
	ID                 uuid.UUID      `json:"id"`
	TenantID           uuid.UUID      `json:"tenant_id"`
	IncidentID         uuid.UUID      `json:"incident_id"`
	PIRID              *uuid.UUID     `json:"pir_id,omitempty"`
	Format             EvidenceFormat `json:"format"`
	Content            []byte         `json:"-"`
	ContentSHA256      string         `json:"content_sha256"`
	ByteSize           int            `json:"byte_size"`
	TimelineEventCount int            `json:"timeline_event_count"`
	PIRContentHash     string         `json:"pir_content_hash"`
	GeneratedBy        uuid.UUID      `json:"generated_by"`
	GeneratedAt        time.Time      `json:"generated_at"`
	CreatedAt          time.Time      `json:"created_at"`
}

const evidenceExportColumns = `id, tenant_id, incident_id, pir_id, format,
content_sha256, byte_size, timeline_event_count, pir_content_hash,
generated_by, generated_at, created_at`

func scanEvidenceExport(row rowScanner) (*EvidenceExport, error) {
	var export EvidenceExport
	var pirID uuid.NullUUID
	var format string
	if err := row.Scan(
		&export.ID,
		&export.TenantID,
		&export.IncidentID,
		&pirID,
		&format,
		&export.ContentSHA256,
		&export.ByteSize,
		&export.TimelineEventCount,
		&export.PIRContentHash,
		&export.GeneratedBy,
		&export.GeneratedAt,
		&export.CreatedAt,
	); err != nil {
		return nil, err
	}
	if pirID.Valid {
		export.PIRID = &pirID.UUID
	}
	export.Format = EvidenceFormat(format)
	return &export, nil
}

func (s *Store) CreateEvidenceExportAudit(ctx context.Context, db DBTX, export *EvidenceExport) error {
	var pirID any
	if export.PIRID != nil {
		pirID = *export.PIRID
	}
	stored, err := scanEvidenceExport(db.QueryRow(ctx, `
INSERT INTO respond_incident_evidence_export (
    tenant_id, incident_id, pir_id, format, content_sha256, byte_size,
    timeline_event_count, pir_content_hash, generated_by, generated_at
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING `+evidenceExportColumns,
		export.TenantID,
		export.IncidentID,
		pirID,
		export.Format,
		export.ContentSHA256,
		export.ByteSize,
		export.TimelineEventCount,
		export.PIRContentHash,
		export.GeneratedBy,
		export.GeneratedAt,
	))
	if err != nil {
		return fmt.Errorf("respond: create evidence export audit: %w", err)
	}
	content := export.Content
	*export = *stored
	export.Content = content
	return nil
}

func (s *Store) ListEvidenceExports(ctx context.Context, db DBTX, tenantID, incidentID uuid.UUID, limit int) ([]EvidenceExport, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := db.Query(ctx, `SELECT `+evidenceExportColumns+`
FROM respond_incident_evidence_export
WHERE tenant_id = $1 AND incident_id = $2
ORDER BY generated_at DESC, id DESC
LIMIT $3`, tenantID, incidentID, limit)
	if err != nil {
		return nil, fmt.Errorf("respond: list evidence exports: %w", err)
	}
	defer rows.Close()
	var exports []EvidenceExport
	for rows.Next() {
		export, err := scanEvidenceExport(rows)
		if err != nil {
			return nil, fmt.Errorf("respond: scan evidence export: %w", err)
		}
		exports = append(exports, *export)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("respond: read evidence exports: %w", err)
	}
	return exports, nil
}

func (s *Service) ExportIncidentEvidence(ctx context.Context, tenantID uuid.UUID, in EvidenceExportInput) (*EvidenceExport, error) {
	if !in.Actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	if in.IncidentID == uuid.Nil || in.Actor.UserID == uuid.Nil {
		return nil, fmt.Errorf("incident_id and actor are required: %w", ErrValidation)
	}
	format := in.Format
	if format == "" {
		format = EvidenceFormatCSV
	}
	if !format.valid() {
		return nil, fmt.Errorf("invalid evidence export format: %w", ErrValidation)
	}
	generatedAt := s.now()
	var export *EvidenceExport
	var event TimelineEvent
	err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		inc, err := s.repo.GetIncident(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		pir, err := s.repo.GetIncidentPIR(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		timeline, err := s.repo.ListAllTimelineEvents(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		approvals, err := s.repo.ListIncidentApprovals(ctx, tx, tenantID, in.IncidentID)
		if err != nil {
			return err
		}
		var content []byte
		switch format {
		case EvidenceFormatCSV:
			content, err = BuildEvidenceCSV(inc, pir, timeline, approvals)
		case EvidenceFormatPDF:
			content, err = BuildEvidencePDF(inc, pir, timeline, approvals)
		}
		if err != nil {
			return err
		}
		if len(content) == 0 {
			return fmt.Errorf("evidence export rendered empty content: %w", ErrValidation)
		}
		sum := sha256.Sum256(content)
		export = &EvidenceExport{
			TenantID:           tenantID,
			IncidentID:         in.IncidentID,
			PIRID:              &pir.ID,
			Format:             format,
			Content:            content,
			ContentSHA256:      hex.EncodeToString(sum[:]),
			ByteSize:           len(content),
			TimelineEventCount: len(timeline),
			PIRContentHash:     pir.ContentHash,
			GeneratedBy:        in.Actor.UserID,
			GeneratedAt:        generatedAt,
		}
		if err := s.repo.CreateEvidenceExportAudit(ctx, tx, export); err != nil {
			return err
		}
		event = TimelineEvent{
			TenantID:   tenantID,
			IncidentID: in.IncidentID,
			ActorID:    in.Actor.UserID,
			OccurredAt: generatedAt,
			EventType:  EventEvidenceExported,
			Payload: map[string]any{
				"export_id":            export.ID.String(),
				"format":               export.Format,
				"content_sha256":       export.ContentSHA256,
				"byte_size":            export.ByteSize,
				"timeline_event_count": export.TimelineEventCount,
				"pir_id":               pir.ID.String(),
				"pir_content_hash":     pir.ContentHash,
			},
		}
		return s.repo.AppendTimelineEvent(ctx, tx, &event)
	})
	if err != nil {
		return nil, err
	}
	s.feed.Publish(event)
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("incident_id", in.IncidentID.String()).Str("export_id", export.ID.String()).Str("format", string(export.Format)).Msg("respond evidence exported")
	return export, nil
}

func BuildEvidenceCSV(inc *Incident, pir *IncidentPIR, timeline []TimelineEvent, approvals []IncidentApproval) ([]byte, error) {
	if inc == nil || pir == nil {
		return nil, fmt.Errorf("incident and PIR are required: %w", ErrValidation)
	}
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	header := []string{"section", "record_id", "occurred_at", "actor_id", "type", "status", "summary", "payload_sha256"}
	if err := writer.Write(header); err != nil {
		return nil, fmt.Errorf("respond: write evidence CSV header: %w", err)
	}
	write := func(section, id string, at time.Time, actorID uuid.UUID, typ, status, summary string, payload any) error {
		hash, err := evidencePayloadHash(payload)
		if err != nil {
			return err
		}
		return writer.Write([]string{
			section,
			id,
			at.UTC().Format(time.RFC3339),
			actorID.String(),
			typ,
			status,
			summary,
			hash,
		})
	}
	if err := write("incident", inc.ID.String(), inc.DeclaredAt, inc.DeclaredBy, "incident", string(inc.Status), inc.Reference+" "+inc.Title, inc); err != nil {
		return nil, err
	}
	if err := write("mttr", pir.ID.String(), pir.GeneratedAt, pir.GeneratedBy, "mttr", fmt.Sprintf("met=%t", pir.MTTR.MetTarget), fmt.Sprintf("%d seconds actual vs %d seconds target", pir.MTTR.ActualSeconds, pir.MTTR.TargetSeconds), pir.MTTR); err != nil {
		return nil, err
	}
	for _, ev := range timeline {
		if err := write("timeline", ev.ID.String(), ev.OccurredAt, ev.ActorID, ev.EventType, "", summarizeEvent(ev), ev.Payload); err != nil {
			return nil, err
		}
	}
	for _, approval := range approvals {
		actorID := approval.RequestedBy
		at := approval.RequestedAt
		status := string(approval.Decision)
		if approval.DecidedBy != nil {
			actorID = *approval.DecidedBy
		}
		if approval.DecidedAt != nil {
			at = *approval.DecidedAt
		}
		if err := write("approval", approval.ID.String(), at, actorID, string(approval.Action), status, approval.ActionKey, approval); err != nil {
			return nil, err
		}
	}
	for _, integration := range pir.Integrations {
		if err := write("integration", integration.ExternalID, integration.OccurredAt, integration.ActorID, integration.System, integration.ExternalStatus, integration.EventType, integration); err != nil {
			return nil, err
		}
	}
	signoffStatus := string(pir.Status)
	signoffActor := pir.GeneratedBy
	signoffAt := pir.GeneratedAt
	if pir.SignedOffBy != nil {
		signoffActor = *pir.SignedOffBy
	}
	if pir.SignedOffAt != nil {
		signoffAt = *pir.SignedOffAt
	}
	if err := write("signoff", pir.ID.String(), signoffAt, signoffActor, "pir_signoff", signoffStatus, pir.ContentHash, pir); err != nil {
		return nil, err
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, fmt.Errorf("respond: flush evidence CSV: %w", err)
	}
	return buf.Bytes(), nil
}

func BuildEvidencePDF(inc *Incident, pir *IncidentPIR, timeline []TimelineEvent, approvals []IncidentApproval) ([]byte, error) {
	if inc == nil || pir == nil {
		return nil, fmt.Errorf("incident and PIR are required: %w", ErrValidation)
	}
	lines := []string{
		"Clario Respond Evidence Export",
		"Incident reference: " + inc.Reference,
		"Incident ID: " + inc.ID.String(),
		"Title: " + inc.Title,
		"Severity/status: " + string(inc.Severity) + " / " + string(inc.Status),
		"Impact: " + stakeholderImpactSummary(inc.Description, inc.ImpactedServices),
		"PIR ID: " + pir.ID.String(),
		"PIR status: " + string(pir.Status),
		"PIR content hash: " + pir.ContentHash,
		fmt.Sprintf("MTTR actual/target seconds: %d / %d", pir.MTTR.ActualSeconds, pir.MTTR.TargetSeconds),
		fmt.Sprintf("MTTR met target: %t", pir.MTTR.MetTarget),
		"",
		"Sign-off",
		"Signed off by: " + evidenceUUIDPtr(pir.SignedOffBy),
		"Signed off at: " + evidenceTimePtr(pir.SignedOffAt),
		"",
		"Approvals",
	}
	if len(approvals) == 0 {
		lines = append(lines, "No approval records were linked to this incident.")
	}
	for _, approval := range approvals {
		lines = appendWrappedEvidence(lines, fmt.Sprintf("%s | %s | requested %s by %s | decision %s by %s at %s",
			approval.ID,
			approval.Action,
			approval.RequestedAt.UTC().Format(time.RFC3339),
			approval.RequestedBy,
			approval.Decision,
			evidenceUUIDPtr(approval.DecidedBy),
			evidenceTimePtr(approval.DecidedAt),
		))
	}
	lines = append(lines, "", "Integration linkage")
	if len(pir.Integrations) == 0 {
		lines = append(lines, "No integration timeline records were linked to this incident.")
	}
	for _, integration := range pir.Integrations {
		lines = appendWrappedEvidence(lines, fmt.Sprintf("%s | %s | %s | %s | %s",
			integration.OccurredAt.UTC().Format(time.RFC3339),
			integration.System,
			integration.ExternalID,
			integration.ExternalStatus,
			integration.EventType,
		))
	}
	lines = append(lines, "", "Timeline")
	for _, ev := range timeline {
		lines = appendWrappedEvidence(lines, fmt.Sprintf("%s | %s | %s | %s",
			ev.OccurredAt.UTC().Format(time.RFC3339),
			ev.ActorID,
			ev.EventType,
			summarizeEvent(ev),
		))
	}
	return makeEvidencePDF(lines), nil
}

func evidencePayloadHash(payload any) (string, error) {
	rendered, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("respond: marshal evidence payload: %w", err)
	}
	sum := sha256.Sum256(rendered)
	return hex.EncodeToString(sum[:]), nil
}

func evidenceUUIDPtr(id *uuid.UUID) string {
	if id == nil {
		return "n/a"
	}
	return id.String()
}

func evidenceTimePtr(t *time.Time) string {
	if t == nil {
		return "n/a"
	}
	return t.UTC().Format(time.RFC3339)
}

const (
	evidencePDFLineWidth    = 92
	evidencePDFLinesPerPage = 48
)

func appendWrappedEvidence(lines []string, line string) []string {
	return append(lines, wrapEvidencePDFLine(line, evidencePDFLineWidth)...)
}

func wrapEvidencePDFLine(line string, width int) []string {
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

func makeEvidencePDF(lines []string) []byte {
	if len(lines) == 0 {
		lines = []string{""}
	}
	pages := chunkEvidencePDFLines(lines, evidencePDFLinesPerPage)
	fontID := 3
	var kids strings.Builder
	for i := range pages {
		if i > 0 {
			kids.WriteByte(' ')
		}
		fmt.Fprintf(&kids, "%d 0 R", evidencePageObjectID(i))
	}
	objects := map[int]string{
		1: fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R >>", 2),
		2: fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", kids.String(), len(pages)),
		3: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	for i, page := range pages {
		pageID := evidencePageObjectID(i)
		contentID := evidenceContentObjectID(i)
		content := evidencePageContent(page)
		objects[pageID] = fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>", fontID, contentID)
		objects[contentID] = fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content)
	}
	maxObjectID := evidenceContentObjectID(len(pages) - 1)
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n%Clario360 Respond\n")
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

func evidencePageObjectID(page int) int {
	return 4 + page*2
}

func evidenceContentObjectID(page int) int {
	return evidencePageObjectID(page) + 1
}

func chunkEvidencePDFLines(lines []string, size int) [][]string {
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

func evidencePageContent(lines []string) string {
	var content strings.Builder
	content.WriteString("BT\n/F1 10 Tf\n50 760 Td\n14 TL\n")
	for i, line := range lines {
		if i > 0 {
			content.WriteString("T*\n")
		}
		content.WriteByte('(')
		content.WriteString(escapeEvidencePDFText(line))
		content.WriteString(") Tj\n")
	}
	content.WriteString("ET\n")
	return content.String()
}

func escapeEvidencePDFText(s string) string {
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
