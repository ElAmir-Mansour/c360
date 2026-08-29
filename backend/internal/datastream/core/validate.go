package core

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// RecoveryPointRef opaquely identifies a sealed recovery point to a Validator.
// The core defines no internal structure for it so the package stays free of
// DR-specific types; consumers (ClarioDR) supply the concrete object keys.
type RecoveryPointRef struct {
	// ID is the recovery-point identifier (e.g. the recovery_point row UUID).
	ID string
	// MarkerLSN is the consistency marker the recovery point was sealed at.
	MarkerLSN string
}

// Validation is the result of comparing a recovery point against its source.
//
// Per §15.3 the comparison is a deterministic per-row content hash, not a bare
// count(*): MatchRatio = Matched / Checks, Checks is the number of rows
// verified, and Mismatches is the number of content-hash differences.
type Validation struct {
	MatchRatio float64
	Checks     int
	Mismatches int
	Details    string
}

// Validator verifies a recovery point against the source: checksums + row
// counts, returning a match ratio that must reach 0.999.
type Validator interface {
	Validate(ctx context.Context, streamID string, rp RecoveryPointRef) (Validation, error)
}

// ValidationThreshold is the GA acceptance floor for a recovery point's match
// ratio (99.9%). Gate 1 of a failover aborts below this.
const ValidationThreshold = 0.999

// RowHash returns the deterministic per-row content hash used by Validators to
// compare source and recovery rows (§15.3). It is the hex-encoded SHA-256 of
// the canonical row bytes; the caller is responsible for producing a stable,
// canonical encoding of the row before hashing.
func RowHash(row []byte) string {
	sum := sha256.Sum256(row)
	return hex.EncodeToString(sum[:])
}

// MatchRatio computes the verified match ratio from the number of matched rows
// and the total number of rows verified. A total of zero yields 0.0 (nothing
// verified cannot be 100% matched), which fails the ValidationThreshold and so
// is treated conservatively.
func MatchRatio(matched, total int) float64 {
	if total <= 0 {
		return 0
	}
	if matched <= 0 {
		return 0
	}
	if matched > total {
		matched = total
	}
	return float64(matched) / float64(total)
}

// NewValidation assembles a Validation from matched/total counts, deriving
// MatchRatio, Mismatches and a default Details string when none is supplied.
func NewValidation(matched, total int, details string) Validation {
	mismatches := total - matched
	if mismatches < 0 {
		mismatches = 0
	}
	if details == "" {
		details = fmt.Sprintf("%d/%d rows matched", matched, total)
	}
	return Validation{
		MatchRatio: MatchRatio(matched, total),
		Checks:     total,
		Mismatches: mismatches,
		Details:    details,
	}
}

// Passed reports whether the validation meets the 99.9% acceptance threshold.
func (v Validation) Passed() bool {
	return v.MatchRatio >= ValidationThreshold
}

// canonicalRowHash computes the deterministic per-row content hash (§15.3) over
// an ordered (column, value) row. The encoding is unambiguous — each field is
// length-prefixed — so two rows hash equal iff every column value is byte-equal
// in its canonical text form. This is the same hash on the source and target,
// so a content difference (not just a count difference) is detected.
func canonicalRowHash(cols []string, vals []any) string {
	h := sha256.New()
	var l [8]byte
	for i, col := range cols {
		binary.BigEndian.PutUint64(l[:], uint64(len(col)))
		h.Write(l[:])
		h.Write([]byte(col))
		txt := canonicalValueText(vals[i])
		binary.BigEndian.PutUint64(l[:], uint64(len(txt)))
		h.Write(l[:])
		h.Write([]byte(txt))
	}
	return hex.EncodeToString(h.Sum(nil))
}

// canonicalValueText renders a value to a stable text form for hashing. nil is a
// distinct sentinel so a NULL never collides with the empty string.
func canonicalValueText(v any) string {
	switch t := v.(type) {
	case nil:
		return "\x00NULL"
	case []byte:
		return "b:" + hex.EncodeToString(t)
	case time.Time:
		return "t:" + t.UTC().Format(time.RFC3339Nano)
	default:
		return "v:" + fmt.Sprintf("%v", t)
	}
}

// PGRowValidator proves data fidelity between a source and a target table by
// comparing a deterministic per-row content hash keyed by primary key (§15.3).
// It is real, re-runnable and idempotent: it reads both tables through pgx,
// hashes each row's full content, and reports MatchRatio = matched/total over
// the union of primary keys, so missing rows, extra rows and content drift all
// count as mismatches.
type PGRowValidator struct {
	source PGQuerier
	target PGQuerier
	cfg    PGTableConfig
}

// NewPGRowValidator builds a validator comparing the cfg table on source vs
// target. The two queriers may point at the same database (different schemas)
// or different databases.
func NewPGRowValidator(source, target PGQuerier, cfg PGTableConfig) (*PGRowValidator, error) {
	if source == nil || target == nil {
		return nil, fmt.Errorf("core: pg validator requires source and target queriers")
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &PGRowValidator{source: source, target: target, cfg: cfg}, nil
}

// Validate compares every row content hash keyed by primary key. rp is unused
// for table validation (the table identity is the cfg); it is part of the
// Validator interface for recovery-point-scoped validators.
func (v *PGRowValidator) Validate(ctx context.Context, streamID string, _ RecoveryPointRef) (Validation, error) {
	srcHashes, err := v.hashTable(ctx, v.source)
	if err != nil {
		return Validation{}, fmt.Errorf("core: pg validate stream %s: hash source: %w", streamID, err)
	}
	tgtHashes, err := v.hashTable(ctx, v.target)
	if err != nil {
		return Validation{}, fmt.Errorf("core: pg validate stream %s: hash target: %w", streamID, err)
	}

	// Union of primary keys; a row matches when both sides have the identical
	// content hash for the same key.
	keys := make(map[string]struct{}, len(srcHashes))
	for k := range srcHashes {
		keys[k] = struct{}{}
	}
	for k := range tgtHashes {
		keys[k] = struct{}{}
	}
	total := len(keys)
	matched := 0
	for k := range keys {
		if sh, ok := srcHashes[k]; ok {
			if th, ok2 := tgtHashes[k]; ok2 && sh == th {
				matched++
			}
		}
	}
	details := fmt.Sprintf("table %s: %d/%d rows content-matched (source=%d target=%d)",
		v.cfg.qualified(), matched, total, len(srcHashes), len(tgtHashes))
	return NewValidation(matched, total, details), nil
}

// hashTable returns a map of primary-key string -> content hash for every row.
func (v *PGRowValidator) hashTable(ctx context.Context, db PGQuerier) (map[string]string, error) {
	cols := v.cfg.Columns
	colList := quoteIdentList(cols)
	pkOrder := quoteIdentList(v.cfg.PrimaryKey)
	sql := fmt.Sprintf("SELECT %s FROM %s ORDER BY %s", colList, v.cfg.qualified(), pkOrder)
	rows, err := db.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	pkIdx := make([]int, len(v.cfg.PrimaryKey))
	for i, pk := range v.cfg.PrimaryKey {
		pkIdx[i] = indexOf(cols, pk)
	}

	out := make(map[string]string)
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		var keyParts []string
		for _, idx := range pkIdx {
			keyParts = append(keyParts, canonicalValueText(vals[idx]))
		}
		key := fmt.Sprintf("%v", keyParts)
		out[key] = canonicalRowHash(cols, vals)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// FileTreeValidator proves file-replication fidelity by comparing the whole-file
// SHA-256 of every regular file under a source tree against the same path under
// a target tree (§15.3, file checksum comparison). MatchRatio = matched/total
// over the union of relative paths, so a missing, extra or byte-different file
// counts as a mismatch.
type FileTreeValidator struct {
	sourceDir string
	targetDir string
}

// NewFileTreeValidator builds a validator comparing sourceDir against targetDir.
func NewFileTreeValidator(sourceDir, targetDir string) *FileTreeValidator {
	return &FileTreeValidator{sourceDir: sourceDir, targetDir: targetDir}
}

// Validate compares per-file checksums across the two trees.
func (v *FileTreeValidator) Validate(ctx context.Context, streamID string, _ RecoveryPointRef) (Validation, error) {
	src, err := hashTree(ctx, v.sourceDir)
	if err != nil {
		return Validation{}, fmt.Errorf("core: file validate stream %s: hash source: %w", streamID, err)
	}
	tgt, err := hashTree(ctx, v.targetDir)
	if err != nil {
		return Validation{}, fmt.Errorf("core: file validate stream %s: hash target: %w", streamID, err)
	}
	keys := map[string]struct{}{}
	for k := range src {
		keys[k] = struct{}{}
	}
	for k := range tgt {
		keys[k] = struct{}{}
	}
	total := len(keys)
	matched := 0
	var mismatched []string
	for k := range keys {
		if sh, ok := src[k]; ok {
			if th, ok2 := tgt[k]; ok2 && sh == th {
				matched++
				continue
			}
		}
		mismatched = append(mismatched, k)
	}
	sort.Strings(mismatched)
	details := fmt.Sprintf("%d/%d files matched (source=%d target=%d)", matched, total, len(src), len(tgt))
	if len(mismatched) > 0 {
		preview := mismatched
		if len(preview) > 5 {
			preview = preview[:5]
		}
		details += fmt.Sprintf("; mismatched: %v", preview)
	}
	return NewValidation(matched, total, details), nil
}

// hashTree returns relative-slash-path -> whole-file SHA-256 for every regular
// file under root.
func hashTree(ctx context.Context, root string) (map[string]string, error) {
	out := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		rel, rerr := filepath.Rel(root, p)
		if rerr != nil {
			return rerr
		}
		h, herr := hashFileWhole(p)
		if herr != nil {
			return herr
		}
		out[filepath.ToSlash(rel)] = h
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil // an absent tree hashes to empty (counts as all-mismatch)
		}
		return nil, err
	}
	return out, nil
}
