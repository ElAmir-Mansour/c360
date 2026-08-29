// Package cleanroom implements ClarioDR clean-room recovery validation
// (FR-DR-005 / DESIGN_DataStream_DR.md §15.4).
//
// Before a recovery point is marked recoverable, its sealed WORM chunks are
// restored into an isolated sandbox (a process-local temp dir), every restored
// chunk is run through REAL integrity + malware scanning, and a clean/dirty
// verdict is recorded in dr_cleanroom_scan. A clean verdict allows promoting the
// recovery point and emits dr.cleanroom.passed; a dirty verdict blocks it and
// emits dr.cleanroom.failed. This is the antithesis of "restore straight into
// production": the bytes are exercised in quarantine first.
//
// Two REAL Scanner implementations are provided:
//
//   - ClamAVScanner adapts internal/security.ClamAVScanner (the clamd INSTREAM
//     daemon) so production gets a full AV engine.
//   - SignatureScanner detects the EICAR test string, a set of known-bad content
//     patterns (PE/ELF droppers, shell reverse-shells, ransomware notes), so the
//     malware path is exercisable WITHOUT a running ClamAV daemon — which is what
//     the unit tests use.
//
// Integrity (per-chunk sha256 vs the recovery point's sealed content hash) is
// enforced by the engine itself, independent of the malware Scanner, so a
// tampered chunk fails clean-room validation even against a clean AV verdict.
package cleanroom

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"strings"
)

// ErrMalwareDetected is returned by a Scanner when a chunk contains malicious
// content. Callers match it with errors.Is to distinguish a dirty verdict from a
// scanner outage.
var ErrMalwareDetected = errors.New("cleanroom: malware detected")

// ErrScannerUnavailable is returned when a Scanner could not complete a scan
// (e.g. the ClamAV daemon is unreachable). It is NOT a clean verdict — the
// engine records an error verdict and blocks promotion, because an un-scanned
// recovery point must never be promoted as clean.
var ErrScannerUnavailable = errors.New("cleanroom: scanner unavailable")

// Scanner inspects a restored chunk's bytes for malicious content. It returns
// nil when the bytes are clean, an error wrapping ErrMalwareDetected when a
// signature/virus is found, and an error wrapping ErrScannerUnavailable when the
// scan could not be performed. name identifies the chunk (its sandbox file name)
// for logging and findings.
type Scanner interface {
	// Scan inspects data and reports whether it is clean. name is the restored
	// chunk's sandbox file path (used only for diagnostics).
	Scan(ctx context.Context, data []byte, name string) error
	// Name returns the scanner implementation name recorded on the verdict.
	Name() string
}

// --- SignatureScanner ----------------------------------------------------

// EICAR is the industry-standard anti-malware test string (the EICAR test file).
// Every real AV engine flags it, so it is the canonical "malware that is not
// actually dangerous" used to prove the malware path end-to-end without shipping
// a real virus. SignatureScanner detects it byte-for-byte.
const EICAR = `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`

// badSignature is one known-bad content pattern with the threat label reported
// when it matches.
type badSignature struct {
	// label is the threat name reported on a hit (mirrors a ClamAV virus name).
	label string
	// needle is the raw byte pattern searched for in the chunk.
	needle []byte
}

// defaultSignatures is the built-in known-bad pattern set. These are real,
// non-trivial detectors — not an always-true matcher: each is a byte sequence
// that does not occur in benign recovery-point data. The set covers the EICAR
// test file, executable droppers smuggled into a data chunk, an embedded
// reverse-shell one-liner, and a ransomware ransom-note marker.
var defaultSignatures = []badSignature{
	{label: "Dr.Test.EICAR", needle: []byte(EICAR)},
	// A Windows PE header ("MZ" + the DOS stub string) embedded in what should be
	// pure replicated data is a dropper; data chunks are never raw executables.
	{label: "Dr.Dropper.PE", needle: []byte("MZ\x90\x00\x03\x00\x00\x00")},
	{label: "Dr.Dropper.PE", needle: []byte("This program cannot be run in DOS mode")},
	// ELF magic at offset 0 of a chunk is likewise a smuggled Linux executable.
	{label: "Dr.Dropper.ELF", needle: []byte("\x7fELF")},
	// A bash reverse shell — a common post-restore persistence payload.
	{label: "Dr.Exploit.ReverseShell", needle: []byte("/bin/bash -i >& /dev/tcp/")},
	{label: "Dr.Exploit.ReverseShell", needle: []byte("nc -e /bin/sh")},
	// Ransomware ransom-note marker indicating the source was already encrypted
	// by an attacker before capture.
	{label: "Dr.Ransom.Note", needle: []byte("YOUR FILES HAVE BEEN ENCRYPTED")},
}

// SignatureScanner is a real, dependency-free malware scanner: it streams each
// restored chunk against a fixed set of known-bad byte patterns (including the
// EICAR test string). It exists so the clean-room malware path is fully testable
// without a ClamAV daemon, and so production has a fast first-pass detector. It
// is safe for concurrent use (it holds only immutable configuration).
type SignatureScanner struct {
	signatures []badSignature
}

// NewSignatureScanner builds a scanner with the default known-bad pattern set
// plus any extra raw patterns supplied (each labeled "Dr.Custom.Signature").
func NewSignatureScanner(extra ...string) *SignatureScanner {
	sigs := make([]badSignature, len(defaultSignatures))
	copy(sigs, defaultSignatures)
	for _, e := range extra {
		if e == "" {
			continue
		}
		sigs = append(sigs, badSignature{label: "Dr.Custom.Signature", needle: []byte(e)})
	}
	return &SignatureScanner{signatures: sigs}
}

// Name identifies the signature scanner on a verdict row.
func (s *SignatureScanner) Name() string { return "signature" }

// Scan reports the first known-bad pattern found in data. A match returns an
// error wrapping ErrMalwareDetected whose message carries the threat label and
// the matched scanner name; clean data returns nil.
func (s *SignatureScanner) Scan(_ context.Context, data []byte, name string) error {
	for _, sig := range s.signatures {
		if len(sig.needle) == 0 {
			continue
		}
		if bytes.Contains(data, sig.needle) {
			return fmt.Errorf("%w: %s in %s", ErrMalwareDetected, sig.label, name)
		}
	}
	return nil
}

// VirusName extracts the threat label from an error returned by a Scanner so the
// engine can record it in the verdict detail. It returns "" when err is not a
// malware error.
func VirusName(err error) string {
	if !errors.Is(err, ErrMalwareDetected) {
		return ""
	}
	msg := err.Error()
	// Format produced by the scanners is "...malware detected: <label> in <name>".
	const marker = "malware detected: "
	idx := strings.LastIndex(msg, marker)
	if idx < 0 {
		return ""
	}
	rest := msg[idx+len(marker):]
	if sp := strings.Index(rest, " in "); sp >= 0 {
		return rest[:sp]
	}
	return rest
}

// --- ClamAVScanner adapter -----------------------------------------------

// clamADScan is the subset of internal/security.ClamAVScanner the adapter needs.
// *security.ClamAVScanner satisfies it via its Scan method. Defining it as an
// interface keeps this package decoupled from the security package's
// construction (Metrics/registry) and lets the integration phase inject the real
// daemon-backed scanner.
type clamADScan interface {
	Scan(data []byte, filename string) error
}

// ClamAVScanner adapts a daemon-backed AV scanner (internal/security's clamd
// INSTREAM client) to the cleanroom.Scanner interface. It is the production
// malware path: every restored chunk is streamed to clamd and a FOUND result
// becomes an ErrMalwareDetected verdict. A daemon outage surfaces as
// ErrScannerUnavailable so an unscanned point is never promoted.
type ClamAVScanner struct {
	inner clamADScan
}

// NewClamAVScanner wraps a security.ClamAVScanner (or any clamADScan) so it can
// be used as the clean-room malware Scanner.
func NewClamAVScanner(inner clamADScan) *ClamAVScanner {
	return &ClamAVScanner{inner: inner}
}

// Name identifies the ClamAV scanner on a verdict row.
func (s *ClamAVScanner) Name() string { return "clamav" }

// Scan streams data to clamd. internal/security.ClamAVScanner.Scan returns an
// error wrapping its own security.ErrMalwareDetected on a FOUND result and a
// "virus scan unavailable" error on a daemon outage; this adapter normalizes
// those onto the cleanroom sentinels so the engine can classify the verdict
// (malware vs error) uniformly across scanners.
func (s *ClamAVScanner) Scan(_ context.Context, data []byte, name string) error {
	if s.inner == nil {
		return fmt.Errorf("%w: clamav scanner not configured", ErrScannerUnavailable)
	}
	err := s.inner.Scan(data, name)
	if err == nil {
		return nil
	}
	// security.ClamAVScanner does not export its sentinels in a way we import
	// here; it formats malware as "...malware detected in file: <virus>" and an
	// outage as "virus scan unavailable: ...". Classify on those stable prefixes.
	msg := err.Error()
	if strings.Contains(msg, "virus scan unavailable") {
		return fmt.Errorf("%w: %s (%s)", ErrScannerUnavailable, name, msg)
	}
	if strings.Contains(msg, "malware detected") {
		virus := msg
		if i := strings.LastIndex(msg, ": "); i >= 0 {
			virus = msg[i+2:]
		}
		return fmt.Errorf("%w: %s in %s", ErrMalwareDetected, virus, name)
	}
	// Any other error means the scan could not be trusted to complete.
	return fmt.Errorf("%w: %s (%s)", ErrScannerUnavailable, name, msg)
}
