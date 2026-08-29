package core

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// Wire format (§3.3): a length-prefixed binary record.
//
//	[4B len][8B seq][1B kind][varint LSN-len][LSN][payload]
//
// len (big-endian uint32) is the byte count of everything that follows it (the
// 8B seq, the 1B kind, the LSN varint+bytes, and the payload), so a stream
// reader can frame each record without decoding it. seq is big-endian uint64.
// kind is a single FrameKind byte. The LSN is length-prefixed with an unsigned
// varint; the payload consumes the remainder of the record.
const (
	frameSeqSize  = 8 // uint64 big-endian
	frameKindSize = 1 // FrameKind byte
	frameLenSize  = 4 // uint32 big-endian record length prefix

	// MaxFrameRecordSize caps the declared record length the decoder will honour
	// to bound memory against a hostile or corrupt stream. A frame's payload is
	// chunked well below this by Capturers.
	MaxFrameRecordSize = 256 * 1024 * 1024 // 256 MiB
)

// ErrFrameTooLarge is returned by DecodeFrame when a record's declared length
// exceeds MaxFrameRecordSize.
var ErrFrameTooLarge = errors.New("core: frame record exceeds maximum size")

// EncodeFrame writes f to w in the §3.3 length-prefixed binary body format. It
// round-trips the body fields (Seq, Kind, SourceLSN, Payload), including an
// empty payload and a non-empty SourceLSN. StreamID and EmittedAt are transport
// envelope fields and are not encoded here.
func EncodeFrame(w io.Writer, f Frame) error {
	if !f.Kind.Valid() {
		return fmt.Errorf("core: encode frame seq=%d: invalid kind %d", f.Seq, f.Kind)
	}
	lsn := []byte(f.SourceLSN)

	// Body = seq + kind + varint(len(lsn)) + lsn + payload.
	var body bytes.Buffer
	var u64 [frameSeqSize]byte
	binary.BigEndian.PutUint64(u64[:], f.Seq)
	body.Write(u64[:])
	body.WriteByte(byte(f.Kind))

	var varintBuf [binary.MaxVarintLen64]byte
	n := binary.PutUvarint(varintBuf[:], uint64(len(lsn)))
	body.Write(varintBuf[:n])
	body.Write(lsn)
	body.Write(f.Payload)

	if body.Len() > MaxFrameRecordSize {
		return fmt.Errorf("core: encode frame seq=%d: body too large (%d bytes): %w", f.Seq, body.Len(), ErrFrameTooLarge)
	}
	var lenBuf [frameLenSize]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(body.Len()))
	if _, err := w.Write(lenBuf[:]); err != nil {
		return fmt.Errorf("core: encode frame seq=%d: write length prefix: %w", f.Seq, err)
	}
	if _, err := w.Write(body.Bytes()); err != nil {
		return fmt.Errorf("core: encode frame seq=%d: write body: %w", f.Seq, err)
	}
	return nil
}

// DecodeFrame reads one frame from r in the §3.3 format. It returns io.EOF
// (unwrapped) when r is cleanly exhausted at a record boundary, so callers can
// loop until EOF. A truncated record mid-way yields a wrapped
// io.ErrUnexpectedEOF.
func DecodeFrame(r io.Reader) (Frame, error) {
	var lenBuf [frameLenSize]byte
	if _, err := io.ReadFull(r, lenBuf[:]); err != nil {
		if errors.Is(err, io.EOF) {
			// Clean boundary: surface bare io.EOF for loop termination.
			return Frame{}, io.EOF
		}
		return Frame{}, fmt.Errorf("core: decode frame: read length prefix: %w", err)
	}
	recordLen := binary.BigEndian.Uint32(lenBuf[:])
	if recordLen < frameSeqSize+frameKindSize+1 {
		return Frame{}, fmt.Errorf("core: decode frame: record length %d too small", recordLen)
	}
	if recordLen > MaxFrameRecordSize {
		return Frame{}, fmt.Errorf("core: decode frame: declared length %d: %w", recordLen, ErrFrameTooLarge)
	}

	body := make([]byte, recordLen)
	if _, err := io.ReadFull(r, body); err != nil {
		return Frame{}, fmt.Errorf("core: decode frame: read body (%d bytes): %w", recordLen, err)
	}

	var f Frame
	off := 0
	f.Seq = binary.BigEndian.Uint64(body[off : off+frameSeqSize])
	off += frameSeqSize
	f.Kind = FrameKind(body[off])
	off += frameKindSize
	if !f.Kind.Valid() {
		return Frame{}, fmt.Errorf("core: decode frame seq=%d: invalid kind %d", f.Seq, f.Kind)
	}

	lsnLen, varintN := binary.Uvarint(body[off:])
	if varintN <= 0 {
		return Frame{}, fmt.Errorf("core: decode frame seq=%d: malformed LSN length varint", f.Seq)
	}
	off += varintN
	if uint64(len(body)-off) < lsnLen {
		return Frame{}, fmt.Errorf("core: decode frame seq=%d: LSN length %d exceeds remaining %d bytes", f.Seq, lsnLen, len(body)-off)
	}
	f.SourceLSN = string(body[off : off+int(lsnLen)])
	off += int(lsnLen)

	// Remainder is the payload. Copy so it does not alias the body slice.
	payload := make([]byte, len(body)-off)
	copy(payload, body[off:])
	f.Payload = payload

	return f, nil
}

// DecodeFrames reads every frame from r until EOF, returning them in order. It
// is a convenience for tests and bounded streams; production transport decodes
// incrementally.
func DecodeFrames(r io.Reader) ([]Frame, error) {
	br := bufio.NewReader(r)
	var frames []Frame
	for {
		f, err := DecodeFrame(br)
		if errors.Is(err, io.EOF) {
			return frames, nil
		}
		if err != nil {
			return frames, err
		}
		frames = append(frames, f)
	}
}
