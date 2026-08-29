package service

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/lex/dto"
)

const activeSignatureUserStatus = "active"

// SignatureUserIdentity is the small, non-sensitive IAM projection required to
// bind an internal signature recipient to a real platform account.
type SignatureUserIdentity struct {
	ID       uuid.UUID
	TenantID uuid.UUID
	Name     string
	Email    string
	Status   string
}

// SignatureUserDirectory keeps SignatureService independent from the concrete
// IAM service while still making internal recipient validation mandatory.
type SignatureUserDirectory interface {
	ResolveSignatureUser(ctx context.Context, tenantID, userID uuid.UUID) (*SignatureUserIdentity, error)
}

// PlatformCoreSignatureUserDirectory resolves the canonical user identity from
// platform_core. Reads run in a tenant-scoped transaction so the users-table RLS
// policy remains the final cross-tenant backstop.
type PlatformCoreSignatureUserDirectory struct {
	db *pgxpool.Pool
}

func NewPlatformCoreSignatureUserDirectory(db *pgxpool.Pool) *PlatformCoreSignatureUserDirectory {
	return &PlatformCoreSignatureUserDirectory{db: db}
}

func (d *PlatformCoreSignatureUserDirectory) ResolveSignatureUser(ctx context.Context, tenantID, userID uuid.UUID) (*SignatureUserIdentity, error) {
	if d == nil || d.db == nil {
		return nil, errors.New("platform IAM database is not configured")
	}

	identity := &SignatureUserIdentity{}
	var firstName, lastName string
	err := database.RunReadWithTenant(ctx, d.db, tenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
			SELECT id, tenant_id, first_name, last_name, email, status::text
			FROM users
			WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
			tenantID, userID,
		).Scan(&identity.ID, &identity.TenantID, &firstName, &lastName, &identity.Email, &identity.Status)
	})
	if err != nil {
		return nil, err
	}
	identity.Name = normalizeSignatureDisplayName(firstName + " " + lastName)
	identity.Email = strings.ToLower(strings.TrimSpace(identity.Email))
	return identity, nil
}

func (s *SignatureService) canonicalizeInternalSignatureRecipients(ctx context.Context, tenantID uuid.UUID, req *dto.CreateSignatureEnvelopeRequest) error {
	if req == nil {
		return nil
	}
	for i := range req.Recipients {
		recipient := &req.Recipients[i]
		if recipient.UserID == nil {
			continue
		}
		prefix := signatureRecipientFieldPrefix(i, len(req.Recipients))
		if s.userDirectory == nil {
			return internalError("validate internal signature recipient", errors.New("signature user directory is not configured"))
		}

		identity, err := s.userDirectory.ResolveSignatureUser(ctx, tenantID, *recipient.UserID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return validationError("internal signature recipient must be an active user in this tenant", map[string]string{prefix + ".user_id": "not found"})
			}
			return internalError("resolve internal signature recipient", err)
		}
		if identity == nil || identity.ID != *recipient.UserID || identity.TenantID != tenantID || !strings.EqualFold(strings.TrimSpace(identity.Status), activeSignatureUserStatus) {
			return validationError("internal signature recipient must be an active user in this tenant", map[string]string{prefix + ".user_id": "inactive or outside tenant"})
		}

		canonicalName := normalizeSignatureDisplayName(identity.Name)
		canonicalEmail := strings.ToLower(strings.TrimSpace(identity.Email))
		if canonicalName == "" || canonicalEmail == "" {
			return validationError("internal signature recipient has an incomplete IAM identity", map[string]string{prefix + ".user_id": "missing canonical name or email"})
		}
		if suppliedName := normalizeSignatureDisplayName(recipient.Name); suppliedName != "" && !strings.EqualFold(suppliedName, canonicalName) {
			return validationError("internal signature recipient name does not match IAM", map[string]string{prefix + ".name": "does not match user_id"})
		}
		if recipient.Email != nil && !strings.EqualFold(strings.TrimSpace(*recipient.Email), canonicalEmail) {
			return validationError("internal signature recipient email does not match IAM", map[string]string{prefix + ".email": "does not match user_id"})
		}

		recipient.Name = canonicalName
		recipient.Email = &canonicalEmail
		if recipient.EvidenceMetadata == nil {
			recipient.EvidenceMetadata = map[string]any{}
		}
		recipient.EvidenceMetadata["internal_identity"] = map[string]any{
			"source":    "platform_iam",
			"validated": true,
			"user_id":   identity.ID.String(),
			"tenant_id": identity.TenantID.String(),
		}
	}
	return nil
}

func signatureRecipientFieldPrefix(index, total int) string {
	if total <= 1 {
		return "recipients"
	}
	return fmt.Sprintf("recipients.%d", index)
}

func normalizeSignatureDisplayName(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
