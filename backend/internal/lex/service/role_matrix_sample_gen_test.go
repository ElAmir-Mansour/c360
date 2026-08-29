package service

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"
)

// TestGenerateSampleTemplate writes real, upload-ready role-matrix templates to
// ROLE_MATRIX_SAMPLE_OUT using the SAME Template() logic the /import-template
// endpoint serves — so the files are guaranteed to parse and validate.
//
//	ROLE_MATRIX_SAMPLE_OUT=/path/to/dir \
//	ROLE_MATRIX_CERT_DSN='postgres://clario:clario_dev_pass@localhost:5436/platform_core' \
//	  GOWORK=off go test ./internal/lex/service/ -run TestGenerateSampleTemplate -v
func TestGenerateSampleTemplate(t *testing.T) {
	out := os.Getenv("ROLE_MATRIX_SAMPLE_OUT")
	dsn := os.Getenv("ROLE_MATRIX_CERT_DSN")
	if out == "" || dsn == "" {
		t.Skip("set ROLE_MATRIX_SAMPLE_OUT and ROLE_MATRIX_CERT_DSN to generate sample templates")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	svc := NewRoleMatrixService(pool, zerolog.Nop())
	// A fresh (never-imported) tenant id yields the pristine baseline matrix —
	// exactly what a tenant sees on first "Download → Current matrix".
	prefilled, err := svc.Template(ctx, uuid.New(), true)
	if err != nil {
		t.Fatalf("prefilled template: %v", err)
	}
	blank, err := svc.Template(ctx, uuid.New(), false)
	if err != nil {
		t.Fatalf("blank template: %v", err)
	}

	writeCSV := func(name string, headers []string, rows [][]string) {
		f, err := os.Create(filepath.Join(out, name))
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		defer f.Close()
		w := csv.NewWriter(f)
		_ = w.Write(headers)
		_ = w.WriteAll(rows)
		w.Flush()
	}

	// 1) Pristine current matrix (round-trips to a NO-OP import — good for a
	//    "no changes detected" smoke test).
	writeCSV("watheeq-role-matrix-current.csv", prefilled.Headers, prefilled.Rows)

	// 2) Blank grid (every cell empty — for building a matrix from scratch).
	writeCSV("watheeq-role-matrix-blank.csv", blank.Headers, blank.Rows)

	// 3) A demonstrative EDITED matrix: grant legal-officer lex:contract:view
	//    and revoke lex:case:edit, so a dry-run shows a real +1/-1 diff and
	//    still validates cleanly (both keys are importable; no elevated grant).
	officerCol := -1
	for i, h := range prefilled.Headers {
		if h == "legal-officer" {
			officerCol = i
		}
	}
	if officerCol < 0 {
		t.Fatal("legal-officer column not found in template")
	}
	edited := make([][]string, len(prefilled.Rows))
	for i, row := range prefilled.Rows {
		cp := append([]string(nil), row...)
		switch cp[1] {
		case "lex:contract:view":
			cp[officerCol] = "X" // grant
		case "lex:case:edit":
			cp[officerCol] = "" // revoke
		}
		edited[i] = cp
	}
	writeCSV("watheeq-role-matrix-sample-edited.csv", prefilled.Headers, edited)

	// 4) JSON form of the pristine template (accepted by the JSON upload path).
	jf, err := os.Create(filepath.Join(out, "watheeq-role-matrix-current.json"))
	if err != nil {
		t.Fatalf("create json: %v", err)
	}
	defer jf.Close()
	enc := json.NewEncoder(jf)
	enc.SetIndent("", "  ")
	if err := enc.Encode(prefilled); err != nil {
		t.Fatalf("encode json: %v", err)
	}

	t.Logf("wrote sample templates to %s (%d permission rows, %d role columns)",
		out, len(prefilled.Rows), len(prefilled.Slugs))
}
