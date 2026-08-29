package service

import (
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// defaultSubstantialRequirementDelta is the CAP-024 threshold for how many
// requirement items may change (be added, removed, or have their required-flag
// or kind altered) before an edit is treated as SUBSTANTIAL on requirement
// churn alone. Any added OR removed REQUIRED item is always substantial
// regardless of this count; this delta governs the "many small changes add up"
// rule. The integrator MAY surface this via env (LEX_EXECUTION_SUBSTANTIAL_
// REQUIREMENT_DELTA) and pass it through NewRequestChangeDetectorWithDelta.
const defaultSubstantialRequirementDelta = 3

// SubstantialEditReason is a stable machine code naming WHY an edit was judged
// substantial under CAP-024. It is emitted on the re-evaluation audit/event so
// downstream consumers (and humans) can see the trigger without re-deriving it.
type SubstantialEditReason string

const (
	SubstantialReasonServiceChanged     SubstantialEditReason = "service_changed"
	SubstantialReasonRequestTypeChanged SubstantialEditReason = "request_type_changed"
	SubstantialReasonPriorityChanged    SubstantialEditReason = "priority_tier_changed"
	SubstantialReasonScopeChanged       SubstantialEditReason = "scope_changed"
	SubstantialReasonRequiredItemAdded  SubstantialEditReason = "required_item_added"
	SubstantialReasonRequiredItemRemove SubstantialEditReason = "required_item_removed"
	SubstantialReasonRequirementChurn   SubstantialEditReason = "requirement_churn"
)

// ChangeDecision is the verdict of the CAP-024 substantial-edit detector. When
// Substantial is true the execution engine treats the edit as material — it
// flags the request for re-evaluation and (provider discretion) allows the
// execution clock / completeness gate to be reset. Reasons carries every rule
// that fired (a single edit can trip several), and Changes is the human/audit
// detail (which scope fields, which requirement codes) backing those reasons.
type ChangeDecision struct {
	Substantial bool                    `json:"substantial"`
	Reasons     []SubstantialEditReason `json:"reasons"`
	Changes     map[string]any          `json:"changes"`
}

// HasReason reports whether the given reason fired in this decision.
func (d ChangeDecision) HasReason(reason SubstantialEditReason) bool {
	for _, r := range d.Reasons {
		if r == reason {
			return true
		}
	}
	return false
}

// reasonStrings renders the reasons as plain strings for event/audit payloads
// (which carry map[string]any, not the typed enum).
func (d ChangeDecision) reasonStrings() []string {
	out := make([]string, 0, len(d.Reasons))
	for _, r := range d.Reasons {
		out = append(out, string(r))
	}
	return out
}

// ChangeDetector decides whether an edit to a legal_request (together with its
// requirement set) is SUBSTANTIAL under CAP-024. It owns no state beyond the
// churn threshold and reaches into no other package — it is a pure decision
// component the ExecutionRuleService consumes, mirroring the seam-style helpers
// elsewhere in this package. The "after" snapshot is compared field-by-field
// against the "before" snapshot; requirement sets are diffed by Code.
type ChangeDetector struct {
	requirementDelta int
}

// NewRequestChangeDetector builds a detector with the default churn threshold.
func NewRequestChangeDetector() *ChangeDetector {
	return NewRequestChangeDetectorWithDelta(defaultSubstantialRequirementDelta)
}

// NewRequestChangeDetectorWithDelta builds a detector with an explicit
// requirement-churn threshold. A non-positive delta falls back to the default
// so a misconfigured zero never disables the churn rule.
func NewRequestChangeDetectorWithDelta(requirementDelta int) *ChangeDetector {
	if requirementDelta <= 0 {
		requirementDelta = defaultSubstantialRequirementDelta
	}
	return &ChangeDetector{requirementDelta: requirementDelta}
}

// Detect compares the before/after request and their requirement sets and
// returns the CAP-024 verdict. before MUST be the pre-edit snapshot and after
// the post-edit snapshot of the SAME request; beforeReqs/afterReqs are the
// requirement items as they stood at each snapshot. A nil before or after is
// treated as a non-substantial no-op (defensive — callers always pass both).
func (d *ChangeDetector) Detect(
	before, after *model.LegalRequest,
	beforeReqs, afterReqs []model.RequirementItem,
) ChangeDecision {
	decision := ChangeDecision{Changes: map[string]any{}}
	if before == nil || after == nil {
		return decision
	}

	// Rule 1: service catalog reference changed. The service drives the entire
	// requirement template + routing, so any change is material.
	if !sameUUIDPtr(before.ServiceID, after.ServiceID) {
		decision.add(SubstantialReasonServiceChanged)
		decision.Changes["service_id"] = fieldChange(uuidPtrToString(before.ServiceID), uuidPtrToString(after.ServiceID))
	}

	// Rule 2: request type changed (the coarse domain classification).
	if strings.TrimSpace(before.RequestType) != strings.TrimSpace(after.RequestType) {
		decision.add(SubstantialReasonRequestTypeChanged)
		decision.Changes["request_type"] = fieldChange(before.RequestType, after.RequestType)
	}

	// Rule 3: priority TIER changed (urgent <-> normal). CAP-010/011 already
	// audit this; for execution it is material because it can re-target the SLA.
	if before.Priority != after.Priority {
		decision.add(SubstantialReasonPriorityChanged)
		decision.Changes["priority"] = fieldChange(string(before.Priority), string(after.Priority))
	}

	// Rule 4: material change to scope fields. Title (either locale),
	// beneficiary entity, and department define WHAT/WHO the work is for; a
	// change to any is a scope change. Description is intentionally excluded —
	// requesters routinely clarify wording without changing scope.
	if scope := scopeFieldChanges(before, after); len(scope) > 0 {
		decision.add(SubstantialReasonScopeChanged)
		decision.Changes["scope"] = scope
	}

	// Rule 5: requirement-set churn. Any added or removed REQUIRED item is
	// always substantial; otherwise a total change count over the configured
	// delta is substantial.
	d.evaluateRequirements(&decision, beforeReqs, afterReqs)

	decision.Substantial = len(decision.Reasons) > 0
	return decision
}

func (d *ChangeDetector) evaluateRequirements(decision *ChangeDecision, beforeReqs, afterReqs []model.RequirementItem) {
	beforeByCode := indexRequirementsByCode(beforeReqs)
	afterByCode := indexRequirementsByCode(afterReqs)

	var addedRequired, removedRequired, addedAny, removedAny, modified []string

	for code, after := range afterByCode {
		before, existed := beforeByCode[code]
		if !existed {
			addedAny = append(addedAny, code)
			if after.Required {
				addedRequired = append(addedRequired, code)
			}
			continue
		}
		if requirementMateriallyChanged(before, after) {
			modified = append(modified, code)
		}
	}
	for code, before := range beforeByCode {
		if _, stillThere := afterByCode[code]; !stillThere {
			removedAny = append(removedAny, code)
			if before.Required {
				removedRequired = append(removedRequired, code)
			}
		}
	}

	totalChanged := len(addedAny) + len(removedAny) + len(modified)
	churn := map[string]any{
		"added":         sortedCopy(addedAny),
		"removed":       sortedCopy(removedAny),
		"modified":      sortedCopy(modified),
		"total_changed": totalChanged,
		"delta":         d.requirementDelta,
	}
	churnRecorded := false
	recordChurn := func() {
		if !churnRecorded {
			decision.Changes["requirements"] = churn
			churnRecorded = true
		}
	}

	if len(addedRequired) > 0 {
		decision.add(SubstantialReasonRequiredItemAdded)
		churn["added_required"] = sortedCopy(addedRequired)
		recordChurn()
	}
	if len(removedRequired) > 0 {
		decision.add(SubstantialReasonRequiredItemRemove)
		churn["removed_required"] = sortedCopy(removedRequired)
		recordChurn()
	}
	if totalChanged > d.requirementDelta {
		decision.add(SubstantialReasonRequirementChurn)
		recordChurn()
	}
}

// requirementMateriallyChanged reports whether two snapshots of the SAME
// requirement code differ in a way that matters for completeness/scope: its
// required flag, its kind, or its required-ness becoming/ceasing to be a gate.
// A mere satisfied-flag flip (the requester supplying evidence) is NOT a
// material edit — that is the normal happy path, not a scope change.
func requirementMateriallyChanged(before, after model.RequirementItem) bool {
	if before.Required != after.Required {
		return true
	}
	if before.Kind != after.Kind {
		return true
	}
	return false
}

func scopeFieldChanges(before, after *model.LegalRequest) map[string]any {
	changes := map[string]any{}
	if before.Title != after.Title {
		changes["title"] = fieldChange(before.Title.Localize("en"), after.Title.Localize("en"))
	}
	if !sameUUIDPtr(before.BeneficiaryEntityID, after.BeneficiaryEntityID) {
		changes["beneficiary_entity_id"] = fieldChange(uuidPtrToString(before.BeneficiaryEntityID), uuidPtrToString(after.BeneficiaryEntityID))
	}
	if !sameStringPtr(before.Department, after.Department) {
		changes["department"] = fieldChange(stringPtrValue(before.Department), stringPtrValue(after.Department))
	}
	return changes
}

func indexRequirementsByCode(items []model.RequirementItem) map[string]model.RequirementItem {
	out := make(map[string]model.RequirementItem, len(items))
	for _, item := range items {
		out[item.Code] = item
	}
	return out
}

func (d *ChangeDecision) add(reason SubstantialEditReason) {
	if d.HasReason(reason) {
		return
	}
	d.Reasons = append(d.Reasons, reason)
}

func fieldChange(from, to string) map[string]any {
	return map[string]any{"from": from, "to": to}
}

func sortedCopy(in []string) []string {
	out := append([]string(nil), in...)
	sort.Strings(out)
	return out
}

func sameUUIDPtr(a, b *uuid.UUID) bool { return uuidPtrToString(a) == uuidPtrToString(b) }

func uuidPtrToString(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}

func sameStringPtr(a, b *string) bool {
	return stringPtrValue(a) == stringPtrValue(b)
}

func stringPtrValue(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}
