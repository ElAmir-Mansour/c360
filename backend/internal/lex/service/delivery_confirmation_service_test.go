package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/calendar"
	"github.com/clario360/platform/internal/lex/model"
)

func TestDeliveryConfirmationAutoCloseAtUsesWorkingCalendar(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Riyadh")
	if err != nil {
		t.Fatalf("load Asia/Riyadh: %v", err)
	}
	day := []calendar.WorkingSegment{{Start: 9 * 60, End: 17 * 60}}
	calc := calendar.NewCalculator(calendar.WorkingCalendarSnapshot{
		Location: loc,
		Standard: map[time.Weekday][]calendar.WorkingSegment{
			time.Sunday:    day,
			time.Monday:    day,
			time.Tuesday:   day,
			time.Wednesday: day,
			time.Thursday:  day,
		},
	})

	requestedAt := time.Date(2026, 6, 23, 16, 0, 0, 0, loc) // Tuesday.
	got := deliveryConfirmationAutoCloseAt(calc, requestedAt)
	want := time.Date(2026, 6, 28, 16, 0, 0, 0, loc).UTC() // skips Fri/Sat.
	if !got.Equal(want) {
		t.Fatalf("deliveryConfirmationAutoCloseAt() = %s, want %s", got, want)
	}
}

func TestApplyDeliveryConfirmationResolutionUpdatesExecutionState(t *testing.T) {
	now := time.Date(2026, 6, 24, 12, 0, 0, 0, time.UTC)
	clockStarted := now.Add(-2 * time.Hour)
	completeness := clockStarted
	deliveredAt := now.Add(-time.Hour)

	confirmed := &model.ExecutionState{
		Status:                model.ExecutionStatusDelivered,
		ClockStartedAt:        &clockStarted,
		CompletenessConfirmed: &completeness,
		DeliveredAt:           &deliveredAt,
	}
	applyDeliveryConfirmationResolution(confirmed, model.DeliveryConfirmationStatusConfirmed, now)
	if confirmed.Status != model.ExecutionStatusClosed || confirmed.ClosedAt == nil || !confirmed.ClosedAt.Equal(now) {
		t.Fatalf("confirmed resolution state = %+v, want closed at now", confirmed)
	}

	denied := &model.ExecutionState{
		Status:                model.ExecutionStatusDelivered,
		ClockStartedAt:        &clockStarted,
		CompletenessConfirmed: &completeness,
		DeliveredAt:           &deliveredAt,
		ClosedAt:              &now,
	}
	applyDeliveryConfirmationResolution(denied, model.DeliveryConfirmationStatusDenied, now)
	if denied.Status != model.ExecutionStatusReturned {
		t.Fatalf("denied status = %q, want returned", denied.Status)
	}
	if denied.ClockStartedAt != nil || denied.CompletenessConfirmed != nil || denied.DeliveredAt != nil || denied.ClosedAt != nil {
		t.Fatalf("denied resolution did not reopen execution gate: %+v", denied)
	}

	expired := &model.ExecutionState{Status: model.ExecutionStatusDelivered}
	applyDeliveryConfirmationResolution(expired, model.DeliveryConfirmationStatusExpired, now)
	if expired.Status != model.ExecutionStatusClosed || expired.ClosedAt == nil || !expired.ClosedAt.Equal(now) {
		t.Fatalf("expired resolution state = %+v, want closed at now", expired)
	}

	achieved := &model.ExecutionState{Status: model.ExecutionStatusDelivered, DeliveredAt: &deliveredAt}
	applyDeliveryConfirmationResolution(achieved, model.DeliveryConfirmationStatusAchieved, now)
	if achieved.Status != model.ExecutionStatusDelivered || achieved.ClosedAt != nil {
		t.Fatalf("achieved resolution state = %+v, want delivered and still open", achieved)
	}
}

func TestIsContractDeliveryRequestUsesSubjectAndRequestType(t *testing.T) {
	contractSubject := "contract"
	tests := []struct {
		name    string
		request *model.LegalRequest
		want    bool
	}{
		{name: "linked contract", request: &model.LegalRequest{ID: uuid.New(), SubjectType: &contractSubject}, want: true},
		{name: "contract review intake", request: &model.LegalRequest{ID: uuid.New(), RequestType: "contract_review"}, want: true},
		{name: "arabic contract intake", request: &model.LegalRequest{ID: uuid.New(), RequestType: "مراجعة عقد"}, want: true},
		{name: "consultation", request: &model.LegalRequest{ID: uuid.New(), RequestType: "legal_consultation"}, want: false},
		{name: "nil", request: nil, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isContractDeliveryRequest(tt.request); got != tt.want {
				t.Fatalf("isContractDeliveryRequest() = %v, want %v", got, tt.want)
			}
		})
	}
}
