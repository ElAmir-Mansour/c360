package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	pgxmock "github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/lex/model"
)

func TestSupportVisibilityIsPartyOnlyWithoutOverseeAndSubtreeWithOversee(t *testing.T) {
	actorID := uuid.New()
	party, args := supportVisibilitySQL(actorID, false, 2)
	if len(args) != 1 || args[0] != actorID || strings.Contains(party, "legal_org_memberships") {
		t.Fatalf("unprivileged visibility = %q args=%v, want party-only", party, args)
	}
	if !strings.Contains(party, "requester_id = $2") || !strings.Contains(party, "assignee_id = $2") {
		t.Fatalf("party visibility = %q", party)
	}
	oversee, _ := supportVisibilitySQL(actorID, true, 3)
	for _, required := range []string{"legal_org_memberships", "om.user_id = $3", "om.entity_id::text = ANY(candidate.path)", "om.tenant_id = sr.tenant_id"} {
		if !strings.Contains(oversee, required) {
			t.Fatalf("oversee visibility missing %q: %s", required, oversee)
		}
	}
}

// The manager-approval gate is only real if the colleague cannot see the request
// before it is approved. Both the assignee branch and the overseer subtree
// branch must sit behind the routed guard: the assignee is normally a member of
// the target entity, so an ungated subtree branch would hand the unapproved
// request straight back to the person it was withheld from.
func TestSupportVisibilityHidesPendingApprovalFromTheColleagueAndOverseer(t *testing.T) {
	actorID := uuid.New()
	for _, tc := range []struct {
		name    string
		oversee bool
		arg     int
	}{
		{name: "colleague", oversee: false, arg: 2},
		{name: "colleague with oversee", oversee: true, arg: 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			where, _ := supportVisibilitySQL(actorID, tc.oversee, tc.arg)
			assignee := fmt.Sprintf("sr.assignee_id = $%d", tc.arg)
			idx := strings.Index(where, assignee)
			if idx < 0 {
				t.Fatalf("assignee branch missing: %s", where)
			}
			guard := strings.Index(where, supportAssigneeRoutedSQL)
			if guard < 0 || guard > idx {
				t.Fatalf("assignee branch is not gated on the approval status: %s", where)
			}
			if strings.Count(where, supportAssigneeRoutedSQL) != 1 {
				t.Fatalf("the routed guard must gate every non-approval branch exactly once: %s", where)
			}
			// The requester and the frozen approver are the only parties that
			// see a request behind the gate.
			for _, required := range []string{
				fmt.Sprintf("sr.requester_id = $%d", tc.arg),
				fmt.Sprintf("sr.approver_user_id = $%d", tc.arg),
			} {
				if !strings.Contains(where, required) {
					t.Fatalf("approval party %q missing: %s", required, where)
				}
			}
			if tc.oversee {
				subtree := strings.Index(where, "legal_org_memberships")
				if subtree < guard {
					t.Fatalf("overseer subtree must also sit behind the routed guard: %s", where)
				}
			}
		})
	}
}

// A status filter supplied by the caller must not be able to re-admit an
// unapproved request into the colleague's inbox.
func TestSupportInboxExcludesPendingApprovalEvenWhenExplicitlyFilteredFor(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	tenantID, actorID := uuid.New(), uuid.New()
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM lex_support_requests sr.*sr\.assignee_id = \$2.*sr\.status <> 'pending_manager_approval'.*sr\.status = ANY\(\$3\)`).
		WithArgs(tenantID, actorID, []string{"pending_manager_approval"}).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))
	items, total, err := supportRequestListWith(context.Background(), mock, tenantID, actorID, false, model.SupportRequestListFilters{
		Box:      model.SupportBoxInbox,
		Statuses: []model.SupportRequestStatus{model.SupportStatusPendingManagerApproval},
	})
	if err != nil || total != 0 || len(items) != 0 {
		t.Fatalf("colleague inbox = items:%v total:%d err:%v, want empty", items, total, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSupportApprovalsBoxScopesToTheFrozenApprover(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	tenantID, approverID := uuid.New(), uuid.New()
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM lex_support_requests sr.*sr\.approver_user_id = \$2.*sr\.status IN \('pending_manager_approval','open','accepted'\)`).
		WithArgs(tenantID, approverID).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))
	if _, _, err := supportRequestListWith(context.Background(), mock, tenantID, approverID, false, model.SupportRequestListFilters{Box: model.SupportBoxApprovals}); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSupportApproverResolutionPrefersTheManagerEdge(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	tenantID, requesterID, managerID, entityID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	mock.ExpectQuery(`(?s)SELECT m\.manager_user_id.*m\.manager_user_id IS NOT NULL.*ORDER BY COALESCE\(cardinality\(e\.path\), 0\) DESC`).
		WithArgs(tenantID, requesterID).
		WillReturnRows(pgxmock.NewRows([]string{"manager_user_id"}).AddRow(managerID))
	got, err := resolveSupportApproverWith(context.Background(), mock, tenantID, requesterID, &entityID)
	if err != nil || got == nil || got.UserID != managerID || got.Route != model.SupportRouteManager {
		t.Fatalf("approver = %+v, err=%v, want manager %s", got, err, managerID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSupportApproverResolutionWalksUpToTheUnitHeadThenGivesUp(t *testing.T) {
	tenantID, requesterID, headID, entityID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	for _, tc := range []struct {
		name      string
		entityID  *uuid.UUID
		headRows  *pgxmock.Rows
		wantUser  *uuid.UUID
		wantRoute model.SupportApprovalRoute
	}{
		{
			name:     "nearest department_manager or legal_director up the tree",
			entityID: &entityID, wantUser: &headID, wantRoute: model.SupportRouteUnitHead,
			headRows: pgxmock.NewRows([]string{"user_id"}).AddRow(headID),
		},
		{
			// The 3-in-19 case: no manager edge and no unit head anywhere above.
			// Resolution returns nothing rather than pretending; the caller
			// auto-approves instead of stranding the requester.
			name:     "nobody above the requester at all",
			entityID: &entityID, wantUser: nil, wantRoute: "",
			headRows: pgxmock.NewRows([]string{"user_id"}),
		},
		{
			name:     "requester has no active unit, so there is no tree to walk",
			entityID: nil, wantUser: nil, wantRoute: "",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mock, err := pgxmock.NewPool()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(mock.Close)
			mock.ExpectQuery(`(?s)SELECT m\.manager_user_id`).
				WithArgs(tenantID, requesterID).
				WillReturnRows(pgxmock.NewRows([]string{"manager_user_id"}))
			if tc.entityID != nil {
				mock.ExpectQuery(`(?s)WITH RECURSIVE chain AS.*JOIN legal_org_entities p.*p\.id = c\.parent_id.*role_key IN \('department_manager', 'legal_director'\).*ORDER BY c\.depth ASC`).
					WithArgs(tenantID, *tc.entityID).
					WillReturnRows(tc.headRows)
			}
			got, err := resolveSupportApproverWith(context.Background(), mock, tenantID, requesterID, tc.entityID)
			if err != nil {
				t.Fatal(err)
			}
			if tc.wantUser == nil {
				if got != nil {
					t.Fatalf("approver = %+v, want none", got)
				}
			} else if got == nil || got.UserID != *tc.wantUser || got.Route != tc.wantRoute {
				t.Fatalf("approver = %+v, want %s via %s", got, *tc.wantUser, tc.wantRoute)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// The approver is frozen at creation. If UpdateState could write it, an approval
// or a later transition could silently reassign an in-flight request behind an
// org-chart edit.
func TestSupportUpdateStateNeverRewritesTheFrozenApprover(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	tenantID, id, now := uuid.New(), uuid.New(), time.Date(2026, 8, 10, 6, 30, 0, 0, time.UTC)
	approverID := uuid.New()
	mock.ExpectQuery(`(?s)UPDATE lex_support_requests.*SET status = \$3.*expires_at = \$7, approval_decided_at = \$8,\s*approval_note = \$9`).
		WithArgs(tenantID, id, model.SupportStatusOpen, "", (*time.Time)(nil), (*time.Time)(nil), &now, &now, "ok").
		WillReturnRows(pgxmock.NewRows([]string{"updated_at"}).AddRow(now))
	repo := &SupportRequestRepository{}
	item := &model.SupportRequest{
		TenantID: tenantID, ID: id, Status: model.SupportStatusOpen, ExpiresAt: &now,
		ApprovalDecidedAt: &now, ApprovalNote: "ok",
		ApproverUserID: &approverID, ApprovalRoute: model.SupportRouteManager,
	}
	if err := repo.UpdateState(context.Background(), mock, item); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSupportReadProjectionHasOneEntityTypePerJoinedEntity(t *testing.T) {
	query := supportRequestJSONSelect("sr.tenant_id = $1 AND sr.id = $2")
	if got := strings.Count(query, "'entity_type', re.entity_type"); got != 1 {
		t.Fatalf("requester entity_type projection count = %d, want 1\n%s", got, query)
	}
	if got := strings.Count(query, "'entity_type', te.entity_type"); got != 1 {
		t.Fatalf("target entity_type projection count = %d, want 1\n%s", got, query)
	}
	if !strings.Contains(query, "re.tenant_id = sr.tenant_id") || !strings.Contains(query, "te.tenant_id = sr.tenant_id") {
		t.Fatalf("entity joins must preserve tenant identity: %s", query)
	}
}

func TestSupportListAllIsPartyOnlyForNonOverseer(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	tenantID, actorID := uuid.New(), uuid.New()
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM lex_support_requests sr.*sr\.tenant_id = \$1.*sr\.requester_id = \$2 OR sr\.approver_user_id = \$2 OR \(sr\.status <> 'pending_manager_approval' AND sr\.assignee_id = \$2\).*sr\.status IN \('pending_manager_approval','open','accepted'\)`).
		WithArgs(tenantID, actorID).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(0))
	items, total, err := supportRequestListWith(context.Background(), mock, tenantID, actorID, false, model.SupportRequestListFilters{Box: model.SupportBoxAll})
	if err != nil || total != 0 || len(items) != 0 {
		t.Fatalf("party-only box=all = items:%v total:%d err:%v", items, total, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSupportRequesterEntityChoosesDeepestMembershipDeterministically(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	tenantID, userID, deepestID := uuid.New(), uuid.New(), uuid.New()
	mock.ExpectQuery(`(?s)FROM legal_org_memberships m.*m\.tenant_id = \$1 AND m\.user_id = \$2.*m\.active = true.*e\.active = true.*ORDER BY COALESCE\(cardinality\(e\.path\), 0\) DESC, e\.id ASC.*LIMIT 1`).
		WithArgs(tenantID, userID).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(deepestID))
	got, err := supportRequesterEntityWith(context.Background(), mock, tenantID, userID)
	if err != nil || got == nil || *got != deepestID {
		t.Fatalf("requester entity = %v, %v", got, err)
	}
}

func TestSupportDirectoryIncludesAnyActiveEntityWithActiveMembers(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	tenantID := uuid.New()
	mock.ExpectQuery(`(?s)FROM legal_org_entities e.*e\.tenant_id = \$1 AND e\.active = true.*EXISTS.*FROM legal_org_memberships m.*m\.entity_id = e\.id.*m\.active = true`).
		WithArgs(tenantID).
		WillReturnRows(pgxmock.NewRows([]string{"row_to_json"}))
	got, err := supportDirectoryEntitiesWith(context.Background(), mock, tenantID)
	if err != nil || len(got) != 0 {
		t.Fatalf("directory = %v, %v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	query := supportDirectoryEntitySQL()
	if strings.Contains(query, "entity_type =") {
		t.Fatalf("directory must not hard-code department entity type: %s", query)
	}
}

func TestSupportListTenantIDsUsesSharedDueBoundary(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	now, tenantID := time.Date(2026, 8, 3, 9, 0, 0, 0, time.UTC), uuid.New()
	mock.ExpectQuery(`(?s)SELECT DISTINCT tenant_id.*status IN \('open','accepted'\).*expires_at <= \$1.*deleted_at IS NULL`).
		WithArgs(now).
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id"}).AddRow(tenantID))
	got, err := listSupportTenantIDsWith(context.Background(), mock, now)
	if err != nil || len(got) != 1 || got[0] != tenantID {
		t.Fatalf("tenant IDs = %v, %v", got, err)
	}
}

func TestSupportExpireDueIsBoundedAtomicAndIncludesAcceptedAtBoundary(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(mock.Close)
	tenantID, supportID := uuid.New(), uuid.New()
	now := time.Date(2026, 8, 3, 9, 0, 0, 0, time.UTC)
	want := model.SupportRequest{
		ID: supportID, TenantID: tenantID, RequesterID: uuid.New(), TargetEntityID: uuid.New(),
		AssigneeID: uuid.New(), Subject: "Help", Priority: model.SupportPriorityNormal,
		Status: model.SupportStatusExpired, ClosedAt: &now, CreatedAt: now.Add(-time.Hour), UpdatedAt: now,
	}
	raw, _ := json.Marshal(want)
	mock.ExpectQuery(`(?s)WITH due AS.*status IN \('open','accepted'\).*expires_at <= \$2.*LIMIT \$3.*FOR UPDATE SKIP LOCKED.*UPDATE lex_support_requests sr.*SET status = 'expired', closed_at = \$2.*sr\.status IN \('open','accepted'\).*RETURNING sr\.\*`).
		WithArgs(tenantID, now, 50).
		WillReturnRows(pgxmock.NewRows([]string{"row_to_json"}).AddRow(raw))
	got, err := expireSupportDueWith(context.Background(), mock, tenantID, now, 50)
	if err != nil || len(got) != 1 || got[0].Status != model.SupportStatusExpired || got[0].ClosedAt == nil || !got[0].ClosedAt.Equal(now) {
		t.Fatalf("expired = %+v, err=%v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSupportMigrationCarriesRLSAndNoDeleteSemantics(t *testing.T) {
	// The migration is checked through its stable SQL vocabulary rather than a
	// live database so this focused package remains hermetic.
	path := "../../../migrations/lex_db/000109_lex_support_requests.up.sql"
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(raw)
	for _, required := range []string{"ENABLE ROW LEVEL SECURITY", "FORCE ROW LEVEL SECURITY", "tenant_isolation", "idx_lex_support_due", "status IN ('open', 'accepted')"} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration missing %q", required)
		}
	}
	if matched, _ := regexp.MatchString(`(?i)ON DELETE CASCADE`, sql); matched {
		t.Fatal("support requests must be retained, not cascade-deleted")
	}
}

func TestSupportApprovalGateMigrationWidensStatusAndKeepsPendingClockless(t *testing.T) {
	up, err := os.ReadFile("../../../migrations/lex_db/000119_support_manager_approval_gate.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	sql := string(up)
	for _, required := range []string{
		"approver_user_id", "approval_decided_at", "approval_note", "approval_route", "business_days",
		"'manager', 'unit_head', 'auto_no_manager', 'auto_self'",
		"'pending_manager_approval', 'open', 'accepted'",
		"ck_lex_support_pending_no_expiry",
		"ck_lex_support_pending_has_approver",
		"idx_lex_support_pending_approval",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("000119 missing %q", required)
		}
	}
	// `rejected` must be terminal exactly like the other closed states.
	if !strings.Contains(sql, "'resolved', 'declined', 'expired', 'cancelled', 'rejected') AND closed_at IS NOT NULL") {
		t.Fatalf("000119 must make rejected terminal:\n%s", sql)
	}
	// Rows that predate the gate keep `open` and record that no human approved.
	if !strings.Contains(sql, "SET approval_route = 'auto_no_manager'") {
		t.Fatal("000119 must backfill pre-gate rows to auto_no_manager rather than demanding a retroactive approval")
	}
	if matched, _ := regexp.MatchString(`(?i)SET\s+status\s*=\s*'pending_manager_approval'`, sql); matched {
		t.Fatal("000119 must not retroactively push existing rows behind the gate")
	}
	down, err := os.ReadFile("../../../migrations/lex_db/000119_support_manager_approval_gate.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	// The restored CHECK would reject rows in the new states, so the down
	// migration has to collapse them first or it fails half-applied.
	for _, required := range []string{"status = 'pending_manager_approval'", "status = 'rejected'"} {
		if !strings.Contains(string(down), required) {
			t.Fatalf("000119 down must collapse %q before restoring the old CHECK", required)
		}
	}
}

// A pending request has no expiry clock, and the sweep must never invent one for
// it: expiring a request nobody could act on yet would close it silently.
func TestSupportExpirySweepNeverClaimsPendingApprovalRows(t *testing.T) {
	for name, sql := range map[string]string{
		"tenant fan-out": supportExpiryTenantsSQL,
		"expiry sweep":   supportExpirySweepSQL,
	} {
		if strings.Contains(sql, "pending_manager_approval") {
			t.Fatalf("%s must never claim a request that is still behind the approval gate:\n%s", name, sql)
		}
		if !strings.Contains(sql, "status IN ('open','accepted')") {
			t.Fatalf("%s must stay an explicit allow-list of clock-bearing states:\n%s", name, sql)
		}
	}
}
