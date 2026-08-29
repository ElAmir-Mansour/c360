package storageoffload

import (
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDiffManifests(t *testing.T) {
	t.Parallel()
	parent := &Manifest{Entries: []ManifestEntry{
		{Path: "a.txt", Hash: "h-a", Size: 10},
		{Path: "b.txt", Hash: "h-b", Size: 20},
		{Path: "gone.txt", Hash: "h-gone", Size: 5},
	}}
	child := &Manifest{Entries: []ManifestEntry{
		{Path: "a.txt", Hash: "h-a", Size: 10},  // unchanged
		{Path: "b.txt", Hash: "h-b2", Size: 25}, // changed (hash differs)
		{Path: "c.txt", Hash: "h-c", Size: 7},   // new
	}}

	diff := DiffManifests(parent, child)

	if len(diff.Unchanged) != 1 || diff.Unchanged[0].Path != "a.txt" {
		t.Errorf("unchanged = %+v, want [a.txt]", diff.Unchanged)
	}
	changedPaths := pathsOf(diff.Changed)
	sort.Strings(changedPaths)
	if len(changedPaths) != 2 || changedPaths[0] != "b.txt" || changedPaths[1] != "c.txt" {
		t.Errorf("changed = %v, want [b.txt c.txt]", changedPaths)
	}
	if len(diff.Deleted) != 1 || diff.Deleted[0] != "gone.txt" {
		t.Errorf("deleted = %v, want [gone.txt]", diff.Deleted)
	}
	// Delta bytes = changed (25) + new (7) = 32.
	if diff.Bytes != 32 {
		t.Errorf("delta bytes = %d, want 32", diff.Bytes)
	}
}

func TestDiffManifests_EmptyParentMeansAllNew(t *testing.T) {
	t.Parallel()
	parent := &Manifest{}
	child := &Manifest{Entries: []ManifestEntry{
		{Path: "x", Hash: "hx", Size: 3},
		{Path: "y", Hash: "hy", Size: 4},
	}}
	diff := DiffManifests(parent, child)
	if len(diff.Changed) != 2 || len(diff.Unchanged) != 0 || len(diff.Deleted) != 0 {
		t.Fatalf("diff = %+v, want all changed", diff)
	}
	if diff.Bytes != 7 {
		t.Errorf("delta bytes = %d, want 7", diff.Bytes)
	}
}

func TestManifest_TotalSize(t *testing.T) {
	t.Parallel()
	m := &Manifest{Entries: []ManifestEntry{{Size: 100}, {Size: 23}, {Size: 0}}}
	if got := m.TotalSize(); got != 123 {
		t.Errorf("TotalSize = %d, want 123", got)
	}
}

func TestVolume_Policy(t *testing.T) {
	t.Parallel()
	v := &Volume{RetentionMaxSnapshots: 5, RetentionMaxAgeSeconds: 3600}
	p := v.Policy()
	if p.MaxSnapshots != 5 {
		t.Errorf("MaxSnapshots = %d, want 5", p.MaxSnapshots)
	}
	if p.MaxAge != time.Hour {
		t.Errorf("MaxAge = %v, want 1h", p.MaxAge)
	}
}

func TestIsTerminal(t *testing.T) {
	t.Parallel()
	cases := map[string]bool{
		StatePending:     false,
		StateCreating:    false,
		StateReady:       false,
		StateReplicating: false,
		StateReplicated:  false,
		StateExpired:     true,
		StateFailed:      true,
	}
	for state, want := range cases {
		if got := IsTerminal(state); got != want {
			t.Errorf("IsTerminal(%q) = %v, want %v", state, got, want)
		}
	}
}

func TestRetentionCandidates_KeepsNewestAndReferencedParents(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	svc := &Service{now: func() time.Time { return now }}

	mk := func(ageMinutes int, state string) *Snapshot {
		return &Snapshot{
			ID:        uuid.New(),
			State:     state,
			CreatedAt: now.Add(-time.Duration(ageMinutes) * time.Minute),
		}
	}
	// Newest -> oldest as ListSnapshotsByVolumeSystem returns them.
	snaps := []*Snapshot{
		mk(1, StateReplicated), // newest
		mk(10, StateReady),
		mk(20, StateReplicated),
		mk(120, StateReady), // old
		mk(5, StateExpired), // terminal: never a candidate
	}

	// Keep newest 2; the 3rd and 4th live snapshots are candidates.
	cands := svc.retentionCandidates(snaps, RetentionPolicy{MaxSnapshots: 2})
	if len(cands) != 2 {
		t.Fatalf("count-based candidates = %d, want 2", len(cands))
	}

	// Age-based: anything older than 30m is a candidate (only the 120m one).
	ageCands := svc.retentionCandidates(snaps, RetentionPolicy{MaxAge: 30 * time.Minute})
	if len(ageCands) != 1 {
		t.Fatalf("age-based candidates = %d, want 1", len(ageCands))
	}
	if ageCands[0].CreatedAt != now.Add(-120*time.Minute) {
		t.Errorf("age candidate = %v, want the 120m-old one", ageCands[0].CreatedAt)
	}

	// Unlimited (0,0) policy expires nothing.
	if got := svc.retentionCandidates(snaps, RetentionPolicy{}); len(got) != 0 {
		t.Errorf("unlimited policy candidates = %d, want 0", len(got))
	}
}

func pathsOf(entries []ManifestEntry) []string {
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Path)
	}
	return out
}
