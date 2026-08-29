package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
	onboardingsvc "github.com/clario360/platform/internal/onboarding/service"
)

const (
	// magicLinkTTL is the single-use lifetime of a passwordless sign-in token.
	magicLinkTTL = 15 * time.Minute
	// magicLinkPath is the frontend route that receives the token and POSTs it
	// to /api/v1/auth/magic-link/verify.
	magicLinkPath = "/auth/magic-link/verify"
)

// MagicLinkService implements passwordless email sign-in.
//
// Request is intentionally non-disclosing: it always returns nil so callers
// cannot probe which addresses correspond to real accounts. Verify consumes the
// single-use token, and — when the resolved user has MFA enabled — hands back an
// MFA-pending token that is fully interchangeable with the password-login flow
// (it writes the same Redis key the AuthService.VerifyMFA endpoint reads, so the
// existing POST /api/v1/auth/verify-mfa endpoint completes the login).
type MagicLinkService struct {
	userRepo      repository.UserRepository
	magicLinkRepo repository.MagicLinkRepository
	authSvc       *AuthService
	redis         *redis.Client
	emailSender   onboardingsvc.EmailSender
	appURL        string
	logger        zerolog.Logger
}

func NewMagicLinkService(
	userRepo repository.UserRepository,
	magicLinkRepo repository.MagicLinkRepository,
	authSvc *AuthService,
	rdb *redis.Client,
	emailSender onboardingsvc.EmailSender,
	appURL string,
	logger zerolog.Logger,
) *MagicLinkService {
	return &MagicLinkService{
		userRepo:      userRepo,
		magicLinkRepo: magicLinkRepo,
		authSvc:       authSvc,
		redis:         rdb,
		emailSender:   emailSender,
		appURL:        strings.TrimRight(appURL, "/"),
		logger:        logger.With().Str("component", "magic_link_service").Logger(),
	}
}

// Request issues a single-use magic-link token for the given email and emails
// it to the user. It ALWAYS returns nil error (non-disclosing): unknown emails,
// inactive accounts, and email-delivery failures are logged but never surfaced
// to the caller, so the endpoint reveals nothing about account existence.
func (s *MagicLinkService) Request(ctx context.Context, email string) error {
	normalizedEmail := strings.ToLower(strings.TrimSpace(email))

	user, err := s.userRepo.GetByEmailGlobal(ctx, normalizedEmail)
	if err != nil {
		// Unknown email — silently succeed to prevent enumeration.
		s.logger.Debug().Str("email", normalizedEmail).Msg("magic-link requested for unknown email")
		return nil
	}

	if !canAuthenticateStatus(user.Status) {
		// Don't reveal account state; just decline to send.
		s.logger.Debug().Str("user_id", user.ID).Str("status", string(user.Status)).
			Msg("magic-link requested for blocked account")
		return nil
	}

	token, err := generateRandomHex(32)
	if err != nil {
		// Internal failure — log but stay non-disclosing.
		s.logger.Error().Err(err).Msg("failed to generate magic-link token")
		return nil
	}

	expiresAt := time.Now().Add(magicLinkTTL)
	link := &model.MagicLink{
		TenantID:  user.TenantID,
		Email:     user.Email,
		TokenHash: sha256Hex(token),
		ExpiresAt: expiresAt,
	}
	if err := s.magicLinkRepo.Create(ctx, link); err != nil {
		s.logger.Error().Err(err).Str("user_id", user.ID).Msg("failed to persist magic-link token")
		return nil
	}

	linkURL := fmt.Sprintf("%s%s?token=%s", s.appURL, magicLinkPath, token)
	if err := s.emailSender.SendMagicLinkEmail(ctx, user.Email, linkURL, expiresAt); err != nil {
		s.logger.Error().Err(err).Str("user_id", user.ID).Msg("failed to send magic-link email")
		return nil
	}

	s.logger.Info().Str("user_id", user.ID).Msg("magic-link issued")
	return nil
}

// Verify consumes a single-use magic-link token and completes sign-in.
//   - Invalid / used / expired tokens → model.ErrInvalidToken.
//   - MFA-enabled users → *dto.MagicLinkMFAResponse with an mfa_token that the
//     existing /api/v1/auth/verify-mfa endpoint can redeem.
//   - Otherwise → a full *dto.AuthResponse via the shared token issuer.
func (s *MagicLinkService) Verify(ctx context.Context, token, ip, userAgent string) (any, error) {
	link, err := s.magicLinkRepo.ConsumeByTokenHash(ctx, sha256Hex(token))
	if err != nil {
		return nil, err
	}

	user, err := s.userRepo.GetByEmailGlobal(ctx, strings.ToLower(strings.TrimSpace(link.Email)))
	if err != nil {
		return nil, model.ErrInvalidToken
	}

	if !canAuthenticateStatus(user.Status) {
		return nil, fmt.Errorf("account is %s: %w", user.Status, model.ErrForbidden)
	}

	// MFA gate: mirror the password-login mechanism so the existing verify-mfa
	// endpoint can finish the login. The Redis key, value layout, and TTL match
	// AuthService exactly (mfa:pending:<token> => userID|tenantID|ip|userAgent).
	if user.MFAEnabled {
		mfaToken, err := generateRandomHex(32)
		if err != nil {
			return nil, fmt.Errorf("generating mfa token: %w", err)
		}
		mfaKey := mfaPendingPrefix + mfaToken
		s.redis.Set(ctx, mfaKey,
			fmt.Sprintf("%s|%s|%s|%s", user.ID, user.TenantID, ip, userAgent),
			mfaPendingTTL,
		)
		return &dto.MagicLinkMFAResponse{
			RequiresMFA: true,
			MFAToken:    mfaToken,
		}, nil
	}

	return s.authSvc.IssueTokens(ctx, user, ip, userAgent)
}
