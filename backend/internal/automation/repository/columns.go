package repository

// prefixedRunColumns is runColumns with the automation_runs alias (r) applied,
// for the RETURNING clause of the SystemClaimRunnableRuns UPDATE … FROM. It is
// kept in lockstep with runColumns and the scanRun field order. Written out
// explicitly (rather than mechanically prefixing) because some columns are
// wrapped in expressions — COALESCE(r.last_error, ”) cannot be produced by a
// naive token-prefix.
const prefixedRunColumns = `r.id, r.tenant_id, r.automation_id, r.runbook_id, r.status, r.source_event_id,
    r.replay_of, r.current_step, r.trigger, r.variables, COALESCE(r.last_error, ''),
    r.claimed_at, r.started_at, r.completed_at, r.updated_at`
