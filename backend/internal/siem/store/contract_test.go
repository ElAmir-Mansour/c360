package store_test

import (
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// TestImportBoundary walks every non-vendored Go file under backend/ and
// asserts that no file outside the per-import allowlist imports the
// SDKs that the SIEM-02 spec singles out:
//
//   - github.com/opensearch-project/opensearch-go/v3
//   - github.com/minio/minio-go/v7
//   - github.com/hashicorp/vault/api
//
// This guarantees that all OpenSearch / MinIO / Vault traffic flows
// through the internal wrappers (internal/siem/store/opensearch,
// internal/siem/store/minio, internal/vault) and that future contributors
// cannot accidentally introduce a parallel client.
//
// The allowlist is keyed by the IMPORT path. Each value is a list of
// relative-to-backend-root path prefixes; a file is allowed if its
// repo-relative path starts with at least one prefix.
func TestImportBoundary(t *testing.T) {
	importAllowlist := map[string][]string{
		"github.com/opensearch-project/opensearch-go/v3": {
			"internal/siem/store/opensearch/",
			"internal/siem/store/integration_test.go",
		},
		"github.com/minio/minio-go/v7": {
			"internal/siem/store/minio/",
			"internal/siem/store/integration_test.go",
			"internal/filemanager/",
			// Pre-existing legitimate users in the monorepo. New imports
			// in these locations are allowed, but new top-level locations
			// must be added consciously.
			"internal/data/",
			// DR WORM is the recovery-point object-store wrapper. The
			// service integration test uses a raw client only to assert
			// object-lock and ciphertext-at-rest behaviour independently
			// of that wrapper.
			"internal/dr/worm/",
			"internal/dr/service/recoverypoint_integration_test.go",
			// Lex e-archive owns its own S3 Object Lock transport for WORM
			// legal records retention; keep this scoped to the integration
			// package rather than allowing broad Lex MinIO usage.
			"internal/lex/service/integration/",
			"internal/onboarding/",
			"pkg/storage/",
			"cmd/file-service/",
		},
		"github.com/hashicorp/vault/api": {
			"internal/vault/",
		},
	}

	root := backendRoot(t)
	fset := token.NewFileSet()

	var audited int
	var matchedImports int

	walkErr := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			name := info.Name()
			if name == "vendor" || name == "node_modules" || name == ".git" || name == "testdata" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		audited++

		f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if err != nil {
			t.Logf("skipping unparseable %s: %v", path, err)
			return nil
		}
		rel := mustRel(t, root, path)
		for _, imp := range f.Imports {
			pkg, err := strconv.Unquote(imp.Path.Value)
			if err != nil {
				continue
			}
			allowed, exists := importAllowlist[pkg]
			if !exists {
				continue
			}
			matchedImports++
			ok := false
			for _, prefix := range allowed {
				if rel == prefix || strings.HasPrefix(rel, prefix) {
					ok = true
					break
				}
			}
			if !ok {
				t.Errorf("import boundary violation: %s imports %s but is not in the allowlist", rel, pkg)
			}
		}
		return nil
	})
	if walkErr != nil {
		t.Fatalf("walk %s: %v", root, walkErr)
	}
	if audited == 0 {
		t.Fatalf("no Go files audited under %s — wrong root?", root)
	}
	t.Logf("contract test audited %d Go files; matched %d allowlisted imports", audited, matchedImports)
}

// backendRoot locates the directory containing backend/go.mod by walking
// upward from this test file's cwd.
func backendRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	// `go test` runs in the package's directory: internal/siem/store/.
	// Walk up to find backend/go.mod.
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("could not locate backend/go.mod from %s", dir)
	return ""
}

func mustRel(t *testing.T, base, target string) string {
	t.Helper()
	rel, err := filepath.Rel(base, target)
	if err != nil {
		t.Fatalf("filepath.Rel(%q, %q): %v", base, target, err)
	}
	return rel
}
