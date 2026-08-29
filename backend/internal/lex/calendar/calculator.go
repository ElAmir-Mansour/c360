// Package calendar is the pure, DB-free working-time arithmetic engine for the
// legal-affairs suite (CAP-020, CAP-021, CAP-029). It computes deadlines and
// elapsed working time over an immutable WorkingCalendarSnapshot composed of a
// weekly working-hours profile, an optional Ramadan overlay, and a set of
// non-working holidays.
//
// The exported Calculator interface is the FROZEN CONTRACT C-1: the SLA,
// Execution, and Reporting modules import this interface (never the repository or
// service) so working-time arithmetic has exactly one implementation. The service
// layer loads a snapshot from the database and hands it to NewCalculator; this
// package performs no I/O of any kind, which keeps it deterministic and trivially
// unit-testable.
//
// All arithmetic is performed in the snapshot's IANA timezone. Inputs in any
// location are converted to that zone before evaluation, and results are returned
// in that zone. Ramadan is an explicit Gregorian window (no Hijri auto-conversion
// in v1).
package calendar

import (
	"fmt"
	"sort"
	"time"
)

// minutesPerDay is the number of minutes in a 24h civil day. Working segments are
// stored as minutes-from-midnight, so the valid range is [0, minutesPerDay].
const minutesPerDay = 24 * 60

// WorkingSegment is one contiguous working window within a single weekday,
// expressed as minutes-from-midnight in the snapshot timezone. A split shift is
// modelled as multiple segments on the same weekday (e.g. 09:00-13:00 and
// 14:00-17:00). Invariant: 0 <= Start < End <= minutesPerDay.
type WorkingSegment struct {
	Start int
	End   int
}

// Holiday is a single non-working calendar date (time component ignored). The Date
// is compared by its civil Y/M/D in the snapshot timezone.
type Holiday struct {
	Date time.Time
}

// WorkingCalendarSnapshot is the immutable, fully-resolved input to a Calculator.
// It is built once (by the service from persisted rows, or directly in a test) and
// never mutated. Weekday keys follow time.Weekday (Sunday = 0 … Saturday = 6).
//
//   - Standard holds the year-round weekly profile.
//   - Ramadan holds the overlay profile applied to dates within
//     [RamadanStart, RamadanEnd] inclusive. When a weekday has no Ramadan entry the
//     Standard profile for that weekday is used (Ramadan shortens working days; it
//     does not, on its own, declare extra days off).
//   - Holidays are individual non-working dates (weekly/official/religious are all
//     flattened into this set by the builder).
type WorkingCalendarSnapshot struct {
	Location     *time.Location
	Standard     map[time.Weekday][]WorkingSegment
	Ramadan      map[time.Weekday][]WorkingSegment
	RamadanStart *time.Time
	RamadanEnd   *time.Time
	Holidays     []Holiday
}

// ValidationError is the typed error returned by ValidateSnapshot when a
// snapshot violates a structural rule (currently: overlapping or adjacent
// working-hours segments on the same profile+weekday). It carries the offending
// weekday, the profile name ("standard" or "ramadan"), and the two segment
// boundaries (minutes-from-midnight) that conflict so the service layer can map
// it onto a field-level validation response.
type ValidationError struct {
	Profile   string
	DayOfWeek time.Weekday
	// FirstEnd is the End boundary of the earlier segment; SecondStart is the
	// Start boundary of the later segment. They overlap/abut when
	// SecondStart <= FirstEnd.
	FirstEnd    int
	SecondStart int
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf(
		"calendar: %s profile weekday %s has overlapping or adjacent working-hours segments (segment starting at minute %d touches/overlaps a segment ending at minute %d)",
		e.Profile, e.DayOfWeek, e.SecondStart, e.FirstEnd,
	)
}

// ValidateSnapshot reports the first structural problem in a snapshot without
// building a Calculator. The service layer SHOULD call this at create/update
// time and surface a field-level error; NewCalculator itself stays total (it
// defensively merges overlaps) so a previously-persisted snapshot can never make
// a running calculator panic. A nil return means the snapshot is structurally
// sound.
//
// Rule enforced: within a single (profile, weekday) the caller-supplied segments
// must be pairwise disjoint AND non-adjacent — two segments [a,b] and [c,d] with
// c <= b are rejected (adjacent because a zero-length break is almost always a
// data-entry error, not an intentional split shift). Out-of-range or inverted
// segments (End <= Start, Start < 0, End > minutesPerDay) are reported too.
func ValidateSnapshot(snapshot WorkingCalendarSnapshot) error {
	if err := validateProfile("standard", snapshot.Standard); err != nil {
		return err
	}
	return validateProfile("ramadan", snapshot.Ramadan)
}

func validateProfile(name string, profile map[time.Weekday][]WorkingSegment) error {
	for wd, segs := range profile {
		// Validate bounds first on the caller's raw segments.
		for _, seg := range segs {
			if seg.Start < 0 || seg.End > minutesPerDay || seg.End <= seg.Start {
				return &ValidationError{
					Profile:     name,
					DayOfWeek:   wd,
					FirstEnd:    seg.End,
					SecondStart: seg.Start,
				}
			}
		}
		// Sort a copy by Start, then reject any pair where the later segment's
		// Start touches or precedes the earlier segment's End.
		ordered := make([]WorkingSegment, len(segs))
		copy(ordered, segs)
		sort.Slice(ordered, func(i, j int) bool {
			if ordered[i].Start != ordered[j].Start {
				return ordered[i].Start < ordered[j].Start
			}
			return ordered[i].End < ordered[j].End
		})
		for i := 1; i < len(ordered); i++ {
			prev := ordered[i-1]
			cur := ordered[i]
			if cur.Start <= prev.End {
				return &ValidationError{
					Profile:     name,
					DayOfWeek:   wd,
					FirstEnd:    prev.End,
					SecondStart: cur.Start,
				}
			}
		}
	}
	return nil
}

// Calculator is the frozen working-time contract (C-1). Every consumer that needs
// to add working days/hours or measure elapsed working time depends on this
// interface, not on a concrete type, a repository, or the database.
type Calculator interface {
	// IsWorkingTime reports whether the instant t falls inside a working segment
	// of a non-holiday day.
	IsWorkingTime(t time.Time) bool

	// NextWorkingMoment returns the earliest instant >= t that is working time. If
	// t is already working time it is returned unchanged (converted to the
	// snapshot timezone).
	NextWorkingMoment(t time.Time) time.Time

	// AddWorkingDays advances start by n whole working days, preserving the
	// time-of-day where it falls within a working segment, otherwise snapping to
	// the start of the resulting working day. n may be zero (snap to the next
	// working moment) but must not be negative.
	AddWorkingDays(start time.Time, n int) time.Time

	// AddWorkingHours advances start by the given working duration, skipping
	// non-working time. A zero or negative duration returns NextWorkingMoment(start).
	AddWorkingHours(start time.Time, d time.Duration) time.Time

	// EndOfWorkingDay returns the end instant of the last working segment of the
	// working day containing (or following) t. For a non-working day it returns the
	// end of the next working day.
	EndOfWorkingDay(t time.Time) time.Time

	// WorkingMinutesBetween returns the number of whole working minutes in
	// [start, end]. If end precedes start the result is zero.
	WorkingMinutesBetween(start, end time.Time) int

	// WorkingHoursBetween is WorkingMinutesBetween expressed in fractional hours.
	WorkingHoursBetween(start, end time.Time) float64

	// Location is the IANA timezone the calculator operates in.
	Location() *time.Location
}

// calculator is the sole implementation of Calculator. It holds a normalized copy
// of the snapshot (sorted, de-duplicated segments and a holiday lookup set) so all
// query methods are allocation-light and order-independent.
type calculator struct {
	loc          *time.Location
	standard     map[time.Weekday][]WorkingSegment
	ramadan      map[time.Weekday][]WorkingSegment
	ramadanStart *time.Time
	ramadanEnd   *time.Time
	holidays     map[string]struct{}
}

// NewCalculator builds an immutable Calculator from a snapshot. The snapshot is
// defensively normalized: segments are clamped to [0, minutesPerDay], sorted, and
// merged where they overlap, and holidays are indexed by civil date in the
// snapshot timezone. A nil Location defaults to UTC.
// DefaultCalculator returns a built-in standard working-time Calculator — KSA
// business hours: Sunday–Thursday 08:00–17:00, Friday/Saturday weekend, the
// Asia/Riyadh timezone, no holidays and no Ramadan overlay. It is the safe
// fallback the service returns when a tenant has not configured (or defaulted) a
// working calendar, so SLA/execution/KPI working-time math ALWAYS resolves a
// frozen Calculator rather than failing the request. A tenant overrides it simply
// by creating a calendar row and marking it default.
func DefaultCalculator() Calculator {
	loc, err := time.LoadLocation("Asia/Riyadh")
	if err != nil {
		loc = time.UTC
	}
	standard := map[time.Weekday][]WorkingSegment{}
	for _, d := range []time.Weekday{time.Sunday, time.Monday, time.Tuesday, time.Wednesday, time.Thursday} {
		standard[d] = []WorkingSegment{{Start: 8 * 60, End: 17 * 60}}
	}
	return NewCalculator(WorkingCalendarSnapshot{
		Location: loc,
		Standard: standard,
		Ramadan:  map[time.Weekday][]WorkingSegment{},
	})
}

func NewCalculator(snapshot WorkingCalendarSnapshot) Calculator {
	loc := snapshot.Location
	if loc == nil {
		loc = time.UTC
	}
	c := &calculator{
		loc:      loc,
		standard: normalizeProfile(snapshot.Standard),
		ramadan:  normalizeProfile(snapshot.Ramadan),
		holidays: make(map[string]struct{}, len(snapshot.Holidays)),
	}
	if snapshot.RamadanStart != nil {
		v := snapshot.RamadanStart.In(loc)
		c.ramadanStart = &v
	}
	if snapshot.RamadanEnd != nil {
		v := snapshot.RamadanEnd.In(loc)
		c.ramadanEnd = &v
	}
	for _, h := range snapshot.Holidays {
		c.holidays[dateKey(h.Date.In(loc))] = struct{}{}
	}
	return c
}

func (c *calculator) Location() *time.Location { return c.loc }

func (c *calculator) IsWorkingTime(t time.Time) bool {
	local := t.In(c.loc)
	if c.isHoliday(local) {
		return false
	}
	minute := local.Hour()*60 + local.Minute()
	for _, seg := range c.segmentsFor(local) {
		// A segment is half-open [Start, End): the instant exactly at End is the
		// boundary and counts as non-working (it is the start of the break / EOD).
		if minute >= seg.Start && minute < seg.End {
			return true
		}
	}
	return false
}

func (c *calculator) NextWorkingMoment(t time.Time) time.Time {
	local := t.In(c.loc)
	// Walk forward at most a couple of years of days; in practice the first or
	// second iteration resolves. The bound guards against a calendar that has no
	// working time at all (returns t unchanged after the scan).
	cursor := local
	for day := 0; day < 366*2; day++ {
		if !c.isHoliday(cursor) {
			segs := c.segmentsFor(cursor)
			minute := cursor.Hour()*60 + cursor.Minute()
			for _, seg := range segs {
				if minute < seg.End {
					if minute < seg.Start {
						return atMinute(cursor, seg.Start)
					}
					// Inside this segment already: this very minute is working.
					return truncateToMinute(cursor)
				}
			}
		}
		// Advance to 00:00 of the next civil day and retry.
		cursor = startOfNextDay(cursor)
	}
	return local
}

func (c *calculator) EndOfWorkingDay(t time.Time) time.Time {
	local := t.In(c.loc)
	cursor := local
	for day := 0; day < 366*2; day++ {
		if !c.isHoliday(cursor) {
			segs := c.segmentsFor(cursor)
			if len(segs) > 0 {
				last := segs[len(segs)-1]
				end := atMinute(cursor, last.End)
				// Only accept this day if its end is still at/after the cursor; a
				// cursor already past EOD rolls to the next working day.
				if !end.Before(truncateToMinute(cursor)) {
					return end
				}
			}
		}
		cursor = startOfNextDay(cursor)
	}
	return local
}

func (c *calculator) AddWorkingDays(start time.Time, n int) time.Time {
	if n < 0 {
		n = 0
	}
	local := start.In(c.loc)
	// Capture the intended time-of-day to preserve across the day hop. This is
	// only meaningful when the anchor itself is a working day; when the start
	// falls on a non-working day we snap to the start of the resulting working
	// day rather than carrying an out-of-hours time forward.
	startMinute := local.Hour()*60 + local.Minute()

	// Snap the anchor to a working day. If start itself is a working day we count
	// from it; otherwise advance to the next working day first.
	cursor := startOfDay(local)
	anchorWasWorkingDay := c.isWorkingDay(cursor)
	if !anchorWasWorkingDay {
		cursor = c.nextWorkingDay(cursor)
	}
	for i := 0; i < n; i++ {
		cursor = c.nextWorkingDay(cursor)
	}

	if !anchorWasWorkingDay {
		// Started on a non-working day: snap to the start of the resulting
		// working day, regardless of the original time-of-day.
		return c.NextWorkingMoment(cursor)
	}

	// Re-apply the original time-of-day, then snap forward to the next working
	// moment so the result always lands inside a working segment.
	candidate := atMinute(cursor, startMinute)
	if c.isWorkingTime(candidate) {
		return candidate
	}
	return c.NextWorkingMoment(candidate)
}

func (c *calculator) AddWorkingHours(start time.Time, d time.Duration) time.Time {
	if d <= 0 {
		return c.NextWorkingMoment(start)
	}
	remaining := int((d + 30*time.Second) / time.Minute) // round to nearest minute
	if remaining <= 0 {
		return c.NextWorkingMoment(start)
	}
	cursor := c.NextWorkingMoment(start)
	for day := 0; day < 366*4 && remaining > 0; {
		segs := c.segmentsFor(cursor)
		minute := cursor.Hour()*60 + cursor.Minute()
		consumed := false
		for _, seg := range segs {
			if c.isHoliday(cursor) {
				break
			}
			if minute >= seg.End {
				continue
			}
			segStart := seg.Start
			if minute > segStart {
				segStart = minute
			}
			available := seg.End - segStart
			if available <= 0 {
				continue
			}
			if remaining <= available {
				return atMinute(cursor, segStart+remaining)
			}
			remaining -= available
			// Jump to the end of this segment and let NextWorkingMoment find the
			// next opening (next segment today or next working day).
			cursor = c.NextWorkingMoment(atMinute(cursor, seg.End))
			consumed = true
			break
		}
		if !consumed {
			cursor = c.NextWorkingMoment(startOfNextDay(cursor))
			day++
		}
	}
	return cursor
}

func (c *calculator) WorkingMinutesBetween(start, end time.Time) int {
	s := start.In(c.loc)
	e := end.In(c.loc)
	if !e.After(s) {
		return 0
	}
	total := 0
	cursor := startOfDay(s)
	endDay := startOfDay(e)
	for !cursor.After(endDay) {
		if !c.isHoliday(cursor) {
			for _, seg := range c.segmentsFor(cursor) {
				segStart := atMinute(cursor, seg.Start)
				segEnd := atMinute(cursor, seg.End)
				// Clip the segment to [s, e].
				if segStart.Before(s) {
					segStart = s
				}
				if segEnd.After(e) {
					segEnd = e
				}
				if segEnd.After(segStart) {
					total += int(segEnd.Sub(segStart) / time.Minute)
				}
			}
		}
		cursor = startOfNextDay(cursor)
	}
	return total
}

func (c *calculator) WorkingHoursBetween(start, end time.Time) float64 {
	return float64(c.WorkingMinutesBetween(start, end)) / 60.0
}

// isWorkingTime is the unexported, already-localized variant used internally to
// avoid redundant timezone conversions.
func (c *calculator) isWorkingTime(local time.Time) bool {
	if c.isHoliday(local) {
		return false
	}
	minute := local.Hour()*60 + local.Minute()
	for _, seg := range c.segmentsFor(local) {
		if minute >= seg.Start && minute < seg.End {
			return true
		}
	}
	return false
}

// segmentsFor returns the working segments that apply to the civil day of local,
// selecting the Ramadan overlay when the day falls within the Ramadan window and a
// Ramadan profile exists for that weekday, otherwise the standard profile.
func (c *calculator) segmentsFor(local time.Time) []WorkingSegment {
	wd := local.Weekday()
	if c.inRamadan(local) {
		if segs, ok := c.ramadan[wd]; ok {
			return segs
		}
	}
	return c.standard[wd]
}

// inRamadan reports whether the civil date of local falls within the inclusive
// Gregorian Ramadan window.
func (c *calculator) inRamadan(local time.Time) bool {
	if c.ramadanStart == nil || c.ramadanEnd == nil {
		return false
	}
	day := startOfDay(local)
	start := startOfDay(*c.ramadanStart)
	end := startOfDay(*c.ramadanEnd)
	return !day.Before(start) && !day.After(end)
}

func (c *calculator) isHoliday(local time.Time) bool {
	_, ok := c.holidays[dateKey(local)]
	return ok
}

// isWorkingDay reports whether the civil day of local has any working segment and
// is not a holiday.
func (c *calculator) isWorkingDay(local time.Time) bool {
	if c.isHoliday(local) {
		return false
	}
	return len(c.segmentsFor(local)) > 0
}

// nextWorkingDay returns 00:00 of the first working day strictly after local's day.
func (c *calculator) nextWorkingDay(local time.Time) time.Time {
	cursor := startOfNextDay(startOfDay(local))
	for day := 0; day < 366*2; day++ {
		if c.isWorkingDay(cursor) {
			return cursor
		}
		cursor = startOfNextDay(cursor)
	}
	return cursor
}

// --- helpers ---------------------------------------------------------------

// normalizeProfile copies a weekday→segments map, clamping, sorting, and merging
// overlapping/adjacent segments so downstream arithmetic can assume ordered,
// disjoint windows.
func normalizeProfile(in map[time.Weekday][]WorkingSegment) map[time.Weekday][]WorkingSegment {
	out := make(map[time.Weekday][]WorkingSegment, len(in))
	for wd, segs := range in {
		cleaned := make([]WorkingSegment, 0, len(segs))
		for _, seg := range segs {
			s, e := seg.Start, seg.End
			if s < 0 {
				s = 0
			}
			if e > minutesPerDay {
				e = minutesPerDay
			}
			if e <= s {
				continue
			}
			cleaned = append(cleaned, WorkingSegment{Start: s, End: e})
		}
		if len(cleaned) == 0 {
			continue
		}
		sort.Slice(cleaned, func(i, j int) bool { return cleaned[i].Start < cleaned[j].Start })
		merged := cleaned[:1]
		for _, seg := range cleaned[1:] {
			last := &merged[len(merged)-1]
			if seg.Start <= last.End {
				if seg.End > last.End {
					last.End = seg.End
				}
				continue
			}
			merged = append(merged, seg)
		}
		out[wd] = merged
	}
	return out
}

func dateKey(t time.Time) string {
	return t.Format("2006-01-02")
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func startOfNextDay(t time.Time) time.Time {
	return startOfDay(t).AddDate(0, 0, 1)
}

// atMinute returns the wall-clock instant at minutes-from-midnight on t's civil
// day. A value of minutesPerDay maps to 00:00 of the following day so an
// end-of-day boundary is representable.
//
// DST correctness: the boundary instant is rebuilt with time.Date from the
// (hour, minute) decomposition rather than added as an absolute Duration to
// startOfDay. On a spring-forward day the civil day is short (e.g. 23h in
// Europe/Brussels), so adding an absolute 17h Duration to 00:00 would land at
// 18:00 wall-clock; time.Date instead anchors the result to the requested
// wall-clock 17:00. time.Date also normalizes hour==24 (minutesPerDay) into
// 00:00 of the following day, and resolves wall-clock times that the local DST
// transition skips or repeats to a well-defined instant.
func atMinute(t time.Time, minute int) time.Time {
	day := startOfDay(t)
	hour := minute / 60
	min := minute % 60
	return time.Date(day.Year(), day.Month(), day.Day(), hour, min, 0, 0, t.Location())
}

func truncateToMinute(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), 0, 0, t.Location())
}
