package attestledger

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
)

// fieldSeparator delimits the components of an entry-hash preimage. Using an
// explicit, non-printable separator makes the concatenation unambiguous so two
// different (seq, type, subject, …) tuples can never collide by field-boundary
// shifting (e.g. seq=1,subject="2x" vs seq=12,subject="x").
const fieldSeparator = "\x1f" // ASCII unit separator

// HashPayload returns the SHA-256 (hex) of the canonical JSON encoding of v.
// Canonicalization (sorted object keys, no insignificant whitespace) makes the
// hash stable across marshal orderings, so a payload that is semantically equal
// always hashes identically — and any real content change flips the hash.
func HashPayload(v any) (canonical json.RawMessage, hexHash string, err error) {
	canon, err := canonicalJSON(v)
	if err != nil {
		return nil, "", fmt.Errorf("attestledger: canonicalizing payload: %w", err)
	}
	sum := sha256.Sum256(canon)
	return json.RawMessage(canon), hex.EncodeToString(sum[:]), nil
}

// hashPayloadBytes hashes an already-canonical payload (used by the verifier,
// which must recompute the hash of the stored bytes exactly as they sit).
func hashPayloadBytes(canon []byte) string {
	sum := sha256.Sum256(canon)
	return hex.EncodeToString(sum[:])
}

// ComputeEntryHash derives the chained entry hash:
//
//	entry_hash = SHA-256( seq | entry_type | subject_id | payload_hash | prev_hash )
//
// where "|" is the unit-separator. prev_hash is the previous entry's entry_hash
// (GenesisPrevHash for seq 1). This is the single source of truth for both the
// append path (which sets the hash) and the verifier (which recomputes it), so
// the two can never diverge.
func ComputeEntryHash(seq int64, entryType, subjectID, payloadHash, prevHash string) string {
	h := sha256.New()
	// Write each field followed by the separator so boundaries are explicit.
	_, _ = h.Write([]byte(strconv.FormatInt(seq, 10)))
	_, _ = h.Write([]byte(fieldSeparator))
	_, _ = h.Write([]byte(entryType))
	_, _ = h.Write([]byte(fieldSeparator))
	_, _ = h.Write([]byte(subjectID))
	_, _ = h.Write([]byte(fieldSeparator))
	_, _ = h.Write([]byte(payloadHash))
	_, _ = h.Write([]byte(fieldSeparator))
	_, _ = h.Write([]byte(prevHash))
	return hex.EncodeToString(h.Sum(nil))
}

// LinkEntry fills Seq, PrevHash, PayloadHash, and EntryHash for an entry being
// appended to the chain after prev (prev is nil for the genesis entry). The
// payload is canonicalized and hashed here so the stored Payload bytes and the
// stored PayloadHash are guaranteed consistent.
func LinkEntry(e *Entry, payload any, prev *Entry) error {
	canon, payloadHash, err := HashPayload(payload)
	if err != nil {
		return err
	}
	e.Payload = canon
	e.PayloadHash = payloadHash

	if prev == nil {
		e.Seq = 1
		e.PrevHash = GenesisPrevHash
	} else {
		e.Seq = prev.Seq + 1
		e.PrevHash = prev.EntryHash
	}
	e.EntryHash = ComputeEntryHash(e.Seq, e.EntryType, e.SubjectID, e.PayloadHash, e.PrevHash)
	return nil
}

// VerifyChain walks entries (which MUST be ordered by ascending seq) from
// genesis to head and reports the first broken link. A break is any of:
//
//   - the recomputed payload_hash of the stored Payload bytes != stored
//     PayloadHash (a mutated payload),
//   - the recomputed entry_hash != stored EntryHash (a tampered field),
//   - prev_hash != the predecessor's entry_hash (a spliced/reordered entry, or a
//     deleted middle entry leaving a dangling link),
//   - a seq gap (a deleted entry) or a non-monotonic seq,
//   - the genesis entry's seq != 1 or prev_hash != GenesisPrevHash.
//
// It returns the seq of the first entry that fails and a human reason. On a
// clean chain Intact is true and HeadHash is the final entry_hash.
func VerifyChain(entries []*Entry) VerifyResult {
	res := VerifyResult{Intact: true, EntriesChecked: len(entries)}
	if len(entries) == 0 {
		return res
	}
	var prev *Entry
	for i, e := range entries {
		// 1) Genesis vs continuation seq + prev_hash linkage.
		if prev == nil {
			if e.Seq != 1 {
				return broken(res, e.Seq, fmt.Sprintf("genesis seq is %d, want 1", e.Seq))
			}
			if e.PrevHash != GenesisPrevHash {
				return broken(res, e.Seq, "genesis prev_hash is not the genesis seed")
			}
		} else {
			if e.Seq != prev.Seq+1 {
				// A gap means a middle entry was deleted; a repeat/decrease means a
				// splice or reorder. Either way the chain is not contiguous.
				return broken(res, prev.Seq+1,
					fmt.Sprintf("seq is not contiguous: entry %d follows %d", e.Seq, prev.Seq))
			}
			if e.PrevHash != prev.EntryHash {
				return broken(res, e.Seq, "prev_hash does not match predecessor entry_hash")
			}
		}

		// 2) The payload must hash to the stored payload_hash (detects a mutated
		// payload even if the attacker forgot to also rewrite the hashes).
		if got := hashPayloadBytes(e.Payload); got != e.PayloadHash {
			return broken(res, e.Seq, "payload_hash does not match payload bytes")
		}

		// 3) The entry_hash must be the canonical hash of this entry's fields
		// (detects a tampered field, including a forged payload_hash or prev_hash).
		want := ComputeEntryHash(e.Seq, e.EntryType, e.SubjectID, e.PayloadHash, e.PrevHash)
		if want != e.EntryHash {
			return broken(res, e.Seq, "entry_hash does not match recomputed hash of entry fields")
		}

		prev = entries[i]
	}
	res.HeadHash = prev.EntryHash
	return res
}

func broken(res VerifyResult, seq int64, reason string) VerifyResult {
	res.Intact = false
	res.FirstBrokenSeq = seq
	res.Reason = reason
	return res
}

// canonicalJSON produces a deterministic JSON encoding of v with object keys
// sorted recursively and no insignificant whitespace. It round-trips v through a
// generic decode so the output is independent of struct field order or map
// iteration order. nil encodes as the JSON literal null.
func canonicalJSON(v any) ([]byte, error) {
	if v == nil {
		return []byte("null"), nil
	}
	// json.RawMessage carries already-encoded bytes; re-canonicalize them so a
	// caller passing raw JSON gets the same stable form as a struct.
	if rm, ok := v.(json.RawMessage); ok {
		var generic any
		if err := json.Unmarshal(rm, &generic); err != nil {
			return nil, err
		}
		return canonicalEncode(generic)
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var generic any
	if err := json.Unmarshal(raw, &generic); err != nil {
		return nil, err
	}
	return canonicalEncode(generic)
}

// canonicalEncode writes a decoded JSON value back out with sorted keys.
func canonicalEncode(v any) ([]byte, error) {
	var buf bytes.Buffer
	if err := writeCanonical(&buf, v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func writeCanonical(buf *bytes.Buffer, v any) error {
	switch t := v.(type) {
	case map[string]any:
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			kb, err := json.Marshal(k)
			if err != nil {
				return err
			}
			buf.Write(kb)
			buf.WriteByte(':')
			if err := writeCanonical(buf, t[k]); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
		return nil
	case []any:
		buf.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := writeCanonical(buf, e); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
		return nil
	default:
		// Scalars (string, float64, bool, nil) — json.Marshal already produces a
		// canonical form for these.
		b, err := json.Marshal(t)
		if err != nil {
			return err
		}
		buf.Write(b)
		return nil
	}
}
