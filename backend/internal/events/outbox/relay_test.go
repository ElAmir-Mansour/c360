package outbox

import (
	"context"
	"errors"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// fakePublisher records publish calls and returns a configurable error.
type fakePublisher struct {
	mu    sync.Mutex
	calls []publishCall
	err   error
	block time.Duration
}

type publishCall struct {
	topic   string
	eventID string
}

func (f *fakePublisher) Publish(ctx context.Context, topic string, event *events.Event) error {
	if f.block > 0 {
		select {
		case <-time.After(f.block):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, publishCall{topic: topic, eventID: event.ID})
	return f.err
}

func (f *fakePublisher) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func newTestRelay(t *testing.T, db DB, publisher Publisher, cfg Config) (*Relay, *Metrics) {
	t.Helper()
	metrics := NewMetrics(prometheus.NewRegistry())
	relay := NewRelay(db, publisher, cfg, zerolog.Nop(), metrics)
	return relay, metrics
}

// claimRow builds the pgxmock row tuple the claim query returns for an event.
func claimRow(t *testing.T, rows *pgxmock.Rows, outboxID string, event *events.Event, topic string, attempts int) {
	t.Helper()
	payload, err := event.Marshal()
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}
	rows.AddRow(outboxID, event.ID, event.TenantID, topic, event.Type, payload, attempts)
}

func claimColumns() []string {
	return []string{"id", "event_id", "tenant_id", "topic", "event_type", "payload", "attempts"}
}

func TestRunOnce_PublishesClaimedRows(t *testing.T) {
	mock := newMockPool(t)
	publisher := &fakePublisher{}
	relay, metrics := newTestRelay(t, mock, publisher, Config{})

	first := newTestEvent(t)
	second := newTestEvent(t)

	rows := pgxmock.NewRows(claimColumns())
	claimRow(t, rows, "ob-1", first, events.Topics.WorkflowEvents, 1)
	claimRow(t, rows, "ob-2", second, events.Topics.WorkflowEvents, 1)

	mock.ExpectQuery(regexp.QuoteMeta(claimSQL)).WithArgs(100).WillReturnRows(rows)
	mock.ExpectExec(regexp.QuoteMeta(markPublishedSQL)).WithArgs("ob-1").WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectExec(regexp.QuoteMeta(markPublishedSQL)).WithArgs("ob-2").WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	claimed, err := relay.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if claimed != 2 {
		t.Fatalf("RunOnce() claimed = %d, want 2", claimed)
	}
	if publisher.callCount() != 2 {
		t.Fatalf("publisher calls = %d, want 2", publisher.callCount())
	}
	if got := testutil.ToFloat64(metrics.PublishedTotal.WithLabelValues(events.Topics.WorkflowEvents)); got != 2 {
		t.Fatalf("published_total = %v, want 2", got)
	}
	expectationsMet(t, mock)
}

func TestRunOnce_NoDueRows(t *testing.T) {
	mock := newMockPool(t)
	publisher := &fakePublisher{}
	relay, _ := newTestRelay(t, mock, publisher, Config{})

	mock.ExpectQuery(regexp.QuoteMeta(claimSQL)).WithArgs(100).
		WillReturnRows(pgxmock.NewRows(claimColumns()))

	claimed, err := relay.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if claimed != 0 {
		t.Fatalf("RunOnce() claimed = %d, want 0", claimed)
	}
	if publisher.callCount() != 0 {
		t.Fatalf("publisher calls = %d, want 0", publisher.callCount())
	}
	expectationsMet(t, mock)
}

func TestRunOnce_ClaimErrorIsReturned(t *testing.T) {
	mock := newMockPool(t)
	relay, _ := newTestRelay(t, mock, &fakePublisher{}, Config{})

	mock.ExpectQuery(regexp.QuoteMeta(claimSQL)).WithArgs(100).
		WillReturnError(errors.New("relation does not exist"))

	if _, err := relay.RunOnce(context.Background()); err == nil {
		t.Fatal("expected claim error to be returned")
	}
	expectationsMet(t, mock)
}

func TestRunOnce_PublishFailureSchedulesRetry(t *testing.T) {
	mock := newMockPool(t)
	publisher := &fakePublisher{err: errors.New("broker unavailable")}
	relay, metrics := newTestRelay(t, mock, publisher, Config{MaxAttempts: 5})

	event := newTestEvent(t)
	rows := pgxmock.NewRows(claimColumns())
	claimRow(t, rows, "ob-1", event, events.Topics.WorkflowEvents, 2)

	mock.ExpectQuery(regexp.QuoteMeta(claimSQL)).WithArgs(100).WillReturnRows(rows)
	mock.ExpectExec(regexp.QuoteMeta(scheduleRetrySQL)).
		WithArgs("ob-1", pgxmock.AnyArg(), "broker unavailable").
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if _, err := relay.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if got := testutil.ToFloat64(metrics.RetriedTotal.WithLabelValues(events.Topics.WorkflowEvents)); got != 1 {
		t.Fatalf("retried_total = %v, want 1", got)
	}
	expectationsMet(t, mock)
}

func TestRunOnce_ExhaustedAttemptsParkRowAsFailed(t *testing.T) {
	mock := newMockPool(t)
	publisher := &fakePublisher{err: errors.New("broker unavailable")}
	relay, metrics := newTestRelay(t, mock, publisher, Config{MaxAttempts: 3})

	event := newTestEvent(t)
	rows := pgxmock.NewRows(claimColumns())
	claimRow(t, rows, "ob-1", event, events.Topics.WorkflowEvents, 3) // claim already consumed attempt 3 of 3

	mock.ExpectQuery(regexp.QuoteMeta(claimSQL)).WithArgs(100).WillReturnRows(rows)
	mock.ExpectExec(regexp.QuoteMeta(failSQL)).
		WithArgs("ob-1", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if _, err := relay.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if got := testutil.ToFloat64(metrics.FailedTotal.WithLabelValues(events.Topics.WorkflowEvents)); got != 1 {
		t.Fatalf("failed_total = %v, want 1", got)
	}
	expectationsMet(t, mock)
}

func TestRunOnce_PoisonPayloadParksImmediatelyWithoutPublishing(t *testing.T) {
	mock := newMockPool(t)
	publisher := &fakePublisher{}
	relay, metrics := newTestRelay(t, mock, publisher, Config{})

	rows := pgxmock.NewRows(claimColumns()).
		AddRow("ob-1", "evt-1", "tenant-1", events.Topics.WorkflowEvents, "t", []byte("{not json"), 1)

	mock.ExpectQuery(regexp.QuoteMeta(claimSQL)).WithArgs(100).WillReturnRows(rows)
	mock.ExpectExec(regexp.QuoteMeta(failSQL)).
		WithArgs("ob-1", pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if _, err := relay.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if publisher.callCount() != 0 {
		t.Fatalf("publisher calls = %d, want 0 for poison payload", publisher.callCount())
	}
	if got := testutil.ToFloat64(metrics.FailedTotal.WithLabelValues(events.Topics.WorkflowEvents)); got != 1 {
		t.Fatalf("failed_total = %v, want 1", got)
	}
	expectationsMet(t, mock)
}

func TestRunOnce_MarkPublishedErrorLeavesRowForReaper(t *testing.T) {
	mock := newMockPool(t)
	publisher := &fakePublisher{}
	relay, metrics := newTestRelay(t, mock, publisher, Config{})

	event := newTestEvent(t)
	rows := pgxmock.NewRows(claimColumns())
	claimRow(t, rows, "ob-1", event, events.Topics.WorkflowEvents, 1)

	mock.ExpectQuery(regexp.QuoteMeta(claimSQL)).WithArgs(100).WillReturnRows(rows)
	mock.ExpectExec(regexp.QuoteMeta(markPublishedSQL)).WithArgs("ob-1").
		WillReturnError(errors.New("connection reset"))

	// RunOnce must not fail the whole batch: the row stays 'publishing' and
	// the reaper recovers it (at-least-once).
	if _, err := relay.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if got := testutil.ToFloat64(metrics.PublishedTotal.WithLabelValues(events.Topics.WorkflowEvents)); got != 0 {
		t.Fatalf("published_total = %v, want 0 when mark fails", got)
	}
	expectationsMet(t, mock)
}

func TestBackoff_ExponentialWithCap(t *testing.T) {
	relay, _ := newTestRelay(t, newMockPool(t), &fakePublisher{}, Config{
		RetryBackoffBase: 2 * time.Second,
		RetryBackoffCap:  time.Minute,
	})

	cases := []struct {
		attempts int
		want     time.Duration
	}{
		{attempts: 1, want: 2 * time.Second},
		{attempts: 2, want: 4 * time.Second},
		{attempts: 3, want: 8 * time.Second},
		{attempts: 5, want: 32 * time.Second},
		{attempts: 6, want: time.Minute},  // 64s capped
		{attempts: 50, want: time.Minute}, // stays capped, no overflow
	}
	for _, tc := range cases {
		if got := relay.backoff(tc.attempts); got != tc.want {
			t.Errorf("backoff(%d) = %v, want %v", tc.attempts, got, tc.want)
		}
	}
}

func TestReapStuck_RequeuesAndCounts(t *testing.T) {
	mock := newMockPool(t)
	relay, metrics := newTestRelay(t, mock, &fakePublisher{}, Config{})

	mock.ExpectExec(regexp.QuoteMeta(reapSQL)).WithArgs(pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 3))

	n, err := relay.ReapStuck(context.Background())
	if err != nil {
		t.Fatalf("ReapStuck() error = %v", err)
	}
	if n != 3 {
		t.Fatalf("ReapStuck() = %d, want 3", n)
	}
	if got := testutil.ToFloat64(metrics.ReapedTotal); got != 3 {
		t.Fatalf("reaped_total = %v, want 3", got)
	}
	expectationsMet(t, mock)
}

func TestPurgePublished_DeletesAndCounts(t *testing.T) {
	mock := newMockPool(t)
	relay, metrics := newTestRelay(t, mock, &fakePublisher{}, Config{})

	mock.ExpectExec(regexp.QuoteMeta(purgeSQL)).WithArgs(pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("DELETE", 7))

	n, err := relay.PurgePublished(context.Background())
	if err != nil {
		t.Fatalf("PurgePublished() error = %v", err)
	}
	if n != 7 {
		t.Fatalf("PurgePublished() = %d, want 7", n)
	}
	if got := testutil.ToFloat64(metrics.PurgedTotal); got != 7 {
		t.Fatalf("purged_total = %v, want 7", got)
	}
	expectationsMet(t, mock)
}

func TestMaintain_RunsReapPurgeAndGauge(t *testing.T) {
	mock := newMockPool(t)
	relay, metrics := newTestRelay(t, mock, &fakePublisher{}, Config{})

	mock.ExpectExec(regexp.QuoteMeta(reapSQL)).WithArgs(pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0))
	mock.ExpectExec(regexp.QuoteMeta(purgeSQL)).WithArgs(pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("DELETE", 0))
	mock.ExpectQuery(regexp.QuoteMeta(pendingCountSQL)).
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(int64(5)))

	relay.maintain(context.Background())

	if got := testutil.ToFloat64(metrics.PendingRows); got != 5 {
		t.Fatalf("pending_rows = %v, want 5", got)
	}
	expectationsMet(t, mock)
}

func TestRun_StopsOnContextCancel(t *testing.T) {
	mock := newMockPool(t)
	relay, _ := newTestRelay(t, mock, &fakePublisher{}, Config{
		PollInterval:        time.Hour, // never fires during the test
		MaintenanceInterval: time.Hour,
	})

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- relay.Run(ctx) }()

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run() error = %v, want nil on graceful stop", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run() did not stop after context cancellation")
	}
}

func TestConfig_Defaults(t *testing.T) {
	cfg := Config{}.withDefaults()

	if cfg.PollInterval != time.Second {
		t.Errorf("PollInterval = %v, want 1s", cfg.PollInterval)
	}
	if cfg.BatchSize != 100 {
		t.Errorf("BatchSize = %d, want 100", cfg.BatchSize)
	}
	if cfg.MaxAttempts != 10 {
		t.Errorf("MaxAttempts = %d, want 10", cfg.MaxAttempts)
	}
	if cfg.RetryBackoffBase != 2*time.Second {
		t.Errorf("RetryBackoffBase = %v, want 2s", cfg.RetryBackoffBase)
	}
	if cfg.RetryBackoffCap != 5*time.Minute {
		t.Errorf("RetryBackoffCap = %v, want 5m", cfg.RetryBackoffCap)
	}
	if cfg.PublishTimeout != 10*time.Second {
		t.Errorf("PublishTimeout = %v, want 10s", cfg.PublishTimeout)
	}
	if cfg.ClaimTimeout != time.Minute {
		t.Errorf("ClaimTimeout = %v, want 1m", cfg.ClaimTimeout)
	}
	if cfg.RetentionPeriod != 24*time.Hour {
		t.Errorf("RetentionPeriod = %v, want 24h", cfg.RetentionPeriod)
	}
	if cfg.MaintenanceInterval != time.Minute {
		t.Errorf("MaintenanceInterval = %v, want 1m", cfg.MaintenanceInterval)
	}
}
