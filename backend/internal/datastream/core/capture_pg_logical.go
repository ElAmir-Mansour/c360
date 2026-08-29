package core

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgproto3"
)

const (
	pgLogicalCopyDataWAL       = byte('w')
	pgLogicalCopyDataKeepalive = byte('k')
	pgLogicalStandbyStatus     = byte('r')
	pgLogicalEpochMicros       = int64(946684800000000) // 2000-01-01T00:00:00Z, PostgreSQL epoch.
)

// PGLogicalReplicationMessage is one server message from PostgreSQL's logical
// replication CopyBoth stream. WALData is decoded by an output-plugin decoder
// such as wal2json; keepalives carry no row payload.
type PGLogicalReplicationMessage struct {
	WALStartLSN     uint64
	ServerWALEndLSN uint64
	ServerTime      time.Time
	WALData         []byte
	Keepalive       bool
	ReplyRequested  bool
}

// PGLogicalReplicationReader is the PostgreSQL protocol seam used by
// PGLogicalReplicationSource. Production uses PGConnLogicalReplicationReader;
// tests can script decoded CopyData messages without a live server.
type PGLogicalReplicationReader interface {
	Start(ctx context.Context, startLSN uint64) error
	Receive(ctx context.Context) (PGLogicalReplicationMessage, error)
	SendStandbyStatus(ctx context.Context, appliedLSN uint64) error
	Close() error
}

// PGLogicalDecoder decodes output-plugin payloads into core log records.
type PGLogicalDecoder interface {
	Decode(msg PGLogicalReplicationMessage) ([]PGLogRecord, error)
}

// PGLogicalDecoderFunc adapts a function into a PGLogicalDecoder.
type PGLogicalDecoderFunc func(PGLogicalReplicationMessage) ([]PGLogRecord, error)

func (f PGLogicalDecoderFunc) Decode(msg PGLogicalReplicationMessage) ([]PGLogRecord, error) {
	return f(msg)
}

// PGLogicalReplicationSource adapts PostgreSQL logical-replication messages to
// the existing PGLogSource contract. It starts the slot at the checkpoint LSN,
// decodes plugin payloads in order, skips records at or before the resume LSN on
// startup, and fails closed on malformed WAL payloads.
type PGLogicalReplicationSource struct {
	reader  PGLogicalReplicationReader
	decoder PGLogicalDecoder

	mu      sync.Mutex
	started bool
	closed  bool

	resumeLSN uint64
	statusLSN uint64
	pending   []PGLogRecord
}

func NewPGLogicalReplicationSource(reader PGLogicalReplicationReader, decoder PGLogicalDecoder) (*PGLogicalReplicationSource, error) {
	if reader == nil {
		return nil, errors.New("core: pg logical source requires a replication reader")
	}
	if decoder == nil {
		return nil, errors.New("core: pg logical source requires a decoder")
	}
	return &PGLogicalReplicationSource{reader: reader, decoder: decoder}, nil
}

func (s *PGLogicalReplicationSource) Next(ctx context.Context, afterLSN string) (PGLogRecord, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return PGLogRecord{}, io.EOF
	}
	if !s.started {
		resumeLSN, err := parsePGLogicalLSN(afterLSN)
		if err != nil {
			s.mu.Unlock()
			return PGLogRecord{}, fmt.Errorf("core: pg logical source parse resume LSN %q: %w", afterLSN, err)
		}
		s.resumeLSN = resumeLSN
		s.started = true
		s.mu.Unlock()
		if err := s.reader.Start(ctx, resumeLSN); err != nil {
			s.mu.Lock()
			s.started = false
			s.mu.Unlock()
			return PGLogRecord{}, fmt.Errorf("core: pg logical source start replication at %s: %w", formatPGLogicalLSN(resumeLSN), err)
		}
	} else {
		s.mu.Unlock()
	}

	for {
		if err := ctx.Err(); err != nil {
			return PGLogRecord{}, err
		}
		if rec, ok, err := s.shiftPending(); ok || err != nil {
			return rec, err
		}

		msg, err := s.reader.Receive(ctx)
		if err != nil {
			return PGLogRecord{}, err
		}
		if msg.Keepalive {
			if msg.ReplyRequested {
				if err := s.sendStandbyStatus(ctx, s.currentResumeLSN(), true); err != nil {
					return PGLogRecord{}, fmt.Errorf("core: pg logical source send standby status: %w", err)
				}
			}
			continue
		}
		recs, err := s.decoder.Decode(msg)
		if err != nil {
			return PGLogRecord{}, fmt.Errorf("core: pg logical source decode WAL at %s: %w", formatPGLogicalLSN(msg.WALStartLSN), err)
		}
		if len(recs) == 0 {
			continue
		}
		normalized := make([]PGLogRecord, 0, len(recs))
		for i := range recs {
			rec := recs[i]
			if rec.LSN == "" {
				rec.LSN = formatPGLogicalLSN(msg.WALStartLSN)
			}
			recLSN, err := parsePGLogicalLSN(rec.LSN)
			if err != nil {
				return PGLogRecord{}, fmt.Errorf("core: pg logical source decoded invalid LSN %q: %w", rec.LSN, err)
			}
			if rec.CommitTime.IsZero() {
				rec.CommitTime = msg.ServerTime
			}
			if recLSN <= s.resumeLSN {
				continue
			}
			normalized = append(normalized, rec)
		}
		if len(normalized) == 0 {
			continue
		}
		s.mu.Lock()
		s.pending = append(s.pending, normalized...)
		s.mu.Unlock()
	}
}

func (s *PGLogicalReplicationSource) shiftPending() (PGLogRecord, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.pending) == 0 {
		return PGLogRecord{}, false, nil
	}
	rec := s.pending[0]
	s.pending = s.pending[1:]
	lsn, err := parsePGLogicalLSN(rec.LSN)
	if err != nil {
		return PGLogRecord{}, true, fmt.Errorf("core: pg logical source pending invalid LSN %q: %w", rec.LSN, err)
	}
	if lsn > s.resumeLSN {
		s.resumeLSN = lsn
	}
	return rec, true, nil
}

// AckLSN records a durable downstream cursor and sends PostgreSQL standby
// status feedback. It is idempotent for duplicate or older LSNs.
func (s *PGLogicalReplicationSource) AckLSN(ctx context.Context, lsn string) error {
	n, err := parsePGLogicalLSN(lsn)
	if err != nil {
		return fmt.Errorf("core: pg logical source ack invalid LSN %q: %w", lsn, err)
	}
	if n == 0 {
		return nil
	}
	if err := s.sendStandbyStatus(ctx, n, false); err != nil {
		return fmt.Errorf("core: pg logical source ack standby status %s: %w", formatPGLogicalLSN(n), err)
	}
	return nil
}

func (s *PGLogicalReplicationSource) currentResumeLSN() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.resumeLSN
}

func (s *PGLogicalReplicationSource) sendStandbyStatus(ctx context.Context, lsn uint64, force bool) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return io.EOF
	}
	if !force && lsn <= s.statusLSN {
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()
	if err := s.reader.SendStandbyStatus(ctx, lsn); err != nil {
		return err
	}
	s.mu.Lock()
	if lsn > s.statusLSN {
		s.statusLSN = lsn
	}
	s.mu.Unlock()
	return nil
}

func (s *PGLogicalReplicationSource) Close() error {
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	return s.reader.Close()
}

// PGConnLogicalReplicationConfig configures a production logical replication
// reader over pgconn. PluginArgs are raw START_REPLICATION option fragments,
// e.g. `"include-xids" '0'`; callers should construct them from trusted config.
type PGConnLogicalReplicationConfig struct {
	ConnString string
	SlotName   string
	PluginArgs []string
}

// NewPGWal2JSONLogSource builds a PGLogSource backed by a PostgreSQL logical
// replication slot using the wal2json output plugin.
func NewPGWal2JSONLogSource(ctx context.Context, cfg PGConnLogicalReplicationConfig) (*PGLogicalReplicationSource, error) {
	reader, err := NewPGConnLogicalReplicationReader(ctx, cfg)
	if err != nil {
		return nil, err
	}
	src, err := NewPGLogicalReplicationSource(reader, PGWal2JSONDecoder{})
	if err != nil {
		_ = reader.Close()
		return nil, err
	}
	return src, nil
}

// NewPGOutputLogSource builds a PGLogSource backed by PostgreSQL's built-in
// pgoutput plugin. cfg.PluginArgs must include pgoutput START_REPLICATION
// options; callers can use PGOutputPluginArgs for the standard proto v1 path.
func NewPGOutputLogSource(ctx context.Context, cfg PGConnLogicalReplicationConfig) (*PGLogicalReplicationSource, error) {
	if len(cfg.PluginArgs) == 0 {
		return nil, errors.New("core: pgoutput log source requires plugin args; use PGOutputPluginArgs(publication)")
	}
	reader, err := NewPGConnLogicalReplicationReader(ctx, cfg)
	if err != nil {
		return nil, err
	}
	src, err := NewPGLogicalReplicationSource(reader, NewPGOutputDecoder())
	if err != nil {
		_ = reader.Close()
		return nil, err
	}
	return src, nil
}

// PGOutputPluginArgs returns safe START_REPLICATION options for PostgreSQL's
// built-in pgoutput plugin. Publication names are value-quoted, not interpolated
// as SQL identifiers.
func PGOutputPluginArgs(publications ...string) ([]string, error) {
	if len(publications) == 0 {
		return nil, errors.New("core: pgoutput requires at least one publication")
	}
	names := make([]string, len(publications))
	for i, publication := range publications {
		publication = strings.TrimSpace(publication)
		if publication == "" {
			return nil, errors.New("core: pgoutput publication name cannot be empty")
		}
		names[i] = publication
	}
	return []string{
		"proto_version '1'",
		"publication_names " + pgReplicationStringLiteral(strings.Join(names, ",")),
	}, nil
}

// PGConnLogicalReplicationReader speaks PostgreSQL's CopyBoth logical
// replication protocol on a pgconn connection in replication=database mode.
type PGConnLogicalReplicationReader struct {
	conn     net.Conn
	frontend *pgproto3.Frontend
	slotName string
	args     []string

	mu      sync.Mutex
	started bool
	closed  bool
}

func NewPGConnLogicalReplicationReader(ctx context.Context, cfg PGConnLogicalReplicationConfig) (*PGConnLogicalReplicationReader, error) {
	if cfg.ConnString == "" {
		return nil, errors.New("core: pg logical reader requires a connection string")
	}
	if err := validatePGReplicationSlotName(cfg.SlotName); err != nil {
		return nil, err
	}
	pgCfg, err := pgconn.ParseConfig(cfg.ConnString)
	if err != nil {
		return nil, fmt.Errorf("core: pg logical reader parse config: %w", err)
	}
	if pgCfg.RuntimeParams == nil {
		pgCfg.RuntimeParams = make(map[string]string)
	}
	pgCfg.RuntimeParams["replication"] = "database"
	pgConn, err := pgconn.ConnectConfig(ctx, pgCfg)
	if err != nil {
		return nil, fmt.Errorf("core: pg logical reader connect: %w", err)
	}
	if err := pgConn.SyncConn(ctx); err != nil {
		_ = pgConn.Close(context.Background())
		return nil, fmt.Errorf("core: pg logical reader sync connection: %w", err)
	}
	hc, err := pgConn.Hijack()
	if err != nil {
		_ = pgConn.Close(context.Background())
		return nil, fmt.Errorf("core: pg logical reader hijack connection: %w", err)
	}
	return &PGConnLogicalReplicationReader{
		conn:     hc.Conn,
		frontend: hc.Frontend,
		slotName: cfg.SlotName,
		args:     append([]string(nil), cfg.PluginArgs...),
	}, nil
}

func (r *PGConnLogicalReplicationReader) Start(ctx context.Context, startLSN uint64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return io.EOF
	}
	if r.started {
		return nil
	}
	query := fmt.Sprintf("START_REPLICATION SLOT %s LOGICAL %s", r.slotName, formatPGLogicalLSN(startLSN))
	if len(r.args) > 0 {
		query += " (" + strings.Join(r.args, ", ") + ")"
	}
	if err := r.withDeadline(ctx, false); err != nil {
		return err
	}
	defer r.clearDeadline()
	r.frontend.SendQuery(&pgproto3.Query{String: query})
	if err := r.frontend.Flush(); err != nil {
		return fmt.Errorf("send START_REPLICATION: %w", err)
	}
	for {
		msg, err := r.frontend.Receive()
		if err != nil {
			return normalizePGContextErr(ctx, err)
		}
		switch msg := msg.(type) {
		case *pgproto3.CopyBothResponse:
			r.started = true
			return nil
		case *pgproto3.ErrorResponse:
			return pgconn.ErrorResponseToPgError(msg)
		case *pgproto3.NoticeResponse, *pgproto3.ParameterStatus:
			continue
		case *pgproto3.ReadyForQuery:
			return errors.New("core: pg logical reader replication ended before CopyBoth")
		default:
			return fmt.Errorf("core: pg logical reader unexpected start message %T", msg)
		}
	}
}

func (r *PGConnLogicalReplicationReader) Receive(ctx context.Context) (PGLogicalReplicationMessage, error) {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return PGLogicalReplicationMessage{}, io.EOF
	}
	r.mu.Unlock()
	if err := r.withDeadline(ctx, false); err != nil {
		return PGLogicalReplicationMessage{}, err
	}
	defer r.clearDeadline()
	for {
		msg, err := r.frontend.Receive()
		if err != nil {
			return PGLogicalReplicationMessage{}, normalizePGContextErr(ctx, err)
		}
		switch msg := msg.(type) {
		case *pgproto3.CopyData:
			return DecodePGReplicationCopyData(msg.Data)
		case *pgproto3.ErrorResponse:
			return PGLogicalReplicationMessage{}, pgconn.ErrorResponseToPgError(msg)
		case *pgproto3.NoticeResponse, *pgproto3.ParameterStatus, *pgproto3.CopyBothResponse:
			continue
		case *pgproto3.ReadyForQuery:
			return PGLogicalReplicationMessage{}, io.EOF
		default:
			return PGLogicalReplicationMessage{}, fmt.Errorf("core: pg logical reader unexpected message %T", msg)
		}
	}
}

func (r *PGConnLogicalReplicationReader) SendStandbyStatus(ctx context.Context, appliedLSN uint64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return io.EOF
	}
	if err := r.withDeadline(ctx, true); err != nil {
		return err
	}
	defer r.clearDeadline()
	data := make([]byte, 1+8+8+8+8+1)
	data[0] = pgLogicalStandbyStatus
	binary.BigEndian.PutUint64(data[1:9], appliedLSN)
	binary.BigEndian.PutUint64(data[9:17], appliedLSN)
	binary.BigEndian.PutUint64(data[17:25], appliedLSN)
	binary.BigEndian.PutUint64(data[25:33], uint64((time.Now().UTC().UnixMicro())-pgLogicalEpochMicros))
	r.frontend.Send(&pgproto3.CopyData{Data: data})
	if err := r.frontend.Flush(); err != nil {
		return fmt.Errorf("send standby status: %w", err)
	}
	return nil
}

func (r *PGConnLogicalReplicationReader) Close() error {
	r.mu.Lock()
	if r.closed {
		r.mu.Unlock()
		return nil
	}
	r.closed = true
	conn := r.conn
	r.mu.Unlock()
	if conn == nil {
		return nil
	}
	return conn.Close()
}

func (r *PGConnLogicalReplicationReader) withDeadline(ctx context.Context, write bool) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	deadline, ok := ctx.Deadline()
	if !ok {
		return nil
	}
	if write {
		return r.conn.SetWriteDeadline(deadline)
	}
	return r.conn.SetDeadline(deadline)
}

func (r *PGConnLogicalReplicationReader) clearDeadline() {
	_ = r.conn.SetDeadline(time.Time{})
}

// DecodePGReplicationCopyData decodes the body of a PostgreSQL CopyData message
// received during logical replication.
func DecodePGReplicationCopyData(data []byte) (PGLogicalReplicationMessage, error) {
	if len(data) == 0 {
		return PGLogicalReplicationMessage{}, errors.New("empty replication CopyData")
	}
	switch data[0] {
	case pgLogicalCopyDataWAL:
		if len(data) < 1+8+8+8 {
			return PGLogicalReplicationMessage{}, fmt.Errorf("truncated WAL CopyData: %d bytes", len(data))
		}
		return PGLogicalReplicationMessage{
			WALStartLSN:     binary.BigEndian.Uint64(data[1:9]),
			ServerWALEndLSN: binary.BigEndian.Uint64(data[9:17]),
			ServerTime:      pgLogicalTime(binary.BigEndian.Uint64(data[17:25])),
			WALData:         append([]byte(nil), data[25:]...),
		}, nil
	case pgLogicalCopyDataKeepalive:
		if len(data) < 1+8+8+1 {
			return PGLogicalReplicationMessage{}, fmt.Errorf("truncated keepalive CopyData: %d bytes", len(data))
		}
		return PGLogicalReplicationMessage{
			ServerWALEndLSN: binary.BigEndian.Uint64(data[1:9]),
			ServerTime:      pgLogicalTime(binary.BigEndian.Uint64(data[9:17])),
			Keepalive:       true,
			ReplyRequested:  data[17] == 1,
		}, nil
	default:
		return PGLogicalReplicationMessage{}, fmt.Errorf("unknown replication CopyData type %q", data[0])
	}
}

// PGWal2JSONDecoder decodes the common wal2json format-version 1 payload.
type PGWal2JSONDecoder struct{}

func (PGWal2JSONDecoder) Decode(msg PGLogicalReplicationMessage) ([]PGLogRecord, error) {
	if len(bytes.TrimSpace(msg.WALData)) == 0 {
		return nil, nil
	}
	var txn wal2JSONTransaction
	dec := json.NewDecoder(bytes.NewReader(msg.WALData))
	dec.UseNumber()
	if err := dec.Decode(&txn); err != nil {
		return nil, fmt.Errorf("wal2json payload: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("wal2json payload has trailing data")
	}
	commitTime, err := parseWal2JSONTime(txn.Timestamp)
	if err != nil {
		return nil, err
	}
	if commitTime.IsZero() {
		commitTime = msg.ServerTime
	}
	defaultLSN := txn.NextLSN
	if defaultLSN == "" {
		defaultLSN = formatPGLogicalLSN(msg.WALStartLSN)
	}
	records := make([]PGLogRecord, 0, len(txn.Change))
	for i, ch := range txn.Change {
		op, err := wal2JSONOp(ch.Kind)
		if err != nil {
			return nil, fmt.Errorf("wal2json change %d: %w", i, err)
		}
		lsn := ch.LSN
		if lsn == "" {
			lsn = defaultLSN
		}
		rec := PGLogRecord{
			Op:         op,
			Schema:     ch.Schema,
			Table:      ch.Table,
			LSN:        lsn,
			CommitTime: commitTime,
		}
		switch op {
		case PGChangeInsert, PGChangeUpdate:
			if len(ch.ColumnNames) == 0 {
				return nil, fmt.Errorf("wal2json change %d: %s missing columnnames", i, ch.Kind)
			}
			vals, err := decodeWal2JSONValues(ch.ColumnValues)
			if err != nil {
				return nil, fmt.Errorf("wal2json change %d: columnvalues: %w", i, err)
			}
			if len(ch.ColumnNames) != len(vals) {
				return nil, fmt.Errorf("wal2json change %d: %d columnnames vs %d columnvalues", i, len(ch.ColumnNames), len(vals))
			}
			rec.Columns = append([]string(nil), ch.ColumnNames...)
			rec.Values = vals
		case PGChangeDelete:
			if len(ch.OldKeys.KeyNames) == 0 {
				return nil, fmt.Errorf("wal2json change %d: delete missing oldkeys", i)
			}
			vals, err := decodeWal2JSONValues(ch.OldKeys.KeyValues)
			if err != nil {
				return nil, fmt.Errorf("wal2json change %d: oldkeys keyvalues: %w", i, err)
			}
			if len(ch.OldKeys.KeyNames) != len(vals) {
				return nil, fmt.Errorf("wal2json change %d: %d keynames vs %d keyvalues", i, len(ch.OldKeys.KeyNames), len(vals))
			}
			rec.KeyColumns = append([]string(nil), ch.OldKeys.KeyNames...)
			rec.KeyValues = vals
		}
		records = append(records, rec)
	}
	return records, nil
}

// PGOutputDecoder decodes PostgreSQL's built-in pgoutput protocol v1. It keeps
// relation metadata in memory because row messages reference relation IDs.
type PGOutputDecoder struct {
	mu            sync.Mutex
	relations     map[uint32]pgOutputRelation
	inTransaction bool
	txCommitLSN   uint64
	txCommitAt    time.Time
	txRecords     []PGLogRecord
}

func NewPGOutputDecoder() *PGOutputDecoder {
	return &PGOutputDecoder{relations: make(map[uint32]pgOutputRelation)}
}

func (d *PGOutputDecoder) Decode(msg PGLogicalReplicationMessage) ([]PGLogRecord, error) {
	if len(msg.WALData) == 0 {
		return nil, nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	rd := pgOutputReader{Reader: bytes.NewReader(msg.WALData)}
	var records []PGLogRecord
	for rd.Len() > 0 {
		tag, err := rd.readByte()
		if err != nil {
			return nil, err
		}
		switch tag {
		case 'B':
			if err := d.decodePGOutputBegin(&rd); err != nil {
				return nil, fmt.Errorf("pgoutput begin: %w", err)
			}
		case 'C':
			if err := d.decodePGOutputCommit(&rd); err != nil {
				return nil, fmt.Errorf("pgoutput commit: %w", err)
			}
			records = append(records, d.finishPGOutputTransaction(msg)...)
		case 'R':
			rel, err := decodePGOutputRelation(&rd)
			if err != nil {
				return nil, fmt.Errorf("pgoutput relation: %w", err)
			}
			d.relations[rel.ID] = rel
		case 'I':
			rec, err := d.decodePGOutputInsert(&rd, msg)
			if err != nil {
				return nil, fmt.Errorf("pgoutput insert: %w", err)
			}
			d.appendPGOutputRecords(&records, rec)
		case 'U':
			rec, err := d.decodePGOutputUpdate(&rd, msg)
			if err != nil {
				return nil, fmt.Errorf("pgoutput update: %w", err)
			}
			d.appendPGOutputRecords(&records, rec)
		case 'D':
			rec, err := d.decodePGOutputDelete(&rd, msg)
			if err != nil {
				return nil, fmt.Errorf("pgoutput delete: %w", err)
			}
			d.appendPGOutputRecords(&records, rec)
		case 'T':
			recs, err := d.decodePGOutputTruncate(&rd, msg)
			if err != nil {
				return nil, fmt.Errorf("pgoutput truncate: %w", err)
			}
			d.appendPGOutputRecords(&records, recs...)
		case 'O':
			if err := decodePGOutputOrigin(&rd); err != nil {
				return nil, fmt.Errorf("pgoutput origin: %w", err)
			}
		case 'Y':
			if err := decodePGOutputType(&rd); err != nil {
				return nil, fmt.Errorf("pgoutput type: %w", err)
			}
		case 'M':
			if err := decodePGOutputMessage(&rd); err != nil {
				return nil, fmt.Errorf("pgoutput message: %w", err)
			}
		default:
			return nil, fmt.Errorf("pgoutput unsupported message type %q", tag)
		}
	}
	return records, nil
}

func (d *PGOutputDecoder) decodePGOutputBegin(rd *pgOutputReader) error {
	lsn, err := rd.readUint64()
	if err != nil {
		return err
	}
	commitMicros, err := rd.readUint64()
	if err != nil {
		return err
	}
	if _, err := rd.readUint32(); err != nil {
		return err
	}
	d.txCommitLSN = lsn
	d.txCommitAt = pgLogicalTime(commitMicros)
	d.inTransaction = true
	d.txRecords = d.txRecords[:0]
	return nil
}

func (d *PGOutputDecoder) decodePGOutputCommit(rd *pgOutputReader) error {
	if _, err := rd.readByte(); err != nil {
		return err
	}
	commitLSN, err := rd.readUint64()
	if err != nil {
		return err
	}
	endLSN, err := rd.readUint64()
	if err != nil {
		return err
	}
	commitMicros, err := rd.readUint64()
	if err != nil {
		return err
	}
	if endLSN != 0 {
		d.txCommitLSN = endLSN
	} else {
		d.txCommitLSN = commitLSN
	}
	d.txCommitAt = pgLogicalTime(commitMicros)
	return nil
}

func (d *PGOutputDecoder) appendPGOutputRecords(out *[]PGLogRecord, recs ...PGLogRecord) {
	if len(recs) == 0 {
		return
	}
	if d.inTransaction {
		d.txRecords = append(d.txRecords, recs...)
		return
	}
	*out = append(*out, recs...)
}

func (d *PGOutputDecoder) finishPGOutputTransaction(msg PGLogicalReplicationMessage) []PGLogRecord {
	if !d.inTransaction {
		return nil
	}
	records := append([]PGLogRecord(nil), d.txRecords...)
	commitLSN := d.pgOutputCommitLSN()
	if commitLSN == "" {
		commitLSN = pgOutputMessageLSN(msg)
	}
	for i := range records {
		if records[i].CommitTime.IsZero() {
			records[i].CommitTime = d.pgOutputCommitTime(msg)
		}
		if records[i].LSN == "" {
			records[i].LSN = commitLSN
		}
	}
	if len(records) > 0 && commitLSN != "" {
		records[len(records)-1].LSN = commitLSN
	}
	d.inTransaction = false
	d.txRecords = d.txRecords[:0]
	return records
}

func (d *PGOutputDecoder) decodePGOutputInsert(rd *pgOutputReader, msg PGLogicalReplicationMessage) (PGLogRecord, error) {
	rel, err := d.readPGOutputRelationRef(rd)
	if err != nil {
		return PGLogRecord{}, err
	}
	tupleKind, err := rd.readByte()
	if err != nil {
		return PGLogRecord{}, err
	}
	if tupleKind != 'N' {
		return PGLogRecord{}, fmt.Errorf("expected new tuple marker N, got %q", tupleKind)
	}
	tuple, err := readPGOutputTuple(rd, rel)
	if err != nil {
		return PGLogRecord{}, err
	}
	cols, vals, err := pgOutputTupleRow(rel, tuple)
	if err != nil {
		return PGLogRecord{}, err
	}
	return PGLogRecord{
		Op:         PGChangeInsert,
		Schema:     rel.Namespace,
		Table:      rel.Name,
		LSN:        pgOutputMessageLSN(msg),
		CommitTime: d.pgOutputCommitTime(msg),
		Columns:    cols,
		Values:     vals,
	}, nil
}

func (d *PGOutputDecoder) decodePGOutputUpdate(rd *pgOutputReader, msg PGLogicalReplicationMessage) (PGLogRecord, error) {
	rel, err := d.readPGOutputRelationRef(rd)
	if err != nil {
		return PGLogRecord{}, err
	}
	marker, err := rd.readByte()
	if err != nil {
		return PGLogRecord{}, err
	}
	var keyCols []string
	var keyVals []any
	if marker == 'K' || marker == 'O' {
		oldTuple, err := readPGOutputTuple(rd, rel)
		if err != nil {
			return PGLogRecord{}, fmt.Errorf("old tuple: %w", err)
		}
		keyCols, keyVals, err = pgOutputTupleKey(rel, oldTuple)
		if err != nil {
			return PGLogRecord{}, fmt.Errorf("old tuple key: %w", err)
		}
		marker, err = rd.readByte()
		if err != nil {
			return PGLogRecord{}, err
		}
	}
	if marker != 'N' {
		return PGLogRecord{}, fmt.Errorf("expected new tuple marker N, got %q", marker)
	}
	newTuple, err := readPGOutputTuple(rd, rel)
	if err != nil {
		return PGLogRecord{}, fmt.Errorf("new tuple: %w", err)
	}
	cols, vals, err := pgOutputTupleRow(rel, newTuple)
	if err != nil {
		return PGLogRecord{}, err
	}
	return PGLogRecord{
		Op:         PGChangeUpdate,
		Schema:     rel.Namespace,
		Table:      rel.Name,
		LSN:        pgOutputMessageLSN(msg),
		CommitTime: d.pgOutputCommitTime(msg),
		Columns:    cols,
		Values:     vals,
		KeyColumns: keyCols,
		KeyValues:  keyVals,
	}, nil
}

func (d *PGOutputDecoder) decodePGOutputDelete(rd *pgOutputReader, msg PGLogicalReplicationMessage) (PGLogRecord, error) {
	rel, err := d.readPGOutputRelationRef(rd)
	if err != nil {
		return PGLogRecord{}, err
	}
	marker, err := rd.readByte()
	if err != nil {
		return PGLogRecord{}, err
	}
	if marker != 'K' && marker != 'O' {
		return PGLogRecord{}, fmt.Errorf("expected key/full old tuple marker, got %q", marker)
	}
	tuple, err := readPGOutputTuple(rd, rel)
	if err != nil {
		return PGLogRecord{}, err
	}
	keyCols, keyVals, err := pgOutputTupleKey(rel, tuple)
	if err != nil {
		return PGLogRecord{}, err
	}
	return PGLogRecord{
		Op:         PGChangeDelete,
		Schema:     rel.Namespace,
		Table:      rel.Name,
		LSN:        pgOutputMessageLSN(msg),
		CommitTime: d.pgOutputCommitTime(msg),
		KeyColumns: keyCols,
		KeyValues:  keyVals,
	}, nil
}

func (d *PGOutputDecoder) decodePGOutputTruncate(rd *pgOutputReader, msg PGLogicalReplicationMessage) ([]PGLogRecord, error) {
	nrels, err := rd.readUint32()
	if err != nil {
		return nil, err
	}
	if _, err := rd.readByte(); err != nil {
		return nil, err
	}
	records := make([]PGLogRecord, 0, nrels)
	for i := uint32(0); i < nrels; i++ {
		relID, err := rd.readUint32()
		if err != nil {
			return nil, err
		}
		rel, ok := d.relations[relID]
		if !ok {
			return nil, fmt.Errorf("unknown relation id %d", relID)
		}
		records = append(records, PGLogRecord{
			Op:         PGChangeTruncate,
			Schema:     rel.Namespace,
			Table:      rel.Name,
			LSN:        pgOutputMessageLSN(msg),
			CommitTime: d.pgOutputCommitTime(msg),
		})
	}
	return records, nil
}

func (d *PGOutputDecoder) readPGOutputRelationRef(rd *pgOutputReader) (pgOutputRelation, error) {
	relID, err := rd.readUint32()
	if err != nil {
		return pgOutputRelation{}, err
	}
	rel, ok := d.relations[relID]
	if !ok {
		return pgOutputRelation{}, fmt.Errorf("unknown relation id %d", relID)
	}
	return rel, nil
}

func (d *PGOutputDecoder) pgOutputCommitLSN() string {
	if d.txCommitLSN != 0 {
		return formatPGLogicalLSN(d.txCommitLSN)
	}
	return ""
}

func pgOutputMessageLSN(msg PGLogicalReplicationMessage) string {
	if msg.ServerWALEndLSN != 0 {
		return formatPGLogicalLSN(msg.ServerWALEndLSN)
	}
	if msg.WALStartLSN != 0 {
		return formatPGLogicalLSN(msg.WALStartLSN)
	}
	return ""
}

func (d *PGOutputDecoder) pgOutputCommitTime(msg PGLogicalReplicationMessage) time.Time {
	if !d.txCommitAt.IsZero() {
		return d.txCommitAt
	}
	return msg.ServerTime
}

type pgOutputRelation struct {
	ID              uint32
	Namespace       string
	Name            string
	ReplicaIdentity byte
	Columns         []pgOutputColumn
}

type pgOutputColumn struct {
	Flags   byte
	Name    string
	TypeOID uint32
	TypeMod int32
}

func (c pgOutputColumn) isKey() bool {
	return c.Flags&1 == 1
}

type pgOutputTupleColumn struct {
	Kind  byte
	Value any
}

type pgOutputReader struct {
	*bytes.Reader
}

func (r *pgOutputReader) readByte() (byte, error) {
	b, err := r.Reader.ReadByte()
	if err != nil {
		return 0, io.ErrUnexpectedEOF
	}
	return b, nil
}

func (r *pgOutputReader) readUint16() (uint16, error) {
	var buf [2]byte
	if _, err := io.ReadFull(r, buf[:]); err != nil {
		return 0, io.ErrUnexpectedEOF
	}
	return binary.BigEndian.Uint16(buf[:]), nil
}

func (r *pgOutputReader) readUint32() (uint32, error) {
	var buf [4]byte
	if _, err := io.ReadFull(r, buf[:]); err != nil {
		return 0, io.ErrUnexpectedEOF
	}
	return binary.BigEndian.Uint32(buf[:]), nil
}

func (r *pgOutputReader) readUint64() (uint64, error) {
	var buf [8]byte
	if _, err := io.ReadFull(r, buf[:]); err != nil {
		return 0, io.ErrUnexpectedEOF
	}
	return binary.BigEndian.Uint64(buf[:]), nil
}

func (r *pgOutputReader) readCString() (string, error) {
	var buf []byte
	for {
		b, err := r.readByte()
		if err != nil {
			return "", err
		}
		if b == 0 {
			return string(buf), nil
		}
		buf = append(buf, b)
	}
}

func (r *pgOutputReader) readBytes(n uint32) ([]byte, error) {
	if n > uint32(r.Len()) {
		return nil, io.ErrUnexpectedEOF
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, io.ErrUnexpectedEOF
	}
	return buf, nil
}

func decodePGOutputRelation(rd *pgOutputReader) (pgOutputRelation, error) {
	relID, err := rd.readUint32()
	if err != nil {
		return pgOutputRelation{}, err
	}
	namespace, err := rd.readCString()
	if err != nil {
		return pgOutputRelation{}, err
	}
	name, err := rd.readCString()
	if err != nil {
		return pgOutputRelation{}, err
	}
	replicaIdentity, err := rd.readByte()
	if err != nil {
		return pgOutputRelation{}, err
	}
	ncols, err := rd.readUint16()
	if err != nil {
		return pgOutputRelation{}, err
	}
	cols := make([]pgOutputColumn, ncols)
	for i := range cols {
		flags, err := rd.readByte()
		if err != nil {
			return pgOutputRelation{}, err
		}
		colName, err := rd.readCString()
		if err != nil {
			return pgOutputRelation{}, err
		}
		typeOID, err := rd.readUint32()
		if err != nil {
			return pgOutputRelation{}, err
		}
		typeMod, err := rd.readUint32()
		if err != nil {
			return pgOutputRelation{}, err
		}
		cols[i] = pgOutputColumn{Flags: flags, Name: colName, TypeOID: typeOID, TypeMod: int32(typeMod)}
	}
	return pgOutputRelation{
		ID:              relID,
		Namespace:       namespace,
		Name:            name,
		ReplicaIdentity: replicaIdentity,
		Columns:         cols,
	}, nil
}

func readPGOutputTuple(rd *pgOutputReader, rel pgOutputRelation) ([]pgOutputTupleColumn, error) {
	ncols, err := rd.readUint16()
	if err != nil {
		return nil, err
	}
	if int(ncols) != len(rel.Columns) {
		return nil, fmt.Errorf("tuple has %d columns, relation %s.%s has %d", ncols, rel.Namespace, rel.Name, len(rel.Columns))
	}
	tuple := make([]pgOutputTupleColumn, ncols)
	for i := range tuple {
		kind, err := rd.readByte()
		if err != nil {
			return nil, err
		}
		tuple[i].Kind = kind
		switch kind {
		case 'n', 'u':
			tuple[i].Value = nil
		case 't':
			ln, err := rd.readUint32()
			if err != nil {
				return nil, err
			}
			raw, err := rd.readBytes(ln)
			if err != nil {
				return nil, err
			}
			v, err := decodePGOutputTextValue(raw, rel.Columns[i].TypeOID)
			if err != nil {
				return nil, fmt.Errorf("column %s: %w", rel.Columns[i].Name, err)
			}
			tuple[i].Value = v
		case 'b':
			ln, err := rd.readUint32()
			if err != nil {
				return nil, err
			}
			raw, err := rd.readBytes(ln)
			if err != nil {
				return nil, err
			}
			tuple[i].Value = raw
		default:
			return nil, fmt.Errorf("unsupported tuple column kind %q", kind)
		}
	}
	return tuple, nil
}

func pgOutputTupleRow(rel pgOutputRelation, tuple []pgOutputTupleColumn) ([]string, []any, error) {
	cols := make([]string, len(rel.Columns))
	vals := make([]any, len(rel.Columns))
	for i, col := range rel.Columns {
		if tuple[i].Kind == 'u' {
			return nil, nil, fmt.Errorf("column %s contains unchanged TOAST data; full-row update cannot be reconstructed", col.Name)
		}
		cols[i] = col.Name
		vals[i] = tuple[i].Value
	}
	return cols, vals, nil
}

func pgOutputTupleKey(rel pgOutputRelation, tuple []pgOutputTupleColumn) ([]string, []any, error) {
	var keyCols []string
	var keyVals []any
	for i, col := range rel.Columns {
		if !col.isKey() {
			continue
		}
		if tuple[i].Kind == 'u' {
			return nil, nil, fmt.Errorf("key column %s is unchanged TOAST data", col.Name)
		}
		keyCols = append(keyCols, col.Name)
		keyVals = append(keyVals, tuple[i].Value)
	}
	if len(keyCols) > 0 {
		return keyCols, keyVals, nil
	}
	for i, col := range rel.Columns {
		if tuple[i].Kind == 'u' {
			continue
		}
		keyCols = append(keyCols, col.Name)
		keyVals = append(keyVals, tuple[i].Value)
	}
	if len(keyCols) == 0 {
		return nil, nil, errors.New("tuple does not contain key values")
	}
	return keyCols, keyVals, nil
}

func decodePGOutputTextValue(raw []byte, typeOID uint32) (any, error) {
	s := string(raw)
	switch typeOID {
	case 16: // bool
		switch strings.ToLower(s) {
		case "t", "true", "1":
			return true, nil
		case "f", "false", "0":
			return false, nil
		default:
			return nil, fmt.Errorf("invalid bool %q", s)
		}
	case 20, 21, 23: // int8, int2, int4
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil {
			return nil, err
		}
		return v, nil
	case 700, 701: // float4, float8
		v, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return nil, err
		}
		return v, nil
	case 1114, 1184: // timestamp, timestamptz
		t, err := parseWal2JSONTime(s)
		if err != nil {
			return s, nil
		}
		return t, nil
	default:
		return s, nil
	}
}

func decodePGOutputOrigin(rd *pgOutputReader) error {
	if _, err := rd.readUint64(); err != nil {
		return err
	}
	_, err := rd.readCString()
	return err
}

func decodePGOutputType(rd *pgOutputReader) error {
	if _, err := rd.readUint32(); err != nil {
		return err
	}
	if _, err := rd.readCString(); err != nil {
		return err
	}
	_, err := rd.readCString()
	return err
}

func decodePGOutputMessage(rd *pgOutputReader) error {
	if _, err := rd.readByte(); err != nil {
		return err
	}
	if _, err := rd.readUint64(); err != nil {
		return err
	}
	if _, err := rd.readCString(); err != nil {
		return err
	}
	ln, err := rd.readUint32()
	if err != nil {
		return err
	}
	_, err = rd.readBytes(ln)
	return err
}

type wal2JSONTransaction struct {
	NextLSN   string           `json:"nextlsn"`
	Timestamp string           `json:"timestamp"`
	Change    []wal2JSONChange `json:"change"`
}

type wal2JSONChange struct {
	Kind         string            `json:"kind"`
	Schema       string            `json:"schema"`
	Table        string            `json:"table"`
	LSN          string            `json:"lsn"`
	ColumnNames  []string          `json:"columnnames"`
	ColumnValues []json.RawMessage `json:"columnvalues"`
	OldKeys      wal2JSONOldKeys   `json:"oldkeys"`
}

type wal2JSONOldKeys struct {
	KeyNames  []string          `json:"keynames"`
	KeyValues []json.RawMessage `json:"keyvalues"`
}

func wal2JSONOp(kind string) (PGChangeOp, error) {
	switch strings.ToLower(kind) {
	case string(PGChangeInsert):
		return PGChangeInsert, nil
	case string(PGChangeUpdate):
		return PGChangeUpdate, nil
	case string(PGChangeDelete):
		return PGChangeDelete, nil
	default:
		return "", fmt.Errorf("unsupported kind %q", kind)
	}
}

func decodeWal2JSONValues(raw []json.RawMessage) ([]any, error) {
	vals := make([]any, len(raw))
	for i := range raw {
		v, err := decodeWal2JSONValue(raw[i])
		if err != nil {
			return nil, fmt.Errorf("value %d: %w", i, err)
		}
		vals[i] = v
	}
	return vals, nil
}

func decodeWal2JSONValue(raw json.RawMessage) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return normalizeWal2JSONValue(v), nil
}

func normalizeWal2JSONValue(v any) any {
	switch t := v.(type) {
	case json.Number:
		return normalizeWal2JSONNumber(t)
	case []any, map[string]any:
		if b, err := json.Marshal(normalizeWal2JSONComposite(t)); err == nil {
			return string(b)
		}
		return fmt.Sprintf("%v", t)
	default:
		return t
	}
}

func normalizeWal2JSONComposite(v any) any {
	switch t := v.(type) {
	case json.Number:
		return normalizeWal2JSONNumber(t)
	case []any:
		out := make([]any, len(t))
		for i := range t {
			out[i] = normalizeWal2JSONComposite(t[i])
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, v := range t {
			out[k] = normalizeWal2JSONComposite(v)
		}
		return out
	default:
		return t
	}
}

func normalizeWal2JSONNumber(n json.Number) any {
	if i, err := n.Int64(); err == nil {
		return i
	}
	if f, err := n.Float64(); err == nil {
		return f
	}
	return n.String()
}

func parseWal2JSONTime(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	layouts := []string{
		time.RFC3339Nano,
		"2006-01-02 15:04:05.999999-07",
		"2006-01-02 15:04:05.999999-07:00",
		"2006-01-02 15:04:05.999999Z07",
		"2006-01-02 15:04:05.999999Z07:00",
		"2006-01-02 15:04:05-07",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05",
	}
	var lastErr error
	for _, layout := range layouts {
		t, err := time.Parse(layout, s)
		if err == nil {
			return t.UTC(), nil
		}
		lastErr = err
	}
	return time.Time{}, fmt.Errorf("wal2json timestamp %q: %w", s, lastErr)
}

func pgLogicalTime(pgMicros uint64) time.Time {
	return time.UnixMicro(int64(pgMicros) + pgLogicalEpochMicros).UTC()
}

func pgLogicalMicros(t time.Time) uint64 {
	return uint64(t.UTC().UnixMicro() - pgLogicalEpochMicros)
}

func parsePGLogicalLSN(s string) (uint64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, nil
	}
	for _, sep := range []string{"#", "@"} {
		if before, _, ok := strings.Cut(s, sep); ok {
			s = before
			break
		}
	}
	parts := strings.Split(s, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return 0, fmt.Errorf("invalid PostgreSQL LSN %q", s)
	}
	hi, err := strconv.ParseUint(parts[0], 16, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid PostgreSQL LSN high word %q: %w", parts[0], err)
	}
	lo, err := strconv.ParseUint(parts[1], 16, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid PostgreSQL LSN low word %q: %w", parts[1], err)
	}
	return (hi << 32) | lo, nil
}

func formatPGLogicalLSN(lsn uint64) string {
	return fmt.Sprintf("%X/%X", uint32(lsn>>32), uint32(lsn))
}

func validatePGReplicationSlotName(slot string) error {
	if slot == "" {
		return errors.New("core: pg logical reader requires a slot name")
	}
	for _, r := range slot {
		ok := r == '_' || r >= '0' && r <= '9' || r >= 'a' && r <= 'z'
		if !ok {
			return fmt.Errorf("core: invalid pg replication slot name %q", slot)
		}
	}
	return nil
}

func pgReplicationStringLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func normalizePGContextErr(ctx context.Context, err error) error {
	if ctxErr := ctx.Err(); ctxErr != nil {
		return ctxErr
	}
	return err
}
