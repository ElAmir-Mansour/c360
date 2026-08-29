import { describe, expect, it } from "vitest";
import { resolveScanTone, isAcceptableScanStatus } from "./attachments-types";

describe("resolveScanTone", () => {
  it('maps clean-family statuses to "clean"', () => {
    for (const s of [
      "clean",
      "CLEAN",
      " passed ",
      "ok",
      "safe",
      "no_threats",
    ]) {
      expect(resolveScanTone(s)).toBe("clean");
    }
  });

  it('maps threat statuses to "infected"', () => {
    for (const s of ["infected", "failed", "malicious", "quarantined"]) {
      expect(resolveScanTone(s)).toBe("infected");
    }
  });

  it('maps scanner failures to a retryable error instead of "unknown"', () => {
    for (const s of ["error", "ERROR", " scan_error "]) {
      expect(resolveScanTone(s)).toBe("error");
    }
  });

  it('maps in-flight statuses (incl. empty) to "pending"', () => {
    for (const s of ["pending", "scanning", "queued", ""]) {
      expect(resolveScanTone(s)).toBe("pending");
    }
  });

  // The bug: a scanner-unavailable "skipped" file used to fall through to
  // "unknown" and render as the alarming "Unknown" badge.
  it('maps scanner-skipped statuses to "skipped", not "unknown"', () => {
    for (const s of [
      "skipped",
      "SKIPPED",
      " skipped ",
      "not_scanned",
      "disabled",
    ]) {
      expect(resolveScanTone(s)).toBe("skipped");
    }
  });

  it('only a genuinely unrecognized value falls through to "unknown"', () => {
    expect(resolveScanTone("wat")).toBe("unknown");
  });
});

describe("isAcceptableScanStatus (mirrors the backend submission gate)", () => {
  it("accepts only files with a positive clean verdict", () => {
    expect(isAcceptableScanStatus("clean")).toBe(true);
  });

  it("blocks skipped, infected, scan-error, still-pending, and unrecognized files", () => {
    expect(isAcceptableScanStatus("skipped")).toBe(false);
    expect(isAcceptableScanStatus("infected")).toBe(false);
    expect(isAcceptableScanStatus("error")).toBe(false);
    expect(isAcceptableScanStatus("pending")).toBe(false);
    expect(isAcceptableScanStatus("scanning")).toBe(false);
    expect(isAcceptableScanStatus("wat")).toBe(false);
  });
});
