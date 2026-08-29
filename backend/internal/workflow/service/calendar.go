package service

import (
	"fmt"
	"sort"
	"time"
)

// WP-5 — working-hours / business-calendar math (Design §3.4).
//
// A tenant business calendar lets an SLA expressed in plain duration (e.g.
// "4h") be interpreted in *business* hours: weekends, configured holidays, and
// after-hours time do not count toward the deadline. BusinessDeadline walks the
// calendar forward from a start instant, consuming the requested duration only
// during open working windows, and returns the wall-clock instant at which the
// budget is exhausted. This is deterministic: callers inject the Calendar (and
// the start time), so the SLA loop and tests get identical results.

// Weekday models a day of the week for calendar configuration. It reuses
// time.Weekday so callers can write time.Monday etc. directly.
type Weekday = time.Weekday

// WorkingDay describes the open working window for a single weekday. Hours are
// expressed as minutes-since-midnight in the calendar's location so a window of
// 09:00–17:00 is {Start: 540, End: 1020}. A weekday with no WorkingDay entry is
// treated as fully closed (e.g. a weekend).
type WorkingDay struct {
	// StartMinute is the inclusive opening time, in minutes since local midnight.
	StartMinute int
	// EndMinute is the exclusive closing time, in minutes since local midnight.
	EndMinute int
}

// Duration returns the length of the working window. A malformed window
// (End <= Start) yields a zero duration so it contributes no working time.
func (w WorkingDay) Duration() time.Duration {
	if w.EndMinute <= w.StartMinute {
		return 0
	}
	return time.Duration(w.EndMinute-w.StartMinute) * time.Minute
}

// Calendar is a tenant business calendar: the per-weekday working windows, a set
// of full-day holidays, and the location all of the above are interpreted in.
type Calendar struct {
	// Location is the timezone the working windows and holidays are expressed in.
	// Nil is treated as time.UTC.
	Location *time.Location
	// Days maps each working weekday to its open window. Absent weekdays are
	// non-working (e.g. Friday/Saturday for a Sun–Thu week).
	Days map[time.Weekday]WorkingDay
	// Holidays is the set of full-day holidays, keyed by "2006-01-02" in
	// Location. A holiday is treated as fully closed regardless of Days.
	Holidays map[string]bool
}

// loc returns the calendar location, defaulting to UTC.
func (c Calendar) loc() *time.Location {
	if c.Location == nil {
		return time.UTC
	}
	return c.Location
}

// holidayKey formats a time as the calendar's holiday-map key (local date).
func (c Calendar) holidayKey(t time.Time) string {
	return t.In(c.loc()).Format("2006-01-02")
}

// IsHoliday reports whether the local date of t is a configured holiday.
func (c Calendar) IsHoliday(t time.Time) bool {
	if len(c.Holidays) == 0 {
		return false
	}
	return c.Holidays[c.holidayKey(t)]
}

// IsWorkingDay reports whether t falls on a configured working weekday that is
// not a holiday. It does not consider the time-of-day window.
func (c Calendar) IsWorkingDay(t time.Time) bool {
	local := t.In(c.loc())
	wd, ok := c.Days[local.Weekday()]
	if !ok || wd.Duration() <= 0 {
		return false
	}
	return !c.IsHoliday(local)
}

// windowFor returns the [open, close) instants of the working window for the
// calendar day containing t, and whether the day is open at all. open/close are
// in the calendar location.
func (c Calendar) windowFor(t time.Time) (open, close time.Time, ok bool) {
	local := t.In(c.loc())
	wd, has := c.Days[local.Weekday()]
	if !has || wd.Duration() <= 0 || c.IsHoliday(local) {
		return time.Time{}, time.Time{}, false
	}
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, c.loc())
	open = midnight.Add(time.Duration(wd.StartMinute) * time.Minute)
	close = midnight.Add(time.Duration(wd.EndMinute) * time.Minute)
	return open, close, true
}

// IsWithinWorkingHours reports whether t falls inside an open working window
// (working weekday, not a holiday, and within [open, close)).
func (c Calendar) IsWithinWorkingHours(t time.Time) bool {
	open, close, ok := c.windowFor(t)
	if !ok {
		return false
	}
	local := t.In(c.loc())
	return !local.Before(open) && local.Before(close)
}

// nextOpening returns the first instant at or after t that lies inside an open
// working window. If t is already inside a window, t is returned unchanged.
// It scans forward at most maxScanDays calendar days; if no opening is found in
// that horizon it returns ok=false so callers fail loud rather than hang.
func (c Calendar) nextOpening(t time.Time) (time.Time, bool) {
	const maxScanDays = 3660 // ~10 years; guards against an all-closed calendar.
	cur := t.In(c.loc())
	for i := 0; i < maxScanDays; i++ {
		open, close, ok := c.windowFor(cur)
		if ok {
			switch {
			case cur.Before(open):
				return open, true
			case cur.Before(close):
				return cur, true
			}
			// cur is at/after close: fall through to the next day.
		}
		// Advance to local midnight of the next calendar day.
		y, m, d := cur.Date()
		nextMidnight := time.Date(y, m, d, 0, 0, 0, 0, c.loc()).AddDate(0, 0, 1)
		cur = nextMidnight
	}
	return time.Time{}, false
}

// BusinessDeadline computes the wall-clock deadline that is `dur` of working
// time after `start`, counting only open working windows in the calendar
// (skipping weekends, holidays, and after-hours gaps).
//
//   - If dur <= 0 the deadline is the start instant (or the next opening if start
//     is outside working hours), so a zero-budget SLA is immediately due.
//   - If start is outside a working window, the budget starts ticking at the next
//     opening (no working time is consumed during the closed gap).
//   - The returned instant is in the calendar's location.
//
// An error is returned only if the calendar has no working windows at all (so no
// finite deadline exists) — this surfaces a misconfigured calendar instead of
// silently returning a wrong time.
func (c Calendar) BusinessDeadline(start time.Time, dur time.Duration) (time.Time, error) {
	if c.totalWeeklyWorkingMinutes() == 0 {
		return time.Time{}, fmt.Errorf("business calendar has no working hours; cannot compute deadline")
	}

	cur, ok := c.nextOpening(start)
	if !ok {
		return time.Time{}, fmt.Errorf("no working window found within scan horizon from %s", start)
	}
	if dur <= 0 {
		return cur, nil
	}

	remaining := dur
	for remaining > 0 {
		_, close, ok := c.windowFor(cur)
		if !ok {
			// Should not happen because cur came from nextOpening, but stay safe.
			cur, ok = c.nextOpening(cur)
			if !ok {
				return time.Time{}, fmt.Errorf("no working window found while consuming SLA budget")
			}
			continue
		}

		available := close.Sub(cur)
		if remaining <= available {
			return cur.Add(remaining), nil
		}

		// Consume the rest of today's window and jump to the next opening.
		remaining -= available
		next, ok := c.nextOpening(close)
		if !ok {
			return time.Time{}, fmt.Errorf("no further working window after %s", close)
		}
		cur = next
	}
	return cur, nil
}

// BusinessHoursBetween returns the amount of working time between start and end
// (start inclusive, end exclusive). It is the inverse view used by EvaluateSLA
// to ask "how much business time has elapsed since the task was created". If end
// is before start the result is zero.
func (c Calendar) BusinessHoursBetween(start, end time.Time) time.Duration {
	if !end.After(start) {
		return 0
	}
	if c.totalWeeklyWorkingMinutes() == 0 {
		return 0
	}

	var total time.Duration
	cur, ok := c.nextOpening(start)
	if !ok {
		return 0
	}
	for cur.Before(end) {
		_, close, ok := c.windowFor(cur)
		if !ok {
			cur, ok = c.nextOpening(cur)
			if !ok {
				break
			}
			continue
		}
		segmentEnd := close
		if end.Before(segmentEnd) {
			segmentEnd = end
		}
		if segmentEnd.After(cur) {
			total += segmentEnd.Sub(cur)
		}
		if !end.After(close) {
			break
		}
		next, ok := c.nextOpening(close)
		if !ok {
			break
		}
		cur = next
	}
	return total
}

// totalWeeklyWorkingMinutes sums the configured working minutes across the week,
// ignoring holidays. Zero means the calendar can never be open.
func (c Calendar) totalWeeklyWorkingMinutes() int {
	total := 0
	for _, wd := range c.Days {
		if d := wd.Duration(); d > 0 {
			total += int(d / time.Minute)
		}
	}
	return total
}

// Default24x7Calendar returns a calendar that is open every day, all day, in
// UTC. With it BusinessDeadline degrades to plain wall-clock arithmetic, which
// is the correct fallback when a tenant has not configured a calendar.
func Default24x7Calendar() Calendar {
	days := make(map[time.Weekday]WorkingDay, 7)
	for d := time.Sunday; d <= time.Saturday; d++ {
		days[d] = WorkingDay{StartMinute: 0, EndMinute: 24 * 60}
	}
	return Calendar{Location: time.UTC, Days: days, Holidays: map[string]bool{}}
}

// HolidaySet builds a holiday map from a list of dates (only the local date part
// is used). It is a convenience for constructing calendars from stored rows.
func HolidaySet(loc *time.Location, dates ...time.Time) map[string]bool {
	if loc == nil {
		loc = time.UTC
	}
	out := make(map[string]bool, len(dates))
	for _, d := range dates {
		out[d.In(loc).Format("2006-01-02")] = true
	}
	return out
}

// SortedHolidays returns the holiday keys in ascending order — useful for
// deterministic logging and equality checks in tests.
func (c Calendar) SortedHolidays() []string {
	keys := make([]string, 0, len(c.Holidays))
	for k, v := range c.Holidays {
		if v {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}
