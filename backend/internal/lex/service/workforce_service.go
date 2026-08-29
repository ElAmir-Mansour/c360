package service

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var defaultWorkforceDomains = append([]string(nil), repository.WorkforceAttributableDomains...)
var defaultWorkforceRels = []string{"owner", "handler", "advisor", "reviewer", "assignee"}

const (
	workforceDefaultTeamLimit = 200
	workforceMaxTeamLimit     = 200
	workforceMaxRangeDays     = 366
)

type workforceDataStore interface {
	ReadDomain(ctx context.Context, tenantID uuid.UUID, domain string, userIDs []uuid.UUID, includeAll bool, rels []string) (repository.WorkforceDomainResult, error)
	UnroutedRequests(ctx context.Context, tenantID uuid.UUID) (int, error)
}

type workforceCalendar interface {
	ResolveFor(ctx context.Context, tenantID uuid.UUID) ReportingCalendarResolution
}

type WorkforceReportQuery struct {
	From               *time.Time
	To                 *time.Time
	Scope              model.ScopeMode
	EntityID           *uuid.UUID
	Domains            []string
	Rels               []string
	Sort               string
	Limit              int
	HasWorkforceAccess bool
	HasExecutiveRole   bool
	ForbiddenDomains   map[string]bool
}

type WorkforceService struct {
	scopes   *WorkforceScopeResolver
	data     workforceDataStore
	calendar workforceCalendar
	users    WorkforceUserDirectory
	metrics  *LexDomainMetrics
	now      func() time.Time
}

func NewWorkforceService(scopes *WorkforceScopeResolver, data workforceDataStore, calendar workforceCalendar) *WorkforceService {
	return &WorkforceService{scopes: scopes, data: data, calendar: calendar, now: time.Now}
}

func (s *WorkforceService) SetUserDirectory(users WorkforceUserDirectory) {
	if s != nil && users != nil {
		s.users = users
	}
}

func (s *WorkforceService) SetDomainMetrics(metrics *LexDomainMetrics) {
	if s != nil {
		s.metrics = metrics
	}
}

func (s *WorkforceService) Report(ctx context.Context, tenantID, callerID uuid.UUID, query WorkforceReportQuery) (*model.WorkforceReport, error) {
	startedAt := time.Now()
	if s == nil || s.scopes == nil || s.data == nil || s.calendar == nil {
		return nil, internalError("build workforce report", fmt.Errorf("workforce service is not configured"))
	}
	scope, err := s.scopes.Resolve(ctx, tenantID, callerID, WorkforceScopeRequest{
		Mode: query.Scope, EntityID: query.EntityID,
		HasWorkforceAccess: query.HasWorkforceAccess, HasExecutiveRole: query.HasExecutiveRole,
	})
	if err != nil {
		return nil, err
	}

	period, bounds, err := s.resolvePeriod(ctx, tenantID, query.From, query.To)
	if err != nil {
		return nil, err
	}
	domains, err := normalizeWorkforceDomains(query.Domains)
	if err != nil {
		return nil, err
	}
	rels, err := normalizeWorkforceRels(query.Rels)
	if err != nil {
		return nil, err
	}
	limit := query.Limit
	if limit == 0 {
		limit = workforceDefaultTeamLimit
	}
	if limit < 1 || limit > workforceMaxTeamLimit {
		return nil, validationError("limit must be between 1 and 200", map[string]string{"limit": "out of range"})
	}
	if !validWorkforceSort(query.Sort) {
		return nil, validationError("sort must be active_workload, completion_rate_pct, or display_name", map[string]string{"sort": "invalid"})
	}

	domainResults := make([]repository.WorkforceDomainResult, len(domains))
	domainErrors := make([]*model.DomainError, len(domains))
	g, gctx := errgroup.WithContext(ctx)
	for i, domain := range domains {
		i, domain := i, domain
		g.Go(func() error {
			if query.ForbiddenDomains[domain] {
				domainErrors[i] = &model.DomainError{Domain: domain, Kind: model.DomainErrorForbidden}
				return nil
			}
			result, readErr := s.data.ReadDomain(gctx, tenantID, domain, scope.Envelope.UserIDs, scope.IncludeAll, rels)
			if readErr != nil {
				domainErrors[i] = &model.DomainError{Domain: domain, Kind: model.DomainErrorQueryError, Detail: "source query failed"}
				return nil
			}
			domainResults[i] = result
			return nil
		})
	}
	_ = g.Wait() // Domain failures are represented in-band; scope failure already returned.

	attributions := make([]repository.WorkforceAttribution, 0)
	coverage := model.CoverageEnvelope{
		DomainsRequested: len(domains),
		Exclusions:       defaultWorkforceCoverageExclusions(),
	}
	errorsOut := make([]model.DomainError, 0)
	for i, result := range domainResults {
		if domainErrors[i] != nil {
			errorsOut = append(errorsOut, *domainErrors[i])
			coverage.Exclusions = append(coverage.Exclusions, model.CoverageExclusion{
				Domain: domains[i], Reason: string(domainErrors[i].Kind), Detail: domainErrors[i].Detail,
			})
			continue
		}
		coverage.ItemsTotal += result.Coverage.Total
		coverage.ItemsAttributed += result.Coverage.Attributed
		if result.Coverage.Attributed > 0 {
			coverage.DomainsReturned++
		}
		attributions = append(attributions, result.Attributions...)
	}
	// Self scope is the no-permission privacy exception and must not expose
	// tenant-wide source counts through the coverage envelope. Unattributed work
	// cannot be assigned to one person, so self coverage is limited to the
	// distinct items visible in that caller's own attribution rows.
	if scope.Envelope.Mode == model.ScopeModeSelf {
		coverage = selfWorkforceCoverage(domains, domainResults, domainErrors, coverage.Exclusions)
	}
	coverage.ItemsUnattributed = workforceMaxInt(0, coverage.ItemsTotal-coverage.ItemsAttributed)
	if coverage.ItemsTotal > 0 {
		coverage.AttributionPct = int(math.Round(float64(coverage.ItemsAttributed) * 100 / float64(coverage.ItemsTotal)))
	}

	domainDegraded := len(errorsOut) > 0
	team := s.buildTeam(ctx, tenantID, scope, attributions, bounds, containsWorkforceValue(domains, "obligations"))
	if domainDegraded {
		markWorkforceTeamPartial(team)
	}
	sortWorkforceTeam(team, query.Sort)
	fullTeam := team
	coverage.RowsReturned = workforceMinInt(len(team), limit)
	coverage.RowsTruncated = workforceMaxInt(0, len(team)-limit)
	if len(team) > limit {
		team = team[:limit]
	}

	unroutedMetric := unavailableWorkforceMetric("domain_not_requested")
	if scope.Envelope.Mode == model.ScopeModeSelf {
		unroutedMetric = unavailableWorkforceMetric("scope_not_permitted")
	} else if query.ForbiddenDomains["requests"] {
		unroutedMetric = unavailableWorkforceMetric("forbidden")
	} else if containsWorkforceValue(domains, "requests") {
		unrouted, unroutedErr := s.data.UnroutedRequests(ctx, tenantID)
		unroutedMetric = availableWorkforceMetric(float64(unrouted))
		if unroutedErr != nil {
			unroutedMetric = unavailableWorkforceMetric("query_error")
			errorsOut = append(errorsOut, model.DomainError{Domain: "requests", Kind: model.DomainErrorQueryError, Detail: "source query failed"})
		}
	}
	rollup := buildWorkforceRollup(fullTeam, attributions, bounds.Now, unroutedMetric)
	if domainDegraded {
		rollup.DistributionGini = unavailableWorkforceMetric("partial_data")
		rollup.KeyPersonConcentration = unavailableWorkforceMetric("partial_data")
		rollup.BacklogBurnPct = unavailableWorkforceMetric("partial_data")
		for bucket := range rollup.Aging {
			rollup.Aging[bucket] = unavailableWorkforceMetric("partial_data")
		}
	}
	itemsObserved, openObserved := workforceTelemetryCounts(attributions)
	s.metrics.ObserveWorkforceReport(itemsObserved, openObserved, time.Since(startedAt).Seconds())

	return &model.WorkforceReport{
		Scope: scope.Envelope, Period: period, Team: nonNilWorkforceTeam(team), Rollup: rollup,
		Coverage: coverage, Degraded: len(errorsOut) > 0, Errors: errorsOut,
	}, nil
}

func containsWorkforceValue(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func selfWorkforceCoverage(
	domains []string,
	results []repository.WorkforceDomainResult,
	errors []*model.DomainError,
	exclusions []model.CoverageExclusion,
) model.CoverageEnvelope {
	coverage := model.CoverageEnvelope{
		DomainsRequested: len(domains),
		Exclusions:       exclusions,
	}
	for index, result := range results {
		if errors[index] != nil {
			continue
		}
		items := make(map[string]struct{})
		for _, item := range result.Attributions {
			items[item.Domain+"\x00"+item.SubjectID.String()] = struct{}{}
		}
		if len(items) > 0 {
			coverage.DomainsReturned++
		}
		coverage.ItemsTotal += len(items)
		coverage.ItemsAttributed += len(items)
	}
	return coverage
}

type workforcePeriodBounds struct {
	From        time.Time
	ToExclusive time.Time
	Now         time.Time
}

func (s *WorkforceService) resolvePeriod(ctx context.Context, tenantID uuid.UUID, from, to *time.Time) (model.PeriodEnvelope, workforcePeriodBounds, error) {
	resolution := s.calendar.ResolveFor(ctx, tenantID)
	if resolution.Calculator == nil {
		return model.PeriodEnvelope{}, workforcePeriodBounds{}, internalError("resolve workforce calendar", fmt.Errorf("calendar calculator is nil"))
	}
	loc := resolution.Calculator.Location()
	if loc == nil {
		loc = time.UTC
	}
	now := s.now().In(loc)
	toDate := civilDateAt(to, now, loc)
	fromDefault := toDate.AddDate(0, 0, -29)
	fromDate := civilDateAt(from, fromDefault, loc)
	if fromDate.After(toDate) {
		return model.PeriodEnvelope{}, workforcePeriodBounds{}, validationError("from must not be after to", map[string]string{"from": "after to"})
	}
	toExclusive := toDate.AddDate(0, 0, 1)
	if fromDate.AddDate(0, 0, workforceMaxRangeDays).Before(toExclusive) {
		return model.PeriodEnvelope{}, workforcePeriodBounds{}, workforceRangeError(
			"reporting range must not exceed 366 days",
			map[string]string{"range": "exceeds_366_days"},
		)
	}
	workingDays := unavailableWorkforceMetric("calendar_unavailable")
	if resolution.Source == model.CalendarSourceTenant {
		count := 0
		for day := fromDate; day.Before(toExclusive); day = day.AddDate(0, 0, 1) {
			if resolution.Calculator.WorkingMinutesBetween(day, day.AddDate(0, 0, 1)) > 0 {
				count++
			}
		}
		workingDays = availableWorkforceMetric(float64(count))
	}
	return model.PeriodEnvelope{
		From: fromDate.Format("2006-01-02"), To: toDate.Format("2006-01-02"),
		Timezone: loc.String(), CalendarSource: resolution.Source, WorkingDays: workingDays,
	}, workforcePeriodBounds{From: fromDate, ToExclusive: toExclusive, Now: now}, nil
}

func workforceRangeError(message string, fields map[string]string) error {
	return &apperrors.AppError{
		Status:  http.StatusBadRequest,
		Code:    "VALIDATION_ERROR",
		Message: message,
		Fields:  fields,
		Err:     apperrors.ErrValidation,
	}
}

func civilDateAt(value *time.Time, fallback time.Time, loc *time.Location) time.Time {
	if value == nil {
		return time.Date(fallback.Year(), fallback.Month(), fallback.Day(), 0, 0, 0, 0, loc)
	}
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, loc)
}

func inWorkforceHalfOpen(value time.Time, bounds workforcePeriodBounds) bool {
	return !value.Before(bounds.From) && value.Before(bounds.ToExclusive)
}

func workforceCivilDate(value time.Time, loc *time.Location) time.Time {
	if loc == nil {
		loc = time.UTC
	}
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, loc)
}

func verifiedWorkforceClosedAt(item repository.WorkforceAttribution, now time.Time) (time.Time, bool) {
	if item.ClosedAt == nil || item.ClosedAt.Before(item.CreatedAt) || !item.ClosedAt.Before(now) {
		return time.Time{}, false
	}
	return *item.ClosedAt, true
}

type workforceMemberAggregate struct {
	UserID                     uuid.UUID
	FallbackName               string
	ActiveSubjects             map[string]struct{}
	LinkedSubjects             map[uuid.UUID]struct{}
	OverdueSubjects            map[string]struct{}
	CycleBySubject             map[string]float64
	CompletionOpenAtWindowEnd  map[string]struct{}
	CompletionResolvedInWindow map[string]struct{}
	CompletionTimestampMissing bool
	CompletionHistoricalState  bool
	ObligationsDueInWindow     map[string]struct{}
	ObligationsDischarged      map[string]struct{}
	ByDomain                   map[string]*model.DomainBreakdown
}

func (s *WorkforceService) buildTeam(
	ctx context.Context,
	tenantID uuid.UUID,
	scope ResolvedWorkforceScope,
	attributions []repository.WorkforceAttribution,
	bounds workforcePeriodBounds,
	obligationsRequested bool,
) []model.TeamMember {
	aggregates := make(map[uuid.UUID]*workforceMemberAggregate)
	for userID := range scope.MemberByID {
		aggregates[userID] = newWorkforceMemberAggregate(userID)
	}
	for _, item := range attributions {
		agg := aggregates[item.UserID]
		if agg == nil {
			agg = newWorkforceMemberAggregate(item.UserID)
			aggregates[item.UserID] = agg
		}
		if agg.FallbackName == "" {
			agg.FallbackName = strings.TrimSpace(item.FallbackName)
		}
		if item.AttributionPath == model.AttributionLinked {
			agg.LinkedSubjects[item.SubjectID] = struct{}{}
			// Linked request rows identify indirect workload only. Their request
			// lifecycle cannot be inferred from the linked subject's lifecycle, so
			// they do not contribute fabricated open/resolved breakdown counts.
			continue
		} else {
			subjectKey := item.Domain + "\x00" + item.SubjectID.String()
			closedAt, closedAtValid := verifiedWorkforceClosedAt(item, bounds.Now)
			if item.IsOpen {
				agg.ActiveSubjects[subjectKey] = struct{}{}
				if item.DueDate != nil {
					dueDate := workforceCivilDate(*item.DueDate, bounds.Now.Location())
					if dueDate.Before(civilDateAt(nil, bounds.Now, bounds.Now.Location())) {
						agg.OverdueSubjects[subjectKey] = struct{}{}
					}
				}
			}

			// Completion is a reconstruction at the reporting window boundary:
			// resolved_in_window / (resolved_in_window + open_at_window_end).
			// A currently-terminal row without a verifiable terminal timestamp cannot
			// be placed on either side of that boundary and invalidates this member's
			// completion metric instead of being silently approximated.
			if item.IsResolved && item.CreatedAt.Before(bounds.ToExclusive) && !closedAtValid {
				agg.CompletionTimestampMissing = true
			}
			if !item.IsOpen && !item.IsResolved && item.CreatedAt.Before(bounds.ToExclusive) && !bounds.ToExclusive.After(bounds.Now) {
				agg.CompletionHistoricalState = true
			}
			if item.CreatedAt.Before(bounds.ToExclusive) && (item.IsOpen || (closedAtValid && !closedAt.Before(bounds.ToExclusive))) {
				agg.CompletionOpenAtWindowEnd[subjectKey] = struct{}{}
			}
			if item.IsResolved && closedAtValid && inWorkforceHalfOpen(closedAt, bounds) {
				agg.CompletionResolvedInWindow[subjectKey] = struct{}{}
				agg.CycleBySubject[subjectKey] = closedAt.Sub(item.CreatedAt).Hours() / 24
			}

			if item.Domain == "obligations" && item.DueDate != nil {
				dueDate := workforceCivilDate(*item.DueDate, bounds.From.Location())
				if inWorkforceHalfOpen(dueDate, bounds) {
					agg.ObligationsDueInWindow[subjectKey] = struct{}{}
					// Discharge is due-date anchored and on-time: completion must be a
					// verified event strictly before the next tenant-local civil day.
					// The exact next-midnight boundary belongs to the following day.
					if item.IsResolved && closedAtValid && closedAt.Before(dueDate.AddDate(0, 0, 1)) {
						agg.ObligationsDischarged[subjectKey] = struct{}{}
					}
				}
			}
		}
		key := item.Domain + "\x00" + item.Rel + "\x00" + string(item.AttributionPath)
		breakdown := agg.ByDomain[key]
		if breakdown == nil {
			breakdown = &model.DomainBreakdown{Domain: item.Domain, Rel: item.Rel, AttributionPath: item.AttributionPath}
			agg.ByDomain[key] = breakdown
		}
		if item.IsOpen {
			breakdown.Open++
		}
		if item.IsResolved {
			breakdown.Resolved++
		}
	}

	ids := make([]uuid.UUID, 0, len(aggregates))
	for id := range aggregates {
		ids = append(ids, id)
	}
	identities := map[uuid.UUID]UserRef{}
	if s.users != nil && len(ids) > 0 {
		if resolved, err := s.users.ResolveUsers(ctx, tenantID, ids); err == nil {
			identities = resolved
		}
	}

	eligibleLoads := make([]float64, 0, len(aggregates))
	for _, agg := range aggregates {
		eligibleLoads = append(eligibleLoads, float64(len(agg.ActiveSubjects)))
	}
	medianLoad := medianFloat64(eligibleLoads)
	team := make([]model.TeamMember, 0, len(aggregates))
	for id, agg := range aggregates {
		member, hasMember := scope.MemberByID[id]
		identity, resolved := identities[id]
		displayName, identityStatus, userStatus, avatar := workforceIdentity(identity, resolved, member, hasMember, agg.FallbackName, id)
		cycleDays := make([]float64, 0, len(agg.CycleBySubject))
		for _, days := range agg.CycleBySubject {
			cycleDays = append(cycleDays, days)
		}
		completionRate := ratioWorkforceMetric(
			len(agg.CompletionResolvedInWindow),
			len(agg.CompletionResolvedInWindow)+len(agg.CompletionOpenAtWindowEnd),
			"no_period_activity",
		)
		if agg.CompletionTimestampMissing {
			completionRate = unavailableWorkforceMetric("terminal_timestamp_unavailable")
		} else if agg.CompletionHistoricalState {
			completionRate = unavailableWorkforceMetric("historical_state_unavailable")
		}
		obligationDischarge := unavailableWorkforceMetric("domain_not_requested")
		if obligationsRequested {
			obligationDischarge = ratioWorkforceMetric(
				len(agg.ObligationsDischarged),
				len(agg.ObligationsDueInWindow),
				"no_obligations_due_in_period",
			)
		}
		metrics := model.TeamMemberMetrics{
			ActiveWorkload:         availableWorkforceMetric(float64(len(agg.ActiveSubjects))),
			LoadIndexPct:           workforceLoadIndex(float64(len(agg.ActiveSubjects)), medianLoad),
			UtilisationPct:         workforceUtilisation(),
			CompletionRatePct:      completionRate,
			OnTimePct:              unavailableWorkforceMetric("aggregation_not_implemented"),
			MedianCycleDays:        sampleWorkforceMetric(medianFloat64(cycleDays), len(cycleDays), "no_cycle_sample"),
			ApprovalLatencyHrs:     unavailableWorkforceMetric("workflow_attribution_undefined"),
			ObligationDischargePct: obligationDischarge,
			OverdueCount:           availableWorkforceMetric(float64(len(agg.OverdueSubjects))),
			IdleAssignmentPct:      unavailableWorkforceMetric("workflow_attribution_undefined"),
		}
		byDomain := make([]model.DomainBreakdown, 0, len(agg.ByDomain))
		for _, item := range agg.ByDomain {
			byDomain = append(byDomain, *item)
		}
		sort.Slice(byDomain, func(i, j int) bool {
			if byDomain[i].Domain != byDomain[j].Domain {
				return byDomain[i].Domain < byDomain[j].Domain
			}
			if byDomain[i].Rel != byDomain[j].Rel {
				return byDomain[i].Rel < byDomain[j].Rel
			}
			return byDomain[i].AttributionPath < byDomain[j].AttributionPath
		})
		row := model.TeamMember{
			UserID: id, DisplayName: displayName, AvatarURL: avatar,
			IdentityStatus: identityStatus, UserStatus: userStatus,
			Metrics: metrics, ByDomain: byDomain, LinkedCount: len(agg.LinkedSubjects),
		}
		if hasMember {
			entityID := member.EntityID
			row.EntityID = &entityID
			row.Title = member.Title
		}
		team = append(team, row)
	}
	return team
}

func newWorkforceMemberAggregate(userID uuid.UUID) *workforceMemberAggregate {
	return &workforceMemberAggregate{
		UserID: userID, ActiveSubjects: make(map[string]struct{}), LinkedSubjects: make(map[uuid.UUID]struct{}),
		OverdueSubjects: make(map[string]struct{}), CycleBySubject: make(map[string]float64),
		CompletionOpenAtWindowEnd: make(map[string]struct{}), CompletionResolvedInWindow: make(map[string]struct{}),
		ObligationsDueInWindow: make(map[string]struct{}), ObligationsDischarged: make(map[string]struct{}),
		ByDomain: make(map[string]*model.DomainBreakdown),
	}
}

func workforceIdentity(identity UserRef, resolved bool, member repository.WorkforceScopeMember, hasMember bool, fallback string, userID uuid.UUID) (string, model.IdentityStatus, string, string) {
	userStatus := "unknown"
	if resolved {
		userStatus = identity.Status
		name := strings.TrimSpace(strings.Join([]string{identity.FirstName, identity.LastName}, " "))
		if name != "" {
			return name, model.IdentityResolved, userStatus, identity.AvatarURL
		}
	}
	if fallback = strings.TrimSpace(fallback); fallback != "" {
		return fallback, model.IdentityUnverified, userStatus, ""
	}
	if hasMember && strings.TrimSpace(member.EmployeeCode) != "" {
		return strings.TrimSpace(member.EmployeeCode), model.IdentityUnverified, userStatus, ""
	}
	id := userID.String()
	return "Unidentified user · …" + id[len(id)-4:], model.IdentityUnknown, userStatus, ""
}

func workforceLoadIndex(load, median float64) model.MetricValue {
	if median == 0 {
		return unavailableWorkforceMetric("no_team_median")
	}
	return availableWorkforceMetric(math.Round(load * 100 / median))
}

func workforceUtilisation() model.MetricValue {
	return unavailableWorkforceMetric("capacity_formula_undefined")
}

func buildWorkforceRollup(team []model.TeamMember, attributions []repository.WorkforceAttribution, now time.Time, unrouted model.MetricValue) model.WorkforceRollup {
	loads := make([]float64, 0, len(team))
	total := 0.0
	maxLoad := 0.0
	for _, row := range team {
		if !row.Metrics.ActiveWorkload.Available || row.Metrics.ActiveWorkload.Value == nil {
			continue
		}
		load := *row.Metrics.ActiveWorkload.Value
		loads = append(loads, load)
		total += load
		if load > maxLoad {
			maxLoad = load
		}
	}
	gini := unavailableWorkforceMetric("no_population")
	concentration := unavailableWorkforceMetric("no_active_workload")
	if len(loads) > 0 && total > 0 {
		gini = availableWorkforceMetric(workforceGini(loads))
	} else if len(loads) > 0 {
		gini = unavailableWorkforceMetric("no_active_workload")
	}
	if total > 0 {
		concentration = availableWorkforceMetric(math.Round(maxLoad * 100 / total))
	}
	agingCounts := map[string]int{"d0_30": 0, "d31_60": 0, "d61_90": 0, "d90_plus": 0}
	for _, item := range attributions {
		if item.AttributionPath != model.AttributionDirect || !item.IsOpen {
			continue
		}
		days := int(now.Sub(item.CreatedAt).Hours() / 24)
		switch {
		case days <= 30:
			agingCounts["d0_30"]++
		case days <= 60:
			agingCounts["d31_60"]++
		case days <= 90:
			agingCounts["d61_90"]++
		default:
			agingCounts["d90_plus"]++
		}
	}
	aging := make(map[string]model.MetricValue, len(agingCounts))
	for bucket, count := range agingCounts {
		aging[bucket] = availableWorkforceMetric(float64(count))
	}
	return model.WorkforceRollup{
		DistributionGini: gini, KeyPersonConcentration: concentration,
		BacklogBurnPct:   unavailableWorkforceMetric("aggregation_contract_undefined"),
		UnroutedRequests: unrouted, Aging: aging,
	}
}

func workforceGini(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	sum := 0.0
	weighted := 0.0
	for i, value := range sorted {
		sum += value
		weighted += float64(i+1) * value
	}
	if sum == 0 {
		return 0
	}
	n := float64(len(sorted))
	return math.Round(((2*weighted)/(n*sum)-(n+1)/n)*100) / 100
}

func availableWorkforceMetric(value float64) model.MetricValue {
	return model.MetricValue{Value: &value, Available: true}
}

func unavailableWorkforceMetric(reason string) model.MetricValue {
	return model.MetricValue{Available: false, Reason: reason}
}

func ratioWorkforceMetric(numerator, denominator int, emptyReason string) model.MetricValue {
	if denominator == 0 {
		return unavailableWorkforceMetric(emptyReason)
	}
	value := math.Round(float64(numerator) * 100 / float64(denominator))
	return model.MetricValue{
		Value:       &value,
		Available:   true,
		Numerator:   &numerator,
		Denominator: &denominator,
	}
}

func sampleWorkforceMetric(value float64, sample int, reason string) model.MetricValue {
	if sample == 0 {
		return unavailableWorkforceMetric(reason)
	}
	return model.MetricValue{Value: &value, Available: true, Sample: &sample}
}

func medianFloat64(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	mid := len(sorted) / 2
	if len(sorted)%2 == 1 {
		return sorted[mid]
	}
	return (sorted[mid-1] + sorted[mid]) / 2
}

func normalizeWorkforceDomains(values []string) ([]string, error) {
	if len(values) == 0 {
		return append([]string(nil), defaultWorkforceDomains...), nil
	}
	allowed := make(map[string]bool, len(defaultWorkforceDomains))
	for _, value := range defaultWorkforceDomains {
		allowed[value] = true
	}
	return normalizeWorkforceValues(values, allowed, "domain")
}

func normalizeWorkforceRels(values []string) ([]string, error) {
	if len(values) == 0 {
		return append([]string(nil), defaultWorkforceRels...), nil
	}
	allowed := map[string]bool{"owner": true, "handler": true, "advisor": true, "reviewer": true, "supervisor": true, "assignee": true}
	return normalizeWorkforceValues(values, allowed, "rel")
}

func normalizeWorkforceValues(values []string, allowed map[string]bool, field string) ([]string, error) {
	out := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, raw := range values {
		value := strings.ToLower(strings.TrimSpace(raw))
		if !allowed[value] {
			return nil, validationError("invalid "+field, map[string]string{field: value})
		}
		if !seen[value] {
			seen[value] = true
			out = append(out, value)
		}
	}
	return out, nil
}

func sortWorkforceTeam(team []model.TeamMember, field string) {
	switch field {
	case "", "active_workload":
		sort.SliceStable(team, func(i, j int) bool {
			left, right := metricFloat(team[i].Metrics.ActiveWorkload), metricFloat(team[j].Metrics.ActiveWorkload)
			if left != right {
				return left > right
			}
			return workforceTeamIdentityLess(team[i], team[j])
		})
	case "completion_rate_pct":
		sort.SliceStable(team, func(i, j int) bool {
			left, right := metricFloat(team[i].Metrics.CompletionRatePct), metricFloat(team[j].Metrics.CompletionRatePct)
			if left != right {
				return left > right
			}
			return workforceTeamIdentityLess(team[i], team[j])
		})
	case "display_name":
		sort.SliceStable(team, func(i, j int) bool { return workforceTeamIdentityLess(team[i], team[j]) })
	}
}

func workforceTeamIdentityLess(left, right model.TeamMember) bool {
	if left.DisplayName != right.DisplayName {
		return left.DisplayName < right.DisplayName
	}
	return left.UserID.String() < right.UserID.String()
}

func markWorkforceTeamPartial(team []model.TeamMember) {
	for index := range team {
		team[index].Metrics.ActiveWorkload = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.LoadIndexPct = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.UtilisationPct = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.CompletionRatePct = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.OnTimePct = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.MedianCycleDays = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.ApprovalLatencyHrs = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.ObligationDischargePct = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.OverdueCount = unavailableWorkforceMetric("partial_data")
		team[index].Metrics.IdleAssignmentPct = unavailableWorkforceMetric("partial_data")
	}
}

func validWorkforceSort(field string) bool {
	switch field {
	case "", "active_workload", "completion_rate_pct", "display_name":
		return true
	default:
		return false
	}
}

func metricFloat(metric model.MetricValue) float64 {
	if !metric.Available || metric.Value == nil {
		return -1
	}
	return *metric.Value
}

func defaultWorkforceCoverageExclusions() []model.CoverageExclusion {
	return []model.CoverageExclusion{
		{Domain: "investigations", Reason: "assignee_encrypted", Detail: "lead_investigator is field-encrypted text and is not groupable"},
		{Domain: "settlements", Reason: "no_assignee_column"},
		{Domain: "documents", Reason: "no_assignee_column"},
		{Domain: "clause_library", Reason: "no_assignee_column"},
		{Domain: "playbooks", Reason: "no_assignee_column"},
		{Domain: "regulations", Reason: "no_assignee_column"},
		{Domain: "signatures", Reason: "no_assignee_column"},
		{Domain: "workflow_policies", Reason: "no_assignee_column"},
		{Domain: "compliance", Reason: "no_assignee_column"},
		{Domain: "requests", Reason: "partial", Detail: "only requests linked to consultations or cases are attributable"},
		{Domain: "cases", Reason: "partial", Detail: "terminal timestamps require a matching immutable closed-status audit event"},
		{Domain: "contract_intakes", Reason: "partial", Detail: "terminal timestamps require a matching immutable completed-status audit event"},
	}
}

func workforceTelemetryCounts(attributions []repository.WorkforceAttribution) (items int, open int) {
	allSubjects := make(map[string]struct{})
	openSubjects := make(map[string]struct{})
	for _, item := range attributions {
		key := item.Domain + "\x00" + item.SubjectID.String()
		allSubjects[key] = struct{}{}
		if item.IsOpen {
			openSubjects[key] = struct{}{}
		}
	}
	return len(allSubjects), len(openSubjects)
}

func nonNilWorkforceTeam(team []model.TeamMember) []model.TeamMember {
	if team == nil {
		return []model.TeamMember{}
	}
	return team
}

func workforceMinInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func workforceMaxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
