/**
 * Pure helpers for the Watheeq legal documents page: client-side CSV/JSON export
 * of the currently-loaded rows, snippet tokenisation for full-text search hits,
 * bulk-update payload construction, and retention-metadata inspection.
 *
 * These are deliberately framework-free (no React) so they stay unit-testable
 * and reusable across the page and its sub-components.
 */

import type { JsonObject, LexDocument } from "@/types/suites";
import { isDocxDocument } from "@/lib/documents/word";

/** Columns exported to CSV (kept stable so downstream tooling can rely on it). */
const EXPORT_COLUMNS: Array<{
  key: string;
  pick: (doc: LexDocument) => unknown;
}> = [
  { key: "id", pick: (d) => d.id },
  { key: "title", pick: (d) => d.title },
  { key: "type", pick: (d) => d.type },
  { key: "status", pick: (d) => d.status },
  { key: "confidentiality", pick: (d) => d.confidentiality },
  { key: "category", pick: (d) => d.category ?? "" },
  { key: "current_version", pick: (d) => d.current_version },
  { key: "tags", pick: (d) => d.tags.join("|") },
  { key: "updated_at", pick: (d) => d.updated_at },
];

function csvEscape(value: unknown): string {
  const raw = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/** Serialises rows as a CSV string with a stable header row. */
export function documentsToCsv(rows: LexDocument[]): string {
  const header = EXPORT_COLUMNS.map((c) => c.key).join(",");
  const body = rows
    .map((doc) => EXPORT_COLUMNS.map((c) => csvEscape(c.pick(doc))).join(","))
    .join("\n");
  return body ? `${header}\n${body}` : header;
}

/**
 * triggerDownload writes `content` to a Blob and clicks a transient anchor. SSR
 * guarded so the page module can import this without breaking server render.
 */
export function triggerDownload(
  content: string,
  filename: string,
  mime: string,
): void {
  if (typeof document === "undefined" || typeof URL === "undefined") return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Exports the supplied rows as the requested format via a client-side download. */
export function exportDocuments(
  rows: LexDocument[],
  format: "csv" | "json",
): void {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    triggerDownload(
      JSON.stringify(rows, null, 2),
      `lex-documents-${stamp}.json`,
      "application/json",
    );
    return;
  }
  triggerDownload(
    documentsToCsv(rows),
    `lex-documents-${stamp}.csv`,
    "text/csv;charset=utf-8",
  );
}

/** A single tokenised piece of a search snippet. */
export interface SnippetToken {
  text: string;
  highlighted: boolean;
}

/**
 * tokenizeSnippet safely converts a `ts_headline` string (which wraps hits in
 * `<mark>…</mark>`) into plain text tokens flagged for highlighting. The raw
 * server HTML is NEVER injected via `dangerouslySetInnerHTML`; instead we strip
 * the known marker tags, decode the small set of HTML entities `ts_headline`
 * emits, and let React render the resulting plain text inside styled spans.
 */
export function tokenizeSnippet(snippet: string): SnippetToken[] {
  if (!snippet) return [];
  const tokens: SnippetToken[] = [];
  // Split on the literal marker tags; everything between <mark> and </mark> is a hit.
  const parts = snippet.split(/(<mark>|<\/mark>)/i);
  let highlighted = false;
  for (const part of parts) {
    if (/^<mark>$/i.test(part)) {
      highlighted = true;
      continue;
    }
    if (/^<\/mark>$/i.test(part)) {
      highlighted = false;
      continue;
    }
    if (part === "") continue;
    tokens.push({ text: decodeEntities(stripTags(part)), highlighted });
  }
  return tokens;
}

/** Removes any residual angle-bracket tags so no markup reaches the DOM as text. */
function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

/** Decodes the minimal entity set Postgres `ts_headline` produces. */
function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * documentHasRetentionPolicy reports whether a document carries a retention
 * policy in its metadata bag (tolerating both snake_case and camelCase keys).
 */
export function documentHasRetentionPolicy(doc: LexDocument): boolean {
  const meta = doc.metadata as JsonObject | undefined;
  if (!meta) return false;
  const snake = meta["retention_policy"];
  const camel = meta["retentionPolicy"];
  return Boolean(toTruthyString(snake) || toTruthyString(camel));
}

export type DocumentEditorAvailabilityReason =
  | "ready"
  | "missing_file"
  | "unsupported_format";

export interface DocumentEditorAvailability {
  canOpen: boolean;
  reason: DocumentEditorAvailabilityReason;
}

export type DocumentEditorMaturityPanel =
  | "negotiation-room"
  | "playbook-enforcement"
  | "terms-cross-references"
  | "section-assignments"
  | "guest-review-links"
  | "legal-issues"
  | "signature-readiness"
  | "clause-ai-actions"
  | "health-score"
  | "privileged-controls";

export type DocumentEditorPanel =
  | "audit"
  | "preflight"
  | "versions"
  | DocumentEditorMaturityPanel;

export const DOCUMENT_EDITOR_MATURITY_PANELS: readonly DocumentEditorMaturityPanel[] = [
  "negotiation-room",
  "playbook-enforcement",
  "terms-cross-references",
  "section-assignments",
  "guest-review-links",
  "legal-issues",
  "signature-readiness",
  "clause-ai-actions",
  "health-score",
  "privileged-controls",
] as const;

export interface DocumentEditorHrefOptions {
  panel?: DocumentEditorPanel;
  version?: number | null;
  mode?: "view" | "comment" | "edit";
}

/** Returns a metadata string field, tolerating absent and non-string values. */
export function documentMetadataString(
  doc: LexDocument,
  key: string,
): string | undefined {
  const value = doc.metadata?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

/** The mature Word editor only advertises DOCX-backed repository documents. */
export function getDocumentEditorAvailability(
  doc: LexDocument,
): DocumentEditorAvailability {
  if (!doc.file_id && !doc.file_name) {
    return { canOpen: false, reason: "missing_file" };
  }
  const mimeType =
    documentMetadataString(doc, "content_type") ??
    documentMetadataString(doc, "mime_type");
  if (!isDocxDocument(doc.file_name ?? undefined, mimeType)) {
    return { canOpen: false, reason: "unsupported_format" };
  }
  return { canOpen: true, reason: "ready" };
}

/** Builds the route owned by the Word-editor worker without creating it here. */
export function buildDocumentEditorHref(
  doc: LexDocument,
  options: DocumentEditorHrefOptions = {},
): string {
  const params = new URLSearchParams();
  params.set("documentId", doc.id);
  params.set("mode", options.mode ?? "edit");
  const version = options.version ?? doc.current_version;
  if (version) {
    params.set("version", String(version));
  }
  if (options.panel) {
    params.set("panel", options.panel);
  }
  return `/lex/documents/editor?${params.toString()}`;
}

function toTruthyString(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : "";
}

/**
 * Builds a full updateDocument payload from an existing document, overriding the
 * supplied fields. `updateDocument` requires the full field set the edit form
 * sends, so we spread the live document and override only what changed — never
 * wiping unrelated fields.
 */
export function buildDocumentUpdatePayload(
  doc: LexDocument,
  overrides: Partial<{
    title: string;
    type: LexDocument["type"];
    description: string;
    category: string | null;
    confidentiality: LexDocument["confidentiality"];
    status: LexDocument["status"];
    contract_id: string | null;
    tags: string[];
    metadata: JsonObject;
  }> = {},
): Record<string, unknown> {
  return {
    title: doc.title,
    type: doc.type,
    description: doc.description,
    category: doc.category ?? "",
    confidentiality: doc.confidentiality,
    status: doc.status,
    contract_id: doc.contract_id ?? null,
    tags: doc.tags,
    metadata: doc.metadata ?? {},
    ...overrides,
  };
}

/** Merges new tags into a document's existing tag set, de-duplicated + lower-cased. */
export function mergeTags(existing: string[], incoming: string[]): string[] {
  const set = new Set<string>(
    existing.map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  for (const tag of incoming) {
    const normalized = tag.trim().toLowerCase();
    if (normalized) set.add(normalized);
  }
  return Array.from(set);
}

/** Parses a comma-separated tag input string into a normalized tag array. */
export function parseTagInput(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/** Summarises the outcome of a fan-out of per-id mutations. */
export interface FanOutSummary {
  updated: number;
  failed: number;
}

/** Tallies `Promise.allSettled` results into an {updated, failed} summary. */
export function summarizeSettled(
  results: PromiseSettledResult<unknown>[],
): FanOutSummary {
  let updated = 0;
  let failed = 0;
  for (const result of results) {
    if (result.status === "fulfilled") updated += 1;
    else failed += 1;
  }
  return { updated, failed };
}
