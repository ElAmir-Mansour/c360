package registry

import (
	"reflect"
	"testing"
)

func TestDiffSteps_AddedRemovedReordered(t *testing.T) {
	tests := []struct {
		name string
		old  []RunbookStep
		new  []RunbookStep
		want RunbookDiff
	}{
		{
			name: "identical steps yield empty diff",
			old: []RunbookStep{
				{Key: "a", Order: 1, Title: "A"},
				{Key: "b", Order: 2, Title: "B"},
			},
			new: []RunbookStep{
				{Key: "a", Order: 1, Title: "A"},
				{Key: "b", Order: 2, Title: "B"},
			},
			want: RunbookDiff{},
		},
		{
			name: "added a step",
			old: []RunbookStep{
				{Key: "a", Order: 1},
			},
			new: []RunbookStep{
				{Key: "a", Order: 1},
				{Key: "b", Order: 2},
			},
			want: RunbookDiff{Added: []string{"b"}},
		},
		{
			name: "removed a step",
			old: []RunbookStep{
				{Key: "a", Order: 1},
				{Key: "b", Order: 2},
			},
			new: []RunbookStep{
				{Key: "a", Order: 1},
			},
			want: RunbookDiff{Removed: []string{"b"}},
		},
		{
			name: "reordered two steps (same keys, swapped positions)",
			old: []RunbookStep{
				{Key: "a", Order: 1},
				{Key: "b", Order: 2},
			},
			new: []RunbookStep{
				{Key: "b", Order: 1},
				{Key: "a", Order: 2},
			},
			want: RunbookDiff{Reordered: []ReorderedStep{
				{Key: "a", FromPos: 1, ToPos: 2},
				{Key: "b", FromPos: 2, ToPos: 1},
			}},
		},
		{
			name: "content changed at same position",
			old: []RunbookStep{
				{Key: "a", Order: 1, Title: "old"},
			},
			new: []RunbookStep{
				{Key: "a", Order: 1, Title: "new"},
			},
			want: RunbookDiff{Changed: []string{"a"}},
		},
		{
			name: "param change at same position is a content change",
			old: []RunbookStep{
				{Key: "a", Order: 1, Params: map[string]any{"x": 1}},
			},
			new: []RunbookStep{
				{Key: "a", Order: 1, Params: map[string]any{"x": 2}},
			},
			want: RunbookDiff{Changed: []string{"a"}},
		},
		{
			name: "added one, removed one, reordered one",
			old: []RunbookStep{
				{Key: "a", Order: 1},
				{Key: "b", Order: 2},
				{Key: "c", Order: 3},
			},
			new: []RunbookStep{
				{Key: "c", Order: 1},
				{Key: "a", Order: 2},
				{Key: "d", Order: 3},
			},
			want: RunbookDiff{
				Added:   []string{"d"},
				Removed: []string{"b"},
				Reordered: []ReorderedStep{
					{Key: "a", FromPos: 1, ToPos: 2},
					{Key: "c", FromPos: 3, ToPos: 1},
				},
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := DiffSteps(tc.old, tc.new)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("DiffSteps mismatch:\n got = %+v\nwant = %+v", got, tc.want)
			}
			if tc.want.IsEmpty() != got.IsEmpty() {
				t.Errorf("IsEmpty mismatch: got %v want %v", got.IsEmpty(), tc.want.IsEmpty())
			}
		})
	}
}

func TestContentHash_StableAndOrderSensitive(t *testing.T) {
	a := []RunbookStep{{Key: "x", Order: 1, Title: "X"}, {Key: "y", Order: 2, Title: "Y"}}
	b := []RunbookStep{{Key: "x", Order: 1, Title: "X"}, {Key: "y", Order: 2, Title: "Y"}}
	if ContentHash(TemplateID, a) != ContentHash(TemplateID, b) {
		t.Error("identical step sets must hash equal")
	}

	// A pure reorder must change the hash — it IS a different runbook.
	reordered := []RunbookStep{{Key: "y", Order: 1, Title: "Y"}, {Key: "x", Order: 2, Title: "X"}}
	if ContentHash(TemplateID, a) == ContentHash(TemplateID, reordered) {
		t.Error("reordered steps must hash differently")
	}

	// A different template ID changes the hash.
	if ContentHash("other.template", a) == ContentHash(TemplateID, a) {
		t.Error("different template id must hash differently")
	}
}

func TestContentHash_ParamOrderInsensitive(t *testing.T) {
	// Two param maps with the same content but different insertion order must hash
	// the same (encoding/json sorts map keys), so a re-materialization with a
	// differently-ordered map is not a spurious change.
	a := []RunbookStep{{Key: "x", Order: 1, Params: map[string]any{"a": 1, "b": 2}}}
	b := []RunbookStep{{Key: "x", Order: 1, Params: map[string]any{"b": 2, "a": 1}}}
	if ContentHash(TemplateID, a) != ContentHash(TemplateID, b) {
		t.Error("param map key order must not affect the content hash")
	}
}
