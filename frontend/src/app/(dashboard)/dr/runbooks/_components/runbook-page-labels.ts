/**
 * Feature-local bilingual copy for the Runbook Studio ROUTES (list / author /
 * live-execution page chrome). This is the page-level copy that sits AROUND the
 * design-system `RunbookTaskFlow` and the authoring dialogs — page titles, the
 * runbook-selector, run-status/run-mode display records keyed by the REAL
 * backend tokens, the live war-room strip, and the screen-reader announcements.
 *
 * It deliberately does NOT redefine the studio authoring/form copy: that lives
 * in the foundation bundle `../_components/runbook-studio/runbook-studio-labels`
 * (`useRunbookStudioLabels()` — also the source of the `taskFlow` DS prop). The
 * two compose: the dialogs read the foundation studio labels; the routes read
 * these page labels for everything around them.
 *
 * Adopts the foundation bilingual contract (`_lib/dr-i18n.ts`): a
 * `DRBilingual<T> = { en, ar }` bundle of two FULL, identically-shaped copies —
 * English in `en`, professional Modern Standard Arabic in `ar`. Function-valued
 * and nested-record fields appear on BOTH sides; interpolation params (`{name}`,
 * `{id}`) and Western digits are preserved; established acronyms (DAG / RTA) are
 * kept and glossed on first natural use in Arabic. RTL is handled by logical
 * Tailwind props in the components — this file is copy only.
 *
 * Run-status / run-mode display records are keyed by the canonical backend
 * tokens from `internal/dr/runbookstudio/model.go`:
 *   - run status: pending | running | completed | failed | aborted
 *   - run mode:   live | rehearsal
 *   - runbook (metadata) status: draft | published | archived
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface RunbookPageLabels {
  /** ---- List route (/dr/runbooks) ---- */
  /** Uppercase eyebrow above the list/author titles (PageHeader pill). */
  consoleEyebrow: string;
  listTitle: string;
  listDescription: string;
  selectorLabel: string;
  selectorPlaceholder: string;
  selectorEmpty: string;
  openAuthor: string;
  noSelectionTitle: string;
  noSelectionDescription: string;
  /** A freshly created/selected runbook is surfaced as a single deep-linkable card. */
  selectedRunbookHeading: string;
  createdJustNow: string;

  /** ---- Runbook catalog (protection-group scopes) ---- */
  catalogTitle: string;
  catalogDescription: string;
  catalogCreateForGroup: string;
  catalogGroupHealthLabel: (health: string) => string;
  catalogMembersLabel: string;
  catalogStreamsLabel: string;
  catalogRtoLabel: string;
  catalogRpoLabel: string;
  /** Shown for an RTO/RPO objective that has not been configured on the group. */
  catalogNotSet: string;
  catalogValidatedPoint: string;
  catalogNoValidatedPoint: string;
  catalogLastRun: string;
  /** Full-page empty state shown when the tenant has no protection groups. */
  setupTitle: string;
  setupDescription: string;
  setupProtectionCta: string;
  /** Empty-state action button to author the first runbook. */
  createRunbookCta: string;

  /** ---- Author route (/dr/runbooks/[id]) ---- */
  authorTitle: string;
  authorDescription: string;
  backToList: string;
  metadataHeading: string;
  groupBoundLabel: string;
  groupUnbound: string;
  sourceLabel: string;
  taskCountLabel: string;
  openRunHeading: string;
  openRunDescription: string;
  openRunLink: string;

  /** ---- Live route (/dr/runbooks/runs/[runId]) ---- */
  liveTitle: string;
  liveDescriptionPrefix: string;
  backToRunbook: string;
  liveBadge: string;
  settledBadge: string;
  liveBadgeDescription: string;
  settledBadgeDescription: string;
  projectionHeading: string;
  projectionElapsed: string;
  projectionRemaining: string;
  projectionVariance: string;
  projectionAhead: string;
  projectionBehind: string;
  actHeading: string;
  actDescription: string;
  selectTaskPrompt: string;
  actingOnTask: string;
  noActionableTask: string;
  taskRequiredBadge: string;
  taskOptionalBadge: string;

  /** Display records keyed by REAL backend tokens. */
  runStatusLabels: Record<string, string>;
  runModeLabels: Record<string, string>;
  runbookStatusLabels: Record<string, string>;

  /** Shared empty / error / loading. */
  loading: string;
  loadError: string;
  retry: string;
  notFoundTitle: string;
  notFoundDescription: string;

  /** Screen-reader live-region announcements. */
  selectedAnnouncement: (name: string) => string;
  runOpenedAnnouncement: (id: string) => string;
}

export const runbookPageLabelBundle: DRBilingual<RunbookPageLabels> = {
  en: {
    consoleEyebrow: 'Recovery operations',
    listTitle: 'Recovery runbooks',
    listDescription:
      'Author and run sequenced recovery runbooks. Create a runbook, then open it to build its task DAG (directed acyclic graph) and start a run.',
    selectorLabel: 'Active runbook',
    selectorPlaceholder: 'Enter a runbook id to open',
    selectorEmpty: 'No runbook is open. Create one or paste a runbook id to open it.',
    openAuthor: 'Open runbook',
    noSelectionTitle: 'No runbook open',
    noSelectionDescription:
      'Create a runbook below, or open an existing one by its id, to author its tasks and start a recovery run.',
    selectedRunbookHeading: 'Open runbook',
    createdJustNow: 'Just created',

    catalogTitle: 'Runbook catalog',
    catalogDescription:
      'Your protection groups — each is a runbook scope. Create a runbook for a group without pasting an id, or open one by id above.',
    catalogCreateForGroup: 'New runbook for group',
    catalogGroupHealthLabel: (health) => `Health: ${health}`,
    catalogMembersLabel: 'Members',
    catalogStreamsLabel: 'Streams',
    catalogRtoLabel: 'RTO',
    catalogRpoLabel: 'RPO',
    catalogNotSet: 'not set',
    catalogValidatedPoint: 'Validated recovery point available',
    catalogNoValidatedPoint: 'Validate a recovery point before live use',
    catalogLastRun: 'Open last run',
    setupTitle: 'Set up disaster recovery',
    setupDescription:
      'Runbooks orchestrate the recovery of a protection group. Create your first protection group to author and run runbooks against it.',
    setupProtectionCta: 'Set up protection',
    createRunbookCta: 'Create your first runbook',

    authorTitle: 'Author runbook',
    authorDescription:
      'View the task DAG, add tasks, edit the runbook metadata, and start a recovery run.',
    backToList: 'All runbooks',
    metadataHeading: 'Runbook details',
    groupBoundLabel: 'Protection group',
    groupUnbound: 'Unbound (tenant-wide)',
    sourceLabel: 'Source',
    taskCountLabel: 'Tasks',
    openRunHeading: 'Live run',
    openRunDescription: 'A run was started from this runbook. Open the live execution view to drive it.',
    openRunLink: 'Open live run',

    liveTitle: 'Runbook run',
    liveDescriptionPrefix: 'Live execution of runbook',
    backToRunbook: 'Back to runbook',
    liveBadge: 'Live',
    settledBadge: 'Settled',
    liveBadgeDescription: 'This run is still executing and refreshes automatically.',
    settledBadgeDescription: 'This run has reached a terminal state.',
    projectionHeading: 'Run projection',
    projectionElapsed: 'Elapsed',
    projectionRemaining: 'Remaining critical path',
    projectionVariance: 'Variance',
    projectionAhead: 'Ahead of plan',
    projectionBehind: 'Behind plan',
    actHeading: 'Drive the run',
    actDescription:
      'Select a runnable task, then complete, skip, or fail it. Completing a task unlocks its dependents.',
    selectTaskPrompt: 'Select a task in the flow above to act on it.',
    actingOnTask: 'Acting on task',
    noActionableTask: 'The selected task cannot be acted on in its current state.',
    taskRequiredBadge: 'Required',
    taskOptionalBadge: 'Optional',

    runStatusLabels: {
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      aborted: 'Aborted',
    },
    runModeLabels: {
      live: 'Live',
      rehearsal: 'Rehearsal',
    },
    runbookStatusLabels: {
      draft: 'Draft',
      published: 'Published',
      archived: 'Archived',
    },

    loading: 'Loading runbook…',
    loadError: 'The runbook feed is unavailable. Retry to reload it.',
    retry: 'Retry',
    notFoundTitle: 'Runbook not found',
    notFoundDescription:
      'No runbook id was provided. Return to the runbooks list to open or create one.',

    selectedAnnouncement: (name) => `Runbook ${name} is now open.`,
    runOpenedAnnouncement: (id) => `Runbook run ${id} opened.`,
  },
  ar: {
    consoleEyebrow: 'عمليات الاسترداد',
    listTitle: 'كتيّبات الاسترداد',
    listDescription:
      'حرِّر كتيّبات الاسترداد المتسلسلة وشغّلها. أنشئ كتيّبًا ثم افتحه لبناء مخطط مهامه الموجّه اللادوري (DAG) وبدء التشغيل.',
    selectorLabel: 'الكتيّب النشط',
    selectorPlaceholder: 'أدخل معرّف الكتيّب لفتحه',
    selectorEmpty: 'لا يوجد كتيّب مفتوح. أنشئ كتيّبًا أو ألصق معرّف كتيّب لفتحه.',
    openAuthor: 'فتح الكتيّب',
    noSelectionTitle: 'لا يوجد كتيّب مفتوح',
    noSelectionDescription:
      'أنشئ كتيّبًا أدناه، أو افتح كتيّبًا قائمًا عبر معرّفه، لتحرير مهامه وبدء عملية استرداد.',
    selectedRunbookHeading: 'الكتيّب المفتوح',
    createdJustNow: 'أُنشئ للتو',

    catalogTitle: 'دليل الكتيّبات',
    catalogDescription:
      'مجموعات الحماية لديك — كل منها نطاق لكتيّب. أنشئ كتيّبًا لمجموعة دون لصق معرّف، أو افتح كتيّبًا عبر المعرّف أعلاه.',
    catalogCreateForGroup: 'كتيّب جديد للمجموعة',
    catalogGroupHealthLabel: (health) => `الحالة: ${health}`,
    catalogMembersLabel: 'الأعضاء',
    catalogStreamsLabel: 'التدفقات',
    catalogRtoLabel: 'RTO',
    catalogRpoLabel: 'RPO',
    catalogNotSet: 'غير محدد',
    catalogValidatedPoint: 'نقطة استرداد محققة متاحة',
    catalogNoValidatedPoint: 'حقّق نقطة استرداد قبل الاستخدام المباشر',
    catalogLastRun: 'فتح آخر تشغيل',
    setupTitle: 'إعداد التعافي من الكوارث',
    setupDescription:
      'تنسّق الكتيّبات استرداد مجموعة حماية. أنشئ أول مجموعة حماية لك لتحرير الكتيّبات وتشغيلها عليها.',
    setupProtectionCta: 'إعداد الحماية',
    createRunbookCta: 'أنشئ أول كتيّب لك',

    authorTitle: 'تحرير الكتيّب',
    authorDescription:
      'اعرض مخطط المهام الموجّه (DAG)، وأضِف المهام، وحرِّر بيانات الكتيّب، وابدأ عملية استرداد.',
    backToList: 'كل الكتيّبات',
    metadataHeading: 'تفاصيل الكتيّب',
    groupBoundLabel: 'مجموعة الحماية',
    groupUnbound: 'غير مرتبط (على مستوى المستأجر)',
    sourceLabel: 'المصدر',
    taskCountLabel: 'المهام',
    openRunHeading: 'التشغيل المباشر',
    openRunDescription: 'بدأ تشغيل من هذا الكتيّب. افتح عرض التنفيذ المباشر لقيادته.',
    openRunLink: 'فتح التشغيل المباشر',

    liveTitle: 'تشغيل الكتيّب',
    liveDescriptionPrefix: 'التنفيذ المباشر للكتيّب',
    backToRunbook: 'العودة إلى الكتيّب',
    liveBadge: 'مباشر',
    settledBadge: 'مستقر',
    liveBadgeDescription: 'لا يزال هذا التشغيل قيد التنفيذ ويُحدَّث تلقائيًا.',
    settledBadgeDescription: 'بلغ هذا التشغيل حالة نهائية.',
    projectionHeading: 'توقّع التشغيل',
    projectionElapsed: 'المنقضي',
    projectionRemaining: 'المسار الحرج المتبقّي',
    projectionVariance: 'الفارق',
    projectionAhead: 'متقدّم على الخطة',
    projectionBehind: 'متأخّر عن الخطة',
    actHeading: 'قيادة التشغيل',
    actDescription:
      'اختر مهمة قابلة للتشغيل، ثم أكمِلها أو تخطّاها أو علّمها كفاشلة. إكمال مهمة يفتح المهام المعتمدة عليها.',
    selectTaskPrompt: 'اختر مهمة من المسار أعلاه للتعامل معها.',
    actingOnTask: 'الإجراء على المهمة',
    noActionableTask: 'لا يمكن التعامل مع المهمة المحددة في حالتها الراهنة.',
    taskRequiredBadge: 'إلزامية',
    taskOptionalBadge: 'اختيارية',

    runStatusLabels: {
      pending: 'معلّق',
      running: 'قيد التشغيل',
      completed: 'مكتمل',
      failed: 'فشل',
      aborted: 'مُجهَض',
    },
    runModeLabels: {
      live: 'مباشر',
      rehearsal: 'بروفة',
    },
    runbookStatusLabels: {
      draft: 'مسودة',
      published: 'منشور',
      archived: 'مؤرشف',
    },

    loading: 'جارٍ تحميل الكتيّب…',
    loadError: 'موجز الكتيّب غير متاح. أعد المحاولة لإعادة تحميله.',
    retry: 'إعادة المحاولة',
    notFoundTitle: 'الكتيّب غير موجود',
    notFoundDescription:
      'لم يُقدَّم معرّف كتيّب. عُد إلى قائمة الكتيّبات لفتح كتيّب أو إنشائه.',

    selectedAnnouncement: (name) => `الكتيّب ${name} مفتوح الآن.`,
    runOpenedAnnouncement: (id) => `فُتح تشغيل الكتيّب ${id}.`,
  },
};

/** English surface, exported for non-React callers and as the default resolution. */
export const runbookPageLabels: RunbookPageLabels = runbookPageLabelBundle.en;

/** Resolve the runbook page labels against the active locale (English default). */
export function useRunbookPageLabels(): RunbookPageLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(runbookPageLabelBundle, locale), [locale]);
}

/** A runbook run status is terminal when no further task actions are possible. */
export function isRunbookRunTerminal(status: string | null | undefined): boolean {
  const s = (status ?? '').toLowerCase();
  return s === 'completed' || s === 'failed' || s === 'aborted';
}
