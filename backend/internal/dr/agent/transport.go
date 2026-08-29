package agent

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/clario360/platform/internal/datastream/core"
)

// ShipTransport ships a stream's Frames to the control-plane mTLS ingest
// listener. It is the SEND side of the shared replication-core Transport: it
// dials the ingest endpoint with the agent's client certificate, opens a single
// full-duplex HTTP request whose BODY carries the frame byte stream
// (agent -> control plane) and whose RESPONSE body carries 8-byte ack cursors
// (control plane -> agent), and drives core.StreamTransport.SendOver over that
// connection.
//
// This matches the ingest handler wire protocol exactly: the server adapts the
// request body to the core stream-transport Data channel and the response body
// to the Ack channel (internal/dr/ingest.Handler.IngestHTTP). Resume is
// end-to-end: the response acks advance core.StreamTransport's internal cursor
// so a reconnect re-ships only the un-acked tail; the agent runtime additionally
// records the highest ack in its durable local checkpoint cache so a process
// restart resumes from disk.
type ShipTransport struct {
	baseURL   string
	client    *http.Client
	transport *core.StreamTransport
	streamID  string

	// onAck is invoked (best-effort, monotonic) with each acked cursor so the
	// runtime can advance its durable local checkpoint as frames are confirmed.
	mu           sync.Mutex
	lsnBySeq     map[uint64]string
	lastAck      uint64
	onAck        func(seq uint64)
	onCheckpoint func(cp Checkpoint)
}

// ShipConfig configures a ShipTransport for one stream.
type ShipConfig struct {
	// IngestURL is the base URL of the mTLS ingest listener, e.g.
	// https://dr.control-plane:8098. The per-stream path is appended.
	IngestURL string
	// StreamID is the replication_stream id this transport ships.
	StreamID string
	// ClientCert is the agent's enrolled mTLS client certificate + key.
	ClientCert tls.Certificate
	// ClientCertProvider, when set, supplies the current client certificate for
	// every TLS handshake. It lets a long-running agent use a renewed leaf cert
	// on the next reconnect without rebuilding the runtime.
	ClientCertProvider func() (tls.Certificate, error)
	// CAChainPEM anchors trust in the control-plane ingest server certificate.
	// Required unless InsecureSkipVerify is set: the ingest listener presents a
	// cert signed by the DR CA the agent received at enrollment.
	CAChainPEM []byte
	// DEK is the 32-byte AES-256 per-stream data key used to encrypt frame
	// payloads on the wire (the control plane decrypts with the same key).
	DEK []byte
	// ServerName overrides the TLS SNI/verification name when the ingest URL host
	// is an IP or differs from the server certificate's SAN (used in tests).
	ServerName string
	// Throttle, when set, byte-rate-limits the send path.
	Throttle *core.TokenBucket
	// Metrics, when set, records bytes/frames shipped and resume counts.
	Metrics *core.Metrics
	// MetricsLabel labels the transport in metrics (default "dr-agent").
	MetricsLabel string
	// DialTimeout bounds the TLS handshake/connect (default 30s).
	DialTimeout time.Duration
	// InsecureSkipVerify disables server cert verification. ONLY for local tests
	// over loopback; never set in production.
	InsecureSkipVerify bool
}

// NewShipTransport builds a ShipTransport. It validates the DEK and assembles
// the mTLS HTTP client up front so Ship can be called repeatedly (reconnect).
func NewShipTransport(cfg ShipConfig) (*ShipTransport, error) {
	if strings.TrimSpace(cfg.IngestURL) == "" {
		return nil, errors.New("agent: ship transport requires an ingest URL")
	}
	if cfg.StreamID == "" {
		return nil, errors.New("agent: ship transport requires a stream id")
	}
	if len(cfg.DEK) != core.AESKeySize256 {
		return nil, fmt.Errorf("agent: ship transport DEK must be %d bytes, got %d", core.AESKeySize256, len(cfg.DEK))
	}

	tlsCfg := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: cfg.InsecureSkipVerify, //nolint:gosec // gated to loopback tests via config
	}
	if cfg.ClientCertProvider != nil {
		tlsCfg.GetClientCertificate = func(*tls.CertificateRequestInfo) (*tls.Certificate, error) {
			cert, err := cfg.ClientCertProvider()
			if err != nil {
				return nil, err
			}
			return &cert, nil
		}
	} else {
		tlsCfg.Certificates = []tls.Certificate{cfg.ClientCert}
	}
	if !cfg.InsecureSkipVerify {
		if len(cfg.CAChainPEM) == 0 {
			return nil, errors.New("agent: ship transport requires a CA chain to verify the ingest server")
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(cfg.CAChainPEM) {
			return nil, errors.New("agent: ship transport CA chain has no PEM certificates")
		}
		tlsCfg.RootCAs = pool
	}
	if cfg.ServerName != "" {
		tlsCfg.ServerName = cfg.ServerName
	}

	dialTimeout := cfg.DialTimeout
	if dialTimeout <= 0 {
		dialTimeout = 30 * time.Second
	}
	httpTransport := &http.Transport{
		TLSClientConfig:     tlsCfg,
		TLSHandshakeTimeout: dialTimeout,
		ForceAttemptHTTP2:   false, // 1.1 chunked full-duplex; explicit and predictable
		DisableCompression:  true,  // payloads are already compressed by the codec
		DisableKeepAlives:   true,  // every reconnect handshakes with the latest cert
	}
	client := &http.Client{Transport: httpTransport}

	label := cfg.MetricsLabel
	if label == "" {
		label = "dr-agent"
	}
	opts := []core.StreamTransportOption{}
	if cfg.Throttle != nil {
		opts = append(opts, core.WithStreamThrottle(cfg.Throttle))
	}
	if cfg.Metrics != nil {
		opts = append(opts, core.WithStreamMetrics(cfg.Metrics, label))
	}
	st, err := core.NewStreamTransport(cfg.DEK, opts...)
	if err != nil {
		return nil, fmt.Errorf("agent: build stream transport: %w", err)
	}

	return &ShipTransport{
		baseURL:   strings.TrimRight(cfg.IngestURL, "/"),
		client:    client,
		transport: st,
		streamID:  cfg.StreamID,
		lsnBySeq:  map[uint64]string{},
	}, nil
}

// SetAckObserver registers a callback invoked with each new (monotonic) ack
// cursor the control plane returns, so the runtime advances its durable local
// checkpoint as frames are confirmed. It must be set before Ship.
func (s *ShipTransport) SetAckObserver(fn func(seq uint64)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onAck = fn
}

// SetCheckpointObserver registers a callback invoked with each new acked cursor
// plus the SourceLSN from the corresponding shipped frame. This is the durable
// resume record the agent persists for logical replication slots.
func (s *ShipTransport) SetCheckpointObserver(fn func(cp Checkpoint)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onCheckpoint = fn
}

// ResumeFrom is the highest Seq the control plane has acked across all Ship
// calls so far; the next frame shipped is ResumeFrom()+1.
func (s *ShipTransport) ResumeFrom() uint64 {
	s.mu.Lock()
	observed := s.lastAck
	s.mu.Unlock()
	if transportAck := s.transport.ResumeFrom(); transportAck > observed {
		return transportAck
	}
	return observed
}

// Resumes reports how many ship sessions re-shipped after a reconnect.
func (s *ShipTransport) Resumes() uint64 { return s.transport.Resumes() }

// Ship opens one full-duplex mTLS HTTP request to the ingest listener and drains
// frames from src over it until src is closed, ctx is cancelled, or the link
// drops. It returns nil on a clean drain. On a link drop it returns an error
// that errors.Is(err, ErrLinkDropped) so the runtime can reconnect and call Ship
// again with the same (un-acked) frame source — core.StreamTransport skips the
// already-acked prefix so no frame is duplicated and none is lost.
func (s *ShipTransport) Ship(ctx context.Context, src <-chan core.Frame) error {
	endpoint := fmt.Sprintf("%s/streams/%s/frames", s.baseURL, s.streamID)
	shipCtx, cancelTrack := context.WithCancel(ctx)
	defer cancelTrack()

	// The request body is the frame Data channel: SendOver writes frames into the
	// pipe writer; the HTTP client streams the pipe reader as the request body.
	bodyR, bodyW := io.Pipe()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bodyR)
	if err != nil {
		_ = bodyR.CloseWithError(err)
		return fmt.Errorf("agent: build ship request: %w", err)
	}
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Accept", "application/octet-stream")
	req.ContentLength = -1 // chunked: stream the body

	respCh := make(chan shipResp, 1)
	go func() {
		resp, derr := s.client.Do(req)
		respCh <- shipResp{resp: resp, err: derr}
	}()

	// ackReader exposes the response body as the Ack channel. It blocks the first
	// Read until the response headers arrive (the server writes 200 + headers
	// immediately on accept) and signals done(EOF/error) so Ship knows when the
	// transport's internal ack reader has fully drained — no second concurrent
	// reader of the body.
	ar := newAckReader(respCh, s.observeAck)
	conn := &shipConn{data: bodyW, ack: ar, bodyR: bodyR}

	trackedSrc := s.trackFrameSource(shipCtx, src)
	sendErr := s.transport.SendOver(shipCtx, conn, trackedSrc)
	cancelTrack()

	// Closing the body writer signals end-of-stream so the server returns from
	// ReceiveOver and flushes its final acks; CloseWithError on a send failure so
	// the in-flight request is torn down.
	if sendErr != nil {
		_ = bodyW.CloseWithError(sendErr)
	} else {
		_ = bodyW.Close()
	}

	// Wait for the transport's ack reader to fully drain the response body so the
	// final acks have advanced the cursor and the body is consumed before the
	// next reconnect. The transport reads conn.Ack() in its own goroutine; ar
	// closes its done channel when that read hits EOF/error.
	ar.waitDrained(ctx)
	if resp := ar.response(); resp != nil {
		resp.Body.Close()
		if sendErr == nil && resp.StatusCode != http.StatusOK {
			return fmt.Errorf("%w: ingest returned status %d", ErrLinkDropped, resp.StatusCode)
		}
	}

	if sendErr != nil {
		if isLinkDrop(sendErr) {
			return fmt.Errorf("%w: %v", ErrLinkDropped, sendErr)
		}
		return sendErr
	}
	if rerr := ar.requestErr(); rerr != nil {
		return fmt.Errorf("%w: %v", ErrLinkDropped, rerr)
	}
	return nil
}

func (s *ShipTransport) trackFrameSource(ctx context.Context, src <-chan core.Frame) <-chan core.Frame {
	out := make(chan core.Frame)
	go func() {
		defer close(out)
		for {
			select {
			case <-ctx.Done():
				return
			case f, ok := <-src:
				if !ok {
					return
				}
				s.rememberFrame(f)
				select {
				case <-ctx.Done():
					return
				case out <- f:
				}
			}
		}
	}()
	return out
}

func (s *ShipTransport) rememberFrame(f core.Frame) {
	if f.Seq == 0 {
		return
	}
	s.mu.Lock()
	s.lsnBySeq[f.Seq] = f.SourceLSN
	s.mu.Unlock()
}

func (s *ShipTransport) observeAck(seq uint64) {
	if seq == 0 {
		return
	}
	s.mu.Lock()
	if seq > s.lastAck {
		s.lastAck = seq
	}
	sourceLSN := s.lsnBySeq[seq]
	if sourceLSN == "" {
		var best uint64
		for candidate, lsn := range s.lsnBySeq {
			if candidate <= seq && candidate > best {
				best = candidate
				sourceLSN = lsn
			}
		}
	}
	for candidate := range s.lsnBySeq {
		if candidate <= seq {
			delete(s.lsnBySeq, candidate)
		}
	}
	onAck := s.onAck
	onCheckpoint := s.onCheckpoint
	s.mu.Unlock()

	if onAck != nil {
		onAck(seq)
	}
	if onCheckpoint != nil {
		onCheckpoint(Checkpoint{
			StreamID:  s.streamID,
			AckedSeq:  seq,
			SourceLSN: sourceLSN,
			UpdatedAt: time.Now().UTC(),
		})
	}
}

// ErrLinkDropped indicates the ship session ended due to a recoverable link
// failure (the control plane dropped, restarted, or the request errored). The
// runtime reconnects and re-ships the un-acked tail.
var ErrLinkDropped = errors.New("agent: ship link dropped")

func isLinkDrop(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.ErrClosedPipe) {
		return true
	}
	// core.StreamTransport wraps a dropped connection as its internal sentinel;
	// the wrapped text is stable ("connection closed").
	return strings.Contains(err.Error(), "connection closed")
}

type shipResp struct {
	resp *http.Response
	err  error
}

// shipConn adapts the HTTP request body (data) + response body (ack) to a
// core.Conn so core.StreamTransport.SendOver runs unchanged over the wire.
type shipConn struct {
	data  io.Writer
	ack   io.Reader
	bodyR *io.PipeReader
}

func (c *shipConn) Data() io.ReadWriter { return readWriter{w: c.data} }
func (c *shipConn) Ack() io.ReadWriter  { return readWriter{r: c.ack} }
func (c *shipConn) Close() error {
	if c.bodyR != nil {
		return c.bodyR.Close()
	}
	return nil
}

// readWriter adapts a one-directional stream to io.ReadWriter; the unused
// direction errors so a misuse is loud rather than silent.
type readWriter struct {
	r io.Reader
	w io.Writer
}

func (rw readWriter) Read(p []byte) (int, error) {
	if rw.r == nil {
		return 0, io.EOF
	}
	return rw.r.Read(p)
}

func (rw readWriter) Write(p []byte) (int, error) {
	if rw.w == nil {
		return 0, io.ErrClosedPipe
	}
	return rw.w.Write(p)
}

// ackReader resolves the HTTP response lazily and exposes its body as the ack
// byte stream the transport reads. It is read by exactly one goroutine (the
// transport's internal readAcks), so it needs no read mutex; it records each
// complete 8-byte cursor for the runtime's checkpoint observer and signals done
// when the body is exhausted.
type ackReader struct {
	respCh chan shipResp
	onAck  func(seq uint64)

	once     sync.Once
	resolved shipResp
	body     io.Reader

	done     chan struct{}
	doneOnce sync.Once

	pos     int
	buf     [8]byte
	lastAck uint64
}

func newAckReader(respCh chan shipResp, onAck func(seq uint64)) *ackReader {
	return &ackReader{respCh: respCh, onAck: onAck, done: make(chan struct{})}
}

func (a *ackReader) resolve() {
	a.once.Do(func() {
		a.resolved = <-a.respCh
		if a.resolved.resp != nil {
			a.body = a.resolved.resp.Body
		}
	})
}

func (a *ackReader) Read(p []byte) (int, error) {
	a.resolve()
	if a.resolved.err != nil {
		a.signalDone()
		return 0, a.resolved.err
	}
	if a.body == nil {
		a.signalDone()
		return 0, io.EOF
	}
	n, err := a.body.Read(p)
	if n > 0 {
		a.observe(p[:n])
	}
	if err != nil {
		a.signalDone()
	}
	return n, err
}

// observe accumulates ack bytes across reads and fires onAck for each complete,
// strictly-increasing 8-byte cursor.
func (a *ackReader) observe(b []byte) {
	for _, by := range b {
		a.buf[a.pos] = by
		a.pos++
		if a.pos == 8 {
			a.pos = 0
			seq := binary.BigEndian.Uint64(a.buf[:])
			if seq > a.lastAck {
				a.lastAck = seq
				if a.onAck != nil {
					a.onAck(seq)
				}
			}
		}
	}
}

func (a *ackReader) signalDone() { a.doneOnce.Do(func() { close(a.done) }) }

// waitDrained blocks until the transport's ack reader has consumed the response
// body to EOF/error (or ctx is done). After it returns no other goroutine is
// reading the body.
func (a *ackReader) waitDrained(ctx context.Context) {
	a.resolve()
	if a.resolved.err != nil {
		return
	}
	select {
	case <-a.done:
	case <-ctx.Done():
	}
}

func (a *ackReader) response() *http.Response {
	a.resolve()
	return a.resolved.resp
}

func (a *ackReader) requestErr() error {
	a.resolve()
	return a.resolved.err
}
