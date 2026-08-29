/**
 * A document staged for a new Legal Request, after it has been uploaded to the
 * file-storage service but before the request itself exists. It carries only the
 * returned `fileId`; the wizard orchestrator links staged files to the created
 * request after submit (as attachment requirements). This component never creates
 * requirements itself.
 */
export interface StagedAttachment {
  /** File-storage record id (FileRecord.id) used to link the file post-create. */
  fileId: string;
  /** Original filename as uploaded, for display. */
  name: string;
  /** File size in bytes (FileRecord.size_bytes). */
  sizeBytes: number;
  /** MIME content type (FileRecord.content_type). */
  contentType: string;
  /** Virus-scan status (FileRecord.virus_scan_status), e.g. pending/clean/infected. */
  scanStatus: string;
  /**
   * Named attachment-policy slot this file fulfils (AttachmentSlot.key), if the
   * selected request type defines expected documents. Used to evaluate required
   * slots against the provider completeness gate before submission. Undefined
   * when the request type has no policy or the file is not yet labelled.
   */
  slotKey?: string;
}

/**
 * A small, stable set of display tones the varied backend virus-scan statuses map
 * onto, so a new/odd server value never renders as a raw untranslated string.
 *   - `clean`    — scanned, no threats
 *   - `pending`  — scan queued / still running
 *   - `infected` — scan found a threat (hard block)
 *   - `error`    — scanner failed; retry is required (hard block)
 *   - `skipped`  — scanner unavailable/disabled; the file was not scanned
 *   - `unknown`  — a genuinely unrecognized status value
 */
export type ScanTone =
  "pending" | "clean" | "infected" | "error" | "skipped" | "unknown";

/**
 * Defensive mapping of the backend virus-scan status (which varies across
 * pending/clean/passed/infected/failed/quarantined/skipped) onto the stable tone
 * set. Single source of truth shared by the upload UI and the wizard submit gate.
 */
export function resolveScanTone(status: string): ScanTone {
  const normalized = status.trim().toLowerCase();
  if (
    [
      "clean",
      "passed",
      "pass",
      "ok",
      "safe",
      "no_threats",
      "no_threats_found",
    ].includes(normalized)
  ) {
    return "clean";
  }
  if (
    [
      "infected",
      "failed",
      "malicious",
      "quarantined",
      "threat",
      "unsafe",
    ].includes(normalized)
  ) {
    return "infected";
  }
  if (["error", "scan_error"].includes(normalized)) {
    return "error";
  }
  if (
    ["pending", "scanning", "in_progress", "queued", "processing", ""].includes(
      normalized,
    )
  ) {
    return "pending";
  }
  // The scanner was unavailable / disabled and skipped the file. Keep this
  // distinct from a truly unrecognized value so the UI can offer a rescan and
  // explain why submission is blocked.
  if (
    [
      "skipped",
      "not_scanned",
      "disabled",
      "scan_disabled",
      "none",
      "n/a",
      "na",
      "unavailable",
    ].includes(normalized)
  ) {
    return "skipped";
  }
  return "unknown";
}

/**
 * Only a positive clean verdict is acceptable. Scanner-unavailable/skipped files
 * remain blocked because no security verdict exists. Mirrors the backend gate.
 */
export function isAcceptableScanStatus(status: string): boolean {
  return resolveScanTone(status) === "clean";
}
