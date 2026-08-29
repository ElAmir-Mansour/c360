package monitor

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

type fakeDeliveryAutoCloser struct {
	tenants []uuid.UUID
	expired map[uuid.UUID][]model.DeliveryConfirmation
	limits  []int
	closed  []uuid.UUID
}

func (f *fakeDeliveryAutoCloser) ListTenantIDs(context.Context) ([]uuid.UUID, error) {
	return f.tenants, nil
}

func (f *fakeDeliveryAutoCloser) ListExpired(_ context.Context, tenantID uuid.UUID, limit int) ([]model.DeliveryConfirmation, error) {
	f.limits = append(f.limits, limit)
	return f.expired[tenantID], nil
}

func (f *fakeDeliveryAutoCloser) AutoClose(_ context.Context, dc *model.DeliveryConfirmation) error {
	f.closed = append(f.closed, dc.ID)
	return nil
}

func TestDeliveryAutoCloseMonitorRunOnceClosesExpiredConfirmations(t *testing.T) {
	tenantA := uuid.New()
	tenantB := uuid.New()
	confirmationA := uuid.New()
	confirmationB := uuid.New()
	fake := &fakeDeliveryAutoCloser{
		tenants: []uuid.UUID{tenantA, tenantB},
		expired: map[uuid.UUID][]model.DeliveryConfirmation{
			tenantA: {{ID: confirmationA, TenantID: tenantA}},
			tenantB: {{ID: confirmationB, TenantID: tenantB}},
		},
	}
	monitor := NewDeliveryAutoCloseMonitor(fake, time.Minute, zerolog.Nop())

	if err := monitor.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if want := []uuid.UUID{confirmationA, confirmationB}; !reflect.DeepEqual(fake.closed, want) {
		t.Fatalf("closed confirmations = %#v, want %#v", fake.closed, want)
	}
	if want := []int{deliveryAutoCloseBatch, deliveryAutoCloseBatch}; !reflect.DeepEqual(fake.limits, want) {
		t.Fatalf("ListExpired limits = %#v, want %#v", fake.limits, want)
	}
}
