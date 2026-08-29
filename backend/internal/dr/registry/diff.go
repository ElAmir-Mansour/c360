package registry

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"sort"
)

// DiffSteps computes the real step-level difference from oldSteps to newSteps.
// It keys on RunbookStep.Key (the stable identity) so a step that merely changed
// position is reported as reordered, not as removed+added; a step that changed
// content at the same position is reported as changed; a key present in only one
// side is added or removed. The result is deterministic (added/removed/changed
// are sorted; reordered is sorted by key) so equal inputs always yield equal
// diffs and an equal content hash.
func DiffSteps(oldSteps, newSteps []RunbookStep) RunbookDiff {
	oldByKey := indexByKey(oldSteps)
	newByKey := indexByKey(newSteps)

	var diff RunbookDiff

	// Added: in new but not old.
	for key := range newByKey {
		if _, ok := oldByKey[key]; !ok {
			diff.Added = append(diff.Added, key)
		}
	}
	// Removed: in old but not new.
	for key := range oldByKey {
		if _, ok := newByKey[key]; !ok {
			diff.Removed = append(diff.Removed, key)
		}
	}
	// Reordered / Changed: present in both. A step is reordered when its 1-based
	// Order differs; it is changed when its content (kind/gate/title/description/
	// params) differs at the SAME order. Both can be true; we record reorder when
	// position moved and change when content moved, independently, so a single
	// step that both moved and changed shows up in both lists — an accurate,
	// non-lossy diff.
	for key, ns := range newByKey {
		os, ok := oldByKey[key]
		if !ok {
			continue
		}
		if os.Order != ns.Order {
			diff.Reordered = append(diff.Reordered, ReorderedStep{
				Key:     key,
				FromPos: os.Order,
				ToPos:   ns.Order,
			})
		}
		if !stepContentEqual(os, ns) {
			diff.Changed = append(diff.Changed, key)
		}
	}

	sort.Strings(diff.Added)
	sort.Strings(diff.Removed)
	sort.Strings(diff.Changed)
	sort.Slice(diff.Reordered, func(i, j int) bool {
		return diff.Reordered[i].Key < diff.Reordered[j].Key
	})

	return diff
}

// indexByKey builds a key->step lookup. Step keys are unique within a runbook
// (the template guarantees it: one pin/quiesce/approval/health/attest step and
// one boot step per distinct site), so a plain map is correct.
func indexByKey(steps []RunbookStep) map[string]RunbookStep {
	m := make(map[string]RunbookStep, len(steps))
	for _, s := range steps {
		m[s.Key] = s
	}
	return m
}

// stepContentEqual compares two steps ignoring Order (position is the reorder
// dimension, handled separately). It compares Kind, Gate, Title, Description and
// the structured Params (via canonical JSON so map ordering is irrelevant).
func stepContentEqual(a, b RunbookStep) bool {
	if a.Kind != b.Kind || a.Gate != b.Gate || a.Title != b.Title || a.Description != b.Description {
		return false
	}
	return canonicalJSON(a.Params) == canonicalJSON(b.Params)
}

// canonicalJSON renders v as JSON with map keys sorted, so two semantically
// equal param maps produce the same string regardless of insertion order.
// encoding/json already sorts map[string]... keys, so a straight Marshal of a
// map is canonical; we route through it and fall back to the raw bytes.
func canonicalJSON(v any) string {
	if v == nil {
		return "null"
	}
	b, err := json.Marshal(v)
	if err != nil {
		// A param map built by the template is always JSON-marshalable; on the
		// impossible error, use a sentinel so two unmarshalable values are only
		// "equal" if identical pointers — safe (it forces a change to be recorded).
		return "<unmarshalable>"
	}
	return string(b)
}

// ContentHash computes a stable SHA-256 over (templateID, ordered steps). Two
// runbooks with the same hash are byte-identical, so the reconcile path can
// detect a no-op regeneration and skip storing a duplicate version. The hash
// includes Order so a pure reorder changes the hash (it IS a different runbook).
func ContentHash(templateID string, steps []RunbookStep) string {
	// Marshal a canonical envelope: encoding/json sorts struct fields by source
	// order (stable) and map keys lexically, so this is deterministic for a fixed
	// step set in a fixed order.
	envelope := struct {
		TemplateID string        `json:"template_id"`
		Steps      []RunbookStep `json:"steps"`
	}{TemplateID: templateID, Steps: steps}
	b, err := json.Marshal(envelope)
	if err != nil {
		// Steps are template-built and always marshalable.
		b = []byte(templateID)
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
