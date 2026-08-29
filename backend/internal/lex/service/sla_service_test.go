package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestSLAMaterialiseDeadlinesUsesWorkingCalendarAndBreachRelativeEscalation(t *testing.T) {
	loc := slaTestLocation(t)
	calc := slaTestCalculator(loc)
	startedAt := time.Date(2026, time.June, 21, 16, 0, 0, 0, loc) // Sunday.
	target := &model.SLATarget{
		Priority:              model.SLATargetPriorityUrgent,
		TurnaroundWorkingDays: 2,
		AckWindowValue:        model.DefaultSLAAckUrgentWorkingHours,
		AckWindowUnit:         model.SLAAckUnitWorkingHours,
		EscalationL1Days:      model.DefaultSLAEscalationL1WorkingDaysAfterBreach,
		EscalationL2Days:      model.DefaultSLAEscalationL2WorkingDaysAfterBreach,
		EscalationL3Days:      model.DefaultSLAEscalationL3WorkingDaysAfterBreach,
	}

	deadlines := materialiseSLADeadlines(calc, startedAt, target)

	requireSameInstant(t, deadlines.AckDueAt, time.Date(2026, time.June, 22, 12, 0, 0, 0, loc))
	requireSameInstant(t, deadlines.TurnaroundDueAt, time.Date(2026, time.June, 23, 16, 0, 0, 0, loc))
	requireSameInstant(t, deadlines.L1DueAt, time.Date(2026, time.June, 25, 16, 0, 0, 0, loc))
	requireSameInstant(t, deadlines.L2DueAt, time.Date(2026, time.June, 29, 16, 0, 0, 0, loc))
	requireSameInstant(t, deadlines.L3DueAt, time.Date(2026, time.July, 1, 16, 0, 0, 0, loc))
}

func TestSLAMaterialiseDeadlinesSetsFromLowerBoundBeforeDeadline(t *testing.T) {
	loc := slaTestLocation(t)
	calc := slaTestCalculator(loc)
	startedAt := time.Date(2026, time.June, 21, 16, 0, 0, 0, loc) // Sunday.
	target := &model.SLATarget{
		Priority:                  model.SLATargetPriorityNormal,
		TurnaroundWorkingDaysFrom: 4,
		TurnaroundWorkingDays:     6,
		AckWindowValue:            model.DefaultSLAAckNormalWorkingDays,
		AckWindowUnit:             model.SLAAckUnitWorkingDays,
		EscalationL1Days:          model.DefaultSLAEscalationL1WorkingDaysAfterBreach,
		EscalationL2Days:          model.DefaultSLAEscalationL2WorkingDaysAfterBreach,
		EscalationL3Days:          model.DefaultSLAEscalationL3WorkingDaysAfterBreach,
	}

	deadlines := materialiseSLADeadlines(calc, startedAt, target)

	// From (lower bound) resolves to 4 working days; To (deadline) to 6 working
	// days — Fri/Sat are non-working, so from lands Thu 25th and to Mon 29th.
	requireSameInstant(t, deadlines.TurnaroundFromDueAt, time.Date(2026, time.June, 25, 16, 0, 0, 0, loc))
	requireSameInstant(t, deadlines.TurnaroundDueAt, time.Date(2026, time.June, 29, 16, 0, 0, 0, loc))
	if !deadlines.TurnaroundFromDueAt.Before(deadlines.TurnaroundDueAt) {
		t.Fatalf("from %s must precede to %s", deadlines.TurnaroundFromDueAt, deadlines.TurnaroundDueAt)
	}
}

func TestSLAMaterialiseDeadlinesFromDefaultsToDeadlineWhenUnset(t *testing.T) {
	loc := slaTestLocation(t)
	calc := slaTestCalculator(loc)
	startedAt := time.Date(2026, time.June, 21, 16, 0, 0, 0, loc)
	target := &model.SLATarget{
		Priority:              model.SLATargetPriorityNormal,
		TurnaroundWorkingDays: 6,
		// TurnaroundWorkingDaysFrom omitted (0) → single-figure window (from == to).
		AckWindowValue:   model.DefaultSLAAckNormalWorkingDays,
		AckWindowUnit:    model.SLAAckUnitWorkingDays,
		EscalationL1Days: model.DefaultSLAEscalationL1WorkingDaysAfterBreach,
		EscalationL2Days: model.DefaultSLAEscalationL2WorkingDaysAfterBreach,
		EscalationL3Days: model.DefaultSLAEscalationL3WorkingDaysAfterBreach,
	}

	deadlines := materialiseSLADeadlines(calc, startedAt, target)

	requireSameInstant(t, deadlines.TurnaroundFromDueAt, deadlines.TurnaroundDueAt)
}

func TestSLATurnaroundFromValidation(t *testing.T) {
	if err := validateSLATurnaroundFrom(4, 6); err != nil {
		t.Fatalf("from 4 <= to 6 must be valid, got %v", err)
	}
	if err := validateSLATurnaroundFrom(6, 6); err != nil {
		t.Fatalf("from == to must be valid, got %v", err)
	}
	requireAppField(t, validateSLATurnaroundFrom(-1, 6), "turnaround_working_days_from", "out_of_range")
	requireAppField(t, validateSLATurnaroundFrom(7, 6), "turnaround_working_days_from", "greater_than_to")
}

func TestSLACreateNormalizeDefaultsFromToDeadline(t *testing.T) {
	req := dto.CreateSLATargetRequest{
		ServiceCode:           "contract_review",
		Priority:              model.SLATargetPriorityNormal,
		TurnaroundWorkingDays: 5,
	}
	req.Normalize()
	if req.TurnaroundWorkingDaysFrom != 5 {
		t.Fatalf("omitted from = %d, want defaulted to 5", req.TurnaroundWorkingDaysFrom)
	}
	if err := validateSLATargetCreate(req); err != nil {
		t.Fatalf("validate defaulted-from create: %v", err)
	}

	windowed := dto.CreateSLATargetRequest{
		ServiceCode:               "contract_review",
		Priority:                  model.SLATargetPriorityNormal,
		TurnaroundWorkingDaysFrom: 3,
		TurnaroundWorkingDays:     5,
	}
	windowed.Normalize()
	if windowed.TurnaroundWorkingDaysFrom != 3 {
		t.Fatalf("explicit from = %d, want preserved 3", windowed.TurnaroundWorkingDaysFrom)
	}
	if err := validateSLATargetCreate(windowed); err != nil {
		t.Fatalf("validate windowed create: %v", err)
	}
}

func TestSLANormalAckDeadlineUsesOneWorkingDayDefault(t *testing.T) {
	loc := slaTestLocation(t)
	calc := slaTestCalculator(loc)
	startedAt := time.Date(2026, time.June, 18, 16, 0, 0, 0, loc) // Thursday.
	target := &model.SLATarget{
		Priority:              model.SLATargetPriorityNormal,
		TurnaroundWorkingDays: 1,
		AckWindowValue:        model.DefaultSLAAckNormalWorkingDays,
		AckWindowUnit:         model.SLAAckUnitWorkingDays,
		EscalationL1Days:      model.DefaultSLAEscalationL1WorkingDaysAfterBreach,
		EscalationL2Days:      model.DefaultSLAEscalationL2WorkingDaysAfterBreach,
		EscalationL3Days:      model.DefaultSLAEscalationL3WorkingDaysAfterBreach,
	}

	deadlines := materialiseSLADeadlines(calc, startedAt, target)

	requireSameInstant(t, deadlines.AckDueAt, time.Date(2026, time.June, 21, 16, 0, 0, 0, loc))
}

func TestSLATargetDefaultsAndValidation(t *testing.T) {
	urgent := dto.CreateSLATargetRequest{
		ServiceCode:           " contract_review ",
		Priority:              model.SLATargetPriority("URGENT"),
		TurnaroundWorkingDays: 3,
	}
	urgent.Normalize()
	if urgent.ServiceCode != "contract_review" {
		t.Fatalf("ServiceCode = %q, want trimmed contract_review", urgent.ServiceCode)
	}
	if urgent.Priority != model.SLATargetPriorityUrgent ||
		urgent.AckWindowUnit != model.SLAAckUnitWorkingHours ||
		urgent.AckWindowValue != model.DefaultSLAAckUrgentWorkingHours {
		t.Fatalf("urgent ack defaults = priority %s value %d unit %s", urgent.Priority, urgent.AckWindowValue, urgent.AckWindowUnit)
	}
	if urgent.EscalationL1Days != 2 || urgent.EscalationL2Days != 4 || urgent.EscalationL3Days != 6 {
		t.Fatalf("urgent escalation defaults = %d/%d/%d, want 2/4/6", urgent.EscalationL1Days, urgent.EscalationL2Days, urgent.EscalationL3Days)
	}
	if err := validateSLATargetCreate(urgent); err != nil {
		t.Fatalf("validate urgent defaults error = %v", err)
	}

	normal := dto.CreateSLATargetRequest{
		ServiceCode:           "legal_opinion",
		Priority:              model.SLATargetPriorityNormal,
		TurnaroundWorkingDays: 7,
	}
	normal.Normalize()
	if normal.AckWindowUnit != model.SLAAckUnitWorkingDays || normal.AckWindowValue != model.DefaultSLAAckNormalWorkingDays {
		t.Fatalf("normal ack defaults = value %d unit %s", normal.AckWindowValue, normal.AckWindowUnit)
	}
	if err := validateSLATargetCreate(normal); err != nil {
		t.Fatalf("validate normal defaults error = %v", err)
	}

	immediateUrgent := dto.CreateSLATargetRequest{
		ServiceCode:           "legal_consultation",
		Priority:              model.SLATargetPriorityUrgent,
		TurnaroundWorkingDays: 4,
		AckWindowValue:        0,
		AckWindowUnit:         model.SLAAckUnitWorkingHours,
		EscalationL1Days:      2,
		EscalationL2Days:      4,
		EscalationL3Days:      6,
	}
	immediateUrgent.Normalize()
	if immediateUrgent.AckWindowValue != 0 {
		t.Fatalf("explicit urgent ack 0 defaulted to %d", immediateUrgent.AckWindowValue)
	}
	if err := validateSLATargetCreate(immediateUrgent); err != nil {
		t.Fatalf("validate immediate urgent error = %v", err)
	}
}

func TestSLATargetSeedMigrationCoversDefaultServiceCodes(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "lex_db", "000089_othaim_prd_catalog_alignment.up.sql"))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	sql := string(raw)
	for _, serviceCode := range model.DefaultLegalServiceCodes {
		if !strings.Contains(sql, "'"+serviceCode+"'") {
			t.Fatalf("aligned SLA seed does not contain %s", serviceCode)
		}
	}
}

func TestSLATargetValidationRejectsPolicyDrift(t *testing.T) {
	tests := []struct {
		name  string
		req   dto.CreateSLATargetRequest
		field string
		code  string
	}{
		{
			name: "urgent wrong unit",
			req: dto.CreateSLATargetRequest{
				ServiceCode:           "contract_review",
				Priority:              model.SLATargetPriorityUrgent,
				TurnaroundWorkingDays: 3,
				AckWindowValue:        1,
				AckWindowUnit:         model.SLAAckUnitWorkingDays,
				EscalationL1Days:      2,
				EscalationL2Days:      4,
				EscalationL3Days:      6,
			},
			field: "ack_window_unit",
			code:  "must_be_working_hours_for_urgent",
		},
		{
			name: "urgent too long",
			req: dto.CreateSLATargetRequest{
				ServiceCode:           "contract_review",
				Priority:              model.SLATargetPriorityUrgent,
				TurnaroundWorkingDays: 3,
				AckWindowValue:        5,
				AckWindowUnit:         model.SLAAckUnitWorkingHours,
				EscalationL1Days:      2,
				EscalationL2Days:      4,
				EscalationL3Days:      6,
			},
			field: "ack_window_value",
			code:  "out_of_range_for_urgent",
		},
		{
			name: "normal wrong unit",
			req: dto.CreateSLATargetRequest{
				ServiceCode:           "legal_opinion",
				Priority:              model.SLATargetPriorityNormal,
				TurnaroundWorkingDays: 7,
				AckWindowValue:        1,
				AckWindowUnit:         model.SLAAckUnitWorkingHours,
				EscalationL1Days:      2,
				EscalationL2Days:      4,
				EscalationL3Days:      6,
			},
			field: "ack_window_unit",
			code:  "must_be_working_days_for_normal",
		},
		{
			name: "normal too long",
			req: dto.CreateSLATargetRequest{
				ServiceCode:           "legal_opinion",
				Priority:              model.SLATargetPriorityNormal,
				TurnaroundWorkingDays: 7,
				AckWindowValue:        2,
				AckWindowUnit:         model.SLAAckUnitWorkingDays,
				EscalationL1Days:      2,
				EscalationL2Days:      4,
				EscalationL3Days:      6,
			},
			field: "ack_window_value",
			code:  "out_of_range_for_normal",
		},
		{
			name: "escalation not fixed",
			req: dto.CreateSLATargetRequest{
				ServiceCode:           "legal_opinion",
				Priority:              model.SLATargetPriorityNormal,
				TurnaroundWorkingDays: 7,
				AckWindowValue:        1,
				AckWindowUnit:         model.SLAAckUnitWorkingDays,
				EscalationL1Days:      3,
				EscalationL2Days:      4,
				EscalationL3Days:      6,
			},
			field: "escalation_l1_days",
			code:  "fixed_2_4_6_after_breach",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.req.Normalize()
			requireAppField(t, validateSLATargetCreate(tt.req), tt.field, tt.code)
		})
	}
}

func TestSLAOutboxItemUsesEscalationRecipientForLevel(t *testing.T) {
	tenantID := uuid.New()
	clockID := uuid.New()
	requestID := uuid.New()
	recipientUserID := uuid.New()
	actorID := uuid.New()
	now := time.Date(2026, time.June, 24, 9, 0, 0, 0, time.UTC)

	item := slaOutboxItem(model.SLAClock{
		ID:             clockID,
		TenantID:       tenantID,
		LegalRequestID: requestID,
	}, model.SLANotificationEscalation, 2, &model.EscalationLadder{
		Recipients: []model.EscalationRecipient{
			{
				Level:  2,
				UserID: recipientUserID,
				Label:  forms.LocalizedText{EN: "Department manager"},
			},
		},
	}, actorID, now)

	if item.RecipientUserID == nil || *item.RecipientUserID != recipientUserID {
		t.Fatalf("recipient user = %v, want %s", item.RecipientUserID, recipientUserID)
	}
	if item.RecipientName != "Department manager" {
		t.Fatalf("recipient name = %q, want Department manager", item.RecipientName)
	}
	if item.EventType != model.SLANotificationEscalation || item.EscalationLevel != 2 {
		t.Fatalf("event = %s/%d, want escalation/2", item.EventType, item.EscalationLevel)
	}
	if item.CreatedBy != actorID || !item.ScheduledAt.Equal(now) {
		t.Fatalf("actor/scheduled = %s/%s, want %s/%s", item.CreatedBy, item.ScheduledAt, actorID, now)
	}
}

func TestSLAEscalationEventPayloadIncludesRecipientForLevel(t *testing.T) {
	clockID := uuid.New()
	requestID := uuid.New()
	recipientUserID := uuid.New()

	payload := slaEscalationEventPayload(model.SLAClock{
		ID:             clockID,
		LegalRequestID: requestID,
	}, 3, true, "manual escalation", &model.EscalationLadder{
		Recipients: []model.EscalationRecipient{
			{
				Level:   2,
				RoleKey: model.OrgRoleDepartmentManager,
				UserID:  uuid.New(),
				Label:   forms.LocalizedText{EN: "Department manager"},
			},
			{
				Level:   3,
				RoleKey: model.OrgRoleSharedServicesManager,
				UserID:  recipientUserID,
				Label:   forms.LocalizedText{EN: "Shared services manager"},
			},
		},
	})

	if payload["id"] != clockID || payload["legal_request_id"] != requestID {
		t.Fatalf("ids = %v/%v, want %s/%s", payload["id"], payload["legal_request_id"], clockID, requestID)
	}
	if payload["escalation_level"] != 3 || payload["manual"] != true || payload["note"] != "manual escalation" {
		t.Fatalf("escalation fields = %#v", payload)
	}
	if payload["recipient_user_id"] != recipientUserID.String() {
		t.Fatalf("recipient_user_id = %v, want %s", payload["recipient_user_id"], recipientUserID)
	}
	if payload["recipient_name"] != "Shared services manager" {
		t.Fatalf("recipient_name = %v, want Shared services manager", payload["recipient_name"])
	}
	if payload["recipient_role"] != string(model.OrgRoleSharedServicesManager) {
		t.Fatalf("recipient_role = %v, want %s", payload["recipient_role"], model.OrgRoleSharedServicesManager)
	}
}

func slaTestLocation(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Riyadh")
	if err != nil {
		t.Fatalf("load Asia/Riyadh: %v", err)
	}
	return loc
}

func slaTestCalculator(loc *time.Location) calendar.Calculator {
	day := []calendar.WorkingSegment{{Start: 9 * 60, End: 17 * 60}}
	return calendar.NewCalculator(calendar.WorkingCalendarSnapshot{
		Location: loc,
		Standard: map[time.Weekday][]calendar.WorkingSegment{
			time.Sunday:    day,
			time.Monday:    day,
			time.Tuesday:   day,
			time.Wednesday: day,
			time.Thursday:  day,
		},
	})
}

func requireSameInstant(t *testing.T, got, want time.Time) {
	t.Helper()
	if !got.Equal(want) {
		t.Fatalf("time = %s, want %s", got, want)
	}
}
