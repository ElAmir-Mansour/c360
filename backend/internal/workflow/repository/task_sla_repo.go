package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/workflow/model"
)

// WP-5 (human-scale, pre-breach reminders) — row-level SLA reconciliation +
// at-risk queries.
//
// PROBLEM this closes: the SLA monitor's overdue candidate set (GetOverdueTasks
// in task_repo.go) gates on the FLAT sla_deadline < now, so a task only becomes a
// candidate AFTER it has already breached. The tiered escalation policy, by
// contrast, computes lower notify/reminder tiers that fall BEFORE breach — but
// they were structurally unreachable, because an approaching (not-yet-overdue)
// task never entered the loop. These methods add the missing pieces:
//
//   - ReconcileSLADeadline recomputes the row-level sla_deadline from the tiered
//     policy's BREACH tier, so the flat column and the evaluator AGREE (the
//     scheduler passes the calendar-adjusted breach deadline it already computed).
//   - MarkAtRisk / ClearAtRisk stamp the pre-breach at_risk marker so approaching
//     work is queryable.
//   - GetAtRiskTasks returns approaching (at_risk, not-yet-breached, still-open)
//     tasks ACROSS ALL TENANTS for the monitor, mirroring GetOverdueTasks.
//   - CountAtRiskForUser powers the inbox at-risk KPI for a single user.
//
// These live in a SEPARATE file from task_repo.go (rather than editing it) so the
// change is additive and does not collide with concurrent edits to the core task
// repository. All methods reuse the same RLS scoping helpers (WithSystemScope for
// the cross-tenant monitor, WithTenantScope for the per-tenant inbox) and the
// at_risk / at_risk_since columns added in migration 000011 (also mirrored into
// SchemaSQL for embedding suites).

// NOTE: these queries deliberately reuse taskSelectCols (defined in task_repo.go)
// rather than a local column list. A prior local copy drifted out of sync —
// it omitted candidate_groups / candidate_users, which scanTasks scans as
// positions 11 & 12 — so GetAtRiskTasks / GetApproachingTasks fed scanTasks 25
// columns for a 27-column scan and failed at runtime. Reusing the canonical
// projection makes that class of drift impossible: the SELECT column order and
// the scanTasks read order are one source of truth.

// GetAtRiskTasks returns tasks that have been flagged at_risk (a pre-breach SLA
// reminder tier has fired) but have NOT yet breached and are still open. It is
// the pre-breach analogue of GetOverdueTasks: it surfaces approaching work so the
// monitor can emit reminders and so an inbox can show "at risk" before the
// deadline is missed. Runs under the cross-tenant bypass scope like the overdue
// query.
func (r *TaskRepository) GetAtRiskTasks(ctx context.Context, limit int) ([]*model.HumanTask, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_tasks
		WHERE at_risk = true
		  AND sla_breached = false
		  AND status IN ('pending', 'claimed')
		ORDER BY at_risk_since ASC NULLS LAST, sla_deadline ASC
		LIMIT $1`, taskSelectCols)

	sctx := WithSystemScope(ctx)
	rows, err := newScopedPool(r.pool).Query(sctx, query, limit)
	if err != nil {
		return nil, fmt.Errorf("getting at-risk tasks: %w", err)
	}
	defer rows.Close()

	return r.scanTasks(rows)
}

// GetApproachingTasks returns still-open, not-yet-breached tasks whose flat
// sla_deadline is APPROACHING — either already flagged at_risk, or whose deadline
// falls within `lookahead` of now (so the tiered policy's pre-breach reminder
// tiers, which fire before the deadline, become reachable). This is the candidate
// set the monitor evaluates for pre-breach reminders; without it a task only
// enters the loop AFTER it has breached (GetOverdueTasks gates on sla_deadline <
// now). Runs under the cross-tenant bypass scope like the overdue query.
//
// A NULL sla_deadline is excluded (no deadline => nothing to approach); the
// tiered evaluator still fires on task.CreatedAt for those via GetOverdueTasks
// once/if they cross the flat deadline, so no task is silently dropped.
func (r *TaskRepository) GetApproachingTasks(ctx context.Context, lookahead time.Duration, limit int) ([]*model.HumanTask, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_tasks
		WHERE sla_breached = false
		  AND status IN ('pending', 'claimed')
		  AND (
		        at_risk = true
		     OR (sla_deadline IS NOT NULL AND sla_deadline > now() AND sla_deadline <= now() + $1::interval)
		      )
		ORDER BY sla_deadline ASC NULLS LAST
		LIMIT $2`, taskSelectCols)

	// pgx maps a Go time.Duration to an interval when passed as a string like
	// '3600 seconds'; build the literal from the lookahead seconds.
	interval := fmt.Sprintf("%d seconds", int64(lookahead/time.Second))

	sctx := WithSystemScope(ctx)
	rows, err := newScopedPool(r.pool).Query(sctx, query, interval, limit)
	if err != nil {
		return nil, fmt.Errorf("getting approaching tasks: %w", err)
	}
	defer rows.Close()

	return r.scanTasks(rows)
}

// MarkAtRisk stamps a task as approaching-breach (at_risk = true) and records the
// first-seen instant (at_risk_since is set only on the initial transition, so
// repeated monitor cycles do not reset it). It never touches sla_breached, so a
// task that later breaches keeps its normal breach handling. Idempotent: once
// at_risk is true a subsequent call is a no-op on at_risk_since. Called by the
// cross-tenant monitor with only a task id, so it runs under the bypass scope.
func (r *TaskRepository) MarkAtRisk(ctx context.Context, taskID string) error {
	query := `
		UPDATE workflow_tasks
		SET at_risk = true,
		    at_risk_since = COALESCE(at_risk_since, now()),
		    updated_at = now()
		WHERE id = $1
		  AND sla_breached = false
		  AND status IN ('pending', 'claimed')`

	ct, err := rlsExec(ctx, r.pool, "", query, taskID)
	if err != nil {
		return fmt.Errorf("marking task at risk: %w", err)
	}
	if ct.RowsAffected() == 0 {
		// Not an error the caller must act on: the task may have completed,
		// breached, or moved to a terminal state between candidate selection and
		// this write. model.ErrNotFound lets the caller log-and-continue.
		return fmt.Errorf("task %s: %w", taskID, model.ErrNotFound)
	}
	return nil
}

// ClearAtRisk clears the at_risk marker (e.g. when a task is completed by other
// paths, or a policy stops applying). Provided for completeness / future callers;
// the monitor primarily sets, not clears. Bypass scope.
func (r *TaskRepository) ClearAtRisk(ctx context.Context, taskID string) error {
	query := `
		UPDATE workflow_tasks
		SET at_risk = false,
		    at_risk_since = NULL,
		    updated_at = now()
		WHERE id = $1`

	if _, err := rlsExec(ctx, r.pool, "", query, taskID); err != nil {
		return fmt.Errorf("clearing task at risk: %w", err)
	}
	return nil
}

// ReconcileSLADeadline sets the row-level sla_deadline to the tiered policy's
// calendar-adjusted BREACH deadline, so the flat candidate query (GetOverdueTasks,
// which gates on sla_deadline < now) and the tiered evaluator AGREE about when the
// task breaches. The scheduler passes the breach deadline it has already computed
// via EvaluateSLA, so this method performs no policy math — it only persists the
// reconciled value. It never advances the deadline past a value already stored to
// avoid churn, and never touches breached tasks. Bypass scope (monitor callsite
// has only a task id + the computed deadline).
func (r *TaskRepository) ReconcileSLADeadline(ctx context.Context, taskID string, breachDeadline time.Time) error {
	if breachDeadline.IsZero() {
		return nil
	}
	query := `
		UPDATE workflow_tasks
		SET sla_deadline = $2,
		    updated_at = now()
		WHERE id = $1
		  AND sla_breached = false
		  AND status IN ('pending', 'claimed')
		  AND (sla_deadline IS NULL OR sla_deadline <> $2)`

	if _, err := rlsExec(ctx, r.pool, "", query, taskID, breachDeadline.UTC()); err != nil {
		return fmt.Errorf("reconciling sla deadline: %w", err)
	}
	return nil
}

// CountAtRiskForUser returns the number of approaching-breach (at_risk, not
// breached, still-open) tasks VISIBLE to a user — either directly assigned,
// claimed by them, or role-claimable. Mirrors CountByStatus' visibility predicate
// and runs tenant-scoped so RLS + the tenant filter both apply.
func (r *TaskRepository) CountAtRiskForUser(ctx context.Context, tenantID, userID string, roles []string) (int, error) {
	conditions := []string{"tenant_id = $1"}
	args := []any{tenantID}
	argIdx := 2

	visibilityParts := []string{
		fmt.Sprintf("assignee_id = $%d", argIdx),
		fmt.Sprintf("claimed_by = $%d", argIdx),
	}
	args = append(args, userID)
	argIdx++

	if len(roles) > 0 {
		placeholders := make([]string, len(roles))
		for i, role := range roles {
			placeholders[i] = fmt.Sprintf("$%d", argIdx)
			args = append(args, role)
			argIdx++
		}
		visibilityParts = append(visibilityParts,
			fmt.Sprintf("(assignee_role IN (%s) AND status = 'pending')", joinComma(placeholders)),
		)
	}

	query := fmt.Sprintf(`
		SELECT COUNT(*) FROM workflow_tasks
		WHERE %s
		  AND (%s)
		  AND at_risk = true
		  AND sla_breached = false
		  AND status IN ('pending', 'claimed')`,
		joinAnd(conditions), joinOr(visibilityParts))

	sctx := WithTenantScope(ctx, tenantID)
	var count int
	if err := newScopedPool(r.pool).QueryRow(sctx, query, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("counting at-risk tasks for user: %w", err)
	}
	return count, nil
}

// joinAnd / joinOr / joinComma are tiny local joiners so this additive file does
// not depend on strings import ordering churn in the shared task_repo.go.
func joinAnd(parts []string) string   { return joinWith(parts, " AND ") }
func joinOr(parts []string) string    { return joinWith(parts, " OR ") }
func joinComma(parts []string) string { return joinWith(parts, ", ") }

func joinWith(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}
