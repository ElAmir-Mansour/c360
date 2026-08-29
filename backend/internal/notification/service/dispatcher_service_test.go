package service

import (
	"context"
	"errors"
	"sort"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/channel"
	"github.com/clario360/platform/internal/notification/model"
)

// dispatchChannel is a programmable channel fake: it records that Send ran and
// returns a caller-supplied result. Unlike suppTestChannel (which always
// succeeds), it lets the dispatcher tests exercise the delivered / failed /
// retryable branches.
type dispatchChannel struct {
	name   string
	result *channel.ChannelResult
	calls  int
}

func (c *dispatchChannel) Name() string { return c.name }
func (c *dispatchChannel) Send(ctx context.Context, notif *model.Notification) *channel.ChannelResult {
	c.calls++
	if c.result != nil {
		return c.result
	}
	return &channel.ChannelResult{Success: true}
}

// dispatchInserter captures every delivery record the dispatcher writes and can
// be told to fail the write to exercise the "failed to create delivery log"
// branch (which must not turn a delivered result into a failure).
type dispatchInserter struct {
	records []*model.DeliveryRecord
	err     error
}

func (f *dispatchInserter) Insert(ctx context.Context, rec *model.DeliveryRecord) (string, error) {
	f.records = append(f.records, rec)
	if f.err != nil {
		return "", f.err
	}
	return "log-1", nil
}

func newDispatcher(channels map[string]channel.Channel, ins deliveryRecorder) *DispatcherService {
	return &DispatcherService{
		channels:     channels,
		deliveryRepo: ins,
		logger:       zerolog.Nop(),
	}
}

func testNotif() *model.Notification {
	return &model.Notification{ID: "n1", TenantID: "t1", UserID: "u1", Type: model.NotifAlertCreated}
}

// TestDispatch_UnknownChannel asserts a delivery to a channel the dispatcher does
// not know about is reported as an error and writes NO delivery log (the
// unknown-channel branch returns before the insert).
func TestDispatch_UnknownChannel(t *testing.T) {
	ins := &dispatchInserter{}
	d := newDispatcher(map[string]channel.Channel{}, ins)

	results := d.Dispatch(context.Background(), testNotif(), []channel.ChannelDelivery{{Channel: model.ChannelEmail}})

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Success {
		t.Fatal("expected unknown channel to fail")
	}
	if results[0].Error == nil {
		t.Fatal("expected an error for unknown channel")
	}
	if len(ins.records) != 0 {
		t.Fatalf("unknown channel must not write a delivery log, got %d", len(ins.records))
	}
}

// TestDispatch_DeferredCreatesPendingRecord asserts a quiet-hours-deferred
// delivery persists a pending record carrying deliver_after and never invokes the
// channel Send.
func TestDispatch_DeferredCreatesPendingRecord(t *testing.T) {
	ch := &dispatchChannel{name: model.ChannelEmail}
	ins := &dispatchInserter{}
	d := newDispatcher(map[string]channel.Channel{ch.name: ch}, ins)

	after := testNotif().CreatedAt.Add(0) // any *time; use notif time to get a stable pointer
	deliveries := []channel.ChannelDelivery{{Channel: model.ChannelEmail, Deferred: true, DeliverAfter: &after}}

	results := d.Dispatch(context.Background(), testNotif(), deliveries)

	if ch.calls != 0 {
		t.Fatalf("deferred delivery must not call channel Send, got %d calls", ch.calls)
	}
	if len(results) != 1 || !results[0].Deferred || !results[0].Success {
		t.Fatalf("expected one deferred+success result, got %+v", results)
	}
	if results[0].Metadata["delivery_log_id"] != "log-1" {
		t.Fatalf("expected delivery_log_id in metadata, got %+v", results[0].Metadata)
	}
	if len(ins.records) != 1 {
		t.Fatalf("expected one delivery record, got %d", len(ins.records))
	}
	rec := ins.records[0]
	if rec.Status != model.DeliveryPending {
		t.Errorf("expected pending status, got %q", rec.Status)
	}
	if rec.Attempt != 1 {
		t.Errorf("expected attempt 1, got %d", rec.Attempt)
	}
	if rec.DeliverAfter == nil {
		t.Error("expected deliver_after to be persisted on the deferred record")
	}
}

// TestDispatch_SuccessRecordsDelivered asserts a successful send writes a
// delivered record with delivered_at set and next_retry_at left nil (never
// re-tried), and threads the log id into the result metadata.
func TestDispatch_SuccessRecordsDelivered(t *testing.T) {
	ch := &dispatchChannel{name: model.ChannelEmail, result: &channel.ChannelResult{Success: true, Metadata: map[string]interface{}{"provider": "smtp"}}}
	ins := &dispatchInserter{}
	d := newDispatcher(map[string]channel.Channel{ch.name: ch}, ins)

	results := d.Dispatch(context.Background(), testNotif(), []channel.ChannelDelivery{{Channel: model.ChannelEmail}})

	if ch.calls != 1 {
		t.Fatalf("expected channel Send once, got %d", ch.calls)
	}
	if len(results) != 1 || !results[0].Success {
		t.Fatalf("expected one successful result, got %+v", results)
	}
	if results[0].Metadata["delivery_log_id"] != "log-1" {
		t.Fatalf("expected delivery_log_id threaded into metadata, got %+v", results[0].Metadata)
	}
	rec := ins.records[0]
	if rec.Status != model.DeliveryDelivered {
		t.Errorf("expected delivered status, got %q", rec.Status)
	}
	if rec.DeliveredAt == nil {
		t.Error("expected delivered_at to be set")
	}
	if rec.NextRetryAt != nil {
		t.Error("a delivered record must not schedule a retry")
	}
}

// TestDispatch_FailureRecording is a table-driven test over the failure paths: it
// asserts the recorded status is failed, the error text is captured, and
// next_retry_at is scheduled iff the failure is retryable (the first-retry
// hand-off to the durable retry worker, #6).
func TestDispatch_FailureRecording(t *testing.T) {
	tests := []struct {
		name          string
		result        *channel.ChannelResult
		wantScheduled bool
	}{
		{
			name:          "explicit retryable schedules first retry",
			result:        &channel.ChannelResult{Success: false, Error: errors.New("smtp timeout"), Retryable: boolPtr(true)},
			wantScheduled: true,
		},
		{
			name:          "explicit terminal is not retried",
			result:        &channel.ChannelResult{Success: false, Error: errors.New("permanent 400 bad recipient"), Retryable: boolPtr(false)},
			wantScheduled: false,
		},
		{
			name:          "5xx heuristic schedules retry",
			result:        &channel.ChannelResult{Success: false, Error: errors.New("provider returned 503")},
			wantScheduled: true,
		},
		{
			name:          "4xx heuristic is terminal",
			result:        &channel.ChannelResult{Success: false, Error: errors.New("provider returned 404")},
			wantScheduled: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ch := &dispatchChannel{name: model.ChannelEmail, result: tt.result}
			ins := &dispatchInserter{}
			d := newDispatcher(map[string]channel.Channel{ch.name: ch}, ins)

			results := d.Dispatch(context.Background(), testNotif(), []channel.ChannelDelivery{{Channel: model.ChannelEmail}})

			if len(results) != 1 || results[0].Success {
				t.Fatalf("expected one failed result, got %+v", results)
			}
			if results[0].Error == nil {
				t.Fatal("expected the channel error surfaced on the result")
			}
			if len(ins.records) != 1 {
				t.Fatalf("expected one delivery record, got %d", len(ins.records))
			}
			rec := ins.records[0]
			if rec.Status != model.DeliveryFailed {
				t.Errorf("expected failed status, got %q", rec.Status)
			}
			if rec.ErrorMessage == nil || *rec.ErrorMessage == "" {
				t.Error("expected error_message captured on failed record")
			}
			if scheduled := rec.NextRetryAt != nil; scheduled != tt.wantScheduled {
				t.Errorf("next_retry_at scheduled=%v, want %v", scheduled, tt.wantScheduled)
			}
		})
	}
}

// TestDispatch_InsertErrorDoesNotFlipSuccess asserts that a failure to write the
// delivery log does not turn a delivered channel result into a failure — the
// message already left the process, so the result stays successful (the log id
// is simply absent).
func TestDispatch_InsertErrorDoesNotFlipSuccess(t *testing.T) {
	ch := &dispatchChannel{name: model.ChannelInApp, result: &channel.ChannelResult{Success: true, Metadata: map[string]interface{}{}}}
	ins := &dispatchInserter{err: errors.New("db down")}
	d := newDispatcher(map[string]channel.Channel{ch.name: ch}, ins)

	results := d.Dispatch(context.Background(), testNotif(), []channel.ChannelDelivery{{Channel: model.ChannelInApp}})

	if len(results) != 1 || !results[0].Success {
		t.Fatalf("expected delivered result to survive a log-insert error, got %+v", results)
	}
	if _, ok := results[0].Metadata["delivery_log_id"]; ok {
		t.Error("expected no delivery_log_id when the insert failed")
	}
}

// TestDispatch_MultiChannelFanOut asserts every requested channel is delivered to
// concurrently and each produces its own record.
func TestDispatch_MultiChannelFanOut(t *testing.T) {
	inapp := &dispatchChannel{name: model.ChannelInApp, result: &channel.ChannelResult{Success: true}}
	email := &dispatchChannel{name: model.ChannelEmail, result: &channel.ChannelResult{Success: true}}
	ins := &dispatchInserter{}
	d := newDispatcher(map[string]channel.Channel{
		inapp.name: inapp,
		email.name: email,
	}, ins)

	results := d.Dispatch(context.Background(), testNotif(), []channel.ChannelDelivery{
		{Channel: model.ChannelInApp},
		{Channel: model.ChannelEmail},
	})

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if inapp.calls != 1 || email.calls != 1 {
		t.Fatalf("expected each channel invoked once, got in_app=%d email=%d", inapp.calls, email.calls)
	}
	// Fan-out order is non-deterministic; sort by channel for a stable assertion.
	got := []string{results[0].Channel, results[1].Channel}
	sort.Strings(got)
	if got[0] != model.ChannelEmail || got[1] != model.ChannelInApp {
		t.Fatalf("expected both channels represented, got %v", got)
	}
	if len(ins.records) != 2 {
		t.Fatalf("expected 2 delivery records, got %d", len(ins.records))
	}
}
