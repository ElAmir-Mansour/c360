package recover

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/repository"
)

// SQLAnalyticsStore is the read-only SQL implementation of AnalyticsStore. It
// reads the captured RTA from the EXISTING runbookstudio execution records
// (dr_studio_run), joined to applications via the Metastore runbook link
// (recover_metastore_runbook_link), and appends the readiness-trend snapshot it
// owns (recover_readiness_snapshot). It holds no state; the caller supplies the
// tenant-scoped DBTX, so every read/write is RLS-isolated to the tenant.
//
// It NEVER writes to the dr/* tables and never reimplements their orchestration:
// the RTA is the dr_studio_run.actual_duration_seconds the runbook engine already
// stamps at completion; this store only reads and joins it.
type SQLAnalyticsStore struct{}

// NewAnalyticsStore constructs the read-only analytics store.
func NewAnalyticsStore() *SQLAnalyticsStore { return &SQLAnalyticsStore{} }

// recoveryEventsSQL reads the runbookstudio runs for a set of runbook ids,
// newest first, with a per-application row cap applied in Go (the caller bounds
// the id set, and the window is small). It is ONE query over all the requested
// runbook ids (no N+1). The RTA is actual_duration_seconds, populated by the
// runbook engine at completion; an in-flight run has a NULL RTA and a
// non-terminal status, so it surfaces as in-progress rather than as a captured
// actual.
const recoveryEventsSQL = `
SELECT id, runbook_id, mode, status, started_at, completed_at, actual_duration_seconds
  FROM dr_studio_run
 WHERE runbook_id = ANY($1)
 ORDER BY started_at DESC, id DESC`

// RecoveryEventsForApplications resolves the recovery/rehearsal execution records
// for the given applications, keyed by application id. The application→runbook
// join is the Metastore link (appRunbookLinks); the per-application list is
// bounded to perApp newest-first events. It issues ONE query over the union of all
// linked runbook ids, then fans the rows back out per application, so an estate of
// thousands of applications costs a single round trip (no N+1).
func (s *SQLAnalyticsStore) RecoveryEventsForApplications(ctx context.Context, db repository.DBTX, appRunbookLinks map[string][]string, perApp int) (map[string][]RecoveryEvent, error) {
	if perApp < 1 {
		perApp = 1
	}
	out := make(map[string][]RecoveryEvent, len(appRunbookLinks))

	// Collect the union of linked runbook ids and a reverse map runbook id → the
	// application ids it is linked to (a runbook can back more than one app).
	runbookToApps := make(map[string][]string)
	var runbookIDs []string
	seen := make(map[string]struct{})
	for appID, ids := range appRunbookLinks {
		out[appID] = []RecoveryEvent{} // every requested app gets a (possibly empty) slice
		for _, rid := range ids {
			runbookToApps[rid] = append(runbookToApps[rid], appID)
			if _, ok := seen[rid]; !ok {
				seen[rid] = struct{}{}
				runbookIDs = append(runbookIDs, rid)
			}
		}
	}
	if len(runbookIDs) == 0 {
		return out, nil
	}

	rows, err := db.Query(ctx, recoveryEventsSQL, runbookIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var (
			ev          RecoveryEvent
			runbookID   string
			completedAt *time.Time
			actualDur   *int
		)
		if err := rows.Scan(&ev.EventID, &runbookID, &ev.Mode, &ev.Status, &ev.StartedAt, &completedAt, &actualDur); err != nil {
			return nil, err
		}
		ev.Source = AnalyticsSourceRunbookRun
		ev.RunbookID = runbookID
		ev.CompletedAt = completedAt
		ev.RTAActualSecond = actualDur
		ev.Succeeded = ev.Status == "completed"

		// Fan this run out to every application its runbook backs, honouring the
		// per-application cap. Rows arrive newest-first, so the cap keeps the most
		// recent events.
		for _, appID := range runbookToApps[runbookID] {
			if len(out[appID]) >= perApp {
				continue
			}
			out[appID] = append(out[appID], ev)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

const appendSnapshotSQL = `
INSERT INTO recover_readiness_snapshot
    (tenant_id, score, application_count, breaching_count, components, captured_at)
VALUES ($1, $2, $3, $4, $5, $6)`

// AppendReadinessSnapshot appends one immutable portfolio-readiness snapshot. The
// store exposes NO update or delete path for this table, so the trend is
// structurally append-only.
func (s *SQLAnalyticsStore) AppendReadinessSnapshot(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, snap ReadinessSnapshot, now time.Time) error {
	components := snap.Components
	if components == nil {
		components = map[string]float64{}
	}
	componentsJSON, err := json.Marshal(components)
	if err != nil {
		return err
	}
	_, err = db.Exec(ctx, appendSnapshotSQL,
		tenantID, snap.Score, snap.ApplicationCount, snap.BreachingCount, componentsJSON, now)
	return err
}

const readinessTrendSQL = `
SELECT score, application_count, breaching_count, captured_at
  FROM recover_readiness_snapshot
 WHERE captured_at >= $1
 ORDER BY captured_at DESC, id DESC
 LIMIT $2`

// ReadinessTrend reads the tenant's readiness snapshots over the trailing window,
// newest first, bounded to limit points.
func (s *SQLAnalyticsStore) ReadinessTrend(ctx context.Context, db repository.DBTX, since time.Time, limit int) ([]ReadinessTrendPoint, error) {
	if limit < 1 {
		limit = 1
	}
	rows, err := db.Query(ctx, readinessTrendSQL, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []ReadinessTrendPoint{}
	for rows.Next() {
		var p ReadinessTrendPoint
		if err := rows.Scan(&p.Score, &p.ApplicationCount, &p.BreachingCount, &p.CapturedAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

var _ AnalyticsStore = (*SQLAnalyticsStore)(nil)
