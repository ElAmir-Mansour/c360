//go:build integration

package integration

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// TestSLAEscalationLadderMaterialisesBreachAndOrderedEscalation exercises the SLA
// breach/escalation state machine end-to-end against the real schema:
//
//  1. seed a 7-day always-working calendar (deterministic working-day math),
//  2. seed a company -> department -> section org tree with the L1/L2/L3 role
//     bindings so ResolveEscalationRecipients yields a full ladder,
//  3. configure an SLA target and materialise a clock with a deeply-past
//     clock_started_at so every deadline (ack, turnaround, L1/L2/L3) is overdue,
//  4. invoke the due-processing path (SLAService.ProcessDueClocks) and assert the
//     ack-overdue + breach + ordered L1->L2->L3 escalation outbox rows, each with
//     a recipient resolved from the org registry, and
//  5. re-run the due-processing path and prove it is exactly-once (no new rows,
//     clock state unchanged).
//
// The SLA service is driven directly through h.env.app.SLAService rather than over
// HTTP because ProcessDueClocks takes an explicit asOf instant, letting the test
// advance "time" deterministically without mutating the wall clock.
func TestSLAEscalationLadderMaterialisesBreachAndOrderedEscalation(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	seedDefaultWorkingCalendar(ctx, t, h)
	l1User, l2User, l3User, sectionID := seedEscalationOrgTree(ctx, t, h)
	seedSLATarget(ctx, t, h)

	// clock_started_at is 40 days in the past: with a 7-day always-working calendar
	// and a 5-working-day turnaround plus +2/+4/+6 escalation rungs, the latest
	// deadline (L3 = turnaround + 6 = 11 days out) is comfortably overdue relative
	// to "now".
	startedAt := time.Now().UTC().Add(-40 * 24 * time.Hour)
	requesterID := uuid.New()
	requestID := seedLegalRequest(ctx, t, h, requesterID, sectionID)

	clock, err := h.env.app.SLAService.StartClock(ctx, h.tenantID, h.userID, dto.StartSLAClockRequest{
		LegalRequestID:      requestID,
		ServiceCode:         "contract_review",
		Priority:            model.SLATargetPriorityNormal,
		BeneficiaryEntityID: &sectionID,
		StartedAt:           &startedAt,
		Metadata: map[string]any{
			"requester_user_id": requesterID.String(),
			"requester_name":    "Integration Requester",
		},
	})
	if err != nil {
		t.Fatalf("start sla clock: %v", err)
	}
	if clock.Breached {
		t.Fatalf("freshly materialised clock should not be breached: %+v", clock)
	}
	if clock.EscalationLevel != 0 {
		t.Fatalf("freshly materialised clock escalation_level = %d, want 0", clock.EscalationLevel)
	}

	asOf := time.Now().UTC()

	// First pass: ack lapses, turnaround breaches, and every overdue escalation rung
	// advances exactly once.
	first, err := h.env.app.SLAService.ProcessDueClocks(ctx, h.tenantID, asOf, 100)
	if err != nil {
		t.Fatalf("process due clocks (first pass): %v", err)
	}
	if first.AckQueued != 1 {
		t.Fatalf("first pass ack_queued = %d, want 1", first.AckQueued)
	}
	if first.BreachQueued != 1 {
		t.Fatalf("first pass breach_queued = %d, want 1", first.BreachQueued)
	}
	if first.EscalationQueued != 3 {
		t.Fatalf("first pass escalation_queued = %d, want 3 (L1+L2+L3)", first.EscalationQueued)
	}

	// Clock is now terminal-breached at escalation level 3.
	breached, err := h.env.app.SLAService.GetClock(ctx, h.tenantID, clock.ID)
	if err != nil {
		t.Fatalf("reload breached clock: %v", err)
	}
	if !breached.Breached || breached.BreachedAt == nil {
		t.Fatalf("clock should be breached with a breached_at: %+v", breached)
	}
	if breached.Outcome != model.SLAClockOutcomeBreached {
		t.Fatalf("clock outcome = %q, want %q", breached.Outcome, model.SLAClockOutcomeBreached)
	}
	if breached.EscalationLevel != 3 {
		t.Fatalf("clock escalation_level = %d, want 3", breached.EscalationLevel)
	}

	// --- Outbox assertions -------------------------------------------------
	rows := loadSLAOutbox(ctx, t, h, clock.ID)

	// Exactly one ack-overdue row, exactly one breach row.
	assertSingleOutbox(t, rows, "ack_due", 0)
	assertSingleOutbox(t, rows, "breach", 0)

	// Ordered L1 -> L2 -> L3 escalation rows, each addressed to the registry
	// recipient for its rung.
	wantLadder := map[int]uuid.UUID{1: l1User, 2: l2User, 3: l3User}
	wantRole := map[int]model.OrgRoleKey{
		1: model.OrgRoleSectionSupervisor,
		2: model.OrgRoleDepartmentManager,
		3: model.OrgRoleSharedServicesManager,
	}
	var escalationLevels []int
	for _, level := range []int{1, 2, 3} {
		row := assertSingleOutbox(t, rows, "escalation", level)
		escalationLevels = append(escalationLevels, row.escalationLevel)
		if row.recipientUserID == nil {
			t.Fatalf("escalation L%d outbox row has no recipient (org registry resolution failed)", level)
		}
		if *row.recipientUserID != wantLadder[level] {
			t.Fatalf("escalation L%d recipient = %s, want %s (role %s)", level, row.recipientUserID, wantLadder[level], wantRole[level])
		}
	}
	if got := escalationLevels; !(len(got) == 3 && got[0] == 1 && got[1] == 2 && got[2] == 3) {
		t.Fatalf("escalation rows not ordered L1->L2->L3: %v", got)
	}

	totalBefore := len(rows)

	// --- Exactly-once: second pass must be a no-op ------------------------
	second, err := h.env.app.SLAService.ProcessDueClocks(ctx, h.tenantID, asOf, 100)
	if err != nil {
		t.Fatalf("process due clocks (second pass): %v", err)
	}
	if second.AckQueued != 0 || second.BreachQueued != 0 || second.EscalationQueued != 0 {
		t.Fatalf("second pass should enqueue nothing, got ack=%d breach=%d escalation=%d", second.AckQueued, second.BreachQueued, second.EscalationQueued)
	}
	if after := loadSLAOutbox(ctx, t, h, clock.ID); len(after) != totalBefore {
		t.Fatalf("second pass changed outbox row count: before=%d after=%d", totalBefore, len(after))
	}

	reloaded, err := h.env.app.SLAService.GetClock(ctx, h.tenantID, clock.ID)
	if err != nil {
		t.Fatalf("reload clock after second pass: %v", err)
	}
	if reloaded.EscalationLevel != 3 || !reloaded.Breached {
		t.Fatalf("second pass mutated clock: escalation_level=%d breached=%v", reloaded.EscalationLevel, reloaded.Breached)
	}
	if reloaded.BreachedAt == nil || !reloaded.BreachedAt.Equal(*breached.BreachedAt) {
		t.Fatalf("second pass changed breached_at: before=%v after=%v", breached.BreachedAt, reloaded.BreachedAt)
	}
}

// TestSLAConcurrentBreachEscalationIsExactlyOnce fires two simultaneous due-processing
// passes over the same overdue clock and proves the idempotency / row-lock guards
// hold: the breach flag flips exactly once, each escalation rung advances exactly
// once, and the partial-unique outbox dedup index prevents any double-enqueue.
func TestSLAConcurrentBreachEscalationIsExactlyOnce(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	seedDefaultWorkingCalendar(ctx, t, h)
	l1User, l2User, l3User, sectionID := seedEscalationOrgTree(ctx, t, h)
	seedSLATarget(ctx, t, h)

	startedAt := time.Now().UTC().Add(-40 * 24 * time.Hour)
	requesterID := uuid.New()
	requestID := seedLegalRequest(ctx, t, h, requesterID, sectionID)

	clock, err := h.env.app.SLAService.StartClock(ctx, h.tenantID, h.userID, dto.StartSLAClockRequest{
		LegalRequestID:      requestID,
		ServiceCode:         "contract_review",
		Priority:            model.SLATargetPriorityNormal,
		BeneficiaryEntityID: &sectionID,
		StartedAt:           &startedAt,
		Metadata: map[string]any{
			"requester_user_id": requesterID.String(),
		},
	})
	if err != nil {
		t.Fatalf("start sla clock: %v", err)
	}

	asOf := time.Now().UTC()

	// Two goroutines race ProcessDueClocks over the same clock. The combined queued
	// counts across both passes must be exactly the single-pass totals: the
	// breached-guard (WHERE breached = false), the escalation guard
	// (WHERE escalation_level < $level) and the partial-unique outbox index
	// collapse the duplicate work to a single winner per rung.
	const racers = 2
	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		totalAck  int
		totalBrch int
		totalEsc  int
		firstErr  error
	)
	start := make(chan struct{})
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			res, perr := h.env.app.SLAService.ProcessDueClocks(ctx, h.tenantID, asOf, 100)
			mu.Lock()
			defer mu.Unlock()
			if perr != nil && firstErr == nil {
				firstErr = perr
			}
			totalAck += res.AckQueued
			totalBrch += res.BreachQueued
			totalEsc += res.EscalationQueued
		}()
	}
	close(start)
	wg.Wait()

	if firstErr != nil {
		t.Fatalf("concurrent process due clocks: %v", firstErr)
	}
	if totalAck != 1 {
		t.Fatalf("concurrent ack_queued total = %d, want exactly 1 (no double-enqueue)", totalAck)
	}
	if totalBrch != 1 {
		t.Fatalf("concurrent breach_queued total = %d, want exactly 1 (breach guard held)", totalBrch)
	}
	if totalEsc != 3 {
		t.Fatalf("concurrent escalation_queued total = %d, want exactly 3 (each rung advanced once)", totalEsc)
	}

	// The persisted state is the ultimate proof: exactly one ack/breach row and one
	// escalation row per rung survive the race.
	rows := loadSLAOutbox(ctx, t, h, clock.ID)
	assertSingleOutbox(t, rows, "ack_due", 0)
	assertSingleOutbox(t, rows, "breach", 0)
	wantLadder := map[int]uuid.UUID{1: l1User, 2: l2User, 3: l3User}
	for _, level := range []int{1, 2, 3} {
		row := assertSingleOutbox(t, rows, "escalation", level)
		if row.recipientUserID == nil || *row.recipientUserID != wantLadder[level] {
			t.Fatalf("escalation L%d recipient = %v, want %s", level, row.recipientUserID, wantLadder[level])
		}
	}

	final, err := h.env.app.SLAService.GetClock(ctx, h.tenantID, clock.ID)
	if err != nil {
		t.Fatalf("reload clock after race: %v", err)
	}
	if !final.Breached || final.EscalationLevel != 3 {
		t.Fatalf("post-race clock state breached=%v escalation_level=%d, want breached=true level=3", final.Breached, final.EscalationLevel)
	}
}

// --- seeding helpers --------------------------------------------------------

// seedDefaultWorkingCalendar provisions a default calendar that treats all seven
// days as full working days, so AddWorkingDays(n) advances exactly n calendar days
// and every materialised deadline is deterministic.
func seedDefaultWorkingCalendar(ctx context.Context, t *testing.T, h *lexHarness) {
	t.Helper()
	hours := make([]dto.WorkingHoursInput, 0, 7)
	for day := 0; day < 7; day++ {
		hours = append(hours, dto.WorkingHoursInput{
			Profile:      model.CalendarProfileStandard,
			DayOfWeek:    day,
			SegmentIndex: 0,
			StartMinute:  0,
			EndMinute:    24 * 60,
		})
	}
	if _, err := h.env.app.WorkingCalendarService.Create(ctx, h.tenantID, h.userID, dto.CreateWorkingCalendarRequest{
		Name:         "SLA Escalation Test Calendar",
		Timezone:     "Asia/Riyadh",
		IsDefault:    true,
		WorkingHours: hours,
	}); err != nil {
		t.Fatalf("seed default working calendar: %v", err)
	}
}

// seedEscalationOrgTree creates company -> department -> section, binding the
// shared-services manager (L3) on the company, the department manager (L2) on the
// department, and the section supervisor (L1) on the section. Resolving the ladder
// from the section leaf therefore yields all three rungs from the nearest ancestor.
// It returns the L1/L2/L3 user ids and the section (leaf beneficiary) entity id.
func seedEscalationOrgTree(ctx context.Context, t *testing.T, h *lexHarness) (l1User, l2User, l3User, sectionID uuid.UUID) {
	t.Helper()
	l1User = uuid.New()
	l2User = uuid.New()
	l3User = uuid.New()

	company, err := h.env.app.OrgEntityService.Create(ctx, h.tenantID, h.userID, dto.CreateOrgEntityRequest{
		EntityType: model.OrgEntityTypeCompany,
		Code:       "SLA-CO-" + shortID(),
		Name:       forms.LocalizedText{EN: "SLA Co", AR: "شركة"},
		Roles: []dto.OrgRoleRequest{{
			RoleKey: model.OrgRoleSharedServicesManager,
			UserID:  l3User,
			Label:   forms.LocalizedText{EN: "Shared Services Manager"},
		}},
	})
	if err != nil {
		t.Fatalf("seed company org entity: %v", err)
	}

	department, err := h.env.app.OrgEntityService.Create(ctx, h.tenantID, h.userID, dto.CreateOrgEntityRequest{
		ParentID:   &company.ID,
		EntityType: model.OrgEntityTypeDepartment,
		Code:       "SLA-DEP-" + shortID(),
		Name:       forms.LocalizedText{EN: "Legal Department", AR: "الإدارة"},
		Roles: []dto.OrgRoleRequest{{
			RoleKey: model.OrgRoleDepartmentManager,
			UserID:  l2User,
			Label:   forms.LocalizedText{EN: "Department Manager"},
		}},
	})
	if err != nil {
		t.Fatalf("seed department org entity: %v", err)
	}

	section, err := h.env.app.OrgEntityService.Create(ctx, h.tenantID, h.userID, dto.CreateOrgEntityRequest{
		ParentID:   &department.ID,
		EntityType: model.OrgEntityTypeSection,
		Code:       "SLA-SEC-" + shortID(),
		Name:       forms.LocalizedText{EN: "Contracts Section", AR: "القسم"},
		Roles: []dto.OrgRoleRequest{{
			RoleKey: model.OrgRoleSectionSupervisor,
			UserID:  l1User,
			Label:   forms.LocalizedText{EN: "Section Supervisor"},
		}},
	})
	if err != nil {
		t.Fatalf("seed section org entity: %v", err)
	}
	return l1User, l2User, l3User, section.ID
}

// seedSLATarget configures the contract_review/normal SLA policy the clock resolves
// against (the lex_db seed skips targets when no tenants table is present).
func seedSLATarget(ctx context.Context, t *testing.T, h *lexHarness) {
	t.Helper()
	if _, err := h.env.app.SLAService.CreateTarget(ctx, h.tenantID, h.userID, dto.CreateSLATargetRequest{
		ServiceCode:           "contract_review",
		Priority:              model.SLATargetPriorityNormal,
		TurnaroundWorkingDays: 5,
		AckWindowValue:        1,
		AckWindowUnit:         model.SLAAckUnitWorkingDays,
		EscalationL1Days:      model.DefaultSLAEscalationL1WorkingDaysAfterBreach,
		EscalationL2Days:      model.DefaultSLAEscalationL2WorkingDaysAfterBreach,
		EscalationL3Days:      model.DefaultSLAEscalationL3WorkingDaysAfterBreach,
	}); err != nil {
		t.Fatalf("seed sla target: %v", err)
	}
}

// seedLegalRequest creates the canonical request-spine row the SLA clock's FK
// (legal_sla_clocks.legal_request_id -> legal_requests.id) requires.
func seedLegalRequest(ctx context.Context, t *testing.T, h *lexHarness, requesterID, sectionID uuid.UUID) uuid.UUID {
	t.Helper()
	request, err := h.env.app.LegalRequestService.Create(ctx, h.tenantID, h.userID, dto.CreateLegalRequestRequest{
		RequestType:         "contract_review",
		Title:               forms.LocalizedText{EN: "SLA Escalation Request", AR: "طلب"},
		Description:         "Drives the SLA breach/escalation integration test.",
		RequesterUserID:     &requesterID,
		RequesterName:       "Integration Requester",
		BeneficiaryEntityID: &sectionID,
		Priority:            model.RequestPriorityNormal,
	})
	if err != nil {
		t.Fatalf("seed legal request: %v", err)
	}
	return request.ID
}

// --- outbox inspection ------------------------------------------------------

type slaOutboxRow struct {
	id              uuid.UUID
	eventType       string
	escalationLevel int
	status          string
	recipientUserID *uuid.UUID
	recipientName   string
}

// loadSLAOutbox reads every outbox row for a clock straight from the table (the
// integration pool bypasses RLS, mirroring the other lex integration tests' direct
// reads), ordered by event_type then escalation_level for stable assertions.
func loadSLAOutbox(ctx context.Context, t *testing.T, h *lexHarness, clockID uuid.UUID) []slaOutboxRow {
	t.Helper()
	dbRows, err := h.env.db.Query(ctx, `
		SELECT id, event_type, escalation_level, status, recipient_user_id, recipient_name
		FROM legal_sla_notification_outbox
		WHERE tenant_id = $1 AND sla_clock_id = $2
		ORDER BY event_type, escalation_level`,
		h.tenantID, clockID,
	)
	if err != nil {
		t.Fatalf("load sla outbox: %v", err)
	}
	defer dbRows.Close()

	var rows []slaOutboxRow
	for dbRows.Next() {
		var row slaOutboxRow
		if err := dbRows.Scan(&row.id, &row.eventType, &row.escalationLevel, &row.status, &row.recipientUserID, &row.recipientName); err != nil {
			t.Fatalf("scan sla outbox row: %v", err)
		}
		rows = append(rows, row)
	}
	if err := dbRows.Err(); err != nil {
		t.Fatalf("iterate sla outbox rows: %v", err)
	}
	return rows
}

// assertSingleOutbox asserts exactly one outbox row exists for the (event_type,
// escalation_level) pair and returns it.
func assertSingleOutbox(t *testing.T, rows []slaOutboxRow, eventType string, level int) slaOutboxRow {
	t.Helper()
	var matches []slaOutboxRow
	for _, row := range rows {
		if row.eventType == eventType && row.escalationLevel == level {
			matches = append(matches, row)
		}
	}
	if len(matches) != 1 {
		t.Fatalf("outbox rows for (%s, L%d) = %d, want exactly 1 (rows=%+v)", eventType, level, len(matches), rows)
	}
	return matches[0]
}

func shortID() string {
	return uuid.New().String()[:8]
}
