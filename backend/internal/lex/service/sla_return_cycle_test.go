package service

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

// The client's Requests Page feedback has two halves. This file pins both:
// the request may bounce between the business entity and the department any
// number of times, and the SLA stops on a return and starts over on the
// resubmission.

func TestReturnedRequestCanBeResubmittedRepeatedly(t *testing.T) {
	// "reviewed and return many times ... until they reach the file copy" — the
	// returned→submitted edge must exist, and it must not be one-shot.
	if !requestTransitionAllowed(model.RequestStatusReturned, model.RequestStatusSubmitted) {
		t.Fatal("returned -> submitted must be allowed so a request can be resubmitted")
	}

	// Every state the department can hold the request in must be able to hand it
	// back, otherwise the loop is only available from some of them.
	for _, from := range []model.RequestStatus{
		model.RequestStatusSubmitted,
		model.RequestStatusPendingRequesterApproval,
		model.RequestStatusPendingProviderApproval,
		model.RequestStatusApproved,
		model.RequestStatusRouted,
		model.RequestStatusInExecution,
		model.RequestStatusDelivered,
	} {
		if !requestTransitionAllowed(from, model.RequestStatusReturned) {
			t.Errorf("%s -> returned must be allowed", from)
		}
	}

	// The loop is unbounded: walking it twice uses only legal edges, so nothing
	// in the FSM caps the number of review rounds.
	cursor := model.RequestStatusSubmitted
	for round := 1; round <= 3; round++ {
		if !requestTransitionAllowed(cursor, model.RequestStatusReturned) {
			t.Fatalf("round %d: %s -> returned rejected", round, cursor)
		}
		if !requestTransitionAllowed(model.RequestStatusReturned, model.RequestStatusSubmitted) {
			t.Fatalf("round %d: returned -> submitted rejected", round)
		}
		cursor = model.RequestStatusSubmitted
	}
}

func TestSLAClockOutcomeStoppedIsValidButNotLive(t *testing.T) {
	if !model.SLAClockOutcomeStopped.Valid() {
		t.Fatal("stopped must be a recognised outcome")
	}
	for _, tc := range []struct {
		outcome model.SLAClockOutcome
		live    bool
	}{
		{model.SLAClockOutcomePending, true},
		{model.SLAClockOutcomeStopped, false},
		{model.SLAClockOutcomeOnTime, false},
		{model.SLAClockOutcomeBreached, false},
	} {
		if got := tc.outcome.Live(); got != tc.live {
			t.Errorf("%s.Live() = %v, want %v", tc.outcome, got, tc.live)
		}
	}
}

func TestStoppedCycleIsExcludedFromComplianceAggregates(t *testing.T) {
	// A stopped cycle must be neither on-time nor breached: the department did not
	// deliver, but it also did not miss a deadline it still controlled. Counting it
	// as either would misstate SLA compliance.
	if model.SLAClockOutcomeStopped == model.SLAClockOutcomeOnTime ||
		model.SLAClockOutcomeStopped == model.SLAClockOutcomeBreached {
		t.Fatal("stopped must be distinct from the two judgemental outcomes")
	}
}

// TestReturnedClockCannotKeepBreaching guards the load-bearing half of the fix.
// A cycle stopped by a return still has resolved_at NULL, so the monitor's scan
// MUST additionally filter on outcome = 'pending'; without it the clock would go
// on breaching and escalating while the request sits with the requester — the
// exact defect the client reported.
func TestReturnedClockCannotKeepBreaching(t *testing.T) {
	source := readRepoFile(t, "repository", "sla_clock_repo.go")

	listDue := between(t, source, "func (r *SLAClockRepository) ListDue", "\nfunc ")
	if !strings.Contains(listDue, "c.outcome = 'pending'") {
		t.Error("ListDue must restrict the monitor scan to live clocks (outcome = 'pending'); " +
			"resolved_at IS NULL alone still matches a cycle stopped by a return")
	}

	if !strings.Contains(source, "func (r *SLAClockRepository) GetActiveByRequest") {
		t.Error("GetActiveByRequest is required so callers can distinguish the live cycle from history")
	}
	getByRequest := between(t, source, "func (r *SLAClockRepository) GetByRequest", "\nfunc ")
	if !strings.Contains(getByRequest, "ORDER BY") {
		t.Error("GetByRequest must order by cycle: several clocks per request are now possible, " +
			"so without it the returned row is arbitrary")
	}
}

// TestClockCycleInvariantsAreEnforcedInSchema pins the guarantees to the
// migration rather than to application code, since they are what make "at most
// one running SLA per request" true under concurrency.
func TestClockCycleInvariantsAreEnforcedInSchema(t *testing.T) {
	up := readRepoFile(t, "..", "..", "migrations", "lex_db", "000110_sla_return_cycles.up.sql")

	// The old total unique index is what limited a request to one clock forever.
	if !strings.Contains(up, "DROP INDEX IF EXISTS idx_legal_sla_clocks_request_unique") {
		t.Error("the pre-existing total unique index must be dropped, or a second cycle cannot exist")
	}
	// ...replaced by a PARTIAL one, which still forbids two live clocks.
	if !strings.Contains(up, "WHERE outcome = 'pending'") {
		t.Error("a partial unique index on outcome = 'pending' must enforce at most one live clock")
	}
	if !strings.Contains(up, "(tenant_id, legal_request_id, cycle)") {
		t.Error("cycles must be unique per request")
	}
	if !strings.Contains(up, "'stopped'") {
		t.Error("the outcome CHECK must admit 'stopped'")
	}
}

func readRepoFile(t *testing.T, parts ...string) string {
	t.Helper()
	path := filepath.Join(append([]string{".."}, parts...)...)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	return string(raw)
}

// between returns the slice of source from the first occurrence of start up to
// the next occurrence of end, so an assertion about one function cannot be
// accidentally satisfied by text belonging to a different one.
func between(t *testing.T, source, start, end string) string {
	t.Helper()
	i := strings.Index(source, start)
	if i < 0 {
		t.Fatalf("could not find %q in source", start)
	}
	rest := source[i+len(start):]
	if j := strings.Index(rest, end); j >= 0 {
		return rest[:j]
	}
	return rest
}
