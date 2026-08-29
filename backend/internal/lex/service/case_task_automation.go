package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

const caseTaskAutomationSource = "lex_case_automation"

type automatedCaseTaskSpec struct {
	AutomationKey string
	TemplateID    string
	Trigger       string
	Title         string
	Priority      model.LegalPriority
	DueDate       *time.Time
	AssigneeID    *uuid.UUID
	Metadata      map[string]any
}

func createAutomatedCaseTask(ctx context.Context, tx pgx.Tx, cases *repository.LegalCaseRepository, tasks *repository.CaseTaskRepository, tenantID, userID, caseID uuid.UUID, spec automatedCaseTaskSpec) (*model.CaseTask, bool, error) {
	if tasks == nil || cases == nil || strings.TrimSpace(spec.AutomationKey) == "" {
		return nil, false, nil
	}
	metadata := map[string]any{
		"source":         caseTaskAutomationSource,
		"automation_key": spec.AutomationKey,
		"template_id":    spec.TemplateID,
		"trigger_event":  spec.Trigger,
	}
	for k, v := range spec.Metadata {
		metadata[k] = v
	}
	t := &model.CaseTask{
		ID:         uuid.New(),
		TenantID:   tenantID,
		CaseID:     caseID,
		Title:      strings.TrimSpace(spec.Title),
		AssigneeID: spec.AssigneeID,
		Priority:   spec.Priority,
		Status:     model.CaseTaskStatusOpen,
		DueDate:    spec.DueDate,
		Metadata:   metadata,
		CreatedBy:  userID,
	}
	if t.Title == "" {
		t.Title = "Review case automation task"
	}
	if _, ok := allowedLegalPriorities[t.Priority]; !ok {
		t.Priority = model.LegalPriorityMedium
	}
	created, err := tasks.CreateIdempotentByAutomationKey(ctx, tx, t, spec.AutomationKey)
	if err != nil {
		return nil, false, internalError("create automated case task", err)
	}
	if !created {
		return t, false, nil
	}
	entry := &repository.LegalCaseSubAuditEntry{
		ID:           uuid.New(),
		TenantID:     tenantID,
		CaseID:       caseID,
		ResourceType: "task",
		ResourceID:   t.ID,
		// The sub-audit CHECK allows only created|updated|deleted; the automation
		// origin is preserved in the task snapshot/metadata (automation_key) and the
		// reason, not by an out-of-set action value (which violates the constraint).
		Action:      "created",
		Reason:      ptrString("automation"),
		AfterState:  caseTaskSnapshot(t),
		ActorUserID: userID,
	}
	if err := cases.AppendSubAudit(ctx, tx, entry); err != nil {
		return nil, false, internalError("append automated case task audit", err)
	}
	return t, true, nil
}

func createAutomatedCaseTasks(ctx context.Context, tx pgx.Tx, cases *repository.LegalCaseRepository, tasks *repository.CaseTaskRepository, tenantID, userID, caseID uuid.UUID, specs []automatedCaseTaskSpec) error {
	for i := range specs {
		if _, _, err := createAutomatedCaseTask(ctx, tx, cases, tasks, tenantID, userID, caseID, specs[i]); err != nil {
			return err
		}
	}
	return nil
}

func newCaseAutomationTasks(c *model.LegalCase, now time.Time) []automatedCaseTaskSpec {
	assignee := firstCaseAssignee(c)
	return []automatedCaseTaskSpec{
		{
			AutomationKey: fmt.Sprintf("case:%s:new:review", c.ID),
			TemplateID:    "lex.case.new.review",
			Trigger:       "case.created",
			Title:         fmt.Sprintf("مراجعة القضية الجديدة %s", c.CaseNumber),
			Priority:      c.Priority,
			DueDate:       ptrTime(normalizeDate(now.AddDate(0, 0, 1))),
			AssigneeID:    assignee,
			Metadata: map[string]any{
				"case_number":    c.CaseNumber,
				"company_status": string(c.CompanyStatus),
			},
		},
	}
}

func statusChangeAutomationTasks(c *model.LegalCase, from, to model.CaseStatus, now time.Time) []automatedCaseTaskSpec {
	spec := automatedCaseTaskSpec{
		AutomationKey: fmt.Sprintf("case:%s:status:%s", c.ID, to),
		TemplateID:    "lex.case.status." + string(to),
		Trigger:       "case.status_changed",
		Priority:      model.LegalPriorityMedium,
		DueDate:       ptrTime(normalizeDate(now.AddDate(0, 0, 2))),
		AssigneeID:    firstCaseAssignee(c),
		Metadata: map[string]any{
			"from_status": string(from),
			"to_status":   string(to),
			"case_number": c.CaseNumber,
		},
	}
	switch to {
	case model.CaseStatusPhase1:
		spec.Title = fmt.Sprintf("استكمال مراجعة التوجيه للقضية %s", c.CaseNumber)
		spec.Priority = model.LegalPriorityHigh
	case model.CaseStatusPhase2:
		spec.Title = fmt.Sprintf("استكمال التسليم القانوني للقضية %s", c.CaseNumber)
		spec.Priority = model.LegalPriorityHigh
	case model.CaseStatusOpen:
		spec.Title = fmt.Sprintf("إعداد خطة العمل للقضية المفتوحة %s", c.CaseNumber)
		spec.Priority = c.Priority
	case model.CaseStatusUnderProcedure:
		spec.Title = fmt.Sprintf("تحديث خطة الإجراءات للقضية %s", c.CaseNumber)
		spec.Priority = model.LegalPriorityHigh
		spec.DueDate = ptrTime(normalizeDate(now.AddDate(0, 0, 3)))
	case caseStatusOnHold:
		spec.Title = fmt.Sprintf("متابعة التعليق والإجراء التالي للقضية %s", c.CaseNumber)
		spec.DueDate = ptrTime(normalizeDate(now.AddDate(0, 0, 7)))
	case model.CaseStatusClosed:
		spec.Title = fmt.Sprintf("أرشفة مستندات إغلاق القضية %s", c.CaseNumber)
		spec.Priority = model.LegalPriorityLow
		spec.DueDate = ptrTime(normalizeDate(now.AddDate(0, 0, 5)))
	case model.CaseStatusCancelled:
		spec.Title = fmt.Sprintf("تأكيد سجل إلغاء القضية %s", c.CaseNumber)
		spec.Priority = model.LegalPriorityLow
	default:
		spec.Title = fmt.Sprintf("مراجعة تغيّر حالة القضية %s", c.CaseNumber)
	}
	return []automatedCaseTaskSpec{spec}
}

func hearingAddedAutomationTasks(c *model.LegalCase, h *model.CaseHearing, now time.Time) []automatedCaseTaskSpec {
	due := normalizeDate(h.HearingDate.AddDate(0, 0, -2))
	today := normalizeDate(now)
	if due.Before(today) {
		due = today
	}
	return []automatedCaseTaskSpec{
		{
			AutomationKey: fmt.Sprintf("case:%s:hearing:%s:prepare", c.ID, h.ID),
			TemplateID:    "lex.case.hearing.prepare",
			Trigger:       "case.hearing_added",
			Title:         fmt.Sprintf("التحضير للجلسة بتاريخ %s", h.HearingDate.UTC().Format("2006-01-02")),
			Priority:      model.LegalPriorityHigh,
			DueDate:       &due,
			AssigneeID:    firstCaseAssignee(c),
			Metadata: map[string]any{
				"hearing_id":   h.ID.String(),
				"hearing_date": h.HearingDate.UTC().Format(time.RFC3339),
			},
		},
	}
}

func judgmentRecordedAutomationTasks(c *model.LegalCase, j *model.LegalJudgment, now time.Time) []automatedCaseTaskSpec {
	return []automatedCaseTaskSpec{
		{
			AutomationKey: fmt.Sprintf("case:%s:judgment:%s:study", c.ID, j.ID),
			TemplateID:    "lex.case.judgment.study",
			Trigger:       "judgment.recorded",
			Title:         fmt.Sprintf("دراسة الحكم %s", j.JudgmentRef),
			Priority:      model.LegalPriorityHigh,
			DueDate:       ptrTime(normalizeDate(now.AddDate(0, 0, 2))),
			AssigneeID:    firstCaseAssignee(c),
			Metadata: map[string]any{
				"judgment_id":  j.ID.String(),
				"judgment_ref": j.JudgmentRef,
			},
		},
	}
}

func objectionRecommendedAutomationTasks(c *model.LegalCase, j *model.LegalJudgment, ownerUserID *uuid.UUID, now time.Time) []automatedCaseTaskSpec {
	due := normalizeDate(now.AddDate(0, 0, 1))
	if j.ObjectionDeadline != nil && !j.ObjectionDeadline.IsZero() {
		due = normalizeDate(*j.ObjectionDeadline)
	}
	assignee := ownerUserID
	if assignee == nil || *assignee == uuid.Nil {
		assignee = firstCaseAssignee(c)
	}
	return []automatedCaseTaskSpec{
		{
			AutomationKey: fmt.Sprintf("case:%s:judgment:%s:objection", c.ID, j.ID),
			TemplateID:    "lex.case.judgment.objection",
			Trigger:       "judgment.objection_recommended",
			Title:         fmt.Sprintf("تقديم اعتراض على الحكم %s", j.JudgmentRef),
			Priority:      model.LegalPriorityCritical,
			DueDate:       &due,
			AssigneeID:    assignee,
			Metadata: map[string]any{
				"judgment_id":         j.ID.String(),
				"judgment_ref":        j.JudgmentRef,
				"objection_deadline":  due.Format("2006-01-02"),
				"judgment_obligation": uuidPtrDetail(j.ObligationID),
			},
		},
	}
}

func defendantNotificationAutomationTasks(c *model.LegalCase, d *model.LegalDefendantCase, now time.Time) []automatedCaseTaskSpec {
	due := normalizeDate(now.AddDate(0, 0, 5))
	if d.NotificationDate != nil && !d.NotificationDate.IsZero() {
		due = normalizeDate(d.NotificationDate.AddDate(0, 0, 5))
	}
	return []automatedCaseTaskSpec{
		{
			AutomationKey: fmt.Sprintf("case:%s:defendant:%s:notification", c.ID, d.ID),
			TemplateID:    "lex.case.defendant.notification_response",
			Trigger:       "defendant.notification_received",
			Title:         fmt.Sprintf("إعداد مذكرة الرد الأولى تجاه %s", d.PlaintiffName),
			Priority:      model.LegalPriorityCritical,
			DueDate:       &due,
			AssigneeID:    firstCaseAssignee(c),
			Metadata: map[string]any{
				"defendant_case_id": d.ID.String(),
				"notification_date": dateDetail(d.NotificationDate),
				"plaintiff_name":    d.PlaintiffName,
			},
		},
	}
}

func firstCaseAssignee(c *model.LegalCase) *uuid.UUID {
	if c == nil {
		return nil
	}
	if c.HandlingOfficerID != nil && *c.HandlingOfficerID != uuid.Nil {
		return c.HandlingOfficerID
	}
	if c.SupervisorID != nil && *c.SupervisorID != uuid.Nil {
		return c.SupervisorID
	}
	if c.SectionManagerID != nil && *c.SectionManagerID != uuid.Nil {
		return c.SectionManagerID
	}
	return nil
}

func ptrTime(value time.Time) *time.Time {
	return &value
}
