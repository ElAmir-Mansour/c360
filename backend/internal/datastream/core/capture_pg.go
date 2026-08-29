package core

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/gob"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// This file contains the PostgreSQL replication drivers for WP-3 / DataStream:
//
//   - PGCapturer is the seed/watermark fallback used by DR/migration tests and
//     by estates where logical replication is not yet available. It performs the
//     initial full-state seed and a query-watermark delta drain.
//   - PGLogCapturer is the FR-SYNC-001 path: it consumes already-decoded
//     PostgreSQL logical log records from a PGLogSource and emits WAL frames
//     without table polling. A concrete pgoutput/wal2json source can satisfy
//     PGLogSource while this core remains independent of one plugin.
//
// The matching PGApplier idempotently applies insert/update/delete records to a
// target table, so replay after a transport resume converges to the same state.

// PGQuerier is the minimal pgx surface the PG capturer/applier need. It is
// satisfied by *pgxpool.Pool, *pgx.Conn and pgx.Tx, so callers pick the
// execution context; the core never imports pgxpool, staying generic.
type PGQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// PGTableConfig describes the source/target table for capture and apply. The
// primary-key columns make the apply idempotent (ON CONFLICT); the watermark
// column is the monotonic CDC cursor. Identifiers are quoted before use, so a
// caller passes bare names.
type PGTableConfig struct {
	// Schema is the table's schema (default "public").
	Schema string
	// Table is the table name (required).
	Table string
	// Columns is the full ordered column set to replicate (required). Must include
	// the primary-key columns and, for watermark capture, the watermark column.
	Columns []string
	// PrimaryKey is the conflict target for idempotent upsert (required).
	PrimaryKey []string
	// Watermark is the monotonic column that advances on every change. It is
	// required for watermark capture; logical replication uses SourceLSN instead.
	Watermark string
}

func (c PGTableConfig) schema() string {
	if c.Schema == "" {
		return "public"
	}
	return c.Schema
}

func (c PGTableConfig) qualified() string {
	return quoteIdent(c.schema()) + "." + quoteIdent(c.Table)
}

func (c PGTableConfig) validate() error {
	return c.validateShape(true)
}

func (c PGTableConfig) validateLog() error {
	return c.validateShape(false)
}

func (c PGTableConfig) validateShape(requireWatermark bool) error {
	if c.Table == "" {
		return errors.New("core: pg table config requires a table")
	}
	if len(c.Columns) == 0 {
		return errors.New("core: pg table config requires columns")
	}
	if len(c.PrimaryKey) == 0 {
		return errors.New("core: pg table config requires a primary key")
	}
	if requireWatermark && c.Watermark == "" {
		return errors.New("core: pg table config requires a watermark column")
	}
	set := make(map[string]struct{}, len(c.Columns))
	for _, col := range c.Columns {
		set[col] = struct{}{}
	}
	for _, pk := range c.PrimaryKey {
		if _, ok := set[pk]; !ok {
			return fmt.Errorf("core: pg primary key column %q not in Columns", pk)
		}
	}
	if c.Watermark != "" {
		if _, ok := set[c.Watermark]; !ok {
			return fmt.Errorf("core: pg watermark column %q not in Columns", c.Watermark)
		}
	}
	return nil
}

// quoteIdent safely quotes a PostgreSQL identifier (doubling embedded quotes).
func quoteIdent(id string) string {
	return `"` + strings.ReplaceAll(id, `"`, `""`) + `"`
}

// pgRowOp distinguishes the WAL-frame payload variants.
type pgRowOp uint8

const (
	pgOpUpsert   pgRowOp = 1 // a row present at the source (snapshot or changed)
	pgOpDelete   pgRowOp = 2 // a row deleted at the source, keyed by primary key
	pgOpTruncate pgRowOp = 3 // the configured source table was truncated
)

// ErrSchemaDrift is returned when a source schema, change record or row payload
// no longer matches the configured target shape. The pipeline treats this as a
// hard apply error, which pauses the stream; the service layer turns it into the
// SRS-required schema-drift alert/evolution-policy decision.
var ErrSchemaDrift = errors.New("core: postgres schema drift detected")

// PGCapturer reads change rows from a source table via the watermark column. It
// is the seed/fallback driver. The SRS log-based ClarioSync path is
// PGLogCapturer below.
type PGCapturer struct {
	db       PGQuerier
	streamID string
	cfg      PGTableConfig

	// PollInterval is how often the perpetual phase re-queries for new changes.
	PollInterval time.Duration
	// BatchSize bounds rows read per query (keeps frames and memory bounded).
	BatchSize int
	// Continuous, when false, makes Start return nil once the source is fully
	// drained (snapshot + all changes up to "now") instead of polling forever —
	// the mode tests and one-shot migration use.
	Continuous bool

	mu              sync.Mutex
	closed          bool
	resumeWatermark string // seeded via SetResumeWatermark for a live-stream resume
}

// NewPGCapturer builds a PG watermark-CDC capturer over db for the table in cfg.
func NewPGCapturer(db PGQuerier, streamID string, cfg PGTableConfig) (*PGCapturer, error) {
	if db == nil {
		return nil, errors.New("core: pg capturer requires a querier")
	}
	if streamID == "" {
		return nil, errors.New("core: pg capturer requires a stream id")
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return &PGCapturer{
		db:           db,
		streamID:     streamID,
		cfg:          cfg,
		PollInterval: time.Second,
		BatchSize:    1000,
	}, nil
}

// Kind reports the frame kind this capturer produces (WAL: row-level changes).
func (c *PGCapturer) Kind() FrameKind { return FrameKindWAL }

// Close marks the capturer closed; the underlying querier is owned by the
// caller and is not closed here.
func (c *PGCapturer) Close() error {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	return nil
}

// Start runs the snapshot phase (if no prior watermark) then the change-polling
// phase, emitting one WAL frame per changed row with the row's watermark as
// SourceLSN. Seq starts at resumeFrom+1. ctx cancellation or Close stops it. In
// non-Continuous mode it returns when the source is fully drained.
func (c *PGCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- Frame) error {
	seq := resumeFrom

	// Determine the resume watermark. The pipeline passes the checkpoint's
	// AppliedSeq as resumeFrom but the watermark itself lives in the frame
	// SourceLSN persisted alongside it; the caller seeds it via the
	// ResumeWatermark field when resuming a live stream. For a fresh stream it
	// is empty and we snapshot.
	c.mu.Lock()
	wm := c.resumeWatermark
	c.mu.Unlock()

	emit := func(kind FrameKind, payload []byte, lsn string) error {
		seq++
		f := Frame{
			StreamID:  c.streamID,
			Seq:       seq,
			Kind:      kind,
			Payload:   payload,
			SourceLSN: lsn,
			EmittedAt: time.Now(),
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- f:
			return nil
		}
	}

	if wm == "" {
		// SNAPSHOT phase: full table ordered by primary key.
		maxWM, err := c.snapshot(ctx, emit)
		if err != nil {
			return fmt.Errorf("core: pg capturer snapshot: %w", err)
		}
		wm = maxWM
		// A MARKER pins the snapshot's consistency point at the max watermark.
		if err := emit(FrameKindMarker, nil, wm); err != nil {
			return err
		}
		if !c.Continuous {
			return nil
		}
	}

	// CHANGE phase: rows whose watermark advanced past wm.
	for {
		if c.isClosed() {
			return nil
		}
		newWM, shipped, err := c.pollChanges(ctx, wm, emit)
		if err != nil {
			return fmt.Errorf("core: pg capturer poll: %w", err)
		}
		wm = newWM
		if !c.Continuous && shipped == 0 {
			return nil
		}
		if shipped == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(c.PollInterval):
			}
		}
	}
}

func (c *PGCapturer) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

func (c *PGCapturer) snapshot(ctx context.Context, emit func(FrameKind, []byte, string) error) (string, error) {
	cols := c.cfg.Columns
	colList := quoteIdentList(cols)
	// Order the snapshot by (watermark, primary key), NOT by primary key alone:
	// the per-row SourceLSN we emit is the watermark, and the Checkpointer
	// persists the last contiguously-applied row's watermark as source_lsn. With
	// watermark ordering, a crash mid-snapshot leaves "applied so far" == exactly
	// "watermark <= source_lsn", so a resume via WHERE watermark > source_lsn is
	// gap-free (no un-applied row with a smaller watermark is skipped).
	wmOrder := quoteIdent(c.cfg.Watermark) + ", " + quoteIdentList(c.cfg.PrimaryKey)
	sql := fmt.Sprintf("SELECT %s FROM %s ORDER BY %s", colList, c.cfg.qualified(), wmOrder)

	rows, err := c.db.Query(ctx, sql)
	if err != nil {
		return "", fmt.Errorf("query snapshot: %w", err)
	}
	defer rows.Close()

	wmIdx := indexOf(cols, c.cfg.Watermark)
	var maxWM string
	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return "", fmt.Errorf("read snapshot row: %w", err)
		}
		wmText := watermarkText(vals[wmIdx])
		// Rows are ordered by the typed watermark column, so the last row seen is
		// the true high-water mark. Do not compare rendered cursor strings: some
		// timestamp layouts are not lexicographically sortable.
		maxWM = wmText
		payload, err := encodePGRow(cols, vals)
		if err != nil {
			return "", err
		}
		if err := emit(FrameKindSnapshotChunk, payload, wmText); err != nil {
			return "", err
		}
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("scan snapshot: %w", err)
	}
	return maxWM, nil
}

// pollChanges ships rows whose watermark is strictly greater than afterWM,
// ordered by (watermark, primary key) for a deterministic, gap-free cursor.
// Returns the new high watermark and the number of rows shipped.
func (c *PGCapturer) pollChanges(ctx context.Context, afterWM string, emit func(FrameKind, []byte, string) error) (string, int, error) {
	cols := c.cfg.Columns
	colList := quoteIdentList(cols)
	wmCol := quoteIdent(c.cfg.Watermark)
	order := wmCol + ", " + quoteIdentList(c.cfg.PrimaryKey)

	limit := c.BatchSize
	if limit <= 0 {
		limit = 1000
	}

	wmIdx := indexOf(cols, c.cfg.Watermark)
	highWM := afterWM
	total := 0

	for {
		var (
			rows pgx.Rows
			err  error
			sql  string
		)
		if afterWM == "" {
			sql = fmt.Sprintf("SELECT %s FROM %s ORDER BY %s LIMIT %d", colList, c.cfg.qualified(), order, limit)
			rows, err = c.db.Query(ctx, sql)
		} else {
			sql = fmt.Sprintf("SELECT %s FROM %s WHERE %s > $1 ORDER BY %s LIMIT %d", colList, c.cfg.qualified(), wmCol, order, limit)
			rows, err = c.db.Query(ctx, sql, afterWM)
		}
		if err != nil {
			return highWM, total, fmt.Errorf("query changes: %w", err)
		}

		batch := 0
		var batchErr error
		for rows.Next() {
			vals, verr := rows.Values()
			if verr != nil {
				batchErr = fmt.Errorf("read change row: %w", verr)
				break
			}
			wmText := watermarkText(vals[wmIdx])
			highWM = wmText
			payload, perr := encodePGRow(cols, vals)
			if perr != nil {
				batchErr = perr
				break
			}
			if eerr := emit(FrameKindWAL, payload, wmText); eerr != nil {
				batchErr = eerr
				break
			}
			batch++
			total++
		}
		rerr := rows.Err()
		rows.Close()
		if batchErr != nil {
			return highWM, total, batchErr
		}
		if rerr != nil {
			return highWM, total, fmt.Errorf("scan changes: %w", rerr)
		}
		afterWM = highWM
		if batch < limit {
			break // drained
		}
	}
	return highWM, total, nil
}

// SetResumeWatermark seeds the change phase so a live-stream resume polls rows
// strictly greater than wm rather than re-snapshotting. The agent passes the
// last applied frame's SourceLSN here on reconnect.
func (c *PGCapturer) SetResumeWatermark(wm string) {
	c.mu.Lock()
	c.resumeWatermark = wm
	c.mu.Unlock()
}

// --- PostgreSQL log-record CDC capturer ----------------------------------

// PGChangeOp is the operation decoded from the database transaction log.
type PGChangeOp string

const (
	PGChangeInsert   PGChangeOp = "insert"
	PGChangeUpdate   PGChangeOp = "update"
	PGChangeDelete   PGChangeOp = "delete"
	PGChangeTruncate PGChangeOp = "truncate"
)

func (o PGChangeOp) valid() bool {
	switch o {
	case PGChangeInsert, PGChangeUpdate, PGChangeDelete, PGChangeTruncate:
		return true
	default:
		return false
	}
}

// PGLogRecord is one decoded logical-replication change. For insert/update,
// Columns/Values hold the complete row image. For delete, KeyColumns/KeyValues
// hold the primary-key identity that must be removed at the target. Truncate
// records identify the table only and carry no row values.
type PGLogRecord struct {
	Op         PGChangeOp
	Schema     string
	Table      string
	LSN        string
	CommitTime time.Time

	Columns []string
	Values  []any

	KeyColumns []string
	KeyValues  []any
}

// PGLogSource is the source-side logical replication adapter. Implementations
// read the database log (for example pgoutput or wal2json) and return decoded
// records in commit order. io.EOF means the current log stream is drained.
type PGLogSource interface {
	Next(ctx context.Context, afterLSN string) (PGLogRecord, error)
	Close() error
}

// PGLogCapturer emits WAL frames from PostgreSQL logical log records. It does
// not query the source table; it consumes the log-source cursor and resumes from
// the checkpointed SourceLSN.
type PGLogCapturer struct {
	source   PGLogSource
	streamID string
	cfg      PGTableConfig

	PollInterval time.Duration
	Continuous   bool

	mu        sync.Mutex
	closed    bool
	resumeLSN string
}

// NewPGLogCapturer builds the FR-SYNC-001 log-based CDC capturer.
func NewPGLogCapturer(source PGLogSource, streamID string, cfg PGTableConfig) (*PGLogCapturer, error) {
	if source == nil {
		return nil, errors.New("core: pg log capturer requires a log source")
	}
	if streamID == "" {
		return nil, errors.New("core: pg log capturer requires a stream id")
	}
	if err := cfg.validateLog(); err != nil {
		return nil, err
	}
	return &PGLogCapturer{
		source:       source,
		streamID:     streamID,
		cfg:          cfg,
		PollInterval: time.Second,
		Continuous:   true,
	}, nil
}

func (c *PGLogCapturer) Kind() FrameKind { return FrameKindWAL }

func (c *PGLogCapturer) Close() error {
	c.mu.Lock()
	c.closed = true
	c.mu.Unlock()
	return c.source.Close()
}

// AckSourceLSN forwards a durable pipeline checkpoint to log sources that can
// acknowledge source progress, such as PostgreSQL logical replication slots.
func (c *PGLogCapturer) AckSourceLSN(ctx context.Context, sourceLSN string) error {
	acker, ok := c.source.(interface {
		AckLSN(context.Context, string) error
	})
	if !ok {
		return nil
	}
	return acker.AckLSN(ctx, sourceLSN)
}

func (c *PGLogCapturer) isClosed() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closed
}

// SetResumeLSN seeds the logical-log cursor from a persisted checkpoint.
func (c *PGLogCapturer) SetResumeLSN(lsn string) {
	c.mu.Lock()
	c.resumeLSN = lsn
	c.mu.Unlock()
}

// Start consumes decoded logical-log records and emits one WAL frame per record.
// A non-zero resumeFrom requires the caller to seed the matching resume LSN so
// the source can continue from the exact log cursor, not from a table scan.
func (c *PGLogCapturer) Start(ctx context.Context, resumeFrom uint64, out chan<- Frame) error {
	seq := resumeFrom
	c.mu.Lock()
	lsn := c.resumeLSN
	c.mu.Unlock()
	if resumeFrom > 0 && lsn == "" {
		return errors.New("core: pg log capturer resume requires a source LSN")
	}

	for {
		if c.isClosed() {
			return nil
		}
		rec, err := c.source.Next(ctx, lsn)
		if errors.Is(err, io.EOF) {
			if !c.Continuous {
				return nil
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(c.PollInterval):
				continue
			}
		}
		if err != nil {
			return fmt.Errorf("core: pg log capturer next after %q: %w", lsn, err)
		}
		if !c.recordMatches(rec) {
			if rec.LSN != "" {
				lsn = rec.LSN
			}
			continue
		}
		payload, err := encodePGLogRecord(c.cfg, rec)
		if err != nil {
			return err
		}
		seq++
		emittedAt := rec.CommitTime
		if emittedAt.IsZero() {
			emittedAt = time.Now()
		}
		f := Frame{
			StreamID:  c.streamID,
			Seq:       seq,
			Kind:      FrameKindWAL,
			Payload:   payload,
			SourceLSN: rec.LSN,
			EmittedAt: emittedAt,
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case out <- f:
		}
		lsn = rec.LSN
	}
}

func (c *PGLogCapturer) recordMatches(rec PGLogRecord) bool {
	if rec.Table != c.cfg.Table {
		return false
	}
	return rec.Schema == "" || rec.Schema == c.cfg.schema()
}

func encodePGLogRecord(cfg PGTableConfig, rec PGLogRecord) ([]byte, error) {
	if !rec.Op.valid() {
		return nil, fmt.Errorf("core: pg log record has invalid op %q", rec.Op)
	}
	if rec.LSN == "" {
		return nil, errors.New("core: pg log record requires an LSN")
	}
	switch rec.Op {
	case PGChangeInsert, PGChangeUpdate:
		if !equalStringSlice(rec.Columns, cfg.Columns) {
			return nil, fmt.Errorf("core: pg log columns %v do not match configured %v: %w", rec.Columns, cfg.Columns, ErrSchemaDrift)
		}
		return encodePGRow(rec.Columns, rec.Values)
	case PGChangeDelete:
		keyCols := rec.KeyColumns
		keyVals := rec.KeyValues
		if len(keyCols) == 0 {
			keyCols = cfg.PrimaryKey
		}
		if !equalStringSlice(keyCols, cfg.PrimaryKey) {
			return nil, fmt.Errorf("core: pg delete key columns %v do not match configured primary key %v: %w", keyCols, cfg.PrimaryKey, ErrSchemaDrift)
		}
		return encodePGDelete(keyCols, keyVals)
	case PGChangeTruncate:
		return encodePGTruncate()
	default:
		return nil, fmt.Errorf("core: pg log record has invalid op %q", rec.Op)
	}
}

// --- PG applier -----------------------------------------------------------

// PGApplier idempotently upserts replicated rows into a target table via
// INSERT ... ON CONFLICT (pk) DO UPDATE. Snapshot and WAL frames both carry a
// full row, so applying the same Seq twice (a duplicate after resume) converges
// to the same row state — a safe no-op. Markers are consistency points.
type PGApplier struct {
	db  PGQuerier
	cfg PGTableConfig

	insertSQL string
	deleteSQL string
	applied   uint64
	mu        sync.Mutex
}

// NewPGApplier builds an idempotent upsert applier for the table in cfg.
func NewPGApplier(db PGQuerier, cfg PGTableConfig) (*PGApplier, error) {
	if db == nil {
		return nil, errors.New("core: pg applier requires a querier")
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	a := &PGApplier{db: db, cfg: cfg}
	a.insertSQL = a.buildUpsertSQL()
	a.deleteSQL = a.buildDeleteSQL()
	return a, nil
}

// Kind reports the frame kind this applier consumes (WAL row changes). The
// pipeline also routes SNAPSHOT_CHUNK and MARKER frames to it; Apply handles
// all three.
func (a *PGApplier) Kind() FrameKind { return FrameKindWAL }

func (a *PGApplier) buildUpsertSQL() string {
	cols := a.cfg.Columns
	placeholders := make([]string, len(cols))
	for i := range cols {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
	}
	pkSet := make(map[string]struct{}, len(a.cfg.PrimaryKey))
	for _, pk := range a.cfg.PrimaryKey {
		pkSet[pk] = struct{}{}
	}
	var updates []string
	for _, col := range cols {
		if _, isPK := pkSet[col]; isPK {
			continue
		}
		updates = append(updates, fmt.Sprintf("%s = EXCLUDED.%s", quoteIdent(col), quoteIdent(col)))
	}
	conflict := quoteIdentList(a.cfg.PrimaryKey)
	if len(updates) == 0 {
		return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO NOTHING",
			a.cfg.qualified(), quoteIdentList(cols), strings.Join(placeholders, ", "), conflict)
	}
	return fmt.Sprintf("INSERT INTO %s (%s) VALUES (%s) ON CONFLICT (%s) DO UPDATE SET %s",
		a.cfg.qualified(), quoteIdentList(cols), strings.Join(placeholders, ", "), conflict, strings.Join(updates, ", "))
}

func (a *PGApplier) buildDeleteSQL() string {
	predicates := make([]string, len(a.cfg.PrimaryKey))
	for i, col := range a.cfg.PrimaryKey {
		predicates[i] = fmt.Sprintf("%s = $%d", quoteIdent(col), i+1)
	}
	return fmt.Sprintf("DELETE FROM %s WHERE %s", a.cfg.qualified(), strings.Join(predicates, " AND "))
}

// Apply upserts one row frame (snapshot or WAL) or no-ops on a marker, returning
// f.Seq as the applied cursor.
func (a *PGApplier) Apply(ctx context.Context, f Frame) (uint64, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	switch f.Kind {
	case FrameKindMarker:
		a.mu.Lock()
		a.applied = f.Seq
		a.mu.Unlock()
		return f.Seq, nil
	case FrameKindSnapshotChunk, FrameKindWAL:
		op, err := pgPayloadOp(f.Payload)
		if err != nil {
			return 0, fmt.Errorf("core: pg applier seq=%d decode op: %w", f.Seq, err)
		}
		switch op {
		case pgOpUpsert:
			cols, vals, err := decodePGRow(f.Payload)
			if err != nil {
				return 0, fmt.Errorf("core: pg applier seq=%d decode row: %w", f.Seq, err)
			}
			if !equalStringSlice(cols, a.cfg.Columns) {
				return 0, fmt.Errorf("core: pg applier seq=%d row columns %v do not match target %v: %w", f.Seq, cols, a.cfg.Columns, ErrSchemaDrift)
			}
			if _, err := a.db.Exec(ctx, a.insertSQL, vals...); err != nil {
				return 0, fmt.Errorf("core: pg applier seq=%d upsert: %w", f.Seq, err)
			}
		case pgOpDelete:
			keyCols, keyVals, err := decodePGDelete(f.Payload)
			if err != nil {
				return 0, fmt.Errorf("core: pg applier seq=%d decode delete: %w", f.Seq, err)
			}
			if !equalStringSlice(keyCols, a.cfg.PrimaryKey) {
				return 0, fmt.Errorf("core: pg applier seq=%d delete key columns %v do not match target primary key %v: %w", f.Seq, keyCols, a.cfg.PrimaryKey, ErrSchemaDrift)
			}
			if _, err := a.db.Exec(ctx, a.deleteSQL, keyVals...); err != nil {
				return 0, fmt.Errorf("core: pg applier seq=%d delete: %w", f.Seq, err)
			}
		case pgOpTruncate:
			if err := decodePGTruncate(f.Payload); err != nil {
				return 0, fmt.Errorf("core: pg applier seq=%d decode truncate: %w", f.Seq, err)
			}
			if _, err := a.db.Exec(ctx, fmt.Sprintf("TRUNCATE TABLE %s", a.cfg.qualified())); err != nil {
				return 0, fmt.Errorf("core: pg applier seq=%d truncate: %w", f.Seq, err)
			}
		default:
			return 0, fmt.Errorf("core: pg applier seq=%d unknown row op %d", f.Seq, op)
		}
		a.mu.Lock()
		a.applied = f.Seq
		a.mu.Unlock()
		return f.Seq, nil
	default:
		return 0, fmt.Errorf("core: pg applier seq=%d unexpected kind %s", f.Seq, f.Kind)
	}
}

// --- row payload codec -----------------------------------------------------
//
// A row payload is [1B op][4B colCount][gob-encoded ([]string cols, []any vals)].
// gob handles the concrete pgx value types (int64, float64, string, bool,
// []byte, time.Time, nil) portably and the applier passes the []any straight
// into a parameterized upsert so PostgreSQL performs the final type coercion —
// real round-tripping, not stringification.

func init() {
	// Register types pgx commonly returns from Rows.Values so gob can encode the
	// interface values.
	gob.Register(time.Time{})
	gob.Register([]byte(nil))
}

func encodePGRow(cols []string, vals []any) ([]byte, error) {
	if len(cols) != len(vals) {
		return nil, fmt.Errorf("core: pg encode row: %d cols vs %d vals", len(cols), len(vals))
	}
	norm := make([]any, len(vals))
	for i, v := range vals {
		norm[i] = normalizePGValue(v)
	}
	var buf bytes.Buffer
	buf.WriteByte(byte(pgOpUpsert))
	var cnt [4]byte
	binary.BigEndian.PutUint32(cnt[:], uint32(len(cols)))
	buf.Write(cnt[:])
	enc := gob.NewEncoder(&buf)
	if err := enc.Encode(cols); err != nil {
		return nil, fmt.Errorf("core: pg encode row cols: %w", err)
	}
	if err := enc.Encode(norm); err != nil {
		return nil, fmt.Errorf("core: pg encode row vals: %w", err)
	}
	return buf.Bytes(), nil
}

func pgPayloadOp(payload []byte) (pgRowOp, error) {
	if len(payload) < 1 {
		return 0, errors.New("empty pg row payload")
	}
	return pgRowOp(payload[0]), nil
}

func decodePGRow(payload []byte) ([]string, []any, error) {
	if len(payload) < 5 {
		return nil, nil, errors.New("truncated pg row payload")
	}
	if pgRowOp(payload[0]) != pgOpUpsert {
		return nil, nil, fmt.Errorf("unknown pg row op %d", payload[0])
	}
	wantCols := int(binary.BigEndian.Uint32(payload[1:5]))
	r := bytes.NewReader(payload[5:])
	dec := gob.NewDecoder(r)
	var cols []string
	if err := dec.Decode(&cols); err != nil {
		return nil, nil, fmt.Errorf("decode pg row cols: %w", err)
	}
	if len(cols) != wantCols {
		return nil, nil, fmt.Errorf("decoded %d columns, payload declared %d", len(cols), wantCols)
	}
	var vals []any
	if err := dec.Decode(&vals); err != nil {
		return nil, nil, fmt.Errorf("decode pg row vals: %w", err)
	}
	if len(vals) != len(cols) {
		return nil, nil, fmt.Errorf("decoded %d values for %d columns", len(vals), len(cols))
	}
	return cols, vals, nil
}

func encodePGDelete(keyCols []string, keyVals []any) ([]byte, error) {
	if len(keyCols) == 0 {
		return nil, errors.New("core: pg delete requires key columns")
	}
	if len(keyCols) != len(keyVals) {
		return nil, fmt.Errorf("core: pg delete encode: %d key cols vs %d vals", len(keyCols), len(keyVals))
	}
	norm := make([]any, len(keyVals))
	for i, v := range keyVals {
		norm[i] = normalizePGValue(v)
	}
	var buf bytes.Buffer
	buf.WriteByte(byte(pgOpDelete))
	var cnt [4]byte
	binary.BigEndian.PutUint32(cnt[:], uint32(len(keyCols)))
	buf.Write(cnt[:])
	enc := gob.NewEncoder(&buf)
	if err := enc.Encode(keyCols); err != nil {
		return nil, fmt.Errorf("core: pg encode delete cols: %w", err)
	}
	if err := enc.Encode(norm); err != nil {
		return nil, fmt.Errorf("core: pg encode delete vals: %w", err)
	}
	return buf.Bytes(), nil
}

func decodePGDelete(payload []byte) ([]string, []any, error) {
	if len(payload) < 5 {
		return nil, nil, errors.New("truncated pg delete payload")
	}
	if pgRowOp(payload[0]) != pgOpDelete {
		return nil, nil, fmt.Errorf("unknown pg delete op %d", payload[0])
	}
	wantCols := int(binary.BigEndian.Uint32(payload[1:5]))
	r := bytes.NewReader(payload[5:])
	dec := gob.NewDecoder(r)
	var cols []string
	if err := dec.Decode(&cols); err != nil {
		return nil, nil, fmt.Errorf("decode pg delete cols: %w", err)
	}
	if len(cols) != wantCols {
		return nil, nil, fmt.Errorf("decoded %d delete columns, payload declared %d", len(cols), wantCols)
	}
	var vals []any
	if err := dec.Decode(&vals); err != nil {
		return nil, nil, fmt.Errorf("decode pg delete vals: %w", err)
	}
	if len(vals) != len(cols) {
		return nil, nil, fmt.Errorf("decoded %d delete values for %d columns", len(vals), len(cols))
	}
	return cols, vals, nil
}

func encodePGTruncate() ([]byte, error) {
	return []byte{byte(pgOpTruncate)}, nil
}

func decodePGTruncate(payload []byte) error {
	if len(payload) != 1 {
		return fmt.Errorf("invalid pg truncate payload length %d", len(payload))
	}
	if pgRowOp(payload[0]) != pgOpTruncate {
		return fmt.Errorf("unknown pg truncate op %d", payload[0])
	}
	return nil
}

// normalizePGValue maps pgx-returned values to gob-encodable, upsert-safe forms.
// Numeric/array/JSON types pgx returns as concrete Go types pass through; types
// gob cannot handle (e.g. pgtype structs, [16]byte UUIDs) are rendered to a
// stable textual form Postgres will coerce on the way back in.
func normalizePGValue(v any) any {
	switch t := v.(type) {
	case nil:
		return nil
	case bool, string, int, int16, int32, int64, uint, uint16, uint32, uint64, float32, float64, []byte, time.Time:
		return t
	case [16]byte: // pgx returns UUID as [16]byte
		return uuidText(t)
	default:
		// Fall back to the Stringer / fmt form, which Postgres coerces from text
		// for the column's type on upsert.
		return fmt.Sprintf("%v", t)
	}
}

func uuidText(b [16]byte) string {
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// watermarkText renders a watermark column value to the stable text form used as
// the frame SourceLSN and the WHERE > comparison key. time.Time uses a fixed
// width RFC3339 layout because time.RFC3339Nano trims zeros, which is unsafe if
// a caller ever sorts or compares rendered cursors.
func watermarkText(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case time.Time:
		return t.UTC().Format("2006-01-02T15:04:05.000000000Z07:00")
	case []byte:
		return string(t)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func quoteIdentList(cols []string) string {
	out := make([]string, len(cols))
	for i, c := range cols {
		out[i] = quoteIdent(c)
	}
	return strings.Join(out, ", ")
}

func indexOf(s []string, v string) int {
	for i, x := range s {
		if x == v {
			return i
		}
	}
	return -1
}

func equalStringSlice(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
