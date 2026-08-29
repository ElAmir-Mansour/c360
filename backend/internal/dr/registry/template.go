package registry

import (
	"fmt"
	"sort"
)

// TemplateID is the identifier of the standard recovery-runbook template this
// package ships. A template is a pure function (asset snapshot -> ordered
// steps); recording its ID on each version means a template change is itself a
// regeneration trigger and the version history stays auditable.
const TemplateID = "dr.standard.v1"

// Template materializes a structured, ordered recovery runbook from a real
// asset snapshot. This is the Cutover "template x asset data = self-maintaining
// runbook": the SAME template applied to DIFFERENT assets yields a different
// runbook, and applying it again after the assets change yields the next
// version. The materialized sequence mirrors the §6 gated failover FSM:
//
//  1. pin_recovery_point      (Gate 1) — pin the latest validated recovery point
//  2. quiesce                          — quiesce primary + confirm final sync
//  3. approval                (Gate 2) — human approval gate
//  4. boot_member[*]          (Gate 3) — boot each member in boot_order
//  5. health_gate                      — block until every member's probe is green
//  6. attest                  (Gate 4) — issue the NCA-ready attestation
type Template struct {
	id string
}

// NewTemplate constructs the standard template.
func NewTemplate() *Template { return &Template{id: TemplateID} }

// ID returns the template identifier recorded on each version.
func (t *Template) ID() string { return t.id }

// Materialize applies the template to the asset snapshot, returning the ordered
// runbook steps bound to the snapshot's real values. It returns ErrNoAssets
// when the group has no members (an empty runbook would be misleading). The
// returned steps carry stable Keys so the diff can track identity across
// regenerations even as ordering shifts.
func (t *Template) Materialize(snap AssetSnapshot) ([]RunbookStep, error) {
	if len(snap.Members) == 0 {
		return nil, ErrNoAssets
	}

	// Order members by boot_order, then by site_id for a deterministic tie-break,
	// so two snapshots with the same members always materialize identically.
	members := make([]MemberAsset, len(snap.Members))
	copy(members, snap.Members)
	sort.SliceStable(members, func(i, j int) bool {
		if members[i].BootOrder != members[j].BootOrder {
			return members[i].BootOrder < members[j].BootOrder
		}
		return members[i].SiteID < members[j].SiteID
	})

	steps := make([]RunbookStep, 0, len(members)+5)
	order := 0
	next := func() int { order++; return order }

	// Step 1 — Gate 1: pin the latest validated recovery point.
	rpStep := RunbookStep{
		Key:   "pin_recovery_point",
		Order: next(),
		Kind:  StepKindPinRecoveryPoint,
		Gate:  "gate1",
		Title: "Pin latest validated recovery point",
	}
	if snap.RecoveryPoint != nil {
		rp := snap.RecoveryPoint
		rpStep.Description = fmt.Sprintf(
			"Pin recovery point %s at marker LSN %s (achieved RPO %ds, validation %.4f) as the consistent restore source for group %q. RPO objective is %ds.",
			rp.ID, rp.MarkerLSN, rp.RPOSeconds, rp.ValidationRatio, snap.GroupName, snap.RPOObjectiveSeconds,
		)
		rpStep.Params = map[string]any{
			"recovery_point_id":     rp.ID,
			"marker_lsn":            rp.MarkerLSN,
			"rpo_seconds":           rp.RPOSeconds,
			"validation_ratio":      rp.ValidationRatio,
			"is_validated":          rp.IsValidated,
			"legal_hold":            rp.LegalHold,
			"rpo_objective_seconds": snap.RPOObjectiveSeconds,
		}
	} else {
		// No validated recovery point yet: the runbook still records the gate so a
		// reader sees the precondition, but flags that Gate 1 cannot pass until a
		// validated point exists. This is real state, not a fabricated success.
		rpStep.Description = fmt.Sprintf(
			"No validated recovery point exists for group %q yet. Gate 1 cannot pass until replication produces and validates a recovery point meeting RPO objective %ds.",
			snap.GroupName, snap.RPOObjectiveSeconds,
		)
		rpStep.Params = map[string]any{
			"recovery_point_id":     nil,
			"rpo_objective_seconds": snap.RPOObjectiveSeconds,
			"blocked":               true,
		}
	}
	steps = append(steps, rpStep)

	// Step 2 — quiesce the primary and confirm the final sync.
	steps = append(steps, RunbookStep{
		Key:         "quiesce",
		Order:       next(),
		Kind:        StepKindQuiesce,
		Gate:        "",
		Title:       "Quiesce primary and confirm final sync",
		Description: fmt.Sprintf("Quiesce the primary site for group %q and confirm the final replication sync so the pinned recovery point reflects the last committed state.", snap.GroupName),
		Params: map[string]any{
			"group_id": snap.GroupID,
		},
	})

	// Step 3 — Gate 2: human approval.
	steps = append(steps, RunbookStep{
		Key:         "approval",
		Order:       next(),
		Kind:        StepKindApproval,
		Gate:        "gate2",
		Title:       "Obtain human failover approval",
		Description: fmt.Sprintf("Require an operator with dr:failover to approve the recovery of group %q before any workload boots (Gate 2).", snap.GroupName),
		Params: map[string]any{
			"required_permission": "dr:failover",
		},
	})

	// Step 4 — Gate 3: boot each member in boot order with its network profile.
	for _, m := range members {
		desc := fmt.Sprintf(
			"Boot member %q (%s, %s) at the recovery site using network profile %q.",
			m.SiteName, m.SiteKind, m.PrimaryEndpoint, m.NetworkProfile,
		)
		if m.PrimaryCIDR != "" || m.RecoveryCIDR != "" {
			desc += fmt.Sprintf(" Remap %s -> %s.", m.PrimaryCIDR, m.RecoveryCIDR)
		}
		steps = append(steps, RunbookStep{
			Key:         "boot_member:" + m.SiteID,
			Order:       next(),
			Kind:        StepKindBootMember,
			Gate:        "gate3",
			Title:       fmt.Sprintf("Boot %s (order %d)", m.SiteName, m.BootOrder),
			Description: desc,
			Params: map[string]any{
				"site_id":          m.SiteID,
				"site_name":        m.SiteName,
				"site_kind":        m.SiteKind,
				"primary_endpoint": m.PrimaryEndpoint,
				"boot_order":       m.BootOrder,
				"network_profile":  m.NetworkProfile,
				"primary_cidr":     m.PrimaryCIDR,
				"recovery_cidr":    m.RecoveryCIDR,
			},
		})
	}

	// Step 5 — health gate: block until every member's workload probe is green.
	memberIDs := make([]string, 0, len(members))
	for _, m := range members {
		memberIDs = append(memberIDs, m.SiteID)
	}
	steps = append(steps, RunbookStep{
		Key:         "health_gate",
		Order:       next(),
		Kind:        StepKindHealthGate,
		Gate:        "",
		Title:       "Validate recovered workloads (health green)",
		Description: fmt.Sprintf("Block transition to attestation until every one of the %d member workloads in group %q reports its health probe green.", len(members), snap.GroupName),
		Params: map[string]any{
			"member_site_ids": memberIDs,
			"member_count":    len(members),
		},
	})

	// Step 6 — Gate 4: issue the attestation (RTO objective vs actual).
	steps = append(steps, RunbookStep{
		Key:         "attest",
		Order:       next(),
		Kind:        StepKindAttest,
		Gate:        "gate4",
		Title:       "Issue NCA-ready attestation",
		Description: fmt.Sprintf("Seal an immutable attestation for group %q recording RTO objective %ds versus the actual recovery time, achieved RPO, validation ratio, and the per-step timeline.", snap.GroupName, snap.RTOObjectiveSeconds),
		Params: map[string]any{
			"rto_objective_seconds": snap.RTOObjectiveSeconds,
			"rpo_objective_seconds": snap.RPOObjectiveSeconds,
		},
	})

	return steps, nil
}
