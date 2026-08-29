"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  FileImage,
  FileSpreadsheet,
  File as FileIcon,
  ListChecks,
  Loader2,
  RefreshCw,
  ShieldOff,
  ShieldQuestion,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { enterpriseApi } from "@/lib/enterprise/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { showApiError } from "@/lib/toast";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { resolveLocalized } from "@/lib/i18n/localized";
import { shapeDigits } from "@/lib/format/numerals";
import type { AppLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  resolveScanTone,
  type ScanTone,
  type StagedAttachment,
} from "../_lib/attachments-types";
import {
  getAttachmentsMessages,
  type AttachmentsMessages,
} from "../_lib/attachments-i18n";
import type { AttachmentPolicyState } from "../_lib/attachment-policy";
import { providedSlotKeys } from "../_lib/attachment-policy";
import {
  getAttachmentPolicyMessages,
  type AttachmentPolicyMessages,
} from "../_lib/attachment-policy-i18n";

// Common document + image MIME types and extensions accepted by the drop zone.
const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.png,.jpg,.jpeg,.gif,.webp," +
  "application/pdf,application/msword," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/vnd.ms-excel," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "text/plain,text/csv,image/*";

// Extensions / MIME types the drop zone will actually accept (a superset of the
// four representative formats advertised in the mockup subtitle). A file is kept
// if EITHER its extension OR its MIME type matches, so a valid document with an
// odd/absent MIME type is never wrongly rejected client-side.
const ACCEPTED_EXTS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "rtf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);
// Mirrors AllowedTypes["lex"] in backend/pkg/storage/content_validator.go.
// Keep the two in step: a format accepted here but missing there is offered by
// the UI and then rejected by the upload with 415.
const ACCEPTED_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "text/rtf",
  "application/rtf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_SIZE_MB = 25;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

// The upload response always carries `pending` — the virus scan runs
// asynchronously server-side — so the row has to poll the file record to ever
// resolve. Polling stops after MAX_ATTEMPTS (~1 min) so a stalled or offline
// scanner degrades to a static "queued" state instead of an endless spinner.
const SCAN_POLL_INTERVAL_MS = 3000;
const SCAN_POLL_MAX_ATTEMPTS = 20;

/* -------------------------------------------------------------------------- */
/*  Step-local mockup copy (bilingual, RTL-aware).                             */
/*  Kept inside this file per the wizard convention so the attachments step    */
/*  stays drop-in and never collides with the shared labels bundle. The        */
/*  Arabic is Saudi MSA — flag for the localization gate/termbase review.      */
/* -------------------------------------------------------------------------- */
interface Step3Copy {
  dropTitle: string;
  dropFormats: (maxSize: string) => string;
  dropzoneAria: string;
  uploadedHeading: (count: string) => string;
  statusCompleted: string;
  statusValid: string;
  statusError: string;
  statusUploading: (pct: string) => string;
  uploadingAria: (name: string) => string;
  errorTooLarge: (maxSize: string) => string;
  errorType: string;
  errorInfected: string;
  dismiss: string;
  dismissFile: (name: string) => string;
  sizeStatusSep: string;
}

const STEP3_EN: Step3Copy = {
  dropTitle: "Drag files here or click to browse",
  dropFormats: (maxSize) =>
    `Supported formats: PDF, DOCX, XLSX, JPG — Maximum file size: ${maxSize} MB`,
  dropzoneAria:
    "Upload supporting documents — drag files here or click to browse",
  uploadedHeading: (count) => `Uploaded Documents (${count})`,
  statusCompleted: "Completed",
  statusValid: "Valid",
  statusError: "Error",
  statusUploading: (pct) => `Uploading ${pct}%`,
  uploadingAria: (name) => `Uploading ${name}`,
  errorTooLarge: (maxSize) => `File exceeds the ${maxSize} MB limit`,
  errorType: "Unsupported file format",
  errorInfected: "File failed the security scan",
  dismiss: "Dismiss",
  dismissFile: (name) => `Dismiss ${name}`,
  sizeStatusSep: " · ",
};

const STEP3_AR: Step3Copy = {
  dropTitle: "اسحب الملفات هنا أو انقر للاستعراض",
  dropFormats: (maxSize) =>
    `الصيغ المدعومة: PDF، DOCX، XLSX، JPG — الحد الأقصى لحجم الملف ${maxSize} ميجابايت`,
  dropzoneAria: "رفع المستندات الداعمة — اسحب الملفات هنا أو انقر للاستعراض",
  uploadedHeading: (count) => `المستندات المرفوعة (${count})`,
  statusCompleted: "اكتمل",
  statusValid: "صالح",
  statusError: "خطأ",
  statusUploading: (pct) => `جارٍ الرفع ${pct}٪`,
  uploadingAria: (name) => `جارٍ رفع ${name}`,
  errorTooLarge: (maxSize) => `الملف يتجاوز حد ${maxSize} ميجابايت`,
  errorType: "صيغة الملف غير مدعومة",
  errorInfected: "لم يجتَز الملف الفحص الأمني",
  dismiss: "تجاهل",
  dismissFile: (name) => `تجاهل ${name}`,
  sizeStatusSep: " · ",
};

function getStep3Copy(locale: AppLocale): Step3Copy {
  return locale === "ar" ? STEP3_AR : STEP3_EN;
}

/** A file rejected client-side (never uploaded), surfaced as a red error row. */
interface RejectedFile {
  id: string;
  name: string;
  sizeBytes: number;
  reason: "size" | "type";
}

function scanBadgeVariant(
  tone: ScanTone,
): "warning" | "success" | "destructive" | "secondary" {
  switch (tone) {
    case "clean":
      return "success";
    case "infected":
    case "error":
      return "destructive";
    case "pending":
      return "warning";
    case "skipped":
      return "destructive";
    // An unknown server value remains neutral but is still submission-blocking.
    default:
      return "secondary";
  }
}

/** Mockup-facing status label for a staged file, by resolved scan tone. */
function scanLabel(
  tone: ScanTone,
  tx: Step3Copy,
  m: AttachmentsMessages,
  stalled: boolean,
): string {
  switch (tone) {
    case "clean":
      return tx.statusValid;
    case "infected":
      return tx.statusError;
    case "error":
      return m.scanError;
    case "pending":
      return stalled ? m.scanQueued : m.scanPending;
    case "skipped":
      return m.scanSkipped;
    default:
      return m.scanUnknown;
  }
}

function StatusIcon({ tone, stalled }: { tone: ScanTone; stalled: boolean }) {
  const className = "h-3.5 w-3.5 shrink-0";
  if (tone === "clean")
    return <CheckCircle2 className={className} aria-hidden />;
  if (tone === "infected" || tone === "error") {
    return <AlertCircle className={className} aria-hidden />;
  }
  if (tone === "pending") {
    // Once polling has given up the spinner would misrepresent an in-flight
    // scan, so fall back to a static clock.
    return stalled ? (
      <Clock className={className} aria-hidden />
    ) : (
      <Loader2 className={cn(className, "animate-spin")} aria-hidden />
    );
  }
  // Scan not performed (AV unavailable/disabled) — a shield-off reads as
  // "not scanned" rather than the alarming "unknown" question mark.
  if (tone === "skipped")
    return <ShieldOff className={className} aria-hidden />;
  return <ShieldQuestion className={className} aria-hidden />;
}

// Human-readable size, owned locally so the row never shows raw byte counts.
function formatSize(bytes: number, m: AttachmentsMessages): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${m.units.bytes}`;
  const kb = 1024;
  if (bytes < kb) return `${bytes} ${m.units.bytes}`;
  if (bytes < kb * kb) return `${(bytes / kb).toFixed(1)} ${m.units.kb}`;
  if (bytes < kb * kb * kb)
    return `${(bytes / (kb * kb)).toFixed(1)} ${m.units.mb}`;
  return `${(bytes / (kb * kb * kb)).toFixed(1)} ${m.units.gb}`;
}

function FileTypeIcon({ contentType }: { contentType: string }) {
  // Color is inherited from the surrounding tile (see FileIconTile), so the icon
  // itself stays colour-agnostic.
  const className = "h-5 w-5 shrink-0";
  const ct = contentType.toLowerCase();
  if (ct.startsWith("image/"))
    return <FileImage className={className} aria-hidden />;
  if (
    ct.includes("spreadsheet") ||
    ct.includes("excel") ||
    ct.includes("csv")
  ) {
    return <FileSpreadsheet className={className} aria-hidden />;
  }
  if (ct.includes("pdf") || ct.includes("word") || ct.startsWith("text/")) {
    return <FileText className={className} aria-hidden />;
  }
  return <FileIcon className={className} aria-hidden />;
}

/** Row tone drives the tinted icon tile + status-text colour, matching the mockup. */
type RowTone = "clean" | "progress" | "pending" | "error";

/**
 * Rounded, tinted square that houses the file-type icon — green for
 * completed/uploading rows, red for rejected/infected, neutral brand tint while a
 * scan is still pending.
 */
function FileIconTile({
  contentType,
  tone,
}: {
  contentType: string;
  tone: RowTone;
}) {
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
        tone === "error"
          ? "bg-error-100 text-error-600 dark:bg-error-700/25 dark:text-error-300"
          : tone === "clean" || tone === "progress"
            ? "bg-success-100 text-success-700 dark:bg-success-700/25 dark:text-success-300"
            : "bg-primary/10 text-primary",
      )}
    >
      <FileTypeIcon contentType={contentType} />
    </span>
  );
}

/** True when a file's extension OR MIME type is within the accepted set. */
function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1) : "";
  if (ext && ACCEPTED_EXTS.has(ext)) return true;
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;
  if (ACCEPTED_MIMES.has(mime)) return true;
  return false;
}

export interface AttachmentsFieldProps {
  value: StagedAttachment[];
  onChange: (next: StagedAttachment[]) => void;
  disabled?: boolean;
  /**
   * Applicable attachment-policy verdict for the selected request type
   * (PRD 14.1). When it carries a policy the field surfaces the required count +
   * named document slots and lets the requester label each file, so unmet
   * requirements are visible before the provider-side completeness gate.
   */
  policy?: AttachmentPolicyState;
}

/**
 * Controlled attachments field for the Lex "New Legal Request" wizard
 * (Attachments step). Owns its own upload / progress / client-side rejection
 * state; the parent sends the resulting `StagedAttachment[]` with the request
 * create command, where the backend verifies and persists the links in the same
 * transaction. This component never creates attachment requirements itself.
 *
 * Visual: dashed brand drop zone + an "Uploaded Documents (N)" list whose rows
 * reflect the real upload / async virus-scan / policy-slot pipeline — Valid
 * (clean), Uploading %, Scanning, and Error (rejected too-big / wrong-format /
 * infected). The submit backstop (policy-blocking + scan-clean) stays enforced
 * by the step's validate() gate in page.tsx.
 */
export default function AttachmentsField({
  value,
  onChange,
  disabled = false,
  policy,
}: AttachmentsFieldProps) {
  const { locale } = useLocaleOrDefault();
  const m = useMemo(() => getAttachmentsMessages(locale), [locale]);
  const pm = useMemo(() => getAttachmentPolicyMessages(locale), [locale]);
  const tx = useMemo(() => getStep3Copy(locale), [locale]);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadingFiles, setUploadingFiles] = useState<File[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [scanPollStalled, setScanPollStalled] = useState(false);
  const [rescanningId, setRescanningId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const rejectIdRef = useRef(0);

  const localSize = useCallback(
    (bytes: number) => shapeDigits(formatSize(bytes, m), locale),
    [m, locale],
  );

  // Latest props read from inside the poll timer / async upload without making
  // them dependencies (which would tear down the interval or re-create the
  // uploader on every parent render).
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Stable identity for "which files are still awaiting a scan verdict", so the
  // poller only restarts when that set actually changes.
  const pendingScanKey = useMemo(
    () =>
      value
        .filter((item) => resolveScanTone(item.scanStatus) === "pending")
        .map((item) => item.fileId)
        .sort()
        .join(","),
    [value],
  );

  useEffect(() => {
    if (!pendingScanKey) {
      setScanPollStalled(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    setScanPollStalled(false);

    const timer = setInterval(async () => {
      attempts += 1;

      const results = await Promise.all(
        pendingScanKey.split(",").map(async (fileId) => {
          try {
            const record = await enterpriseApi.files.get(fileId);
            return [fileId, record.virus_scan_status] as const;
          } catch {
            // Transient failure — retried on the next tick, and surfacing a
            // toast per tick would spam the wizard.
            return null;
          }
        }),
      );
      if (cancelled) return;

      const updates = new Map(
        results.filter(Boolean) as (readonly [string, string])[],
      );
      let changed = false;
      const next = valueRef.current.map((item) => {
        const status = updates.get(item.fileId);
        if (!status || status === item.scanStatus) return item;
        changed = true;
        return { ...item, scanStatus: status };
      });
      if (changed) onChangeRef.current(next);

      if (attempts >= SCAN_POLL_MAX_ATTEMPTS) {
        clearInterval(timer);
        setScanPollStalled(true);
      }
    }, SCAN_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pendingScanKey]);

  const hasSlots = (policy?.slots.length ?? 0) > 0;
  const providedSet = useMemo(() => new Set(providedSlotKeys(value)), [value]);
  const missingSet = useMemo(
    () => new Set((policy?.missingSlotKeys ?? []).map((k) => k.toLowerCase())),
    [policy?.missingSlotKeys],
  );

  const handleSlotChange = useCallback(
    (fileId: string, slotKey: string) => {
      onChange(
        value.map((item) =>
          item.fileId === fileId
            ? { ...item, slotKey: slotKey || undefined }
            : item,
        ),
      );
    },
    [onChange, value],
  );

  // Upload the accepted files. Each is uploaded independently so one failure
  // never discards the files that succeeded; successful records are appended in
  // arrival order. Uses valueRef so a concurrent parent render never clobbers
  // the merge.
  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploadingFiles(files);
    setUploading(true);
    setProgress(0);

    const staged: StagedAttachment[] = [];
    for (const file of files) {
      try {
        const record = await enterpriseApi.files.upload(
          file,
          {
            suite: "lex",
            entity_type: "legal_request_attachment",
            lifecycle_policy: "standard",
          },
          (p) => setProgress(p),
        );
        staged.push({
          fileId: record.id,
          name: record.original_name,
          sizeBytes: record.size_bytes,
          contentType: record.content_type,
          scanStatus: record.virus_scan_status,
        });
      } catch (error) {
        showApiError(error);
      }
    }

    if (staged.length > 0) {
      onChangeRef.current([...valueRef.current, ...staged]);
    }
    setUploading(false);
    setProgress(0);
    setUploadingFiles([]);
  }, []);

  // Partition dropped/selected files: enforce the real 25MB + format limits
  // client-side (rejections become red error rows) and hand the rest to upload.
  const handleFiles = useCallback(
    (files: File[]) => {
      if (disabled || files.length === 0) return;
      const accepted: File[] = [];
      const newRejected: RejectedFile[] = [];
      for (const file of files) {
        if (file.size > MAX_SIZE_BYTES) {
          newRejected.push({
            id: `rej-${(rejectIdRef.current += 1)}`,
            name: file.name,
            sizeBytes: file.size,
            reason: "size",
          });
        } else if (!isAcceptedFile(file)) {
          newRejected.push({
            id: `rej-${(rejectIdRef.current += 1)}`,
            name: file.name,
            sizeBytes: file.size,
            reason: "type",
          });
        } else {
          accepted.push(file);
        }
      }
      if (newRejected.length > 0) {
        setRejected((prev) => [...prev, ...newRejected]);
      }
      if (accepted.length > 0) {
        void uploadFiles(accepted);
      }
    },
    [disabled, uploadFiles],
  );

  const handleRemove = useCallback(
    async (fileId: string) => {
      try {
        await enterpriseApi.files.delete(fileId);
        onChange(value.filter((item) => item.fileId !== fileId));
      } catch (error) {
        showApiError(error);
      }
    },
    [onChange, value],
  );

  const handleRescan = useCallback(async (fileId: string) => {
    setRescanningId(fileId);
    try {
      await enterpriseApi.files.rescan(fileId);
      onChangeRef.current(
        valueRef.current.map((item) =>
          item.fileId === fileId ? { ...item, scanStatus: "pending" } : item,
        ),
      );
    } catch (error) {
      showApiError(error);
    } finally {
      setRescanningId(null);
    }
  }, []);

  const dismissRejected = useCallback((id: string) => {
    setRejected((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const openPicker = useCallback(() => {
    if (!disabled && !uploading) inputRef.current?.click();
  }, [disabled, uploading]);

  const hasAnyRow =
    value.length > 0 || uploadingFiles.length > 0 || rejected.length > 0;
  const roundedProgress = shapeDigits(Math.round(progress), locale);

  return (
    <div className="space-y-4">
      {/* Attachment-policy requirements (required count + named document slots). */}
      {policy?.hasPolicy ? (
        <AttachmentRequirements
          policy={policy}
          pm={pm}
          locale={locale}
          providedSet={providedSet}
          missingSet={missingSet}
        />
      ) : policy?.loading ? (
        <div
          className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
          {pm.requirementsLoading}
        </div>
      ) : null}

      {/* Dashed brand drop zone. */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label={tx.dropzoneAria}
        aria-disabled={disabled || uploading}
        aria-busy={uploading}
        onClick={openPicker}
        onKeyDown={(e) => {
          if (!disabled && !uploading && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !uploading) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          if (disabled || uploading) return;
          handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isDragging
            ? "border-primary bg-primary/10"
            : "border-primary/40 bg-primary/[0.04] hover:border-primary/60 hover:bg-primary/[0.07]",
          disabled || uploading
            ? "cursor-not-allowed opacity-60"
            : "cursor-pointer",
        )}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UploadCloud className="h-6 w-6" aria-hidden />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {tx.dropTitle}
          </p>
          <p className="text-xs text-muted-foreground">
            {tx.dropFormats(shapeDigits(MAX_SIZE_MB, locale))}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
            e.target.value = "";
          }}
          disabled={disabled || uploading}
          aria-hidden
          tabIndex={-1}
        />
      </div>

      {/* Uploaded Documents (N) — real staged files + in-flight + rejected rows. */}
      {hasAnyRow ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-foreground">
            {tx.uploadedHeading(shapeDigits(value.length, locale))}
          </p>
          <ul className="space-y-2" aria-label={m.sectionLabel}>
            {/* In-flight uploads. */}
            {uploadingFiles.map((file) => (
              <li
                key={`uploading-${file.name}-${file.size}`}
                className="rounded-lg border border-border bg-card px-3 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <FileIconTile contentType={file.type} tone="progress" />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      title={file.name}
                    >
                      {file.name}
                    </p>
                    <p className="text-xs">
                      <span className="text-muted-foreground">
                        {localSize(file.size)}
                      </span>
                      <span className="text-muted-foreground">
                        {tx.sizeStatusSep}
                      </span>
                      <span className="font-medium text-success-700 dark:text-success-300">
                        {tx.statusUploading(roundedProgress)}
                      </span>
                    </p>
                  </div>
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin text-success-600 dark:text-success-400"
                    aria-hidden
                  />
                </div>
                <div className="mt-2">
                  <Progress
                    value={progress}
                    className="h-1.5"
                    aria-label={tx.uploadingAria(file.name)}
                  />
                </div>
              </li>
            ))}

            {/* Successfully staged files (Valid / Scanning / Error-infected). */}
            {value.map((item) => {
              const tone = resolveScanTone(item.scanStatus);
              const isBlocking =
                tone === "infected" ||
                tone === "error" ||
                tone === "skipped" ||
                tone === "unknown";
              const isRetryable =
                tone === "error" || tone === "skipped" || tone === "unknown";
              const rowTone: RowTone =
                tone === "clean"
                  ? "clean"
                  : isBlocking
                    ? "error"
                    : "pending";
              const selectId = `attachment-slot-${item.fileId}`;
              const statusText =
                tone === "clean"
                  ? tx.statusCompleted
                  : tone === "infected"
                    ? tx.errorInfected
                    : tone === "error"
                      ? m.scanError
                      : scanLabel(tone, tx, m, scanPollStalled);
              const statusTextClass =
                tone === "clean"
                  ? "font-medium text-success-700 dark:text-success-300"
                  : isBlocking
                    ? "font-medium text-error-700 dark:text-error-300"
                    : "text-muted-foreground";
              return (
                <li
                  key={item.fileId}
                  className={cn(
                    "rounded-lg border px-3 py-2.5",
                    isBlocking
                      ? "border-error-300/70 bg-error-50 dark:border-error-700/60 dark:bg-error-700/15"
                      : "border-border bg-card",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <FileIconTile
                      contentType={item.contentType}
                      tone={rowTone}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm font-medium",
                          isBlocking
                            ? "text-error-700 dark:text-error-300"
                            : "text-foreground",
                        )}
                        title={item.name}
                      >
                        {item.name}
                      </p>
                      <p className="text-xs">
                        <span className="text-muted-foreground">
                          {localSize(item.sizeBytes)}
                        </span>
                        <span className="text-muted-foreground">
                          {tx.sizeStatusSep}
                        </span>
                        <span className={statusTextClass}>{statusText}</span>
                      </p>
                    </div>
                    <Badge
                      variant={scanBadgeVariant(tone)}
                      size="sm"
                      className="inline-flex items-center gap-1"
                    >
                      <StatusIcon tone={tone} stalled={scanPollStalled} />
                      {scanLabel(tone, tx, m, scanPollStalled)}
                    </Badge>
                    {isRetryable ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0 gap-1.5"
                        onClick={() => void handleRescan(item.fileId)}
                        disabled={disabled || rescanningId === item.fileId}
                        aria-label={m.retryScanFor(item.name)}
                        title={m.retryScan}
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            rescanningId === item.fileId && "animate-spin",
                          )}
                          aria-hidden
                        />
                        <span className="hidden sm:inline">{m.retryScan}</span>
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-error-600"
                      onClick={() => void handleRemove(item.fileId)}
                      disabled={disabled}
                      aria-label={m.removeFile(item.name)}
                      title={m.remove}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>

                  {hasSlots ? (
                    <div className="mt-2 flex items-center gap-2 border-t border-border/60 pt-2">
                      <label
                        htmlFor={selectId}
                        className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
                      >
                        <ListChecks className="h-3.5 w-3.5" aria-hidden />
                        {pm.assignHeading}
                      </label>
                      <select
                        id={selectId}
                        value={item.slotKey ?? ""}
                        onChange={(e) =>
                          handleSlotChange(item.fileId, e.target.value)
                        }
                        disabled={disabled}
                        aria-label={pm.assignLabel(item.name)}
                        className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">{pm.unassignedOption}</option>
                        {(policy?.slots ?? []).map((slot) => (
                          <option key={slot.key} value={slot.key}>
                            {resolveLocalized(slot.label, locale)}
                            {slot.required ? ` — ${pm.requiredBadge}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </li>
              );
            })}

            {/* Client-side rejected files (too large / wrong format). */}
            {rejected.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-error-300/70 bg-error-50 px-3 py-2.5 dark:border-error-700/60 dark:bg-error-700/15"
              >
                <div className="flex items-center gap-3">
                  <FileIconTile contentType="" tone="error" />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium text-error-700 dark:text-error-300"
                      title={item.name}
                    >
                      {item.name}
                    </p>
                    <p className="text-xs">
                      <span className="text-muted-foreground">
                        {localSize(item.sizeBytes)}
                      </span>
                      <span className="text-muted-foreground">
                        {tx.sizeStatusSep}
                      </span>
                      <span className="font-medium text-error-700 dark:text-error-300">
                        {item.reason === "size"
                          ? tx.errorTooLarge(shapeDigits(MAX_SIZE_MB, locale))
                          : tx.errorType}
                      </span>
                    </p>
                  </div>
                  <Badge
                    variant="destructive"
                    size="sm"
                    className="inline-flex items-center gap-1"
                  >
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {tx.statusError}
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-error-600"
                    onClick={() => dismissRejected(item.id)}
                    aria-label={tx.dismissFile(item.name)}
                    title={tx.dismiss}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Requester-facing requirements banner (PRD 14.1): the required attachment COUNT,
 * the named document SLOTS (required vs optional, provided vs missing) and the
 * live completeness status — all derived from the shared provider gate verdict.
 */
function AttachmentRequirements({
  policy,
  pm,
  locale,
  providedSet,
  missingSet,
}: {
  policy: AttachmentPolicyState;
  pm: AttachmentPolicyMessages;
  locale: AppLocale;
  providedSet: Set<string>;
  missingSet: Set<string>;
}) {
  const {
    requiredCount,
    maxCount,
    providedCount,
    slots,
    hasRequirement,
    countExceeded,
    complete,
    blocking,
  } = policy;

  const summary =
    requiredCount > 1
      ? pm.requiresAtLeast(requiredCount)
      : requiredCount === 1
        ? pm.requiresExactlyOne
        : pm.noMinimumButSlots;

  const countMet = requiredCount <= 0 || providedCount >= requiredCount;
  const missingRequiredCount = slots.filter(
    (s) => s.required && missingSet.has(s.key.toLowerCase()),
  ).length;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3 text-sm",
        blocking
          ? "border-warning-300/70 bg-warning-50 text-warning-800 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-200"
          : hasRequirement && complete
            ? "border-success-300/70 bg-success-50 text-success-800 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-200"
            : "border-info-200 bg-info-50/60 text-info-800 dark:border-info-800/50 dark:bg-info-800/15 dark:text-info-200",
      )}
    >
      <div className="flex items-start gap-2">
        <ListChecks className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-semibold">{pm.requirementsTitle}</p>
          <p className="text-xs opacity-90">
            {summary}
            {maxCount > 0 ? ` ${pm.upToMax(maxCount)}` : ""}
          </p>
        </div>
      </div>

      {slots.length > 0 ? (
        <ul className="mt-2.5 space-y-1.5" aria-label={pm.slotsHeading}>
          {slots.map((slot) => {
            const key = slot.key.toLowerCase();
            const provided = providedSet.has(key);
            const isMissingRequired = slot.required && missingSet.has(key);
            return (
              <li
                key={slot.key}
                className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/70 px-2.5 py-1.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  {provided ? (
                    <CheckCircle2
                      className="h-3.5 w-3.5 shrink-0 text-success-600"
                      aria-hidden
                    />
                  ) : isMissingRequired ? (
                    <AlertTriangle
                      className="h-3.5 w-3.5 shrink-0 text-warning-600"
                      aria-hidden
                    />
                  ) : (
                    <CircleDashed
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <span className="truncate text-xs font-medium text-foreground">
                    {resolveLocalized(slot.label, locale)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge
                    variant={slot.required ? "warning" : "outline"}
                    size="sm"
                  >
                    {slot.required ? pm.requiredBadge : pm.optionalBadge}
                  </Badge>
                  {provided ? (
                    <Badge variant="success" size="sm">
                      {pm.providedBadge}
                    </Badge>
                  ) : isMissingRequired ? (
                    <Badge variant="warning" size="sm">
                      {pm.missingBadge}
                    </Badge>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {slots.length > 0 ? (
        <p className="mt-2 text-xs opacity-90">{pm.assignHint}</p>
      ) : null}

      <div className="mt-2.5 space-y-1 text-xs font-medium">
        {countExceeded ? (
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {pm.countExceeded(maxCount)}
          </p>
        ) : requiredCount > 0 ? (
          <p className="flex items-center gap-1.5">
            {countMet ? (
              <CheckCircle2
                className="h-3.5 w-3.5 shrink-0 text-success-600"
                aria-hidden
              />
            ) : (
              <CircleDashed className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {countMet
              ? pm.countMet
              : pm.countProgress(providedCount, requiredCount)}
          </p>
        ) : null}

        {missingRequiredCount > 0 ? (
          <p className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {pm.missingRequiredSlots(missingRequiredCount)}
          </p>
        ) : null}

        {hasRequirement && complete && !countExceeded ? (
          <p className="flex items-center gap-1.5">
            <CheckCircle2
              className="h-3.5 w-3.5 shrink-0 text-success-600"
              aria-hidden
            />
            {pm.allRequiredMet}
          </p>
        ) : null}
      </div>

      {blocking ? (
        <p
          className="mt-2 rounded-md border border-warning-300/70 bg-warning-100/60 px-2.5 py-1.5 text-xs font-semibold dark:border-warning-700/60 dark:bg-warning-800/25"
          role="status"
        >
          {pm.blockingWarning}
        </p>
      ) : null}
    </div>
  );
}
