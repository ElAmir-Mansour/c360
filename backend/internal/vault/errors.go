package vault

import "errors"

// Sentinel errors. All errors returned from the Client implementation wrap
// one of these via fmt.Errorf("...: %w", ErrXxx) so callers can use
// errors.Is to discriminate.
var (
	// ErrVaultSealed is returned when Vault reports sealed=true. The caller
	// should treat this as transient at the platform layer (an operator must
	// unseal) — this package itself never retries on sealed.
	ErrVaultSealed = errors.New("vault: sealed")

	// ErrStandby is returned when the targeted Vault node is a standby
	// replica that does not forward requests. Health checks surface this
	// distinctly from sealed.
	ErrStandby = errors.New("vault: standby node")

	// ErrAuthFailed is returned when token or AppRole authentication did not
	// yield a usable Vault token. Includes the case where the AppRole login
	// response has an empty client_token.
	ErrAuthFailed = errors.New("vault: authentication failed")

	// ErrKeyNotFound is returned when a Transit key lookup returns 404 in a
	// context that did not expect a missing key.
	ErrKeyNotFound = errors.New("vault: transit key not found")

	// ErrTransitDenied is returned for Transit calls that fail with a
	// non-503, non-404 status (typically 400/403). The wrapper attaches the
	// underlying status code and Vault error message.
	ErrTransitDenied = errors.New("vault: transit operation denied")

	// ErrEnvelopeInvalid is returned when a ciphertext envelope passed to
	// Decrypt is not in Vault's expected vault:vN:<base64> form.
	ErrEnvelopeInvalid = errors.New("vault: envelope invalid")
)
