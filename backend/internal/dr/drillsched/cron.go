// Package drillsched schedules recurring, non-disruptive DR drills and diffs
// consecutive drill results to surface drift. It COMPLEMENTS internal/dr/failover
// (the gated DRILL driver) and internal/dr/registry (the runbook): a schedule
// REQUESTS a drill via the existing DRILL code path (it emits dr.drill.scheduled
// to the outbox); the failover driver runs it; the outcome is ingested back as a
// drill result so the diff engine can compare it to the previous result.
//
// The 5-field cron parser/evaluator now lives in the shared package
// github.com/clario360/platform/internal/cron (one copy, used here and by the
// workflow scheduler). This file re-exports that package's symbols under the
// drillsched names so existing call sites and tests compile unchanged: same
// Vixie-cron semantics, UTC, with *, ranges, steps and lists.
package drillsched

import (
	sharedcron "github.com/clario360/platform/internal/cron"
)

// ErrInvalidCron is returned by ParseCron for a malformed expression. It is the
// shared package's sentinel, so errors.Is keeps working across both packages.
var ErrInvalidCron = sharedcron.ErrInvalidCron

// CronSchedule is a parsed, evaluable 5-field cron expression. It aliases the
// shared cron type so values flow between drillsched and internal/cron without
// conversion.
type CronSchedule = sharedcron.CronSchedule

// ParseCron parses a standard 5-field cron expression. See internal/cron.ParseCron.
var ParseCron = sharedcron.ParseCron

// MustParseCron is ParseCron that panics on error. See internal/cron.MustParseCron.
var MustParseCron = sharedcron.MustParseCron
