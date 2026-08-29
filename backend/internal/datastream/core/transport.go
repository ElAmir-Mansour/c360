package core

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// Transport ships frames between agent and control plane: compress, encrypt,
// resume on reconnect, throttle. Both ends implement the same interface.
type Transport interface {
	// Send drains frames and ships them, returning a channel of durably-acked
	// Seq values plus an async error channel for failures after the send loop
	// starts.
	Send(ctx context.Context, frames <-chan Frame) (acked <-chan uint64, errs <-chan error, err error)
	// Receive yields inbound frames and an ack callback the consumer invokes
	// with the last contiguously-applied Seq so the sender can prune/resume.
	Receive(ctx context.Context) (frames <-chan Frame, ack func(seq uint64), errs <-chan error, err error)
}

// wireFrame is a frame as it crosses the in-memory link: the payload is already
// compressed+encrypted, and the framing fields ride alongside it.
type wireFrame struct {
	streamID  string
	seq       uint64
	kind      FrameKind
	emittedAt int64 // unix nanos, preserved across the link
	sourceLSN string
	wire      []byte // compress->encrypt output
}

// MemoryTransport is an in-memory, channel-backed Transport for tests and
// single-process wiring. It models a resumable link: the sender skips any frame
// at or below the last receiver ack, so on Disconnect the link drops and a
// subsequent Send resumes at ack+1 with zero gaps and zero duplicates at the
// receiver.
//
// A single MemoryTransport instance is shared by both ends: the agent calls
// Send, the control plane calls Receive. The payload pipeline (compress ->
// encrypt on send, decrypt -> decompress on receive) runs inside the transport
// so callers ship and consume raw Frame payloads.
type MemoryTransport struct {
	codec   PayloadCodec
	bucket  *TokenBucket
	metrics *Metrics

	mu      sync.Mutex
	link    *memoryLink
	lastAck uint64
	resumes uint64
	closed  bool
}

// memoryLink is one connected session of the in-memory transport. A Disconnect
// closes done (breaking both loops) and replaces the link, so an old loop can
// never write to a new session.
type memoryLink struct {
	frames chan wireFrame
	acks   chan uint64
	done   chan struct{}

	doneOnce   sync.Once
	framesOnce sync.Once
	ackMu      sync.Mutex
	acksClosed bool
}

func newMemoryLink() *memoryLink {
	return &memoryLink{
		frames: make(chan wireFrame),
		acks:   make(chan uint64, 64),
		done:   make(chan struct{}),
	}
}

func (l *memoryLink) closeDone()   { l.doneOnce.Do(func() { close(l.done) }) }
func (l *memoryLink) closeFrames() { l.framesOnce.Do(func() { close(l.frames) }) }

func (l *memoryLink) closeAcks() {
	l.ackMu.Lock()
	defer l.ackMu.Unlock()
	if l.acksClosed {
		return
	}
	close(l.acks)
	l.acksClosed = true
}

// publishAck echoes an ack on the link's acked channel without blocking.
func (l *memoryLink) publishAck(seq uint64) {
	l.ackMu.Lock()
	defer l.ackMu.Unlock()
	if l.acksClosed {
		return
	}
	select {
	case <-l.done:
	case l.acks <- seq:
	default:
	}
}

// MemoryTransportOption configures a MemoryTransport.
type MemoryTransportOption func(*MemoryTransport)

// WithThrottle attaches a byte-rate token bucket to the transport's send path.
func WithThrottle(b *TokenBucket) MemoryTransportOption {
	return func(t *MemoryTransport) { t.bucket = b }
}

// WithMetrics attaches core metrics so the transport records bytes/frames
// shipped and resume counts.
func WithMetrics(m *Metrics) MemoryTransportOption {
	return func(t *MemoryTransport) { t.metrics = m }
}

// NewMemoryTransport builds an in-memory Transport whose payload pipeline uses
// the given 32-byte AES-256 DEK for the encrypt stage of compress->encrypt.
func NewMemoryTransport(dek []byte, opts ...MemoryTransportOption) (*MemoryTransport, error) {
	codec, err := NewPayloadCodec(dek)
	if err != nil {
		return nil, fmt.Errorf("core: build transport codec: %w", err)
	}
	t := &MemoryTransport{codec: codec}
	for _, o := range opts {
		o(t)
	}
	t.connect()
	return t, nil
}

func (t *MemoryTransport) connect() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.link != nil {
		return
	}
	t.link = newMemoryLink()
}

func (t *MemoryTransport) detachLink(link *memoryLink) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.link == link {
		t.link = nil
	}
}

// Disconnect drops the current link, simulating a network failure. The next
// Send resumes from lastAck+1. Safe to call repeatedly.
func (t *MemoryTransport) Disconnect() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.link != nil {
		t.link.closeDone()
		t.link.closeAcks()
		t.link = nil
	}
}

// Reconnect re-establishes the link after a Disconnect and counts a resume.
func (t *MemoryTransport) Reconnect() {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed || t.link != nil {
		return
	}
	t.resumes++
	if t.metrics != nil {
		t.metrics.TransportResumes.WithLabelValues("memory").Inc()
	}
	t.link = newMemoryLink()
}

// Resumes reports how many times the transport has reconnected.
func (t *MemoryTransport) Resumes() uint64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.resumes
}

// ResumeFrom returns the Seq the next Send should resume after (the last
// contiguous ack). The first frame shipped after this must be ResumeFrom()+1.
func (t *MemoryTransport) ResumeFrom() uint64 {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.lastAck
}

var errLinkDown = errors.New("core: transport link down")

// Send ships frames across the current link (compress->encrypt + throttle),
// skipping any frame at or below the last receiver ack (idempotent resume) and
// stopping cleanly if the link drops. The returned channel carries acked Seqs.
func (t *MemoryTransport) Send(ctx context.Context, frames <-chan Frame) (<-chan uint64, <-chan error, error) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil, nil, errors.New("core: transport closed")
	}
	link := t.link
	t.mu.Unlock()
	if link == nil {
		return nil, nil, errLinkDown
	}

	errs := make(chan error, 1)
	go func() {
		defer close(errs)
		defer func() {
			link.closeFrames()
			t.detachLink(link)
		}()
		for {
			select {
			case <-ctx.Done():
				errs <- fmt.Errorf("core: transport send cancelled: %w", ctx.Err())
				return
			case <-link.done:
				errs <- errLinkDown
				return
			case f, ok := <-frames:
				if !ok {
					return
				}
				t.mu.Lock()
				skip := f.Seq <= t.lastAck
				t.mu.Unlock()
				if skip {
					continue
				}
				wire, err := t.codec.Encode(f.Payload)
				if err != nil {
					errs <- fmt.Errorf("core: transport encode seq=%d: %w", f.Seq, err)
					return
				}
				if t.bucket != nil {
					if err := t.bucket.Wait(ctx, len(wire)); err != nil {
						errs <- fmt.Errorf("core: transport throttle seq=%d: %w", f.Seq, err)
						return
					}
				}
				wf := wireFrame{
					streamID:  f.StreamID,
					seq:       f.Seq,
					kind:      f.Kind,
					emittedAt: f.EmittedAt.UnixNano(),
					sourceLSN: f.SourceLSN,
					wire:      wire,
				}
				select {
				case <-ctx.Done():
					errs <- fmt.Errorf("core: transport send cancelled: %w", ctx.Err())
					return
				case <-link.done:
					errs <- errLinkDown
					return
				case link.frames <- wf:
					if t.metrics != nil {
						t.metrics.BytesShipped.WithLabelValues(f.StreamID).Add(float64(len(f.Payload)))
						t.metrics.FramesShipped.WithLabelValues(f.StreamID, f.Kind.String()).Inc()
					}
				}
			}
		}
	}()
	return link.acks, errs, nil
}

// Receive yields decoded frames and an ack callback. ack(seq) records the last
// contiguously-applied Seq so a Send after Disconnect resumes at lastAck+1.
func (t *MemoryTransport) Receive(ctx context.Context) (<-chan Frame, func(seq uint64), <-chan error, error) {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return nil, nil, nil, errors.New("core: transport closed")
	}
	link := t.link
	t.mu.Unlock()
	if link == nil {
		return nil, nil, nil, errLinkDown
	}

	out := make(chan Frame)
	errs := make(chan error, 1)
	go func() {
		defer close(out)
		defer close(errs)
		for {
			select {
			case <-ctx.Done():
				errs <- fmt.Errorf("core: transport receive cancelled: %w", ctx.Err())
				return
			case <-link.done:
				errs <- errLinkDown
				return
			case wf, ok := <-link.frames:
				if !ok {
					return
				}
				raw, err := t.codec.Decode(wf.wire)
				if err != nil {
					errs <- fmt.Errorf("core: transport decode seq=%d: %w", wf.seq, err)
					return
				}
				f := Frame{
					StreamID:  wf.streamID,
					Seq:       wf.seq,
					Kind:      wf.kind,
					Payload:   raw,
					SourceLSN: wf.sourceLSN,
					EmittedAt: emittedAtFromNano(wf.emittedAt),
				}
				select {
				case <-ctx.Done():
					errs <- fmt.Errorf("core: transport receive cancelled: %w", ctx.Err())
					return
				case <-link.done:
					errs <- errLinkDown
					return
				case out <- f:
				}
			}
		}
	}()

	ack := func(seq uint64) {
		t.mu.Lock()
		if seq > t.lastAck {
			t.lastAck = seq
		}
		t.mu.Unlock()
		link.publishAck(seq)
	}
	return out, ack, errs, nil
}

// Close tears down the transport permanently.
func (t *MemoryTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.closed = true
	if t.link != nil {
		t.link.closeDone()
		t.link.closeAcks()
		t.link = nil
	}
	return nil
}

// emittedAtFromNano reconstructs EmittedAt from unix-nanos, mapping zero to the
// zero time.
func emittedAtFromNano(ns int64) time.Time {
	if ns == 0 {
		return time.Time{}
	}
	return time.Unix(0, ns)
}
