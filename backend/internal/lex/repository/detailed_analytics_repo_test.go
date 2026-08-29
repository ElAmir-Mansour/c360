package repository

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestRequestAnalyticsWhereUsesBoundParametersAndInclusiveToDate(t *testing.T) {
	department := "Legal' OR true --"
	priority := "urgent"
	requestType := "consultation"
	from := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.July, 22, 0, 0, 0, 0, time.UTC)

	where, args := requestAnalyticsWhere("lr", DetailedAnalyticsFilter{
		From:       from,
		To:         to,
		Department: &department,
		Priority:   &priority,
		Type:       &requestType,
	}, 2)

	wantWhere := " AND lr.created_at >= $2 AND lr.created_at < $3" +
		" AND COALESCE(NULLIF(BTRIM(lr.department), ''), 'unspecified') = $4" +
		" AND lr.priority = $5 AND lr.request_type = $6"
	if where != wantWhere {
		t.Fatalf("where = %q, want %q", where, wantWhere)
	}
	wantArgs := []any{from, to.AddDate(0, 0, 1), department, priority, requestType}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
	if strings.Contains(where, department) {
		t.Fatalf("filter value was interpolated into SQL: %q", where)
	}
}

func TestRequestAnalyticsWhereMatchesUnspecifiedDepartmentBucket(t *testing.T) {
	department := detailedAnalyticsUnspecified
	from := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, time.July, 27, 0, 0, 0, 0, time.UTC)

	where, args := requestAnalyticsWhere("lr", DetailedAnalyticsFilter{
		From:       from,
		To:         to,
		Department: &department,
	}, 2)

	if !strings.Contains(where, "COALESCE(NULLIF(BTRIM(lr.department), ''), 'unspecified') = $4") {
		t.Fatalf("department predicate does not match grouped sentinel semantics: %q", where)
	}
	wantArgs := []any{from, to.AddDate(0, 0, 1), detailedAnalyticsUnspecified}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("args = %#v, want %#v", args, wantArgs)
	}
}

func TestDetailedAnalyticsDepartmentOptionsIncludeUnspecified(t *testing.T) {
	query := detailedAnalyticsFilterOptionQuery("department", true)
	if !strings.Contains(query, "COALESCE(NULLIF(BTRIM(department), ''), 'unspecified')") {
		t.Fatalf("department options do not expose the grouped sentinel: %q", query)
	}
	if strings.Contains(query, "IS NOT NULL") {
		t.Fatalf("department options still discard blank/null buckets: %q", query)
	}
}

func TestDetailedAnalyticsNonDepartmentOptionsStillExcludeBlankValues(t *testing.T) {
	query := detailedAnalyticsFilterOptionQuery("request_type", false)
	if !strings.Contains(query, "NULLIF(BTRIM(request_type), '') IS NOT NULL") {
		t.Fatalf("service type options lost non-blank filter: %q", query)
	}
	if strings.Contains(query, "'unspecified'") {
		t.Fatalf("service type options unexpectedly gained department sentinel: %q", query)
	}
}

func TestRequestAnalyticsWhereNormalizesAliasDot(t *testing.T) {
	from := time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC)
	to := from
	withoutDot, _ := requestAnalyticsWhere("request", DetailedAnalyticsFilter{From: from, To: to}, 7)
	withDot, _ := requestAnalyticsWhere("request.", DetailedAnalyticsFilter{From: from, To: to}, 7)
	if withoutDot != withDot {
		t.Fatalf("alias variants differ: %q vs %q", withoutDot, withDot)
	}
	if withoutDot != " AND request.created_at >= $7 AND request.created_at < $8" {
		t.Fatalf("unexpected alias predicate: %q", withoutDot)
	}
}

func TestSplitDetailedAnalyticsKeysTrimsDeduplicatesAndDropsEmptyValues(t *testing.T) {
	got := SplitDetailedAnalyticsKeys(" consultation,contract_review, consultation, ,litigation ")
	want := []string{"consultation", "contract_review", "litigation"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("keys = %#v, want %#v", got, want)
	}
}
