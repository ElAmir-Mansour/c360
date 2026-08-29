package monitor

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/lex/service"
)

// proximityHorizons is the descending set of calendar-day horizons at which an
// approaching-hearing reminder fires (CAP-162). Each (hearing, horizon) pair is
// deduped via lex_hearing_proximity_marker so the idempotent monitor reminds at
// most once per bucket. Proximity is calendar-day based by nature: it measures
// the wall-clock days until an absolute hearing date, not working-time turnaround
// (the calendar.Calculator engine governs SLA/turnaround math, not absolute
// hearing dates).
var proximityHorizons = []int{7, 3, 1, 0}

// proximityNotifier is the in-app/email write seam the monitor drives. It is
// satisfied by *service.LexNotificationService.
type proximityNotifier interface {
	Notify(ctx context.Context, tenantID uuid.UUID, in service.NotifyInput) (bool, error)
}

// proximityStore is the persistence seam: cross-tenant fan-out, the upcoming
// hearing scan, and the dedup-marker ledger. Satisfied by
// *repository.NotificationSubscriptionRepository.
type proximityStore interface {
	ListTenantIDs(ctx context.Context) ([]uuid.UUID, error)
	ListUpcomingHearings(ctx context.Context, tenantID uuid.UUID, from, until time.Time) ([]model.UpcomingHearing, error)
	MarkHearingProximity(ctx context.Context, q repository.Queryer, tenantID, caseID, hearingID uuid.UUID, horizonDays int, hearingDate, firedAt time.Time, createdBy uuid.UUID) (bool, error)
}

// ProximityMonitor is the background ticker that emits approaching-hearing-date
// reminders (CAP-162). It mirrors ExpiryMonitor (Run/RunOnce + ticker) and
// SLAMonitor/ComplianceMonitor (cross-tenant fan-out via ListTenantIDs). Each
// iteration scans every tenant's upcoming hearings within the widest horizon,
// buckets each hearing into the largest not-yet-fired horizon, dedups via the
// proximity marker, and writes a durable inbox row (+ email fan-out) per case
// owner.
type ProximityMonitor struct {
	notifier proximityNotifier
	store    proximityStore
	interval time.Duration
	logger   zerolog.Logger
	now      func() time.Time
}

func NewProximityMonitor(notifier proximityNotifier, store proximityStore, interval time.Duration, logger zerolog.Logger) *ProximityMonitor {
	if interval <= 0 {
		interval = time.Hour
	}
	return &ProximityMonitor{
		notifier: notifier,
		store:    store,
		interval: interval,
		logger:   logger.With().Str("component", "lex-proximity-monitor").Logger(),
		now:      time.Now,
	}
}

func (m *ProximityMonitor) Run(ctx context.Context) error {
	if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
		m.logger.Error().Err(err).Msg("proximity monitor iteration failed")
	}

	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := m.RunOnce(ctx); err != nil && ctx.Err() == nil {
				m.logger.Error().Err(err).Msg("proximity monitor iteration failed")
			}
		}
	}
}

func (m *ProximityMonitor) RunOnce(ctx context.Context) error {
	if m.notifier == nil || m.store == nil {
		return fmt.Errorf("proximity monitor is not configured")
	}
	tenantIDs, err := m.store.ListTenantIDs(ctx)
	if err != nil {
		return err
	}
	var errs []error
	for _, tenantID := range tenantIDs {
		if err := m.processTenant(ctx, tenantID); err != nil {
			errs = append(errs, fmt.Errorf("tenant %s: %w", tenantID, err))
		}
	}
	return errors.Join(errs...)
}

func (m *ProximityMonitor) processTenant(ctx context.Context, tenantID uuid.UUID) error {
	now := m.now().UTC()
	today := normalizeMonitorDate(now)
	widest := proximityHorizons[0]
	// Scan from the start of today through the end of the widest horizon day so a
	// hearing later today (horizon 0) is still in window.
	until := today.AddDate(0, 0, widest).Add(24*time.Hour - time.Nanosecond)

	hearings, err := m.store.ListUpcomingHearings(ctx, tenantID, today, until)
	if err != nil {
		return err
	}

	var errs []error
	for i := range hearings {
		if err := m.processHearing(ctx, tenantID, hearings[i], today, now); err != nil {
			errs = append(errs, fmt.Errorf("hearing %s: %w", hearings[i].HearingID, err))
		}
	}
	return errors.Join(errs...)
}

func (m *ProximityMonitor) processHearing(ctx context.Context, tenantID uuid.UUID, h model.UpcomingHearing, today, now time.Time) error {
	days := daysUntil(h.HearingDate, today)
	horizon, ok := bucketHorizon(days)
	if !ok {
		return nil
	}

	recipients := h.Recipients()
	if len(recipients) == 0 {
		// No resolvable owner; still record the marker so we do not rescan this
		// (hearing, horizon) pair every tick.
		_, err := m.store.MarkHearingProximity(ctx, nil, tenantID, h.CaseID, h.HearingID, horizon, h.HearingDate, now, systemActorID)
		return err
	}

	title, body := proximityContent(h, horizon)
	entityID := h.HearingID
	actionURL := fmt.Sprintf("/lex/cases/%s/hearings/%s", h.CaseID, h.HearingID)

	var errs []error
	for _, recipientID := range recipients {
		dedup := fmt.Sprintf("hearing.proximity:%s:%d:%s", h.HearingID, horizon, recipientID)
		if _, err := m.notifier.Notify(ctx, tenantID, service.NotifyInput{
			RecipientID: recipientID,
			Category:    model.NotificationCategoryHearing,
			Title:       title,
			Body:        body,
			EntityType:  "legal_case_hearing",
			EntityID:    &entityID,
			ActionURL:   actionURL,
			DedupKey:    dedup,
			Email:       true,
			Metadata: map[string]any{
				"case_id":      h.CaseID.String(),
				"case_number":  h.CaseNumber,
				"hearing_date": h.HearingDate.UTC().Format(time.RFC3339),
				"horizon_days": horizon,
				"days_until":   days,
			},
			CreatedBy: systemActorID,
		}); err != nil {
			errs = append(errs, fmt.Errorf("recipient %s: %w", recipientID, err))
		}
	}
	if len(errs) > 0 {
		return errors.Join(errs...)
	}

	// Record the dedup marker only after the fan-out succeeded so a transient
	// failure is retried on the next tick (mirrors the expiry-notification
	// record-then-emit ordering, inverted here because the inbox row carries its
	// own per-recipient dedup key).
	if _, err := m.store.MarkHearingProximity(ctx, nil, tenantID, h.CaseID, h.HearingID, horizon, h.HearingDate, now, systemActorID); err != nil {
		return err
	}
	return nil
}

// bucketHorizon maps a calendar-day distance to the smallest horizon bucket that
// still contains it (e.g. 5 days -> 7-day bucket, 2 days -> 3-day bucket,
// 0 days -> 0-day bucket). proximityHorizons is descending, so the last horizon
// that is >= days is the tightest fit. A negative distance (hearing already
// passed) or a distance beyond the widest horizon yields no bucket.
func bucketHorizon(days int) (int, bool) {
	if days < 0 {
		return 0, false
	}
	chosen := -1
	for _, horizon := range proximityHorizons {
		if days <= horizon {
			chosen = horizon
		}
	}
	if chosen < 0 {
		return 0, false
	}
	return chosen, true
}

func daysUntil(hearingDate, today time.Time) int {
	return int(normalizeMonitorDate(hearingDate).Sub(today).Hours() / 24)
}

func proximityContent(h model.UpcomingHearing, horizon int) (forms.LocalizedText, forms.LocalizedText) {
	caseTitle := decodeLocalized(h.CaseTitle)
	caseLabelEN := caseTitle.Localize("en")
	if caseLabelEN == "" {
		caseLabelEN = h.CaseNumber
	}
	caseLabelAR := caseTitle.Localize("ar")
	if caseLabelAR == "" {
		caseLabelAR = h.CaseNumber
	}

	dateStr := h.HearingDate.UTC().Format("2006-01-02")
	var en, ar string
	switch horizon {
	case 0:
		en = fmt.Sprintf("Hearing today for case %s (%s).", caseLabelEN, dateStr)
		ar = fmt.Sprintf("جلسة اليوم للقضية %s (%s).", caseLabelAR, dateStr)
	case 1:
		en = fmt.Sprintf("Hearing tomorrow for case %s (%s).", caseLabelEN, dateStr)
		ar = fmt.Sprintf("جلسة غداً للقضية %s (%s).", caseLabelAR, dateStr)
	default:
		en = fmt.Sprintf("Hearing in %d days for case %s (%s).", horizon, caseLabelEN, dateStr)
		ar = fmt.Sprintf("جلسة بعد %d أيام للقضية %s (%s).", horizon, caseLabelAR, dateStr)
	}

	title := forms.LocalizedText{
		EN: "Upcoming hearing reminder",
		AR: "تذكير بجلسة قادمة",
	}
	body := forms.LocalizedText{EN: en, AR: ar}
	return title, body
}

func decodeLocalized(raw []byte) forms.LocalizedText {
	var lt forms.LocalizedText
	if len(raw) == 0 {
		return lt
	}
	_ = lt.UnmarshalJSON(raw)
	return lt
}
