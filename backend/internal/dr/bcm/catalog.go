// Package bcm implements ClarioDR Business-Continuity-Management (BCM)
// compliance packs (ClarioDR capability #18). A pack is a recognised
// continuity/DR standard (ISO 22301, ISO/IEC 27031, NCA ECC business-continuity
// domain, SAMA BCM) decomposed into discrete controls. Each control names the
// evidence it requires and a deterministic satisfaction rule (e.g. "a successful
// DR drill within the last 90 days achieving RTO <= target"). The package
// collects REAL platform DR data through narrow source interfaces (drill results,
// RTO/RPO attestations, validated recovery points, failover runs, clean-room
// verdicts), scores every control satisfied/partial/failed against its rule,
// computes a pack compliance score and a gap analysis, and persists an
// auditor-ready assessment.
//
// This file owns the static catalog: the pack/control model, the rule grammar,
// and at least two fully-specified real packs. The catalog is deterministic data
// — there is no hidden state — so a pack's controls are byte-stable across runs
// and an assessment is reproducible from the same evidence.
package bcm

import (
	"fmt"
	"sort"
	"time"
)

// RuleKind enumerates the deterministic satisfaction rules a control can carry.
// Each kind is evaluated by the scorer (scorer.go) against the collected
// evidence; the mapping kind -> evaluation is exhaustive and total, so an
// unknown kind is a programming error caught by the catalog validator, never a
// vacuous pass.
type RuleKind string

const (
	// RuleDrillRecency: at least MinCount successful drills (or real failovers,
	// per Scope) for the group within WindowDays days, the most recent achieving
	// RTO <= objective. Satisfied when a fresh, passing, RTO-meeting drill exists;
	// partial when a passing drill exists but is stale OR missed RTO; failed when
	// no passing drill exists in scope.
	RuleDrillRecency RuleKind = "drill_recency"

	// RuleRTOMet: the most recent completed failover/drill for the group achieved
	// RTO actual <= RTO objective. Satisfied when met; partial when actual is
	// within the PartialTolerance multiple of objective; failed otherwise or when
	// no completed run exists.
	RuleRTOMet RuleKind = "rto_met"

	// RuleRPOMet: the freshest validated recovery point's achieved RPO seconds
	// <= the configured RPO objective. Satisfied/partial/failed mirror RuleRTOMet.
	RuleRPOMet RuleKind = "rpo_met"

	// RuleRecoveryPointValidated: a validated recovery point exists for the group
	// with a validation ratio >= MinRatio and sealed within WindowDays. Satisfied
	// when validated and fresh; partial when validated but stale or below ratio;
	// failed when no validated recovery point exists.
	RuleRecoveryPointValidated RuleKind = "recovery_point_validated"

	// RuleImmutabilityEnabled: every recovery point retained for the group is
	// immutable (WORM / object-lock with a retention horizon in the future).
	// Satisfied when all are immutable; partial when some are; failed when none
	// are (or no recovery points exist).
	RuleImmutabilityEnabled RuleKind = "immutability_enabled"

	// RuleCleanRoomVerified: a clean-room scan of a recovery point returned a
	// clean verdict within WindowDays (ransomware-safe recovery evidence).
	// Satisfied when a fresh clean verdict exists; partial when the only clean
	// verdict is stale; failed when the latest verdict is not clean or none exist.
	RuleCleanRoomVerified RuleKind = "clean_room_verified"

	// RuleAttestationIssued: an immutable attestation was issued for a failover/
	// drill of the group within WindowDays ("reports generated, not
	// reconstructed"). Satisfied when fresh; partial when only a stale one exists;
	// failed when none exist.
	RuleAttestationIssued RuleKind = "attestation_issued"

	// RuleGroupConfigured: the consistency group has at least MinCount member
	// sites and a replication stream — the structural precondition for the rest.
	// Satisfied when configured; partial when a group exists but is under-membered;
	// failed when no group/members are present.
	RuleGroupConfigured RuleKind = "group_configured"
)

// EvidenceKind enumerates the categories of real platform evidence a control can
// require. The collector populates each kind from its source; the scorer reads
// only the kinds a control's rule references. Naming the required kinds on the
// control makes the gap analysis precise ("control X needs drill evidence, none
// found").
type EvidenceKind string

const (
	EvidenceDrill         EvidenceKind = "drill"
	EvidenceAttestation   EvidenceKind = "attestation"
	EvidenceRecoveryPoint EvidenceKind = "recovery_point"
	EvidenceFailover      EvidenceKind = "failover"
	EvidenceCleanRoom     EvidenceKind = "clean_room"
	EvidenceGroupTopology EvidenceKind = "group_topology"
)

// Rule is a control's fully-parameterised, deterministic satisfaction rule. All
// thresholds are explicit so evaluation never depends on ambient defaults. A
// zero value is invalid; the catalog validator rejects it.
type Rule struct {
	Kind RuleKind `json:"kind"`

	// WindowDays is the recency horizon (days) for time-windowed rules. The
	// scorer compares evidence timestamps against an injected clock, so tests are
	// deterministic. 0 means "no recency requirement".
	WindowDays int `json:"window_days,omitempty"`

	// MinCount is the minimum number of qualifying evidence items (drills,
	// members). Defaults to 1 for count-style rules when 0.
	MinCount int `json:"min_count,omitempty"`

	// RTOObjectiveSeconds / RPOObjectiveSeconds are the targets a run/recovery
	// point must meet. 0 means "use the value carried on the evidence itself"
	// (each failover/recovery point records its own objective); a non-zero value
	// overrides that with a stricter pack-level target.
	RTOObjectiveSeconds int `json:"rto_objective_seconds,omitempty"`
	RPOObjectiveSeconds int `json:"rpo_objective_seconds,omitempty"`

	// MinRatio is the minimum validation match ratio (0..1) for the validated-
	// recovery-point rule. Defaults to 0.999 when 0.
	MinRatio float64 `json:"min_ratio,omitempty"`

	// PartialTolerance lets a near-miss score "partial" instead of "failed":
	// actual <= objective * PartialTolerance scores partial. Must be >= 1 when
	// set; defaults to 1.25 for RTO/RPO rules when 0.
	PartialTolerance float64 `json:"partial_tolerance,omitempty"`
}

// effectiveMinCount returns MinCount with the count-style default applied.
func (r Rule) effectiveMinCount() int {
	if r.MinCount <= 0 {
		return 1
	}
	return r.MinCount
}

// effectiveMinRatio returns MinRatio with the validated-recovery-point default.
func (r Rule) effectiveMinRatio() float64 {
	if r.MinRatio <= 0 {
		return 0.999
	}
	return r.MinRatio
}

// effectivePartialTolerance returns PartialTolerance with the near-miss default.
func (r Rule) effectivePartialTolerance() float64 {
	if r.PartialTolerance < 1 {
		return 1.25
	}
	return r.PartialTolerance
}

// withinWindow reports whether ts falls within WindowDays before now. A zero
// WindowDays means no recency requirement (any non-zero ts qualifies).
func (r Rule) withinWindow(ts, now time.Time) bool {
	if ts.IsZero() {
		return false
	}
	if r.WindowDays <= 0 {
		return true
	}
	cutoff := now.AddDate(0, 0, -r.WindowDays)
	return !ts.Before(cutoff)
}

// Control is one auditable requirement within a pack. Code is the standard's
// clause/identifier (e.g. "BC-3", "ISO22301-8.4.4"); Title/Description are the
// human-facing text an auditor reads; RequiredEvidence names what the collector
// must supply; Rule is the deterministic verdict logic; Weight biases the pack
// score toward business-critical controls; Mandatory marks a control whose
// failure fails the whole pack regardless of score.
type Control struct {
	Code             string         `json:"code"`
	Title            string         `json:"title"`
	Description      string         `json:"description"`
	RequiredEvidence []EvidenceKind `json:"required_evidence"`
	Rule             Rule           `json:"rule"`
	Weight           int            `json:"weight"`
	Mandatory        bool           `json:"mandatory"`
}

// effectiveWeight returns Weight defaulting to 1 so an un-weighted control still
// contributes to the score.
func (c Control) effectiveWeight() int {
	if c.Weight <= 0 {
		return 1
	}
	return c.Weight
}

// Pack is a standard rendered as a set of controls. Key is the stable URL/API
// identifier ("iso22301", "nca-sama-bcm"); Standard/Version/Authority are the
// citation metadata an auditor expects on the report.
type Pack struct {
	Key         string    `json:"key"`
	Standard    string    `json:"standard"`
	Version     string    `json:"version"`
	Authority   string    `json:"authority"`
	Title       string    `json:"title"`
	Description string    `json:"description"`
	Controls    []Control `json:"controls"`
}

// Control returns the control with the given code, or false if the pack has no
// such control.
func (p Pack) Control(code string) (Control, bool) {
	for _, c := range p.Controls {
		if c.Code == code {
			return c, true
		}
	}
	return Control{}, false
}

// totalWeight is the denominator for the pack score: the sum of every control's
// effective weight. Always >= len(Controls) since each weight defaults to 1.
func (p Pack) totalWeight() int {
	sum := 0
	for _, c := range p.Controls {
		sum += c.effectiveWeight()
	}
	return sum
}

// Validate checks the pack is internally consistent: unique non-empty key,
// non-empty controls with unique codes, recognised rule kinds with sane
// thresholds, and at least one named evidence kind per control. Catalog() runs
// this at init so a malformed seeded pack fails fast rather than scoring wrong.
func (p Pack) Validate() error {
	if p.Key == "" {
		return fmt.Errorf("pack key is empty")
	}
	if p.Standard == "" {
		return fmt.Errorf("pack %s: standard is empty", p.Key)
	}
	if len(p.Controls) == 0 {
		return fmt.Errorf("pack %s: has no controls", p.Key)
	}
	seen := make(map[string]struct{}, len(p.Controls))
	for _, c := range p.Controls {
		if c.Code == "" {
			return fmt.Errorf("pack %s: control with empty code", p.Key)
		}
		if _, dup := seen[c.Code]; dup {
			return fmt.Errorf("pack %s: duplicate control code %q", p.Key, c.Code)
		}
		seen[c.Code] = struct{}{}
		if c.Title == "" {
			return fmt.Errorf("pack %s control %s: empty title", p.Key, c.Code)
		}
		if len(c.RequiredEvidence) == 0 {
			return fmt.Errorf("pack %s control %s: no required evidence", p.Key, c.Code)
		}
		if !knownRuleKind(c.Rule.Kind) {
			return fmt.Errorf("pack %s control %s: unknown rule kind %q", p.Key, c.Code, c.Rule.Kind)
		}
		if c.Rule.WindowDays < 0 {
			return fmt.Errorf("pack %s control %s: negative window", p.Key, c.Code)
		}
		if c.Rule.PartialTolerance != 0 && c.Rule.PartialTolerance < 1 {
			return fmt.Errorf("pack %s control %s: partial tolerance must be >= 1", p.Key, c.Code)
		}
		if c.Rule.MinRatio < 0 || c.Rule.MinRatio > 1 {
			return fmt.Errorf("pack %s control %s: min ratio out of range", p.Key, c.Code)
		}
	}
	return nil
}

func knownRuleKind(k RuleKind) bool {
	switch k {
	case RuleDrillRecency, RuleRTOMet, RuleRPOMet, RuleRecoveryPointValidated,
		RuleImmutabilityEnabled, RuleCleanRoomVerified, RuleAttestationIssued,
		RuleGroupConfigured:
		return true
	default:
		return false
	}
}

// catalog is the in-memory registry of seeded packs, keyed by Pack.Key. It is
// built once by buildCatalog and never mutated, so reads are race-free without a
// lock.
var catalog map[string]Pack

func init() {
	c, err := buildCatalog()
	if err != nil {
		// A malformed seeded pack is a build-time programming error; failing here
		// (process start) is correct and never reached in a valid binary.
		panic(fmt.Sprintf("bcm: invalid built-in catalog: %v", err))
	}
	catalog = c
}

// buildCatalog assembles and validates the built-in packs. Kept separate from
// init so tests can exercise validation directly.
func buildCatalog() (map[string]Pack, error) {
	packs := []Pack{iso22301Pack(), ncaSamaBCMPack()}
	out := make(map[string]Pack, len(packs))
	for _, p := range packs {
		if err := p.Validate(); err != nil {
			return nil, err
		}
		if _, dup := out[p.Key]; dup {
			return nil, fmt.Errorf("duplicate pack key %q", p.Key)
		}
		out[p.Key] = p
	}
	return out, nil
}

// Packs returns the catalog packs sorted by key (deterministic listing for the
// GET /bcm/packs endpoint).
func Packs() []Pack {
	out := make([]Pack, 0, len(catalog))
	for _, p := range catalog {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}

// PackByKey returns the pack for key and whether it exists.
func PackByKey(key string) (Pack, bool) {
	p, ok := catalog[key]
	return p, ok
}

// iso22301Pack is the ISO 22301:2019 business-continuity essentials rendered as
// ClarioDR-verifiable controls. The clause codes track the standard so an
// auditor can cross-reference; the rules bind each clause to real DR telemetry.
func iso22301Pack() Pack {
	return Pack{
		Key:       "iso22301",
		Standard:  "ISO 22301:2019",
		Version:   "2019",
		Authority: "ISO/TC 292",
		Title:     "ISO 22301 Business Continuity Management — DR-verifiable essentials",
		Description: "Maps ClarioDR controls to ISO 22301:2019 clause 8 (operation) and clause 9 " +
			"(performance evaluation): recovery objectives are met and exercised, recovery media " +
			"are protected and validated, and exercises are evidenced.",
		Controls: []Control{
			{
				Code:             "ISO22301-8.4.2",
				Title:            "Recovery structure: protected estate is grouped for coordinated recovery",
				Description:      "Clause 8.4.2 requires a documented recovery structure. ClarioDR evidences this with a configured consistency group of member sites with a replication stream.",
				RequiredEvidence: []EvidenceKind{EvidenceGroupTopology},
				Rule:             Rule{Kind: RuleGroupConfigured, MinCount: 1},
				Weight:           1,
				Mandatory:        true,
			},
			{
				Code:             "ISO22301-8.4.4",
				Title:            "Recovery time objective is achieved",
				Description:      "Clause 8.4.4 requires recovery within agreed timeframes. Evidenced by the most recent completed failover/drill achieving RTO actual <= objective.",
				RequiredEvidence: []EvidenceKind{EvidenceFailover},
				Rule:             Rule{Kind: RuleRTOMet, PartialTolerance: 1.25},
				Weight:           3,
				Mandatory:        true,
			},
			{
				Code:             "ISO22301-8.4.4-RPO",
				Title:            "Recovery point objective (acceptable data loss) is achieved",
				Description:      "Clause 8.4.4 also bounds acceptable loss. Evidenced by the freshest validated recovery point's achieved RPO <= objective.",
				RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint},
				Rule:             Rule{Kind: RuleRPOMet, PartialTolerance: 1.25},
				Weight:           2,
			},
			{
				Code:             "ISO22301-8.4.5",
				Title:            "Recovery media are validated for usability",
				Description:      "Clause 8.4.5 requires recovery information be usable. Evidenced by a validated recovery point (match ratio >= 99.9%) sealed within 30 days.",
				RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint},
				Rule:             Rule{Kind: RuleRecoveryPointValidated, WindowDays: 30, MinRatio: 0.999},
				Weight:           2,
				Mandatory:        true,
			},
			{
				Code:             "ISO22301-8.4.5-IMMUT",
				Title:            "Recovery media are protected against alteration",
				Description:      "Clause 8.4.5 requires protection of continuity information. Evidenced by recovery points held under WORM immutability with a future retention horizon.",
				RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint},
				Rule:             Rule{Kind: RuleImmutabilityEnabled},
				Weight:           2,
			},
			{
				Code:             "ISO22301-8.5",
				Title:            "Exercising and testing programme is current",
				Description:      "Clause 8.5 requires periodic exercises. Evidenced by a successful DR drill within the last 90 days achieving its RTO target.",
				RequiredEvidence: []EvidenceKind{EvidenceDrill},
				Rule:             Rule{Kind: RuleDrillRecency, WindowDays: 90, MinCount: 1},
				Weight:           3,
				Mandatory:        true,
			},
			{
				Code:             "ISO22301-9.1",
				Title:            "Exercise results are evidenced (attestation issued)",
				Description:      "Clause 9.1 requires monitoring and evaluation results be retained. Evidenced by an immutable attestation issued for a failover/drill within 90 days.",
				RequiredEvidence: []EvidenceKind{EvidenceAttestation},
				Rule:             Rule{Kind: RuleAttestationIssued, WindowDays: 90},
				Weight:           1,
			},
		},
	}
}

// ncaSamaBCMPack is the sovereign-regulator pack: NCA ECC business-continuity
// domain plus SAMA BCM essentials, the moat for KSA-regulated customers. It
// reuses the same real DR telemetry but adds the ransomware-safe-recovery
// (clean-room) control the sovereign regulators emphasise and tightens the RPO
// objective.
func ncaSamaBCMPack() Pack {
	return Pack{
		Key:       "nca-sama-bcm",
		Standard:  "NCA ECC-1 BC domain + SAMA BCM Framework",
		Version:   "2024",
		Authority: "National Cybersecurity Authority (KSA) / Saudi Central Bank (SAMA)",
		Title:     "NCA ECC & SAMA Business Continuity essentials (sovereign)",
		Description: "Maps ClarioDR controls to the NCA Essential Cybersecurity Controls business-" +
			"continuity domain and the SAMA Business Continuity Management framework: tested recovery " +
			"to objective, immutable/ransomware-safe recovery, validated backups, and retained evidence.",
		Controls: []Control{
			{
				Code:             "BC-1",
				Title:            "Critical systems are grouped and continuously replicated",
				Description:      "NCA ECC BC requires identification of critical assets and a continuity capability. Evidenced by a configured consistency group with member sites and a live replication stream.",
				RequiredEvidence: []EvidenceKind{EvidenceGroupTopology},
				Rule:             Rule{Kind: RuleGroupConfigured, MinCount: 1},
				Weight:           1,
				Mandatory:        true,
			},
			{
				Code:             "BC-2",
				Title:            "Backups/recovery points are validated",
				Description:      "SAMA BCM requires verified backups. Evidenced by a validated recovery point (match ratio >= 99.9%) sealed within 30 days.",
				RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint},
				Rule:             Rule{Kind: RuleRecoveryPointValidated, WindowDays: 30, MinRatio: 0.999},
				Weight:           2,
				Mandatory:        true,
			},
			{
				Code:             "BC-3",
				Title:            "A successful DR drill within the last 90 days achieved its RTO target",
				Description:      "NCA ECC & SAMA require periodic, evidenced DR exercises. Evidenced by a passing drill within 90 days whose actual RTO met the objective.",
				RequiredEvidence: []EvidenceKind{EvidenceDrill},
				Rule:             Rule{Kind: RuleDrillRecency, WindowDays: 90, MinCount: 1},
				Weight:           3,
				Mandatory:        true,
			},
			{
				Code:             "BC-4",
				Title:            "Recovery point objective is met (sovereign target <= 5 min)",
				Description:      "SAMA bounds acceptable data loss. Evidenced by the freshest validated recovery point achieving RPO <= 300s.",
				RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint},
				Rule:             Rule{Kind: RuleRPOMet, RPOObjectiveSeconds: 300, PartialTolerance: 1.5},
				Weight:           2,
				Mandatory:        true,
			},
			{
				Code:             "BC-5",
				Title:            "Recovery media are immutable (ransomware-safe)",
				Description:      "NCA ECC requires protection against tampering/ransomware. Evidenced by recovery points held under WORM object-lock with a future retention horizon.",
				RequiredEvidence: []EvidenceKind{EvidenceRecoveryPoint},
				Rule:             Rule{Kind: RuleImmutabilityEnabled},
				Weight:           3,
				Mandatory:        true,
			},
			{
				Code:             "BC-6",
				Title:            "Recovery is clean-room verified (no malware in recovered estate)",
				Description:      "Sovereign regulators require assurance the recovered estate is clean. Evidenced by a clean-room scan returning a clean verdict within 90 days.",
				RequiredEvidence: []EvidenceKind{EvidenceCleanRoom},
				Rule:             Rule{Kind: RuleCleanRoomVerified, WindowDays: 90},
				Weight:           2,
			},
			{
				Code:             "BC-7",
				Title:            "DR exercises produce immutable, auditor-ready attestations",
				Description:      "NCA ECC & SAMA require retained evidence of testing. Evidenced by an immutable attestation issued within 90 days.",
				RequiredEvidence: []EvidenceKind{EvidenceAttestation},
				Rule:             Rule{Kind: RuleAttestationIssued, WindowDays: 90},
				Weight:           1,
			},
		},
	}
}
