package drillsched

import (
	"context"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

func TestStore_SystemClaimDueSchedules_ReturningColumnsAreQualified(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)

	now := time.Now().UTC()
	rows := pgxmock.NewRows([]string{
		"id", "tenant_id", "group_id", "name", "cron_expr", "profile",
		"rto_objective_seconds", "enabled", "next_run", "last_fired_at",
		"created_at", "updated_at",
	}).AddRow(
		"sched-1", "tenant-1", "group-1", "daily drill", "0 2 * * *", ProfileIsolated,
		600, true, now, nil, now, now,
	)

	mock.ExpectQuery(`UPDATE dr_drill_schedule sc[\s\S]*RETURNING sc\.id, sc\.tenant_id`).
		WithArgs(now, 10).
		WillReturnRows(rows)

	schedules, err := NewStore().SystemClaimDueSchedules(context.Background(), mock, now, 10)
	if err != nil {
		t.Fatalf("SystemClaimDueSchedules: %v", err)
	}
	if len(schedules) != 1 || schedules[0].ID != "sched-1" {
		t.Fatalf("schedules = %+v, want sched-1", schedules)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
