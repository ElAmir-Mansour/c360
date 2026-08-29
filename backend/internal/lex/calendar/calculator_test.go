package calendar

import (
	"testing"
	"time"
)

// riyadh is the canonical test timezone (UTC+3, no DST) which keeps the expected
// instants unambiguous.
func riyadh(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Asia/Riyadh")
	if err != nil {
		t.Fatalf("load Asia/Riyadh: %v", err)
	}
	return loc
}

// standardSnapshot models a Sun–Thu, 09:00–17:00 work week with Fri/Sat off (the
// Saudi default). Sunday=0 … Thursday=4 are working; Friday=5, Saturday=6 off.
func standardSnapshot(loc *time.Location) WorkingCalendarSnapshot {
	day := []WorkingSegment{{Start: 9 * 60, End: 17 * 60}}
	std := map[time.Weekday][]WorkingSegment{
		time.Sunday:    day,
		time.Monday:    day,
		time.Tuesday:   day,
		time.Wednesday: day,
		time.Thursday:  day,
	}
	return WorkingCalendarSnapshot{Location: loc, Standard: std}
}

func at(loc *time.Location, y int, m time.Month, d, hh, mm int) time.Time {
	return time.Date(y, m, d, hh, mm, 0, 0, loc)
}

func TestIsWorkingTime_WithinAndOutsideHours(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))

	// 2026-06-21 is a Sunday (working day).
	if !c.IsWorkingTime(at(loc, 2026, 6, 21, 10, 0)) {
		t.Errorf("expected Sunday 10:00 to be working time")
	}
	if c.IsWorkingTime(at(loc, 2026, 6, 21, 8, 0)) {
		t.Errorf("expected Sunday 08:00 (before open) to be non-working")
	}
	if c.IsWorkingTime(at(loc, 2026, 6, 21, 17, 0)) {
		t.Errorf("expected Sunday 17:00 (exact close boundary) to be non-working")
	}
}

func TestIsWorkingTime_WeekendSkipped(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	// 2026-06-19 is a Friday, 2026-06-20 is a Saturday.
	if c.IsWorkingTime(at(loc, 2026, 6, 19, 10, 0)) {
		t.Errorf("Friday should be a weekend (non-working)")
	}
	if c.IsWorkingTime(at(loc, 2026, 6, 20, 10, 0)) {
		t.Errorf("Saturday should be a weekend (non-working)")
	}
}

func TestNextWorkingMoment_OverWeekend(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	// Thursday 2026-06-18 18:00 (after close) → next working moment is Sunday
	// 2026-06-21 09:00 (Fri+Sat skipped).
	got := c.NextWorkingMoment(at(loc, 2026, 6, 18, 18, 0))
	want := at(loc, 2026, 6, 21, 9, 0)
	if !got.Equal(want) {
		t.Errorf("NextWorkingMoment over weekend = %s, want %s", got, want)
	}
}

func TestNextWorkingMoment_AlreadyWorking(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	in := at(loc, 2026, 6, 21, 11, 30)
	got := c.NextWorkingMoment(in)
	if !got.Equal(in) {
		t.Errorf("NextWorkingMoment on a working instant = %s, want %s", got, in)
	}
}

func TestAddWorkingDays_SkipsWeekendAndHoliday(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	// Wednesday 2026-06-24 is an official holiday.
	snap.Holidays = []Holiday{{Date: at(loc, 2026, 6, 24, 0, 0)}}
	c := NewCalculator(snap)

	// From Tuesday 2026-06-23 10:00, +1 working day skips the Wed holiday and lands
	// on Thursday 2026-06-25 10:00.
	got := c.AddWorkingDays(at(loc, 2026, 6, 23, 10, 0), 1)
	want := at(loc, 2026, 6, 25, 10, 0)
	if !got.Equal(want) {
		t.Errorf("AddWorkingDays(+1) over holiday = %s, want %s", got, want)
	}

	// From Thursday 2026-06-25 10:00, +1 working day jumps the Fri/Sat weekend to
	// Sunday 2026-06-28 10:00.
	got = c.AddWorkingDays(at(loc, 2026, 6, 25, 10, 0), 1)
	want = at(loc, 2026, 6, 28, 10, 0)
	if !got.Equal(want) {
		t.Errorf("AddWorkingDays(+1) over weekend = %s, want %s", got, want)
	}
}

func TestAddWorkingDays_FromNonWorkingDaySnaps(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	// Friday 2026-06-19 14:00 + 0 working days → snap to Sunday 09:00.
	got := c.AddWorkingDays(at(loc, 2026, 6, 19, 14, 0), 0)
	want := at(loc, 2026, 6, 21, 9, 0)
	if !got.Equal(want) {
		t.Errorf("AddWorkingDays(0) from weekend = %s, want %s", got, want)
	}
}

func TestAddWorkingDays_ZeroFromHolidaySnapsToNextOpen(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	snap.Holidays = []Holiday{{Date: at(loc, 2026, 6, 24, 0, 0)}} // Wednesday.
	c := NewCalculator(snap)

	got := c.AddWorkingDays(at(loc, 2026, 6, 24, 14, 0), 0)
	want := at(loc, 2026, 6, 25, 9, 0)
	if !got.Equal(want) {
		t.Errorf("AddWorkingDays(0) from holiday = %s, want %s", got, want)
	}
}

func TestAddWorkingDays_ZeroFromWorkingDayGapsSnapsForward(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	snap.Standard[time.Sunday] = []WorkingSegment{
		{Start: 9 * 60, End: 13 * 60},
		{Start: 14 * 60, End: 17 * 60},
	}
	c := NewCalculator(snap)

	cases := []struct {
		name  string
		start time.Time
		want  time.Time
	}{
		{
			name:  "before open",
			start: at(loc, 2026, 6, 21, 8, 30),
			want:  at(loc, 2026, 6, 21, 9, 0),
		},
		{
			name:  "split shift break",
			start: at(loc, 2026, 6, 21, 13, 15),
			want:  at(loc, 2026, 6, 21, 14, 0),
		},
		{
			name:  "after close",
			start: at(loc, 2026, 6, 21, 18, 0),
			want:  at(loc, 2026, 6, 22, 9, 0),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := c.AddWorkingDays(tc.start, 0)
			if !got.Equal(tc.want) {
				t.Errorf("AddWorkingDays(0) = %s, want %s", got, tc.want)
			}
		})
	}
}

func TestAddWorkingHours_CrossDay(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	// Sunday 2026-06-21 16:00 + 3h. 1h left today (→17:00), 2h carry to Monday
	// 09:00→11:00.
	got := c.AddWorkingHours(at(loc, 2026, 6, 21, 16, 0), 3*time.Hour)
	want := at(loc, 2026, 6, 22, 11, 0)
	if !got.Equal(want) {
		t.Errorf("AddWorkingHours cross-day = %s, want %s", got, want)
	}
}

func TestAddWorkingHours_WithinSegment(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	got := c.AddWorkingHours(at(loc, 2026, 6, 21, 9, 0), 90*time.Minute)
	want := at(loc, 2026, 6, 21, 10, 30)
	if !got.Equal(want) {
		t.Errorf("AddWorkingHours within segment = %s, want %s", got, want)
	}
}

func TestAddWorkingHours_FromNonWorkingStart(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	// Start before open (08:00) +1h → from 09:00 reaches 10:00.
	got := c.AddWorkingHours(at(loc, 2026, 6, 21, 8, 0), time.Hour)
	want := at(loc, 2026, 6, 21, 10, 0)
	if !got.Equal(want) {
		t.Errorf("AddWorkingHours from before-open = %s, want %s", got, want)
	}
}

func TestAddWorkingHours_DeadlineSkipsHolidayAndWeekend(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	snap.Holidays = []Holiday{{Date: at(loc, 2026, 6, 24, 0, 0)}} // Wednesday.
	c := NewCalculator(snap)

	// Tuesday 16:00 + 12 working hours: Tue 1h, Wed holiday, Thu 8h,
	// Fri/Sat weekend, Sun 3h.
	got := c.AddWorkingHours(at(loc, 2026, 6, 23, 16, 0), 12*time.Hour)
	want := at(loc, 2026, 6, 28, 12, 0)
	if !got.Equal(want) {
		t.Errorf("AddWorkingHours deadline over holiday/weekend = %s, want %s", got, want)
	}
}

func TestSplitShift(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	// Override Sunday with a split shift: 09:00-13:00 and 14:00-17:00 (1h lunch).
	snap.Standard[time.Sunday] = []WorkingSegment{
		{Start: 9 * 60, End: 13 * 60},
		{Start: 14 * 60, End: 17 * 60},
	}
	c := NewCalculator(snap)

	// 12:30 is working, 13:30 (lunch) is not, 14:30 is working again.
	if !c.IsWorkingTime(at(loc, 2026, 6, 21, 12, 30)) {
		t.Errorf("12:30 should be working (first segment)")
	}
	if c.IsWorkingTime(at(loc, 2026, 6, 21, 13, 30)) {
		t.Errorf("13:30 should be non-working (lunch break)")
	}
	if !c.IsWorkingTime(at(loc, 2026, 6, 21, 14, 30)) {
		t.Errorf("14:30 should be working (second segment)")
	}

	// NextWorkingMoment from inside the lunch break jumps to 14:00.
	got := c.NextWorkingMoment(at(loc, 2026, 6, 21, 13, 15))
	want := at(loc, 2026, 6, 21, 14, 0)
	if !got.Equal(want) {
		t.Errorf("NextWorkingMoment in lunch = %s, want %s", got, want)
	}

	// Add 5 working hours from 09:00: 4h fills first segment (→13:00), 1h into
	// second segment → 15:00.
	got = c.AddWorkingHours(at(loc, 2026, 6, 21, 9, 0), 5*time.Hour)
	want = at(loc, 2026, 6, 21, 15, 0)
	if !got.Equal(want) {
		t.Errorf("AddWorkingHours across split shift = %s, want %s", got, want)
	}

	// Working minutes across the whole Sunday = 7h (4h + 3h) = 420 min.
	mins := c.WorkingMinutesBetween(at(loc, 2026, 6, 21, 0, 0), at(loc, 2026, 6, 21, 23, 59))
	if mins != 420 {
		t.Errorf("split-shift working minutes = %d, want 420", mins)
	}
}

func TestRamadanOverlay(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	// Ramadan window covering 2026-06-21..2026-06-25; shorter day 09:00-14:00.
	start := at(loc, 2026, 6, 21, 0, 0)
	end := at(loc, 2026, 6, 25, 0, 0)
	snap.RamadanStart = &start
	snap.RamadanEnd = &end
	short := []WorkingSegment{{Start: 9 * 60, End: 14 * 60}}
	snap.Ramadan = map[time.Weekday][]WorkingSegment{
		time.Sunday:   short,
		time.Monday:   short,
		time.Tuesday:  short,
		time.Thursday: short,
	}
	c := NewCalculator(snap)

	// Inside Ramadan, Sunday 15:00 is now non-working (closes at 14:00).
	if c.IsWorkingTime(at(loc, 2026, 6, 21, 15, 0)) {
		t.Errorf("Ramadan Sunday 15:00 should be non-working")
	}
	if !c.IsWorkingTime(at(loc, 2026, 6, 21, 13, 0)) {
		t.Errorf("Ramadan Sunday 13:00 should be working")
	}

	// Outside Ramadan (2026-06-28 Sunday) the standard 17:00 close applies again.
	if !c.IsWorkingTime(at(loc, 2026, 6, 28, 15, 0)) {
		t.Errorf("post-Ramadan Sunday 15:00 should be working under standard hours")
	}

	// Ramadan working minutes for one Sunday = 5h = 300.
	mins := c.WorkingMinutesBetween(at(loc, 2026, 6, 21, 0, 0), at(loc, 2026, 6, 21, 23, 59))
	if mins != 300 {
		t.Errorf("Ramadan working minutes = %d, want 300", mins)
	}
}

func TestWorkingMinutesBetween_MultiDay(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	// Thursday 2026-06-18 15:00 → Sunday 2026-06-21 11:00.
	// Thu: 15:00-17:00 = 120 min. Fri/Sat off. Sun: 09:00-11:00 = 120 min. Total 240.
	mins := c.WorkingMinutesBetween(at(loc, 2026, 6, 18, 15, 0), at(loc, 2026, 6, 21, 11, 0))
	if mins != 240 {
		t.Errorf("multi-day working minutes = %d, want 240", mins)
	}
	if h := c.WorkingHoursBetween(at(loc, 2026, 6, 18, 15, 0), at(loc, 2026, 6, 21, 11, 0)); h != 4.0 {
		t.Errorf("multi-day working hours = %v, want 4.0", h)
	}
}

func TestWorkingMinutesBetween_EndBeforeStart(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	if mins := c.WorkingMinutesBetween(at(loc, 2026, 6, 21, 12, 0), at(loc, 2026, 6, 21, 11, 0)); mins != 0 {
		t.Errorf("reversed interval working minutes = %d, want 0", mins)
	}
}

func TestEndOfWorkingDay(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	// During Sunday → 17:00 same day.
	got := c.EndOfWorkingDay(at(loc, 2026, 6, 21, 10, 0))
	want := at(loc, 2026, 6, 21, 17, 0)
	if !got.Equal(want) {
		t.Errorf("EndOfWorkingDay during day = %s, want %s", got, want)
	}
	// On Friday (weekend) → end of next working day (Sunday 17:00).
	got = c.EndOfWorkingDay(at(loc, 2026, 6, 19, 10, 0))
	want = at(loc, 2026, 6, 21, 17, 0)
	if !got.Equal(want) {
		t.Errorf("EndOfWorkingDay on weekend = %s, want %s", got, want)
	}
}

func TestTimezoneConversion(t *testing.T) {
	loc := riyadh(t)
	c := NewCalculator(standardSnapshot(loc))
	// 2026-06-21 06:30 UTC == 09:30 Riyadh, which is working time.
	utcInstant := time.Date(2026, 6, 21, 6, 30, 0, 0, time.UTC)
	if !c.IsWorkingTime(utcInstant) {
		t.Errorf("06:30 UTC (09:30 Riyadh) should be working time")
	}
	// 2026-06-21 05:00 UTC == 08:00 Riyadh, before open.
	if c.IsWorkingTime(time.Date(2026, 6, 21, 5, 0, 0, 0, time.UTC)) {
		t.Errorf("05:00 UTC (08:00 Riyadh) should be non-working")
	}
	// Result is returned in the snapshot timezone.
	got := c.NextWorkingMoment(time.Date(2026, 6, 21, 3, 0, 0, 0, time.UTC))
	if got.Location().String() != loc.String() {
		t.Errorf("NextWorkingMoment location = %s, want %s", got.Location(), loc)
	}
	if want := at(loc, 2026, 6, 21, 9, 0); !got.Equal(want) {
		t.Errorf("NextWorkingMoment from UTC = %s, want %s", got, want)
	}
}

// --- DST correctness (Europe/Brussels) -------------------------------------

// brussels is a DST timezone (CET/CEST). Spring forward 2026: 29 Mar, clocks
// jump 02:00→03:00 (a 23h civil day). Fall back 2026: 25 Oct, clocks repeat
// 02:00→03:00 (a 25h civil day). We model a Mon–Fri 09:00–17:00 week with the
// weekend off, then assert every boundary is wall-clock correct across the
// transition. Crucially, 29 Mar 2026 is a Sunday and 25 Oct 2026 is a Sunday, so
// to exercise the transition on a *working* day we make the week 7 days working.
func brussels(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Brussels")
	if err != nil {
		t.Fatalf("load Europe/Brussels: %v", err)
	}
	return loc
}

// allDaysSnapshot models a 7-day 09:00–17:00 week so DST Sundays are working
// days and we can probe boundaries on the exact transition date.
func allDaysSnapshot(loc *time.Location) WorkingCalendarSnapshot {
	day := []WorkingSegment{{Start: 9 * 60, End: 17 * 60}}
	std := map[time.Weekday][]WorkingSegment{
		time.Sunday:    day,
		time.Monday:    day,
		time.Tuesday:   day,
		time.Wednesday: day,
		time.Thursday:  day,
		time.Friday:    day,
		time.Saturday:  day,
	}
	return WorkingCalendarSnapshot{Location: loc, Standard: std}
}

// TestDST_SpringForward_BoundariesAreWallClock guards the atMinute fix. On a
// 23h spring-forward day a naive "startOfDay + 17h Duration" lands at 18:00; the
// rebuilt boundary must land at wall-clock 17:00.
func TestDST_SpringForward_BoundariesAreWallClock(t *testing.T) {
	loc := brussels(t)
	c := NewCalculator(allDaysSnapshot(loc))

	// 2026-03-29 is the spring-forward Sunday (02:00→03:00). The close boundary
	// must be 17:00 wall-clock, not 18:00.
	eod := c.EndOfWorkingDay(at(loc, 2026, 3, 29, 10, 0))
	wantClose := at(loc, 2026, 3, 29, 17, 0)
	if !eod.Equal(wantClose) {
		t.Fatalf("spring-forward EndOfWorkingDay = %s, want %s", eod, wantClose)
	}
	if _, off := eod.Zone(); off != 2*3600 {
		t.Errorf("spring-forward 17:00 should be in CEST (+2h), got offset %ds", off)
	}

	// 16:59 is still working, exactly 17:00 is the close boundary (non-working).
	if !c.IsWorkingTime(at(loc, 2026, 3, 29, 16, 59)) {
		t.Errorf("spring-forward 16:59 should be working")
	}
	if c.IsWorkingTime(at(loc, 2026, 3, 29, 17, 0)) {
		t.Errorf("spring-forward 17:00 (close) should be non-working")
	}

	// Before-open snap: 08:00 → NextWorkingMoment lands at 09:00 wall-clock.
	nwm := c.NextWorkingMoment(at(loc, 2026, 3, 29, 8, 0))
	wantOpen := at(loc, 2026, 3, 29, 9, 0)
	if !nwm.Equal(wantOpen) {
		t.Errorf("spring-forward NextWorkingMoment = %s, want %s", nwm, wantOpen)
	}
}

// TestDST_SpringForward_AddWorkingHours verifies elapsed working math across the
// 02:00→03:00 gap stays wall-clock anchored. Working hours are 09:00–17:00 which
// do not include the gap, so 3 working hours from 14:00 lands at 17:00 (boundary)
// then rolls to the next day's 09:00 if more is needed.
func TestDST_SpringForward_AddWorkingHours(t *testing.T) {
	loc := brussels(t)
	c := NewCalculator(allDaysSnapshot(loc))

	// 2026-03-29 14:00 + 3h → 17:00 close, then 09:00 next day for the boundary
	// roll. Exactly 3h fills 14:00→17:00, so result is 17:00 close which
	// AddWorkingHours returns as the next working moment (next day 09:00).
	got := c.AddWorkingHours(at(loc, 2026, 3, 29, 14, 0), 3*time.Hour)
	// 14:00→17:00 is exactly 3 working hours; the implementation returns
	// atMinute(day, segStart+remaining) == 17:00 wall-clock.
	want := at(loc, 2026, 3, 29, 17, 0)
	if !got.Equal(want) {
		t.Fatalf("spring-forward AddWorkingHours = %s, want %s", got, want)
	}

	// 2h from 16:00: 1h to 17:00, then carry 1h to next day 09:00→10:00.
	got = c.AddWorkingHours(at(loc, 2026, 3, 29, 16, 0), 2*time.Hour)
	want = at(loc, 2026, 3, 30, 10, 0)
	if !got.Equal(want) {
		t.Errorf("spring-forward AddWorkingHours carry = %s, want %s", got, want)
	}
}

// TestDST_SpringForward_WorkingMinutesBetween asserts a full working day on the
// 23h spring-forward Sunday is still 8 working hours of wall-clock segments
// (09:00–17:00), because the skipped hour (02:00–03:00) is outside working hours.
func TestDST_SpringForward_WorkingMinutesBetween(t *testing.T) {
	loc := brussels(t)
	c := NewCalculator(allDaysSnapshot(loc))
	mins := c.WorkingMinutesBetween(at(loc, 2026, 3, 29, 0, 0), at(loc, 2026, 3, 29, 23, 59))
	if mins != 8*60 {
		t.Errorf("spring-forward working minutes = %d, want 480", mins)
	}
}

// TestDST_FallBack_BoundariesAreWallClock guards the fall-back (25h) day where
// 02:00–03:00 occurs twice. Working boundaries 09:00/17:00 must still be at the
// right wall-clock instants and a full day is 8 working hours.
func TestDST_FallBack_BoundariesAreWallClock(t *testing.T) {
	loc := brussels(t)
	c := NewCalculator(allDaysSnapshot(loc))

	// 2026-10-25 is the fall-back Sunday (25h day).
	eod := c.EndOfWorkingDay(at(loc, 2026, 10, 25, 10, 0))
	wantClose := at(loc, 2026, 10, 25, 17, 0)
	if !eod.Equal(wantClose) {
		t.Fatalf("fall-back EndOfWorkingDay = %s, want %s", eod, wantClose)
	}
	if _, off := eod.Zone(); off != 1*3600 {
		t.Errorf("fall-back 17:00 should be in CET (+1h), got offset %ds", off)
	}

	if !c.IsWorkingTime(at(loc, 2026, 10, 25, 9, 0)) {
		t.Errorf("fall-back 09:00 should be working")
	}
	if c.IsWorkingTime(at(loc, 2026, 10, 25, 17, 0)) {
		t.Errorf("fall-back 17:00 (close) should be non-working")
	}

	mins := c.WorkingMinutesBetween(at(loc, 2026, 10, 25, 0, 0), at(loc, 2026, 10, 25, 23, 59))
	if mins != 8*60 {
		t.Errorf("fall-back working minutes = %d, want 480", mins)
	}
}

// TestDST_FallBack_AddWorkingHours checks elapsed math on the 25h day stays
// wall-clock anchored (the repeated hour is outside working hours).
func TestDST_FallBack_AddWorkingHours(t *testing.T) {
	loc := brussels(t)
	c := NewCalculator(allDaysSnapshot(loc))
	// 2026-10-25 14:30 + 2h → 16:30 wall-clock (inside the segment).
	got := c.AddWorkingHours(at(loc, 2026, 10, 25, 14, 30), 2*time.Hour)
	want := at(loc, 2026, 10, 25, 16, 30)
	if !got.Equal(want) {
		t.Errorf("fall-back AddWorkingHours = %s, want %s", got, want)
	}
}

// TestValidateSnapshot_RejectsOverlapping asserts ValidateSnapshot surfaces a
// typed *ValidationError for overlapping/adjacent segments instead of silently
// merging them.
func TestValidateSnapshot_RejectsOverlapping(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	snap.Standard[time.Sunday] = []WorkingSegment{
		{Start: 9 * 60, End: 13 * 60},
		{Start: 12 * 60, End: 17 * 60}, // overlaps the first (starts before 13:00)
	}
	err := ValidateSnapshot(snap)
	if err == nil {
		t.Fatalf("expected ValidateSnapshot to reject overlapping segments")
	}
	ve, ok := err.(*ValidationError)
	if !ok {
		t.Fatalf("expected *ValidationError, got %T: %v", err, err)
	}
	if ve.DayOfWeek != time.Sunday || ve.Profile != "standard" {
		t.Errorf("unexpected ValidationError target: %+v", ve)
	}
}

// TestValidateSnapshot_RejectsAdjacent asserts touching (zero-gap) segments are
// also rejected, since an intentional split shift always has a real break.
func TestValidateSnapshot_RejectsAdjacent(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	snap.Standard[time.Monday] = []WorkingSegment{
		{Start: 9 * 60, End: 13 * 60},
		{Start: 13 * 60, End: 17 * 60}, // abuts the first at 13:00
	}
	if err := ValidateSnapshot(snap); err == nil {
		t.Fatalf("expected ValidateSnapshot to reject adjacent segments")
	}
}

// TestValidateSnapshot_AcceptsDisjoint confirms a genuine split shift (with a
// real break) and the standard single-segment week pass validation.
func TestValidateSnapshot_AcceptsDisjoint(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	snap.Standard[time.Sunday] = []WorkingSegment{
		{Start: 9 * 60, End: 13 * 60},
		{Start: 14 * 60, End: 17 * 60}, // 1h break — valid split shift
	}
	if err := ValidateSnapshot(snap); err != nil {
		t.Fatalf("expected disjoint split shift to validate, got %v", err)
	}
	if err := ValidateSnapshot(standardSnapshot(loc)); err != nil {
		t.Fatalf("expected standard snapshot to validate, got %v", err)
	}
}

func TestNormalizeMergesOverlappingSegments(t *testing.T) {
	loc := riyadh(t)
	snap := standardSnapshot(loc)
	// Overlapping/adjacent segments should merge into one 09:00-17:00 window.
	snap.Standard[time.Sunday] = []WorkingSegment{
		{Start: 9 * 60, End: 12 * 60},
		{Start: 11 * 60, End: 17 * 60},
	}
	c := NewCalculator(snap)
	mins := c.WorkingMinutesBetween(at(loc, 2026, 6, 21, 0, 0), at(loc, 2026, 6, 21, 23, 59))
	if mins != 8*60 {
		t.Errorf("merged segment minutes = %d, want 480", mins)
	}
}
