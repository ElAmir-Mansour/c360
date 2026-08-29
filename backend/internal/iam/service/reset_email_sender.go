package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/channel"
	notificationmodel "github.com/clario360/platform/internal/notification/model"
)

// PasswordResetEmailSender delivers password-reset links to users. Implemented
// by ChannelPasswordResetEmailSender in production; nil in tests or when no
// email channel is configured (ForgotPassword then relies on the dev-log
// fallback).
type PasswordResetEmailSender interface {
	SendPasswordResetEmail(ctx context.Context, email, link string, expiresAt time.Time) error
}

// ChannelPasswordResetEmailSender sends password-reset emails through the
// shared notification EmailChannel — the same channel the magic-link and
// onboarding flows use — so SMTP/SendGrid configuration is defined once.
type ChannelPasswordResetEmailSender struct {
	emailChannel *channel.EmailChannel
	logger       zerolog.Logger
}

// NewChannelPasswordResetEmailSender constructs a sender backed by the given
// notification email channel.
func NewChannelPasswordResetEmailSender(emailChannel *channel.EmailChannel, logger zerolog.Logger) *ChannelPasswordResetEmailSender {
	return &ChannelPasswordResetEmailSender{
		emailChannel: emailChannel,
		logger:       logger.With().Str("component", "password_reset_email_sender").Logger(),
	}
}

// SendPasswordResetEmail emails a single-use reset link. The body is bilingual
// (Arabic first — the platform default locale — then English) and the subject
// is WatheeqTech-branded.
func (s *ChannelPasswordResetEmailSender) SendPasswordResetEmail(ctx context.Context, email, link string, expiresAt time.Time) error {
	if s == nil || s.emailChannel == nil {
		return fmt.Errorf("email channel not configured")
	}

	expiry := expiresAt.UTC().Format("Jan 02, 2006 15:04 UTC")
	data, _ := json.Marshal(map[string]any{
		"email":      email,
		"action_url": link,
		"expires_at": expiresAt.UTC().Format(time.RFC3339),
	})
	body := fmt.Sprintf(
		"لإعادة تعيين كلمة المرور الخاصة بحسابك في وثيق تك، استخدم الرابط التالي: %s — تنتهي صلاحية الرابط في %s ويمكن استخدامه مرة واحدة فقط. إذا لم تطلب إعادة التعيين فتجاهل هذه الرسالة؛ حسابك آمن.\n\n"+
			"To reset your WatheeqTech account password, use this link: %s — the link expires on %s and can only be used once. If you did not request a password reset, you can safely ignore this email; your account remains secure.",
		link, expiry, link, expiry,
	)

	result := s.emailChannel.Send(ctx, &notificationmodel.Notification{
		ID:        uuid.NewString(),
		TenantID:  "",
		UserID:    uuid.NewString(),
		Type:      notificationmodel.NotificationType("generic"),
		Category:  notificationmodel.CategorySystem,
		Priority:  notificationmodel.PriorityHigh,
		Title:     "إعادة تعيين كلمة المرور — WatheeqTech | Reset your WatheeqTech password",
		Body:      body,
		Data:      data,
		ActionURL: link,
	})
	if !result.Success {
		return result.Error
	}
	return nil
}
