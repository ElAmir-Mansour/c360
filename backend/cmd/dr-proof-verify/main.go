// Command dr-proof-verify is a STANDALONE offline auditor tool for sealed
// rehearsal-proof envelopes. It needs NO running service, NO database and NO
// access to the WORM bucket: given a sealed proof envelope JSON (a
// dr_rehearsal_proof row / rehearsalproof.SealedProof as JSON) and the
// verification public key as an SPKI ("PUBLIC KEY") PEM, it independently
// confirms that
//
//  1. the recomputed canonical envelope hash equals the stored EnvelopeHash
//     (the evidence has not been tampered with), and
//  2. the detached digital signature verifies over that hash under the public
//     key (the evidence was signed by the holder of the private key).
//
// It prints a JSON VerifyResult and exits 0 on success, nonzero on any failure,
// so it drops straight into a procurement/audit pipeline.
//
// Usage:
//
//	dr-proof-verify -proof sealed_proof.json -pubkey verify_pub.pem
//	cat sealed_proof.json | dr-proof-verify -pubkey verify_pub.pem
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/clario360/platform/internal/dr/rehearsalproof"
)

func main() {
	proofPath := flag.String("proof", "", "path to the sealed-proof envelope JSON (default: stdin)")
	pubkeyPath := flag.String("pubkey", "", "path to the verification public key (SPKI 'PUBLIC KEY' PEM) [required]")
	flag.Parse()

	if err := run(*proofPath, *pubkeyPath, os.Stdin, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "dr-proof-verify: FAIL:", err)
		os.Exit(1)
	}
}

func run(proofPath, pubkeyPath string, stdin io.Reader, stdout io.Writer) error {
	if pubkeyPath == "" {
		return fmt.Errorf("-pubkey is required")
	}
	pubPEM, err := os.ReadFile(pubkeyPath)
	if err != nil {
		return fmt.Errorf("read public key %q: %w", pubkeyPath, err)
	}

	var proofBytes []byte
	if proofPath == "" {
		proofBytes, err = io.ReadAll(stdin)
		if err != nil {
			return fmt.Errorf("read proof from stdin: %w", err)
		}
	} else {
		proofBytes, err = os.ReadFile(proofPath)
		if err != nil {
			return fmt.Errorf("read proof %q: %w", proofPath, err)
		}
	}

	var proof rehearsalproof.SealedProof
	if err := json.Unmarshal(proofBytes, &proof); err != nil {
		return fmt.Errorf("parse sealed proof JSON: %w", err)
	}

	res, verr := rehearsalproof.VerifySealedProof(&proof, pubPEM)

	// Always emit the structured result so an auditor sees exactly what failed.
	enc := json.NewEncoder(stdout)
	enc.SetIndent("", "  ")
	if encErr := enc.Encode(res); encErr != nil {
		return fmt.Errorf("encode result: %w", encErr)
	}

	if verr != nil {
		return verr
	}
	if !res.OK {
		return fmt.Errorf("verification did not pass: %s", res.Reason)
	}
	return nil
}
