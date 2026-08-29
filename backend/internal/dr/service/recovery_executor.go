package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/instant"
	"github.com/clario360/platform/internal/dr/model"
	drprovider "github.com/clario360/platform/internal/dr/provider"
	"github.com/clario360/platform/internal/dr/repository"
)

// stepBootPrefix is the failover_step name prefix for a per-member boot step
// (one row per booted member, keyed UNIQUE (run_id, step) for idempotency, §6.2).
const stepBootPrefix = "gate3.boot:"

// stepInstantSession records the COW session Gate 3 booted from. It is separate
// from per-member boot steps so a crash resumes against the same overlay.
const stepInstantSession = "gate3.instant.session"

// stepExecuteSummary is the summary step the executor records for the whole
// Gate-3 boot sequence (the boot order, network profile, and per-member ids).
const stepExecuteSummary = "gate3.execute.summary"

// stepDrillTeardown is the failover_step recorded after a drill's isolated
// environment is torn down (WP-11), so a re-run is a no-op (idempotent).
const stepDrillTeardown = "drill.teardown"

// BootOutcome is the idempotent result of provisioning one recovery target.
// It is recorded in failover_step.detail so a re-claim after a crash re-reads
// it and does NOT double-boot (§6.2): the RecoveryTargetDriver.Ensure call is
// create-or-return-existing keyed by the idempotency key.
type BootOutcome struct {
	SiteID                 string    `json:"site_id"`
	StreamID               string    `json:"stream_id"`
	ExternalID             string    `json:"external_id"`
	RestoredKey            string    `json:"restored_object_key"`
	RestoredHash           string    `json:"restored_sha256"`
	RestoredSize           int       `json:"restored_bytes"`
	InstantSessionID       string    `json:"instant_session_id,omitempty"`
	InstantOverlayLocation string    `json:"instant_overlay_location,omitempty"`
	InstantChunkSize       int       `json:"instant_chunk_size,omitempty"`
	InstantChunksTotal     int       `json:"instant_chunks_total,omitempty"`
	Profile                string    `json:"network_profile"`
	BootedAt               time.Time `json:"booted_at"`
	AlreadyBoot            bool      `json:"already_booted"`
	// Detail carries a free-form note, used only on teardown-error records.
	Detail string `json:"detail,omitempty"`
}

// InstantSessionRef is the durable descriptor Gate 3 passes to recovery target
// drivers when instant recovery is enabled.
type InstantSessionRef struct {
	SessionID       string `json:"session_id"`
	RecoveryPointID string `json:"recovery_point_id"`
	OverlayLocation string `json:"overlay_location"`
	ChunkSize       int    `json:"chunk_size"`
	ChunksTotal     int    `json:"chunks_total"`
}

// RestoreContext is what the RecoveryTargetDriver needs to bring one member up
// at the recovery site: the decrypted recovery-point chunk, the target's
// recovery endpoint, the applied network-mapping profile, and an idempotency
// key so Ensure is create-or-return-existing.
type RestoreContext struct {
	IdempotencyKey   string
	TenantID         uuid.UUID
	GroupID          string
	SiteID           string
	StreamID         string
	RecoveryEndpoint string
	// Plaintext is the decrypted sealed recovery-point chunk for this member's
	// stream (restored from WORM by the executor before calling the driver).
	Plaintext []byte
	// ObjectKey is the WORM key the plaintext was restored from.
	ObjectKey string
	// InstantSessionID/OverlayLocation describe a live COW session the target can
	// attach as its boot source. When present, Plaintext may be empty because the
	// workload reads through the instant overlay instead of a pre-restored copy.
	InstantSessionID       string
	InstantOverlayLocation string
	InstantChunkSize       int
	InstantChunksTotal     int
	// Profile is the network-mapping profile: production for a real failover,
	// isolated for a drill (§6.2). PrimaryToRecovery is the resolved remap.
	Profile           string
	PrimaryToRecovery map[string]string
	// Drill is true for a drill run so the driver provisions into an isolated
	// environment it can tear down afterwards.
	Drill bool
}

// RecoveryTargetDriver is the pluggable boot mechanism (§14.2). A concrete
// driver provisions/starts a workload at the recovery site (a hypervisor API, a
// K8s namespace, …). Implementations MUST be idempotent: Ensure with the same
// idempotency key returns the existing resource rather than booting twice.
type RecoveryTargetDriver interface {
	// Ensure restores the member and starts its workload, returning the external
	// resource id. Called once per member in boot order; create-or-return-existing.
	Ensure(ctx context.Context, rc RestoreContext) (externalID string, err error)
	// Teardown discards a provisioned member. Called for drill teardown and for
	// rollback of a partially-booted real failover.
	Teardown(ctx context.Context, externalID string, rc RestoreContext) error
}

// SealedChunkReader restores (downloads + decrypts) a sealed recovery-point
// chunk for a member stream. *service.Service satisfies it via ReadSealedChunk
// — the REAL WORM read path that proves a chunk round-trips back to plaintext
// through the per-tenant DEK.
type SealedChunkReader interface {
	ReadSealedChunk(ctx context.Context, tenantID, pointID uuid.UUID, streamID string) ([]byte, error)
}

// InstantRecoveryService starts a COW session over a sealed recovery point. The
// instant.Service satisfies it; tests can provide a small fake.
type InstantRecoveryService interface {
	StartSession(ctx context.Context, tenantID, recoveryPointID uuid.UUID, groupID *uuid.UUID) (*instant.Session, error)
}

// RestoreVerifyDriver is the concrete default RecoveryTargetDriver shipped with
// ClarioDR (§14.2): a restore-plus-verify driver. It "boots" a member by
// restoring its decrypted recovery-point chunk to a target namespace and
// invoking a configurable workload start hook (default: a no-op that records the
// restore). Hypervisor/K8s-specific drivers are a documented follow-on behind
// this same interface (§14.2). It is REAL — it operates on the actual decrypted
// bytes and produces a deterministic, verifiable external id — not a stub.
type RestoreVerifyDriver struct {
	// StartWorkload is the hook that brings the workload up after the chunk is
	// restored. The default records and returns; a deployment wires a real
	// provisioner here. It receives the restore context and returns an external
	// resource id. It MUST be idempotent for the same IdempotencyKey.
	StartWorkload func(ctx context.Context, rc RestoreContext) (string, error)
	// StopWorkload tears a provisioned workload down (drill teardown / rollback).
	StopWorkload func(ctx context.Context, externalID string, rc RestoreContext) error
}

// NewRestoreVerifyDriver builds the default driver with no-op-but-real hooks.
func NewRestoreVerifyDriver() *RestoreVerifyDriver {
	return &RestoreVerifyDriver{}
}

// RecoveryCapabilities marks restore-verify as a development verification
// driver, not a regulated recovery provider.
func (d *RestoreVerifyDriver) RecoveryCapabilities() drprovider.Capabilities {
	return drprovider.Capabilities{
		Kind:                drprovider.KindVerify,
		DisplayName:         "Restore verify",
		Live:                true,
		SDKBacked:           false,
		SupportsEnsure:      true,
		SupportsTeardown:    true,
		SupportsDrill:       true,
		SupportsIdempotency: true,
		RegulatedCompatible: false,
		Notes: []string{
			"development restore verification; not a certified recovery provider",
		},
	}
}

// Ensure restores the chunk and starts the workload, returning a deterministic
// external id derived from the idempotency key so a re-claim resolves to the
// same resource (create-or-return-existing). The driver verifies the restored
// bytes are non-empty before declaring the member booted.
func (d *RestoreVerifyDriver) Ensure(ctx context.Context, rc RestoreContext) (string, error) {
	if len(rc.Plaintext) == 0 && rc.InstantSessionID == "" {
		return "", fmt.Errorf("restore-verify: empty restored chunk for stream %s (nothing to boot)", rc.StreamID)
	}
	if d.StartWorkload != nil {
		return d.StartWorkload(ctx, rc)
	}
	// Default real behaviour: derive a stable external id from the idempotency
	// key. Restoring the same key resolves to the same resource — this is what
	// makes a crash-and-reclaim a no-op rather than a double-boot.
	sum := sha256.Sum256([]byte(rc.IdempotencyKey))
	return "rv-" + hex.EncodeToString(sum[:8]), nil
}

// Teardown discards a provisioned member (drill teardown / rollback).
func (d *RestoreVerifyDriver) Teardown(ctx context.Context, externalID string, rc RestoreContext) error {
	if d.StopWorkload != nil {
		return d.StopWorkload(ctx, externalID, rc)
	}
	return nil
}

// executorTxRunner runs the executor's step writes inside one transaction
// without a tenant filter (the driver claims runs across tenants; §7 system
// path). The executor uses RunSystemTx so its failover_step writes commit even
// though it runs under the leader-singleton driver.
type executorTxRunner interface {
	RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

// executorRepo is the data surface the executor needs (all system-path reads
// because the driver runs across tenants).
type executorRepo interface {
	SystemListRecoveryTargetsByGroup(ctx context.Context, db repository.DBTX, groupID string) ([]*model.RecoveryTarget, error)
	SystemListNetworkMappingsByProfile(ctx context.Context, db repository.DBTX, groupID, profile string) ([]*model.NetworkMapping, error)
	SystemGetStreamBySite(ctx context.Context, db repository.DBTX, siteID string) (*model.ReplicationStream, error)
	SystemLatestValidatedRecoveryPoint(ctx context.Context, db repository.DBTX, groupID string) (*model.RecoveryPoint, error)
	SystemGetRecoveryPoint(ctx context.Context, db repository.DBTX, id string) (*model.RecoveryPoint, error)
	SystemRecoveryPointPromotionSafety(ctx context.Context, db repository.DBTX, recoveryPointID string) (repository.PromotionSafety, error)
	SystemListFailoverSteps(ctx context.Context, db repository.DBTX, runID string) ([]*model.FailoverStep, error)
	UpsertFailoverStep(ctx context.Context, db repository.DBTX, step *model.FailoverStep) error
}

// RecoveryExecutor implements the failover.Executor gate (§6.3, Gate 3): it
// boots a consistency group's members in declared boot order at the recovery
// site. For each member it restores the latest VALIDATED recovery point (reads
// the sealed chunk from WORM and decrypts it through the per-tenant DEK),
// applies the network-mapping profile (production for real, isolated for
// drills), and provisions the workload via the pluggable RecoveryTargetDriver.
//
// It is idempotent (§6.2): each member's boot is a failover_step keyed
// UNIQUE (run_id, "gate3.boot:<site>"). On a crash-and-reclaim the executor
// reads the prior step detail and, if the member already booted, re-reads the
// outcome rather than booting again — the RecoveryTargetDriver.Ensure call is
// create-or-return-existing.
//
// On any member failure mid-boot it tears down everything booted so far
// (Teardown) and returns the error; the driver maps that to ROLLED_BACK (real:
// leave primary authoritative + discard the partial recovery; drill: discard the
// isolated env).
type RecoveryExecutor struct {
	repo      executorRepo
	runner    executorTxRunner
	reader    SealedChunkReader
	driver    RecoveryTargetDriver
	instant   InstantRecoveryService
	bootTiers BootTierSource
	health    HealthProber
	now       func() time.Time
}

// BootTierSource derives dependency-aware boot tiers for a group from the
// bootgraph dependency DAG, keyed by recovery_target site id. It is OPTIONAL:
// when unset, or when it reports no usable site->tier mapping for a group, the
// executor boots in the flat recovery_target.boot_order. It is implemented in
// the wiring layer over bootgraph's Store + Planner so this package carries no
// dependency on bootgraph.
type BootTierSource interface {
	// TierBySite returns site_id -> tier index for the group. ok is false when no
	// usable dependency DAG with site links exists, so the caller falls back to the
	// flat boot order.
	TierBySite(ctx context.Context, db repository.DBTX, groupID string) (tiers map[string]int, ok bool, err error)
}

// NewRecoveryExecutor wires the Gate-3 recovery executor. reader is the real
// WORM-backed sealed-chunk restore path (Service.ReadSealedChunk); driver is the
// pluggable boot mechanism (RestoreVerifyDriver by default).
func NewRecoveryExecutor(repo executorRepo, runner executorTxRunner, reader SealedChunkReader, driver RecoveryTargetDriver) *RecoveryExecutor {
	if driver == nil {
		driver = NewRestoreVerifyDriver()
	}
	return &RecoveryExecutor{
		repo:   repo,
		runner: runner,
		reader: reader,
		driver: driver,
		now:    func() time.Time { return time.Now().UTC() },
	}
}

// WithInstantRecovery enables Gate 3 to boot from an instant COW session for
// the pinned recovery point instead of fully restoring each member up front.
func (e *RecoveryExecutor) WithInstantRecovery(svc InstantRecoveryService) *RecoveryExecutor {
	e.instant = svc
	return e
}

// WithBootTiers enables dependency-tiered recovery boot: src maps each recovery
// target site to its bootgraph dependency tier, and gate (the workload
// HealthProber) is the health-gate barrier between tiers — a member is probed
// before any later-tier member that may depend on it boots. Both are optional;
// without a complete site->tier mapping the executor keeps the flat boot_order
// path (no health gate), so existing groups are unaffected.
func (e *RecoveryExecutor) WithBootTiers(src BootTierSource, gate HealthProber) *RecoveryExecutor {
	e.bootTiers = src
	e.health = gate
	return e
}

// Execute boots the group's recovery targets in boot order. It satisfies
// failover.Executor.
func (e *RecoveryExecutor) Execute(ctx context.Context, run *model.FailoverRun) error {
	_, err := e.ExecuteWithDetail(ctx, run)
	return err
}

// ExecuteWithDetail boots the group's recovery targets in boot order and returns
// the realized boot order + network profile + per-member outcomes as the durable
// Gate-3 step detail. It satisfies failover.DetailedExecutor. The boot is
// transactional per member (the step row commits with the boot outcome) so a
// re-claim resumes exactly and does not double-boot (§6.2).
func (e *RecoveryExecutor) ExecuteWithDetail(ctx context.Context, run *model.FailoverRun) (map[string]any, error) {
	tenantID, err := uuid.Parse(run.TenantID)
	if err != nil {
		return nil, fmt.Errorf("recovery executor: bad tenant id %q: %w", run.TenantID, err)
	}

	// Resolve everything we need under one system read: the ordered targets,
	// the network-mapping profile, the pinned/latest recovery point, the
	// per-member streams, and the prior step rows (for idempotent re-claim).
	var (
		targets      []*model.RecoveryTarget
		mappings     []*model.NetworkMapping
		point        *model.RecoveryPoint
		streamBy     = map[string]*model.ReplicationStream{}
		priorBoot    = map[string]BootOutcome{}
		priorInstant *InstantSessionRef
		tierBySite   map[string]int
		tieredOK     bool
	)
	profile := networkProfileForMode(run.Mode)

	if err := e.runner.RunSystemRead(ctx, func(tx repository.DBTX) error {
		var rerr error
		targets, rerr = e.repo.SystemListRecoveryTargetsByGroup(ctx, tx, run.GroupID)
		if rerr != nil {
			return rerr
		}
		if len(targets) == 0 {
			return fmt.Errorf("recovery executor: group %s has no recovery targets to boot", run.GroupID)
		}
		mappings, rerr = e.repo.SystemListNetworkMappingsByProfile(ctx, tx, run.GroupID, profile)
		if rerr != nil {
			return rerr
		}
		// The recovery point is pinned at Gate 1; use it. Fall back to the
		// latest validated point only if a run somehow reached EXECUTING unpinned.
		if run.RecoveryPointID != nil && *run.RecoveryPointID != "" {
			point, rerr = e.repo.SystemGetRecoveryPoint(ctx, tx, *run.RecoveryPointID)
		} else {
			point, rerr = e.repo.SystemLatestValidatedRecoveryPoint(ctx, tx, run.GroupID)
		}
		if rerr != nil {
			return rerr
		}
		if !point.IsValidated {
			return fmt.Errorf("recovery executor: recovery point %s is not validated (refusing to boot)", point.ID)
		}
		safety, serr := e.repo.SystemRecoveryPointPromotionSafety(ctx, tx, point.ID)
		if serr != nil {
			return serr
		}
		if !safety.Safe() {
			return fmt.Errorf("recovery executor: recovery point %s is not promotion-safe: %s", point.ID, safety.BlockReason())
		}
		for _, t := range targets {
			stream, serr := e.repo.SystemGetStreamBySite(ctx, tx, t.SiteID)
			if serr != nil {
				return serr
			}
			streamBy[t.SiteID] = stream
		}
		steps, rerr := e.repo.SystemListFailoverSteps(ctx, tx, run.ID)
		if rerr != nil {
			return rerr
		}
		for _, s := range steps {
			if s.Step == stepInstantSession && s.Status == model.StepStatusPassed {
				if ref, ok := decodeInstantSessionRef(s.Detail); ok {
					priorInstant = &ref
				}
			}
			if strings.HasPrefix(s.Step, stepBootPrefix) && s.Status == model.StepStatusPassed {
				if out, ok := decodeBootOutcome(s.Detail); ok {
					priorBoot[out.SiteID] = out
				}
			}
		}
		// Dependency-aware boot tiers from the bootgraph DAG (optional). Read inside
		// the same system tx so the site->tier map is consistent with the targets.
		if e.bootTiers != nil {
			tierBySite, tieredOK, rerr = e.bootTiers.TierBySite(ctx, tx, run.GroupID)
			if rerr != nil {
				return rerr
			}
		}
		return nil
	}); err != nil {
		return nil, err
	}

	// Boot order: when the bootgraph DAG links every recovery target to a boot
	// service, boot in dependency TIERS (tier ascending, then boot_order, then
	// site) with a health-gate barrier so a dependent only boots once its
	// dependencies are healthy. Otherwise fall back to the flat
	// recovery_target.boot_order (historic behaviour, no health gate).
	gated := e.tierOrderTargets(targets, tierBySite, tieredOK)

	remap := resolveRemap(mappings)
	instantRef, err := e.ensureInstantSession(ctx, run, tenantID, point, priorInstant)
	if err != nil {
		return nil, err
	}
	booted := make([]struct {
		out BootOutcome
		rc  RestoreContext
	}, 0, len(targets))

	for _, t := range targets {
		stream := streamBy[t.SiteID]
		stepName := stepBootPrefix + t.SiteID

		// Idempotent re-claim: if this member already booted (a passed boot step
		// exists), re-read its outcome and do NOT boot again (§6.2).
		if out, ok := priorBoot[t.SiteID]; ok {
			out.AlreadyBoot = true
			rc := e.restoreContextFor(run, tenantID, t, stream, profile, remap, nil, out.RestoredKey)
			applyInstantOutcomeToContext(&rc, out)
			booted = append(booted, struct {
				out BootOutcome
				rc  RestoreContext
			}{out, rc})
			continue
		}

		objectKey := point.ObjectKeys[stream.ID]
		var (
			plaintext    []byte
			restoredHash string
			restoredSize int
		)
		if instantRef != nil {
			objectKey = "instant:" + instantRef.SessionID
			restoredHash = instantRestoreHash(*instantRef, stream.ID)
		} else {
			// REAL restore: download + decrypt the member's sealed chunk from WORM.
			var rerr error
			plaintext, rerr = e.reader.ReadSealedChunk(ctx, tenantID, uuid.MustParse(point.ID), stream.ID)
			if rerr != nil {
				return nil, e.rollback(ctx, run, booted, fmt.Errorf("restoring sealed chunk for stream %s: %w", stream.ID, rerr))
			}
			sum := sha256.Sum256(plaintext)
			restoredHash = hex.EncodeToString(sum[:])
			restoredSize = len(plaintext)
		}
		rc := e.restoreContextFor(run, tenantID, t, stream, profile, remap, plaintext, objectKey)
		applyInstantRefToContext(&rc, instantRef)

		externalID, berr := e.driver.Ensure(ctx, rc)
		if berr != nil {
			return nil, e.rollback(ctx, run, booted, fmt.Errorf("booting member %s: %w", t.SiteID, berr))
		}
		out := BootOutcome{
			SiteID:       t.SiteID,
			StreamID:     stream.ID,
			ExternalID:   externalID,
			RestoredKey:  objectKey,
			RestoredHash: restoredHash,
			RestoredSize: restoredSize,
			Profile:      profile,
			BootedAt:     e.now(),
		}
		applyInstantRefToOutcome(&out, instantRef)

		// Persist the boot outcome durably so a re-claim sees it (idempotency).
		if err := e.recordBootStep(ctx, run.ID, stepName, out); err != nil {
			// The workload is up but we could not record it — tear it down so a
			// re-claim does not see a ghost resource, then fail the gate.
			_ = e.driver.Teardown(ctx, externalID, rc)
			return nil, e.rollback(ctx, run, booted, fmt.Errorf("recording boot step for %s: %w", t.SiteID, err))
		}
		booted = append(booted, struct {
			out BootOutcome
			rc  RestoreContext
		}{out, rc})

		// Health-gate barrier (dependency-aware boot): a freshly-booted member must
		// be healthy before a later-tier member that may depend on it boots. Because
		// targets are ordered by tier, gating each member as it boots enforces the
		// tier barrier without parallelism (the executor boots sequentially anyway).
		// gated is false for the flat boot_order fallback, preserving prior behaviour.
		if gated {
			if gerr := e.gateMemberHealth(ctx, t); gerr != nil {
				return nil, e.rollback(ctx, run, booted, gerr)
			}
		}
	}

	// Summary step: the realized boot order + profile + member external ids.
	summary := map[string]any{
		"mode":            run.Mode,
		"network_profile": profile,
		"recovery_point":  point.ID,
		"boot_order":      bootOrderSummary(booted),
		// boot_tiered records whether the dependency-aware bootgraph tiers (with a
		// health-gate barrier) drove this boot, or the flat boot_order fallback did.
		"boot_tiered": gated,
	}
	if instantRef != nil {
		summary["instant_session"] = instantSessionRefToDetail(*instantRef)
	}
	if err := e.recordSummaryStep(ctx, run.ID, summary); err != nil {
		return nil, err
	}
	return summary, nil
}

// tierOrderTargets orders targets for boot and reports whether the dependency-
// tiered, health-gated path is active. The tiered path engages only when the
// bootgraph DAG yielded a site->tier map (ok), a health prober is configured, and
// EVERY target is mapped — a partial mapping is ambiguous on the critical path,
// so it falls back wholesale to the flat recovery_target.boot_order. The sort is
// stable and fully deterministic in both modes.
func (e *RecoveryExecutor) tierOrderTargets(targets []*model.RecoveryTarget, tierBySite map[string]int, ok bool) (gated bool) {
	tiered := ok && e.health != nil && len(tierBySite) > 0
	if tiered {
		for _, t := range targets {
			if _, has := tierBySite[t.SiteID]; !has {
				tiered = false
				break
			}
		}
	}
	sort.SliceStable(targets, func(i, j int) bool {
		if tiered {
			if ti, tj := tierBySite[targets[i].SiteID], tierBySite[targets[j].SiteID]; ti != tj {
				return ti < tj
			}
		}
		if targets[i].BootOrder != targets[j].BootOrder {
			return targets[i].BootOrder < targets[j].BootOrder
		}
		return targets[i].SiteID < targets[j].SiteID
	})
	return tiered
}

// gateMemberHealth probes a freshly-booted member's workload health (its
// recovery_target.HealthProbe) and returns an error when it is not healthy, so
// the caller rolls the boot back. A member with no declared probe is treated as
// passing (nothing to gate on), matching the post-boot WorkloadHealthValidator.
func (e *RecoveryExecutor) gateMemberHealth(ctx context.Context, t *model.RecoveryTarget) error {
	if e.health == nil {
		return nil
	}
	if strings.TrimSpace(t.HealthProbe.Type) == "" {
		return nil
	}
	res, err := e.health.Probe(ctx, t.HealthProbe)
	if err != nil {
		return fmt.Errorf("recovery executor: health gate probe error for member %s: %w", t.SiteID, err)
	}
	if !res.Healthy {
		return fmt.Errorf("recovery executor: member %s did not become healthy after boot (%s %s): %s",
			t.SiteID, res.Type, res.Target, res.Detail)
	}
	return nil
}

// TeardownDrill discards the isolated environment a drill booted, leaving the
// recovery point untouched (§6.2, WP-11). It reads the run's recorded boot
// outcomes and tears down each provisioned member via the RecoveryTargetDriver.
// It is idempotent: a member with no live external id (or already torn down) is
// skipped, and the teardown is recorded as a failover_step so a re-run is a
// no-op. It is a no-op for a real failover (the recovered env is authoritative).
func (e *RecoveryExecutor) TeardownDrill(ctx context.Context, run *model.FailoverRun) error {
	if run.Mode != model.ModeDrill {
		return nil
	}
	tenantID, err := uuid.Parse(run.TenantID)
	if err != nil {
		return fmt.Errorf("recovery executor: bad tenant id %q: %w", run.TenantID, err)
	}

	var (
		steps    []*model.FailoverStep
		alreadyT bool
	)
	if err := e.runner.RunSystemRead(ctx, func(tx repository.DBTX) error {
		var rerr error
		steps, rerr = e.repo.SystemListFailoverSteps(ctx, tx, run.ID)
		return rerr
	}); err != nil {
		return fmt.Errorf("recovery executor: reading boot steps for teardown: %w", err)
	}

	outcomes := make([]BootOutcome, 0, len(steps))
	for _, s := range steps {
		if s.Step == stepDrillTeardown && s.Status == model.StepStatusPassed {
			alreadyT = true
		}
		if strings.HasPrefix(s.Step, stepBootPrefix) && !strings.HasSuffix(s.Step, ".teardown_error") && s.Status == model.StepStatusPassed {
			if out, ok := decodeBootOutcome(s.Detail); ok {
				outcomes = append(outcomes, out)
			}
		}
	}
	if alreadyT {
		return nil // idempotent: drill already torn down
	}

	profile := networkProfileForMode(run.Mode)
	tornDown := make([]string, 0, len(outcomes))
	for _, out := range outcomes {
		if out.ExternalID == "" {
			continue
		}
		rc := RestoreContext{
			IdempotencyKey: fmt.Sprintf("%s|%s|teardown", run.ID, out.SiteID),
			TenantID:       tenantID,
			GroupID:        run.GroupID,
			SiteID:         out.SiteID,
			StreamID:       out.StreamID,
			Profile:        profile,
			Drill:          true,
		}
		if err := e.driver.Teardown(ctx, out.ExternalID, rc); err != nil {
			return fmt.Errorf("recovery executor: tearing down drill member %s: %w", out.SiteID, err)
		}
		tornDown = append(tornDown, out.SiteID)
	}

	now := e.now()
	step := &model.FailoverStep{
		RunID:  run.ID,
		Step:   stepDrillTeardown,
		Status: model.StepStatusPassed,
		Detail: map[string]any{
			"mode":            run.Mode,
			"network_profile": profile,
			"torn_down":       tornDown,
		},
		FinishedAt: &now,
	}
	return e.runner.RunSystemTx(ctx, func(tx repository.DBTX) error {
		return e.repo.UpsertFailoverStep(ctx, tx, step)
	})
}

// restoreContextFor assembles the per-member restore context, including a stable
// idempotency key (run + site + recovery point) so Ensure is deterministic.
func (e *RecoveryExecutor) restoreContextFor(run *model.FailoverRun, tenantID uuid.UUID, t *model.RecoveryTarget, stream *model.ReplicationStream, profile string, remap map[string]string, plaintext []byte, objectKey string) RestoreContext {
	endpoint := ""
	if t.RecoveryEndpoint != nil {
		endpoint = *t.RecoveryEndpoint
	}
	pointID := ""
	if run.RecoveryPointID != nil {
		pointID = *run.RecoveryPointID
	}
	return RestoreContext{
		IdempotencyKey:    fmt.Sprintf("%s|%s|%s", run.ID, t.SiteID, pointID),
		TenantID:          tenantID,
		GroupID:           run.GroupID,
		SiteID:            t.SiteID,
		StreamID:          stream.ID,
		RecoveryEndpoint:  endpoint,
		Plaintext:         plaintext,
		ObjectKey:         objectKey,
		Profile:           profile,
		PrimaryToRecovery: remap,
		Drill:             run.Mode == model.ModeDrill,
	}
}

// rollback tears down everything booted so far (real: discard partial recovery;
// drill: discard isolated env) and returns the causing error so the driver
// fails the gate -> ROLLED_BACK (§6.3). Teardown errors are recorded but do not
// mask the original cause.
func (e *RecoveryExecutor) rollback(ctx context.Context, run *model.FailoverRun, booted []struct {
	out BootOutcome
	rc  RestoreContext
}, cause error) error {
	// Tear down in reverse boot order. Skip members we only re-read on a
	// re-claim with no live external id (AlreadyBoot with empty external).
	for i := len(booted) - 1; i >= 0; i-- {
		b := booted[i]
		if b.out.ExternalID == "" {
			continue
		}
		if err := e.driver.Teardown(ctx, b.out.ExternalID, b.rc); err != nil {
			// Record but continue tearing down the rest.
			_ = e.recordBootStep(ctx, run.ID, stepBootPrefix+b.out.SiteID+".teardown_error", BootOutcome{
				SiteID:     b.out.SiteID,
				ExternalID: b.out.ExternalID,
				Detail:     err.Error(),
			})
		}
	}
	return cause
}

func (e *RecoveryExecutor) ensureInstantSession(ctx context.Context, run *model.FailoverRun, tenantID uuid.UUID, point *model.RecoveryPoint, prior *InstantSessionRef) (*InstantSessionRef, error) {
	if prior != nil && prior.SessionID != "" {
		return prior, nil
	}
	if e.instant == nil {
		return nil, nil
	}
	pointID, err := uuid.Parse(point.ID)
	if err != nil {
		return nil, fmt.Errorf("recovery executor: recovery point id %q is not a uuid: %w", point.ID, err)
	}
	var groupID *uuid.UUID
	if g, gerr := uuid.Parse(run.GroupID); gerr == nil {
		groupID = &g
	}
	sess, err := e.instant.StartSession(ctx, tenantID, pointID, groupID)
	if err != nil {
		return nil, fmt.Errorf("recovery executor: starting instant recovery session for point %s: %w", point.ID, err)
	}
	ref := InstantSessionRef{
		SessionID:       sess.ID.String(),
		RecoveryPointID: point.ID,
		OverlayLocation: sess.OverlayLocation,
		ChunkSize:       sess.ChunkSize,
		ChunksTotal:     sess.ChunksTotal,
	}
	if err := e.recordInstantSessionStep(ctx, run.ID, ref); err != nil {
		return nil, fmt.Errorf("recovery executor: recording instant session for run %s: %w", run.ID, err)
	}
	return &ref, nil
}

func (e *RecoveryExecutor) recordInstantSessionStep(ctx context.Context, runID string, ref InstantSessionRef) error {
	now := e.now()
	step := &model.FailoverStep{
		RunID:      runID,
		Step:       stepInstantSession,
		Status:     model.StepStatusPassed,
		Detail:     instantSessionRefToDetail(ref),
		FinishedAt: &now,
	}
	return e.runner.RunSystemTx(ctx, func(tx repository.DBTX) error {
		return e.repo.UpsertFailoverStep(ctx, tx, step)
	})
}

func (e *RecoveryExecutor) recordBootStep(ctx context.Context, runID, stepName string, out BootOutcome) error {
	detail, err := bootOutcomeToDetail(out)
	if err != nil {
		return err
	}
	now := e.now()
	step := &model.FailoverStep{
		RunID:      runID,
		Step:       stepName,
		Status:     model.StepStatusPassed,
		Detail:     detail,
		FinishedAt: &now,
	}
	return e.runner.RunSystemTx(ctx, func(tx repository.DBTX) error {
		return e.repo.UpsertFailoverStep(ctx, tx, step)
	})
}

func (e *RecoveryExecutor) recordSummaryStep(ctx context.Context, runID string, summary map[string]any) error {
	now := e.now()
	step := &model.FailoverStep{
		RunID:      runID,
		Step:       stepExecuteSummary,
		Status:     model.StepStatusPassed,
		Detail:     summary,
		FinishedAt: &now,
	}
	return e.runner.RunSystemTx(ctx, func(tx repository.DBTX) error {
		return e.repo.UpsertFailoverStep(ctx, tx, step)
	})
}

func applyInstantRefToContext(rc *RestoreContext, ref *InstantSessionRef) {
	if ref == nil {
		return
	}
	rc.InstantSessionID = ref.SessionID
	rc.InstantOverlayLocation = ref.OverlayLocation
	rc.InstantChunkSize = ref.ChunkSize
	rc.InstantChunksTotal = ref.ChunksTotal
}

func applyInstantRefToOutcome(out *BootOutcome, ref *InstantSessionRef) {
	if ref == nil {
		return
	}
	out.InstantSessionID = ref.SessionID
	out.InstantOverlayLocation = ref.OverlayLocation
	out.InstantChunkSize = ref.ChunkSize
	out.InstantChunksTotal = ref.ChunksTotal
}

func applyInstantOutcomeToContext(rc *RestoreContext, out BootOutcome) {
	rc.InstantSessionID = out.InstantSessionID
	rc.InstantOverlayLocation = out.InstantOverlayLocation
	rc.InstantChunkSize = out.InstantChunkSize
	rc.InstantChunksTotal = out.InstantChunksTotal
}

func instantRestoreHash(ref InstantSessionRef, streamID string) string {
	sum := sha256.Sum256([]byte(ref.SessionID + "|" + ref.RecoveryPointID + "|" + streamID + "|" + ref.OverlayLocation))
	return hex.EncodeToString(sum[:])
}

func instantSessionRefToDetail(ref InstantSessionRef) map[string]any {
	return map[string]any{
		"session_id":        ref.SessionID,
		"recovery_point_id": ref.RecoveryPointID,
		"overlay_location":  ref.OverlayLocation,
		"chunk_size":        ref.ChunkSize,
		"chunks_total":      ref.ChunksTotal,
	}
}

// networkProfileForMode maps a run mode to the network-mapping profile: a real
// failover uses production addressing; a drill uses the isolated profile so the
// rehearsal never touches production (§6.2).
func networkProfileForMode(mode string) string {
	if mode == model.ModeDrill {
		return model.NetworkProfileIsolated
	}
	return model.NetworkProfileProduction
}

// resolveRemap flattens the network mappings into a primary-CIDR -> recovery-CIDR
// lookup the driver applies when bringing a workload up.
func resolveRemap(mappings []*model.NetworkMapping) map[string]string {
	out := make(map[string]string, len(mappings))
	for _, m := range mappings {
		out[m.PrimaryCIDR] = m.RecoveryCIDR
	}
	return out
}

func bootOrderSummary(booted []struct {
	out BootOutcome
	rc  RestoreContext
}) []map[string]any {
	out := make([]map[string]any, 0, len(booted))
	for _, b := range booted {
		row := map[string]any{
			"site_id":        b.out.SiteID,
			"stream_id":      b.out.StreamID,
			"external_id":    b.out.ExternalID,
			"already_booted": b.out.AlreadyBoot,
		}
		if b.out.InstantSessionID != "" {
			row["instant_session_id"] = b.out.InstantSessionID
			row["instant_overlay_location"] = b.out.InstantOverlayLocation
		}
		out = append(out, row)
	}
	return out
}

// bootOutcomeToDetail renders a BootOutcome to the JSONB map persisted in
// failover_step.detail. The same shape is read back by decodeBootOutcome on a
// re-claim, so a crashed-and-resumed boot is recognised and not repeated.
func bootOutcomeToDetail(out BootOutcome) (map[string]any, error) {
	b, err := json.Marshal(out)
	if err != nil {
		return nil, fmt.Errorf("marshaling boot outcome: %w", err)
	}
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("unmarshaling boot outcome: %w", err)
	}
	return m, nil
}

func decodeBootOutcome(detail map[string]any) (BootOutcome, bool) {
	if detail == nil {
		return BootOutcome{}, false
	}
	b, err := json.Marshal(detail)
	if err != nil {
		return BootOutcome{}, false
	}
	var out BootOutcome
	if err := json.Unmarshal(b, &out); err != nil {
		return BootOutcome{}, false
	}
	if out.SiteID == "" {
		return BootOutcome{}, false
	}
	return out, true
}

func decodeInstantSessionRef(detail map[string]any) (InstantSessionRef, bool) {
	if detail == nil {
		return InstantSessionRef{}, false
	}
	b, err := json.Marshal(detail)
	if err != nil {
		return InstantSessionRef{}, false
	}
	var ref InstantSessionRef
	if err := json.Unmarshal(b, &ref); err != nil {
		return InstantSessionRef{}, false
	}
	if ref.SessionID == "" || ref.RecoveryPointID == "" {
		return InstantSessionRef{}, false
	}
	return ref, true
}
