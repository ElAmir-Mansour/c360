package monitor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// deliveryAutoCloseBatch caps how many expired confirmations a single tenant
// sweep pulls per iteration so one busy tenant cannot starve the fan-out.
const deliveryAutoCloseBatch = 200

// DeliveryAutoCloseMonitor is the CAP-028 sweeper: it periodically finds delivery
// confirmations whose working-calendar-aware deadline (CAP-029) has passed
// without a requester response and auto-closes them via
// DeliveryConfirmationService.AutoClose. It mirrors ComplianceMonitor's
// cross-tenant fan-out (ListTenantIDs) and expiry_monitor's Run/RunOnce ticker.
type DeliveryAutoCloseMonitor struct {
	confirmations deliveryConfirmationAutoCloser
	interval      time.Duration
	logger        zerolog.Logger
}

type deliveryConfirmationAutoCloser interface {
	ListTenantIDs(ctx context.Context) ([]uuid.UUID, error)
	ListExpired(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.DeliveryConfirmation, error)
	AutoClose(ctx context.Context, dc *model.DeliveryConfirmation) error
}

func NewDeliveryAutoCloseMonitor(confirmations deliveryConfirmationAutoCloser, interval time.Duration, logger zerolog.Logger) *DeliveryAutoCloseMonitor {
	if interval <= 0 {
		interval = time.Hour
	}
	return &DeliveryAutoCloseMonitor{
		confirmations: confirmations,
		interval:      interval,
		logger:        logger.With().Str("component", "lex-delivery-autoclose-monitor").Logger(),
	}
}

func (m *DeliveryAutoCloseMonitor) Run(ctx context.Context) error {
	if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
		m.logger.Error().Err(err).Msg("delivery auto-close monitor iteration failed")
	}

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
				m.logger.Error().Err(err).Msg("delivery auto-close monitor iteration failed")
			}
		}
	}
}

func (m *DeliveryAutoCloseMonitor) RunOnce(ctx context.Context) error {
	tenantIDs, err := m.confirmations.ListTenantIDs(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, tenantID := range tenantIDs {
		expired, err := m.confirmations.ListExpired(ctx, tenantID, deliveryAutoCloseBatch)
		if err != nil {
			errs = append(errs, fmt.Errorf("tenant %s list expired: %w", tenantID, err))
			continue
		}
		for i := range expired {
			dc := expired[i]
			if err := m.confirmations.AutoClose(ctx, &dc); err != nil {
				errs = append(errs, fmt.Errorf("auto-close confirmation %s: %w", dc.ID, err))
			}
		}
	}
	return errors.Join(errs...)
}
