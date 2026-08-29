package detector

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/repo"
)

type stubElector struct{ leader bool }

func (s *stubElector) IsLeader() bool { return s.leader }

type captureEmitter struct {
	mu     sync.Mutex
	events []string
}

func (c *captureEmitter) EmitSourceEvent(_ context.Context, _, _ uuid.UUID, t string, _ any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, t)
	return nil
}

func (c *captureEmitter) count(t string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, e := range c.events {
		if e == t {
			n++
		}
	}
	return n
}

func sourceCols() []string {
	return []string{
		"id", "tenant_id", "name", "type", "transport", "address", "expected_eps",
		"baseline_eps", "baseline_samples", "tz", "parser_id", "status",
		"last_seen_at", "last_health_at", "mtls_thumbprint", "cert_serial",
		"cert_issued_at", "cert_expires_at", "cert_revoked_at", "cert_revoked_reason",
		"tags", "version", "created_by", "created_at", "updated_at", "deleted_at",
	}
}

func setupDetector(t *testing.T) (*Detector, pgxmock.PgxPoolIface, *captureEmitter, *stubElector) {
	t.Helper()
	mock, err := pgxmock.NewPool()
	require.NoError(t, err)
	t.Cleanup(func() { mock.Close() })

	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	elector := &stubElector{leader: true}
	emitter := &captureEmitter{}
	cfg := DefaultConfig()
	cfg.Interval = 10 * time.Millisecond
	metrics := sources.NewMetrics(prometheus.NewRegistry())

	d := New(repo.NewSourcesRepo(mock), repo.NewEPSRepo(mock), elector, emitter, rdb, metrics, cfg, zerolog.Nop())
	return d, mock, emitter, elector
}

func TestDetector_DriftFlipsSilent(t *testing.T) {
	d, mock, emitter, _ := setupDetector(t)
	tenant := uuid.New()
	id := uuid.New()
	now := time.Now().UTC()

	// ListActive returns one source with baseline locked.
	row := []any{
		id, tenant, "fw", "firewall", "syslog_udp", "h:514", 100,
		1000, 60, "Africa/Lagos", nil, "active",
		&now, nil, nil, nil,
		nil, nil, nil, nil,
		[]byte(`{}`), int64(1), uuid.New(), now, now, nil,
	}
	mock.ExpectQuery("SELECT").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	// Latest sample: well below baseline.
	mock.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"source_id", "ts", "eps_1min", "eps_5min", "parser_errors_1min", "dropped_1min", "queue_depth", "collector_version"}).
			AddRow(id, now, 100, 100, 0, 0, 0, ""))
	// UpdateBaseline.
	mock.ExpectExec("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	// SetStatusUnchecked.
	mock.ExpectExec("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	// CountByTenantStatus
	mock.ExpectQuery("SELECT tenant_id::text").
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id", "status", "count"}))

	d.runOnce(context.Background())
	require.Equal(t, 1, emitter.count("siem.source.silent"))
}

func TestDetector_GapFlipsSilent(t *testing.T) {
	d, mock, emitter, _ := setupDetector(t)
	tenant := uuid.New()
	id := uuid.New()
	stale := time.Now().UTC().Add(-10 * time.Minute)

	row := []any{
		id, tenant, "fw", "firewall", "syslog_udp", "h:514", 100,
		100, 60, "Africa/Lagos", nil, "active",
		&stale, nil, nil, nil,
		nil, nil, nil, nil,
		[]byte(`{}`), int64(1), uuid.New(), stale, stale, nil,
	}
	mock.ExpectQuery("SELECT").
		WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
	mock.ExpectExec("UPDATE siem.sources").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
	mock.ExpectQuery("SELECT tenant_id::text").
		WillReturnRows(pgxmock.NewRows([]string{"tenant_id", "status", "count"}))

	d.runOnce(context.Background())
	require.Equal(t, 1, emitter.count("siem.source.heartbeat.gap"))
}

func TestDetector_NotLeader_NoOp(t *testing.T) {
	d, _, emitter, elector := setupDetector(t)
	elector.leader = false
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	_ = d.Start(ctx)
	require.Equal(t, 0, emitter.count("siem.source.silent"))
}

func TestDetector_DedupSilent(t *testing.T) {
	d, mock, emitter, _ := setupDetector(t)
	tenant := uuid.New()
	id := uuid.New()
	now := time.Now().UTC()
	row := []any{
		id, tenant, "fw", "firewall", "syslog_udp", "h:514", 100,
		1000, 60, "Africa/Lagos", nil, "silent", // already silent
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
	require.Equal(t, 0, emitter.count("siem.source.silent"))
}

func TestDetector_CertExpiry_DedupRedis(t *testing.T) {
	d, mock, emitter, _ := setupDetector(t)
	tenant := uuid.New()
	id := uuid.New()
	now := time.Now().UTC()
	expires := now.Add(15 * 24 * time.Hour)
	row := []any{
		id, tenant, "fw", "firewall", "syslog_udp", "h:514", 100,
		1000, 60, "Africa/Lagos", nil, "active",
		&now, nil, nil, nil,
		nil, &expires, nil, nil,
		[]byte(`{}`), int64(1), uuid.New(), now, now, nil,
	}
	// We need 2 cycles. Each cycle does: ListActive, Latest, UpdateBaseline, CountByTenantStatus.
	for i := 0; i < 2; i++ {
		mock.ExpectQuery("SELECT").
			WillReturnRows(pgxmock.NewRows(sourceCols()).AddRow(row...))
		mock.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnRows(pgxmock.NewRows([]string{"source_id", "ts", "eps_1min", "eps_5min", "parser_errors_1min", "dropped_1min", "queue_depth", "collector_version"}).
				AddRow(id, now, 1000, 1000, 0, 0, 0, ""))
		mock.ExpectExec("UPDATE siem.sources").
			WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
			WillReturnResult(pgconn.NewCommandTag("UPDATE 1"))
		mock.ExpectQuery("SELECT tenant_id::text").
			WillReturnRows(pgxmock.NewRows([]string{"tenant_id", "status", "count"}))
	}
	d.runOnce(context.Background())
	d.runOnce(context.Background())
	require.Equal(t, 1, emitter.count("siem.source.cert.expiring"), "should emit only once per 24h")
}

func TestDetector_EWMA_Convergence(t *testing.T) {
	// Smoke test the EWMA math: starting baseline_eps=100, applying
	// alpha=0.05 over 100 samples of 200 should converge towards 200.
	prev := 100.0
	alpha := 0.05
	for i := 0; i < 100; i++ {
		prev = prev + alpha*(200.0-prev)
	}
	require.Greater(t, prev, 199.0)
	require.Less(t, prev, 200.5)
}

func TestDetector_DoubleStart(t *testing.T) {
	d, _, _, _ := setupDetector(t)
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = d.Start(ctx) }()
	time.Sleep(20 * time.Millisecond)
	err := d.Start(ctx)
	require.Error(t, err)
	cancel()
}

func TestCleanupJob_Runs(t *testing.T) {
	mock, err := pgxmock.NewPool()
	require.NoError(t, err)
	defer mock.Close()
	mock.ExpectExec("DELETE FROM siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("DELETE 5"))

	job := NewCleanupJob(repo.NewEPSRepo(mock), 10*time.Millisecond, 5*time.Millisecond, zerolog.Nop())
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_ = job.Start(ctx)
}
