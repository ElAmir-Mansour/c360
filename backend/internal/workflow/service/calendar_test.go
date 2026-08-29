package service

import (
	"testing"
	"time"
)

// businessWeekCalendar builds a Sun–Thu, 09:00–17:00 calendar in the given
// location with the supplied holiday dates. Sun–Thu mirrors the KSA work week
// (Watheeq / MahamaTech tenants), exercising the weekend-skip logic on
// Friday/Saturday rather than the Western Sat/Sun.
func businessWeekCalendar(loc *time.Location, holidays ...string) Calendar {
	hs := map[string]bool{}
	for _, h := range holidays {
		hs[h] = true
	}
	return Calendar{
		Location: loc,
		Days: map[time.Weekday]WorkingDay{
			time.Sunday:    {StartMinute: 9 * 60, EndMinute: 17 * 60},
			time.Monday:    {StartMinute: 9 * 60, EndMinute: 17 * 60},
			time.Tuesday:   {StartMinute: 9 * 60, EndMinute: 17 * 60},
			time.Wednesday: {StartMinute: 9 * 60, EndMinute: 17 * 60},
			time.Thursday:  {StartMinute: 9 * 60, EndMinute: 17 * 60},
			// Friday & Saturday absent => non-working weekend.
		},
		Holidays: hs,
	}
}

func mustTime(t *testing.T, loc *time.Location, value string) time.Time {
	t.Helper()
	parsed, err := time.ParseInLocation("2006-01-02 15:04", value, loc)
	if err != nil {
		t.Fatalf("parsing %q: %v", value, err)
	}
	return parsed
}

func TestBusinessDeadline(t *testing.T) {
	utc := time.UTC
	cal := businessWeekCalendar(utc)

	// 2026-06-14 is a Sunday; 2026-06-19 Friday and 2026-06-20 Saturday are the
	// weekend. The 8h working day runs 09:00–17:00.
	tests := []struct {
		name     string
		start    string // "2006-01-02 15:04"
		dur      time.Duration
		wantDead string
	}{
		{
			// 4h from Sunday 09:00 stays within the same working day.
			name:     "within single working day",
			start:    "2026-06-14 09:00",
			dur:      4 * time.Hour,
			wantDead: "2026-06-14 13:00",
		},
		{
			// 6h from Sunday 13:00: 4h to close at 17:00, remaining 2h rolls to
			// Monday 09:00 → 11:00.
			name:     "spills into next working day",
			start:    "2026-06-14 13:00",
			dur:      6 * time.Hour,
			wantDead: "2026-06-15 11:00",
		},
		{
			// Start before opening (07:00): budget starts ticking at 09:00.
			name:     "start before opening clamps to open",
			start:    "2026-06-14 07:00",
			dur:      2 * time.Hour,
			wantDead: "2026-06-14 11:00",
		},
		{
			// Start after close (18:00) on Sunday: next opening is Monday 09:00.
			name:     "start after close rolls to next day",
			start:    "2026-06-14 18:00",
			dur:      1 * time.Hour,
			wantDead: "2026-06-15 10:00",
		},
		{
			// 10h from Thursday 13:00: 4h to Thu close, skip Fri+Sat weekend,
			// resume Sunday 09:00, consume remaining 6h → Sunday 15:00.
			name:     "skips weekend (Fri+Sat)",
			start:    "2026-06-18 13:00", // Thursday
			dur:      10 * time.Hour,
			wantDead: "2026-06-21 15:00", // Sunday
		},
		{
			// Zero duration is immediately due (clamped to next opening).
			name:     "zero duration due at next opening",
			start:    "2026-06-14 10:00",
			dur:      0,
			wantDead: "2026-06-14 10:00",
		},
		{
			// A full 8h working day from open lands exactly at close.
			name:     "full day lands at close",
			start:    "2026-06-14 09:00",
			dur:      8 * time.Hour,
			wantDead: "2026-06-14 17:00",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			start := mustTime(t, utc, tc.start)
			want := mustTime(t, utc, tc.wantDead)
			got, err := cal.BusinessDeadline(start, tc.dur)
			if err != nil {
				t.Fatalf("BusinessDeadline error = %v", err)
			}
			if !got.Equal(want) {
				t.Errorf("BusinessDeadline(%s, %s) = %s, want %s",
					tc.start, tc.dur, got.Format("2006-01-02 15:04"), tc.wantDead)
			}
		})
	}
}

func TestBusinessDeadline_SkipsHoliday(t *testing.T) {
	utc := time.UTC
	// Mark Monday 2026-06-15 as a holiday.
	cal := businessWeekCalendar(utc, "2026-06-15")

	// 6h from Sunday 13:00: 4h to Sunday close, then Monday is a holiday, so the
	// remaining 2h resume Tuesday 09:00 → 11:00.
	start := mustTime(t, utc, "2026-06-14 13:00")
	want := mustTime(t, utc, "2026-06-16 11:00") // Tuesday
	got, err := cal.BusinessDeadline(start, 6*time.Hour)
	if err != nil {
		t.Fatalf("BusinessDeadline error = %v", err)
	}
	if !got.Equal(want) {
		t.Errorf("with holiday: got %s, want %s",
			got.Format("2006-01-02 15:04"), want.Format("2006-01-02 15:04"))
	}
}

func TestBusinessDeadline_RespectsTimezone(t *testing.T) {
	riyadh, err := time.LoadLocation("Asia/Riyadh")
	if err != nil {
		t.Skipf("tz database unavailable: %v", err)
	}
	cal := businessWeekCalendar(riyadh)

	// 09:00 Riyadh = 06:00 UTC. A 2h budget from 09:00 local → 11:00 local.
	start := mustTime(t, riyadh, "2026-06-14 09:00")
	got, err := cal.BusinessDeadline(start, 2*time.Hour)
	if err != nil {
		t.Fatalf("BusinessDeadline error = %v", err)
	}
	want := mustTime(t, riyadh, "2026-06-14 11:00")
	if !got.Equal(want) {
		t.Errorf("tz: got %s, want %s", got.In(riyadh).Format("2006-01-02 15:04"), want.Format("2006-01-02 15:04"))
	}
	// The returned instant must be the correct UTC moment regardless of zone.
	wantUTC := want.UTC()
	if !got.UTC().Equal(wantUTC) {
		t.Errorf("tz UTC: got %s, want %s", got.UTC(), wantUTC)
	}
}

func TestBusinessDeadline_NoWorkingHoursErrors(t *testing.T) {
	cal := Calendar{Location: time.UTC, Days: map[time.Weekday]WorkingDay{}}
	if _, err := cal.BusinessDeadline(time.Now(), time.Hour); err == nil {
		t.Fatal("expected error for calendar with no working hours")
	}
}

func TestDefault24x7Calendar_IsPlainWallClock(t *testing.T) {
	cal := Default24x7Calendar()
	start := time.Date(2026, 6, 19, 23, 0, 0, 0, time.UTC) // Friday night
	got, err := cal.BusinessDeadline(start, 3*time.Hour)
	if err != nil {
		t.Fatalf("BusinessDeadline error = %v", err)
	}
	want := start.Add(3 * time.Hour) // crosses midnight, no weekend skip
	if !got.Equal(want) {
		t.Errorf("24x7: got %s, want %s", got, want)
	}
}

func TestIsWithinWorkingHours(t *testing.T) {
	utc := time.UTC
	cal := businessWeekCalendar(utc, "2026-06-15")
	tests := []struct {
		name string
		when string
		want bool
	}{
		{"sunday mid-morning open", "2026-06-14 10:00", true},
		{"sunday before open", "2026-06-14 08:59", false},
		{"sunday at close exclusive", "2026-06-14 17:00", false},
		{"friday weekend closed", "2026-06-19 10:00", false},
		{"saturday weekend closed", "2026-06-20 10:00", false},
		{"monday holiday closed", "2026-06-15 10:00", false},
		{"tuesday open", "2026-06-16 09:00", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			when := mustTime(t, utc, tc.when)
			if got := cal.IsWithinWorkingHours(when); got != tc.want {
				t.Errorf("IsWithinWorkingHours(%s) = %v, want %v", tc.when, got, tc.want)
			}
		})
	}
}

func TestBusinessHoursBetween(t *testing.T) {
	utc := time.UTC
	cal := businessWeekCalendar(utc)

	// Thursday 13:00 → Sunday 12:00: 4h (Thu) + skip weekend + 3h (Sun) = 7h.
	start := mustTime(t, utc, "2026-06-18 13:00") // Thursday
	end := mustTime(t, utc, "2026-06-21 12:00")   // Sunday
	got := cal.BusinessHoursBetween(start, end)
	want := 7 * time.Hour
	if got != want {
		t.Errorf("BusinessHoursBetween = %s, want %s", got, want)
	}

	// Inverse symmetry: end before start yields zero.
	if got := cal.BusinessHoursBetween(end, start); got != 0 {
		t.Errorf("reversed BusinessHoursBetween = %s, want 0", got)
	}
}

func TestHolidaySet(t *testing.T) {
	utc := time.UTC
	d1 := time.Date(2026, 6, 15, 13, 0, 0, 0, utc)
	d2 := time.Date(2026, 12, 25, 0, 0, 0, 0, utc)
	hs := HolidaySet(utc, d1, d2)
	if !hs["2026-06-15"] || !hs["2026-12-25"] {
		t.Errorf("HolidaySet missing keys: %v", hs)
	}
	cal := Calendar{Location: utc, Days: map[time.Weekday]WorkingDay{time.Monday: {StartMinute: 540, EndMinute: 1020}}, Holidays: hs}
	if !cal.IsHoliday(d1) {
		t.Error("d1 should be a holiday")
	}
}
