package core

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type scriptedPGLogSource struct {
	records []PGLogRecord
	seenLSN []string
	closed  bool
}

func (s *scriptedPGLogSource) Next(_ context.Context, afterLSN string) (PGLogRecord, error) {
	s.seenLSN = append(s.seenLSN, afterLSN)
	if len(s.records) == 0 {
		return PGLogRecord{}, io.EOF
	}
	rec := s.records[0]
	s.records = s.records[1:]
	return rec, nil
}

func (s *scriptedPGLogSource) Close() error {
	s.closed = true
	return nil
}

func TestPGLogCapturer_EmitsLogicalLogFrames(t *testing.T) {
	t.Parallel()

	cfg := PGTableConfig{
		Schema:     "public",
		Table:      "account",
		Columns:    []string{"id", "name", "balance", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	}
	now := time.Unix(1700000000, 0).UTC()
	src := &scriptedPGLogSource{records: []PGLogRecord{
		{Op: PGChangeInsert, Schema: "public", Table: "account", LSN: "0/10", CommitTime: now, Columns: cfg.Columns, Values: []any{"a", "alpha", int64(10), now}},
		{Op: PGChangeUpdate, Schema: "public", Table: "account", LSN: "0/20", CommitTime: now.Add(time.Second), Columns: cfg.Columns, Values: []any{"a", "alpha2", int64(20), now.Add(time.Second)}},
		{Op: PGChangeDelete, Schema: "public", Table: "account", LSN: "0/30", CommitTime: now.Add(2 * time.Second), KeyColumns: []string{"id"}, KeyValues: []any{"a"}},
		{Op: PGChangeInsert, Schema: "public", Table: "other_table", LSN: "0/40", CommitTime: now, Columns: cfg.Columns, Values: []any{"ignored", "x", int64(1), now}},
	}}
	cap, err := NewPGLogCapturer(src, "pg-log", cfg)
	if err != nil {
		t.Fatalf("NewPGLogCapturer: %v", err)
	}
	cap.Continuous = false

	out := make(chan Frame, 8)
	if err := cap.Start(context.Background(), 0, out); err != nil {
		t.Fatalf("Start: %v", err)
	}
	close(out)

	var frames []Frame
	for f := range out {
		frames = append(frames, f)
	}
	if len(frames) != 3 {
		t.Fatalf("frames emitted = %d, want 3", len(frames))
	}
	for i, f := range frames {
		if f.Seq != uint64(i+1) {
			t.Fatalf("frame %d seq = %d, want %d", i, f.Seq, i+1)
		}
		if f.Kind != FrameKindWAL {
			t.Fatalf("frame %d kind = %s, want WAL", i, f.Kind)
		}
	}
	if frames[0].SourceLSN != "0/10" || frames[1].SourceLSN != "0/20" || frames[2].SourceLSN != "0/30" {
		t.Fatalf("unexpected LSN sequence: %q %q %q", frames[0].SourceLSN, frames[1].SourceLSN, frames[2].SourceLSN)
	}
	op, err := pgPayloadOp(frames[2].Payload)
	if err != nil {
		t.Fatalf("payload op: %v", err)
	}
	if op != pgOpDelete {
		t.Fatalf("third frame op = %d, want delete", op)
	}
	keyCols, keyVals, err := decodePGDelete(frames[2].Payload)
	if err != nil {
		t.Fatalf("decode delete: %v", err)
	}
	if len(keyCols) != 1 || keyCols[0] != "id" || len(keyVals) != 1 || keyVals[0] != "a" {
		t.Fatalf("delete key = %v/%v, want id/a", keyCols, keyVals)
	}
	if src.seenLSN[0] != "" || src.seenLSN[1] != "0/10" || src.seenLSN[2] != "0/20" {
		t.Fatalf("log source cursor sequence = %v", src.seenLSN)
	}
}

func TestPGLogCapturer_ResumeRequiresLSN(t *testing.T) {
	t.Parallel()
	cap, err := NewPGLogCapturer(&scriptedPGLogSource{}, "pg-log", PGTableConfig{
		Table:      "account",
		Columns:    []string{"id", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	})
	if err != nil {
		t.Fatal(err)
	}
	err = cap.Start(context.Background(), 10, make(chan Frame))
	if err == nil || !strings.Contains(err.Error(), "resume requires a source LSN") {
		t.Fatalf("Start err = %v, want resume LSN error", err)
	}
}

func TestPGWatermarkTextTimeIsFixedWidthSortable(t *testing.T) {
	t.Parallel()

	exactSecond := time.Date(2026, 6, 13, 10, 30, 5, 0, time.UTC)
	oneMillisecondLater := exactSecond.Add(time.Millisecond)

	exact := watermarkText(exactSecond)
	later := watermarkText(oneMillisecondLater)
	if exact >= later {
		t.Fatalf("watermark order exact=%q later=%q, want exact < later", exact, later)
	}
	if !strings.Contains(exact, ".000000000Z") {
		t.Fatalf("exact-second watermark %q is not fixed-width", exact)
	}
}

type execOnlyPG struct {
	sql  string
	args []any
}

func (e *execOnlyPG) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("query not implemented")
}

func (e *execOnlyPG) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

func (e *execOnlyPG) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	e.sql = sql
	e.args = append([]any(nil), args...)
	return pgconn.NewCommandTag("DELETE 1"), nil
}

func TestPGApplier_DeleteFrame(t *testing.T) {
	t.Parallel()
	db := &execOnlyPG{}
	ap, err := NewPGApplier(db, PGTableConfig{
		Schema:     "public",
		Table:      "account",
		Columns:    []string{"id", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := encodePGDelete([]string{"id"}, []any{"acct-1"})
	if err != nil {
		t.Fatal(err)
	}
	seq, err := ap.Apply(context.Background(), Frame{Seq: 7, Kind: FrameKindWAL, Payload: payload})
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if seq != 7 {
		t.Fatalf("seq = %d, want 7", seq)
	}
	if !strings.HasPrefix(db.sql, `DELETE FROM "public"."account" WHERE "id" = $1`) {
		t.Fatalf("delete SQL = %q", db.sql)
	}
	if len(db.args) != 1 || db.args[0] != "acct-1" {
		t.Fatalf("delete args = %#v", db.args)
	}
}

func TestPGApplier_TruncateFrame(t *testing.T) {
	t.Parallel()

	db := &execOnlyPG{}
	ap, err := NewPGApplier(db, PGTableConfig{
		Schema:     "public",
		Table:      "account",
		Columns:    []string{"id", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := encodePGTruncate()
	if err != nil {
		t.Fatal(err)
	}
	seq, err := ap.Apply(context.Background(), Frame{Seq: 8, Kind: FrameKindWAL, Payload: payload})
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if seq != 8 {
		t.Fatalf("seq = %d, want 8", seq)
	}
	if db.sql != `TRUNCATE TABLE "public"."account"` {
		t.Fatalf("truncate SQL = %q", db.sql)
	}
	if len(db.args) != 0 {
		t.Fatalf("truncate args = %#v, want none", db.args)
	}
}

func TestPGApplier_SchemaDriftSentinel(t *testing.T) {
	t.Parallel()
	ap, err := NewPGApplier(&execOnlyPG{}, PGTableConfig{
		Table:      "account",
		Columns:    []string{"id", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := encodePGRow([]string{"id", "name", "updated_at"}, []any{"acct-1", "alpha", time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	_, err = ap.Apply(context.Background(), Frame{Seq: 1, Kind: FrameKindWAL, Payload: payload})
	if !errors.Is(err, ErrSchemaDrift) {
		t.Fatalf("Apply err = %v, want ErrSchemaDrift", err)
	}
}
