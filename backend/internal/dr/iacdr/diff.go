package iacdr

import (
	"fmt"
	"sort"
)

// ChangeType classifies a resource-level drift entry.
type ChangeType string

const (
	// ChangeAdded marks a resource present in the target but not the base.
	ChangeAdded ChangeType = "added"
	// ChangeRemoved marks a resource present in the base but not the target.
	ChangeRemoved ChangeType = "removed"
	// ChangeModified marks a resource present in both whose attributes differ.
	ChangeModified ChangeType = "modified"
)

// AttributeChange is one attribute-level difference within a modified resource.
// A pointer-free representation with explicit presence flags so a JSON consumer
// can tell "added an attribute" (HadOld=false) from "set it to null".
type AttributeChange struct {
	// Path is the dotted attribute path ("spec.replicas", "tags.env").
	Path string `json:"path"`
	// OldValue is the base snapshot's value; nil/absent when HadOld is false.
	OldValue any `json:"old_value,omitempty"`
	// NewValue is the target snapshot's value; nil/absent when HadNew is false.
	NewValue any `json:"new_value,omitempty"`
	// HadOld reports whether the attribute existed in the base snapshot.
	HadOld bool `json:"had_old"`
	// HadNew reports whether the attribute exists in the target snapshot.
	HadNew bool `json:"had_new"`
}

// ResourceDiff is the drift entry for one resource key.
type ResourceDiff struct {
	Key    ResourceKey `json:"key"`
	Change ChangeType  `json:"change"`
	// Address is the canonical address (target's when present, else base's).
	Address string `json:"address"`
	// OldHash / NewHash are the per-resource content hashes on each side.
	OldHash string `json:"old_hash,omitempty"`
	NewHash string `json:"new_hash,omitempty"`
	// Attributes lists the attribute-level changes for a modified resource. It is
	// empty for added/removed resources (the whole resource appeared/vanished).
	Attributes []AttributeChange `json:"attributes,omitempty"`
}

// DiffResult is the structured drift between two snapshots (a base and a target,
// or a snapshot vs a desired resource set). It is keyed on (provider,type,name).
type DiffResult struct {
	BaseSnapshotID   string         `json:"base_snapshot_id,omitempty"`
	TargetSnapshotID string         `json:"target_snapshot_id,omitempty"`
	Added            []ResourceDiff `json:"added"`
	Removed          []ResourceDiff `json:"removed"`
	Modified         []ResourceDiff `json:"modified"`
}

// HasDrift reports whether any resource was added, removed or modified.
func (d DiffResult) HasDrift() bool {
	return len(d.Added) > 0 || len(d.Removed) > 0 || len(d.Modified) > 0
}

// Summary returns the counts of each change type (for metrics / events).
func (d DiffResult) Summary() (added, removed, modified int) {
	return len(d.Added), len(d.Removed), len(d.Modified)
}

// DiffSnapshots computes the structured drift from base -> target, keyed on
// (provider,type,name). A resource only in target is ADDED; only in base is
// REMOVED; in both with a different per-resource hash is MODIFIED, with the exact
// attribute-level changes attached. This is REAL set + attribute diffing over
// the normalised resources — no I/O — so it is unit-tested directly with
// fixtures. Output lists are sorted by key for deterministic, stable diffs.
func DiffSnapshots(base, target []Resource) DiffResult {
	baseByKey := indexByKey(base)
	targetByKey := indexByKey(target)

	var res DiffResult

	// Walk target keys: ADDED (not in base) or MODIFIED (hash differs).
	for key, tRes := range targetByKey {
		bRes, ok := baseByKey[key]
		if !ok {
			res.Added = append(res.Added, ResourceDiff{
				Key:     key,
				Change:  ChangeAdded,
				Address: tRes.Address,
				NewHash: hashOf(tRes),
			})
			continue
		}
		if hashOf(bRes) != hashOf(tRes) {
			res.Modified = append(res.Modified, ResourceDiff{
				Key:        key,
				Change:     ChangeModified,
				Address:    tRes.Address,
				OldHash:    hashOf(bRes),
				NewHash:    hashOf(tRes),
				Attributes: diffAttributes(bRes.Attributes, tRes.Attributes),
			})
		}
	}

	// Walk base keys for REMOVED (not in target).
	for key, bRes := range baseByKey {
		if _, ok := targetByKey[key]; !ok {
			res.Removed = append(res.Removed, ResourceDiff{
				Key:     key,
				Change:  ChangeRemoved,
				Address: bRes.Address,
				OldHash: hashOf(bRes),
			})
		}
	}

	sortDiffs(res.Added)
	sortDiffs(res.Removed)
	sortDiffs(res.Modified)
	return res
}

// indexByKey builds a (provider,type,name) -> Resource index. On a duplicate key
// (which the snapshot UNIQUE constraint forbids in storage, but a desired-set
// caller might supply) the last one wins, matching apply semantics.
func indexByKey(resources []Resource) map[ResourceKey]Resource {
	out := make(map[ResourceKey]Resource, len(resources))
	for _, r := range resources {
		out[r.Key()] = r
	}
	return out
}

// hashOf returns a resource's content hash, computing it if absent so a
// caller-supplied desired set (with un-hashed resources) still diffs correctly.
func hashOf(r Resource) string {
	if r.Hash != "" {
		return r.Hash
	}
	return r.ComputeHash()
}

// diffAttributes computes the attribute-level changes between two normalised
// attribute maps, recursing into nested maps with a dotted path. Slices and
// scalars are compared whole (a changed element marks the slice path changed) so
// the diff stays readable; nested objects are descended for precise paths.
func diffAttributes(oldAttrs, newAttrs map[string]any) []AttributeChange {
	var changes []AttributeChange
	collectAttrChanges("", oldAttrs, newAttrs, &changes)
	sort.Slice(changes, func(i, j int) bool { return changes[i].Path < changes[j].Path })
	return changes
}

// collectAttrChanges recursively diffs two values at the given path prefix.
func collectAttrChanges(prefix string, oldVal, newVal any, out *[]AttributeChange) {
	oldMap, oldIsMap := oldVal.(map[string]any)
	newMap, newIsMap := newVal.(map[string]any)

	if oldIsMap && newIsMap {
		keys := unionKeys(oldMap, newMap)
		for _, k := range keys {
			ov, oHas := oldMap[k]
			nv, nHas := newMap[k]
			childPath := k
			if prefix != "" {
				childPath = prefix + "." + k
			}
			switch {
			case oHas && nHas:
				collectAttrChanges(childPath, ov, nv, out)
			case nHas: // added
				*out = append(*out, AttributeChange{Path: childPath, NewValue: nv, HadNew: true})
			default: // removed
				*out = append(*out, AttributeChange{Path: childPath, OldValue: ov, HadOld: true})
			}
		}
		return
	}

	// Leaf comparison (scalars, slices, or a map<->non-map shape change). Compare
	// by canonical JSON so equal-but-differently-ordered structures match.
	if canonicalJSON(oldVal) != canonicalJSON(newVal) {
		*out = append(*out, AttributeChange{
			Path:     prefix,
			OldValue: oldVal,
			NewValue: newVal,
			HadOld:   true,
			HadNew:   true,
		})
	}
}

// unionKeys returns the sorted union of two maps' keys for deterministic diffing.
func unionKeys(a, b map[string]any) []string {
	set := make(map[string]struct{}, len(a)+len(b))
	for k := range a {
		set[k] = struct{}{}
	}
	for k := range b {
		set[k] = struct{}{}
	}
	keys := make([]string, 0, len(set))
	for k := range set {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// sortDiffs orders a diff slice by resource key for stable output.
func sortDiffs(diffs []ResourceDiff) {
	sort.Slice(diffs, func(i, j int) bool {
		return diffs[i].Key.String() < diffs[j].Key.String()
	})
}

// String renders a compact human-facing summary line (used in events/logs).
func (d DiffResult) String() string {
	a, r, m := d.Summary()
	return fmt.Sprintf("+%d ~%d -%d", a, m, r)
}
