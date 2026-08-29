/**
 * Feature-local copy for the attestation-ledger explorer (`/dr/prove/ledger`).
 *
 * Kept out of the shared `_lib/dr-i18n.ts` per the route contract: these strings
 * belong only to this sub-route. Adopts the foundation's bilingual bundle shape:
 * `ledgerExplorerLabels` is a `DRBilingual<LedgerExplorerCopy>` holding two full,
 * identically-shaped copies (English + professional MSA). The page resolves the
 * active locale via {@link useLedgerExplorerLabels} and passes the resolved
 * `LedgerExplorerCopy` object down to the explorer components via their `copy`
 * prop exactly as before.
 */

'use client';

import { useMemo } from 'react';
import { type DRBilingual, resolveDRBilingual } from '../../../_lib/dr-i18n';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';

export interface LedgerExplorerCopy {
  /** Page header. */
  pageTitle: string;
  pageDescription: string;
  /** Back-link to the Prove overview. */
  backToProve: string;

  /** Filter bar. */
  filtersHeading: string;
  filterTypeLabel: string;
  filterTypeAll: string;
  filterSubjectLabel: string;
  filterSubjectPlaceholder: string;
  filterSeqFromLabel: string;
  filterSeqToLabel: string;
  filterSeqPlaceholder: string;
  filterLimitLabel: string;
  filterApply: string;
  filterReset: string;
  filterActiveSummary: string;

  /** Ledger-wide verify verdict. */
  verifyHeading: string;
  verifyDescription: string;
  verifyIntact: string;
  verifyBroken: string;
  verifyPending: string;
  verifyEntriesChecked: string;
  verifyFirstBrokenSeq: string;
  verifyHeadHash: string;
  verifyReason: string;
  verifyRefresh: string;

  /** Ledger table region. */
  tableHeading: string;
  tableDescription: string;
  tableProofColumn: string;
  tableProofAction: string;
  tableProofLoading: string;
  tableProofRefresh: string;
  tableEmpty: string;
  tableResultCount: string;

  /** Inclusion-proof detail. */
  proofHeading: string;
  proofDescription: string;
  proofEmpty: string;
  proofSelectedSeq: string;
  proofLeafIndex: string;
  proofPathNodes: string;
  proofWindow: string;
  proofLeafHash: string;
  proofRoot: string;
  proofVerifiedBadge: string;
  proofUnverifiedBadge: string;
  proofNoSiblings: string;
  proofLeftSibling: string;
  proofRightSibling: string;
  proofNode: string;
  proofRecompute: string;

  /** Anchor-checkpoint timeline + action. */
  anchorHeading: string;
  anchorDescription: string;
  anchorAction: string;
  anchorActionPending: string;
  anchorActionNoEntries: string;
  anchorActionVerifyFirst: string;
  anchorActionUpToDate: string;
  anchorLatestCheckpoint: string;
  anchorWindow: string;
  anchorEntries: string;
  anchorRoot: string;
  anchorCreated: string;
  anchorWormObject: string;
  anchorWormVersion: string;
  anchorTimelineHeading: string;
  anchorTimelineEmpty: string;
  anchorPendingWindow: string;
  anchorPendingEntries: string;
  anchorReadOnlyNotice: string;

  /** Generic. */
  retry: string;
  loadError: string;
  notAvailable: string;
}

export const ledgerExplorerLabels: DRBilingual<LedgerExplorerCopy> = {
  en: {
    pageTitle: 'Attestation ledger explorer',
    pageDescription:
      'Filter the hash-chained DR attestation ledger by event type, subject, and sequence range; verify per-entry inclusion proofs against the Merkle root; review the ledger-wide chain verdict; and anchor new entries to a WORM checkpoint.',
    backToProve: 'Prove',

    filtersHeading: 'Filters',
    filterTypeLabel: 'Entry type',
    filterTypeAll: 'All event types',
    filterSubjectLabel: 'Subject',
    filterSubjectPlaceholder: 'Subject id contains…',
    filterSeqFromLabel: 'Seq from',
    filterSeqToLabel: 'Seq to',
    filterSeqPlaceholder: 'e.g. 100',
    filterLimitLabel: 'Max rows',
    filterApply: 'Apply filters',
    filterReset: 'Reset',
    filterActiveSummary: 'Active filters',

    verifyHeading: 'Chain verification',
    verifyDescription: 'Ledger-wide hash-chain verdict from the server verify pass.',
    verifyIntact: 'Chain intact',
    verifyBroken: 'Chain broken',
    verifyPending: 'Not verified',
    verifyEntriesChecked: 'Entries checked',
    verifyFirstBrokenSeq: 'First broken seq',
    verifyHeadHash: 'Head hash',
    verifyReason: 'Reason',
    verifyRefresh: 'Re-verify',

    tableHeading: 'Ledger entries',
    tableDescription: 'Append-only, hash-chained attestation entries matching the active filters.',
    tableProofColumn: 'Inclusion proof',
    tableProofAction: 'Verify proof',
    tableProofLoading: 'Loading…',
    tableProofRefresh: 'Refresh proof',
    tableEmpty: 'No ledger entries match the current filters.',
    tableResultCount: 'entries',

    proofHeading: 'Inclusion proof',
    proofDescription: 'Merkle inclusion path for the selected entry, validated against the checkpoint root.',
    proofEmpty: 'Select an entry and verify its inclusion proof to inspect the Merkle path here.',
    proofSelectedSeq: 'Sequence',
    proofLeafIndex: 'Leaf index',
    proofPathNodes: 'Path nodes',
    proofWindow: 'Checkpoint window',
    proofLeafHash: 'Leaf hash',
    proofRoot: 'Merkle root',
    proofVerifiedBadge: 'Inclusion verified',
    proofUnverifiedBadge: 'Recompute mismatch',
    proofNoSiblings: 'No sibling nodes required — the leaf is the checkpoint root.',
    proofLeftSibling: 'Left sibling',
    proofRightSibling: 'Right sibling',
    proofNode: 'Node',
    proofRecompute: 'Recomputed root',

    anchorHeading: 'Anchor checkpoints',
    anchorDescription:
      'Anchored Merkle windows over the ledger, newest first, plus the entries awaiting the next checkpoint.',
    anchorAction: 'Anchor now',
    anchorActionPending: 'Anchoring…',
    anchorActionNoEntries: 'No entries',
    anchorActionVerifyFirst: 'Verify first',
    anchorActionUpToDate: 'Up to date',
    anchorLatestCheckpoint: 'Latest checkpoint',
    anchorWindow: 'Window',
    anchorEntries: 'Entries',
    anchorRoot: 'Merkle root',
    anchorCreated: 'Anchored',
    anchorWormObject: 'WORM object',
    anchorWormVersion: 'WORM version',
    anchorTimelineHeading: 'Checkpoint timeline',
    anchorTimelineEmpty: 'No anchored checkpoints yet for the visible ledger window.',
    anchorPendingWindow: 'Awaiting anchor',
    anchorPendingEntries: 'entries since the last checkpoint',
    anchorReadOnlyNotice:
      'Anchoring ledger checkpoints to WORM storage requires the dr:write permission. You can still filter the ledger, verify inclusion proofs, and review existing checkpoints.',

    retry: 'Retry',
    loadError: 'Failed to load the attestation ledger.',
    notAvailable: 'n/a',
  },
  ar: {
    pageTitle: 'مستكشف سجل الإثبات',
    pageDescription:
      'صفِّ سجل إثبات التعافي من الكوارث المترابط بالتجزئة حسب نوع الحدث والموضوع ونطاق التسلسل؛ وتحقّق من أدلة الإدراج لكل قيد مقابل جذر ميركل؛ وراجِع حكم سلامة السلسلة على مستوى السجل؛ واربط القيود الجديدة بنقطة تحقق على تخزين WORM.',
    backToProve: 'الإثبات',

    filtersHeading: 'عوامل التصفية',
    filterTypeLabel: 'نوع القيد',
    filterTypeAll: 'كل أنواع الأحداث',
    filterSubjectLabel: 'الموضوع',
    filterSubjectPlaceholder: 'معرّف الموضوع يحتوي على…',
    filterSeqFromLabel: 'التسلسل من',
    filterSeqToLabel: 'التسلسل إلى',
    filterSeqPlaceholder: 'مثال: 100',
    filterLimitLabel: 'الحد الأقصى للصفوف',
    filterApply: 'تطبيق عوامل التصفية',
    filterReset: 'إعادة تعيين',
    filterActiveSummary: 'عوامل التصفية النشطة',

    verifyHeading: 'التحقق من السلسلة',
    verifyDescription: 'حكم سلامة سلسلة التجزئة على مستوى السجل من تمرير التحقق على الخادم.',
    verifyIntact: 'السلسلة سليمة',
    verifyBroken: 'السلسلة مكسورة',
    verifyPending: 'لم يتم التحقق',
    verifyEntriesChecked: 'القيود المفحوصة',
    verifyFirstBrokenSeq: 'أول تسلسل مكسور',
    verifyHeadHash: 'تجزئة الرأس',
    verifyReason: 'السبب',
    verifyRefresh: 'إعادة التحقق',

    tableHeading: 'قيود السجل',
    tableDescription: 'قيود إثبات قابلة للإلحاق فقط ومترابطة بالتجزئة تطابق عوامل التصفية النشطة.',
    tableProofColumn: 'دليل الإدراج',
    tableProofAction: 'التحقق من الدليل',
    tableProofLoading: 'جارٍ التحميل…',
    tableProofRefresh: 'تحديث الدليل',
    tableEmpty: 'لا توجد قيود في السجل تطابق عوامل التصفية الحالية.',
    tableResultCount: 'قيد',

    proofHeading: 'دليل الإدراج',
    proofDescription: 'مسار إدراج ميركل للقيد المحدد، مُتحقَّق منه مقابل جذر نقطة التحقق.',
    proofEmpty: 'اختر قيدًا وتحقّق من دليل إدراجه لفحص مسار ميركل هنا.',
    proofSelectedSeq: 'التسلسل',
    proofLeafIndex: 'فهرس الورقة',
    proofPathNodes: 'عُقد المسار',
    proofWindow: 'نافذة نقطة التحقق',
    proofLeafHash: 'تجزئة الورقة',
    proofRoot: 'جذر ميركل',
    proofVerifiedBadge: 'تم التحقق من الإدراج',
    proofUnverifiedBadge: 'عدم تطابق إعادة الحساب',
    proofNoSiblings: 'لا حاجة إلى عُقد شقيقة — الورقة هي جذر نقطة التحقق.',
    proofLeftSibling: 'الشقيق الأيسر',
    proofRightSibling: 'الشقيق الأيمن',
    proofNode: 'العقدة',
    proofRecompute: 'الجذر المُعاد حسابه',

    anchorHeading: 'نقاط تحقق المرساة',
    anchorDescription:
      'نوافذ ميركل المرتبطة بمرساة على السجل، الأحدث أولًا، إضافة إلى القيود التي تنتظر نقطة التحقق التالية.',
    anchorAction: 'الربط الآن',
    anchorActionPending: 'جارٍ الربط…',
    anchorActionNoEntries: 'لا توجد قيود',
    anchorActionVerifyFirst: 'تحقّق أولًا',
    anchorActionUpToDate: 'محدَّث',
    anchorLatestCheckpoint: 'أحدث نقطة تحقق',
    anchorWindow: 'النافذة',
    anchorEntries: 'القيود',
    anchorRoot: 'جذر ميركل',
    anchorCreated: 'تاريخ الربط',
    anchorWormObject: 'كائن WORM',
    anchorWormVersion: 'إصدار WORM',
    anchorTimelineHeading: 'الخط الزمني لنقاط التحقق',
    anchorTimelineEmpty: 'لا توجد نقاط تحقق مرتبطة بمرساة بعد لنافذة السجل المرئية.',
    anchorPendingWindow: 'بانتظار الربط',
    anchorPendingEntries: 'قيد منذ آخر نقطة تحقق',
    anchorReadOnlyNotice:
      'يتطلب ربط نقاط تحقق السجل بتخزين WORM صلاحية dr:write. لا يزال بإمكانك تصفية السجل والتحقق من أدلة الإدراج ومراجعة نقاط التحقق القائمة.',

    retry: 'إعادة المحاولة',
    loadError: 'تعذّر تحميل سجل الإثبات.',
    notAvailable: 'غير متاح',
  },
};

/**
 * React hook returning the active-locale-resolved ledger-explorer copy. Reads the
 * active locale via `useLocaleOrDefault` (defaults to English under the test `en`
 * LocaleProvider and outside any provider) and memoizes by locale. The page calls
 * this and threads the resolved `copy` down to the explorer components.
 */
export function useLedgerExplorerLabels(): LedgerExplorerCopy {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(ledgerExplorerLabels, locale), [locale]);
}
