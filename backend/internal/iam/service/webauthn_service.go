package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
)

const (
	// webauthnChallengePrefix namespaces the Redis keys holding the in-flight
	// ceremony SessionData, keyed by the ceremony challenge (Decision D5).
	webauthnChallengePrefix = "webauthn:challenge:"
	// webauthnChallengeTTL bounds how long a challenge may be redeemed,
	// mirroring the mfa:pending TTL in auth_service.go.
	webauthnChallengeTTL = 5 * time.Minute
)

// WebAuthnService implements the assertion (login) ceremony for passkeys /
// FIDO2 credentials. Registration of new credentials is out of scope here; this
// service only verifies assertions for already-enrolled credentials and, on
// success, issues a platform session by delegating to AuthService.
type WebAuthnService struct {
	wa       *webauthn.WebAuthn
	credRepo repository.WebAuthnRepository
	userRepo repository.UserRepository
	authSvc  *AuthService
	redis    *redis.Client
	logger   zerolog.Logger
}

// NewWebAuthnService constructs the service. The relying-party parameters
// (rpID, rpDisplayName, rpOrigins) come from config.WebAuthnConfig (Decision
// D6); an error is returned if they are invalid.
func NewWebAuthnService(
	rpID, rpDisplayName string,
	rpOrigins []string,
	credRepo repository.WebAuthnRepository,
	userRepo repository.UserRepository,
	authSvc *AuthService,
	rdb *redis.Client,
	logger zerolog.Logger,
) (*WebAuthnService, error) {
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: rpDisplayName,
		RPOrigins:     rpOrigins,
	})
	if err != nil {
		return nil, fmt.Errorf("configuring webauthn: %w", err)
	}
	return &WebAuthnService{
		wa:       wa,
		credRepo: credRepo,
		userRepo: userRepo,
		authSvc:  authSvc,
		redis:    rdb,
		logger:   logger,
	}, nil
}

// webAuthnUser adapts a platform user + its stored credentials to the
// go-webauthn User interface. WebAuthnID maps to the user's UUID bytes so the
// authenticator-returned userHandle resolves back to the account.
type webAuthnUser struct {
	id          []byte
	name        string
	displayName string
	credentials []webauthn.Credential
}

func (u *webAuthnUser) WebAuthnID() []byte                         { return u.id }
func (u *webAuthnUser) WebAuthnName() string                       { return u.name }
func (u *webAuthnUser) WebAuthnDisplayName() string                { return u.displayName }
func (u *webAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

// BeginLogin starts an assertion ceremony and returns the
// PublicKeyCredentialRequestOptions for the browser. When email is empty a
// usernameless / discoverable (resident-key) ceremony is started.
//
// The returned value is protocol.PublicKeyCredentialRequestOptions, which
// serializes to exactly the shape the BFF expects (challenge, timeout, rpId,
// userVerification, allowCredentials).
func (s *WebAuthnService) BeginLogin(ctx context.Context, email string) (*protocol.PublicKeyCredentialRequestOptions, error) {
	email = strings.ToLower(strings.TrimSpace(email))

	var (
		assertion *protocol.CredentialAssertion
		session   *webauthn.SessionData
		err       error
	)

	if email == "" {
		// Usernameless: rely on a client-side discoverable (resident) credential.
		assertion, session, err = s.wa.BeginDiscoverableLogin()
		if err != nil {
			return nil, fmt.Errorf("beginning discoverable login: %w", err)
		}
	} else {
		user, lookupErr := s.userRepo.GetByEmailGlobal(ctx, email)
		if lookupErr != nil {
			// Non-disclosing: fall back to a discoverable ceremony so the
			// response does not reveal whether the account exists.
			assertion, session, err = s.wa.BeginDiscoverableLogin()
			if err != nil {
				return nil, fmt.Errorf("beginning discoverable login: %w", err)
			}
		} else {
			waUser, buildErr := s.buildWebAuthnUser(ctx, user)
			if buildErr != nil {
				return nil, buildErr
			}
			if len(waUser.credentials) == 0 {
				// No enrolled passkeys: degrade to discoverable, still non-disclosing.
				assertion, session, err = s.wa.BeginDiscoverableLogin()
			} else {
				assertion, session, err = s.wa.BeginLogin(waUser)
			}
			if err != nil {
				return nil, fmt.Errorf("beginning login: %w", err)
			}
		}
	}

	if err := s.storeSession(ctx, session); err != nil {
		return nil, err
	}

	return &assertion.Response, nil
}

// FinishLogin verifies a serialized assertion. On success it returns either a
// full AuthResponse or, when the account has MFA enabled, an
// MFARequiredResponse (delegated to AuthService so the existing
// /auth/verify-mfa flow can complete the step-up).
func (s *WebAuthnService) FinishLogin(ctx context.Context, rawAssertion []byte, ip, userAgent string) (any, error) {
	parsed, err := protocol.ParseCredentialRequestResponseBytes(rawAssertion)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", "malformed assertion", model.ErrValidation)
	}

	challenge := parsed.Response.CollectedClientData.Challenge
	session, err := s.consumeSession(ctx, challenge)
	if err != nil {
		return nil, err
	}

	var user *model.User

	if len(session.UserID) == 0 {
		// Discoverable / usernameless flow: resolve the user from the
		// credential returned by the authenticator.
		handler := func(rawID, userHandle []byte) (webauthn.User, error) {
			u, lookupErr := s.resolveDiscoverableUser(ctx, rawID, userHandle)
			if lookupErr != nil {
				return nil, lookupErr
			}
			user = u.platformUser
			return u.webAuthnUser, nil
		}
		if _, err = s.wa.ValidateDiscoverableLogin(handler, *session, parsed); err != nil {
			return nil, fmt.Errorf("%s: %w", "assertion verification failed", model.ErrUnauthorized)
		}
	} else {
		// Identified flow: the session pins a specific user.
		userID, parseErr := uuidFromBytes(session.UserID)
		if parseErr != nil {
			return nil, model.ErrUnauthorized
		}
		platformUser, lookupErr := s.userRepo.GetByID(ctx, userID)
		if lookupErr != nil {
			return nil, model.ErrUnauthorized
		}
		waUser, buildErr := s.buildWebAuthnUser(ctx, platformUser)
		if buildErr != nil {
			return nil, buildErr
		}
		credential, validateErr := s.wa.ValidateLogin(waUser, *session, parsed)
		if validateErr != nil {
			return nil, fmt.Errorf("%s: %w", "assertion verification failed", model.ErrUnauthorized)
		}
		user = platformUser
		s.persistCounter(ctx, credential)
	}

	if user == nil {
		return nil, model.ErrUnauthorized
	}

	if !canAuthenticateStatus(user.Status) {
		return nil, fmt.Errorf("account is %s: %w", user.Status, model.ErrForbidden)
	}

	// Step-up: if the account also requires MFA, hand off to the existing
	// MFA-pending mechanism (same Redis key + TTL as AuthService.Login) rather
	// than issuing a session directly. The BFF/client then completes the flow
	// via the existing POST /auth/verify-mfa endpoint.
	if user.MFAEnabled {
		return s.beginMFAChallenge(ctx, user, ip, userAgent)
	}

	return s.authSvc.IssueTokens(ctx, user, ip, userAgent)
}

// beginMFAChallenge mirrors AuthService.Login's MFA-pending write: it stores a
// short-lived pending token in Redis (mfa:pending:{token}) encoding the user,
// tenant, ip and user-agent, then returns the MFARequiredResponse so the client
// can complete step-up via the existing POST /auth/verify-mfa endpoint. The
// Redis key/format/TTL are shared package constants from auth_service.go.
func (s *WebAuthnService) beginMFAChallenge(ctx context.Context, user *model.User, ip, userAgent string) (*dto.MFARequiredResponse, error) {
	token, err := generateRandomHex(32)
	if err != nil {
		return nil, fmt.Errorf("generating mfa token: %w", err)
	}
	key := mfaPendingPrefix + token
	value := fmt.Sprintf("%s|%s|%s|%s", user.ID, user.TenantID, ip, userAgent)
	if err := s.redis.Set(ctx, key, value, mfaPendingTTL).Err(); err != nil {
		return nil, fmt.Errorf("storing mfa challenge: %w", err)
	}
	return &dto.MFARequiredResponse{
		MFARequired: true,
		MFAToken:    token,
	}, nil
}

// resolvedUser bundles the platform user with its go-webauthn adapter.
type resolvedUser struct {
	platformUser *model.User
	webAuthnUser *webAuthnUser
}

// resolveDiscoverableUser maps an authenticator-returned credential to a user.
// rawID is the credential id; userHandle is the user.id stored at registration.
func (s *WebAuthnService) resolveDiscoverableUser(ctx context.Context, rawID, userHandle []byte) (*resolvedUser, error) {
	credID := base64.RawURLEncoding.EncodeToString(rawID)
	cred, err := s.credRepo.GetCredentialByCredentialID(ctx, credID)
	if err != nil {
		return nil, fmt.Errorf("credential not found: %w", err)
	}

	user, err := s.userRepo.GetByID(ctx, cred.UserID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	// Defense in depth: the userHandle, when present, must match the user.
	if len(userHandle) > 0 {
		want, parseErr := uuidFromBytes(userHandle)
		if parseErr != nil || want != user.ID {
			return nil, fmt.Errorf("user handle mismatch")
		}
	}

	waUser, err := s.buildWebAuthnUser(ctx, user)
	if err != nil {
		return nil, err
	}
	return &resolvedUser{platformUser: user, webAuthnUser: waUser}, nil
}

// buildWebAuthnUser loads a user's stored credentials and assembles the
// go-webauthn User adapter.
func (s *WebAuthnService) buildWebAuthnUser(ctx context.Context, user *model.User) (*webAuthnUser, error) {
	creds, err := s.credRepo.ListCredentialsByUser(ctx, user.ID)
	if err != nil {
		return nil, fmt.Errorf("loading credentials: %w", err)
	}

	idBytes, err := uuidToBytes(user.ID)
	if err != nil {
		return nil, fmt.Errorf("invalid user id: %w", err)
	}

	waCreds := make([]webauthn.Credential, 0, len(creds))
	for i := range creds {
		c, convErr := toWebAuthnCredential(&creds[i])
		if convErr != nil {
			s.logger.Warn().Err(convErr).Str("credential_id", creds[i].ID).Msg("skipping unparseable webauthn credential")
			continue
		}
		waCreds = append(waCreds, *c)
	}

	return &webAuthnUser{
		id:          idBytes,
		name:        user.Email,
		displayName: user.FullName(),
		credentials: waCreds,
	}, nil
}

// persistCounter writes the updated signature counter back to storage after a
// successful assertion (clone-detection / replay hardening).
func (s *WebAuthnService) persistCounter(ctx context.Context, credential *webauthn.Credential) {
	if credential == nil {
		return
	}
	credID := base64.RawURLEncoding.EncodeToString(credential.ID)
	stored, err := s.credRepo.GetCredentialByCredentialID(ctx, credID)
	if err != nil {
		return
	}
	if updateErr := s.credRepo.UpdateCounter(ctx, stored.ID, int64(credential.Authenticator.SignCount)); updateErr != nil {
		s.logger.Warn().Err(updateErr).Str("credential_id", stored.ID).Msg("failed to update webauthn counter")
	}
}

// storeSession persists ceremony SessionData in Redis keyed by the challenge.
func (s *WebAuthnService) storeSession(ctx context.Context, session *webauthn.SessionData) error {
	data, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("serializing webauthn session: %w", err)
	}
	key := webauthnChallengePrefix + session.Challenge
	if err := s.redis.Set(ctx, key, data, webauthnChallengeTTL).Err(); err != nil {
		return fmt.Errorf("storing webauthn challenge: %w", err)
	}
	return nil
}

// consumeSession atomically fetches and deletes the ceremony SessionData,
// enforcing single-use challenges.
func (s *WebAuthnService) consumeSession(ctx context.Context, challenge string) (*webauthn.SessionData, error) {
	key := webauthnChallengePrefix + challenge
	data, err := s.redis.GetDel(ctx, key).Result()
	if err != nil {
		return nil, model.ErrInvalidToken
	}
	var session webauthn.SessionData
	if err := json.Unmarshal([]byte(data), &session); err != nil {
		return nil, model.ErrInvalidToken
	}
	return &session, nil
}

// toWebAuthnCredential converts a stored credential row to the library type.
func toWebAuthnCredential(c *repository.WebAuthnCredential) (*webauthn.Credential, error) {
	id, err := base64.RawURLEncoding.DecodeString(c.CredentialID)
	if err != nil {
		return nil, fmt.Errorf("decoding credential id: %w", err)
	}
	pub, err := base64.StdEncoding.DecodeString(c.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("decoding public key: %w", err)
	}

	transports := make([]protocol.AuthenticatorTransport, 0, len(c.Transports))
	for _, t := range c.Transports {
		transports = append(transports, protocol.AuthenticatorTransport(t))
	}

	cred := &webauthn.Credential{
		ID:        id,
		PublicKey: pub,
		Transport: transports,
	}
	if c.Counter >= 0 {
		cred.Authenticator.SignCount = uint32(c.Counter)
	}
	if c.AAGUID != nil {
		if aaguid, parseErr := uuid.Parse(*c.AAGUID); parseErr == nil {
			cred.Authenticator.AAGUID = aaguid[:]
		}
	}
	return cred, nil
}

// uuidToBytes returns the 16-byte big-endian form of a UUID string, used as the
// stable WebAuthn user handle.
func uuidToBytes(id string) ([]byte, error) {
	u, err := uuid.Parse(id)
	if err != nil {
		return nil, err
	}
	b := u
	return b[:], nil
}

// uuidFromBytes reverses uuidToBytes, returning the canonical UUID string.
func uuidFromBytes(b []byte) (string, error) {
	if len(b) != 16 {
		return "", errors.New("user handle is not a 16-byte uuid")
	}
	u, err := uuid.FromBytes(b)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
