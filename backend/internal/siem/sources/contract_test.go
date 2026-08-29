package sources

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// TestImportBoundary_Sources ensures no Go file outside
// backend/internal/siem/sources/ reads from or writes to the four
// SIEM-03 tables: siem.sources, siem.source_credentials,
// siem.source_eps_samples, siem.source_cert_revocations, and
// siem.enrollment_tokens.
//
// The contract walks every .go file under backend/, parses it via
// go/ast, and looks for string literals that mention the protected
// table names. Allowed callers:
//   - any file under backend/internal/siem/sources/
//   - backend/migrations/siem_db/*.sql (handled implicitly — SQL
//     files are not walked)
//
// Block any other Go source. Add new exceptions only by listing the
// directory in `allowedDirs` and only with a comment justifying the
// exception.
func TestImportBoundary_Sources(t *testing.T) {
	backendRoot := mustBackendRoot(t)
	sourcesRoot := filepath.Join(backendRoot, "internal", "siem", "sources")

	// Match a SQL-style table reference: schema-qualified name not
	// followed by another "." (which would indicate a topic name or
	// metric label like "siem.sources.events").
	protected := regexp.MustCompile(`siem\.(sources|source_credentials|source_eps_samples|source_cert_revocations|enrollment_tokens)([^.a-zA-Z0-9_]|$)`)

	allowedDirs := []string{
		sourcesRoot, // the sources package itself
	}

	fset := token.NewFileSet()
	var violations []string

	err := filepath.WalkDir(backendRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			name := d.Name()
			if name == "vendor" || name == "testdata" || name == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		for _, allowed := range allowedDirs {
			if strings.HasPrefix(path, allowed+string(filepath.Separator)) || path == allowed {
				return nil
			}
		}

		f, perr := parser.ParseFile(fset, path, nil, parser.ParseComments)
		if perr != nil {
			// Not all files will parse cleanly under all build tags; skip.
			return nil //nolint:nilerr
		}
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.BasicLit)
			if !ok || lit.Kind != token.STRING {
				return true
			}
			if protected.MatchString(lit.Value) {
				rel, _ := filepath.Rel(backendRoot, path)
				violations = append(violations, rel+": "+lit.Value)
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	if len(violations) > 0 {
		t.Fatalf("TestImportBoundary_Sources: the following files reference protected siem.sources tables outside internal/siem/sources/:\n  %s",
			strings.Join(violations, "\n  "))
	}
}

// mustBackendRoot walks up from the current working directory until
// it finds a "go.mod" file; the directory containing it is the
// backend root.
func mustBackendRoot(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	cur := wd
	for {
		if _, err := os.Stat(filepath.Join(cur, "go.mod")); err == nil {
			return cur
		}
		parent := filepath.Dir(cur)
		if parent == cur {
			t.Fatalf("could not find go.mod walking up from %s", wd)
		}
		cur = parent
	}
}
