/**
 * Feature-local label object for the one-click evidence-pack export.
 *
 * Kept local to the evidence feature (NOT added to the shared `_lib/dr-i18n.ts`)
 * per the console's i18n contract, but adopting the same bilingual bundle shape:
 * a `DRBilingual<EvidenceExportLabels>` holds two full, identically-shaped copies
 * (English + professional MSA). Components resolve the active locale via
 * {@link useEvidenceExportLabels} and pass the resolved `EvidenceExportLabels`
 * object down exactly as before.
 *
 * The default export `evidenceExportLabels` resolves to ENGLISH so the pure
 * print-HTML builder and on-screen print view keep their English default when no
 * explicit labels are supplied (and existing English-asserting tests stay green).
 * Token-driven copy only — no inline colours or arbitrary values.
 */

'use client';

import { useMemo } from 'react';
import { type DRBilingual, resolveDRBilingual } from '../../../_lib/dr-i18n';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface EvidenceExportLabels {
  /** Card / section heading for the export feature. */
  sectionTitle: string;
  sectionDescription: string;

  /** Run picker. */
  runSelectLabel: string;
  runSelectPlaceholder: string;
  noTerminalRuns: string;
  noTerminalRunsHint: string;

  /** Primary action + dialog. */
  exportAction: string;
  dialogTitle: string;
  dialogDescription: string;
  downloadJson: string;
  printView: string;
  close: string;
  assembling: string;
  assembleError: string;
  retry: string;

  /** Print-view headings + field labels. */
  printHeading: string;
  printSubheading: string;
  generatedAt: string;
  generatedBy: string;
  tenant: string;
  group: string;

  runHeading: string;
  runId: string;
  runMode: string;
  runStatus: string;
  recoveryPoint: string;
  initiatedBy: string;
  approvedBy: string;
  initiatedAt: string;
  completedAt: string;
  lastError: string;

  rtoHeading: string;
  rtoObjective: string;
  rtoActual: string;
  rtoRemaining: string;
  rtoVerdictMet: string;
  rtoVerdictBreached: string;
  rtoVerdictPending: string;

  gatesHeading: string;
  gateValidate: string;
  gateApprove: string;
  gateExecute: string;
  gateAttest: string;
  outcomePassed: string;
  outcomeFailed: string;
  outcomeSkipped: string;
  outcomePending: string;

  attestationHeading: string;
  attestationId: string;
  attestationHash: string;
  attestationObjectKey: string;
  attestationRpo: string;
  attestationValidationRatio: string;
  noAttestation: string;

  ledgerHeading: string;
  ledgerSeq: string;
  ledgerType: string;
  ledgerEntryHash: string;
  ledgerAnchored: string;
  ledgerNotAnchored: string;
  noLedgerEntries: string;

  hashChainHeading: string;
  hashChainVerified: string;
  hashChainBroken: string;
  hashChainEntriesChecked: string;
  hashChainHeadHash: string;
  hashChainIncluded: string;
  hashChainContiguous: string;
  hashChainNotContiguous: string;
  hashChainAnchored: string;

  /** Export-handler toasts. `{runId}` is interpolated into the success message. */
  downloadSuccess: (runId: string) => string;
  downloadError: string;
  printPopupBlocked: string;

  notAvailable: string;
}

/**
 * The keys of {@link EvidenceExportLabels} whose values are plain `string`
 * (excludes the function-valued toast builders). The print view + HTML builder
 * index gate/outcome label maps through these, so the indexed value is always a
 * renderable string.
 */
export type EvidenceExportStringKey = {
  [K in keyof EvidenceExportLabels]: EvidenceExportLabels[K] extends string ? K : never;
}[keyof EvidenceExportLabels];

/** Bilingual bundle: full English + full professional MSA copies. */
export const evidenceExportLabelsBundle: DRBilingual<EvidenceExportLabels> = {
  en: {
    sectionTitle: 'One-click evidence pack',
    sectionDescription:
      'Assemble a portable, tamper-evident evidence pack for a completed recovery run or drill — the run, its four-gate outcome, RTO-vs-RTA, the sealed attestation, and the relevant hash-chained ledger entries — as a downloadable JSON file or a print-ready (PDF) report.',

    runSelectLabel: 'Recovery run',
    runSelectPlaceholder: 'Select a completed run',
    noTerminalRuns: 'No completed recovery runs to export yet.',
    noTerminalRunsHint:
      'Once a failover drill or live recovery reaches a terminal state it can be exported as an evidence pack here.',

    exportAction: 'Export evidence pack',
    dialogTitle: 'Evidence pack',
    dialogDescription:
      'Review the assembled evidence, then download it as JSON or open the print-ready view for browser print-to-PDF.',
    downloadJson: 'Download JSON',
    printView: 'Print / Save as PDF',
    close: 'Close',
    assembling: 'Assembling evidence pack…',
    assembleError: 'Failed to assemble the evidence pack for this run.',
    retry: 'Retry',

    printHeading: 'ClarioDR recovery evidence pack',
    printSubheading: 'Tamper-evident attestation of disaster-recovery execution',
    generatedAt: 'Generated',
    generatedBy: 'Generated by',
    tenant: 'Tenant',
    group: 'Protection group',

    runHeading: 'Recovery run',
    runId: 'Run ID',
    runMode: 'Mode',
    runStatus: 'Status',
    recoveryPoint: 'Recovery point',
    initiatedBy: 'Initiated by',
    approvedBy: 'Approved by',
    initiatedAt: 'Initiated',
    completedAt: 'Completed',
    lastError: 'Last error',

    rtoHeading: 'RTO vs RTA',
    rtoObjective: 'Objective (RTO)',
    rtoActual: 'Actual (RTA)',
    rtoRemaining: 'Margin',
    rtoVerdictMet: 'RTO met',
    rtoVerdictBreached: 'RTO breached',
    rtoVerdictPending: 'Not measured',

    gatesHeading: 'Four-gate outcome',
    gateValidate: 'Validate',
    gateApprove: 'Approve',
    gateExecute: 'Execute',
    gateAttest: 'Attest',
    outcomePassed: 'Passed',
    outcomeFailed: 'Failed',
    outcomeSkipped: 'Skipped',
    outcomePending: 'Pending',

    attestationHeading: 'Sealed attestation',
    attestationId: 'Attestation ID',
    attestationHash: 'Content hash',
    attestationObjectKey: 'WORM object key',
    attestationRpo: 'RPO achieved',
    attestationValidationRatio: 'Validation ratio',
    noAttestation: 'No attestation was sealed for this run.',

    ledgerHeading: 'Attestation-ledger entries',
    ledgerSeq: 'Seq',
    ledgerType: 'Entry type',
    ledgerEntryHash: 'Entry hash',
    ledgerAnchored: 'Anchored',
    ledgerNotAnchored: 'Not anchored',
    noLedgerEntries: 'No ledger entries reference this run yet.',

    hashChainHeading: 'Hash-chain integrity',
    hashChainVerified: 'Chain verified intact',
    hashChainBroken: 'Chain integrity broken',
    hashChainEntriesChecked: 'Entries checked',
    hashChainHeadHash: 'Head hash',
    hashChainIncluded: 'Entries in this pack',
    hashChainContiguous: 'Included links contiguous',
    hashChainNotContiguous: 'Included links not contiguous',
    hashChainAnchored: 'Anchored entries',

    downloadSuccess: (runId: string) => `Evidence pack for ${runId} downloaded`,
    downloadError: 'Failed to download the evidence pack',
    printPopupBlocked: 'Unable to open the print view — allow pop-ups for this site and retry.',

    notAvailable: 'n/a',
  },
  ar: {
    sectionTitle: 'حزمة أدلة بنقرة واحدة',
    sectionDescription:
      'جمّع حزمة أدلة محمولة ومُحصَّنة ضد العبث لعملية استرداد أو تمرين مكتمل — العملية ونتيجة البوابات الأربع وهدف زمن الاسترداد (RTO) مقابل الزمن الفعلي (RTA) والإثبات المختوم وقيود السجل المترابطة بالتجزئة ذات الصلة — كملف JSON قابل للتنزيل أو تقرير جاهز للطباعة (PDF).',

    runSelectLabel: 'عملية الاسترداد',
    runSelectPlaceholder: 'اختر عملية مكتملة',
    noTerminalRuns: 'لا توجد عمليات استرداد مكتملة للتصدير بعد.',
    noTerminalRunsHint:
      'بمجرد أن يصل تمرين تجاوز الفشل أو الاسترداد الفعلي إلى حالة نهائية، يمكن تصديره كحزمة أدلة هنا.',

    exportAction: 'تصدير حزمة الأدلة',
    dialogTitle: 'حزمة الأدلة',
    dialogDescription:
      'راجِع الأدلة المجمَّعة، ثم نزّلها كملف JSON أو افتح العرض الجاهز للطباعة لتحويله إلى PDF عبر المتصفح.',
    downloadJson: 'تنزيل JSON',
    printView: 'طباعة / حفظ بصيغة PDF',
    close: 'إغلاق',
    assembling: 'جارٍ تجميع حزمة الأدلة…',
    assembleError: 'تعذّر تجميع حزمة الأدلة لهذه العملية.',
    retry: 'إعادة المحاولة',

    printHeading: 'حزمة أدلة الاسترداد من ClarioDR',
    printSubheading: 'إثبات مُحصَّن ضد العبث لتنفيذ التعافي من الكوارث',
    generatedAt: 'تاريخ الإنشاء',
    generatedBy: 'أنشأها',
    tenant: 'المستأجر',
    group: 'مجموعة الحماية',

    runHeading: 'عملية الاسترداد',
    runId: 'معرّف العملية',
    runMode: 'النمط',
    runStatus: 'الحالة',
    recoveryPoint: 'نقطة الاسترداد',
    initiatedBy: 'بدأها',
    approvedBy: 'وافق عليها',
    initiatedAt: 'وقت البدء',
    completedAt: 'وقت الاكتمال',
    lastError: 'آخر خطأ',

    rtoHeading: 'هدف زمن الاسترداد (RTO) مقابل الزمن الفعلي (RTA)',
    rtoObjective: 'الهدف (RTO)',
    rtoActual: 'الفعلي (RTA)',
    rtoRemaining: 'الهامش',
    rtoVerdictMet: 'تحقق هدف RTO',
    rtoVerdictBreached: 'تم تجاوز هدف RTO',
    rtoVerdictPending: 'لم يُقَس',

    gatesHeading: 'نتيجة البوابات الأربع',
    gateValidate: 'تحقق',
    gateApprove: 'موافقة',
    gateExecute: 'تنفيذ',
    gateAttest: 'إثبات',
    outcomePassed: 'ناجح',
    outcomeFailed: 'فاشل',
    outcomeSkipped: 'متخطّى',
    outcomePending: 'معلّق',

    attestationHeading: 'الإثبات المختوم',
    attestationId: 'معرّف الإثبات',
    attestationHash: 'تجزئة المحتوى',
    attestationObjectKey: 'مفتاح كائن WORM',
    attestationRpo: 'نقطة الاسترداد (RPO) المحققة',
    attestationValidationRatio: 'نسبة التحقق',
    noAttestation: 'لم يُختم أي إثبات لهذه العملية.',

    ledgerHeading: 'قيود سجل الإثبات',
    ledgerSeq: 'التسلسل',
    ledgerType: 'نوع القيد',
    ledgerEntryHash: 'تجزئة القيد',
    ledgerAnchored: 'مرتبط بمرساة',
    ledgerNotAnchored: 'غير مرتبط بمرساة',
    noLedgerEntries: 'لا توجد قيود في السجل تشير إلى هذه العملية بعد.',

    hashChainHeading: 'سلامة سلسلة التجزئة',
    hashChainVerified: 'تم التحقق من سلامة السلسلة',
    hashChainBroken: 'انكسرت سلامة السلسلة',
    hashChainEntriesChecked: 'القيود المفحوصة',
    hashChainHeadHash: 'تجزئة الرأس',
    hashChainIncluded: 'القيود في هذه الحزمة',
    hashChainContiguous: 'الروابط المضمَّنة متصلة',
    hashChainNotContiguous: 'الروابط المضمَّنة غير متصلة',
    hashChainAnchored: 'القيود المرتبطة بمرساة',

    downloadSuccess: (runId: string) => `تم تنزيل حزمة أدلة العملية ${runId}`,
    downloadError: 'تعذّر تنزيل حزمة الأدلة',
    printPopupBlocked: 'تعذّر فتح عرض الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع ثم أعد المحاولة.',

    notAvailable: 'غير متاح',
  },
};

/**
 * Default resolved labels (English) for pure / non-React callers — the print-HTML
 * builder and print view fall back to these when no explicit labels are passed.
 */
export const evidenceExportLabels: EvidenceExportLabels = evidenceExportLabelsBundle.en;

/**
 * React hook returning the active-locale-resolved evidence-export labels.
 * Reads the active locale via `useLocaleOrDefault` (defaults to English under the
 * test `en` LocaleProvider and outside any provider) and memoizes by locale.
 */
export function useEvidenceExportLabels(): EvidenceExportLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(evidenceExportLabelsBundle, locale), [locale]);
}
