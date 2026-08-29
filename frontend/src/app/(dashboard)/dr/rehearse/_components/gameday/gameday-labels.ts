/**
 * Feature-local bilingual label bundle for the Game Day surface — chaos-style
 * scenario authoring (create), running a scenario, and reading its scorecard
 * (run rollup + per-step detect/recover results + safety verdict).
 *
 * Adopts the foundation bilingual contract (see `_lib/dr-i18n.ts`): the label
 * group is a `DRBilingual<GameDayLabels> = { en, ar }` bundle of two FULL,
 * identically-shaped copies — English in `en` and professional Modern Standard
 * Arabic in `ar`. Every nested object (the `safetyVerdicts`, `runStatus`, and
 * `scope` records keyed by the REAL backend tokens) and every function-valued
 * field (`stepSummary`, `scenarioCreatedAnnouncement`, `runCompletedAnnouncement`)
 * appears on BOTH sides with the same signatures; interpolation params (`{name}`,
 * `{passed}`, `{total}`, `{verdict}`) and Western digits / latency units are
 * preserved. Acronyms (RTO/RPO) are kept and glossed in Arabic.
 *
 * RTL is handled by logical Tailwind props in the components; this file is copy
 * only. Components resolve the active-locale copy via {@link useGameDayLabels}
 * (under the `renderWithQuery` `en` default this yields English).
 */

'use client';

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../../_lib/dr-i18n';

/**
 * Drill-diff (planned-vs-actual) copy. Renders a {@link DRDrillDiff}: the
 * pass/RTO/RPO deltas and the step / asset drift between a drill result and its
 * predecessor. `rtoDelta` / `rpoDelta` format a signed seconds delta with its
 * unit (Western digits preserved on both locales).
 */
export interface DrillDiffLabels {
  heading: string;
  description: string;
  resultSelectLabel: string;
  resultSelectPlaceholder: string;
  noResults: string;
  noDiff: string;
  /** "Result {id} — {date}" option label for the result picker. */
  resultOption: (resultId: string, observedAt: string) => string;
  passChangeLabel: string;
  regressed: string;
  recovered: string;
  unchanged: string;
  previousLabel: string;
  currentLabel: string;
  passedToken: string;
  failedToken: string;
  rtoDeltaLabel: string;
  rpoDeltaLabel: string;
  /** Signed seconds delta with unit, e.g. "+12 s" / "-3 s". */
  secondsDelta: (value: number) => string;
  stepDriftHeading: string;
  newlyFailedSteps: string;
  newlyPassedSteps: string;
  addedSteps: string;
  removedSteps: string;
  noStepDrift: string;
  assetDriftHeading: string;
  addedMembers: string;
  removedMembers: string;
  reorderedMembers: string;
  addedEdges: string;
  removedEdges: string;
  noAssetDrift: string;
}

export interface GameDayLabels {
  /** Section heading + supporting copy. */
  title: string;
  description: string;

  /** Create-scenario authoring form. */
  createTriggerLabel: string;
  createDialogTitle: string;
  createDialogDescription: string;
  nameLabel: string;
  namePlaceholder: string;
  scenarioDescriptionLabel: string;
  scenarioDescriptionPlaceholder: string;
  groupLabel: string;
  groupPlaceholder: string;
  noGroups: string;
  scopeLabel: string;
  /** Scope display names, keyed by canonical scope token. */
  scope: Record<string, string>;

  /** Authoring-form validation messages (zod). */
  nameError: string;
  groupError: string;
  scopeError: string;
  stepsError: string;
  actionError: string;
  targetError: string;
  expectSignalError: string;
  requiredFieldHint: string;
  durationHelp: string;

  /** Step builder. */
  stepsHeading: string;
  addStepLabel: string;
  removeStepLabel: string;
  stepNumber: (index: number) => string;
  actionLabel: string;
  actionPlaceholder: string;
  targetLabel: string;
  targetPlaceholder: string;
  expectSignalLabel: string;
  expectSignalPlaceholder: string;
  detectWithinLabel: string;
  detectWithinPlaceholder: string;
  recoverWithinLabel: string;
  recoverWithinPlaceholder: string;
  noSteps: string;

  /** Run controls + scenario list. */
  runTriggerLabel: string;
  scenarioColumn: string;
  scopeColumn: string;
  stepsColumn: string;
  updatedColumn: string;

  /** Scorecard panel. */
  scorecardHeading: string;
  scorecardDescription: string;
  scorecardRunSelectLabel: string;
  scorecardRunSelectPlaceholder: string;
  safetyVerdictLabel: string;
  /** Safety-verdict display names, keyed by canonical verdict token. */
  safetyVerdicts: Record<string, string>;
  runStatusLabel: string;
  /** Run-status display names, keyed by canonical run-status token. */
  runStatus: Record<string, string>;
  scoreLabel: string;
  faultsRevertedLabel: string;
  faultsReverted: string;
  faultsNotReverted: string;
  observedSignalLabel: string;
  stepResultsHeading: string;
  stepActionColumn: string;
  stepSignalColumn: string;
  stepDetectColumn: string;
  stepRecoverColumn: string;
  stepOutcomeColumn: string;
  stepPassed: string;
  stepFailed: string;
  noScorecard: string;
  /** "{passed} of {total} steps passed" */
  stepSummary: (passed: number, total: number) => string;
  /** "{value} ms" — latency value with unit, Western digits preserved. */
  millis: (value: number) => string;

  /** Drill diff (planned-vs-actual) panel. */
  diff: DrillDiffLabels;

  /** Shared form actions. */
  submit: string;
  cancel: string;

  /** Empty / error / loading states. */
  emptyTitle: string;
  emptyDescription: string;
  errorTitle: string;
  errorDescription: string;
  retry: string;
  loading: string;

  /** Screen-reader live-region announcements. */
  scenarioCreatedAnnouncement: (name: string) => string;
  runCompletedAnnouncement: (verdict: string) => string;
}

export const gameDayLabelBundle: DRBilingual<GameDayLabels> = {
  en: {
    title: 'Game Day',
    description:
      'Author and run controlled fault-injection scenarios, then read the scorecard — detection and recovery latency per step against the expected signals, with a safety verdict.',

    createTriggerLabel: 'Create scenario',
    createDialogTitle: 'Create a game-day scenario',
    createDialogDescription:
      'Define the fault-injection steps and the signals each is expected to produce within its detect / recover windows.',
    nameLabel: 'Scenario name',
    namePlaceholder: 'Primary-region power loss',
    scenarioDescriptionLabel: 'Description',
    scenarioDescriptionPlaceholder: 'What this scenario exercises and why.',
    groupLabel: 'Protection group',
    groupPlaceholder: 'Select the protection group',
    noGroups: 'No protection groups available',
    scopeLabel: 'Scope',
    scope: {
      group: 'Protection group',
      site: 'Site',
      stream: 'Replication stream',
    },

    nameError: 'Enter a scenario name.',
    groupError: 'Select a protection group.',
    scopeError: 'Select a scope.',
    stepsError: 'Add at least one fault-injection step.',
    actionError: 'Enter the fault action.',
    targetError: 'Enter the target.',
    expectSignalError: 'Enter the expected signal.',
    requiredFieldHint: 'Required',
    durationHelp: 'Go duration, e.g. 30s or 5m. Leave blank for no window.',

    stepsHeading: 'Fault-injection steps',
    addStepLabel: 'Add step',
    removeStepLabel: 'Remove step',
    stepNumber: (index) => `Step ${index}`,
    actionLabel: 'Action',
    actionPlaceholder: 'kill_process',
    targetLabel: 'Target',
    targetPlaceholder: 'primary-db.internal',
    expectSignalLabel: 'Expected signal',
    expectSignalPlaceholder: 'failover_initiated',
    detectWithinLabel: 'Detect within',
    detectWithinPlaceholder: '30s',
    recoverWithinLabel: 'Recover within',
    recoverWithinPlaceholder: '5m',
    noSteps: 'No steps added yet',

    runTriggerLabel: 'Run scenario',
    scenarioColumn: 'Scenario',
    scopeColumn: 'Scope',
    stepsColumn: 'Steps',
    updatedColumn: 'Updated',

    scorecardHeading: 'Scorecard',
    scorecardDescription:
      'Detection and recovery latency per step against the expected signals, with a safety verdict.',
    scorecardRunSelectLabel: 'Game-day run',
    scorecardRunSelectPlaceholder: 'Open a completed run',
    safetyVerdictLabel: 'Safety verdict',
    safetyVerdicts: {
      safe: 'Safe',
      unsafe: 'Unsafe',
      inconclusive: 'Inconclusive',
    },
    runStatusLabel: 'Run status',
    runStatus: {
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    scoreLabel: 'Score',
    faultsRevertedLabel: 'Faults reverted',
    faultsReverted: 'All faults reverted',
    faultsNotReverted: 'Faults not fully reverted',
    observedSignalLabel: 'Observed signal',
    stepResultsHeading: 'Step results',
    stepActionColumn: 'Action',
    stepSignalColumn: 'Expected signal',
    stepDetectColumn: 'Detection latency',
    stepRecoverColumn: 'Recovery latency',
    stepOutcomeColumn: 'Outcome',
    stepPassed: 'Passed',
    stepFailed: 'Failed',
    noScorecard: 'No scorecard yet — run a scenario to produce one.',
    stepSummary: (passed, total) => `${passed} of ${total} steps passed`,
    millis: (value) => `${value} ms`,

    diff: {
      heading: 'Drill diff (planned vs actual)',
      description:
        'Pass, RTO, and RPO deltas plus step and asset drift between a drill result and its predecessor.',
      resultSelectLabel: 'Drill result',
      resultSelectPlaceholder: 'Select a drill result to compare',
      noResults: 'No drill results for this group yet.',
      noDiff: 'Select a drill result to compare against its predecessor.',
      resultOption: (resultId, observedAt) => `Result ${resultId} — ${observedAt}`,
      passChangeLabel: 'Pass outcome',
      regressed: 'Newly regressed',
      recovered: 'Newly recovered',
      unchanged: 'Unchanged',
      previousLabel: 'Previous',
      currentLabel: 'Current',
      passedToken: 'Passed',
      failedToken: 'Failed',
      rtoDeltaLabel: 'RTO delta',
      rpoDeltaLabel: 'RPO delta',
      secondsDelta: (value) => `${value >= 0 ? '+' : ''}${value} s`,
      stepDriftHeading: 'Step drift',
      newlyFailedSteps: 'Newly failed',
      newlyPassedSteps: 'Newly passed',
      addedSteps: 'Added',
      removedSteps: 'Removed',
      noStepDrift: 'No step drift',
      assetDriftHeading: 'Asset drift',
      addedMembers: 'Added members',
      removedMembers: 'Removed members',
      reorderedMembers: 'Reordered members',
      addedEdges: 'Added edges',
      removedEdges: 'Removed edges',
      noAssetDrift: 'No asset drift',
    },

    submit: 'Save scenario',
    cancel: 'Cancel',

    emptyTitle: 'No game-day scenarios',
    emptyDescription:
      'Create a scenario to inject controlled faults and measure detection and recovery here.',
    errorTitle: 'Could not load scenarios',
    errorDescription: 'The game-day feed is unavailable. Retry to reload the scenarios.',
    retry: 'Retry',
    loading: 'Loading game-day scenarios…',

    scenarioCreatedAnnouncement: (name) => `Game-day scenario ${name} created.`,
    runCompletedAnnouncement: (verdict) => `Game-day run completed with verdict ${verdict}.`,
  },
  ar: {
    title: 'يوم المحاكاة',
    description:
      'حرِّر ونفِّذ سيناريوهات حقن أعطال مُتحكَّم بها، ثم اقرأ بطاقة النتائج — زمن الاكتشاف والتعافي لكل خطوة مقابل الإشارات المتوقّعة، مع حكم على السلامة.',

    createTriggerLabel: 'إنشاء سيناريو',
    createDialogTitle: 'إنشاء سيناريو ليوم محاكاة',
    createDialogDescription:
      'عرِّف خطوات حقن الأعطال والإشارات المتوقّعة من كلٍّ منها ضمن نافذتي الاكتشاف والتعافي.',
    nameLabel: 'اسم السيناريو',
    namePlaceholder: 'انقطاع الطاقة في المنطقة الأساسية',
    scenarioDescriptionLabel: 'الوصف',
    scenarioDescriptionPlaceholder: 'ما الذي يختبره هذا السيناريو ولماذا.',
    groupLabel: 'مجموعة الحماية',
    groupPlaceholder: 'اختر مجموعة الحماية',
    noGroups: 'لا توجد مجموعات حماية متاحة',
    scopeLabel: 'النطاق',
    scope: {
      group: 'مجموعة الحماية',
      site: 'الموقع',
      stream: 'تدفّق النسخ المتماثل',
    },

    nameError: 'أدخل اسم السيناريو.',
    groupError: 'اختر مجموعة حماية.',
    scopeError: 'اختر نطاقًا.',
    stepsError: 'أضِف خطوة حقن أعطال واحدة على الأقل.',
    actionError: 'أدخل إجراء العطل.',
    targetError: 'أدخل الهدف.',
    expectSignalError: 'أدخل الإشارة المتوقّعة.',
    requiredFieldHint: 'مطلوب',
    durationHelp: 'مدة بصيغة Go، مثل 30s أو 5m. اتركه فارغًا لعدم تحديد نافذة.',

    stepsHeading: 'خطوات حقن الأعطال',
    addStepLabel: 'إضافة خطوة',
    removeStepLabel: 'إزالة الخطوة',
    stepNumber: (index) => `الخطوة ${index}`,
    actionLabel: 'الإجراء',
    actionPlaceholder: 'kill_process',
    targetLabel: 'الهدف',
    targetPlaceholder: 'primary-db.internal',
    expectSignalLabel: 'الإشارة المتوقّعة',
    expectSignalPlaceholder: 'failover_initiated',
    detectWithinLabel: 'الاكتشاف خلال',
    detectWithinPlaceholder: '30s',
    recoverWithinLabel: 'التعافي خلال',
    recoverWithinPlaceholder: '5m',
    noSteps: 'لم تُضَف خطوات بعد',

    runTriggerLabel: 'تشغيل السيناريو',
    scenarioColumn: 'السيناريو',
    scopeColumn: 'النطاق',
    stepsColumn: 'الخطوات',
    updatedColumn: 'آخر تحديث',

    scorecardHeading: 'بطاقة النتائج',
    scorecardDescription:
      'زمن الاكتشاف والتعافي لكل خطوة مقابل الإشارات المتوقّعة، مع حكم على السلامة.',
    scorecardRunSelectLabel: 'تشغيل يوم المحاكاة',
    scorecardRunSelectPlaceholder: 'افتح عملية تشغيل مكتملة',
    safetyVerdictLabel: 'حكم السلامة',
    safetyVerdicts: {
      safe: 'آمن',
      unsafe: 'غير آمن',
      inconclusive: 'غير حاسم',
    },
    runStatusLabel: 'حالة التشغيل',
    runStatus: {
      pending: 'معلّق',
      running: 'قيد التشغيل',
      completed: 'مكتمل',
      failed: 'فشل',
      cancelled: 'ملغى',
    },
    scoreLabel: 'النتيجة',
    faultsRevertedLabel: 'إعادة الأعطال',
    faultsReverted: 'تمت إعادة جميع الأعطال',
    faultsNotReverted: 'لم تُعَد جميع الأعطال بالكامل',
    observedSignalLabel: 'الإشارة المرصودة',
    stepResultsHeading: 'نتائج الخطوات',
    stepActionColumn: 'الإجراء',
    stepSignalColumn: 'الإشارة المتوقّعة',
    stepDetectColumn: 'زمن الاكتشاف',
    stepRecoverColumn: 'زمن التعافي',
    stepOutcomeColumn: 'النتيجة',
    stepPassed: 'ناجحة',
    stepFailed: 'فاشلة',
    noScorecard: 'لا توجد بطاقة نتائج بعد — شغّل سيناريو لإنشاء واحدة.',
    stepSummary: (passed, total) => `نجحت ${passed} من ${total} خطوة`,
    millis: (value) => `${value} مللي ثانية`,

    diff: {
      heading: 'مقارنة التمرين (المخطط مقابل الفعلي)',
      description:
        'فروق النجاح وهدف زمن الاسترداد (RTO) وهدف نقطة الاسترداد (RPO) إضافةً إلى انحراف الخطوات والأصول بين نتيجة تمرين وسابقتها.',
      resultSelectLabel: 'نتيجة التمرين',
      resultSelectPlaceholder: 'اختر نتيجة تمرين للمقارنة',
      noResults: 'لا توجد نتائج تمارين لهذه المجموعة بعد.',
      noDiff: 'اختر نتيجة تمرين لمقارنتها بسابقتها.',
      resultOption: (resultId, observedAt) => `النتيجة ${resultId} — ${observedAt}`,
      passChangeLabel: 'نتيجة النجاح',
      regressed: 'تراجَع حديثًا',
      recovered: 'تعافى حديثًا',
      unchanged: 'دون تغيير',
      previousLabel: 'السابق',
      currentLabel: 'الحالي',
      passedToken: 'ناجح',
      failedToken: 'فاشل',
      rtoDeltaLabel: 'فرق هدف زمن الاسترداد (RTO)',
      rpoDeltaLabel: 'فرق هدف نقطة الاسترداد (RPO)',
      secondsDelta: (value) => `${value >= 0 ? '+' : ''}${value} ث`,
      stepDriftHeading: 'انحراف الخطوات',
      newlyFailedSteps: 'فشلت حديثًا',
      newlyPassedSteps: 'نجحت حديثًا',
      addedSteps: 'مُضافة',
      removedSteps: 'محذوفة',
      noStepDrift: 'لا يوجد انحراف في الخطوات',
      assetDriftHeading: 'انحراف الأصول',
      addedMembers: 'أعضاء مُضافون',
      removedMembers: 'أعضاء محذوفون',
      reorderedMembers: 'أعضاء أُعيد ترتيبهم',
      addedEdges: 'حواف مُضافة',
      removedEdges: 'حواف محذوفة',
      noAssetDrift: 'لا يوجد انحراف في الأصول',
    },

    submit: 'حفظ السيناريو',
    cancel: 'إلغاء',

    emptyTitle: 'لا توجد سيناريوهات ليوم محاكاة',
    emptyDescription:
      'أنشئ سيناريو لحقن أعطال مُتحكَّم بها وقياس الاكتشاف والتعافي هنا.',
    errorTitle: 'تعذّر تحميل السيناريوهات',
    errorDescription: 'موجز يوم المحاكاة غير متاح. أعد المحاولة لإعادة تحميل السيناريوهات.',
    retry: 'إعادة المحاولة',
    loading: 'جارٍ تحميل سيناريوهات يوم المحاكاة…',

    scenarioCreatedAnnouncement: (name) => `تم إنشاء سيناريو يوم المحاكاة ${name}.`,
    runCompletedAnnouncement: (verdict) => `اكتمل تشغيل يوم المحاكاة بحكم ${verdict}.`,
  },
};

/** English surface, exported for non-React callers and as the default resolution. */
export const gameDayLabels: GameDayLabels = gameDayLabelBundle.en;

/**
 * useGameDayLabels resolves the Game Day labels against the active locale
 * (English fallback / default), mirroring the shared `useDRLabels` hook.
 */
export function useGameDayLabels(): GameDayLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(gameDayLabelBundle, locale), [locale]);
}
