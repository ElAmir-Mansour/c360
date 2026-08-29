package dto

// ---------- Requests ----------

// MagicLinkRequestReq is the body for POST /api/v1/auth/magic-link/request.
type MagicLinkRequestReq struct {
	Email string `json:"email" validate:"required,email"`
}

// MagicLinkVerifyReq is the body for POST /api/v1/auth/magic-link/verify.
type MagicLinkVerifyReq struct {
	Token string `json:"token" validate:"required"`
}

// ---------- Responses ----------

// MagicLinkRequestResponse is returned by the request endpoint. It is always
// {sent: true} and intentionally non-disclosing: it does not reveal whether the
// email maps to a real account.
type MagicLinkRequestResponse struct {
	Sent bool `json:"sent"`
}

// MagicLinkMFAResponse is returned by verify when the resolved user has MFA
// enabled. Per Decision D3 the field name is `requires_mfa` (distinct from the
// password-login `mfa_required` shape) to match the magic-link BFF contract.
type MagicLinkMFAResponse struct {
	RequiresMFA bool   `json:"requires_mfa"`
	MFAToken    string `json:"mfa_token"`
}
