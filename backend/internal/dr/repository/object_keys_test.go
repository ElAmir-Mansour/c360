package repository

import (
	"testing"
)

// TestUnmarshalObjectKeys proves the tolerant decode accepts both the canonical
// scalar encoding written by current seeds and the legacy array encoding still
// present in WORM-sealed recovery_point rows (which can never be rewritten).
func TestUnmarshalObjectKeys(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want map[string]string
	}{
		{
			name: "legacy array form flattens to first element",
			raw:  `{"s":["a"]}`,
			want: map[string]string{"s": "a"},
		},
		{
			name: "canonical scalar form passes through",
			raw:  `{"s":"a"}`,
			want: map[string]string{"s": "a"},
		},
		{
			name: "empty object stays empty",
			raw:  `{}`,
			want: map[string]string{},
		},
		{
			name: "empty array value is skipped",
			raw:  `{"s":[],"t":["b"]}`,
			want: map[string]string{"t": "b"},
		},
		{
			name: "multi-element array takes the first",
			raw:  `{"s":["a","b","c"]}`,
			want: map[string]string{"s": "a"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := unmarshalObjectKeys([]byte(tc.raw))
			if err != nil {
				t.Fatalf("unmarshalObjectKeys(%q) unexpected error: %v", tc.raw, err)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("unmarshalObjectKeys(%q) = %v, want %v (len mismatch)", tc.raw, got, tc.want)
			}
			for k, want := range tc.want {
				if got[k] != want {
					t.Errorf("unmarshalObjectKeys(%q)[%q] = %q, want %q", tc.raw, k, got[k], want)
				}
			}
		})
	}
}

// TestUnmarshalObjectKeysRejectsGarbage confirms a value that is neither a
// string nor a string array still surfaces as an error rather than silently
// producing a wrong map.
func TestUnmarshalObjectKeysRejectsGarbage(t *testing.T) {
	if _, err := unmarshalObjectKeys([]byte(`{"s":{"nested":1}}`)); err == nil {
		t.Fatal("expected error for object value, got nil")
	}
}
