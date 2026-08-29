package recover

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// isNoRows reports whether err is pgx's "no rows" sentinel, used by the
// single-row reads to translate "absent" into a (nil, nil) result rather than an
// error.
func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// ITDROverviewStore is the READ-ONLY persistence surface the IT DR overview
// service composes. It reads aggregate IT-DR state from the runbook-studio and
// drill-scheduler tables that the dr/* services own and write — it never writes
// to them and never reimplements their orchestration logic (the runbook engine,
// the frontier/critical-path math, and the drill diff all stay in their owning
// packages). Every read is RLS-scoped to the calling tenant via the caller's
// tenant transaction (the DBTX). The interface keeps the service unit-testable
// without a database; the SQL implementation is SQLITDROverviewStore.
type ITDROverviewStore interface {
	// RunbookInventory returns one page of the tenant's runbooks (newest first)
	// plus the total count and the per-status breakdown across ALL of the tenant's
	// runbooks (not just the page). page is 1-based; perPage bounds the page.
	RunbookInventory(ctx context.Context, db repository.DBTX, page, perPage int) (RunbookInventory, error)
	// LastRehearsal returns the tenant's most recent rehearsal-mode run, or nil
	// when none exists.
	LastRehearsal(ctx context.Context, db repository.DBTX) (*RehearsalRun, error)
	// UpcomingRehearsal returns the soonest future drill-schedule fire time across
	// the tenant's enabled schedules, or nil when none is scheduled.
	UpcomingRehearsal(ctx context.Context, db repository.DBTX, now time.Time) (*UpcomingRehearsal, error)
	// OpenApprovals returns the approval-gate task-runs currently awaiting sign-off
	// (status runnable) on the tenant's active (running) runs, plus the total
	// count. It is bounded to limit rows for the surfaced list; the count is exact.
	OpenApprovals(ctx context.Context, db repository.DBTX, limit int) (OpenApprovals, error)
	// RehearsalStats returns rehearsal-run counts (total + completed) over the
	// trailing window ending at now, for the readiness computation.
	RehearsalStats(ctx context.Context, db repository.DBTX, since time.Time) (RehearsalStats, error)
}

// SQLITDROverviewStore is the read-only SQL implementation of ITDROverviewStore
// over the dr_studio_* and dr_drill_schedule tables. It holds no state; the
// caller supplies the tenant-scoped DBTX.
type SQLITDROverviewStore struct{}

// NewITDROverviewStore constructs the read-only IT DR overview store.
func NewITDROverviewStore() *SQLITDROverviewStore { return &SQLITDROverviewStore{} }

// RunbookInventory reads the inventory page and the status breakdown in two
// queries (no N+1: the breakdown is a single grouped aggregate over all of the
// tenant's runbooks, and the page is one bounded SELECT).
func (s *SQLITDROverviewStore) RunbookInventory(ctx context.Context, db repository.DBTX, page, perPage int) (RunbookInventory, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 1
	}
	offset := (page - 1) * perPage

	inv := RunbookInventory{
		ByStatus: map[string]int{},
		Items:    []RunbookSummary{},
	}

	// Status breakdown + total across the whole tenant estate.
	statusRows, err := db.Query(ctx, `
		SELECT status, COUNT(*)
		  FROM dr_studio_runbook
		 GROUP BY status`)
	if err != nil {
		return RunbookInventory{}, err
	}
	func() {
		defer statusRows.Close()
		for statusRows.Next() {
			var status string
			var n int
			if scanErr := statusRows.Scan(&status, &n); scanErr != nil {
				err = scanErr
				return
			}
			inv.ByStatus[status] = n
			inv.Total += n
		}
	}()
	if err != nil {
		return RunbookInventory{}, err
	}
	if err := statusRows.Err(); err != nil {
		return RunbookInventory{}, err
	}

	// One bounded page of runbooks, newest first, with a live-run-count subquery so
	// the inventory surfaces which runbooks are currently executing without a
	// per-row follow-up query (no N+1).
	rows, err := db.Query(ctx, `
		SELECT rb.id, rb.name, rb.status, rb.source_runbook, rb.group_id,
		       rb.updated_at,
		       (SELECT COUNT(*) FROM dr_studio_task t WHERE t.runbook_id = rb.id) AS task_count,
		       (SELECT COUNT(*) FROM dr_studio_run r
		         WHERE r.runbook_id = rb.id AND r.status IN ('pending','running')) AS active_runs
		  FROM dr_studio_runbook rb
		 ORDER BY rb.updated_at DESC, rb.id
		 LIMIT $1 OFFSET $2`, perPage, offset)
	if err != nil {
		return RunbookInventory{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item RunbookSummary
		var groupID *uuid.UUID
		if scanErr := rows.Scan(
			&item.ID, &item.Name, &item.Status, &item.Source, &groupID,
			&item.UpdatedAt, &item.TaskCount, &item.ActiveRuns,
		); scanErr != nil {
			return RunbookInventory{}, scanErr
		}
		if groupID != nil {
			g := groupID.String()
			item.GroupID = &g
		}
		inv.Items = append(inv.Items, item)
	}
	if err := rows.Err(); err != nil {
		return RunbookInventory{}, err
	}
	return inv, nil
}

// LastRehearsal reads the tenant's most recent rehearsal-mode run.
func (s *SQLITDROverviewStore) LastRehearsal(ctx context.Context, db repository.DBTX) (*RehearsalRun, error) {
	var rr RehearsalRun
	var completedAt *time.Time
	var actualDur *int
	err := db.QueryRow(ctx, `
		SELECT r.id, r.runbook_id, rb.name, r.status, r.started_at, r.completed_at,
		       r.actual_duration_seconds, r.planned_critical_path_seconds
		  FROM dr_studio_run r
		  JOIN dr_studio_runbook rb ON rb.id = r.runbook_id
		 WHERE r.mode = 'rehearsal'
		 ORDER BY r.started_at DESC
		 LIMIT 1`).Scan(
		&rr.RunID, &rr.RunbookID, &rr.RunbookName, &rr.Status, &rr.StartedAt,
		&completedAt, &actualDur, &rr.PlannedCriticalPathSeconds,
	)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	rr.CompletedAt = completedAt
	rr.ActualDurationSeconds = actualDur
	return &rr, nil
}

// UpcomingRehearsal reads the soonest future enabled drill-schedule fire time.
func (s *SQLITDROverviewStore) UpcomingRehearsal(ctx context.Context, db repository.DBTX, now time.Time) (*UpcomingRehearsal, error) {
	var up UpcomingRehearsal
	err := db.QueryRow(ctx, `
		SELECT id, name, group_id, next_run, profile
		  FROM dr_drill_schedule
		 WHERE enabled = true AND next_run >= $1
		 ORDER BY next_run ASC
		 LIMIT 1`, now).Scan(&up.ScheduleID, &up.Name, &up.GroupID, &up.NextRun, &up.Profile)
	if err != nil {
		if isNoRows(err) {
			return nil, nil
		}
		return nil, err
	}
	return &up, nil
}

// OpenApprovals reads the approval-gate task-runs currently awaiting sign-off on
// the tenant's active runs. The count is an exact aggregate; the surfaced list
// is bounded to limit rows.
func (s *SQLITDROverviewStore) OpenApprovals(ctx context.Context, db repository.DBTX, limit int) (OpenApprovals, error) {
	if limit < 1 {
		limit = 1
	}
	out := OpenApprovals{Items: []ApprovalItem{}}

	if err := db.QueryRow(ctx, `
		SELECT COUNT(*)
		  FROM dr_studio_task_run tr
		  JOIN dr_studio_task t ON t.id = tr.task_id
		  JOIN dr_studio_run r ON r.id = tr.run_id
		 WHERE t.task_type = 'approval_gate'
		   AND tr.status = 'runnable'
		   AND r.status IN ('pending','running')`).Scan(&out.Total); err != nil {
		return OpenApprovals{}, err
	}

	rows, err := db.Query(ctx, `
		SELECT r.id, r.runbook_id, rb.name, t.id, t.name, t.automation_action,
		       r.mode, tr.updated_at
		  FROM dr_studio_task_run tr
		  JOIN dr_studio_task t ON t.id = tr.task_id
		  JOIN dr_studio_run r ON r.id = tr.run_id
		  JOIN dr_studio_runbook rb ON rb.id = r.runbook_id
		 WHERE t.task_type = 'approval_gate'
		   AND tr.status = 'runnable'
		   AND r.status IN ('pending','running')
		 ORDER BY tr.updated_at ASC
		 LIMIT $1`, limit)
	if err != nil {
		return OpenApprovals{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var it ApprovalItem
		if scanErr := rows.Scan(
			&it.RunID, &it.RunbookID, &it.RunbookName, &it.TaskID, &it.TaskName,
			&it.RequiredPermission, &it.RunMode, &it.AwaitingSince,
		); scanErr != nil {
			return OpenApprovals{}, scanErr
		}
		out.Items = append(out.Items, it)
	}
	if err := rows.Err(); err != nil {
		return OpenApprovals{}, err
	}
	return out, nil
}

// RehearsalStats aggregates rehearsal-run outcomes over the trailing window for
// the readiness computation: total rehearsals started since the window opened
// and how many of them completed successfully.
func (s *SQLITDROverviewStore) RehearsalStats(ctx context.Context, db repository.DBTX, since time.Time) (RehearsalStats, error) {
	var st RehearsalStats
	err := db.QueryRow(ctx, `
		SELECT COUNT(*) AS total,
		       COUNT(*) FILTER (WHERE status = 'completed') AS completed
		  FROM dr_studio_run
		 WHERE mode = 'rehearsal' AND started_at >= $1`, since).Scan(&st.Total, &st.Completed)
	if err != nil {
		return RehearsalStats{}, err
	}
	return st, nil
}

var _ ITDROverviewStore = (*SQLITDROverviewStore)(nil)
