package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func (r *DocumentEditorRepository) CreateGuestReviewLink(ctx context.Context, q Queryer, link *model.DocumentEditorGuestReviewLink) error {
	if link.ID == uuid.Nil {
		link.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(link.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor guest link metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_guest_links (
			id, tenant_id, document_id, session_id, token_hash, reviewer_name,
			reviewer_email, organization, access_mode, sections, status, message,
			expires_at, created_by, metadata
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,$12,
			$13,$14,$15::jsonb
		)
		RETURNING created_at, updated_at`,
		link.ID, link.TenantID, link.DocumentID, link.SessionID, link.TokenHash,
		link.ReviewerName, link.ReviewerEmail, link.Organization, link.AccessMode,
		link.Sections, link.Status, link.Message, link.ExpiresAt, link.CreatedBy,
		metadataJSON,
	).Scan(&link.CreatedAt, &link.UpdatedAt)
}

func (r *DocumentEditorRepository) ListGuestReviewLinks(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorGuestReviewLink, error) {
	return queryListJSON[model.DocumentEditorGuestReviewLink](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, session_id, token_hash, reviewer_name,
			       reviewer_email, organization, access_mode, COALESCE(sections, '{}') AS sections,
			       status, message, expires_at, created_by, created_at, updated_at,
			       revoked_by, revoked_at, last_accessed_at, COALESCE(metadata, '{}'::jsonb) AS metadata
			FROM lex_document_editor_guest_links
			WHERE tenant_id = $1 AND document_id = $2
			ORDER BY created_at DESC
			LIMIT $3
		) t`,
		tenantID, documentID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) RevokeGuestReviewLink(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, linkRef string, actorID uuid.UUID, metadata map[string]any) (*model.DocumentEditorGuestReviewLink, error) {
	metadataJSON, err := json.Marshal(orEmptyMap(metadata))
	if err != nil {
		return nil, fmt.Errorf("marshal editor guest link revocation metadata: %w", err)
	}
	query := `
		WITH updated AS (
			UPDATE lex_document_editor_guest_links
			SET status = 'revoked',
			    revoked_by = $4,
			    revoked_at = now(),
			    updated_at = now(),
			    metadata = metadata || $5::jsonb
			WHERE tenant_id = $1
			  AND document_id = $2
			  AND (id::text = $3 OR token_hash = $3)
			RETURNING id
		)
		SELECT row_to_json(t)
		FROM (
			SELECT g.id, g.tenant_id, g.document_id, g.session_id, g.token_hash,
			       g.reviewer_name, g.reviewer_email, g.organization, g.access_mode,
			       COALESCE(g.sections, '{}') AS sections, g.status, g.message,
			       g.expires_at, g.created_by, g.created_at, g.updated_at,
			       g.revoked_by, g.revoked_at, g.last_accessed_at,
			       COALESCE(g.metadata, '{}'::jsonb) AS metadata
			FROM lex_document_editor_guest_links g
			JOIN updated u ON u.id = g.id
		) t`
	return queryRowJSON[model.DocumentEditorGuestReviewLink](ctx, q, query, tenantID, documentID, linkRef, actorID, metadataJSON)
}

func (r *DocumentEditorRepository) CreateNegotiationMessage(ctx context.Context, q Queryer, message *model.DocumentEditorNegotiationMessage) error {
	if message.ID == uuid.Nil {
		message.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(message.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor negotiation message metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_negotiation_messages (
			id, tenant_id, document_id, session_id, issue_id, parent_message_id,
			actor_user_id, participant_name, participant_email, participant_role,
			message_type, visibility, status, body, section_reference, metadata
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,
			$11,$12,$13,$14,$15,$16::jsonb
		)
		RETURNING created_at, updated_at`,
		message.ID, message.TenantID, message.DocumentID, message.SessionID,
		message.IssueID, message.ParentMessageID, message.ActorUserID,
		message.ParticipantName, message.ParticipantEmail, message.ParticipantRole,
		message.MessageType, message.Visibility, message.Status, message.Body,
		message.SectionReference, metadataJSON,
	).Scan(&message.CreatedAt, &message.UpdatedAt)
}

func (r *DocumentEditorRepository) ListNegotiationMessages(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorNegotiationMessage, error) {
	return queryListJSON[model.DocumentEditorNegotiationMessage](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, session_id, issue_id, parent_message_id,
			       actor_user_id, participant_name, participant_email, participant_role,
			       message_type, visibility, status, body, section_reference,
			       COALESCE(metadata, '{}'::jsonb) AS metadata, created_at, updated_at, deleted_at
			FROM lex_document_editor_negotiation_messages
			WHERE tenant_id = $1 AND document_id = $2 AND deleted_at IS NULL
			ORDER BY created_at DESC
			LIMIT $3
		) t`,
		tenantID, documentID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) FindLegalIssueID(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, issueRef string) (uuid.UUID, error) {
	var id uuid.UUID
	err := q.QueryRow(ctx, `
		SELECT id
		FROM lex_document_editor_legal_issues
		WHERE tenant_id = $1
		  AND document_id = $2
		  AND deleted_at IS NULL
		  AND (id::text = $3 OR external_id = $3)
		ORDER BY updated_at DESC
		LIMIT 1`,
		tenantID, documentID, issueRef,
	).Scan(&id)
	if err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

func (r *DocumentEditorRepository) UpsertLegalIssue(ctx context.Context, q Queryer, issue *model.DocumentEditorLegalIssueRecord) error {
	if issue.ID == uuid.Nil {
		issue.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(issue.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor legal issue metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_legal_issues (
			id, tenant_id, document_id, session_id, anchor_id, external_id,
			title, description, severity, status, source, section_reference,
			owner_user_id, owner_name, due_at, resolved_by, resolved_at,
			resolution_notes, metadata, created_by, updated_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,$12,
			$13,$14,$15,$16,$17,
			$18,$19::jsonb,$20,$21
		)
		ON CONFLICT (id) DO UPDATE SET
			session_id = EXCLUDED.session_id,
			anchor_id = EXCLUDED.anchor_id,
			external_id = COALESCE(EXCLUDED.external_id, lex_document_editor_legal_issues.external_id),
			title = EXCLUDED.title,
			description = EXCLUDED.description,
			severity = EXCLUDED.severity,
			status = EXCLUDED.status,
			source = EXCLUDED.source,
			section_reference = EXCLUDED.section_reference,
			owner_user_id = EXCLUDED.owner_user_id,
			owner_name = EXCLUDED.owner_name,
			due_at = EXCLUDED.due_at,
			resolved_by = EXCLUDED.resolved_by,
			resolved_at = EXCLUDED.resolved_at,
			resolution_notes = EXCLUDED.resolution_notes,
			metadata = EXCLUDED.metadata,
			updated_by = EXCLUDED.updated_by,
			updated_at = now()
		RETURNING created_at, updated_at`,
		issue.ID, issue.TenantID, issue.DocumentID, issue.SessionID, issue.AnchorID,
		issue.ExternalID, issue.Title, issue.Description, issue.Severity, issue.Status,
		issue.Source, issue.SectionReference, issue.OwnerUserID, issue.OwnerName,
		issue.DueAt, issue.ResolvedBy, issue.ResolvedAt, issue.ResolutionNotes,
		metadataJSON, issue.CreatedBy, issue.UpdatedBy,
	).Scan(&issue.CreatedAt, &issue.UpdatedAt)
}

func (r *DocumentEditorRepository) ResolveLegalIssue(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, issueRef string, actorID uuid.UUID, notes string, metadata map[string]any) (*model.DocumentEditorLegalIssueRecord, error) {
	metadataJSON, err := json.Marshal(orEmptyMap(metadata))
	if err != nil {
		return nil, fmt.Errorf("marshal editor legal issue resolution metadata: %w", err)
	}
	query := `
		WITH updated AS (
			UPDATE lex_document_editor_legal_issues
			SET status = 'resolved',
			    resolved_by = $4,
			    resolved_at = now(),
			    resolution_notes = $5,
			    metadata = metadata || $6::jsonb,
			    updated_by = $4,
			    updated_at = now()
			WHERE tenant_id = $1
			  AND document_id = $2
			  AND deleted_at IS NULL
			  AND (id::text = $3 OR external_id = $3)
			RETURNING id
		)
		SELECT row_to_json(t)
		FROM (
			SELECT i.id, i.tenant_id, i.document_id, i.session_id, i.anchor_id,
			       i.external_id, i.title, i.description, i.severity, i.status,
			       i.source, i.section_reference, i.owner_user_id, i.owner_name,
			       i.due_at, i.resolved_by, i.resolved_at, i.resolution_notes,
			       COALESCE(i.metadata, '{}'::jsonb) AS metadata, i.created_by,
			       i.updated_by, i.created_at, i.updated_at, i.deleted_at
			FROM lex_document_editor_legal_issues i
			JOIN updated u ON u.id = i.id
		) t`
	return queryRowJSON[model.DocumentEditorLegalIssueRecord](ctx, q, query, tenantID, documentID, issueRef, actorID, notes, metadataJSON)
}

func (r *DocumentEditorRepository) ListLegalIssues(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorLegalIssueRecord, error) {
	return queryListJSON[model.DocumentEditorLegalIssueRecord](ctx, q, documentEditorLegalIssueJSONSelectWithSuffix(`i.tenant_id = $1 AND i.document_id = $2 AND i.deleted_at IS NULL`, ` ORDER BY i.updated_at DESC LIMIT $3`), tenantID, documentID, normalizedEditorRepoLimit(limit))
}

func (r *DocumentEditorRepository) UpsertSectionAssignment(ctx context.Context, q Queryer, assignment *model.DocumentEditorSectionAssignmentRecord) error {
	if assignment.ID == uuid.Nil {
		assignment.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(assignment.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor section assignment metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_section_assignments (
			id, tenant_id, document_id, session_id, anchor_id, section_id, title,
			section_reference, assignee_id, assignee_name, role, status, due_at,
			completed_at, metadata, created_by, updated_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,$13,
			$14,$15::jsonb,$16,$17
		)
		ON CONFLICT (id) DO UPDATE SET
			session_id = EXCLUDED.session_id,
			anchor_id = EXCLUDED.anchor_id,
			section_id = EXCLUDED.section_id,
			title = EXCLUDED.title,
			section_reference = EXCLUDED.section_reference,
			assignee_id = EXCLUDED.assignee_id,
			assignee_name = EXCLUDED.assignee_name,
			role = EXCLUDED.role,
			status = EXCLUDED.status,
			due_at = EXCLUDED.due_at,
			completed_at = EXCLUDED.completed_at,
			metadata = EXCLUDED.metadata,
			updated_by = EXCLUDED.updated_by,
			updated_at = now()
		RETURNING created_at, updated_at`,
		assignment.ID, assignment.TenantID, assignment.DocumentID, assignment.SessionID,
		assignment.AnchorID, assignment.SectionID, assignment.Title, assignment.SectionReference,
		assignment.AssigneeID, assignment.AssigneeName, assignment.Role, assignment.Status,
		assignment.DueAt, assignment.CompletedAt, metadataJSON, assignment.CreatedBy,
		assignment.UpdatedBy,
	).Scan(&assignment.CreatedAt, &assignment.UpdatedAt)
}

func (r *DocumentEditorRepository) ListSectionAssignments(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorSectionAssignmentRecord, error) {
	return queryListJSON[model.DocumentEditorSectionAssignmentRecord](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, session_id, anchor_id, section_id, title,
			       section_reference, assignee_id, assignee_name, role, status, due_at,
			       completed_at, COALESCE(metadata, '{}'::jsonb) AS metadata, created_by,
			       updated_by, created_at, updated_at, deleted_at
			FROM lex_document_editor_section_assignments
			WHERE tenant_id = $1 AND document_id = $2 AND deleted_at IS NULL
			ORDER BY due_at ASC NULLS LAST, updated_at DESC
			LIMIT $3
		) t`,
		tenantID, documentID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) UpsertPrivilegedControl(ctx context.Context, q Queryer, control *model.DocumentEditorPrivilegedControlRecord) error {
	if control.ID == uuid.Nil {
		control.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(control.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor privileged control metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_privileged_controls (
			id, tenant_id, document_id, control_key, enabled, locked, reason,
			status, metadata, updated_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
		ON CONFLICT (tenant_id, document_id, control_key) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			locked = EXCLUDED.locked,
			reason = EXCLUDED.reason,
			status = EXCLUDED.status,
			metadata = EXCLUDED.metadata,
			updated_by = EXCLUDED.updated_by,
			updated_at = now()
		RETURNING id, created_at, updated_at`,
		control.ID, control.TenantID, control.DocumentID, control.ControlKey,
		control.Enabled, control.Locked, control.Reason, control.Status,
		metadataJSON, control.UpdatedBy,
	).Scan(&control.ID, &control.CreatedAt, &control.UpdatedAt)
}

func (r *DocumentEditorRepository) ListPrivilegedControls(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID) ([]model.DocumentEditorPrivilegedControlRecord, error) {
	return queryListJSON[model.DocumentEditorPrivilegedControlRecord](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, control_key, enabled, locked, reason,
			       status, COALESCE(metadata, '{}'::jsonb) AS metadata, updated_by,
			       created_at, updated_at
			FROM lex_document_editor_privileged_controls
			WHERE tenant_id = $1 AND document_id = $2
			ORDER BY control_key ASC
		) t`,
		tenantID, documentID,
	)
}

func (r *DocumentEditorRepository) CreatePrivilegedControlRequest(ctx context.Context, q Queryer, request *model.DocumentEditorPrivilegedControlRequest) error {
	if request.ID == uuid.Nil {
		request.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(request.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor privileged control request metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_privileged_control_requests (
			id, tenant_id, document_id, session_id, control_key, requested_state,
			status, reason, decision_notes, requested_by, decided_by, decided_at,
			applied_at, metadata
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,$12,
			$13,$14::jsonb
		)
		RETURNING requested_at`,
		request.ID, request.TenantID, request.DocumentID, request.SessionID,
		request.ControlKey, request.RequestedState, request.Status, request.Reason,
		request.DecisionNotes, request.RequestedBy, request.DecidedBy, request.DecidedAt,
		request.AppliedAt, metadataJSON,
	).Scan(&request.RequestedAt)
}

func (r *DocumentEditorRepository) ListPrivilegedControlRequests(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorPrivilegedControlRequest, error) {
	return queryListJSON[model.DocumentEditorPrivilegedControlRequest](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, session_id, control_key, requested_state,
			       status, reason, decision_notes, requested_by, decided_by,
			       requested_at, decided_at, applied_at, COALESCE(metadata, '{}'::jsonb) AS metadata
			FROM lex_document_editor_privileged_control_requests
			WHERE tenant_id = $1 AND document_id = $2
			ORDER BY requested_at DESC
			LIMIT $3
		) t`,
		tenantID, documentID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) UpsertClauseAnchor(ctx context.Context, q Queryer, anchor *model.DocumentEditorClauseAnchor) error {
	if anchor.ID == uuid.Nil {
		anchor.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(anchor.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor clause anchor metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_clause_anchors (
			id, tenant_id, document_id, session_id, document_version, anchor_key,
			clause_id, section_id, section_reference, title, clause_type,
			start_offset, end_offset, page_number, docx_path, checksum,
			extracted_text, confidence, status, metadata, created_by, updated_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,
			$12,$13,$14,$15,$16,
			$17,$18,$19,$20::jsonb,$21,$22
		)
		ON CONFLICT (tenant_id, document_id, document_version, anchor_key) WHERE deleted_at IS NULL DO UPDATE SET
			session_id = EXCLUDED.session_id,
			clause_id = EXCLUDED.clause_id,
			section_id = EXCLUDED.section_id,
			section_reference = EXCLUDED.section_reference,
			title = EXCLUDED.title,
			clause_type = EXCLUDED.clause_type,
			start_offset = EXCLUDED.start_offset,
			end_offset = EXCLUDED.end_offset,
			page_number = EXCLUDED.page_number,
			docx_path = EXCLUDED.docx_path,
			checksum = EXCLUDED.checksum,
			extracted_text = EXCLUDED.extracted_text,
			confidence = EXCLUDED.confidence,
			status = EXCLUDED.status,
			metadata = EXCLUDED.metadata,
			updated_by = EXCLUDED.updated_by,
			updated_at = now()
		RETURNING id, created_at, updated_at`,
		anchor.ID, anchor.TenantID, anchor.DocumentID, anchor.SessionID,
		anchor.DocumentVersion, anchor.AnchorKey, anchor.ClauseID, anchor.SectionID,
		anchor.SectionReference, anchor.Title, anchor.ClauseType, anchor.StartOffset,
		anchor.EndOffset, anchor.PageNumber, anchor.DocXPath, anchor.Checksum,
		anchor.ExtractedText, anchor.Confidence, anchor.Status, metadataJSON,
		anchor.CreatedBy, anchor.UpdatedBy,
	).Scan(&anchor.ID, &anchor.CreatedAt, &anchor.UpdatedAt)
}

func (r *DocumentEditorRepository) ListClauseAnchors(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorClauseAnchor, error) {
	return queryListJSON[model.DocumentEditorClauseAnchor](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, session_id, document_version, anchor_key,
			       clause_id, section_id, section_reference, title, clause_type,
			       start_offset, end_offset, page_number, docx_path, checksum,
			       extracted_text, confidence::float8 AS confidence, status,
			       COALESCE(metadata, '{}'::jsonb) AS metadata, created_by, updated_by,
			       created_at, updated_at, deleted_at
			FROM lex_document_editor_clause_anchors
			WHERE tenant_id = $1 AND document_id = $2 AND deleted_at IS NULL
			ORDER BY document_version DESC, section_reference ASC, created_at ASC
			LIMIT $3
		) t`,
		tenantID, documentID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) CreateApprovalRequest(ctx context.Context, q Queryer, request *model.DocumentEditorApprovalRequest) error {
	if request.ID == uuid.Nil {
		request.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(request.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor approval request metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_approval_requests (
			id, tenant_id, document_id, session_id, target_type, target_id, status,
			priority, reason, requested_by, assigned_to, due_at, decided_by,
			decided_at, decision_notes, metadata
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,$13,
			$14,$15,$16::jsonb
		)
		RETURNING created_at, updated_at`,
		request.ID, request.TenantID, request.DocumentID, request.SessionID,
		request.TargetType, request.TargetID, request.Status, request.Priority,
		request.Reason, request.RequestedBy, request.AssignedTo, request.DueAt,
		request.DecidedBy, request.DecidedAt, request.DecisionNotes, metadataJSON,
	).Scan(&request.CreatedAt, &request.UpdatedAt)
}

func (r *DocumentEditorRepository) ListApprovalRequests(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorApprovalRequest, error) {
	return queryListJSON[model.DocumentEditorApprovalRequest](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, session_id, target_type, target_id,
			       status, priority, reason, requested_by, assigned_to, due_at,
			       decided_by, decided_at, decision_notes,
			       COALESCE(metadata, '{}'::jsonb) AS metadata, created_at, updated_at
			FROM lex_document_editor_approval_requests
			WHERE tenant_id = $1 AND document_id = $2
			ORDER BY created_at DESC
			LIMIT $3
		) t`,
		tenantID, documentID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) UpsertCitationBinding(ctx context.Context, q Queryer, binding *model.DocumentEditorCitationBinding) error {
	if binding.ID == uuid.Nil {
		binding.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(binding.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor citation binding metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_citation_bindings (
			id, tenant_id, document_id, anchor_id, source_type, source_document_id,
			source_id, source_label, source_url, citation_text, page_number,
			confidence, status, metadata, created_by, updated_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,
			$12,$13,$14::jsonb,$15,$16
		)
		ON CONFLICT (id) DO UPDATE SET
			anchor_id = EXCLUDED.anchor_id,
			source_type = EXCLUDED.source_type,
			source_document_id = EXCLUDED.source_document_id,
			source_id = EXCLUDED.source_id,
			source_label = EXCLUDED.source_label,
			source_url = EXCLUDED.source_url,
			citation_text = EXCLUDED.citation_text,
			page_number = EXCLUDED.page_number,
			confidence = EXCLUDED.confidence,
			status = EXCLUDED.status,
			metadata = EXCLUDED.metadata,
			updated_by = EXCLUDED.updated_by,
			updated_at = now()
		RETURNING created_at, updated_at`,
		binding.ID, binding.TenantID, binding.DocumentID, binding.AnchorID,
		binding.SourceType, binding.SourceDocumentID, binding.SourceID,
		binding.SourceLabel, binding.SourceURL, binding.CitationText,
		binding.PageNumber, binding.Confidence, binding.Status, metadataJSON,
		binding.CreatedBy, binding.UpdatedBy,
	).Scan(&binding.CreatedAt, &binding.UpdatedAt)
}

func (r *DocumentEditorRepository) ListCitationBindings(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorCitationBinding, error) {
	return queryListJSON[model.DocumentEditorCitationBinding](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, anchor_id, source_type, source_document_id,
			       source_id, source_label, source_url, citation_text, page_number,
			       confidence::float8 AS confidence, status,
			       COALESCE(metadata, '{}'::jsonb) AS metadata, created_by, updated_by,
			       created_at, updated_at, deleted_at
			FROM lex_document_editor_citation_bindings
			WHERE tenant_id = $1 AND document_id = $2 AND deleted_at IS NULL
			ORDER BY updated_at DESC
			LIMIT $3
		) t`,
		tenantID, documentID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) UpsertEditorTask(ctx context.Context, q Queryer, task *model.DocumentEditorTask) error {
	if task.ID == uuid.Nil {
		task.ID = uuid.New()
	}
	metadataJSON, err := json.Marshal(orEmptyMap(task.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor task metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_tasks (
			id, tenant_id, document_id, source_type, source_id, title, description,
			status, priority, assignee_id, due_at, sla_due_at, escalation_at,
			completed_by, completed_at, metadata, created_by, updated_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12,$13,
			$14,$15,$16::jsonb,$17,$18
		)
		ON CONFLICT (id) DO UPDATE SET
			source_type = EXCLUDED.source_type,
			source_id = EXCLUDED.source_id,
			title = EXCLUDED.title,
			description = EXCLUDED.description,
			status = EXCLUDED.status,
			priority = EXCLUDED.priority,
			assignee_id = EXCLUDED.assignee_id,
			due_at = EXCLUDED.due_at,
			sla_due_at = EXCLUDED.sla_due_at,
			escalation_at = EXCLUDED.escalation_at,
			completed_by = EXCLUDED.completed_by,
			completed_at = EXCLUDED.completed_at,
			metadata = EXCLUDED.metadata,
			updated_by = EXCLUDED.updated_by,
			updated_at = now()
		RETURNING created_at, updated_at`,
		task.ID, task.TenantID, task.DocumentID, task.SourceType, task.SourceID,
		task.Title, task.Description, task.Status, task.Priority, task.AssigneeID,
		task.DueAt, task.SLADueAt, task.EscalationAt, task.CompletedBy,
		task.CompletedAt, metadataJSON, task.CreatedBy, task.UpdatedBy,
	).Scan(&task.CreatedAt, &task.UpdatedAt)
}

func (r *DocumentEditorRepository) ListEditorTasks(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, limit int) ([]model.DocumentEditorTask, error) {
	return queryListJSON[model.DocumentEditorTask](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, source_type, source_id, title,
			       description, status, priority, assignee_id, due_at, sla_due_at,
			       escalation_at, completed_by, completed_at,
			       COALESCE(metadata, '{}'::jsonb) AS metadata, created_by,
			       updated_by, created_at, updated_at, deleted_at
			FROM lex_document_editor_tasks
			WHERE tenant_id = $1 AND document_id = $2 AND deleted_at IS NULL
			ORDER BY due_at ASC NULLS LAST, updated_at DESC
			LIMIT $3
		) t`,
		tenantID, documentID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) UpsertOfflineRecoverySnapshot(ctx context.Context, q Queryer, snapshot *model.DocumentEditorOfflineRecoverySnapshot) error {
	if snapshot.ID == uuid.Nil {
		snapshot.ID = uuid.New()
	}
	payloadMetadataJSON, err := json.Marshal(orEmptyMap(snapshot.PayloadMetadata))
	if err != nil {
		return fmt.Errorf("marshal editor offline recovery metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_offline_recovery_snapshots (
			id, tenant_id, document_id, session_id, user_id, provider,
			client_instance_id, snapshot_version, payload_ciphertext,
			payload_metadata, status, captured_at, recovered_at, discarded_at,
			expires_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,
			$10::jsonb,$11,$12,$13,$14,
			$15
		)
		ON CONFLICT (id) DO UPDATE SET
			session_id = EXCLUDED.session_id,
			provider = EXCLUDED.provider,
			client_instance_id = EXCLUDED.client_instance_id,
			snapshot_version = EXCLUDED.snapshot_version,
			payload_ciphertext = EXCLUDED.payload_ciphertext,
			payload_metadata = EXCLUDED.payload_metadata,
			status = EXCLUDED.status,
			captured_at = EXCLUDED.captured_at,
			recovered_at = EXCLUDED.recovered_at,
			discarded_at = EXCLUDED.discarded_at,
			expires_at = EXCLUDED.expires_at,
			updated_at = now()
		RETURNING created_at, updated_at`,
		snapshot.ID, snapshot.TenantID, snapshot.DocumentID, snapshot.SessionID,
		snapshot.UserID, snapshot.Provider, snapshot.ClientInstanceID,
		snapshot.SnapshotVersion, snapshot.PayloadCiphertext, payloadMetadataJSON,
		snapshot.Status, snapshot.CapturedAt, snapshot.RecoveredAt,
		snapshot.DiscardedAt, snapshot.ExpiresAt,
	).Scan(&snapshot.CreatedAt, &snapshot.UpdatedAt)
}

func (r *DocumentEditorRepository) ListOfflineRecoverySnapshots(ctx context.Context, q Queryer, tenantID, documentID, userID uuid.UUID, limit int) ([]model.DocumentEditorOfflineRecoverySnapshot, error) {
	return queryListJSON[model.DocumentEditorOfflineRecoverySnapshot](ctx, q, `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, session_id, user_id, provider,
			       client_instance_id, snapshot_version, payload_ciphertext,
			       COALESCE(payload_metadata, '{}'::jsonb) AS payload_metadata,
			       status, captured_at, recovered_at, discarded_at, expires_at,
			       created_at, updated_at
			FROM lex_document_editor_offline_recovery_snapshots
			WHERE tenant_id = $1 AND document_id = $2 AND user_id = $3
			ORDER BY captured_at DESC
			LIMIT $4
		) t`,
		tenantID, documentID, userID, normalizedEditorRepoLimit(limit),
	)
}

func (r *DocumentEditorRepository) AppendProviderEvent(ctx context.Context, q Queryer, event *model.DocumentEditorProviderEvent) error {
	if event.ID == uuid.Nil {
		event.ID = uuid.New()
	}
	payloadJSON, err := json.Marshal(orEmptyMap(event.Payload))
	if err != nil {
		return fmt.Errorf("marshal editor provider event payload: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_provider_events (
			id, tenant_id, document_id, session_id, provider, provider_event_id,
			event_type, status, payload, error, received_at, processed_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9::jsonb,$10,$11,$12
		)
		ON CONFLICT (tenant_id, provider, provider_event_id) WHERE provider_event_id IS NOT NULL DO UPDATE SET
			status = EXCLUDED.status,
			payload = EXCLUDED.payload,
			error = EXCLUDED.error,
			processed_at = EXCLUDED.processed_at
		RETURNING created_at`,
		event.ID, event.TenantID, event.DocumentID, event.SessionID, event.Provider,
		event.ProviderEventID, event.EventType, event.Status, payloadJSON, event.Error,
		event.ReceivedAt, event.ProcessedAt,
	).Scan(&event.CreatedAt)
}

func (r *DocumentEditorRepository) InsertAnalyticsRollup(ctx context.Context, q Queryer, rollup *model.DocumentEditorAnalyticsRollup) error {
	if rollup.ID == uuid.Nil {
		rollup.ID = uuid.New()
	}
	dimensionsJSON, err := json.Marshal(orEmptyMap(rollup.Dimensions))
	if err != nil {
		return fmt.Errorf("marshal editor analytics dimensions: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(rollup.Metadata))
	if err != nil {
		return fmt.Errorf("marshal editor analytics metadata: %w", err)
	}
	return q.QueryRow(ctx, `
		INSERT INTO lex_document_editor_analytics_rollups (
			id, tenant_id, document_id, grain, period_start, period_end,
			metric_key, metric_value, dimensions, metadata, calculated_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9::jsonb,$10::jsonb,$11
		)
		RETURNING created_at`,
		rollup.ID, rollup.TenantID, rollup.DocumentID, rollup.Grain,
		rollup.PeriodStart, rollup.PeriodEnd, rollup.MetricKey,
		rollup.MetricValue, dimensionsJSON, metadataJSON, rollup.CalculatedAt,
	).Scan(&rollup.CreatedAt)
}

func normalizedEditorRepoLimit(limit int) int {
	switch {
	case limit <= 0:
		return 100
	case limit > 500:
		return 500
	default:
		return limit
	}
}

func documentEditorLegalIssueJSONSelect(where string) string {
	return documentEditorLegalIssueJSONSelectWithSuffix(where, "")
}

func documentEditorLegalIssueJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT i.id, i.tenant_id, i.document_id, i.session_id, i.anchor_id,
			       i.external_id, i.title, i.description, i.severity, i.status,
			       i.source, i.section_reference, i.owner_user_id, i.owner_name,
			       i.due_at, i.resolved_by, i.resolved_at, i.resolution_notes,
			       COALESCE(i.metadata, '{}'::jsonb) AS metadata, i.created_by,
			       i.updated_by, i.created_at, i.updated_at, i.deleted_at
			FROM lex_document_editor_legal_issues i
			WHERE ` + where + suffix + `
		) t`
}
