package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

type fakeWorkforceDataStore struct {
	results  map[string]repository.WorkforceDomainResult
	errs     map[string]error
	unrouted int
}

func TestWorkforceMetricValueJSONInvariants(t *testing.T) {
	available := availableWorkforceMetric(42)
	unavailable := unavailableWorkforceMetric("window_event_undefined")
	for name, metric := range map[string]model.MetricValue{"available": available, "unavailable": unavailable} {
		encoded, err := json.Marshal(metric)
		if err != nil {
			t.Fatalf("marshal %s metric: %v", name, err)
		}
		var payload map[string]any
		if err := json.Unmarshal(encoded, &payload); err != nil {
			t.Fatalf("decode %s metric: %v", name, err)
		}
		if metric.Available {
			if payload["value"] == nil || metric.Reason != "" {
				t.Fatalf("available metric = %s, want non-null value and no reason", encoded)
			}
		} else if payload["value"] != nil || payload["reason"] == "" {
			t.Fatalf("unavailable metric = %s, want null value and a reason", encoded)
		}
	}
}

type privacyWorkforceDataStore struct {
	result        repository.WorkforceDomainResult
	unroutedCalls int
}

func (f *privacyWorkforceDataStore) ReadDomain(context.Context, uuid.UUID, string, []uuid.UUID, bool, []string) (repository.WorkforceDomainResult, error) {
	return f.result, nil
}

func (f *privacyWorkforceDataStore) UnroutedRequests(context.Context, uuid.UUID) (int, error) {
	f.unroutedCalls++
	return 99, nil
}

func (f fakeWorkforceDataStore) ReadDomain(_ context.Context, _ uuid.UUID, domain string, _ []uuid.UUID, _ bool, _ []string) (repository.WorkforceDomainResult, error) {
	if err := f.errs[domain]; err != nil {
		return repository.WorkforceDomainResult{}, err
	}
	if result, ok := f.results[domain]; ok {
		return result, nil
	}
	return repository.WorkforceDomainResult{Coverage: repository.WorkforceDomainCoverage{Domain: domain}}, nil
}

func TestWorkforceLinkedAttributionNeverFabricatesLifecycleBreakdown(t *testing.T) {
	memberID := uuid.New()
	requestID := uuid.New()
	data := fakeWorkforceDataStore{results: map[string]repository.WorkforceDomainResult{
		"requests": {
			Coverage: repository.WorkforceDomainCoverage{Domain: "requests", Total: 1, Attributed: 1},
			Attributions: []repository.WorkforceAttribution{
				{
					UserID: memberID, Domain: "requests", Rel: "advisor", SubjectID: requestID,
					IsOpen: true, IsResolved: true, CreatedAt: time.Now(), AttributionPath: model.AttributionLinked,
				},
				{
					UserID: memberID, Domain: "requests", Rel: "handler", SubjectID: requestID,
					IsOpen: true, IsResolved: true, CreatedAt: time.Now(), AttributionPath: model.AttributionLinked,
				},
			},
		},
	}}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: []repository.WorkforceScopeMember{{UserID: memberID}}}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), data, NewReportingCalendarPort(nil))

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		Domains: []string{"requests"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if got := report.Team[0]; got.LinkedCount != 1 || len(got.ByDomain) != 0 || got.Metrics.ActiveWorkload.Value == nil || *got.Metrics.ActiveWorkload.Value != 0 {
		t.Fatalf("linked row = %+v, want distinct linked item count only and no inferred lifecycle counts", got)
	}
}

func TestWorkforceSupportContributesOnlyOpenAndAcceptedToActiveLoad(t *testing.T) {
	rels, err := normalizeWorkforceRels(nil)
	if err != nil {
		t.Fatalf("normalizeWorkforceRels() error = %v", err)
	}
	hasAssignee := false
	for _, rel := range rels {
		if rel == "assignee" {
			hasAssignee = true
			break
		}
	}
	if !hasAssignee {
		t.Fatalf("default workforce relations = %v, want assignee", rels)
	}

	memberID := uuid.New()
	now := time.Date(2026, time.July, 31, 12, 0, 0, 0, time.UTC)
	resolvedAt := now.Add(-time.Hour)
	data := fakeWorkforceDataStore{results: map[string]repository.WorkforceDomainResult{
		"support": {
			Coverage: repository.WorkforceDomainCoverage{Domain: "support", Total: 5, Attributed: 5},
			Attributions: []repository.WorkforceAttribution{
				{UserID: memberID, Domain: "support", Rel: "assignee", SubjectID: uuid.New(), Status: "open", IsOpen: true, CreatedAt: now.Add(-5 * time.Hour), AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "support", Rel: "assignee", SubjectID: uuid.New(), Status: "accepted", IsOpen: true, CreatedAt: now.Add(-4 * time.Hour), AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "support", Rel: "assignee", SubjectID: uuid.New(), Status: "resolved", IsResolved: true, CreatedAt: now.Add(-3 * time.Hour), ClosedAt: &resolvedAt, AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "support", Rel: "assignee", SubjectID: uuid.New(), Status: "expired", CreatedAt: now.Add(-2 * time.Hour), AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "support", Rel: "assignee", SubjectID: uuid.New(), Status: "cancelled", CreatedAt: now.Add(-time.Hour), AttributionPath: model.AttributionDirect},
			},
		},
	}}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: []repository.WorkforceScopeMember{{UserID: memberID}}}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), data, NewReportingCalendarPort(nil))
	svc.now = func() time.Time { return now }

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		Domains: []string{"support"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if len(report.Team) != 1 {
		t.Fatalf("team rows = %d, want 1", len(report.Team))
	}
	member := report.Team[0]
	if member.Metrics.ActiveWorkload.Value == nil || *member.Metrics.ActiveWorkload.Value != 2 {
		t.Fatalf("active workload = %+v, want open + accepted only", member.Metrics.ActiveWorkload)
	}
	if len(member.ByDomain) != 1 || member.ByDomain[0].Domain != "support" || member.ByDomain[0].Open != 2 || member.ByDomain[0].Resolved != 1 {
		t.Fatalf("support breakdown = %+v, want open=2 resolved=1", member.ByDomain)
	}
	if report.Coverage.ItemsTotal != 5 || report.Coverage.ItemsAttributed != 5 {
		t.Fatalf("coverage = %+v, want unchanged 5/5 envelope", report.Coverage)
	}
}

func TestWorkforceBlankResolvedIdentityPreservesInactiveStatusAndUsesEmployeeCode(t *testing.T) {
	userID := uuid.New()
	name, identityStatus, userStatus, avatar := workforceIdentity(
		UserRef{ID: userID, Status: "inactive", AvatarURL: "https://example.invalid/avatar.png"},
		true,
		repository.WorkforceScopeMember{UserID: userID, EmployeeCode: "EMP-42"},
		true,
		"",
		userID,
	)
	if name != "EMP-42" || identityStatus != model.IdentityUnverified || userStatus != "inactive" || avatar != "" {
		t.Fatalf("identity fallback = %q %q %q %q", name, identityStatus, userStatus, avatar)
	}
}

func TestWorkforcePartialDomainFailureInvalidatesDerivedTeamAndRollupMetrics(t *testing.T) {
	memberID := uuid.New()
	data := fakeWorkforceDataStore{
		results: map[string]repository.WorkforceDomainResult{
			"contracts": {
				Coverage: repository.WorkforceDomainCoverage{Domain: "contracts", Total: 1, Attributed: 1},
				Attributions: []repository.WorkforceAttribution{{
					UserID: memberID, Domain: "contracts", Rel: "owner", SubjectID: uuid.New(),
					IsOpen: true, CreatedAt: time.Now().Add(-24 * time.Hour), AttributionPath: model.AttributionDirect,
				}},
			},
		},
		errs: map[string]error{"matters": errors.New("database detail that must not escape")},
	}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: []repository.WorkforceScopeMember{{UserID: memberID}}}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), data, NewReportingCalendarPort(nil))

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		Domains: []string{"contracts", "matters"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if !report.Degraded || len(report.Errors) != 1 || report.Errors[0].Detail != "source query failed" {
		t.Fatalf("degraded envelope = %+v / %+v", report.Degraded, report.Errors)
	}
	metrics := []model.MetricValue{
		report.Team[0].Metrics.ActiveWorkload,
		report.Team[0].Metrics.CompletionRatePct,
		report.Rollup.DistributionGini,
		report.Rollup.KeyPersonConcentration,
		report.Rollup.BacklogBurnPct,
	}
	for _, metric := range metrics {
		if metric.Available || metric.Value != nil || metric.Reason != "partial_data" {
			t.Fatalf("partial metric = %+v, want unavailable partial_data", metric)
		}
	}
	for bucket, metric := range report.Rollup.Aging {
		if metric.Available || metric.Value != nil || metric.Reason != "partial_data" {
			t.Fatalf("partial aging bucket %s = %+v, want unavailable partial_data", bucket, metric)
		}
	}
}

func TestWorkforceLoadIndexAndRankingIgnoreCapacity(t *testing.T) {
	zeroID, rankedID := uuid.New(), uuid.New()
	zeroCapacity := 0.0
	data := fakeWorkforceDataStore{results: map[string]repository.WorkforceDomainResult{
		"contracts": {
			Coverage: repository.WorkforceDomainCoverage{Domain: "contracts", Total: 2, Attributed: 2},
			Attributions: []repository.WorkforceAttribution{
				{UserID: zeroID, FallbackName: "Alpha", Domain: "contracts", Rel: "owner", SubjectID: uuid.New(), IsOpen: true, CreatedAt: time.Now(), AttributionPath: model.AttributionDirect},
				{UserID: rankedID, FallbackName: "Zulu", Domain: "contracts", Rel: "owner", SubjectID: uuid.New(), IsOpen: true, CreatedAt: time.Now(), AttributionPath: model.AttributionDirect},
			},
		},
	}}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: []repository.WorkforceScopeMember{
			{UserID: zeroID, CapacityUnits: &zeroCapacity}, {UserID: rankedID},
		}}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), data, NewReportingCalendarPort(nil))

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		Domains: []string{"contracts"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if len(report.Team) != 2 || report.Team[0].UserID != zeroID || report.Team[1].UserID != rankedID {
		t.Fatalf("team order = %+v, equal loads must use the capacity-independent name tie-break", report.Team)
	}
	if metric := report.Team[0].Metrics.LoadIndexPct; !metric.Available || metric.Value == nil || *metric.Value != 100 {
		t.Fatalf("zero-capacity member load index = %+v, want 100%% of team median", metric)
	}
	if metric := report.Team[0].Metrics.UtilisationPct; metric.Available || metric.Reason != "capacity_formula_undefined" {
		t.Fatalf("utilisation = %+v, must stay unavailable regardless of capacity storage", metric)
	}
}

func (f fakeWorkforceDataStore) UnroutedRequests(context.Context, uuid.UUID) (int, error) {
	return f.unrouted, nil
}

func TestWorkforceReportDefaultsToVisibleUnscopedFallback(t *testing.T) {
	svc := NewWorkforceService(
		NewWorkforceScopeResolver(fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
			return repository.WorkforceScopeData{}, nil
		}}),
		fakeWorkforceDataStore{},
		NewReportingCalendarPort(nil),
	)
	svc.now = func() time.Time { return time.Date(2026, time.July, 31, 12, 0, 0, 0, time.UTC) }

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{HasWorkforceAccess: true})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if report.Scope.Mode != model.ScopeModeUnscoped || report.Scope.Reason != "no_org_role" {
		t.Fatalf("scope = %+v, want visible no_org_role unscoped mode", report.Scope)
	}
	if report.Period.CalendarSource != model.CalendarSourceFallbackUTC {
		t.Fatalf("calendar source = %q, want fallback_utc", report.Period.CalendarSource)
	}
	if report.Period.WorkingDays.Available || report.Period.WorkingDays.Value != nil || report.Period.WorkingDays.Reason != "calendar_unavailable" {
		t.Fatalf("working days = %+v, want unavailable calendar_unavailable", report.Period.WorkingDays)
	}
	if report.Team == nil || report.Errors == nil || report.Coverage.Exclusions == nil {
		t.Fatal("response collections must encode as arrays, not null")
	}
}

func TestWorkforcePeriodComparisonsAreHalfOpen(t *testing.T) {
	memberID := uuid.New()
	from := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	toExclusive := time.Date(2026, time.August, 1, 0, 0, 0, 0, time.UTC)
	closedAtFrom := from
	closedAtTo := toExclusive
	createdBefore := from.Add(-time.Hour)
	results := map[string]repository.WorkforceDomainResult{
		"contracts": {
			Coverage: repository.WorkforceDomainCoverage{Domain: "contracts", Total: 3, Attributed: 3},
			Attributions: []repository.WorkforceAttribution{
				{UserID: memberID, Domain: "contracts", Rel: "owner", SubjectID: uuid.New(), IsOpen: true, CreatedAt: from, AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "contracts", Rel: "owner", SubjectID: uuid.New(), IsResolved: true, CreatedAt: toExclusive, ClosedAt: &closedAtTo, AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "contracts", Rel: "owner", SubjectID: uuid.New(), IsResolved: true, CreatedAt: createdBefore, ClosedAt: &closedAtFrom, AttributionPath: model.AttributionDirect},
			},
		},
	}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{
			HasOrgRole: true,
			Members:    []repository.WorkforceScopeMember{{UserID: memberID}},
		}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), fakeWorkforceDataStore{results: results}, NewReportingCalendarPort(nil))
	svc.now = func() time.Time { return time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC) }
	toInclusive := toExclusive.AddDate(0, 0, -1)

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		From: &from, To: &toInclusive, Domains: []string{"contracts"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if len(report.Team) != 1 {
		t.Fatalf("team rows = %d, want 1", len(report.Team))
	}
	completion := report.Team[0].Metrics.CompletionRatePct
	if !completion.Available || completion.Value == nil || *completion.Value != 50 || completion.Numerator == nil || *completion.Numerator != 1 || completion.Denominator == nil || *completion.Denominator != 2 {
		t.Fatalf("completion = %+v, want 1 resolved in window / (1 resolved + 1 open at window end)", completion)
	}
	cycle := report.Team[0].Metrics.MedianCycleDays
	if !cycle.Available || cycle.Sample == nil || *cycle.Sample != 1 {
		t.Fatalf("cycle = %+v, exact from included and exact to excluded", cycle)
	}

	bounds := workforcePeriodBounds{From: from, ToExclusive: toExclusive}
	if !inWorkforceHalfOpen(from, bounds) || !inWorkforceHalfOpen(toExclusive.Add(-time.Nanosecond), bounds) || inWorkforceHalfOpen(toExclusive, bounds) {
		t.Fatal("half-open predicate must implement [from, to)")
	}
}

func TestWorkforceReportingRangeHasHard366DayMaximum(t *testing.T) {
	svc := NewWorkforceService(
		NewWorkforceScopeResolver(fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
			return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true}, nil
		}}),
		fakeWorkforceDataStore{},
		NewReportingCalendarPort(nil),
	)

	from := time.Date(2024, time.January, 1, 0, 0, 0, 0, time.UTC)
	toAllowed := time.Date(2024, time.December, 31, 0, 0, 0, 0, time.UTC)
	if _, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		From: &from, To: &toAllowed, Domains: []string{"contracts"}, HasWorkforceAccess: true,
	}); err != nil {
		t.Fatalf("366-day range must be accepted: %v", err)
	}

	toRejected := time.Date(2025, time.January, 1, 0, 0, 0, 0, time.UTC)
	_, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		From: &from, To: &toRejected, Domains: []string{"contracts"}, HasWorkforceAccess: true,
	})
	var appErr *apperrors.AppError
	if !errors.As(err, &appErr) || appErr.Status != http.StatusBadRequest || appErr.Fields["range"] != "exceeds_366_days" {
		t.Fatalf("range error = %#v, want HTTP 400 with exceeds_366_days reason", err)
	}
}

func TestWorkforceObligationDischargeIsDueDateAnchoredAndHalfOpen(t *testing.T) {
	memberID := uuid.New()
	from := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.July, 31, 0, 0, 0, 0, time.UTC)
	dueFrom, dueInside, dueExclusive := from, from.AddDate(0, 0, 10), to.AddDate(0, 0, 1)
	completedAt := from.Add(12 * time.Hour)
	data := fakeWorkforceDataStore{results: map[string]repository.WorkforceDomainResult{
		"obligations": {
			Coverage: repository.WorkforceDomainCoverage{Domain: "obligations", Total: 4, Attributed: 4},
			Attributions: []repository.WorkforceAttribution{
				{UserID: memberID, Domain: "obligations", Rel: "owner", SubjectID: uuid.New(), IsResolved: true, CreatedAt: from.Add(-24 * time.Hour), ClosedAt: &completedAt, DueDate: &dueFrom, AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "obligations", Rel: "owner", SubjectID: uuid.New(), IsOpen: true, CreatedAt: from, DueDate: &dueInside, AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "obligations", Rel: "owner", SubjectID: uuid.New(), IsOpen: true, CreatedAt: from, DueDate: &dueExclusive, AttributionPath: model.AttributionDirect},
				{UserID: memberID, Domain: "obligations", Rel: "owner", SubjectID: uuid.New(), Status: "waived", CreatedAt: from, DueDate: &dueInside, AttributionPath: model.AttributionDirect},
			},
		},
	}}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: []repository.WorkforceScopeMember{{UserID: memberID}}}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), data, NewReportingCalendarPort(nil))
	svc.now = func() time.Time { return time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC) }

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		From: &from, To: &to, Domains: []string{"obligations"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	metric := report.Team[0].Metrics.ObligationDischargePct
	if !metric.Available || metric.Value == nil || *metric.Value != 33 || metric.Numerator == nil || *metric.Numerator != 1 || metric.Denominator == nil || *metric.Denominator != 3 {
		t.Fatalf("obligation discharge = %+v, want 1/3; waived remains due, exact from is included, and exact to is excluded", metric)
	}
}

func TestWorkforceObligationDischargeExcludesLateAndExclusiveDueDayBoundary(t *testing.T) {
	from := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.July, 31, 0, 0, 0, 0, time.UTC)
	due := time.Date(2026, time.July, 10, 0, 0, 0, 0, time.UTC)

	for name, completedAt := range map[string]time.Time{
		"exclusive_due_day_boundary": due.AddDate(0, 0, 1),
		"late_completion":            due.AddDate(0, 0, 2),
	} {
		t.Run(name, func(t *testing.T) {
			memberID := uuid.New()
			data := fakeWorkforceDataStore{results: map[string]repository.WorkforceDomainResult{
				"obligations": {
					Coverage: repository.WorkforceDomainCoverage{Domain: "obligations", Total: 1, Attributed: 1},
					Attributions: []repository.WorkforceAttribution{{
						UserID: memberID, Domain: "obligations", Rel: "owner", SubjectID: uuid.New(),
						IsResolved: true, CreatedAt: from.Add(-24 * time.Hour), ClosedAt: &completedAt,
						DueDate: &due, AttributionPath: model.AttributionDirect,
					}},
				},
			}}
			scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
				return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: []repository.WorkforceScopeMember{{UserID: memberID}}}, nil
			}}
			svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), data, NewReportingCalendarPort(nil))
			svc.now = func() time.Time { return time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC) }

			report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
				From: &from, To: &to, Domains: []string{"obligations"}, HasWorkforceAccess: true,
			})
			if err != nil {
				t.Fatalf("Report() error = %v", err)
			}
			metric := report.Team[0].Metrics.ObligationDischargePct
			if !metric.Available || metric.Value == nil || *metric.Value != 0 || metric.Numerator == nil || *metric.Numerator != 0 || metric.Denominator == nil || *metric.Denominator != 1 {
				t.Fatalf("obligation discharge = %+v, completion at/after due-day exclusive end must be excluded", metric)
			}
		})
	}
}

func TestWorkforceCompletionIsUnavailableWithoutVerifiableTerminalTimestamp(t *testing.T) {
	memberID := uuid.New()
	from := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.July, 31, 0, 0, 0, 0, time.UTC)
	data := fakeWorkforceDataStore{results: map[string]repository.WorkforceDomainResult{
		"cases": {
			Coverage: repository.WorkforceDomainCoverage{Domain: "cases", Total: 1, Attributed: 1},
			Attributions: []repository.WorkforceAttribution{{
				UserID: memberID, Domain: "cases", Rel: "handler", SubjectID: uuid.New(), IsResolved: true,
				CreatedAt: from, AttributionPath: model.AttributionDirect,
			}},
		},
	}}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: []repository.WorkforceScopeMember{{UserID: memberID}}}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), data, NewReportingCalendarPort(nil))
	svc.now = func() time.Time { return time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC) }

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		From: &from, To: &to, Domains: []string{"cases"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if metric := report.Team[0].Metrics.CompletionRatePct; metric.Available || metric.Reason != "terminal_timestamp_unavailable" {
		t.Fatalf("completion = %+v, want explicit terminal_timestamp_unavailable", metric)
	}
}

func TestWorkforceCompletionDoesNotGuessAbandonedStateAtHistoricalBoundary(t *testing.T) {
	memberID := uuid.New()
	from := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC)
	pastTo := time.Date(2026, time.July, 31, 0, 0, 0, 0, time.UTC)
	currentTo := time.Date(2026, time.August, 2, 0, 0, 0, 0, time.UTC)
	data := fakeWorkforceDataStore{results: map[string]repository.WorkforceDomainResult{
		"contracts": {
			Coverage: repository.WorkforceDomainCoverage{Domain: "contracts", Total: 1, Attributed: 1},
			Attributions: []repository.WorkforceAttribution{{
				UserID: memberID, Domain: "contracts", Rel: "owner", SubjectID: uuid.New(), Status: "cancelled",
				CreatedAt: from, AttributionPath: model.AttributionDirect,
			}},
		},
	}}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: []repository.WorkforceScopeMember{{UserID: memberID}}}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), data, NewReportingCalendarPort(nil))
	svc.now = func() time.Time { return time.Date(2026, time.August, 2, 12, 0, 0, 0, time.UTC) }

	pastReport, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		From: &from, To: &pastTo, Domains: []string{"contracts"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("historical Report() error = %v", err)
	}
	if metric := pastReport.Team[0].Metrics.CompletionRatePct; metric.Available || metric.Reason != "historical_state_unavailable" {
		t.Fatalf("historical completion = %+v, want historical_state_unavailable", metric)
	}

	currentReport, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		From: &from, To: &currentTo, Domains: []string{"contracts"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("current-boundary Report() error = %v", err)
	}
	if metric := currentReport.Team[0].Metrics.CompletionRatePct; metric.Available || metric.Reason != "no_period_activity" {
		t.Fatalf("current-boundary completion = %+v, current abandoned state can be excluded safely", metric)
	}
}

func TestWorkforceDefaultTeamLimitIs200AndReportsTruncation(t *testing.T) {
	members := make([]repository.WorkforceScopeMember, 201)
	for index := range members {
		members[index] = repository.WorkforceScopeMember{UserID: uuid.New()}
	}
	scopeStore := fakeWorkforceScopeStore{director: func(context.Context, uuid.UUID, uuid.UUID, *uuid.UUID) (repository.WorkforceScopeData, error) {
		return repository.WorkforceScopeData{HasOrgRole: true, RosterConfigured: true, Members: members}, nil
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(scopeStore), fakeWorkforceDataStore{}, NewReportingCalendarPort(nil))

	report, err := svc.Report(context.Background(), uuid.New(), uuid.New(), WorkforceReportQuery{
		Domains: []string{"contracts"}, HasWorkforceAccess: true,
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if len(report.Team) != 200 || report.Coverage.RowsReturned != 200 || report.Coverage.RowsTruncated != 1 {
		t.Fatalf("team/coverage = %d / %+v, want 200 returned and 1 truncated", len(report.Team), report.Coverage)
	}
}

func TestWorkforceSelfScopeDoesNotLeakTenantCoverageOrUnroutedCounts(t *testing.T) {
	callerID := uuid.New()
	data := &privacyWorkforceDataStore{result: repository.WorkforceDomainResult{
		Coverage: repository.WorkforceDomainCoverage{Domain: "contracts", Total: 999, Attributed: 500},
		Attributions: []repository.WorkforceAttribution{{
			UserID: callerID, Domain: "contracts", Rel: "owner", SubjectID: uuid.New(),
			IsOpen: true, CreatedAt: time.Date(2026, time.July, 1, 0, 0, 0, 0, time.UTC),
			AttributionPath: model.AttributionDirect,
		}},
	}}
	svc := NewWorkforceService(NewWorkforceScopeResolver(fakeWorkforceScopeStore{}), data, NewReportingCalendarPort(nil))
	svc.now = func() time.Time { return time.Date(2026, time.July, 31, 12, 0, 0, 0, time.UTC) }

	report, err := svc.Report(context.Background(), uuid.New(), callerID, WorkforceReportQuery{
		Scope: model.ScopeModeSelf, Domains: []string{"contracts"},
	})
	if err != nil {
		t.Fatalf("Report() error = %v", err)
	}
	if report.Coverage.ItemsTotal != 1 || report.Coverage.ItemsAttributed != 1 || report.Coverage.AttributionPct != 100 {
		t.Fatalf("self coverage = %+v, must describe only the caller-visible item", report.Coverage)
	}
	if data.unroutedCalls != 0 {
		t.Fatalf("UnroutedRequests calls = %d, self scope must not query tenant-wide counts", data.unroutedCalls)
	}
	if report.Rollup.UnroutedRequests.Available || report.Rollup.UnroutedRequests.Reason != "scope_not_permitted" {
		t.Fatalf("unrouted metric = %+v, want unavailable scope_not_permitted", report.Rollup.UnroutedRequests)
	}
}
