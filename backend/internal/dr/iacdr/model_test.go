package iacdr

import "testing"

func TestResource_ComputeHash_OrderIndependent(t *testing.T) {
	a := Resource{
		Provider:   "aws",
		Type:       "aws_vpc",
		Name:       "main",
		Attributes: map[string]any{"cidr_block": "10.0.0.0/16", "tags": map[string]any{"a": "1", "b": "2"}},
		DependsOn:  []string{"x", "y"},
	}
	// Same logical resource, attributes inserted in a different order and deps
	// reversed: the hash must be identical.
	b := Resource{
		Provider:   "aws",
		Type:       "aws_vpc",
		Name:       "main",
		Attributes: map[string]any{"tags": map[string]any{"b": "2", "a": "1"}, "cidr_block": "10.0.0.0/16"},
		DependsOn:  []string{"y", "x"},
	}
	if a.ComputeHash() != b.ComputeHash() {
		t.Fatalf("hashes differ for logically-equal resources:\n a=%s\n b=%s", a.ComputeHash(), b.ComputeHash())
	}
}

func TestResource_ComputeHash_SensitiveToChange(t *testing.T) {
	base := Resource{Provider: "aws", Type: "aws_vpc", Name: "main",
		Attributes: map[string]any{"cidr_block": "10.0.0.0/16"}}
	baseHash := base.ComputeHash()

	cases := []struct {
		name   string
		mutate func(r *Resource)
	}{
		{"attr value", func(r *Resource) { r.Attributes = map[string]any{"cidr_block": "10.0.0.0/24"} }},
		{"attr key", func(r *Resource) { r.Attributes = map[string]any{"cidr": "10.0.0.0/16"} }},
		{"name", func(r *Resource) { r.Name = "other" }},
		{"provider", func(r *Resource) { r.Provider = "gcp" }},
		{"dep added", func(r *Resource) { r.DependsOn = []string{"z"} }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := Resource{Provider: "aws", Type: "aws_vpc", Name: "main",
				Attributes: map[string]any{"cidr_block": "10.0.0.0/16"}}
			c.mutate(&r)
			if r.ComputeHash() == baseHash {
				t.Fatalf("hash did not change after mutating %s", c.name)
			}
		})
	}
}

func TestComputeContentHash_OrderIndependentAndSensitive(t *testing.T) {
	r1 := mkRes("aws", "aws_vpc", "main", map[string]any{"cidr": "10.0.0.0/16"})
	r2 := mkRes("aws", "aws_subnet", "main", map[string]any{"cidr": "10.0.1.0/24"})

	h1 := ComputeContentHash([]Resource{r1, r2})
	h2 := ComputeContentHash([]Resource{r2, r1}) // reordered
	if h1 != h2 {
		t.Fatalf("content hash is order-dependent: %s != %s", h1, h2)
	}

	// Changing one resource changes the snapshot content hash.
	r2b := mkRes("aws", "aws_subnet", "main", map[string]any{"cidr": "10.0.9.0/24"})
	h3 := ComputeContentHash([]Resource{r1, r2b})
	if h3 == h1 {
		t.Fatal("content hash unchanged after a resource changed")
	}

	// Adding a resource changes the hash.
	r3 := mkRes("aws", "aws_instance", "web", nil)
	h4 := ComputeContentHash([]Resource{r1, r2, r3})
	if h4 == h1 {
		t.Fatal("content hash unchanged after a resource was added")
	}
}

func TestCanonicalJSON_Stable(t *testing.T) {
	v := map[string]any{
		"z": 1.0,
		"a": map[string]any{"y": "2", "x": "1"},
		"m": []any{"c", "b", "a"},
	}
	first := canonicalJSON(v)
	for i := 0; i < 20; i++ {
		if canonicalJSON(v) != first {
			t.Fatalf("canonicalJSON not stable across calls")
		}
	}
	// Keys must be sorted: "a" before "m" before "z"; nested "x" before "y".
	want := `{"a":{"x":"1","y":"2"},"m":["c","b","a"],"z":1}`
	if first != want {
		t.Fatalf("canonicalJSON = %s, want %s", first, want)
	}
}
