package main

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/cleanroom"
)

// readOnlyCleanPointScanner adapts the clean-room service's LatestScan — a pure
// read of the most recent STORED verdict — to the drservice.CleanPointScanner
// interface the promotion gate consumes.
//
// This is deliberately read-only: the gate consults clean-room evidence that a
// separate clean-room scan already produced, rather than triggering a fresh
// restore-and-scan inside ValidateRecoveryPoint. Wiring the executing
// cleanroom.Service.ScanRecoveryPoint directly would make every recovery-point
// validation perform a full sandbox restore + malware scan (slow, and able to
// fail for infra reasons unrelated to the point's fidelity — which would surface
// as a 500 on POST /recovery-points/{id}/validate). A point that has no stored
// clean-room scan yet maps to a nil verdict (ErrNotFound -> nil, nil), which the
// clean-point scorer treats conservatively as missing evidence — not a silent
// pass and not an error.
type readOnlyCleanPointScanner struct {
	svc *cleanroom.Service
}

func (r readOnlyCleanPointScanner) ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*cleanroom.Scan, error) {
	scan, err := r.svc.LatestScan(ctx, tenantID, pointID)
	if err != nil {
		if errors.Is(err, cleanroom.ErrNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return scan, nil
}
