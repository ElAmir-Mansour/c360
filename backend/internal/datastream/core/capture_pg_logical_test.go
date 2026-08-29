package core

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"testing"
	"time"
)

type scriptedPGLogicalReader struct {
	messages []PGLogicalReplicationMessage
	startLSN uint64
	statuses []uint64
	closed   bool
}

func (r *scriptedPGLogicalReader) Start(_ context.Context, startLSN uint64) error {
	r.startLSN = startLSN
	return nil
}

func (r *scriptedPGLogicalReader) Receive(context.Context) (PGLogicalReplicationMessage, error) {
	if len(r.messages) == 0 {
		return PGLogicalReplicationMessage{}, io.EOF
	}
	msg := r.messages[0]
	r.messages = r.messages[1:]
	return msg, nil
}

func (r *scriptedPGLogicalReader) SendStandbyStatus(_ context.Context, appliedLSN uint64) error {
	r.statuses = append(r.statuses, appliedLSN)
	return nil
}

func (r *scriptedPGLogicalReader) Close() error {
	r.closed = true
	return nil
}

func TestPGLogicalReplicationSource_Wal2JSONFrames(t *testing.T) {
	t.Parallel()

	cfg := PGTableConfig{
		Schema:     "public",
		Table:      "account",
		Columns:    []string{"id", "name", "balance", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	}
	commit := time.Date(2026, 6, 13, 10, 30, 0, 0, time.UTC)
	reader := &scriptedPGLogicalReader{messages: []PGLogicalReplicationMessage{
		wal2JSONLogicalMessage(t, "0/10", commit, `{
			"nextlsn":"0/10",
			"timestamp":"2026-06-13T10:30:00Z",
			"change":[{
				"kind":"insert",
				"schema":"public",
				"table":"account",
				"columnnames":["id","name","balance","updated_at"],
				"columnvalues":["acct-1","alpha",10,"2026-06-13T10:30:00Z"]
			}]
		}`),
		wal2JSONLogicalMessage(t, "0/20", commit.Add(time.Second), `{
			"nextlsn":"0/20",
			"timestamp":"2026-06-13T10:30:01Z",
			"change":[{
				"kind":"update",
				"schema":"public",
				"table":"account",
				"columnnames":["id","name","balance","updated_at"],
				"columnvalues":["acct-1","alpha2",20,"2026-06-13T10:30:01Z"]
			}]
		}`),
		wal2JSONLogicalMessage(t, "0/30", commit.Add(2*time.Second), `{
			"nextlsn":"0/30",
			"timestamp":"2026-06-13T10:30:02Z",
			"change":[{
				"kind":"delete",
				"schema":"public",
				"table":"account",
				"oldkeys":{"keynames":["id"],"keyvalues":["acct-1"]}
			}]
		}`),
	}}
	src, err := NewPGLogicalReplicationSource(reader, PGWal2JSONDecoder{})
	if err != nil {
		t.Fatalf("NewPGLogicalReplicationSource: %v", err)
	}
	cap, err := NewPGLogCapturer(src, "pg-logical", cfg)
	if err != nil {
		t.Fatalf("NewPGLogCapturer: %v", err)
	}
	cap.Continuous = false

	out := make(chan Frame, 8)
	if err := cap.Start(context.Background(), 0, out); err != nil {
		t.Fatalf("Start: %v", err)
	}
	close(out)
	frames := drainFrames(out)
	if len(frames) != 3 {
		t.Fatalf("frames emitted = %d, want 3", len(frames))
	}
	for i, f := range frames {
		if f.StreamID != "pg-logical" {
			t.Fatalf("frame %d stream = %q", i, f.StreamID)
		}
		if f.Seq != uint64(i+1) {
			t.Fatalf("frame %d seq = %d, want %d", i, f.Seq, i+1)
		}
		if f.Kind != FrameKindWAL {
			t.Fatalf("frame %d kind = %s, want WAL", i, f.Kind)
		}
		if f.EmittedAt.IsZero() {
			t.Fatalf("frame %d missing emitted time", i)
		}
	}
	if got := []string{frames[0].SourceLSN, frames[1].SourceLSN, frames[2].SourceLSN}; got[0] != "0/10" || got[1] != "0/20" || got[2] != "0/30" {
		t.Fatalf("frame LSNs = %v", got)
	}
	cols, vals, err := decodePGRow(frames[0].Payload)
	if err != nil {
		t.Fatalf("decode insert: %v", err)
	}
	if !equalStringSlice(cols, cfg.Columns) {
		t.Fatalf("insert cols = %v", cols)
	}
	if vals[0] != "acct-1" || vals[1] != "alpha" || vals[2] != int64(10) {
		t.Fatalf("insert vals = %#v", vals)
	}
	cols, vals, err = decodePGRow(frames[1].Payload)
	if err != nil {
		t.Fatalf("decode update: %v", err)
	}
	if !equalStringSlice(cols, cfg.Columns) || vals[1] != "alpha2" || vals[2] != int64(20) {
		t.Fatalf("update payload = %v %#v", cols, vals)
	}
	op, err := pgPayloadOp(frames[2].Payload)
	if err != nil {
		t.Fatalf("delete op: %v", err)
	}
	if op != pgOpDelete {
		t.Fatalf("delete op = %d, want %d", op, pgOpDelete)
	}
	keyCols, keyVals, err := decodePGDelete(frames[2].Payload)
	if err != nil {
		t.Fatalf("decode delete: %v", err)
	}
	if !equalStringSlice(keyCols, []string{"id"}) || keyVals[0] != "acct-1" {
		t.Fatalf("delete payload = %v %#v", keyCols, keyVals)
	}
}

func TestPGLogicalReplicationSource_ResumeSkipsOldLSN(t *testing.T) {
	t.Parallel()

	cfg := PGTableConfig{
		Schema:     "public",
		Table:      "account",
		Columns:    []string{"id", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	}
	reader := &scriptedPGLogicalReader{messages: []PGLogicalReplicationMessage{
		wal2JSONLogicalMessage(t, "0/10", time.Now(), `{
			"nextlsn":"0/10",
			"change":[{
				"kind":"insert",
				"schema":"public",
				"table":"account",
				"columnnames":["id","updated_at"],
				"columnvalues":["old","2026-06-13T10:00:00Z"]
			}]
		}`),
		wal2JSONLogicalMessage(t, "0/20", time.Now(), `{
			"nextlsn":"0/20",
			"change":[{
				"kind":"insert",
				"schema":"public",
				"table":"account",
				"columnnames":["id","updated_at"],
				"columnvalues":["new","2026-06-13T10:00:01Z"]
			}]
		}`),
	}}
	src, err := NewPGLogicalReplicationSource(reader, PGWal2JSONDecoder{})
	if err != nil {
		t.Fatal(err)
	}
	cap, err := NewPGLogCapturer(src, "pg-logical", cfg)
	if err != nil {
		t.Fatal(err)
	}
	cap.Continuous = false
	cap.SetResumeLSN("0/10")

	out := make(chan Frame, 4)
	if err := cap.Start(context.Background(), 5, out); err != nil {
		t.Fatalf("Start: %v", err)
	}
	close(out)
	frames := drainFrames(out)
	if len(frames) != 1 {
		t.Fatalf("frames emitted = %d, want 1", len(frames))
	}
	if frames[0].Seq != 6 || frames[0].SourceLSN != "0/20" {
		t.Fatalf("resume frame seq/lsn = %d/%q, want 6/0/20", frames[0].Seq, frames[0].SourceLSN)
	}
	_, vals, err := decodePGRow(frames[0].Payload)
	if err != nil {
		t.Fatalf("decode resumed row: %v", err)
	}
	if vals[0] != "new" {
		t.Fatalf("resumed row id = %v, want new", vals[0])
	}
	wantStart, _ := parsePGLogicalLSN("0/10")
	if reader.startLSN != wantStart {
		t.Fatalf("reader start LSN = %s, want 0/10", formatPGLogicalLSN(reader.startLSN))
	}
}

func TestPGLogicalReplicationSource_MalformedWal2JSONFailsClosed(t *testing.T) {
	t.Parallel()

	cfg := PGTableConfig{
		Table:      "account",
		Columns:    []string{"id", "updated_at"},
		PrimaryKey: []string{"id"},
		Watermark:  "updated_at",
	}
	reader := &scriptedPGLogicalReader{messages: []PGLogicalReplicationMessage{
		wal2JSONLogicalMessage(t, "0/10", time.Now(), `{"nextlsn":"0/10","change":[`),
	}}
	src, err := NewPGLogicalReplicationSource(reader, PGWal2JSONDecoder{})
	if err != nil {
		t.Fatal(err)
	}
	cap, err := NewPGLogCapturer(src, "pg-logical", cfg)
	if err != nil {
		t.Fatal(err)
	}
	cap.Continuous = false

	out := make(chan Frame, 1)
	err = cap.Start(context.Background(), 0, out)
	if err == nil || !strings.Contains(err.Error(), "decode WAL") {
		t.Fatalf("Start err = %v, want decode WAL error", err)
	}
	if len(out) != 0 {
		t.Fatalf("malformed WAL emitted %d frames, want none", len(out))
	}
}

func TestDecodePGReplicationCopyData_WALKeepaliveAndMalformed(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 6, 13, 11, 0, 0, 123456000, time.UTC)
	payload := []byte(`{"change":[]}`)
	data := make([]byte, 1+8+8+8+len(payload))
	data[0] = pgLogicalCopyDataWAL
	binary.BigEndian.PutUint64(data[1:9], 0x10)
	binary.BigEndian.PutUint64(data[9:17], 0x20)
	binary.BigEndian.PutUint64(data[17:25], pgLogicalMicros(now))
	copy(data[25:], payload)
	msg, err := DecodePGReplicationCopyData(data)
	if err != nil {
		t.Fatalf("Decode WAL: %v", err)
	}
	if msg.WALStartLSN != 0x10 || msg.ServerWALEndLSN != 0x20 || string(msg.WALData) != string(payload) {
		t.Fatalf("decoded WAL = %#v", msg)
	}
	if !msg.ServerTime.Equal(now) {
		t.Fatalf("server time = %s, want %s", msg.ServerTime, now)
	}

	keepalive := make([]byte, 1+8+8+1)
	keepalive[0] = pgLogicalCopyDataKeepalive
	binary.BigEndian.PutUint64(keepalive[1:9], 0x30)
	binary.BigEndian.PutUint64(keepalive[9:17], pgLogicalMicros(now))
	keepalive[17] = 1
	msg, err = DecodePGReplicationCopyData(keepalive)
	if err != nil {
		t.Fatalf("Decode keepalive: %v", err)
	}
	if !msg.Keepalive || !msg.ReplyRequested || msg.ServerWALEndLSN != 0x30 {
		t.Fatalf("decoded keepalive = %#v", msg)
	}
	if _, err := DecodePGReplicationCopyData([]byte{'x'}); err == nil {
		t.Fatal("unknown CopyData type returned nil error")
	}
	if _, err := DecodePGReplicationCopyData([]byte{pgLogicalCopyDataWAL, 0}); err == nil {
		t.Fatal("truncated WAL CopyData returned nil error")
	}
}

func TestPGLogicalReplicationSource_KeepaliveStatusUsesResumeLSN(t *testing.T) {
	t.Parallel()

	reader := &scriptedPGLogicalReader{messages: []PGLogicalReplicationMessage{
		{Keepalive: true, ReplyRequested: true},
	}}
	src, err := NewPGLogicalReplicationSource(reader, PGLogicalDecoderFunc(func(PGLogicalReplicationMessage) ([]PGLogRecord, error) {
		return nil, errors.New("decoder should not be called for keepalive")
	}))
	if err != nil {
		t.Fatal(err)
	}
	_, err = src.Next(context.Background(), "0/40")
	if !errors.Is(err, io.EOF) {
		t.Fatalf("Next err = %v, want EOF", err)
	}
	if len(reader.statuses) != 1 || formatPGLogicalLSN(reader.statuses[0]) != "0/40" {
		t.Fatalf("standby statuses = %v, want 0/40", reader.statuses)
	}
}

func TestPGLogicalReplicationSource_AckLSNSendsStandbyStatusIdempotently(t *testing.T) {
	t.Parallel()

	reader := &scriptedPGLogicalReader{}
	src, err := NewPGLogicalReplicationSource(reader, PGLogicalDecoderFunc(func(PGLogicalReplicationMessage) ([]PGLogRecord, error) {
		return nil, nil
	}))
	if err != nil {
		t.Fatal(err)
	}
	if err := src.AckLSN(context.Background(), "0/20"); err != nil {
		t.Fatalf("AckLSN 0/20: %v", err)
	}
	if err := src.AckLSN(context.Background(), "0/10"); err != nil {
		t.Fatalf("AckLSN older 0/10: %v", err)
	}
	if err := src.AckLSN(context.Background(), "0/30"); err != nil {
		t.Fatalf("AckLSN 0/30: %v", err)
	}
	if got := logicalStatusStrings(reader.statuses); strings.Join(got, ",") != "0/20,0/30" {
		t.Fatalf("standby statuses = %v, want [0/20 0/30]", got)
	}
}

func TestPGOutputPluginArgsQuotesPublications(t *testing.T) {
	t.Parallel()

	args, err := PGOutputPluginArgs("safe_pub", "tenant's_pub")
	if err != nil {
		t.Fatalf("PGOutputPluginArgs: %v", err)
	}
	if len(args) != 2 || args[0] != "proto_version '1'" || args[1] != "publication_names 'safe_pub,tenant''s_pub'" {
		t.Fatalf("args = %#v", args)
	}
}

func TestPGOutputDecoder_CoreMessages(t *testing.T) {
	t.Parallel()

	commit := time.Date(2026, 6, 13, 11, 30, 0, 0, time.UTC)
	dec := NewPGOutputDecoder()

	relationMsg := pgOutputLogicalMessage(t, "0/10", commit, pgOutputRelationMessage(42))
	if recs, err := dec.Decode(relationMsg); err != nil || len(recs) != 0 {
		t.Fatalf("relation Decode records=%v err=%v, want none/nil", recs, err)
	}
	beginMsg := pgOutputLogicalMessage(t, "0/18", commit, pgOutputBeginMessage(t, "0/90", commit, 77))
	if recs, err := dec.Decode(beginMsg); err != nil || len(recs) != 0 {
		t.Fatalf("begin Decode records=%v err=%v, want none/nil", recs, err)
	}

	insertTuple := pgOutputTuple(
		pgOutputText("acct-1"),
		pgOutputText("alpha"),
		pgOutputText("10"),
		pgOutputText("2026-06-13T11:30:00Z"),
	)
	if recs, err := dec.Decode(pgOutputLogicalMessage(t, "0/20", commit, pgOutputInsertMessage(42, insertTuple))); err != nil || len(recs) != 0 {
		t.Fatalf("insert Decode records=%v err=%v, want buffered/nil", recs, err)
	}

	oldKey := pgOutputTuple(pgOutputText("acct-1"), pgOutputNull(), pgOutputNull(), pgOutputNull())
	updateTuple := pgOutputTuple(
		pgOutputText("acct-1"),
		pgOutputText("alpha2"),
		pgOutputText("20"),
		pgOutputText("2026-06-13T11:30:01Z"),
	)
	if recs, err := dec.Decode(pgOutputLogicalMessage(t, "0/30", commit, pgOutputUpdateMessage(42, oldKey, updateTuple))); err != nil || len(recs) != 0 {
		t.Fatalf("update Decode records=%v err=%v, want buffered/nil", recs, err)
	}

	if recs, err := dec.Decode(pgOutputLogicalMessage(t, "0/40", commit, pgOutputDeleteMessage(42, oldKey))); err != nil || len(recs) != 0 {
		t.Fatalf("delete Decode records=%v err=%v, want buffered/nil", recs, err)
	}

	if recs, err := dec.Decode(pgOutputLogicalMessage(t, "0/50", commit, pgOutputTruncateMessage(42))); err != nil || len(recs) != 0 {
		t.Fatalf("truncate Decode records=%v err=%v, want buffered/nil", recs, err)
	}

	commitMsg := pgOutputLogicalMessage(t, "0/90", commit, pgOutputCommitMessage(t, "0/88", "0/90", commit))
	recs, err := dec.Decode(commitMsg)
	if err != nil {
		t.Fatalf("commit Decode: %v", err)
	}
	if len(recs) != 4 {
		t.Fatalf("commit records = %d, want 4", len(recs))
	}
	if recs[0].Op != PGChangeInsert || recs[0].Schema != "public" || recs[0].Table != "account" || recs[0].LSN != "0/20" {
		t.Fatalf("insert record metadata = %#v", recs[0])
	}
	if !equalStringSlice(recs[0].Columns, []string{"id", "name", "balance", "updated_at"}) {
		t.Fatalf("insert columns = %v", recs[0].Columns)
	}
	if recs[0].Values[0] != "acct-1" || recs[0].Values[1] != "alpha" || recs[0].Values[2] != int64(10) {
		t.Fatalf("insert values = %#v", recs[0].Values)
	}
	if got, ok := recs[0].Values[3].(time.Time); !ok || !got.Equal(commit) {
		t.Fatalf("insert updated_at = %#v, want %s", recs[0].Values[3], commit)
	}
	if recs[1].Op != PGChangeUpdate {
		t.Fatalf("update record = %#v", recs[1])
	}
	if !equalStringSlice(recs[1].KeyColumns, []string{"id"}) || recs[1].KeyValues[0] != "acct-1" {
		t.Fatalf("update key = %v/%v", recs[1].KeyColumns, recs[1].KeyValues)
	}
	if recs[1].Values[1] != "alpha2" || recs[1].Values[2] != int64(20) {
		t.Fatalf("update values = %#v", recs[1].Values)
	}
	if recs[2].Op != PGChangeDelete {
		t.Fatalf("delete record = %#v", recs[2])
	}
	if !equalStringSlice(recs[2].KeyColumns, []string{"id"}) || recs[2].KeyValues[0] != "acct-1" {
		t.Fatalf("delete key = %v/%v", recs[2].KeyColumns, recs[2].KeyValues)
	}
	if recs[3].Op != PGChangeTruncate || recs[3].Schema != "public" || recs[3].Table != "account" || recs[3].LSN != "0/90" {
		t.Fatalf("truncate record = %#v", recs[3])
	}
}

func TestPGOutputDecoder_UnknownRelationFailsClosed(t *testing.T) {
	t.Parallel()

	dec := NewPGOutputDecoder()
	_, err := dec.Decode(pgOutputLogicalMessage(t, "0/20", time.Now().UTC(), pgOutputInsertMessage(99, pgOutputTuple(pgOutputText("missing")))))
	if err == nil || !strings.Contains(err.Error(), "unknown relation") {
		t.Fatalf("err = %v, want unknown relation", err)
	}
}

func wal2JSONLogicalMessage(t *testing.T, lsn string, serverTime time.Time, payload string) PGLogicalReplicationMessage {
	t.Helper()
	n, err := parsePGLogicalLSN(lsn)
	if err != nil {
		t.Fatalf("parse LSN %s: %v", lsn, err)
	}
	return PGLogicalReplicationMessage{
		WALStartLSN:     n,
		ServerWALEndLSN: n,
		ServerTime:      serverTime,
		WALData:         []byte(payload),
	}
}

func pgOutputLogicalMessage(t *testing.T, lsn string, serverTime time.Time, payload []byte) PGLogicalReplicationMessage {
	t.Helper()
	n, err := parsePGLogicalLSN(lsn)
	if err != nil {
		t.Fatalf("parse LSN %s: %v", lsn, err)
	}
	return PGLogicalReplicationMessage{
		WALStartLSN:     n,
		ServerWALEndLSN: n,
		ServerTime:      serverTime,
		WALData:         payload,
	}
}

func logicalStatusStrings(statuses []uint64) []string {
	out := make([]string, len(statuses))
	for i, status := range statuses {
		out[i] = formatPGLogicalLSN(status)
	}
	return out
}

func pgOutputRelationMessage(relID uint32) []byte {
	var buf bytes.Buffer
	buf.WriteByte('R')
	writePGOutputUint32(&buf, relID)
	writePGOutputCString(&buf, "public")
	writePGOutputCString(&buf, "account")
	buf.WriteByte('d')
	writePGOutputUint16(&buf, 4)
	writePGOutputColumn(&buf, 1, "id", 25)
	writePGOutputColumn(&buf, 0, "name", 25)
	writePGOutputColumn(&buf, 0, "balance", 20)
	writePGOutputColumn(&buf, 0, "updated_at", 1184)
	return buf.Bytes()
}

func pgOutputBeginMessage(t *testing.T, finalLSN string, commit time.Time, xid uint32) []byte {
	t.Helper()
	lsn, err := parsePGLogicalLSN(finalLSN)
	if err != nil {
		t.Fatalf("parse final LSN: %v", err)
	}
	var buf bytes.Buffer
	buf.WriteByte('B')
	writePGOutputUint64(&buf, lsn)
	writePGOutputUint64(&buf, pgLogicalMicros(commit))
	writePGOutputUint32(&buf, xid)
	return buf.Bytes()
}

func pgOutputCommitMessage(t *testing.T, commitLSN, endLSN string, commit time.Time) []byte {
	t.Helper()
	commitN, err := parsePGLogicalLSN(commitLSN)
	if err != nil {
		t.Fatalf("parse commit LSN: %v", err)
	}
	endN, err := parsePGLogicalLSN(endLSN)
	if err != nil {
		t.Fatalf("parse end LSN: %v", err)
	}
	var buf bytes.Buffer
	buf.WriteByte('C')
	buf.WriteByte(0)
	writePGOutputUint64(&buf, commitN)
	writePGOutputUint64(&buf, endN)
	writePGOutputUint64(&buf, pgLogicalMicros(commit))
	return buf.Bytes()
}

func pgOutputInsertMessage(relID uint32, tuple []byte) []byte {
	var buf bytes.Buffer
	buf.WriteByte('I')
	writePGOutputUint32(&buf, relID)
	buf.WriteByte('N')
	buf.Write(tuple)
	return buf.Bytes()
}

func pgOutputUpdateMessage(relID uint32, oldKey, newTuple []byte) []byte {
	var buf bytes.Buffer
	buf.WriteByte('U')
	writePGOutputUint32(&buf, relID)
	buf.WriteByte('K')
	buf.Write(oldKey)
	buf.WriteByte('N')
	buf.Write(newTuple)
	return buf.Bytes()
}

func pgOutputDeleteMessage(relID uint32, oldKey []byte) []byte {
	var buf bytes.Buffer
	buf.WriteByte('D')
	writePGOutputUint32(&buf, relID)
	buf.WriteByte('K')
	buf.Write(oldKey)
	return buf.Bytes()
}

func pgOutputTruncateMessage(relID uint32) []byte {
	var buf bytes.Buffer
	buf.WriteByte('T')
	writePGOutputUint32(&buf, 1)
	buf.WriteByte(0)
	writePGOutputUint32(&buf, relID)
	return buf.Bytes()
}

type pgOutputTestValue struct {
	kind byte
	text string
}

func pgOutputText(s string) pgOutputTestValue {
	return pgOutputTestValue{kind: 't', text: s}
}

func pgOutputNull() pgOutputTestValue {
	return pgOutputTestValue{kind: 'n'}
}

func pgOutputTuple(vals ...pgOutputTestValue) []byte {
	var buf bytes.Buffer
	writePGOutputUint16(&buf, uint16(len(vals)))
	for _, val := range vals {
		buf.WriteByte(val.kind)
		if val.kind == 't' {
			writePGOutputUint32(&buf, uint32(len(val.text)))
			buf.WriteString(val.text)
		}
	}
	return buf.Bytes()
}

func writePGOutputColumn(buf *bytes.Buffer, flags byte, name string, oid uint32) {
	buf.WriteByte(flags)
	writePGOutputCString(buf, name)
	writePGOutputUint32(buf, oid)
	writePGOutputUint32(buf, ^uint32(0))
}

func writePGOutputCString(buf *bytes.Buffer, s string) {
	buf.WriteString(s)
	buf.WriteByte(0)
}

func writePGOutputUint16(buf *bytes.Buffer, v uint16) {
	var raw [2]byte
	binary.BigEndian.PutUint16(raw[:], v)
	buf.Write(raw[:])
}

func writePGOutputUint32(buf *bytes.Buffer, v uint32) {
	var raw [4]byte
	binary.BigEndian.PutUint32(raw[:], v)
	buf.Write(raw[:])
}

func writePGOutputUint64(buf *bytes.Buffer, v uint64) {
	var raw [8]byte
	binary.BigEndian.PutUint64(raw[:], v)
	buf.Write(raw[:])
}

func drainFrames(ch <-chan Frame) []Frame {
	var frames []Frame
	for f := range ch {
		frames = append(frames, f)
	}
	return frames
}
