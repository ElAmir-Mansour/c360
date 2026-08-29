package main

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestValidateDirection(t *testing.T) {
	for _, direction := range []string{"up", "down"} {
		if err := validateDirection(direction); err != nil {
			t.Fatalf("validateDirection(%q) returned %v", direction, err)
		}
	}
	if err := validateDirection("sideways"); err == nil {
		t.Fatal("validateDirection accepted an unsupported direction")
	}
}

func TestSelectDatabases(t *testing.T) {
	t.Run("all by default", func(t *testing.T) {
		got, err := selectDatabases("")
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(got, allDatabases) {
			t.Fatalf("selectDatabases returned %v, want %v", got, allDatabases)
		}
	})

	t.Run("trims and deduplicates", func(t *testing.T) {
		got, err := selectDatabases(" lex_db, platform_core,lex_db ")
		if err != nil {
			t.Fatal(err)
		}
		want := []string{"lex_db", "platform_core"}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("selectDatabases returned %v, want %v", got, want)
		}
	})

	for name, selection := range map[string]string{
		"unknown": "typo_db",
		"empty":   "lex_db,",
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := selectDatabases(selection); err == nil {
				t.Fatalf("selectDatabases(%q) unexpectedly succeeded", selection)
			}
		})
	}
}

func TestFindExistingDirectory(t *testing.T) {
	root := t.TempDir()
	existing := filepath.Join(root, "migrations")
	if err := os.Mkdir(existing, 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := findExistingDirectory([]string{filepath.Join(root, "missing"), existing})
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.Abs(existing)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("findExistingDirectory returned %q, want %q", got, want)
	}

	_, err = findExistingDirectory([]string{filepath.Join(root, "still-missing")})
	if err == nil || !strings.Contains(err.Error(), "migrations directory not found") {
		t.Fatalf("findExistingDirectory returned %v, want a not-found error", err)
	}
}
