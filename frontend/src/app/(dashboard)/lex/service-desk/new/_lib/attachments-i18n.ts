import type { AppLocale } from "@/lib/i18n";

/**
 * Self-contained bilingual strings for the attachments field. Resolved via a
 * locale ternary (default English / MSA Arabic). Kept local to this component so
 * the field stays drop-in and does not depend on the global message catalogue.
 */
export interface AttachmentsMessages {
  sectionLabel: string;
  optionalLabel: string;
  dropzoneHint: string;
  acceptedTypesTitle: string;
  acceptedTypes: string[];
  maxSizeLabel: (sizeMb: number) => string;
  examplesTitle: string;
  examples: string[];
  uploadGuidance: string;
  scanGuidance: string;
  uploadingProgress: (progress: number) => string;
  emptyTitle: string;
  emptyHint: string;
  uploading: string;
  countLabel: (count: number, totalSize: string) => string;
  remove: string;
  removeFile: (name: string) => string;
  scanPending: string;
  /** Shown when the scan verdict has not arrived within the poll window. */
  scanQueued: string;
  scanClean: string;
  scanInfected: string;
  scanError: string;
  retryScan: string;
  retryScanFor: (name: string) => string;
  scanUnknown: string;
  /** Blocking state when the AV scanner was unavailable/disabled and skipped the file. */
  scanSkipped: string;
  units: {
    bytes: string;
    kb: string;
    mb: string;
    gb: string;
  };
}

const en: AttachmentsMessages = {
  sectionLabel: "Attachments",
  optionalLabel: "Optional",
  dropzoneHint: "Drag & drop files here, or click to browse",
  acceptedTypesTitle: "Accepted files",
  acceptedTypes: ["PDF", "Word", "Excel/CSV", "Text", "Images"],
  maxSizeLabel: (sizeMb) => `${sizeMb} MB per file`,
  examplesTitle: "Useful examples",
  examples: [
    "Contracts",
    "signed approvals",
    "case documents",
    "supporting screenshots",
  ],
  uploadGuidance:
    "Uploads stay linked to this draft and can be removed before submission.",
  scanGuidance:
    "Files must pass the security scan before this request can be submitted.",
  uploadingProgress: (progress) => `Uploading ${Math.round(progress)}%`,
  emptyTitle: "No documents attached yet",
  emptyHint: "Attach the contract or any supporting documents",
  uploading: "Uploading…",
  countLabel: (count, totalSize) =>
    `${count} ${count === 1 ? "file" : "files"} · ${totalSize}`,
  remove: "Remove",
  removeFile: (name) => `Remove ${name}`,
  scanPending: "Scanning",
  scanQueued: "Scan queued",
  scanClean: "Clean",
  scanInfected: "Infected",
  scanError: "Scan failed",
  retryScan: "Retry scan",
  retryScanFor: (name) => `Retry security scan for ${name}`,
  scanUnknown: "Unknown",
  scanSkipped: "Security scan unavailable",
  units: { bytes: "B", kb: "KB", mb: "MB", gb: "GB" },
};

const ar: AttachmentsMessages = {
  sectionLabel: "المرفقات",
  optionalLabel: "اختياري",
  dropzoneHint: "اسحب الملفات وأفلتها هنا، أو انقر للتصفح",
  acceptedTypesTitle: "الملفات المقبولة",
  acceptedTypes: ["PDF", "Word", "Excel/CSV", "نصوص", "صور"],
  maxSizeLabel: (sizeMb) => `${sizeMb} م.ب لكل ملف`,
  examplesTitle: "أمثلة مفيدة",
  examples: [
    "العقود",
    "الموافقات الموقعة",
    "مستندات القضايا",
    "لقطات شاشة داعمة",
  ],
  uploadGuidance:
    "تبقى الملفات المرفوعة مرتبطة بهذه المسودة ويمكن إزالتها قبل الإرسال.",
  scanGuidance: "يجب أن تجتاز الملفات الفحص الأمني قبل تقديم هذا الطلب.",
  uploadingProgress: (progress) => `جارٍ الرفع ${Math.round(progress)}%`,
  emptyTitle: "لم تُرفق أي مستندات بعد",
  emptyHint: "أرفق العقد أو أي مستندات داعمة",
  uploading: "جارٍ الرفع…",
  countLabel: (count, totalSize) => `${count} ملف · ${totalSize}`,
  remove: "إزالة",
  removeFile: (name) => `إزالة ${name}`,
  scanPending: "جارٍ الفحص",
  scanQueued: "الفحص في قائمة الانتظار",
  scanClean: "سليم",
  scanInfected: "مصاب",
  scanError: "تعذّر الفحص",
  retryScan: "إعادة الفحص",
  retryScanFor: (name) => `إعادة الفحص الأمني للملف ${name}`,
  scanUnknown: "غير معروف",
  scanSkipped: "فحص الأمان غير متاح",
  units: { bytes: "بايت", kb: "ك.ب", mb: "م.ب", gb: "ج.ب" },
};

export function getAttachmentsMessages(locale: AppLocale): AttachmentsMessages {
  return locale === "ar" ? ar : en;
}
