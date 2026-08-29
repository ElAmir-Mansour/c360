package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/agent"
)

var errNoRenewalToken = errors.New("no renewal token available")

type renewalEnrollClient interface {
	Enroll(ctx context.Context, cfg agent.EnrollConfig) (*agent.Identity, error)
}

func startIdentityRenewal(ctx context.Context, cfg *agentConfig, store *agent.IdentityStore, provider *agent.MutableIdentityProvider, logger zerolog.Logger) {
	go func() {
		renewalLoop(ctx, cfg, store, provider, agent.NewEnrollClient(), logger)
	}()
}

func renewalLoop(ctx context.Context, cfg *agentConfig, store *agent.IdentityStore, provider *agent.MutableIdentityProvider, client renewalEnrollClient, logger zerolog.Logger) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		identity, err := provider.Identity()
		if err != nil {
			logger.Error().Err(err).Msg("certificate renewal stopped: identity unavailable")
			return
		}
		delay := nextRenewalDelay(time.Now().UTC(), identity.NotAfter, cfg.CertRenewBefore, cfg.CertRenewCheckInterval)
		if delay > 0 {
			timer.Reset(delay)
			continue
		}

		renewed, err := renewIdentityOnce(ctx, cfg, store, provider, client)
		if err != nil {
			if errors.Is(err, errNoRenewalToken) {
				logger.Warn().
					Time("cert_expires_at", identity.NotAfter).
					Dur("retry_backoff", cfg.CertRenewRetryBackoff).
					Msg("certificate renewal needed but no fresh rotation token is available")
			} else {
				logger.Error().
					Err(err).
					Time("cert_expires_at", identity.NotAfter).
					Dur("retry_backoff", cfg.CertRenewRetryBackoff).
					Msg("certificate renewal failed")
			}
			timer.Reset(cfg.CertRenewRetryBackoff)
			continue
		}
		if renewed {
			next, _ := provider.Identity()
			logger.Info().
				Str("serial", next.Serial).
				Time("not_after", next.NotAfter).
				Msg("certificate renewed and published for future mTLS handshakes")
		}
		timer.Reset(cfg.CertRenewCheckInterval)
	}
}

func renewIdentityOnce(ctx context.Context, cfg *agentConfig, store *agent.IdentityStore, provider *agent.MutableIdentityProvider, client renewalEnrollClient) (bool, error) {
	if cfg == nil || store == nil || provider == nil || client == nil {
		return false, errors.New("certificate renewal is not configured")
	}
	identity, err := provider.Identity()
	if err != nil {
		return false, err
	}
	if !needsRenewal(time.Now().UTC(), identity.NotAfter, cfg.CertRenewBefore) {
		return false, nil
	}
	if strings.TrimSpace(cfg.ControlPlaneURL) == "" {
		return false, errors.New("control_plane_url is required for certificate renewal")
	}
	token, err := cfg.renewalToken()
	if err != nil {
		return false, err
	}
	caBundle, err := cfg.resolveCABundle()
	if err != nil {
		return false, err
	}
	next, err := client.Enroll(ctx, agent.EnrollConfig{
		ControlPlaneURL: cfg.ControlPlaneURL,
		Token:           token,
		AgentID:         cfg.AgentID,
		TenantID:        cfg.TenantID,
		SiteID:          cfg.SiteID,
		CABundlePEM:     caBundle,
	})
	if err != nil {
		return false, fmt.Errorf("certificate renewal exchange failed: %w", err)
	}
	if err := store.Save(next); err != nil {
		return false, fmt.Errorf("persist renewed certificate: %w", err)
	}
	if err := provider.Update(next); err != nil {
		return false, err
	}
	return true, nil
}

func (c *agentConfig) renewalToken() (string, error) {
	if c == nil {
		return "", errNoRenewalToken
	}
	if path := strings.TrimSpace(c.RenewalTokenFile); path != "" {
		raw, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read renewal token file: %w", err)
		}
		token := strings.TrimSpace(string(raw))
		if token == "" {
			return "", errNoRenewalToken
		}
		return token, nil
	}
	token := strings.TrimSpace(c.EnrollmentToken)
	if token == "" {
		return "", errNoRenewalToken
	}
	return token, nil
}

func needsRenewal(now, notAfter time.Time, before time.Duration) bool {
	if notAfter.IsZero() {
		return false
	}
	return !now.Before(notAfter.Add(-before))
}

func nextRenewalDelay(now, notAfter time.Time, before, checkInterval time.Duration) time.Duration {
	if checkInterval <= 0 {
		checkInterval = time.Hour
	}
	if needsRenewal(now, notAfter, before) {
		return 0
	}
	if notAfter.IsZero() {
		return checkInterval
	}
	delay := notAfter.Add(-before).Sub(now)
	if delay <= 0 {
		return 0
	}
	if delay > checkInterval {
		return checkInterval
	}
	return delay
}
