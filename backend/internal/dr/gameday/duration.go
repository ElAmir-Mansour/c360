package gameday

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Duration is a time.Duration that marshals to / unmarshals from a Go duration
// STRING (e.g. "30s", "5m") in JSON, and also accepts a bare number of
// nanoseconds. Scenario step expectations carry durations (detect_within,
// recover_within); storing them as human-readable strings keeps the persisted
// scenario JSON and the API contract legible ("30s" rather than 30000000000).
type Duration time.Duration

// MarshalJSON renders the duration as its Go string form.
func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Duration(d).String())
}

// UnmarshalJSON accepts either a Go duration string ("30s") or a numeric
// nanosecond count. An empty string / null decodes to a zero duration.
func (d *Duration) UnmarshalJSON(b []byte) error {
	if len(b) == 0 || string(b) == "null" {
		*d = 0
		return nil
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return fmt.Errorf("gameday: decoding duration: %w", err)
	}
	switch n := v.(type) {
	case float64:
		*d = Duration(time.Duration(n))
		return nil
	case string:
		if n == "" {
			*d = 0
			return nil
		}
		parsed, err := time.ParseDuration(n)
		if err != nil {
			return fmt.Errorf("gameday: parsing duration %q: %w", n, err)
		}
		*d = Duration(parsed)
		return nil
	default:
		return errors.New("gameday: duration must be a string or a number")
	}
}

// Std returns the duration as a time.Duration.
func (d Duration) Std() time.Duration { return time.Duration(d) }

// Milliseconds returns the duration in whole milliseconds.
func (d Duration) Milliseconds() int64 { return time.Duration(d).Milliseconds() }
