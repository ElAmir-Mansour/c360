package core

import (
	"bytes"
	"errors"
	"io"
	"testing"
	"time"
)

func TestEncodeDecodeFrame_RoundTrip(t *testing.T) {
	t.Parallel()

	large := bytes.Repeat([]byte("clario-dr-payload-"), 100_000) // ~1.8 MiB

	cases := []struct {
		name  string
		frame Frame
	}{
		{
			name: "snapshot chunk empty payload",
			frame: Frame{
				StreamID:  "stream-a",
				Seq:       1,
				Kind:      FrameKindSnapshotChunk,
				Payload:   []byte{},
				SourceLSN: "0/16B3F00",
				EmittedAt: time.Unix(1718000000, 0).UTC(),
			},
		},
		{
			name: "wal non-empty lsn and payload",
			frame: Frame{
				StreamID:  "stream-b",
				Seq:       9_223_372_036_854_775_807, // large seq
				Kind:      FrameKindWAL,
				Payload:   []byte("BEGIN;UPDATE t SET x=1;COMMIT;"),
				SourceLSN: "FF/FFFFFFFF",
			},
		},
		{
			name: "file delta nil payload",
			frame: Frame{
				StreamID:  "stream-c",
				Seq:       42,
				Kind:      FrameKindFileDelta,
				Payload:   nil,
				SourceLSN: "offset:4096",
			},
		},
		{
			name: "marker empty lsn",
			frame: Frame{
				StreamID:  "stream-d",
				Seq:       7,
				Kind:      FrameKindMarker,
				Payload:   []byte("marker"),
				SourceLSN: "",
			},
		},
		{
			name: "large payload",
			frame: Frame{
				StreamID:  "stream-e",
				Seq:       1000,
				Kind:      FrameKindSnapshotChunk,
				Payload:   large,
				SourceLSN: "0/0",
			},
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			var buf bytes.Buffer
			if err := EncodeFrame(&buf, tc.frame); err != nil {
				t.Fatalf("EncodeFrame: %v", err)
			}

			got, err := DecodeFrame(&buf)
			if err != nil {
				t.Fatalf("DecodeFrame: %v", err)
			}

			if got.Seq != tc.frame.Seq {
				t.Errorf("Seq = %d, want %d", got.Seq, tc.frame.Seq)
			}
			if got.Kind != tc.frame.Kind {
				t.Errorf("Kind = %v, want %v", got.Kind, tc.frame.Kind)
			}
			if got.SourceLSN != tc.frame.SourceLSN {
				t.Errorf("SourceLSN = %q, want %q", got.SourceLSN, tc.frame.SourceLSN)
			}
			if !bytes.Equal(normPayload(got.Payload), normPayload(tc.frame.Payload)) {
				t.Errorf("Payload mismatch (len got=%d want=%d)", len(got.Payload), len(tc.frame.Payload))
			}
		})
	}
}

// normPayload treats nil and empty as equal for comparison; the codec
// faithfully preserves length but a nil round-trips as a zero-length slice.
func normPayload(b []byte) []byte {
	if b == nil {
		return []byte{}
	}
	return b
}

// StreamID is not part of the §3.3 wire record (StreamID rides on the transport
// envelope, not the frame body). Verify the documented codec round-trips the
// fields it owns; StreamID is carried separately by the transport.
func TestEncodeDecodeFrame_StreamIDNotInWire(t *testing.T) {
	t.Parallel()
	f := Frame{StreamID: "set-by-transport", Seq: 5, Kind: FrameKindWAL, Payload: []byte("x")}
	var buf bytes.Buffer
	if err := EncodeFrame(&buf, f); err != nil {
		t.Fatal(err)
	}
	got, err := DecodeFrame(&buf)
	if err != nil {
		t.Fatal(err)
	}
	// The codec does not encode StreamID, so it decodes empty.
	if got.StreamID != "" {
		t.Errorf("expected StreamID to be empty after decode, got %q", got.StreamID)
	}
}

func TestDecodeFrames_MultipleAndEOF(t *testing.T) {
	t.Parallel()

	frames := []Frame{
		{Seq: 1, Kind: FrameKindWAL, Payload: []byte("one"), SourceLSN: "a"},
		{Seq: 2, Kind: FrameKindWAL, Payload: []byte("two"), SourceLSN: "b"},
		{Seq: 3, Kind: FrameKindMarker, Payload: nil, SourceLSN: ""},
	}

	var buf bytes.Buffer
	for _, f := range frames {
		if err := EncodeFrame(&buf, f); err != nil {
			t.Fatal(err)
		}
	}

	got, err := DecodeFrames(&buf)
	if err != nil {
		t.Fatalf("DecodeFrames: %v", err)
	}
	if len(got) != len(frames) {
		t.Fatalf("decoded %d frames, want %d", len(got), len(frames))
	}
	for i := range frames {
		if got[i].Seq != frames[i].Seq || got[i].Kind != frames[i].Kind {
			t.Errorf("frame %d mismatch: got seq=%d kind=%v", i, got[i].Seq, got[i].Kind)
		}
	}
}

func TestDecodeFrame_CleanEOF(t *testing.T) {
	t.Parallel()
	_, err := DecodeFrame(bytes.NewReader(nil))
	if !errors.Is(err, io.EOF) {
		t.Fatalf("expected io.EOF on empty reader, got %v", err)
	}
}

func TestDecodeFrame_TruncatedBody(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	if err := EncodeFrame(&buf, Frame{Seq: 1, Kind: FrameKindWAL, Payload: []byte("hello"), SourceLSN: "x"}); err != nil {
		t.Fatal(err)
	}
	// Chop the last few bytes to truncate the body.
	full := buf.Bytes()
	truncated := full[:len(full)-3]
	_, err := DecodeFrame(bytes.NewReader(truncated))
	if err == nil {
		t.Fatal("expected error decoding truncated frame, got nil")
	}
	if errors.Is(err, io.EOF) {
		t.Fatalf("truncation should not be a clean EOF, got %v", err)
	}
}

func TestEncodeFrame_InvalidKind(t *testing.T) {
	t.Parallel()

	var buf bytes.Buffer
	err := EncodeFrame(&buf, Frame{Seq: 1, Kind: FrameKind(255)})
	if err == nil {
		t.Fatal("expected invalid frame kind to fail")
	}
}

func TestDecodeFrame_InvalidKind(t *testing.T) {
	t.Parallel()

	body := []byte{
		0, 0, 0, 1, // seq
		0, 0, 0, 0,
		255, // invalid kind
		0,   // empty LSN
	}
	var buf bytes.Buffer
	if _, err := buf.Write([]byte{0, 0, 0, byte(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := buf.Write(body); err != nil {
		t.Fatal(err)
	}
	if _, err := DecodeFrame(&buf); err == nil {
		t.Fatal("expected invalid frame kind to fail")
	}
}
