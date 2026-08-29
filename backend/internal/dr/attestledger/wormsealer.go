package attestledger

import (
	"bytes"
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/worm"
)

// WORMSealer adapts internal/dr/worm.Client to the Sealer seam: it seals a
// checkpoint payload as a GOVERNANCE-locked, envelope-encrypted object in the DR
// WORM bucket, giving the anchored checkpoint ransomware-grade immutability (a
// plain delete is refused while the lock is in force). The checkpoint is the
// tamper-proof witness for the ledger range it covers.
type WORMSealer struct {
	client *worm.Client
}

// NewWORMSealer constructs a sealer backed by a DR WORM client.
func NewWORMSealer(client *worm.Client) (*WORMSealer, error) {
	if client == nil {
		return nil, fmt.Errorf("attestledger: nil WORM client")
	}
	return &WORMSealer{client: client}, nil
}

// SealCheckpoint writes payload to the WORM bucket under a GOVERNANCE object-lock
// and returns the object key + version. The StreamID is a synthetic per-tenant
// stream ("attestation-ledger") so the worm client selects the tenant DEK and
// groups checkpoints together; the supplied key is recorded as the marker so the
// key is deterministic and discoverable.
func (s *WORMSealer) SealCheckpoint(ctx context.Context, tenantID uuid.UUID, key string, payload []byte) (string, string, error) {
	res, err := s.client.Seal(ctx, bytes.NewReader(payload), worm.SealOptions{
		TenantID:  tenantID,
		StreamID:  "attestation-ledger",
		MarkerLSN: key,
	})
	if err != nil {
		return "", "", fmt.Errorf("attestledger: WORM seal: %w", err)
	}
	return res.Key, res.VersionID, nil
}
