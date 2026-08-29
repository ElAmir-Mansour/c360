package detector

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

func TestDetector_Recovery(t *testing.T) {
	d, mock, emitter, _ := setupDetector(t)
	tenant := uuid.New()
	id := uuid.New()
	now := time.Now().UTC()
	row := []any{
		id, tenant, "fw", "firewall", "syslog_udp", "h:514", 100,
		100, 60, "Africa/Lagos", nil, "silent",
		&now, nil, nil, nil,
		nil, nil, nil, nil,
		[]byte(`{}`), int64(1), uuid.New(), now, now, nil,
	}
	for i := 0; i < 3; i++ {
		mock.ExpectQuery("SELECT").
			WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
		mock.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnRows(pgxmock.NewRows([]string{"source_id", "ts", "eps_1min", "eps_5min", "parser_errors_1min", "dropped_1min", "queue_depth", "collector_version"}).
				AddRow(id, now, 100, 100, 0, 0, 0, ""))
		mock.ExpectExec("UPDATE siem.sources").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
		if i == 2 {
			// On the 3rd run, the recovery transition flips status back to active.
			mock.ExpectExec("UPDATE siem.sources").
				WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
				WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
		}
		mock.ExpectQuery("SELECT tenant_id::text").
			WillReturnRows(pgxmock.NewRows([]string{"tenant_id", "status", "count"}))
		d.runOnce(context.Background())
	}
	require.Equal(t, 1, emitter.count("siem.source.recovered"))
}

func TestDetector_BaselineWarmup(t *testing.T) {
	d, mock, _, _ := setupDetector(t)
	tenant := uuid.New()
	id := uuid.New()
	now := time.Now().UTC()
	row := []any{
		id, tenant, "fw", "firewall", "syslog_udp", "h:514", 100,
		0, 10, "Africa/Lagos", nil, "active", // baseline_samples=10, below 60
		&now, nil, nil, nil,
		nil, nil, nil, nil,
		[]byte(`{}`), int64(1), uuid.New(), now, now, nil,
	}
	mock.ExpectQuery("SELECT").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	mock.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"source_id", "ts", "eps_1min", "eps_5min", "parser_errors_1min", "dropped_1min", "queue_depth", "collector_version"}).
			AddRow(id, now, 100, 100, 0, 0, 0, ""))
	mock.ExpectExec("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	mock.ExpectQuery("SELECT tenant_id::text").
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id", "status", "count"}))
	d.runOnce(context.Background())
}

func TestDetector_NoSample(t *testing.T) {
	d, mock, _, _ := setupDetector(t)
	tenant := uuid.New()
	id := uuid.New()
	now := time.Now().UTC()
	row := []any{
		id, tenant, "fw", "firewall", "syslog_udp", "h:514", 100,
		100, 60, "Africa/Lagos", nil, "active",
		&now, nil, nil, nil,
		nil, nil, nil, nil,
		[]byte(`{}`), int64(1), uuid.New(), now, now, nil,
	}
	mock.ExpectQuery("SELECT").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	// No sample (empty rows).
	mock.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"source_id", "ts", "eps_1min", "eps_5min", "parser_errors_1min", "dropped_1min", "queue_depth", "collector_version"}))
	mock.ExpectQuery("SELECT tenant_id::text").
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id", "status", "count"}))
	d.runOnce(context.Background())
}

func TestCleanupJob_Defaults(t *testing.T) {
	job := NewCleanupJob(nil, 0, 0, zerolog.Nop())
	require.NotNil(t, job)
}
