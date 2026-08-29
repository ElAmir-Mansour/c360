package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"testing"
)

func TestDRMigrationFilesHaveUniqueVersionPairs(t *testing.T) {
	t.Parallel()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations", "dr_db")
	entries, err := os.ReadDir(migDir)
	if err != nil {
		t.Fatalf("read dr_db migrations: %v", err)
	}

	filePattern := regexp.MustCompile(`^([0-9]{6})_(.+)\.(up|down)\.sql$`)
	type migrationPair struct {
		upNames   []string
		downNames []string
	}
	byVersion := map[uint]*migrationPair{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		matches := filePattern.FindStringSubmatch(name)
		if matches == nil {
			if strings.HasSuffix(name, ".sql") {
				t.Fatalf("unexpected dr_db migration filename %q", name)
			}
			continue
		}
		parsed, err := strconv.ParseUint(matches[1], 10, 32)
		if err != nil {
			t.Fatalf("parse migration version from %q: %v", name, err)
		}
		version := uint(parsed)
		pair := byVersion[version]
		if pair == nil {
			pair = &migrationPair{}
			byVersion[version] = pair
		}
		stem := matches[2]
		switch matches[3] {
		case "up":
			pair.upNames = append(pair.upNames, stem)
		case "down":
			pair.downNames = append(pair.downNames, stem)
		default:
			t.Fatalf("unreachable migration direction %q in %q", matches[3], name)
		}
	}
	if len(byVersion) == 0 {
		t.Fatal("dr_db migration directory must contain migrations")
	}

	var latest uint
	var problems []string
	for version, pair := range byVersion {
		if version > latest {
			latest = version
		}
		if len(pair.upNames) != 1 {
			problems = append(problems, fmt.Sprintf("%06d has %d up files: %v", version, len(pair.upNames), pair.upNames))
		}
		if len(pair.downNames) != 1 {
			problems = append(problems, fmt.Sprintf("%06d has %d down files: %v", version, len(pair.downNames), pair.downNames))
		}
		if len(pair.upNames) == 1 && len(pair.downNames) == 1 && pair.upNames[0] != pair.downNames[0] {
			problems = append(problems, fmt.Sprintf("%06d up/down names differ: up=%q down=%q", version, pair.upNames[0], pair.downNames[0]))
		}
	}
	for version := uint(1); version <= latest; version++ {
		if _, ok := byVersion[version]; !ok {
			problems = append(problems, fmt.Sprintf("missing migration version %06d", version))
		}
	}
	if len(problems) > 0 {
		sort.Strings(problems)
		t.Fatalf("dr_db migration file set would break golang-migrate:\n%s", strings.Join(problems, "\n"))
	}
}

func TestAttestationLedgerImmutabilityMigrationHardensPolicies(t *testing.T) {
	t.Parallel()

	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations", "dr_db")
	up, err := os.ReadFile(filepath.Join(migDir, "000043_attestation_ledger_immutability.up.sql"))
	if err != nil {
		t.Fatalf("read attestation immutability migration: %v", err)
	}
	body := strings.ToLower(string(up))

	for _, want := range []string{
		"recover_evidence_report",
		"dr_attestation_ledger_immutable_guard",
		"dr_attestation_checkpoint_immutable_guard",
		"drop policy if exists tenant_delete on dr_attestation_ledger",
		"drop policy if exists tenant_delete on dr_attestation_checkpoint",
		"drop policy if exists tenant_update on dr_attestation_checkpoint",
		"old.anchored_root is null",
		"new.anchored_root is not null",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("000043 immutability migration missing %q", want)
		}
	}
}
