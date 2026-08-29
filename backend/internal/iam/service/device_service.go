package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
)

// DeviceService manages trusted-device registration and listing for the
// authenticated user. Device trust is best-effort correlation metadata; it does
// not by itself gate authentication.
type DeviceService struct {
	deviceRepo repository.TrustedDeviceRepository
	logger     zerolog.Logger
}

func NewDeviceService(
	deviceRepo repository.TrustedDeviceRepository,
	logger zerolog.Logger,
) *DeviceService {
	return &DeviceService{
		deviceRepo: deviceRepo,
		logger:     logger,
	}
}

// RegisterDeviceInput carries the resolved registration parameters. The handler
// is responsible for resolving the effective device fingerprint (body field or
// X-Device-Id header) and the request IP before calling Register.
type RegisterDeviceInput struct {
	DeviceID  string
	Trusted   bool
	UserAgent *string
	IPAddress *string
}

// Register upserts a trusted-device record for the given tenant/user.
func (s *DeviceService) Register(ctx context.Context, tenantID, userID string, in RegisterDeviceInput) (*dto.DeviceRegisterResponse, error) {
	fingerprint := strings.TrimSpace(in.DeviceID)
	if fingerprint == "" {
		return nil, fmt.Errorf("device_id is required: %w", model.ErrValidation)
	}

	device := &model.TrustedDevice{
		TenantID:          tenantID,
		UserID:            userID,
		DeviceFingerprint: fingerprint,
		DeviceName:        deriveDeviceName(in.UserAgent),
		DeviceType:        deriveDeviceType(in.UserAgent),
		IPAddress:         in.IPAddress,
		UserAgent:         in.UserAgent,
		Trusted:           in.Trusted,
	}

	if err := s.deviceRepo.Upsert(ctx, device); err != nil {
		return nil, fmt.Errorf("registering device: %w", err)
	}

	device.DeviceFingerprint = fingerprint
	return &dto.DeviceRegisterResponse{
		Registered: true,
		Device:     toDeviceResponse(device),
	}, nil
}

// List returns all non-revoked devices for the given tenant/user.
func (s *DeviceService) List(ctx context.Context, tenantID, userID string) (*dto.DeviceListResponse, error) {
	devices, err := s.deviceRepo.ListByUser(ctx, tenantID, userID)
	if err != nil {
		return nil, fmt.Errorf("listing devices: %w", err)
	}

	out := make([]dto.DeviceResponse, 0, len(devices))
	for i := range devices {
		out = append(out, toDeviceResponse(&devices[i]))
	}
	return &dto.DeviceListResponse{Devices: out}, nil
}

func toDeviceResponse(d *model.TrustedDevice) dto.DeviceResponse {
	return dto.DeviceResponse{
		ID:            d.ID,
		DeviceID:      d.DeviceFingerprint,
		DeviceName:    d.DeviceName,
		DeviceType:    d.DeviceType,
		Trusted:       d.Trusted,
		IPAddress:     d.IPAddress,
		UserAgent:     d.UserAgent,
		LastTrustedAt: d.LastTrustedAt,
		CreatedAt:     d.CreatedAt,
	}
}

// deriveDeviceType infers a coarse device category from the user agent. Defaults
// to "web" when the agent is empty or unrecognised.
func deriveDeviceType(ua *string) string {
	if ua == nil {
		return "web"
	}
	lower := strings.ToLower(*ua)
	switch {
	case lower == "":
		return "web"
	case strings.Contains(lower, "mobile"),
		strings.Contains(lower, "android"),
		strings.Contains(lower, "iphone"),
		strings.Contains(lower, "ipad"):
		return "mobile"
	default:
		return "web"
	}
}

// deriveDeviceName produces a human-friendly label from the user agent.
func deriveDeviceName(ua *string) string {
	if ua == nil || strings.TrimSpace(*ua) == "" {
		return "Unknown Device"
	}
	lower := strings.ToLower(*ua)
	switch {
	case strings.Contains(lower, "iphone"):
		return "iPhone"
	case strings.Contains(lower, "ipad"):
		return "iPad"
	case strings.Contains(lower, "android"):
		return "Android Device"
	case strings.Contains(lower, "windows"):
		return "Windows Device"
	case strings.Contains(lower, "mac os"), strings.Contains(lower, "macintosh"):
		return "Mac"
	case strings.Contains(lower, "linux"):
		return "Linux Device"
	default:
		return "Web Browser"
	}
}
