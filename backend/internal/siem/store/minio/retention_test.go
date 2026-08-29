package minio

import (
	"errors"
	"testing"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

func TestDefaultRetentionYears(t *testing.T) {
	cases := []struct {
		class storetypes.DataClass
		want  int
	}{
		{storetypes.DataClassSwift, 10},
		{storetypes.DataClassRTGS, 10},
		{storetypes.DataClassPII, 7},
		{storetypes.DataClassCardholder, 7},
		{storetypes.DataClassInternal, 3},
		{storetypes.DataClassPublic, 1},
		{"unknown", 7},
	}
	for _, c := range cases {
		got := DefaultRetentionYears(c.class)
		if got != c.want {
			t.Errorf("class=%s: got %d, want %d", c.class, got, c.want)
		}
	}
}

func TestEffectiveRetention(t *testing.T) {
	t.Run("default when zero", func(t *testing.T) {
		_, years, err := EffectiveRetention(storetypes.DataClassPII, 0)
		if err != nil {
			t.Fatal(err)
		}
		if years != 7 {
			t.Errorf("years = %d", years)
		}
	})
	t.Run("extend allowed", func(t *testing.T) {
		_, years, err := EffectiveRetention(storetypes.DataClassPII, 12)
		if err != nil {
			t.Fatal(err)
		}
		if years != 12 {
			t.Errorf("years = %d", years)
		}
	})
	t.Run("shorten rejected", func(t *testing.T) {
		_, _, err := EffectiveRetention(storetypes.DataClassSwift, 5)
		if err == nil {
			t.Fatal("expected error")
		}
		if !errors.Is(err, ErrRetentionTooShort) {
			t.Errorf("err = %v", err)
		}
	})
}
