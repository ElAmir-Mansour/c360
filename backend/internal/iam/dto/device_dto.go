package dto

import "time"

// DeviceRegisterRequest is the body for POST /api/v1/auth/devices.
// device_id is optional in the body because the BFF also forwards it via the
// X-Device-Id header; the handler resolves the effective fingerprint from
// either source.
type DeviceRegisterRequest struct {
	DeviceID  string  `json:"device_id"`
	Trusted   *bool   `json:"trusted"`
	UserAgent *string `json:"user_agent"`
}

// DeviceResponse is a single trusted-device record returned to the client.
type DeviceResponse struct {
	ID            string    `json:"id"`
	DeviceID      string    `json:"device_id"`
	DeviceName    string    `json:"device_name"`
	DeviceType    string    `json:"device_type"`
	Trusted       bool      `json:"trusted"`
	IPAddress     *string   `json:"ip_address,omitempty"`
	UserAgent     *string   `json:"user_agent,omitempty"`
	LastTrustedAt time.Time `json:"last_trusted_at"`
	CreatedAt     time.Time `json:"created_at"`
}

// DeviceRegisterResponse is the success shape for POST /api/v1/auth/devices.
type DeviceRegisterResponse struct {
	Registered bool           `json:"registered"`
	Device     DeviceResponse `json:"device"`
}

// DeviceListResponse is the success shape for GET /api/v1/auth/devices.
type DeviceListResponse struct {
	Devices []DeviceResponse `json:"devices"`
}
