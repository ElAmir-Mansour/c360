package config

import (
	"os"
	"testing"
)

func TestGetOptionalAllowEmpty(t *testing.T) {
	const key = "FILEMANAGER_TEST_OPTIONAL_ALLOW_EMPTY"

	t.Run("falls back when unset", func(t *testing.T) {
		previous, present := os.LookupEnv(key)
		if err := os.Unsetenv(key); err != nil {
			t.Fatalf("Unsetenv: %v", err)
		}
		t.Cleanup(func() {
			if present {
				_ = os.Setenv(key, previous)
			} else {
				_ = os.Unsetenv(key)
			}
		})
		if got := getOptionalAllowEmpty(key, "clamd:3310"); got != "clamd:3310" {
			t.Fatalf("getOptionalAllowEmpty unset = %q, want fallback", got)
		}
	})

	t.Run("preserves explicit empty value", func(t *testing.T) {
		t.Setenv(key, "")
		if got := getOptionalAllowEmpty(key, "clamd:3310"); got != "" {
			t.Fatalf("getOptionalAllowEmpty explicit empty = %q, want empty", got)
		}
	})

	t.Run("returns configured value", func(t *testing.T) {
		t.Setenv(key, " 127.0.0.1:3310 ")
		if got := getOptionalAllowEmpty(key, "clamd:3310"); got != "127.0.0.1:3310" {
			t.Fatalf("getOptionalAllowEmpty configured = %q", got)
		}
	})
}
