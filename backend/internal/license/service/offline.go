package service

import (
	"context"
	"crypto/rsa"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	pgxv5 "github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/license/model"
)

// Offline license files (Solution Architecture E2E, slides 18 and 45): a
// signed, time-boxed JWS issued on the connected build side and activated
// inside the customer estate with zero call-home. Activation imports the
// embedded plan snapshot, so an air-gapped deployment enforces exactly the
// entitlements that were signed — nothing is fetched, nothing is trusted
// beyond the signature.

const offlineIssuer = "clario360-licensing"

// OfflineClaims is the signed content of a license file.
type OfflineClaims struct {
	jwt.RegisteredClaims
	LicenseID    string              `json:"lid"`
	TenantID     string              `json:"tenant_id"`
	PlanKey      string              `json:"plan_key"`
	PlanName     string              `json:"plan_name"`
	Seats        int64               `json:"seats"`
	GraceDays    int                 `json:"grace_days"`
	Entitlements []model.Entitlement `json:"entitlements"`
}

// OfflineSigner issues license files with the vendor's private key.
type OfflineSigner struct {
	key *rsa.PrivateKey
	now func() time.Time
}

// NewOfflineSigner parses a PEM-encoded RSA private key.
func NewOfflineSigner(privateKeyPEM []byte) (*OfflineSigner, error) {
	key, err := jwt.ParseRSAPrivateKeyFromPEM(privateKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("parsing license signing private key: %w", err)
	}
	return &OfflineSigner{key: key, now: func() time.Time { return time.Now().UTC() }}, nil
}

// Sign produces the compact JWS license file content.
func (s *OfflineSigner) Sign(claims *OfflineClaims) (string, error) {
	now := s.now()
	claims.Issuer = offlineIssuer
	claims.IssuedAt = jwt.NewNumericDate(now)
	if claims.NotBefore == nil {
		claims.NotBefore = jwt.NewNumericDate(now)
	}
	if claims.ExpiresAt == nil {
		return "", fmt.Errorf("offline license requires an expiry")
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodRS256, claims).SignedString(s.key)
	if err != nil {
		return "", fmt.Errorf("signing offline license: %w", err)
	}
	return signed, nil
}

// OfflineVerifier validates license files with the vendor's public key.
type OfflineVerifier struct {
	key *rsa.PublicKey
}

// NewOfflineVerifier parses a PEM-encoded RSA public key.
func NewOfflineVerifier(publicKeyPEM []byte) (*OfflineVerifier, error) {
	key, err := jwt.ParseRSAPublicKeyFromPEM(publicKeyPEM)
	if err != nil {
		return nil, fmt.Errorf("parsing license verification public key: %w", err)
	}
	return &OfflineVerifier{key: key}, nil
}

// Verify checks signature, algorithm, issuer and time window, returning the
// embedded claims.
func (v *OfflineVerifier) Verify(licenseFile string) (*OfflineClaims, error) {
	var claims OfflineClaims
	_, err := jwt.ParseWithClaims(licenseFile, &claims,
		func(t *jwt.Token) (any, error) { return v.key, nil },
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithIssuer(offlineIssuer),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, fmt.Errorf("invalid offline license: %w", err)
	}
	if claims.LicenseID == "" || claims.TenantID == "" || claims.PlanKey == "" {
		return nil, fmt.Errorf("invalid offline license: missing lid, tenant_id or plan_key")
	}
	return &claims, nil
}

// IssueOfflineLicense signs the tenant's current resolved license as a
// portable file. Requires a configured signer (vendor/build side only).
func (s *Service) IssueOfflineLicense(ctx context.Context, signer *OfflineSigner, tenantID string) (string, error) {
	if signer == nil {
		return "", fmt.Errorf("offline license signing is not configured on this deployment")
	}
	res, err := s.resolve(ctx, s.pool, tenantID)
	if err != nil {
		return "", err
	}
	if res.state == model.StateSuspended || res.state == model.StateExpired {
		return "", fmt.Errorf("cannot issue offline license for a %s license", res.state)
	}

	entitlements := make([]model.Entitlement, 0, len(res.entitlements))
	for _, e := range res.entitlements {
		entitlements = append(entitlements, e)
	}
	plan, err := s.repo.GetPlanByKey(ctx, s.pool, res.license.PlanKey)
	if err != nil {
		return "", err
	}

	return signer.Sign(&OfflineClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(res.license.ExpiresAt),
			NotBefore: jwt.NewNumericDate(res.license.StartsAt),
		},
		LicenseID:    events.GenerateUUID(),
		TenantID:     tenantID,
		PlanKey:      res.license.PlanKey,
		PlanName:     plan.Name,
		Seats:        res.license.Seats,
		GraceDays:    res.license.GraceDays,
		Entitlements: entitlements,
	})
}

// ActivateOfflineLicense verifies a license file and imports it: the embedded
// plan snapshot becomes an offline-source plan and the tenant's license points
// at it. Re-activating the same file is idempotent; activating a different
// file replaces the license (e.g. a renewal bundle).
func (s *Service) ActivateOfflineLicense(ctx context.Context, verifier *OfflineVerifier, licenseFile string) (*model.TenantLicense, error) {
	if verifier == nil {
		return nil, fmt.Errorf("offline license verification is not configured on this deployment")
	}
	claims, err := verifier.Verify(licenseFile)
	if err != nil {
		return nil, err
	}

	// Idempotency: the same file activated twice is a no-op success.
	if existing, err := s.repo.GetTenantLicense(ctx, s.pool, claims.TenantID); err == nil {
		if existing.OfflineLicenseID != nil && *existing.OfflineLicenseID == claims.LicenseID {
			return existing, nil
		}
	} else if !errors.Is(err, model.ErrNotFound) {
		return nil, err
	}

	var lic *model.TenantLicense
	err = database.RunInTx(ctx, s.pool, func(tx pgxv5.Tx) error {
		plan := &model.Plan{
			Key:         fmt.Sprintf("offline:%s", claims.LicenseID),
			Name:        claims.PlanName,
			Description: fmt.Sprintf("Imported from offline license %s (plan %s)", claims.LicenseID, claims.PlanKey),
			Source:      model.PlanSourceOffline,
		}
		if err := s.repo.CreatePlan(ctx, tx, plan); err != nil {
			return err
		}
		if err := s.repo.SetPlanEntitlements(ctx, tx, plan.ID, claims.Entitlements); err != nil {
			return err
		}

		licenseID := claims.LicenseID
		lic = &model.TenantLicense{
			TenantID:         claims.TenantID,
			PlanID:           plan.ID,
			PlanKey:          plan.Key,
			Status:           model.LicenseStatusActive,
			Seats:            claims.Seats,
			StartsAt:         claims.NotBefore.Time,
			ExpiresAt:        claims.ExpiresAt.Time,
			GraceDays:        claims.GraceDays,
			OfflineLicenseID: &licenseID,
		}
		if err := s.repo.UpsertTenantLicense(ctx, tx, lic); err != nil {
			return err
		}
		if err := s.stage(ctx, tx, "license.offline_activated", claims.TenantID, map[string]any{
			"license_id": claims.LicenseID,
			"plan_key":   claims.PlanKey,
			"expires_at": claims.ExpiresAt.Time,
		}); err != nil {
			return err
		}
		return s.stageEntitlementsChanged(ctx, tx, claims.TenantID, EntitlementsChangedEvent{
			Reason:        entitlementsChangeOfflineLicenseActivated,
			PlanKey:       plan.Key,
			InvalidateAll: true,
		})
	})
	if err != nil {
		return nil, err
	}

	s.logger.Info().
		Str("tenant_id", claims.TenantID).
		Str("license_id", claims.LicenseID).
		Time("expires_at", claims.ExpiresAt.Time).
		Msg("offline license activated")
	return lic, nil
}
