package service

import (
	"context"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/channel"
	"github.com/clario360/platform/internal/notification/model"
)

// suppTestChannel records whether Send was invoked.
type suppTestChannel struct {
	name   string
	called bool
}

func (c *suppTestChannel) Name() string { return c.name }
func (c *suppTestChannel) Send(ctx context.Context, notif *model.Notification) *channel.ChannelResult {
	c.called = true
	return &channel.ChannelResult{Success: true}
}

// suppTestInserter captures the delivery records the dispatcher writes.
type suppTestInserter struct {
	records []*model.DeliveryRecord
}

func (f *suppTestInserter) Insert(ctx context.Context, rec *model.DeliveryRecord) (string, error) {
	f.records = append(f.records, rec)
	return "log-1", nil
}

// suppTestChecker is a programmable suppression checker.
type suppTestChecker struct {
	suppressed bool
	calls      int
}

func (f *suppTestChecker) IsSuppressed(ctx context.Context, tenantID, userID, ch string) (bool, error) {
	f.calls++
	return f.suppressed, nil
}

func newSuppDispatcher(ch *suppTestChannel, ins deliveryRecorder, sup SuppressionChecker) *DispatcherService {
	d := &DispatcherService{
		channels:     map[string]channel.Channel{ch.name: ch},
		deliveryRepo: ins,
		logger:       zerolog.Nop(),
	}
	if sup != nil {
		d.SetSuppressionChecker(sup)
	}
	return d
}

// TestDispatch_SuppressedEmailIsSkipped asserts a suppressed user never has the
// email channel invoked and a "skipped" delivery is recorded instead.
func TestDispatch_SuppressedEmailIsSkipped(t *testing.T) {
	ch := &suppTestChannel{name: model.ChannelEmail}
	ins := &suppTestInserter{}
	sup := &suppTestChecker{suppressed: true}
	d := newSuppDispatcher(ch, ins, sup)

	notif := &model.Notification{ID: "n1", TenantID: "t1", UserID: "u1", Type: model.NotifAlertCreated}
	results := d.Dispatch(context.Background(), notif, []channel.ChannelDelivery{{Channel: model.ChannelEmail}})

	if ch.called {
		t.Fatal("expected suppressed email channel Send NOT to be called")
	}
	if len(results) != 1 || !results[0].Success {
		t.Fatalf("expected one successful (intentionally-skipped) result, got %+v", results)
	}
	if len(ins.records) != 1 || ins.records[0].Status != model.DeliverySkipped {
		t.Fatalf("expected a single skipped delivery record, got %+v", ins.records)
	}
}

// TestDispatch_NonSuppressedEmailIsDelivered asserts an unsuppressed user reaches
// the channel and a delivered record is written after exactly one suppression
// check.
func TestDispatch_NonSuppressedEmailIsDelivered(t *testing.T) {
	ch := &suppTestChannel{name: model.ChannelEmail}
	ins := &suppTestInserter{}
	sup := &suppTestChecker{suppressed: false}
	d := newSuppDispatcher(ch, ins, sup)

	notif := &model.Notification{ID: "n1", TenantID: "t1", UserID: "u1", Type: model.NotifAlertCreated}
	_ = d.Dispatch(context.Background(), notif, []channel.ChannelDelivery{{Channel: model.ChannelEmail}})

	if !ch.called {
		t.Fatal("expected non-suppressed email channel Send to be called")
	}
	if sup.calls != 1 {
		t.Fatalf("expected exactly one suppression check, got %d", sup.calls)
	}
	if len(ins.records) != 1 || ins.records[0].Status != model.DeliveryDelivered {
		t.Fatalf("expected a delivered delivery record, got %+v", ins.records)
	}
}

// TestDispatch_InAppNotSuppressionChecked asserts the in-app channel (the user's
// own inbox) is never consulted against the suppression list.
func TestDispatch_InAppNotSuppressionChecked(t *testing.T) {
	ch := &suppTestChannel{name: model.ChannelInApp}
	ins := &suppTestInserter{}
	sup := &suppTestChecker{suppressed: true} // would suppress if it were checked
	d := newSuppDispatcher(ch, ins, sup)

	notif := &model.Notification{ID: "n1", TenantID: "t1", UserID: "u1", Type: model.NotifAlertCreated}
	_ = d.Dispatch(context.Background(), notif, []channel.ChannelDelivery{{Channel: model.ChannelInApp}})

	if !ch.called {
		t.Fatal("expected in-app channel to deliver regardless of suppression list")
	}
	if sup.calls != 0 {
		t.Fatalf("expected no suppression check for in-app, got %d", sup.calls)
	}
}
