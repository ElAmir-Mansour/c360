// Package cron implements a standard 5-field cron parser and evaluator from
// scratch (no external dependency). It is the single shared implementation used
// across the platform (e.g. internal/dr/drillsched and the workflow scheduler).
//
// The fields, in order, are:
//
//	minute  hour  day-of-month  month  day-of-week
//	0-59    0-23  1-31          1-12   0-6 (Sunday=0; 7 also accepted as Sunday)
//
// Each field supports "*", a single value, comma lists ("1,15,30"), ranges
// ("1-5"), and steps over "*" or a range ("*/15", "1-30/5"). Month and weekday
// names are not supported (callers use numeric expressions). NextAfter(t)
// returns the next instant strictly after t (truncated to minute precision) that
// matches, computed entirely in UTC so it is DST-agnostic, with correct handling
// of month lengths and leap years.
package cron

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ErrInvalidCron is returned by ParseCron for a malformed expression. It wraps
// a human-readable reason.
var ErrInvalidCron = errors.New("invalid cron expression")

// field bounds for each of the five cron positions.
const (
	minuteMin, minuteMax = 0, 59
	hourMin, hourMax     = 0, 23
	domMin, domMax       = 1, 31
	monthMin, monthMax   = 1, 12
	dowMin, dowMax       = 0, 6 // 0 = Sunday; an input 7 is normalised to 0
)

// CronSchedule is a parsed, evaluable 5-field cron expression. The five bitsets each
// hold the matching values for one field; a set bit at index v means value v
// matches. domRestricted/dowRestricted record whether the day-of-month and
// day-of-week fields were "*" — Vixie-cron semantics: when BOTH day fields are
// restricted, a day matches if EITHER matches (OR); when only one is restricted,
// only that one constrains the day (the "*" field imposes no extra restriction).
type CronSchedule struct {
	expr          string
	minute        uint64 // bits 0..59
	hour          uint64 // bits 0..23
	dom           uint64 // bits 1..31
	month         uint64 // bits 1..12
	dow           uint64 // bits 0..6
	domRestricted bool
	dowRestricted bool
}

// Expr returns the original expression the schedule was parsed from.
func (s *CronSchedule) Expr() string { return s.expr }

// ParseCron parses a standard 5-field cron expression. Whitespace between fields
// is collapsed so multiple spaces are tolerated. It returns ErrInvalidCron
// (wrapped with the offending field) for any field that is out of range, has an
// inverted range, a non-positive step, or unparseable tokens.
func ParseCron(expr string) (*CronSchedule, error) {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" {
		return nil, fmt.Errorf("%w: empty expression", ErrInvalidCron)
	}
	parts := strings.Fields(trimmed)
	if len(parts) != 5 {
		return nil, fmt.Errorf("%w: expected 5 fields, got %d", ErrInvalidCron, len(parts))
	}

	minute, _, err := parseField(parts[0], minuteMin, minuteMax, false)
	if err != nil {
		return nil, fmt.Errorf("%w: minute field %q: %v", ErrInvalidCron, parts[0], err)
	}
	hour, _, err := parseField(parts[1], hourMin, hourMax, false)
	if err != nil {
		return nil, fmt.Errorf("%w: hour field %q: %v", ErrInvalidCron, parts[1], err)
	}
	dom, domStar, err := parseField(parts[2], domMin, domMax, false)
	if err != nil {
		return nil, fmt.Errorf("%w: day-of-month field %q: %v", ErrInvalidCron, parts[2], err)
	}
	month, _, err := parseField(parts[3], monthMin, monthMax, false)
	if err != nil {
		return nil, fmt.Errorf("%w: month field %q: %v", ErrInvalidCron, parts[3], err)
	}
	dow, dowStar, err := parseField(parts[4], dowMin, dowMax, true)
	if err != nil {
		return nil, fmt.Errorf("%w: day-of-week field %q: %v", ErrInvalidCron, parts[4], err)
	}

	return &CronSchedule{
		expr:          trimmed,
		minute:        minute,
		hour:          hour,
		dom:           dom,
		month:         month,
		dow:           dow,
		domRestricted: !domStar,
		dowRestricted: !dowStar,
	}, nil
}

// MustParseCron is ParseCron that panics on error. It is for static, known-good
// expressions (e.g. test fixtures and package defaults), never for user input.
func MustParseCron(expr string) *CronSchedule {
	s, err := ParseCron(expr)
	if err != nil {
		panic(err)
	}
	return s
}

// parseField parses one cron field into a bitset over [min,max]. It returns the
// bitset, whether the field was a bare "*" (isStar — needed for the day OR rule),
// and an error. weekday=true accepts 7 as an alias for Sunday (0) so both the
// common "0" and "7" Sunday encodings work.
func parseField(field string, min, max int, weekday bool) (uint64, bool, error) {
	if field == "" {
		return 0, false, errors.New("empty field")
	}
	var bits uint64
	isStar := field == "*"
	for _, token := range strings.Split(field, ",") {
		tokenBits, err := parseToken(token, min, max, weekday)
		if err != nil {
			return 0, false, err
		}
		bits |= tokenBits
	}
	if bits == 0 {
		return 0, false, errors.New("matches no values")
	}
	return bits, isStar, nil
}

// parseToken parses a single comma-separated token: "*", "v", "a-b", "*/step",
// or "a-b/step". A bare "*" expands to the full [min,max] range.
func parseToken(token string, min, max int, weekday bool) (uint64, error) {
	rangePart := token
	step := 1
	hasStep := false

	if slash := strings.IndexByte(token, '/'); slash >= 0 {
		rangePart = token[:slash]
		stepStr := token[slash+1:]
		parsedStep, err := strconv.Atoi(stepStr)
		if err != nil {
			return 0, fmt.Errorf("step %q is not a number", stepStr)
		}
		if parsedStep <= 0 {
			return 0, fmt.Errorf("step %d must be positive", parsedStep)
		}
		step = parsedStep
		hasStep = true
	}

	var lo, hi int
	switch {
	case rangePart == "*":
		lo, hi = min, max
	case strings.IndexByte(rangePart, '-') >= 0:
		dash := strings.IndexByte(rangePart, '-')
		var err error
		lo, err = parseValue(rangePart[:dash], min, max, weekday)
		if err != nil {
			return 0, err
		}
		hi, err = parseValue(rangePart[dash+1:], min, max, weekday)
		if err != nil {
			return 0, err
		}
		if lo > hi {
			return 0, fmt.Errorf("range %s is inverted", rangePart)
		}
	default:
		v, err := parseValue(rangePart, min, max, weekday)
		if err != nil {
			return 0, err
		}
		if hasStep {
			// A single value WITH a step ("9/4") starts at the value and walks to
			// the field max, matching Vixie-cron's treatment of "N/step" as
			// "N-max/step".
			lo, hi = v, max
		} else {
			// A bare single value matches exactly that value.
			lo, hi = v, v
		}
	}

	var bits uint64
	for v := lo; v <= hi; v += step {
		bits |= 1 << uint(v)
	}
	return bits, nil
}

// parseValue parses a single integer cron value, range-checking it. For weekday
// fields it normalises 7 to 0 (both encode Sunday).
func parseValue(s string, min, max int, weekday bool) (int, error) {
	v, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return 0, fmt.Errorf("%q is not a number", s)
	}
	if weekday && v == 7 {
		v = 0
	}
	if v < min || v > max {
		return 0, fmt.Errorf("value %d out of range [%d,%d]", v, min, max)
	}
	return v, nil
}

// matchesDay reports whether the calendar day of t matches the schedule's
// day-of-month / day-of-week fields under Vixie-cron OR semantics:
//   - both restricted  -> match if EITHER dom OR dow matches;
//   - only dom restricted -> match dom only;
//   - only dow restricted -> match dow only;
//   - neither restricted  -> every day matches.
func (s *CronSchedule) matchesDay(t time.Time) bool {
	domMatch := s.dom&(1<<uint(t.Day())) != 0
	dowMatch := s.dow&(1<<uint(int(t.Weekday()))) != 0

	switch {
	case s.domRestricted && s.dowRestricted:
		return domMatch || dowMatch
	case s.domRestricted:
		return domMatch
	case s.dowRestricted:
		return dowMatch
	default:
		return true
	}
}

// NextAfter returns the next instant strictly after t that matches the schedule,
// at minute precision, computed in UTC. It walks forward field-by-field — first
// finding a matching month, then a matching day (honouring the day OR rule and
// real month lengths / leap years via time.Date normalisation), then hour and
// minute — resetting lower fields to their minimum whenever a higher field
// advances. The search is bounded to a few years ahead so an impossible
// combination (e.g. "0 0 30 2 *", Feb 30th) terminates with a sentinel far-future
// zero value rather than looping forever.
func (s *CronSchedule) NextAfter(t time.Time) time.Time {
	// Work in UTC at minute precision; start from the minute strictly after t.
	t = t.UTC().Truncate(time.Minute).Add(time.Minute)

	// Bound the search: 5 years of minutes is far beyond any real cron period and
	// guarantees termination for unsatisfiable expressions.
	limit := t.AddDate(5, 0, 0)

	for t.Before(limit) {
		// Advance to a matching month, resetting day/time to the month start.
		if s.month&(1<<uint(int(t.Month()))) == 0 {
			t = time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC).AddDate(0, 1, 0)
			continue
		}
		// Advance to a matching day, resetting the time to midnight.
		if !s.matchesDay(t) {
			t = time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 1)
			continue
		}
		// Advance to a matching hour, resetting minutes to 0.
		if s.hour&(1<<uint(t.Hour())) == 0 {
			t = time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), 0, 0, 0, time.UTC).Add(time.Hour)
			continue
		}
		// Advance to a matching minute.
		if s.minute&(1<<uint(t.Minute())) == 0 {
			t = t.Add(time.Minute)
			continue
		}
		return t
	}
	// Unsatisfiable within the horizon: return the zero value so callers can treat
	// it as "never" without misinterpreting a real time.
	return time.Time{}
}

// NextN returns the next n fire times strictly after t, in ascending order. It
// stops early (returning fewer than n) if the schedule has no further fire time
// within the search horizon. n <= 0 returns an empty slice.
func (s *CronSchedule) NextN(t time.Time, n int) []time.Time {
	if n <= 0 {
		return nil
	}
	out := make([]time.Time, 0, n)
	cursor := t
	for i := 0; i < n; i++ {
		next := s.NextAfter(cursor)
		if next.IsZero() {
			break
		}
		out = append(out, next)
		cursor = next
	}
	return out
}
