package expression

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// nowFunc is the clock used by the now() FEEL builtin. It is a package var so
// tests can pin a deterministic instant. Production keeps the real clock.
var nowFunc = func() time.Time { return time.Now().UTC() }

// evalCall dispatches a FEEL function call. The library is intentionally small,
// pure, and side-effect-free: no I/O, no reflection into the host, no unbounded
// work. Every function fails closed on an argument-count or type error so a
// malformed call surfaces as an evaluation error (the caller then treats the
// condition as unsatisfied after logging) rather than silently returning a
// misleading value.
func (ev *evalState) evalCall(node *astNode, data map[string]interface{}, depth int) (interface{}, error) {
	name := node.fn

	// Evaluate arguments eagerly (no lazy/short-circuit functions in this set).
	args := make([]interface{}, 0, len(node.elements))
	for _, a := range node.elements {
		v, err := ev.eval(a, data, depth+1)
		if err != nil {
			return nil, err
		}
		args = append(args, v)
	}

	switch name {
	// ---- string / collection ----
	case "len":
		return fnLen(args)
	case "contains":
		return fnContains(args)
	case "startsWith":
		return fnStartsWith(args)
	case "endsWith":
		return fnEndsWith(args)
	case "lower":
		return fnLower(args)
	case "upper":
		return fnUpper(args)
	case "trim":
		return fnTrim(args)

	// ---- numeric ----
	case "abs":
		return fnAbs(args)
	case "min":
		return fnMin(args)
	case "max":
		return fnMax(args)
	case "round":
		return fnRound(args)
	case "floor":
		return fnFloor(args)
	case "ceil":
		return fnCeil(args)

	// ---- date / time ----
	case "now":
		return fnNow(args)
	case "date":
		return fnDate(args)
	case "duration":
		return fnDuration(args)
	case "addDuration":
		return fnAddDuration(args)
	case "before":
		return fnBefore(args)
	case "after":
		return fnAfter(args)
	case "daysBetween":
		return fnDaysBetween(args)

	default:
		return nil, fmt.Errorf("unknown function: %s", name)
	}
}

func wantArgs(name string, args []interface{}, n int) error {
	if len(args) != n {
		return fmt.Errorf("%s expects %d argument(s), got %d", name, n, len(args))
	}
	return nil
}

func argString(name string, v interface{}) (string, error) {
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%s expects a string argument, got %T", name, v)
	}
	return s, nil
}

func argFloat(name string, v interface{}) (float64, error) {
	f, ok := toFloat64(v)
	if !ok {
		return 0, fmt.Errorf("%s expects a numeric argument, got %T", name, v)
	}
	return f, nil
}

func argTime(name string, v interface{}) (time.Time, error) {
	switch t := v.(type) {
	case time.Time:
		return t, nil
	case string:
		return parseDate(t)
	default:
		return time.Time{}, fmt.Errorf("%s expects a date/time argument, got %T", name, v)
	}
}

// ---------- string / collection functions ----------

func fnLen(args []interface{}) (interface{}, error) {
	if err := wantArgs("len", args, 1); err != nil {
		return nil, err
	}
	switch v := args[0].(type) {
	case string:
		return int64(len([]rune(v))), nil
	case []interface{}:
		return int64(len(v)), nil
	case map[string]interface{}:
		return int64(len(v)), nil
	case nil:
		return int64(0), nil
	default:
		return nil, fmt.Errorf("len expects a string, list or map, got %T", args[0])
	}
}

func fnContains(args []interface{}) (interface{}, error) {
	if err := wantArgs("contains", args, 2); err != nil {
		return nil, err
	}
	// string contains substring, OR list contains element.
	if s, ok := args[0].(string); ok {
		sub, err := argString("contains", args[1])
		if err != nil {
			return nil, err
		}
		return strings.Contains(s, sub), nil
	}
	if arr, ok := args[0].([]interface{}); ok {
		for _, elem := range arr {
			if compareEqual(args[1], elem) {
				return true, nil
			}
		}
		return false, nil
	}
	return nil, fmt.Errorf("contains expects a string or list as first argument, got %T", args[0])
}

func fnStartsWith(args []interface{}) (interface{}, error) {
	if err := wantArgs("startsWith", args, 2); err != nil {
		return nil, err
	}
	s, err := argString("startsWith", args[0])
	if err != nil {
		return nil, err
	}
	prefix, err := argString("startsWith", args[1])
	if err != nil {
		return nil, err
	}
	return strings.HasPrefix(s, prefix), nil
}

func fnEndsWith(args []interface{}) (interface{}, error) {
	if err := wantArgs("endsWith", args, 2); err != nil {
		return nil, err
	}
	s, err := argString("endsWith", args[0])
	if err != nil {
		return nil, err
	}
	suffix, err := argString("endsWith", args[1])
	if err != nil {
		return nil, err
	}
	return strings.HasSuffix(s, suffix), nil
}

func fnLower(args []interface{}) (interface{}, error) {
	if err := wantArgs("lower", args, 1); err != nil {
		return nil, err
	}
	s, err := argString("lower", args[0])
	if err != nil {
		return nil, err
	}
	return strings.ToLower(s), nil
}

func fnUpper(args []interface{}) (interface{}, error) {
	if err := wantArgs("upper", args, 1); err != nil {
		return nil, err
	}
	s, err := argString("upper", args[0])
	if err != nil {
		return nil, err
	}
	return strings.ToUpper(s), nil
}

func fnTrim(args []interface{}) (interface{}, error) {
	if err := wantArgs("trim", args, 1); err != nil {
		return nil, err
	}
	s, err := argString("trim", args[0])
	if err != nil {
		return nil, err
	}
	return strings.TrimSpace(s), nil
}

// ---------- numeric functions ----------

func fnAbs(args []interface{}) (interface{}, error) {
	if err := wantArgs("abs", args, 1); err != nil {
		return nil, err
	}
	if i, ok := args[0].(int64); ok {
		if i < 0 {
			return -i, nil
		}
		return i, nil
	}
	if i, ok := args[0].(int); ok {
		if i < 0 {
			return int64(-i), nil
		}
		return int64(i), nil
	}
	f, err := argFloat("abs", args[0])
	if err != nil {
		return nil, err
	}
	return math.Abs(f), nil
}

func fnMin(args []interface{}) (interface{}, error) {
	nums, err := numericVarargs("min", args)
	if err != nil {
		return nil, err
	}
	m := nums[0]
	for _, v := range nums[1:] {
		if v < m {
			m = v
		}
	}
	return m, nil
}

func fnMax(args []interface{}) (interface{}, error) {
	nums, err := numericVarargs("max", args)
	if err != nil {
		return nil, err
	}
	m := nums[0]
	for _, v := range nums[1:] {
		if v > m {
			m = v
		}
	}
	return m, nil
}

// numericVarargs accepts either N numeric scalars or a single list argument of
// numbers, returning them as a non-empty []float64 (fail-closed on empty / bad
// types).
func numericVarargs(name string, args []interface{}) ([]float64, error) {
	if len(args) == 1 {
		if arr, ok := args[0].([]interface{}); ok {
			args = arr
		}
	}
	if len(args) == 0 {
		return nil, fmt.Errorf("%s expects at least one numeric argument", name)
	}
	out := make([]float64, len(args))
	for i, a := range args {
		f, ok := toFloat64(a)
		if !ok {
			return nil, fmt.Errorf("%s expects numeric arguments, got %T", name, a)
		}
		out[i] = f
	}
	return out, nil
}

func fnRound(args []interface{}) (interface{}, error) {
	if len(args) != 1 && len(args) != 2 {
		return nil, fmt.Errorf("round expects 1 or 2 arguments, got %d", len(args))
	}
	f, err := argFloat("round", args[0])
	if err != nil {
		return nil, err
	}
	places := 0
	if len(args) == 2 {
		p, err := argFloat("round", args[1])
		if err != nil {
			return nil, err
		}
		places = int(p)
	}
	if places < 0 || places > 15 {
		return nil, fmt.Errorf("round: places out of range: %d", places)
	}
	factor := math.Pow(10, float64(places))
	return math.Round(f*factor) / factor, nil
}

func fnFloor(args []interface{}) (interface{}, error) {
	if err := wantArgs("floor", args, 1); err != nil {
		return nil, err
	}
	f, err := argFloat("floor", args[0])
	if err != nil {
		return nil, err
	}
	return int64(math.Floor(f)), nil
}

func fnCeil(args []interface{}) (interface{}, error) {
	if err := wantArgs("ceil", args, 1); err != nil {
		return nil, err
	}
	f, err := argFloat("ceil", args[0])
	if err != nil {
		return nil, err
	}
	return int64(math.Ceil(f)), nil
}

// ---------- date / time functions ----------

func fnNow(args []interface{}) (interface{}, error) {
	if err := wantArgs("now", args, 0); err != nil {
		return nil, err
	}
	return nowFunc(), nil
}

// fnDate parses a date/time string into a time.Time. Accepts RFC3339 and the
// common date-only "2006-01-02" form.
func fnDate(args []interface{}) (interface{}, error) {
	if err := wantArgs("date", args, 1); err != nil {
		return nil, err
	}
	s, err := argString("date", args[0])
	if err != nil {
		return nil, err
	}
	return parseDate(s)
}

func parseDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("date: cannot parse %q as a date/time", s)
}

// fnDuration parses an ISO-8601-ish / Go duration string into a time.Duration
// (represented as a float64 of nanoseconds so it can be added by addDuration and
// compared numerically). We accept Go durations ("24h", "90m", "1h30m") and a
// small "<n>d" day form.
func fnDuration(args []interface{}) (interface{}, error) {
	if err := wantArgs("duration", args, 1); err != nil {
		return nil, err
	}
	s, err := argString("duration", args[0])
	if err != nil {
		return nil, err
	}
	d, err := parseDuration(s)
	if err != nil {
		return nil, err
	}
	return d, nil
}

func parseDuration(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	// day suffix: "<n>d"
	if strings.HasSuffix(s, "d") && !strings.ContainsAny(s, "hms") {
		var days float64
		if _, err := fmt.Sscanf(s, "%fd", &days); err == nil {
			return time.Duration(days * 24 * float64(time.Hour)), nil
		}
	}
	d, err := time.ParseDuration(s)
	if err != nil {
		return 0, fmt.Errorf("duration: cannot parse %q: %w", s, err)
	}
	return d, nil
}

// fnAddDuration adds a duration to a date/time: addDuration(date, duration).
// The duration may be a time.Duration (from duration()) or a duration string.
func fnAddDuration(args []interface{}) (interface{}, error) {
	if err := wantArgs("addDuration", args, 2); err != nil {
		return nil, err
	}
	t, err := argTime("addDuration", args[0])
	if err != nil {
		return nil, err
	}
	var d time.Duration
	switch v := args[1].(type) {
	case time.Duration:
		d = v
	case string:
		d, err = parseDuration(v)
		if err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("addDuration expects a duration as second argument, got %T", args[1])
	}
	return t.Add(d), nil
}

func fnBefore(args []interface{}) (interface{}, error) {
	if err := wantArgs("before", args, 2); err != nil {
		return nil, err
	}
	a, err := argTime("before", args[0])
	if err != nil {
		return nil, err
	}
	b, err := argTime("before", args[1])
	if err != nil {
		return nil, err
	}
	return a.Before(b), nil
}

func fnAfter(args []interface{}) (interface{}, error) {
	if err := wantArgs("after", args, 2); err != nil {
		return nil, err
	}
	a, err := argTime("after", args[0])
	if err != nil {
		return nil, err
	}
	b, err := argTime("after", args[1])
	if err != nil {
		return nil, err
	}
	return a.After(b), nil
}

func fnDaysBetween(args []interface{}) (interface{}, error) {
	if err := wantArgs("daysBetween", args, 2); err != nil {
		return nil, err
	}
	a, err := argTime("daysBetween", args[0])
	if err != nil {
		return nil, err
	}
	b, err := argTime("daysBetween", args[1])
	if err != nil {
		return nil, err
	}
	diff := b.Sub(a).Hours() / 24
	return int64(math.Trunc(diff)), nil
}
