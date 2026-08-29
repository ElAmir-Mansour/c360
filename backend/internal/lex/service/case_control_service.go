package service

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

const (
	caseControlResolutionDays    = 7
	caseControlDueDays           = 30
	caseControlRecentCaseLimit   = 6
	caseControlActiveInvestLimit = 2
	caseControlRecentInvestLimit = 6
)

var ongoingInvestigationStatuses = map[string]struct{}{
	string(model.InvestigationStatusRegistered):     {},
	string(model.InvestigationStatusInProgress):     {},
	string(model.InvestigationStatusResults):        {},
	string(model.InvestigationStatusPendingApprove): {},
	string(model.InvestigationStatusRejected):       {},
}

// CaseControlDashboard builds the control panel from full-portfolio aggregates
// plus small, bounded presentation lists. The independent reads fan out in
// parallel and remain tenant-scoped in their respective repositories.
func (s *ReportingService) CaseControlDashboard(ctx context.Context, tenantID uuid.UUID) (*model.CaseControlDashboard, error) {
	if s.cases == nil || s.investigations == nil {
		return nil, internalError("build case control dashboard", errors.New("case control sources are not configured"))
	}

	generatedAt := s.now().UTC()
	resolutionFrom := generatedAt.Add(-caseControlResolutionDays * 24 * time.Hour)
	dueBefore := generatedAt.Add(caseControlDueDays * 24 * time.Hour)

	var (
		caseReport            *model.CaseReport
		resolved              int
		dueIn30Days           int
		investigationStatus   []model.CountBucket
		investigationCaseType []model.CountBucket
		recentCases           []dto.LegalCaseListItem
		activeInvestigations  []model.LegalInvestigation
		recentInvestigations  []model.LegalInvestigation
	)

	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() (err error) {
		caseReport, err = s.CaseReport(groupCtx, tenantID, model.ReportFilters{})
		return err
	})
	group.Go(func() (err error) {
		resolved, err = s.repo.CasesResolvedBetween(groupCtx, tenantID, resolutionFrom, generatedAt)
		return err
	})
	group.Go(func() (err error) {
		dueIn30Days, err = s.repo.CasesExpectedResolutionBetween(groupCtx, tenantID, generatedAt, dueBefore)
		return err
	})
	group.Go(func() (err error) {
		investigationStatus, err = s.repo.InvestigationStatusCounts(groupCtx, tenantID)
		return err
	})
	group.Go(func() (err error) {
		investigationCaseType, err = s.repo.InvestigationCaseTypeCounts(groupCtx, tenantID)
		return err
	})
	group.Go(func() (err error) {
		recentCases, _, err = s.cases.ListWithSummary(groupCtx, tenantID, model.LegalCaseListFilters{
			Page:          1,
			PerPage:       caseControlRecentCaseLimit,
			SortColumn:    "lc.updated_at",
			SortDirection: "desc",
		})
		return err
	})
	group.Go(func() (err error) {
		activeInvestigations, err = s.investigations.ListOngoing(groupCtx, tenantID, caseControlActiveInvestLimit)
		return err
	})
	group.Go(func() (err error) {
		recentInvestigations, _, err = s.investigations.List(groupCtx, tenantID, model.InvestigationListFilters{
			Page:          1,
			PerPage:       caseControlRecentInvestLimit,
			SortColumn:    "li.updated_at",
			SortDirection: "desc",
		})
		return err
	})
	if err := group.Wait(); err != nil {
		return nil, internalError("build case control dashboard", err)
	}
	recentInvestigationIDs := make([]uuid.UUID, len(recentInvestigations))
	for i := range recentInvestigations {
		recentInvestigationIDs[i] = recentInvestigations[i].ID
	}
	recentInvestigationCaseTypes, err := s.repo.InvestigationCaseTypes(ctx, tenantID, recentInvestigationIDs)
	if err != nil {
		return nil, internalError("build case control dashboard", err)
	}

	return buildCaseControlDashboard(
		generatedAt,
		resolutionFrom,
		caseReport,
		resolved,
		dueIn30Days,
		investigationStatus,
		investigationCaseType,
		recentCases,
		activeInvestigations,
		recentInvestigations,
		recentInvestigationCaseTypes,
	), nil
}

func buildCaseControlDashboard(
	generatedAt time.Time,
	resolutionFrom time.Time,
	report *model.CaseReport,
	resolved int,
	dueIn30Days int,
	investigationStatus []model.CountBucket,
	investigationCaseType []model.CountBucket,
	recentCases []dto.LegalCaseListItem,
	activeInvestigations []model.LegalInvestigation,
	recentInvestigations []model.LegalInvestigation,
	recentInvestigationCaseTypes map[uuid.UUID]string,
) *model.CaseControlDashboard {
	if report == nil {
		report = &model.CaseReport{}
	}

	closed := countBucket(report.ByStatus, string(model.CaseStatusClosed))
	cancelled := countBucket(report.ByStatus, string(model.CaseStatusCancelled))
	onHold := countBucket(report.ByStatus, "on_hold")
	underReview := countBucket(report.ByStatus, string(model.CaseStatusPhase1)) +
		countBucket(report.ByStatus, string(model.CaseStatusPhase2))
	activeCases := report.Total - closed - cancelled
	if activeCases < 0 {
		activeCases = 0
	}

	investigationTotal := 0
	ongoingInvestigations := 0
	for _, bucket := range investigationStatus {
		investigationTotal += bucket.Count
		if _, ok := ongoingInvestigationStatuses[bucket.Key]; ok {
			ongoingInvestigations += bucket.Count
		}
	}

	recentRows := make([]model.CaseControlRecentCase, len(recentCases))
	for i, row := range recentCases {
		recentRows[i] = model.CaseControlRecentCase{
			ID:                row.ID,
			CaseNumber:        row.CaseNumber,
			Title:             row.Title,
			CaseType:          row.CaseType,
			CompanyStatus:     row.CompanyStatus,
			Status:            row.Status,
			Priority:          row.Priority,
			ResponsibleLawyer: row.ResponsibleLawyer,
			Department:        row.Department,
			NextHearingDate:   row.NextHearingDate,
			PartyCount:        row.PartyCount,
			UpdatedAt:         row.UpdatedAt,
		}
	}

	activeRows := caseControlActiveInvestigationRows(activeInvestigations)
	recentInvestigationRows := caseControlRecentInvestigationRows(recentInvestigations, recentInvestigationCaseTypes)

	return &model.CaseControlDashboard{
		GeneratedAt: generatedAt,
		ResolutionWindow: model.CaseControlResolutionWindow{
			From: resolutionFrom,
			To:   generatedAt,
		},
		Cases: model.CaseControlCases{
			Total:             report.Total,
			Active:            activeCases,
			UnderReview:       underReview,
			DueIn30Days:       dueIn30Days,
			Closed:            closed,
			Cancelled:         cancelled,
			OnHold:            onHold,
			ResolvedLast7Days: resolved,
			ByType:            nonNilCountBuckets(report.ByType),
			ByStatus:          nonNilCountBuckets(report.ByStatus),
			ByCompanyRole:     nonNilCountBuckets(report.ByCompanyRole),
			Recent:            recentRows,
		},
		Investigations: model.CaseControlInvestigations{
			Total:      investigationTotal,
			Ongoing:    ongoingInvestigations,
			ByStatus:   nonNilCountBuckets(investigationStatus),
			ByCaseType: nonNilCountBuckets(investigationCaseType),
			Active:     activeRows,
			Recent:     recentInvestigationRows,
		},
	}
}

func caseControlActiveInvestigationRows(items []model.LegalInvestigation) []model.CaseControlActiveInvestigation {
	rows := make([]model.CaseControlActiveInvestigation, len(items))
	for i, item := range items {
		rows[i] = model.CaseControlActiveInvestigation{
			ID:                  item.ID,
			InvestigationNumber: item.InvestigationNumber,
			Subject:             item.Subject,
			LeadInvestigator:    item.LeadInvestigator,
			Status:              item.Status,
			Priority:            item.Priority,
			Department:          item.Department,
			Findings:            item.Findings,
			Recommendations:     item.Recommendations,
			CreatedAt:           item.CreatedAt,
			UpdatedAt:           item.UpdatedAt,
		}
	}
	return rows
}

func caseControlRecentInvestigationRows(items []model.LegalInvestigation, caseTypes map[uuid.UUID]string) []model.CaseControlRecentInvestigation {
	rows := make([]model.CaseControlRecentInvestigation, len(items))
	for i, item := range items {
		rows[i] = model.CaseControlRecentInvestigation{
			ID:                  item.ID,
			InvestigationNumber: item.InvestigationNumber,
			LeadInvestigator:    item.LeadInvestigator,
			Status:              item.Status,
			Priority:            item.Priority,
			UpdatedAt:           item.UpdatedAt,
		}
		if caseType, ok := caseTypes[item.ID]; ok {
			rows[i].CaseType = &caseType
		}
	}
	return rows
}

func countBucket(buckets []model.CountBucket, key string) int {
	for _, bucket := range buckets {
		if bucket.Key == key {
			return bucket.Count
		}
	}
	return 0
}

func nonNilCountBuckets(buckets []model.CountBucket) []model.CountBucket {
	if buckets == nil {
		return []model.CountBucket{}
	}
	return buckets
}
