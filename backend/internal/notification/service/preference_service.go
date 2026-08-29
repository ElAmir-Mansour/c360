package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/metrics"
	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/repository"
)

// failClosedPreferences is the safe channel set used when preference resolution
// fails: best-effort in-app only, ALL outbound channels suppressed (#11). It is
// deliberately NOT model.DefaultPreferences (which is all-on) — falling open to
// email/webhook/websocket on a resolution error would leak notifications a user
// may have muted and could amplify a DB outage into an outbound blast.
var failClosedPreferences = model.ChannelPreference{
	InApp:     true,
	Email:     false,
	WebSocket: false,
	Webhook:   false,
}

const prefCacheTTL = 5 * time.Minute
const prefCachePrefix = "notif:pref:"

// preferenceStore is the subset of *repository.PreferenceRepository the service
// depends on. Declaring it as an interface lets the fail-closed resolution path
// be unit-tested with a fake store; production still passes the concrete repo
// via NewPreferenceService, so no call site changes.
type preferenceStore interface {
	Get(ctx context.Context, userID, tenantID string) (*model.NotificationPreference, error)
	Upsert(ctx context.Context, pref *model.NotificationPreference) error
}

// PreferenceService handles preference CRUD and resolution.
type PreferenceService struct {
	repo   preferenceStore
	rdb    *redis.Client
	logger zerolog.Logger
}

// NewPreferenceService creates a new PreferenceService.
func NewPreferenceService(repo *repository.PreferenceRepository, rdb *redis.Client, logger zerolog.Logger) *PreferenceService {
	return &PreferenceService{
		repo:   repo,
		rdb:    rdb,
		logger: logger.With().Str("component", "preference_service").Logger(),
	}
}

// Get returns the user's preferences, with defaults merged if no record exists.
func (s *PreferenceService) Get(ctx context.Context, userID, tenantID string) (*model.NotificationPreference, error) {
	// Try cache first (nil-safe: a missing Redis degrades to a direct DB read).
	cacheKey := prefCachePrefix + userID + ":" + tenantID
	if s.rdb != nil {
		if cached, cErr := s.rdb.Get(ctx, cacheKey).Bytes(); cErr == nil {
			var pref model.NotificationPreference
			if json.Unmarshal(cached, &pref) == nil {
				return &pref, nil
			}
		}
	}

	pref, err := s.repo.Get(ctx, userID, tenantID)
	if err != nil {
		return nil, err
	}

	if pref == nil {
		pref = &model.NotificationPreference{
			UserID:       userID,
			TenantID:     tenantID,
			GlobalPrefs:  model.DefaultPreferences,
			PerTypePrefs: make(map[model.NotificationType]model.ChannelPreference),
			DigestConfig: model.DigestConfig{Daily: false, Weekly: true},
			UpdatedAt:    time.Now(),
		}
	}

	// Cache.
	if s.rdb != nil {
		if data, err := json.Marshal(pref); err == nil {
			s.rdb.Set(ctx, cacheKey, data, prefCacheTTL)
		}
	}

	return pref, nil
}

// Update merges the update request into the user's existing preferences.
// optedOut is the optional global opt-out (#17); nil leaves it unchanged so
// existing callers passing nil preserve the prior behaviour.
func (s *PreferenceService) Update(ctx context.Context, userID, tenantID string, globalPrefs *model.ChannelPreference, perTypePrefs map[model.NotificationType]model.ChannelPreference, quietHours *model.QuietHours, digestConfig *model.DigestConfig, optedOut *bool) error {
	existing, err := s.Get(ctx, userID, tenantID)
	if err != nil {
		return err
	}

	// Merge.
	if globalPrefs != nil {
		existing.GlobalPrefs = *globalPrefs
	}
	if perTypePrefs != nil {
		if existing.PerTypePrefs == nil {
			existing.PerTypePrefs = make(map[model.NotificationType]model.ChannelPreference)
		}
		for k, v := range perTypePrefs {
			existing.PerTypePrefs[k] = v
		}
	}
	if quietHours != nil {
		existing.QuietHours = quietHours
	}
	if digestConfig != nil {
		existing.DigestConfig = *digestConfig
	}
	if optedOut != nil {
		existing.OptedOut = *optedOut
	}

	if err := s.repo.Upsert(ctx, existing); err != nil {
		return err
	}

	s.invalidate(ctx, userID, tenantID)
	return nil
}

// DisableEmail turns the user's global email channel preference off. Used by the
// one-click unsubscribe flow (#17) alongside the suppression-list insert.
func (s *PreferenceService) DisableEmail(ctx context.Context, userID, tenantID string) error {
	existing, err := s.Get(ctx, userID, tenantID)
	if err != nil {
		return err
	}
	existing.GlobalPrefs.Email = false
	if err := s.repo.Upsert(ctx, existing); err != nil {
		return err
	}
	s.invalidate(ctx, userID, tenantID)
	return nil
}

// SetGlobalOptOut flips the global opt-out kill-switch (#17), unsubscribing the
// user from (or resubscribing them to) all notifications.
func (s *PreferenceService) SetGlobalOptOut(ctx context.Context, userID, tenantID string, optedOut bool) error {
	existing, err := s.Get(ctx, userID, tenantID)
	if err != nil {
		return err
	}
	existing.OptedOut = optedOut
	if err := s.repo.Upsert(ctx, existing); err != nil {
		return err
	}
	s.invalidate(ctx, userID, tenantID)
	return nil
}

// invalidate drops the cached preference record so the next read is fresh.
func (s *PreferenceService) invalidate(ctx context.Context, userID, tenantID string) {
	if s.rdb != nil {
		s.rdb.Del(ctx, prefCachePrefix+userID+":"+tenantID)
	}
}

// ResolveChannels resolves which channels should be used for a given
// notification, based on user preferences (per-type override or global).
//
// Fail-closed (#11): if resolution fails (cache miss + DB error), it retries
// ONCE directly from the DB (bypassing the cache), and if that also fails it
// returns failClosedPreferences — best-effort in_app only, outbound channels
// SUPPRESSED — never model.DefaultPreferences (all-on). The returned error is
// non-nil for observability, but the first return value is already the safe set
// so a caller that ignores the error cannot fall open.
func (s *PreferenceService) ResolveChannels(ctx context.Context, userID, tenantID string, notifType model.NotificationType) (model.ChannelPreference, error) {
	pref, err := s.Get(ctx, userID, tenantID)
	if err != nil {
		// Retry once straight from the DB (skip the cache path).
		pref, err = s.repo.Get(ctx, userID, tenantID)
		if err == nil && pref == nil {
			// No record exists — genuine "unconfigured" default (all-on except
			// webhook), NOT a resolution failure, so we do not fail closed.
			return model.DefaultPreferences, nil
		}
	}
	if err != nil {
		metrics.PrefResolutionFallback.Inc()
		s.logger.Error().
			Err(err).
			Str("user_id", userID).
			Str("tenant_id", tenantID).
			Str("type", string(notifType)).
			Msg("preference resolution failed after DB retry; failing closed to in_app only")
		return failClosedPreferences, fmt.Errorf("resolve channels: %w", err)
	}

	return s.resolveFrom(pref, notifType), nil
}

// resolveFrom applies the global opt-out, then the per-type override / global
// precedence to a resolved preference record.
func (s *PreferenceService) resolveFrom(pref *model.NotificationPreference, notifType model.NotificationType) model.ChannelPreference {
	if pref == nil {
		return failClosedPreferences
	}
	// Global opt-out (#17) wins over every per-channel/per-type setting: the user
	// has unsubscribed from all notifications.
	if pref.OptedOut {
		return model.AllChannelsOff
	}
	if perType, ok := pref.PerTypePrefs[notifType]; ok {
		return perType
	}
	return pref.GlobalPrefs
}

// IsInQuietHours checks if the current time falls within the user's quiet hours.
func (s *PreferenceService) IsInQuietHours(ctx context.Context, userID, tenantID string) (bool, error) {
	pref, err := s.Get(ctx, userID, tenantID)
	if err != nil {
		return false, err
	}

	return QuietHoursActiveAt(pref.QuietHours, time.Now())
}

// QuietHoursDeferUntil returns the time until which a non-critical notification
// should be deferred for the user's quiet hours, or nil if it should be sent
// now (quiet hours disabled, not active, or a resolution error). The returned
// time is used to set notification_delivery_log.deliver_after so the flush loop
// (#10) releases the deferred delivery at the end of the quiet-hours window.
func (s *PreferenceService) QuietHoursDeferUntil(ctx context.Context, userID, tenantID string) (*time.Time, error) {
	pref, err := s.Get(ctx, userID, tenantID)
	if err != nil {
		return nil, err
	}
	if pref == nil || pref.QuietHours == nil || !pref.QuietHours.Enabled {
		return nil, nil
	}
	now := time.Now()
	active, err := QuietHoursActiveAt(pref.QuietHours, now)
	if err != nil || !active {
		return nil, err
	}
	end, err := QuietHoursEndsAt(pref.QuietHours, now)
	if err != nil {
		return nil, err
	}
	return &end, nil
}

// QuietHoursEndsAt returns the next instant at/after `at` on which the
// quiet-hours window ends, evaluated in the window's timezone. It handles both
// same-day (start < end) and overnight (start > end) windows.
func QuietHoursEndsAt(qh *model.QuietHours, at time.Time) (time.Time, error) {
	if qh == nil {
		return time.Time{}, fmt.Errorf("nil quiet hours")
	}
	loc, err := time.LoadLocation(qh.Timezone)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid timezone %q: %w", qh.Timezone, err)
	}
	end, err := parseHHMM(qh.EndTime)
	if err != nil {
		return time.Time{}, err
	}
	cur := at.In(loc)
	endToday := time.Date(cur.Year(), cur.Month(), cur.Day(), end/60, end%60, 0, 0, loc)
	if endToday.After(cur) {
		return endToday, nil
	}
	return endToday.Add(24 * time.Hour), nil
}

// ShouldDeferForQuietHours applies the quiet-hours rule for non-critical notifications.
func ShouldDeferForQuietHours(pref *model.NotificationPreference, priority string, at time.Time) (bool, error) {
	if pref == nil || priority == model.PriorityCritical {
		return false, nil
	}
	return QuietHoursActiveAt(pref.QuietHours, at)
}

// QuietHoursActiveAt checks if a timestamp falls within a quiet-hours window.
func QuietHoursActiveAt(qh *model.QuietHours, at time.Time) (bool, error) {
	if qh == nil || !qh.Enabled {
		return false, nil
	}

	loc, err := time.LoadLocation(qh.Timezone)
	if err != nil {
		return false, fmt.Errorf("invalid timezone %q: %w", qh.Timezone, err)
	}

	current := at.In(loc)
	currentMinutes := current.Hour()*60 + current.Minute()

	start, err := parseHHMM(qh.StartTime)
	if err != nil {
		return false, err
	}
	end, err := parseHHMM(qh.EndTime)
	if err != nil {
		return false, err
	}

	if start == end {
		return true, nil
	}
	if start < end {
		return currentMinutes >= start && currentMinutes < end, nil
	}
	// Overnight (e.g., 22:00 to 07:00).
	return currentMinutes >= start || currentMinutes < end, nil
}

func parseHHMM(s string) (int, error) {
	if len(s) != len("15:04") || s[2] != ':' {
		return 0, fmt.Errorf("invalid time format %q: expected HH:MM", s)
	}

	var h, m int
	_, err := fmt.Sscanf(s, "%d:%d", &h, &m)
	if err != nil {
		return 0, fmt.Errorf("invalid time format %q: %w", s, err)
	}
	if h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, fmt.Errorf("invalid time format %q: hour must be 00-23 and minute must be 00-59", s)
	}
	return h*60 + m, nil
}
