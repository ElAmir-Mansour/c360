package model

import "testing"

func TestParseSemver(t *testing.T) {
	cases := []struct {
		in      string
		want    Semver
		wantErr bool
	}{
		{"1.2.3", Semver{1, 2, 3}, false},
		{"v1.2.3", Semver{1, 2, 3}, false},
		{"1", Semver{1, 0, 0}, false},
		{"1.2", Semver{1, 2, 0}, false},
		{" 2.0.0 ", Semver{2, 0, 0}, false},
		{"", Semver{}, true},
		{"1.2.3.4", Semver{}, true},
		{"1.x.0", Semver{}, true},
		{"-1.0.0", Semver{}, true},
	}
	for _, c := range cases {
		got, err := ParseSemver(c.in)
		if c.wantErr {
			if err == nil {
				t.Errorf("ParseSemver(%q) expected error, got %+v", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseSemver(%q) error = %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("ParseSemver(%q) = %+v, want %+v", c.in, got, c.want)
		}
	}
}

func TestSemverCompareOrdersNumericallyNotLexically(t *testing.T) {
	// The classic trap: lexically "1.10.0" < "1.9.0"; numerically it is greater.
	v9 := Semver{1, 9, 0}
	v10 := Semver{1, 10, 0}
	if v10.Compare(v9) <= 0 {
		t.Fatalf("1.10.0 should compare greater than 1.9.0")
	}
	if v9.Compare(v10) >= 0 {
		t.Fatalf("1.9.0 should compare less than 1.10.0")
	}
	if (Semver{2, 0, 0}).Compare(Semver{1, 99, 99}) <= 0 {
		t.Fatalf("major dominates: 2.0.0 > 1.99.99")
	}
	if (Semver{1, 2, 3}).Compare(Semver{1, 2, 3}) != 0 {
		t.Fatalf("equal versions compare 0")
	}
}

func TestSemverStringRoundTrip(t *testing.T) {
	v, err := ParseSemver("3.4.5")
	if err != nil {
		t.Fatal(err)
	}
	if v.String() != "3.4.5" {
		t.Fatalf("String() = %q, want 3.4.5", v.String())
	}
}
