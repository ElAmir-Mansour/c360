package enroll

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/pki"
)

// SourcesReader is the subset of the sources repo needed by the
// enrollment service.
type SourcesReader interface {
	GetByID(ctx context.Context, tenantID, id uuid.UUID) (*sources.Source, error)
	AttachCert(ctx context.Context, tenantID, id uuid.UUID, thumbprint, serial string, issuedAt, expiresAt time.Time, status sources.Status) (*sources.Source, error)
	InsertCredentials(ctx context.Context, sc sources.SourceCredentials) error
	MarkCertRevoked(ctx context.Context, id uuid.UUID, reason string) error
}

// TokensRepo is the subset of the enrollment-tokens repo.
type TokensRepo interface {
	MarkConsumed(ctx context.Context, jti uuid.UUID, ip string, now time.Time) (*sources.EnrollmentTokenRecord, error)
}

// RevocationWriter is the subset of the revocation repo used to seal
// a previous rotation's leaf.
type RevocationWriter interface {
	Insert(ctx context.Context, rv sources.Revocation) error
}

// EventEmitter abstracts the kafka producer + WS hub. Real impl in
// the service layer; here we keep it as an interface so the unit
// tests can capture emissions without spinning up Kafka.
type EventEmitter interface {
	EmitCertEvent(ctx context.Context, tenantID, sourceID uuid.UUID, eventType string, payload any) error
}

// Service is the SIEM-03 §4.5 enrollment flow.
type Service struct {
	tokens  *TokenManager
	source  SourcesReader
	tokRepo TokensRepo
	revRepo RevocationWriter
	pki     *pki.Manager
	crl     *pki.CRLCache
	emitter EventEmitter
	logger  zerolog.Logger
	overlap time.Duration
}

// New constructs an enrollment service.
func New(
	tokens *TokenManager,
	source SourcesReader,
	tokRepo TokensRepo,
	revRepo RevocationWriter,
	pkiMgr *pki.Manager,
	crl *pki.CRLCache,
	emitter EventEmitter,
	overlap time.Duration,
	logger zerolog.Logger,
) *Service {
	if overlap <= 0 {
		overlap = 5 * time.Minute
	}
	return &Service{
		tokens:  tokens,
		source:  source,
		tokRepo: tokRepo,
		revRepo: revRepo,
		pki:     pkiMgr,
		crl:     crl,
		emitter: emitter,
		logger:  logger.With().Str("component", "siem-enroll").Logger(),
		overlap: overlap,
	}
}

// ExchangeInput bundles the inputs to Exchange.
type ExchangeInput struct {
	Token  string
	CSRPEM string
	IP     string
}

// ExchangeOutput is the response shape returned to the collector.
type ExchangeOutput struct {
	CertPEM    string    `json:"cert_pem"`
	CAChainPEM string    `json:"ca_chain_pem"`
	Serial     string    `json:"serial"`
	ExpiresAt  time.Time `json:"expires_at"`
	SourceID   uuid.UUID `json:"source_id"`
}

// Exchange runs the full single-use claim → CSR validation → leaf
// issuance → cert persistence → status flip pipeline.
//
// Callers MUST treat any returned error as a hard fail; in particular
// ErrTokenConsumed must surface as 409 and ErrTenantMismatch as 403.
func (s *Service) Exchange(ctx context.Context, in ExchangeInput) (*ExchangeOutput, error) {
	// 1. Atomic claim against Redis. The Lua script guarantees that
	//    racing requests cannot both succeed.
	claims, err := s.tokens.Claim(ctx, in.Token, in.IP)
	if err != nil {
		return nil, err
	}
	jti, err := uuid.Parse(claims.JTI)
	if err != nil {
		return nil, fmt.Errorf("%w: jti not a uuid", sources.ErrTokenInvalid)
	}
	sourceID, err := uuid.Parse(claims.Sub)
	if err != nil {
		return nil, fmt.Errorf("%w: sub not a uuid", sources.ErrTokenInvalid)
	}
	tenantID, err := uuid.Parse(claims.Tnt)
	if err != nil {
		return nil, fmt.Errorf("%w: tnt not a uuid", sources.ErrTokenInvalid)
	}

	// 2. Durable backstop: flip consumed_at in Postgres. This is
	//    where a Redis-flush replay attack is caught — the row may
	//    still be unconsumed in Redis but the DB blocks the second
	//    Exchange.
	if _, err := s.tokRepo.MarkConsumed(ctx, jti, in.IP, time.Now().UTC()); err != nil {
		return nil, err
	}

	// 3. Source must exist, belong to the same tenant claimed in the
	//    token, and be in a state that permits this purpose.
	src, err := s.source.GetByID(ctx, tenantID, sourceID)
	if err != nil {
		if errors.Is(err, sources.ErrNotFound) {
			return nil, fmt.Errorf("%w: tenant mismatch or unknown source", sources.ErrTenantMismatch)
		}
		return nil, err
	}
	if src.TenantID != tenantID {
		return nil, fmt.Errorf("%w: token tenant %s != source tenant %s", sources.ErrTenantMismatch, tenantID, src.TenantID)
	}

	switch sources.Purpose(claims.Pur) {
	case sources.PurposeEnroll:
		if src.Status != sources.StatusProvisioning {
			return nil, fmt.Errorf("%w: source not provisioning", sources.ErrInvalidState)
		}
	case sources.PurposeRotate:
		if src.Status != sources.StatusActive && src.Status != sources.StatusRotating && src.Status != sources.StatusSilent {
			return nil, fmt.Errorf("%w: source not in rotatable state", sources.ErrInvalidState)
		}
	default:
		return nil, fmt.Errorf("%w: unknown purpose", sources.ErrTokenInvalid)
	}

	// 4. Parse the CSR. We don't enforce CN here — Vault PKI enforces
	//    it via the role.
	if _, err := pki.ValidateCSR(in.CSRPEM); err != nil {
		return nil, fmt.Errorf("%w: %v", sources.ErrValidation, err)
	}

	// 5. Issue the leaf.
	leaf, thumb, err := s.pki.IssueLeaf(ctx, tenantID, sourceID, in.CSRPEM)
	if err != nil {
		return nil, err
	}

	// 6. Persist credentials + flip status.
	if err := s.source.InsertCredentials(ctx, sources.SourceCredentials{
		SourceID:      sourceID,
		VaultPKIMount: "pki-siem-intermediate-" + tenantID.String(),
		VaultKeyRef:   "csr-flow", // private key never enters this service
		CertPEM:       leaf.CertPEM,
		CAChainPEM:    leaf.CAChainPEM,
	}); err != nil {
		return nil, err
	}

	// 7. If this is a rotation, schedule old-cert revocation after
	//    the overlap window. We piggy-back on the revocation table
	//    with a sentinel reason so the detector can pick it up.
	priorThumb := src.MTLSThumbprint
	priorSerial := src.CertSerial
	priorRevoke := sources.Purpose(claims.Pur) == sources.PurposeRotate && priorThumb != ""

	updated, err := s.source.AttachCert(ctx, tenantID, sourceID, thumb, leaf.Serial, leaf.NotBefore, leaf.NotAfter, sources.StatusActive)
	if err != nil {
		return nil, err
	}
	_ = updated

	if priorRevoke {
		// Schedule revocation via the denylist's "revoked_at" set
		// into the future. The detector reads this and revokes
		// in Vault once the overlap elapses.
		go func() {
			ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			time.Sleep(s.overlap)
			_ = s.revRepo.Insert(ctx2, sources.Revocation{
				Thumbprint: priorThumb,
				SourceID:   sourceID,
				CertSerial: priorSerial,
				Reason:     "rotation-overlap-elapsed",
			})
			_ = s.pki.Revoke(ctx2, tenantID, priorSerial)
			_ = s.source.MarkCertRevoked(ctx2, sourceID, "rotation")
			if s.crl != nil {
				s.crl.Add(sources.Revocation{Thumbprint: priorThumb, SourceID: sourceID, CertSerial: priorSerial, Reason: "rotation", RevokedAt: time.Now().UTC()})
			}
		}()
	}

	// 8. Emit events.
	if s.emitter != nil {
		evType := "siem.source.cert.issued"
		if sources.Purpose(claims.Pur) == sources.PurposeRotate {
			evType = "siem.source.cert.rotated"
		}
		_ = s.emitter.EmitCertEvent(ctx, tenantID, sourceID, evType, map[string]any{
			"serial":     leaf.Serial,
			"expires_at": leaf.NotAfter,
		})
	}

	return &ExchangeOutput{
		CertPEM:    leaf.CertPEM,
		CAChainPEM: leaf.CAChainPEM,
		Serial:     leaf.Serial,
		ExpiresAt:  leaf.NotAfter,
		SourceID:   sourceID,
	}, nil
}
