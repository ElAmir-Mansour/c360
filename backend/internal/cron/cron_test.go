package cron

import (
	"errors"
	"testing"
	"time"
)

func mustTime(t *testing.T, s string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatalf("parsing time %q: %v", s, err)
	}
	return parsed.UTC()
}

// TestNextAfter_HandComputed asserts NextAfter against expectations computed by
// hand for the canonical cron forms in the prompt, plus edge cases.
func TestNextAfter_HandComputed(t *testing.T) {
	tests := []struct {
		name string
		expr string
		from string
		want string
	}{
		{
			// "*/15 * * * *" fires at minutes 0,15,30,45. From 10:07 -> 10:15.
			name: "every 15 minutes mid-hour",
			expr: "*/15 * * * *",
			from: "2026-06-13T10:07:00Z",
			want: "2026-06-13T10:15:00Z",
		},
		{
			// From exactly 10:15:00 it must advance to the NEXT one (10:30), since
			// NextAfter is strictly-after.
			name: "every 15 minutes strictly after a fire instant",
			expr: "*/15 * * * *",
			from: "2026-06-13T10:15:00Z",
			want: "2026-06-13T10:30:00Z",
		},
		{
			// 45 -> next is the top of the next hour, 00.
			name: "every 15 minutes wraps the hour",
			expr: "*/15 * * * *",
			from: "2026-06-13T10:45:30Z",
			want: "2026-06-13T11:00:00Z",
		},
		{
			// "0 2 * * 1" = 02:00 on Mondays. 2026-06-13 is a Saturday; the next
			// Monday is 2026-06-15, so the fire is 2026-06-15T02:00.
			name: "2am Mondays from a Saturday",
			expr: "0 2 * * 1",
			from: "2026-06-13T10:00:00Z",
			want: "2026-06-15T02:00:00Z",
		},
		{
			// On a Monday before 02:00 it fires the SAME day at 02:00.
			name: "2am Mondays same Monday before 2am",
			expr: "0 2 * * 1",
			from: "2026-06-15T01:30:00Z",
			want: "2026-06-15T02:00:00Z",
		},
		{
			// On a Monday after 02:00 it rolls to the NEXT Monday (2026-06-22).
			name: "2am Mondays same Monday after 2am",
			expr: "0 2 * * 1",
			from: "2026-06-15T02:00:00Z",
			want: "2026-06-22T02:00:00Z",
		},
		{
			// "0 0 1 * *" = midnight on the 1st of each month. From mid-June ->
			// 2026-07-01T00:00.
			name: "monthly on the 1st",
			expr: "0 0 1 * *",
			from: "2026-06-13T12:00:00Z",
			want: "2026-07-01T00:00:00Z",
		},
		{
			// From exactly the fire instant it advances to the next month's 1st.
			name: "monthly on the 1st strictly after",
			expr: "0 0 1 * *",
			from: "2026-07-01T00:00:00Z",
			want: "2026-08-01T00:00:00Z",
		},
		{
			// Year boundary: from December -> next January 1st.
			name: "monthly crosses the year boundary",
			expr: "0 0 1 * *",
			from: "2026-12-15T00:00:00Z",
			want: "2027-01-01T00:00:00Z",
		},
		{
			// Leap-year handling: "0 0 29 2 *" = Feb 29 midnight. 2024 is a leap
			// year; from Jan 2024 the next Feb 29 is 2024-02-29.
			name: "feb 29 in a leap year",
			expr: "0 0 29 2 *",
			from: "2024-01-15T00:00:00Z",
			want: "2024-02-29T00:00:00Z",
		},
		{
			// From just after the 2024 Feb 29, the NEXT Feb 29 is 2028 (2025/26/27
			// are not leap years). This proves real month-length/leap handling.
			name: "feb 29 skips non-leap years to 2028",
			expr: "0 0 29 2 *",
			from: "2024-03-01T00:00:00Z",
			want: "2028-02-29T00:00:00Z",
		},
		{
			// Day-of-month OR day-of-week (Vixie semantics): "0 0 13 * 5" fires on
			// the 13th OR any Friday. From 2026-06-01 the first match is Friday
			// 2026-06-05 (a Friday before the 13th).
			name: "dom OR dow picks the earlier Friday",
			expr: "0 0 13 * 5",
			from: "2026-06-01T00:00:00Z",
			want: "2026-06-05T00:00:00Z",
		},
		{
			// Comma list + range in hour: "30 8,17 * * 1-5" = 08:30 and 17:30 on
			// weekdays. From Fri 2026-06-12T09:00 -> same day 17:30.
			name: "comma hours on weekdays later same day",
			expr: "30 8,17 * * 1-5",
			from: "2026-06-12T09:00:00Z",
			want: "2026-06-12T17:30:00Z",
		},
		{
			// From Fri 17:30 onward, weekend is skipped: next is Mon 2026-06-15 08:30.
			name: "comma hours on weekdays skips the weekend",
			expr: "30 8,17 * * 1-5",
			from: "2026-06-12T17:30:00Z",
			want: "2026-06-15T08:30:00Z",
		},
		{
			// "0 0 * * 0" Sundays via 0. 2026-06-13 is Saturday -> next Sunday 06-14.
			name: "sunday as 0",
			expr: "0 0 * * 0",
			from: "2026-06-13T10:00:00Z",
			want: "2026-06-14T00:00:00Z",
		},
		{
			// "0 0 * * 7" Sundays via 7 (alias for 0) -> same answer as above.
			name: "sunday as 7 alias",
			expr: "0 0 * * 7",
			from: "2026-06-13T10:00:00Z",
			want: "2026-06-14T00:00:00Z",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			sched, err := ParseCron(tc.expr)
			if err != nil {
				t.Fatalf("ParseCron(%q): %v", tc.expr, err)
			}
			got := sched.NextAfter(mustTime(t, tc.from))
			want := mustTime(t, tc.want)
			if !got.Equal(want) {
				t.Fatalf("NextAfter(%q from %s) = %s, want %s", tc.expr, tc.from, got.Format(time.RFC3339), want.Format(time.RFC3339))
			}
		})
	}
}

// TestNextAfter_DSTAgnostic proves NextAfter is computed in UTC: feeding a
// non-UTC input yields the same wall-clock-in-UTC fire time regardless of the
// input zone, and a daily fire stays exactly 24h apart across a US DST boundary.
func TestNextAfter_DSTAgnostic(t *testing.T) {
	sched := MustParseCron("0 3 * * *") // 03:00 UTC daily

	// US DST "spring forward" was 2026-03-08. A local-zone input must not shift
	// the UTC fire time.
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Skipf("tz database unavailable: %v", err)
	}
	localInput := time.Date(2026, 3, 7, 23, 0, 0, 0, loc) // 2026-03-08T04:00Z
	got := sched.NextAfter(localInput)
	want := mustTime(t, "2026-03-09T03:00:00Z")
	if !got.Equal(want) {
		t.Fatalf("NextAfter across DST = %s, want %s", got.Format(time.RFC3339), want.Format(time.RFC3339))
	}

	// Two consecutive daily fires are exactly 24h apart in UTC (no DST hour skip).
	first := sched.NextAfter(mustTime(t, "2026-03-07T12:00:00Z"))
	second := sched.NextAfter(first)
	if d := second.Sub(first); d != 24*time.Hour {
		t.Fatalf("daily fires across DST are %v apart, want 24h", d)
	}
}

func TestNextN(t *testing.T) {
	sched := MustParseCron("*/15 * * * *")
	from := mustTime(t, "2026-06-13T10:07:00Z")
	got := sched.NextN(from, 4)
	want := []string{
		"2026-06-13T10:15:00Z",
		"2026-06-13T10:30:00Z",
		"2026-06-13T10:45:00Z",
		"2026-06-13T11:00:00Z",
	}
	if len(got) != len(want) {
		t.Fatalf("NextN returned %d times, want %d", len(got), len(want))
	}
	for i, w := range want {
		if !got[i].Equal(mustTime(t, w)) {
			t.Fatalf("NextN[%d] = %s, want %s", i, got[i].Format(time.RFC3339), w)
		}
	}

	if n := sched.NextN(from, 0); n != nil {
		t.Fatalf("NextN(_, 0) = %v, want nil", n)
	}
}

// TestNextN_Monotonic asserts NextN returns a strictly increasing sequence with
// the requested length for a dense schedule.
func TestNextN_Monotonic(t *testing.T) {
	sched := MustParseCron("0 2 * * 1") // weekly
	got := sched.NextN(mustTime(t, "2026-06-13T00:00:00Z"), 6)
	if len(got) != 6 {
		t.Fatalf("got %d fire times, want 6", len(got))
	}
	for i := 1; i < len(got); i++ {
		if !got[i].After(got[i-1]) {
			t.Fatalf("NextN not strictly increasing at %d: %s !> %s", i, got[i], got[i-1])
		}
		// weekly cadence: each is exactly 7 days after the previous.
		if d := got[i].Sub(got[i-1]); d != 7*24*time.Hour {
			t.Fatalf("weekly gap at %d = %v, want 168h", i, d)
		}
	}
}

func TestParseCron_Errors(t *testing.T) {
	tests := []struct {
		name string
		expr string
	}{
		{"empty", ""},
		{"too few fields", "* * * *"},
		{"too many fields", "* * * * * *"},
		{"minute out of range", "60 * * * *"},
		{"hour out of range", "* 24 * * *"},
		{"dom out of range low", "* * 0 * *"},
		{"dom out of range high", "* * 32 * *"},
		{"month out of range", "* * * 13 *"},
		{"dow out of range", "* * * * 8"},
		{"inverted range", "* * * * 5-1"},
		{"zero step", "*/0 * * * *"},
		{"negative step", "*/-1 * * * *"},
		{"non-numeric", "abc * * * *"},
		{"non-numeric step", "*/x * * * *"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ParseCron(tc.expr); !errors.Is(err, ErrInvalidCron) {
				t.Fatalf("ParseCron(%q) error = %v, want ErrInvalidCron", tc.expr, err)
			}
		})
	}
}

func TestParseCron_AcceptsValidForms(t *testing.T) {
	valid := []string{
		"* * * * *",
		"0 0 * * *",
		"*/15 * * * *",
		"0 2 * * 1",
		"0 0 1 * *",
		"30 8,17 * * 1-5",
		"0 0 29 2 *",
		"15,45 9-17/2 * * *",
		"  0   0   1   1   0  ", // surplus whitespace tolerated
	}
	for _, expr := range valid {
		if _, err := ParseCron(expr); err != nil {
			t.Fatalf("ParseCron(%q) unexpected error: %v", expr, err)
		}
	}
}

// TestNextAfter_Unsatisfiable asserts that an impossible combination (Feb 30th)
// terminates with the zero-value sentinel rather than looping forever.
func TestNextAfter_Unsatisfiable(t *testing.T) {
	sched := MustParseCron("0 0 30 2 *") // February 30th never exists.
	got := sched.NextAfter(mustTime(t, "2026-01-01T00:00:00Z"))
	if !got.IsZero() {
		t.Fatalf("NextAfter for an impossible date = %s, want zero value", got.Format(time.RFC3339))
	}
}

// TestStepFromValue covers the "N/step" Vixie form (single value with a step
// walks to the field max).
func TestStepFromValue(t *testing.T) {
	sched := MustParseCron("0 9/4 * * *") // 09:00, 13:00, 17:00, 21:00.
	got := sched.NextN(mustTime(t, "2026-06-13T00:00:00Z"), 4)
	want := []string{
		"2026-06-13T09:00:00Z",
		"2026-06-13T13:00:00Z",
		"2026-06-13T17:00:00Z",
		"2026-06-13T21:00:00Z",
	}
	for i, w := range want {
		if !got[i].Equal(mustTime(t, w)) {
			t.Fatalf("NextN[%d] = %s, want %s", i, got[i].Format(time.RFC3339), w)
		}
	}
}

// TestExpr asserts the parsed schedule round-trips the (trimmed) source
// expression via Expr().
func TestExpr(t *testing.T) {
	sched := MustParseCron("  */15   *  *  *  * ")
	if got, want := sched.Expr(), "*/15   *  *  *  *"; got != want {
		t.Fatalf("Expr() = %q, want %q", got, want)
	}
}
