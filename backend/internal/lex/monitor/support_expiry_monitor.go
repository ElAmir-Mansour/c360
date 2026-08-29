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

const (
	supportExpiryBatch           = 200
	defaultSupportExpiryInterval = 5 * time.Minute
)

// supportExpiryService deliberately exposes a single atomic expiry operation.
// The implementation performs the bounded status transition and returns only
// rows actually changed by that statement; the monitor must not select then
// update requests one at a time.
type supportExpiryService interface {
	ListTenantIDs(ctx context.Context, now time.Time) ([]uuid.UUID, error)
	ExpireDue(ctx context.Context, tenantID uuid.UUID, now time.Time, limit int) ([]model.SupportRequest, error)
}

type supportExpiryMetrics interface {
	RecordSupportRequestsExpired(count int)
}

// SupportExpiryMonitor periodically fans out over tenants with due support
// requests and invokes one bounded, atomic expiry sweep for each tenant.
type SupportExpiryMonitor struct {
	support  supportExpiryService
	metrics  supportExpiryMetrics
	interval time.Duration
	now      func() time.Time
	logger   zerolog.Logger
}

func NewSupportExpiryMonitor(support supportExpiryService, metrics supportExpiryMetrics, interval time.Duration, logger zerolog.Logger) *SupportExpiryMonitor {
	if interval <= 0 {
		interval = defaultSupportExpiryInterval
	}
	return &SupportExpiryMonitor{
		support:  support,
		metrics:  metrics,
		interval: interval,
		now:      time.Now,
		logger:   logger.With().Str("component", "lex-support-expiry-monitor").Logger(),
	}
}

func (m *SupportExpiryMonitor) Run(ctx context.Context) error {
	if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
		m.logger.Error().Err(err).Msg("support expiry monitor iteration failed")
	}

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
				m.logger.Error().Err(err).Msg("support expiry monitor iteration failed")
			}
		}
	}
}

func (m *SupportExpiryMonitor) RunOnce(ctx context.Context) error {
	if m == nil || m.support == nil {
		return fmt.Errorf("support expiry service is not configured")
	}
	now := m.now().UTC()
	tenantIDs, err := m.support.ListTenantIDs(ctx, now)
	if err != nil {
		return err
	}
	var errs []error
	for _, tenantID := range tenantIDs {
		expired, expireErr := m.support.ExpireDue(ctx, tenantID, now, supportExpiryBatch)
		if expireErr != nil {
			errs = append(errs, fmt.Errorf("tenant %s expire due support requests: %w", tenantID, expireErr))
			continue
		}
		if m.metrics != nil {
			m.metrics.RecordSupportRequestsExpired(len(expired))
		}
	}
	return errors.Join(errs...)
}
