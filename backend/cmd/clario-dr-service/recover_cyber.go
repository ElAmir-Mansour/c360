package main

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/cleanroom"
	"github.com/clario360/platform/internal/dr/ransomware"
	"github.com/clario360/platform/internal/recover/cyberrecovery"
)

// cleanroomGateScanner adapts the EXISTING dr/cleanroom Service to the Cyber
// Recovery integrity-gate interface. It COMPOSES the real clean-room scanner
// (ScanRecoveryPoint restores the sealed chunks into a sandbox, runs real
// integrity + malware checks, and records its own immutable verdict) and maps
// that verdict into the minimal projection the gate needs — it never
// reimplements scanning.
type cleanroomGateScanner struct {
	svc *cleanroom.Service
}

// ScanRecoveryPoint runs the composed clean-room scan and projects its verdict.
func (a cleanroomGateScanner) ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (cyberrecovery.IntegrityResult, error) {
	scan, err := a.svc.ScanRecoveryPoint(ctx, tenantID, pointID)
	if err != nil {
		return cyberrecovery.IntegrityResult{}, err
	}
	scanID, perr := uuid.Parse(scan.ID)
	if perr != nil {
		return cyberrecovery.IntegrityResult{}, fmt.Errorf("recover cyber-recovery: clean-room scan id %q is not a uuid: %w", scan.ID, perr)
	}
	return cyberrecovery.IntegrityResult{
		ScanID:    scanID,
		Verdict:   scan.Verdict,
		Detail:    scan.Detail,
		ScannedAt: scan.FinishedAt,
	}, nil
}

var _ cyberrecovery.IntegrityScanner = cleanroomGateScanner{}

// configureCyberRecovery constructs the Cyber Recovery workspace router. It
// COMPOSES the already-built clean-room service (the integrity gate) and the
// ransomware store (early-warning signals) from the intelligence plane, plus the
// shared dr_db pool for the flow state machine. The router is returned for the
// product router to mount under /api/recover/cyber-recovery; it owns no recovery
// logic of its own.
func configureCyberRecovery(
	pgRunner cyberrecovery.PGXRunner,
	cleanroomSvc *cleanroom.Service,
	ransomwareStore *ransomware.Store,
	audit cyberrecovery.AuditSink,
	metricsReg prometheus.Registerer,
	forbidSelfApproval bool,
	logger zerolog.Logger,
) (*cyberrecovery.Router, error) {
	svc, err := cyberrecovery.NewService(cyberrecovery.Config{
		Runner:             pgRunner,
		Store:              cyberrecovery.NewStore(),
		Scanner:            cleanroomGateScanner{svc: cleanroomSvc},
		Ransomware:         ransomwareStore,
		Metrics:            cyberrecovery.NewMetrics(metricsReg),
		Audit:              audit,
		ForbidSelfApproval: forbidSelfApproval,
		Logger:             logger,
	})
	if err != nil {
		return nil, err
	}
	return cyberrecovery.NewRouter(svc, logger), nil
}
