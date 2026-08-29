package core

import (
	"bufio"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

// StreamTransport is the production Transport: it ships frames over an arbitrary
// byte duplex (io.Reader + io.Writer) so the same code path works over a
// net.Conn (mTLS to the control plane), an HTTP request/response body, or — for
// tests — a net.Pipe (see NewPipeTransportPair). It runs the §3.3 wire pipeline
// inline: each frame's payload is compressed+encrypted by the PayloadCodec, the
// frame is length-prefixed by the stream codec below, byte-rate throttled, and
// written to the data channel; the receiver decodes, decrypts+decompresses, and
// hands the raw Frame up. Resume is a real, end-to-end protocol: the receiver
// writes the last contiguously-applied Seq back on the ack channel; the sender
// tracks it and, on a reconnect supplied by a Conn, rewinds to lastAck+1 and
// re-ships, so the receiver sees zero gaps and zero duplicates.
//
// Send and Receive run on opposite ends of one Conn. A single process wires
// both via NewPipeTransportPair (a real transport over a real net.Pipe).
type StreamTransport struct {
	codec   PayloadCodec
	bucket  *TokenBucket
	metrics *Metrics
	label   string

	mu      sync.Mutex
	lastAck uint64
	resumes uint64
}

// StreamTransportAdapter binds two StreamTransport endpoints and their Conns to
// the generic Transport interface consumed by Pipeline. It is useful for tests,
// local single-process wiring, and service code that already has connected byte
// streams. Send drains frames over sendConn and closes it when the frame source
// drains so the receiving side observes EOF; Receive reads frames from
// receiveConn and acks contiguous checkpoints back over its ack channel.
type StreamTransportAdapter struct {
	sender   *StreamTransport
	receiver *StreamTransport
	sendConn Conn
	recvConn Conn
}

// NewStreamTransportAdapter adapts the production byte-stream transport to the
// core Transport interface. sender/sendConn represent the agent side; receiver/
// recvConn represent the control-plane side.
func NewStreamTransportAdapter(sender *StreamTransport, sendConn Conn, receiver *StreamTransport, recvConn Conn) (*StreamTransportAdapter, error) {
	if sender == nil || receiver == nil {
		return nil, errors.New("core: stream adapter requires sender and receiver transports")
	}
	if sendConn == nil || recvConn == nil {
		return nil, errors.New("core: stream adapter requires sender and receiver conns")
	}
	return &StreamTransportAdapter{sender: sender, receiver: receiver, sendConn: sendConn, recvConn: recvConn}, nil
}

// Send implements Transport.Send by draining frames over the bound send
// connection. SendOver receives acks internally for resume accounting, so the
// returned ack channel is closed immediately; Pipeline uses the Receive ack
// callback as the durable checkpoint signal.
func (a *StreamTransportAdapter) Send(ctx context.Context, frames <-chan Frame) (<-chan uint64, <-chan error, error) {
	if a == nil || a.sender == nil || a.sendConn == nil {
		return nil, nil, errors.New("core: stream adapter send is not configured")
	}
	acked := make(chan uint64)
	close(acked)
	errs := make(chan error, 1)
	go func() {
		defer close(errs)
		defer a.sendConn.Close()
		if err := a.sender.SendOver(ctx, a.sendConn, frames); err != nil {
			errs <- err
		}
	}()
	return acked, errs, nil
}

// Receive implements Transport.Receive by decoding frames from the bound
// receive connection and returning the receiver-side ack callback.
func (a *StreamTransportAdapter) Receive(ctx context.Context) (<-chan Frame, func(uint64), <-chan error, error) {
	if a == nil || a.receiver == nil || a.recvConn == nil {
		return nil, nil, nil, errors.New("core: stream adapter receive is not configured")
	}
	frames, ack, errs := a.receiver.ReceiveOver(ctx, a.recvConn)
	return frames, ack, errs, nil
}

// Conn is one connected, ordered byte duplex between a sending agent and a
// receiving control plane. Data carries frames agent->control; Ack carries
// uint64 ack cursors control->agent. Close tears the session down.
//
// A net.Conn satisfies this directly (Data == Ack == the conn); a split
// reader/writer pair satisfies it via SplitConn.
type Conn interface {
	// Data is the frame byte stream (sender writes / receiver reads).
	Data() io.ReadWriter
	// Ack is the ack-cursor byte stream (receiver writes / sender reads).
	Ack() io.ReadWriter
	// Close releases the session; an in-flight Send/Receive on it unblocks.
	Close() error
}

// StreamTransportOption configures a StreamTransport.
type StreamTransportOption func(*StreamTransport)

// WithStreamThrottle attaches a byte-rate token bucket to the send path.
func WithStreamThrottle(b *TokenBucket) StreamTransportOption {
	return func(t *StreamTransport) { t.bucket = b }
}

// WithStreamMetrics attaches core metrics (bytes/frames shipped, resumes).
func WithStreamMetrics(m *Metrics, label string) StreamTransportOption {
	return func(t *StreamTransport) {
		t.metrics = m
		if label != "" {
			t.label = label
		}
	}
}

// NewStreamTransport builds a StreamTransport whose payload pipeline uses the
// given 32-byte AES-256 DEK for the encrypt stage of compress->encrypt.
func NewStreamTransport(dek []byte, opts ...StreamTransportOption) (*StreamTransport, error) {
	codec, err := NewPayloadCodec(dek)
	if err != nil {
		return nil, fmt.Errorf("core: build stream transport codec: %w", err)
	}
	t := &StreamTransport{codec: codec, label: "stream"}
	for _, o := range opts {
		o(t)
	}
	return t, nil
}

// ResumeFrom returns the last contiguous ack the sender has observed; the next
// frame shipped must be ResumeFrom()+1.
func (t *StreamTransport) ResumeFrom() uint64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.lastAck
}

// Resumes reports how many times SendOver re-shipped after a reconnect.
func (t *StreamTransport) Resumes() uint64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.resumes
}

// SendOver ships frames drained from src over conn until src is closed, ctx is
// cancelled, or conn drops. It skips any frame whose Seq is at or below the last
// ack so a resume after reconnect re-ships only the un-acked tail with no
// duplicates. It returns nil on a clean drain (src closed and all written),
// errConnClosed on a mid-stream link drop (the caller reconnects and calls
// SendOver again with the same src tail), or a wrapped error otherwise.
//
// SendOver does NOT close conn; the caller owns the connection lifecycle so it
// can reconnect.
func (t *StreamTransport) SendOver(ctx context.Context, conn Conn, src <-chan Frame) error {
	dataW := bufio.NewWriter(conn.Data())
	ackR := conn.Ack()

	// A background reader pulls ack cursors and folds them into lastAck so the
	// send loop can prune the un-acked tail on the next resume.
	ackDone := make(chan struct{})
	go func() {
		defer close(ackDone)
		t.readAcks(ackR)
	}()

	flush := func() error {
		if err := dataW.Flush(); err != nil {
			return err
		}
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			_ = flush()
			return fmt.Errorf("core: stream send cancelled: %w", ctx.Err())
		case f, ok := <-src:
			if !ok {
				if err := flush(); err != nil {
					return wrapConnErr("flush on drain", err)
				}
				return nil
			}
			t.mu.Lock()
			skip := f.Seq <= t.lastAck
			t.mu.Unlock()
			if skip {
				continue
			}
			wire, err := t.codec.Encode(f.Payload)
			if err != nil {
				return fmt.Errorf("core: stream send encode seq=%d: %w", f.Seq, err)
			}
			rec := streamRecord{
				streamID:  f.StreamID,
				seq:       f.Seq,
				kind:      f.Kind,
				emittedAt: f.EmittedAt,
				sourceLSN: f.SourceLSN,
				wire:      wire,
			}
			if t.bucket != nil {
				if err := t.bucket.Wait(ctx, rec.throttleSize()); err != nil {
					return fmt.Errorf("core: stream send throttle seq=%d: %w", f.Seq, err)
				}
			}
			if err := encodeStreamRecord(dataW, rec); err != nil {
				return wrapConnErr(fmt.Sprintf("write seq=%d", f.Seq), err)
			}
			// Flush each record so the receiver and its ack are not held behind
			// the bufio buffer; the buffer still coalesces the length prefix +
			// body of a single record into one syscall.
			if err := flush(); err != nil {
				return wrapConnErr(fmt.Sprintf("flush seq=%d", f.Seq), err)
			}
			if t.metrics != nil {
				t.metrics.BytesShipped.WithLabelValues(f.StreamID).Add(float64(len(f.Payload)))
				t.metrics.FramesShipped.WithLabelValues(f.StreamID, f.Kind.String()).Inc()
			}
		}
	}
}

// readAcks consumes 8-byte big-endian ack cursors from r until r is exhausted
// or errors, advancing lastAck monotonically. It is the sender's view of the
// receiver's durable progress.
func (t *StreamTransport) readAcks(r io.Reader) {
	var buf [8]byte
	for {
		if _, err := io.ReadFull(r, buf[:]); err != nil {
			return
		}
		seq := binary.BigEndian.Uint64(buf[:])
		t.mu.Lock()
		if seq > t.lastAck {
			t.lastAck = seq
		}
		t.mu.Unlock()
	}
}

// noteResume increments the resume counter when a caller re-establishes a Conn
// and re-ships the un-acked tail.
func (t *StreamTransport) noteResume() {
	t.mu.Lock()
	t.resumes++
	t.mu.Unlock()
	if t.metrics != nil {
		t.metrics.TransportResumes.WithLabelValues(t.label).Inc()
	}
}

// ReceiveOver decodes frames from conn and delivers raw Frames on the returned
// channel; ack(seq) writes the last contiguously-applied Seq back to the sender
// so it can prune/resume. The channel closes when conn is exhausted (EOF / link
// drop) or ctx is cancelled; the error channel then carries the terminal cause
// (nil for a clean EOF). ReceiveOver does NOT close conn.
func (t *StreamTransport) ReceiveOver(ctx context.Context, conn Conn) (<-chan Frame, func(seq uint64), <-chan error) {
	out := make(chan Frame)
	errs := make(chan error, 1)
	dataR := bufio.NewReader(conn.Data())
	ackW := conn.Ack()
	var deliveredSeq atomic.Uint64

	// aw is a single-goroutine ack writer fed by a buffered channel so the apply
	// loop's ack callback never blocks behind a slow or unread ack stream (acks
	// are monotonic cursors — a queued one is superseded by a newer one). The
	// receive goroutine joins aw before it closes errs, so once the consumer
	// observes the terminal error no goroutine is writing conn.Ack() any more —
	// which is what makes it safe for conn.Ack() to be an http.ResponseWriter the
	// net/http server reuses (and would otherwise race on) the moment the handler
	// returns.
	aw := newAckWriter(ackW, &deliveredSeq)
	ack := aw.enqueue

	go func() {
		defer close(out)
		defer close(errs)
		// Quiesce + join the ack writer before closing errs so no ack write can be
		// in flight when the consumer tears the connection (ResponseWriter) down.
		defer aw.stop()
		for {
			if ctx.Err() != nil {
				errs <- fmt.Errorf("core: stream receive cancelled: %w", ctx.Err())
				return
			}
			rec, err := decodeStreamRecord(dataR)
			if errors.Is(err, io.EOF) {
				errs <- nil // clean end of this session
				return
			}
			if err != nil {
				errs <- wrapConnErr("decode record", err)
				return
			}
			raw, derr := t.codec.Decode(rec.wire)
			if derr != nil {
				errs <- fmt.Errorf("core: stream receive decode seq=%d: %w", rec.seq, derr)
				return
			}
			f := Frame{
				StreamID:  rec.streamID,
				Seq:       rec.seq,
				Kind:      rec.kind,
				Payload:   raw,
				SourceLSN: rec.sourceLSN,
				EmittedAt: rec.emittedAt,
			}
			select {
			case <-ctx.Done():
				errs <- fmt.Errorf("core: stream receive cancelled: %w", ctx.Err())
				return
			case out <- f:
				deliveredSeq.Store(f.Seq)
			}
		}
	}()

	return out, ack, errs
}

// ackWriter writes monotonic ack cursors to the ack byte stream from a single
// background goroutine fed by a depth-1 buffered channel. enqueue never blocks
// the apply path: a queued cursor is superseded by a newer one (acks are
// monotonic). stop() quiesces the goroutine — flushing the latest pending cursor
// — and joins it, so after stop() returns nothing writes the ack stream again.
type ackWriter struct {
	w    io.Writer
	in   chan uint64
	last *atomic.Uint64
	stop func()
	done chan struct{}
}

func newAckWriter(w io.Writer, lastDelivered *atomic.Uint64) *ackWriter {
	a := &ackWriter{
		w:    w,
		in:   make(chan uint64, 1),
		last: lastDelivered,
		done: make(chan struct{}),
	}
	stopCh := make(chan struct{})
	var stopOnce sync.Once
	a.stop = func() {
		stopOnce.Do(func() { close(stopCh) })
		<-a.done // join: no further ack write after stop() returns
	}
	go a.loop(stopCh)
	return a
}

// enqueue offers seq to the writer without blocking. If the buffer is full the
// queued (older) cursor is replaced with this newer one.
func (a *ackWriter) enqueue(seq uint64) {
	select {
	case a.in <- seq:
		return
	default:
	}
	select {
	case <-a.in:
	default:
	}
	select {
	case a.in <- seq:
	default:
	}
}

func (a *ackWriter) loop(stop <-chan struct{}) {
	defer close(a.done)
	var buf [8]byte
	var last uint64
	write := func(seq uint64) bool {
		if seq <= last {
			return true
		}
		binary.BigEndian.PutUint64(buf[:], seq)
		if _, err := a.w.Write(buf[:]); err != nil {
			return false
		}
		last = seq
		return true
	}
	for {
		select {
		case <-stop:
			a.flushFinal(write, func() uint64 { return last })
			return
		case seq := <-a.in:
			if !write(seq) {
				// Link broken: drain until stop without further writes.
				<-stop
				return
			}
		}
	}
}

func (a *ackWriter) flushFinal(write func(uint64) bool, written func() uint64) {
	target := uint64(0)
	if a.last != nil {
		target = a.last.Load()
	}
	drain := func() bool {
		for {
			select {
			case seq := <-a.in:
				if !write(seq) {
					return false
				}
				if target == 0 || written() >= target {
					return true
				}
			default:
				return true
			}
		}
	}
	if !drain() || target == 0 || written() >= target {
		return
	}
	timer := time.NewTimer(100 * time.Millisecond)
	defer timer.Stop()
	for written() < target {
		select {
		case seq := <-a.in:
			if !write(seq) {
				return
			}
		case <-timer.C:
			drain()
			return
		}
	}
}

// Send adapts SendOver to the Transport interface for a single connected
// session over conn; reconnect/resume is driven by the caller invoking SendOver
// across successive Conns (the agent loop). It is provided so a StreamTransport
// can stand in wherever a Transport is wanted with an already-open Conn.
func (t *StreamTransport) Send(ctx context.Context, conn Conn, frames <-chan Frame) (<-chan error, error) {
	errs := make(chan error, 1)
	go func() {
		defer close(errs)
		errs <- t.SendOver(ctx, conn, frames)
	}()
	return errs, nil
}

var errConnClosed = errors.New("core: transport connection closed")

func wrapConnErr(op string, err error) error {
	if isClosedConnErr(err) {
		return fmt.Errorf("core: stream %s: %w", op, errConnClosed)
	}
	return fmt.Errorf("core: stream %s: %w", op, err)
}

func isClosedConnErr(err error) bool {
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, net.ErrClosed) || errors.Is(err, io.ErrClosedPipe) {
		return true
	}
	return false
}

// --- stream wire record ---------------------------------------------------

// streamRecord is one frame as it crosses a byte duplex. Unlike the §3.3 body
// codec (frame.go), which deliberately leaves StreamID/EmittedAt as transport
// envelope, the stream record carries every Frame field so a fresh connection
// after a reconnect is fully self-describing.
type streamRecord struct {
	streamID  string
	seq       uint64
	kind      FrameKind
	emittedAt time.Time
	sourceLSN string
	wire      []byte // compress->encrypt output
}

func (r streamRecord) throttleSize() int {
	return len(r.streamID) + len(r.sourceLSN) + len(r.wire) + 32
}

// Stream record framing (all multi-byte ints big-endian):
//
//	[8B  recLen]                      length of everything after this prefix
//	[8B  seq]
//	[1B  kind]
//	[8B  emittedAtUnixNano]           0 == zero time
//	[2B  streamIDLen][streamID]
//	[2B  sourceLSNLen][sourceLSN]
//	[4B  wireLen][wire]
//
// recLen bounds the body so a reader can frame each record without decoding it,
// and so a corrupt/hostile peer cannot force an unbounded allocation.
const (
	streamRecHeaderFixed = 8 + 1 + 8 // seq + kind + emittedAt
	// MaxStreamRecordSize caps the body a receiver will allocate for one record.
	MaxStreamRecordSize = MaxFrameRecordSize
)

func encodeStreamRecord(w io.Writer, r streamRecord) error {
	sid := []byte(r.streamID)
	lsn := []byte(r.sourceLSN)
	if len(sid) > 0xFFFF {
		return fmt.Errorf("core: stream id too long (%d bytes)", len(sid))
	}
	if len(lsn) > 0xFFFF {
		return fmt.Errorf("core: source lsn too long (%d bytes)", len(lsn))
	}
	bodyLen := streamRecHeaderFixed + 2 + len(sid) + 2 + len(lsn) + 4 + len(r.wire)
	if bodyLen > MaxStreamRecordSize {
		return fmt.Errorf("core: stream record body too large (%d bytes): %w", bodyLen, ErrFrameTooLarge)
	}

	var hdr [8]byte
	binary.BigEndian.PutUint64(hdr[:], uint64(bodyLen))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}

	var fixed [streamRecHeaderFixed]byte
	binary.BigEndian.PutUint64(fixed[0:8], r.seq)
	fixed[8] = byte(r.kind)
	var en int64
	if !r.emittedAt.IsZero() {
		en = r.emittedAt.UnixNano()
	}
	binary.BigEndian.PutUint64(fixed[9:17], uint64(en))
	if _, err := w.Write(fixed[:]); err != nil {
		return err
	}

	if err := writeLenPrefixed16(w, sid); err != nil {
		return err
	}
	if err := writeLenPrefixed16(w, lsn); err != nil {
		return err
	}
	var wl [4]byte
	binary.BigEndian.PutUint32(wl[:], uint32(len(r.wire)))
	if _, err := w.Write(wl[:]); err != nil {
		return err
	}
	if _, err := w.Write(r.wire); err != nil {
		return err
	}
	return nil
}

func writeLenPrefixed16(w io.Writer, b []byte) error {
	var l [2]byte
	binary.BigEndian.PutUint16(l[:], uint16(len(b)))
	if _, err := w.Write(l[:]); err != nil {
		return err
	}
	if len(b) > 0 {
		if _, err := w.Write(b); err != nil {
			return err
		}
	}
	return nil
}

func decodeStreamRecord(r io.Reader) (streamRecord, error) {
	var hdr [8]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		if errors.Is(err, io.EOF) {
			return streamRecord{}, io.EOF
		}
		return streamRecord{}, fmt.Errorf("read record length: %w", err)
	}
	bodyLen := binary.BigEndian.Uint64(hdr[:])
	if bodyLen < streamRecHeaderFixed+2+2+4 {
		return streamRecord{}, fmt.Errorf("record body length %d too small", bodyLen)
	}
	if bodyLen > MaxStreamRecordSize {
		return streamRecord{}, fmt.Errorf("record body length %d: %w", bodyLen, ErrFrameTooLarge)
	}
	body := make([]byte, bodyLen)
	if _, err := io.ReadFull(r, body); err != nil {
		return streamRecord{}, fmt.Errorf("read record body (%d bytes): %w", bodyLen, err)
	}

	var rec streamRecord
	off := 0
	rec.seq = binary.BigEndian.Uint64(body[off : off+8])
	off += 8
	rec.kind = FrameKind(body[off])
	off++
	if !rec.kind.Valid() {
		return streamRecord{}, fmt.Errorf("record seq=%d invalid kind %d", rec.seq, rec.kind)
	}
	en := int64(binary.BigEndian.Uint64(body[off : off+8]))
	off += 8
	rec.emittedAt = emittedAtFromNano(en)

	sid, n, err := readLenPrefixed16(body[off:])
	if err != nil {
		return streamRecord{}, fmt.Errorf("record seq=%d stream id: %w", rec.seq, err)
	}
	off += n
	rec.streamID = string(sid)

	lsn, n, err := readLenPrefixed16(body[off:])
	if err != nil {
		return streamRecord{}, fmt.Errorf("record seq=%d source lsn: %w", rec.seq, err)
	}
	off += n
	rec.sourceLSN = string(lsn)

	if len(body)-off < 4 {
		return streamRecord{}, fmt.Errorf("record seq=%d truncated before wire length", rec.seq)
	}
	wireLen := binary.BigEndian.Uint32(body[off : off+4])
	off += 4
	if uint64(len(body)-off) < uint64(wireLen) {
		return streamRecord{}, fmt.Errorf("record seq=%d wire length %d exceeds remaining %d", rec.seq, wireLen, len(body)-off)
	}
	wire := make([]byte, wireLen)
	copy(wire, body[off:off+int(wireLen)])
	rec.wire = wire
	return rec, nil
}

func readLenPrefixed16(b []byte) (val []byte, consumed int, err error) {
	if len(b) < 2 {
		return nil, 0, errors.New("truncated length prefix")
	}
	l := int(binary.BigEndian.Uint16(b[:2]))
	if len(b)-2 < l {
		return nil, 0, fmt.Errorf("length %d exceeds remaining %d", l, len(b)-2)
	}
	out := make([]byte, l)
	copy(out, b[2:2+l])
	return out, 2 + l, nil
}

// --- net.Pipe duplex for tests + single-process wiring --------------------

// pipeConn is a Conn backed by two net.Pipe pairs: one for the data channel,
// one for the ack channel. It is a real, fully-duplex, synchronous in-memory
// connection (net.Pipe), not a fake — exactly what a net.Conn provides over the
// wire, so a test exercises the real SendOver/ReceiveOver byte path.
type pipeConn struct {
	data io.ReadWriteCloser
	ack  io.ReadWriteCloser
}

func (c *pipeConn) Data() io.ReadWriter { return c.data }
func (c *pipeConn) Ack() io.ReadWriter  { return c.ack }
func (c *pipeConn) Close() error {
	derr := c.data.Close()
	aerr := c.ack.Close()
	if derr != nil {
		return derr
	}
	return aerr
}

// NewPipeConnPair returns the two ends of a real net.Pipe duplex: the sender end
// (writes frames on Data, reads acks on Ack) and the receiver end (reads frames
// on Data, writes acks on Ack). Closing either end unblocks the other.
func NewPipeConnPair() (sender Conn, receiver Conn) {
	dataA, dataB := net.Pipe() // frames: sender writes A, receiver reads B
	ackA, ackB := net.Pipe()   // acks:   receiver writes A, sender reads B
	sender = &pipeConn{data: dataA, ack: ackB}
	receiver = &pipeConn{data: dataB, ack: ackA}
	return sender, receiver
}

// SplitConn builds a Conn from explicit data/ack reader-writers, e.g. an mTLS
// net.Conn for data and a second stream for acks, or an HTTP body pair. The
// passed values must be safe for one concurrent reader + one concurrent writer.
func SplitConn(data, ack io.ReadWriteCloser) Conn {
	return &pipeConn{data: data, ack: ack}
}
