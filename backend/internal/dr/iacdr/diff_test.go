package iacdr

import "testing"

// mkRes builds a resource with computed hash for diff/plan tests.
func mkRes(provider, typ, name string, attrs map[string]any, deps ...string) Resource {
	if attrs == nil {
		attrs = map[string]any{}
	}
	r := Resource{
		Provider:   provider,
		Type:       typ,
		Name:       name,
		Address:    typ + "." + name,
		Attributes: attrs,
		DependsOn:  deps,
	}
	r.Hash = r.ComputeHash()
	return r
}

func TestDiffSnapshots_AddedRemovedModified(t *testing.T) {
	base := []Resource{
		mkRes("aws", "aws_vpc", "main", map[string]any{"cidr_block": "10.0.0.0/16"}),
		mkRes("aws", "aws_subnet", "main", map[string]any{"cidr_block": "10.0.1.0/24"}, "aws_vpc.main"),
		mkRes("aws", "aws_instance", "old", map[string]any{"instance_type": "t2.nano"}),
	}
	target := []Resource{
		// vpc unchanged.
		mkRes("aws", "aws_vpc", "main", map[string]any{"cidr_block": "10.0.0.0/16"}),
		// subnet attribute changed (cidr_block 10.0.1.0/24 -> 10.0.2.0/24).
		mkRes("aws", "aws_subnet", "main", map[string]any{"cidr_block": "10.0.2.0/24"}, "aws_vpc.main"),
		// instance "old" removed; instance "new" added.
		mkRes("aws", "aws_instance", "new", map[string]any{"instance_type": "t3.micro"}),
	}

	diff := DiffSnapshots(base, target)

	if !diff.HasDrift() {
		t.Fatal("expected drift")
	}
	added, removed, modified := diff.Summary()
	if added != 1 || removed != 1 || modified != 1 {
		t.Fatalf("summary = +%d -%d ~%d, want +1 -1 ~1", added, removed, modified)
	}

	if diff.Added[0].Key.Name != "new" || diff.Added[0].Change != ChangeAdded {
		t.Errorf("added = %+v, want aws_instance.new added", diff.Added[0])
	}
	if diff.Removed[0].Key.Name != "old" || diff.Removed[0].Change != ChangeRemoved {
		t.Errorf("removed = %+v, want aws_instance.old removed", diff.Removed[0])
	}

	mod := diff.Modified[0]
	if mod.Key.Type != "aws_subnet" || mod.Change != ChangeModified {
		t.Fatalf("modified = %+v, want aws_subnet.main modified", mod)
	}
	if mod.OldHash == mod.NewHash || mod.OldHash == "" || mod.NewHash == "" {
		t.Errorf("modified hashes old=%q new=%q should differ and be non-empty", mod.OldHash, mod.NewHash)
	}
	// Attribute-level change captured precisely.
	if len(mod.Attributes) != 1 {
		t.Fatalf("attribute changes = %d, want 1: %+v", len(mod.Attributes), mod.Attributes)
	}
	ac := mod.Attributes[0]
	if ac.Path != "cidr_block" {
		t.Errorf("attr path = %q, want cidr_block", ac.Path)
	}
	if ac.OldValue != "10.0.1.0/24" || ac.NewValue != "10.0.2.0/24" {
		t.Errorf("attr old/new = %v/%v", ac.OldValue, ac.NewValue)
	}
	if !ac.HadOld || !ac.HadNew {
		t.Errorf("attr presence flags wrong: %+v", ac)
	}
}

func TestDiffSnapshots_NoDrift(t *testing.T) {
	resources := []Resource{
		mkRes("aws", "aws_vpc", "main", map[string]any{"cidr_block": "10.0.0.0/16"}),
		mkRes("aws", "aws_subnet", "main", map[string]any{"cidr_block": "10.0.1.0/24"}, "aws_vpc.main"),
	}
	// Same resources, but re-ordered to prove order-independence.
	reordered := []Resource{resources[1], resources[0]}
	diff := DiffSnapshots(resources, reordered)
	if diff.HasDrift() {
		t.Fatalf("expected no drift, got %s: %+v", diff.String(), diff)
	}
}

func TestDiffSnapshots_NestedAttributeChange(t *testing.T) {
	base := []Resource{
		mkRes("aws", "aws_instance", "web", map[string]any{
			"tags": map[string]any{"env": "staging", "team": "core"},
		}),
	}
	target := []Resource{
		mkRes("aws", "aws_instance", "web", map[string]any{
			"tags": map[string]any{"env": "prod", "team": "core"},
		}),
	}
	diff := DiffSnapshots(base, target)
	if len(diff.Modified) != 1 {
		t.Fatalf("modified = %d, want 1", len(diff.Modified))
	}
	changes := diff.Modified[0].Attributes
	if len(changes) != 1 {
		t.Fatalf("attribute changes = %d, want 1: %+v", len(changes), changes)
	}
	if changes[0].Path != "tags.env" {
		t.Errorf("nested attr path = %q, want tags.env", changes[0].Path)
	}
	if changes[0].OldValue != "staging" || changes[0].NewValue != "prod" {
		t.Errorf("nested attr values old=%v new=%v", changes[0].OldValue, changes[0].NewValue)
	}
}

func TestDiffSnapshots_AgainstDesiredSet(t *testing.T) {
	// A snapshot vs a DESIRED set whose resources have no precomputed hash:
	// hashOf must compute it so the diff is still exact.
	base := []Resource{
		mkRes("kubernetes", "ConfigMap", "cfg", map[string]any{"data": "a"}),
	}
	desired := []Resource{
		{Provider: "kubernetes", Type: "ConfigMap", Name: "cfg", Address: "ConfigMap.cfg",
			Attributes: map[string]any{"data": "b"}}, // no Hash set
	}
	diff := DiffSnapshots(base, desired)
	if len(diff.Modified) != 1 {
		t.Fatalf("modified = %d, want 1", len(diff.Modified))
	}
}
