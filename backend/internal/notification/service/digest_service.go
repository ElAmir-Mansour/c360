package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/channel"
	"github.com/clario360/platform/internal/notification/metrics"
	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/repository"
)

// DigestService aggregates notifications and sends periodic digest emails.
type DigestService struct {
	notifRepo  *repository.NotificationRepository
	prefRepo   *repository.PreferenceRepository
	tmplSvc    *TemplateService
	dispatcher *DispatcherService
	logger     zerolog.Logger

	dailyUTCHour int
	weeklyDay    int    // 0=Sunday, 1=Monday, ...
	publicAppURL string // base URL used for the digest "view all" link
}

// NewDigestService creates a new DigestService. publicAppURL is the base URL
// used to build the digest email's "view all notifications" link.
func NewDigestService(
	notifRepo *repository.NotificationRepository,
	prefRepo *repository.PreferenceRepository,
	tmplSvc *TemplateService,
	dispatcher *DispatcherService,
	dailyUTCHour int,
	weeklyDay int,
	publicAppURL string,
	logger zerolog.Logger,
) *DigestService {
	return &DigestService{
		notifRepo:    notifRepo,
		prefRepo:     prefRepo,
		tmplSvc:      tmplSvc,
		dispatcher:   dispatcher,
		dailyUTCHour: dailyUTCHour,
		weeklyDay:    weeklyDay,
		publicAppURL: publicAppURL,
		logger:       logger.With().Str("component", "digest_service").Logger(),
	}
}

// RunScheduler runs the digest scheduling loop until context is cancelled.
func (s *DigestService) RunScheduler(ctx context.Context) error {
	ticker := time.NewTicker(1 * time.Minute)
	defer ticker.Stop()

	var lastDailyRun, lastWeeklyRun time.Time

	for {
		select {
		case <-ctx.Done():
			return nil
		case now := <-ticker.C:
			utcNow := now.UTC()

			// Daily digest: run once at the configured hour.
			if utcNow.Hour() == s.dailyUTCHour && utcNow.Sub(lastDailyRun) > 23*time.Hour {
				s.logger.Info().Msg("triggering daily digest")
				if err := s.sendDigests(ctx, "daily", 24*time.Hour); err != nil {
					s.logger.Error().Err(err).Msg("daily digest failed")
				}
				lastDailyRun = utcNow
			}

			// Weekly digest: run once on the configured day at the configured hour.
			if int(utcNow.Weekday()) == s.weeklyDay && utcNow.Hour() == s.dailyUTCHour && utcNow.Sub(lastWeeklyRun) > 6*24*time.Hour {
				s.logger.Info().Msg("triggering weekly digest")
				if err := s.sendDigests(ctx, "weekly", 7*24*time.Hour); err != nil {
					s.logger.Error().Err(err).Msg("weekly digest failed")
				}
				lastWeeklyRun = utcNow
			}
		}
	}
}

func (s *DigestService) sendDigests(ctx context.Context, frequency string, lookback time.Duration) error {
	tenants, err := s.prefRepo.ListAllTenants(ctx)
	if err != nil {
		return err
	}

	since := time.Now().UTC().Add(-lookback)

	for _, tenantID := range tenants {
		subscribers, err := s.prefRepo.GetDigestSubscribers(ctx, tenantID, frequency)
		if err != nil {
			s.logger.Warn().Err(err).Str("tenant_id", tenantID).Msg("failed to get digest subscribers")
			continue
		}

		if len(subscribers) == 0 {
			continue
		}

		// Fetch unread notifications for this tenant.
		notifications, err := s.notifRepo.GetUnreadForDigest(ctx, tenantID, since)
		if err != nil {
			s.logger.Warn().Err(err).Str("tenant_id", tenantID).Msg("failed to get digest notifications")
			continue
		}

		// Group notifications by user.
		userNotifs := make(map[string][]model.Notification)
		for _, n := range notifications {
			userNotifs[n.UserID] = append(userNotifs[n.UserID], n)
		}

		// Send digest to each subscribed user who has unread notifications.
		subscriberSet := make(map[string]bool, len(subscribers))
		for _, uid := range subscribers {
			subscriberSet[uid] = true
		}

		for userID, notifs := range userNotifs {
			if !subscriberSet[userID] || len(notifs) == 0 {
				continue
			}

			if err := s.sendUserDigest(ctx, tenantID, userID, notifs, frequency); err != nil {
				s.logger.Warn().Err(err).
					Str("user_id", userID).
					Str("frequency", frequency).
					Msg("failed to send digest to user")
			} else {
				metrics.DigestsSent.WithLabelValues(frequency).Inc()
			}
		}
	}

	return nil
}

func (s *DigestService) sendUserDigest(ctx context.Context, tenantID, userID string, notifs []model.Notification, frequency string) error {
	digestNotif, hasEmail, err := s.buildDigestNotification(tenantID, userID, notifs, frequency)
	if err != nil {
		return err
	}

	// Insert the in-app digest row.
	id, err := s.notifRepo.Insert(ctx, digestNotif)
	if err != nil {
		return err
	}
	digestNotif.ID = id

	// Dispatch the digest as an email when we have an address (#10). The
	// dispatcher records a delivery-log row; a transient failure is picked up by
	// the retry worker. Without an email address, the in-app row is the digest.
	if hasEmail {
		s.dispatcher.Dispatch(ctx, digestNotif, []channel.ChannelDelivery{
			{Channel: model.ChannelEmail},
		})
	}

	return nil
}

// buildDigestNotification assembles the synthetic "digest" notification and its
// template payload, returning whether an email address was resolved (and thus
// whether the digest should be dispatched over email). Split out so the payload
// assembly is unit-testable without a database.
func (s *DigestService) buildDigestNotification(tenantID, userID string, notifs []model.Notification, frequency string) (*model.Notification, bool, error) {
	// The "digest" template renders {{.count}}, {{range .items}}{{.Title}}/
	// {{.Body}}{{end}} and {{.dashboard_url}}; item keys are capitalized so they
	// survive the JSON round-trip through notif.Data.
	items := make([]map[string]string, 0, len(notifs))
	for _, n := range notifs {
		items = append(items, map[string]string{"Title": n.Title, "Body": n.Body})
	}

	digestData := map[string]interface{}{
		"count":         len(notifs),
		"items":         items,
		"dashboard_url": strings.TrimRight(s.publicAppURL, "/") + "/notifications",
		"frequency":     frequency,
		// Arabic subject/body variants so the digest renders fully in Arabic (not
		// just its chrome) for RTL recipients; localizedNotificationField picks
		// the en/ar side from the resolved locale below.
		"title_ar": strings.TrimSpace("ملخص إشعاراتك " + arabicDigestFrequency(frequency)),
		"body_ar":  fmt.Sprintf("لديك %d إشعارات غير مقروءة.", len(notifs)),
	}
	// Carry an email address forward if any source notification has one, so the
	// email channel can deliver the digest.
	email := firstNotificationEmail(notifs)
	if email != "" {
		digestData["email"] = email
	}
	// Preserve the recipient locale captured on the source notifications at their
	// enqueue time; default to the KSA locale when none carried one, so the async
	// digest email is Arabic-first by default.
	locale := firstNotificationLocale(notifs)
	if locale == "" {
		locale = defaultRecipientLocale
	}
	digestData["locale"] = locale
	dataBytes, err := json.Marshal(digestData)
	if err != nil {
		return nil, false, fmt.Errorf("marshal digest data: %w", err)
	}

	// Type "digest" selects the digest email template.
	digestNotif := &model.Notification{
		TenantID: tenantID,
		UserID:   userID,
		Type:     "digest",
		Category: model.CategorySystem,
		Priority: model.PriorityLow,
		Title:    strings.TrimSpace("ملخص إشعاراتك " + arabicDigestFrequency(frequency)),
		Body:     fmt.Sprintf("لديك %d إشعارات غير مقروءة.", len(notifs)),
		Data:     dataBytes,
	}
	return digestNotif, email != "", nil
}

// arabicDigestFrequency maps the digest cadence to its Arabic adjective for the
// localized digest subject (e.g. "ملخص إشعاراتك اليومي"). Unknown cadences yield
// an empty string so the caller renders a cadence-agnostic Arabic title.
func arabicDigestFrequency(frequency string) string {
	switch frequency {
	case "daily":
		return "اليومي"
	case "weekly":
		return "الأسبوعي"
	default:
		return ""
	}
}

// firstNotificationEmail returns the first email/user_email found in the source
// notifications' data payloads, or "".
func firstNotificationEmail(notifs []model.Notification) string {
	for i := range notifs {
		if len(notifs[i].Data) == 0 {
			continue
		}
		var d map[string]interface{}
		if err := json.Unmarshal(notifs[i].Data, &d); err != nil {
			continue
		}
		for _, key := range []string{"email", "user_email"} {
			if v, ok := d[key].(string); ok && strings.TrimSpace(v) != "" {
				return v
			}
		}
	}
	return ""
}

// firstNotificationLocale returns the first locale-like value found in the
// source notifications' data payloads, or "".
func firstNotificationLocale(notifs []model.Notification) string {
	for i := range notifs {
		if len(notifs[i].Data) == 0 {
			continue
		}
		var d map[string]interface{}
		if err := json.Unmarshal(notifs[i].Data, &d); err != nil {
			continue
		}
		for _, key := range []string{"locale", "language", "lang", "preferred_locale"} {
			if v, ok := d[key].(string); ok && strings.TrimSpace(v) != "" {
				return v
			}
		}
	}
	return ""
}
