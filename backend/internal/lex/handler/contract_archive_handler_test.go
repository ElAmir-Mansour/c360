package handler

import (
	"net/http/httptest"
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
)

func TestParseArchiveFilterCarriesAdvancedFilters(t *testing.T) {
	req := httptest.NewRequest("GET", "/contracts/archived?page=2&per_page=50&search=msa&archive_status=archived&archive_date_from=2026-07-01&archive_date_to=2026-07-31&archived_by=11111111-1111-1111-1111-111111111111&owner_user_id=22222222-2222-2222-2222-222222222222&status=active&type=vendor&department=Legal&tag=Confidential", nil)

	filter, err := parseArchiveFilter(req)
	if err != nil {
		t.Fatalf("parseArchiveFilter() error = %v", err)
	}
	if filter.Page != 2 || filter.PerPage != 50 || filter.Search != "msa" {
		t.Fatalf("pagination/search not carried: %+v", filter)
	}
	if filter.ArchiveStatus != service.ArchiveStatusArchived {
		t.Fatalf("archive status = %q", filter.ArchiveStatus)
	}
	if filter.Status == nil || *filter.Status != model.ContractStatusActive {
		t.Fatalf("status = %v", filter.Status)
	}
	if filter.Type == nil || *filter.Type != model.ContractTypeVendor {
		t.Fatalf("type = %v", filter.Type)
	}
	if filter.ArchivedBy == nil || filter.OwnerUserID == nil {
		t.Fatalf("user filters missing: archived_by=%v owner=%v", filter.ArchivedBy, filter.OwnerUserID)
	}
	if filter.Department != "Legal" || filter.Tag != "Confidential" {
		t.Fatalf("department/tag not carried: %+v", filter)
	}
	wantFrom := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2026, 7, 31, 23, 59, 59, int(time.Second-time.Nanosecond), time.UTC)
	if filter.ArchiveFrom == nil || !filter.ArchiveFrom.Equal(wantFrom) {
		t.Fatalf("archive from = %v, want %v", filter.ArchiveFrom, wantFrom)
	}
	if filter.ArchiveTo == nil || !filter.ArchiveTo.Equal(wantTo) {
		t.Fatalf("archive to = %v, want %v", filter.ArchiveTo, wantTo)
	}
}

func TestParseArchiveFilterRejectsInvalidValues(t *testing.T) {
	tests := []string{
		"/contracts/archived?archive_status=deleted",
		"/contracts/archived?status=not-a-status",
		"/contracts/archived?type=not-a-type",
		"/contracts/archived?archived_by=not-a-uuid",
		"/contracts/archived?archive_date_from=2026-08-01&archive_date_to=2026-07-01",
	}
	for _, target := range tests {
		t.Run(target, func(t *testing.T) {
			if _, err := parseArchiveFilter(httptest.NewRequest("GET", target, nil)); err == nil {
				t.Fatalf("parseArchiveFilter(%q) error = nil", target)
			}
		})
	}
}
