package executor

import (
	"fmt"
	"time"

	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// This file holds the shared, executor-package-owned helpers for INTERRUPTING
// boundary events and the event-based gateway timer/message arms. The engine
// (service package) drives boundary scheduling/firing, but the parsing +
// fire-time resolution live here so publish-time validation and runtime agree,
// and so the executor package remains free of a service dependency.

// ResolveBoundaryTimerFireAt computes the absolute fire time for a timer boundary
// / timer gateway-arm from its duration ("PT30M") or fire_at ("...") config,
// resolving any ${...} references against dataCtx. It reuses the SAME ISO-8601
// duration + time parsers the timer step uses, so a boundary timer and a timer
// step express durations identically. A past time is nudged one second into the
// future (mirroring the timer step) so a mis-set boundary still fires promptly
// rather than never.
func ResolveBoundaryTimerFireAt(resolver *expression.VariableResolver, duration, fireAt string, dataCtx map[string]interface{}) (time.Time, error) {
	return resolveBoundaryTimerFireAt(resolver, duration, fireAt, dataCtx)
}

func resolveBoundaryTimerFireAt(resolver *expression.VariableResolver, duration, fireAt string, dataCtx map[string]interface{}) (time.Time, error) {
	switch {
	case duration != "":
		resolved, err := resolver.Resolve(duration, dataCtx)
		if err != nil {
			return time.Time{}, fmt.Errorf("resolving duration: %w", err)
		}
		dur, err := parseDuration(fmt.Sprintf("%v", resolved))
		if err != nil {
			return time.Time{}, fmt.Errorf("parsing duration: %w", err)
		}
		return futureOrNudge(time.Now().UTC().Add(dur)), nil
	case fireAt != "":
		resolved, err := resolver.Resolve(fireAt, dataCtx)
		if err != nil {
			return time.Time{}, fmt.Errorf("resolving fire_at: %w", err)
		}
		parsed, err := parseTime(fmt.Sprintf("%v", resolved))
		if err != nil {
			return time.Time{}, fmt.Errorf("parsing fire_at: %w", err)
		}
		return futureOrNudge(parsed), nil
	default:
		return time.Time{}, fmt.Errorf("timer requires 'duration' or 'fire_at'")
	}
}

func futureOrNudge(t time.Time) time.Time {
	if t.Before(time.Now().UTC()) {
		return time.Now().UTC().Add(1 * time.Second)
	}
	return t
}

// BoundaryMatchesError reports whether an error boundary should fire for a given
// step-failure error. A boundary with no error_code is a catch-all (fires on any
// failure); one with an error_code fires only when the failure message contains
// that code (a coarse but deterministic BPMN error-code match that needs no
// structured error taxonomy).
func BoundaryMatchesError(b model.BoundaryEvent, failureMessage string) bool {
	code := strOf(b.Config, "error_code")
	if code == "" {
		return true
	}
	return contains(failureMessage, code)
}

// contains is a tiny substring check kept local to avoid pulling strings into
// this file's import set solely for one use (the executor package elsewhere uses
// strings; this keeps the helper self-contained).
func contains(haystack, needle string) bool {
	if needle == "" {
		return true
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
