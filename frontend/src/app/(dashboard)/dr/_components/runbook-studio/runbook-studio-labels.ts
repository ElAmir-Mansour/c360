/**
 * Feature-local bilingual label bundle for the Runbook Studio surface — runbook
 * authoring (create / edit / add task), starting a run, and acting on live tasks
 * (complete / skip / fail), plus the copy the `RunbookTaskFlow` design-system
 * component (`@/components/product`) renders.
 *
 * Adopts the foundation bilingual contract (see `_lib/dr-i18n.ts`): the label
 * group is a `DRBilingual<RunbookStudioLabels> = { en, ar }` bundle of two FULL,
 * identically-shaped copies — English in `en` and professional Modern Standard
 * Arabic in `ar`. Every nested object (the embedded `taskFlow` =
 * `RunbookTaskFlowLabels`, the `taskTypes`/`statuses` records keyed by the REAL
 * backend `RunbookTaskType` / `RunbookTaskRunStatus` enums, the `runModes` and
 * `runStatus` records) appears on BOTH sides; interpolation params (`{name}`,
 * `{id}`) and Western digits are preserved. Acronyms (DAG / RTO) are kept and
 * glossed on first natural use in Arabic.
 *
 * The embedded `taskFlow` object is the exact `RunbookTaskFlowLabels` shape the DS
 * component's `labels` prop expects: the studio component reads the resolved
 * bundle via {@link useRunbookStudioLabels} and passes `labels.taskFlow` straight
 * to `<RunbookTaskFlow labels={...} />`. RTL is handled by logical Tailwind props
 * in the components; this file is copy only.
 */

'use client';

import { useMemo } from 'react';
import type { RunbookTaskFlowLabels } from '@/components/product';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface RunbookStudioLabels {
  /** Section heading + supporting copy. */
  title: string;
  description: string;

  /** Create-runbook form. */
  createTriggerLabel: string;
  createDialogTitle: string;
  createDialogDescription: string;
  nameLabel: string;
  namePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  groupLabel: string;
  groupPlaceholder: string;

  /** Add-task form. */
  addTaskTriggerLabel: string;
  addTaskDialogTitle: string;
  addTaskDialogDescription: string;
  taskKeyLabel: string;
  taskKeyPlaceholder: string;
  taskNameLabel: string;
  taskNamePlaceholder: string;
  taskTypeLabel: string;
  ownerLabel: string;
  teamLabel: string;
  instructionsLabel: string;
  plannedDurationLabel: string;
  automationActionLabel: string;
  predecessorsLabel: string;
  predecessorsHint: string;
  requiredLabel: string;

  /** Edit-metadata form. */
  editTriggerLabel: string;
  editDialogTitle: string;
  statusLabel: string;

  /** Run controls. */
  startRunTriggerLabel: string;
  runModeLabel: string;
  /** Run-mode display names, keyed by canonical mode token. */
  runModes: Record<string, string>;
  completeTaskLabel: string;
  skipTaskLabel: string;
  failTaskLabel: string;
  noteLabel: string;
  notePlaceholder: string;
  failRunLabel: string;

  /** Live-run projection strip. */
  runStatusHeading: string;
  /** Run-status display names, keyed by canonical run-status token. */
  runStatus: Record<string, string>;
  frontierHeading: string;
  noFrontier: string;

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

  /** "{name} created" / "{id} started" announcements (screen-reader live region). */
  runbookCreatedAnnouncement: (name: string) => string;
  runStartedAnnouncement: (id: string) => string;

  /** The DS `RunbookTaskFlow` component's `labels` prop (resolved per locale). */
  taskFlow: RunbookTaskFlowLabels;
}

export const runbookStudioLabelBundle: DRBilingual<RunbookStudioLabels> = {
  en: {
    title: 'Runbook Studio',
    description:
      'Author the sequenced recovery runbook — its task DAG, owners, durations, and dependencies — then start a run and drive each task to completion.',

    createTriggerLabel: 'Create runbook',
    createDialogTitle: 'Create a runbook',
    createDialogDescription:
      'Name the runbook and optionally bind it to a protection group; tasks are added next.',
    nameLabel: 'Runbook name',
    namePlaceholder: 'Tier-1 regional failover',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'What this runbook recovers and when it is used.',
    groupLabel: 'Protection group',
    groupPlaceholder: 'Unbound (tenant-wide)',

    addTaskTriggerLabel: 'Add task',
    addTaskDialogTitle: 'Add a runbook task',
    addTaskDialogDescription:
      'Define a task node in the recovery DAG (directed acyclic graph). Predecessors set its place in the sequence.',
    taskKeyLabel: 'Task key',
    taskKeyPlaceholder: 'quiesce-primary-db',
    taskNameLabel: 'Task name',
    taskNamePlaceholder: 'Quiesce primary database',
    taskTypeLabel: 'Task type',
    ownerLabel: 'Owner',
    teamLabel: 'Team',
    instructionsLabel: 'Instructions',
    plannedDurationLabel: 'Planned duration (seconds)',
    automationActionLabel: 'Automation action',
    predecessorsLabel: 'Predecessors',
    predecessorsHint: 'Task keys that must complete before this task is runnable.',
    requiredLabel: 'Required task',

    editTriggerLabel: 'Edit runbook',
    editDialogTitle: 'Edit runbook',
    statusLabel: 'Status',

    startRunTriggerLabel: 'Start run',
    runModeLabel: 'Run mode',
    runModes: {
      drill: 'Drill',
      live: 'Live',
      test: 'Test',
    },
    completeTaskLabel: 'Complete',
    skipTaskLabel: 'Skip',
    failTaskLabel: 'Fail',
    noteLabel: 'Note',
    notePlaceholder: 'Optional note recorded against this task action.',
    failRunLabel: 'Fail the whole run',

    runStatusHeading: 'Run status',
    runStatus: {
      pending: 'Pending',
      running: 'Running',
      completed: 'Completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
    },
    frontierHeading: 'Runnable now',
    noFrontier: 'No tasks are runnable',

    submit: 'Save',
    cancel: 'Cancel',

    emptyTitle: 'No runbook selected',
    emptyDescription:
      'Create a runbook or select one to author its task DAG and start a recovery run.',
    errorTitle: 'Could not load the runbook',
    errorDescription: 'The runbook feed is unavailable. Retry to reload it.',
    retry: 'Retry',
    loading: 'Loading runbook…',

    runbookCreatedAnnouncement: (name) => `Runbook ${name} created.`,
    runStartedAnnouncement: (id) => `Runbook run ${id} started.`,

    taskFlow: {
      listAriaLabel: 'Runbook task flow',
      sequence: 'Step',
      task: 'Task',
      owner: 'Owner',
      team: 'Team',
      action: 'Automation',
      planned: 'Planned',
      actual: 'Actual',
      dependencies: 'Depends on',
      noDependencies: 'No dependencies',
      criticalPath: 'Critical path',
      onCriticalPath: 'on the critical path',
      required: 'Required',
      optional: 'Optional',
      totalTasks: 'Tasks',
      criticalPathDuration: 'Critical-path duration',
      completed: 'Completed',
      projectedFinish: 'Projected finish',
      onTrack: 'On track',
      behindSchedule: 'Behind schedule',
      emptyTitle: 'No tasks yet',
      emptyDescription: 'Add tasks to build the recovery sequence.',
      taskTypes: {
        manual: 'Manual',
        automated: 'Automated',
        approval_gate: 'Approval gate',
        comms: 'Communications',
        milestone: 'Milestone',
      },
      statuses: {
        pending: 'Pending',
        runnable: 'Runnable',
        running: 'Running',
        complete: 'Complete',
        skipped: 'Skipped',
        failed: 'Failed',
        blocked: 'Blocked',
      },
    },
  },
  ar: {
    title: 'استوديو كتيّب الاسترداد',
    description:
      'حرِّر كتيّب الاسترداد المتسلسل — مخطط مهامه الموجّه (DAG) ومالكيها ومُددها وتبعياتها — ثم ابدأ التشغيل وادفع كل مهمة حتى الاكتمال.',

    createTriggerLabel: 'إنشاء كتيّب',
    createDialogTitle: 'إنشاء كتيّب استرداد',
    createDialogDescription:
      'سمِّ الكتيّب واربطه اختياريًا بمجموعة حماية؛ تُضاف المهام بعد ذلك.',
    nameLabel: 'اسم الكتيّب',
    namePlaceholder: 'تجاوز فشل إقليمي للمستوى الأول',
    descriptionLabel: 'الوصف',
    descriptionPlaceholder: 'ما الذي يستعيده هذا الكتيّب ومتى يُستخدم.',
    groupLabel: 'مجموعة الحماية',
    groupPlaceholder: 'غير مرتبط (على مستوى المستأجر)',

    addTaskTriggerLabel: 'إضافة مهمة',
    addTaskDialogTitle: 'إضافة مهمة إلى الكتيّب',
    addTaskDialogDescription:
      'عرِّف عقدة مهمة في مخطط الاسترداد الموجّه اللادوري (DAG). تحدّد المهام السابقة موضعها في التسلسل.',
    taskKeyLabel: 'مفتاح المهمة',
    taskKeyPlaceholder: 'quiesce-primary-db',
    taskNameLabel: 'اسم المهمة',
    taskNamePlaceholder: 'إيقاف نشاط قاعدة البيانات الأساسية',
    taskTypeLabel: 'نوع المهمة',
    ownerLabel: 'المالك',
    teamLabel: 'الفريق',
    instructionsLabel: 'التعليمات',
    plannedDurationLabel: 'المدة المخطّطة (ثوانٍ)',
    automationActionLabel: 'إجراء الأتمتة',
    predecessorsLabel: 'المهام السابقة',
    predecessorsHint: 'مفاتيح المهام التي يجب اكتمالها قبل أن تصبح هذه المهمة قابلة للتشغيل.',
    requiredLabel: 'مهمة إلزامية',

    editTriggerLabel: 'تحرير الكتيّب',
    editDialogTitle: 'تحرير الكتيّب',
    statusLabel: 'الحالة',

    startRunTriggerLabel: 'بدء التشغيل',
    runModeLabel: 'نمط التشغيل',
    runModes: {
      drill: 'تمرين',
      live: 'فعلي',
      test: 'اختبار',
    },
    completeTaskLabel: 'إكمال',
    skipTaskLabel: 'تخطّي',
    failTaskLabel: 'تعليم كفاشلة',
    noteLabel: 'ملاحظة',
    notePlaceholder: 'ملاحظة اختيارية تُسجَّل مع هذا الإجراء على المهمة.',
    failRunLabel: 'إفشال التشغيل بأكمله',

    runStatusHeading: 'حالة التشغيل',
    runStatus: {
      pending: 'معلّق',
      running: 'قيد التشغيل',
      completed: 'مكتمل',
      failed: 'فشل',
      cancelled: 'ملغى',
    },
    frontierHeading: 'قابلة للتشغيل الآن',
    noFrontier: 'لا توجد مهام قابلة للتشغيل',

    submit: 'حفظ',
    cancel: 'إلغاء',

    emptyTitle: 'لم يُحدَّد كتيّب',
    emptyDescription:
      'أنشئ كتيّبًا أو اختر أحدها لتحرير مخطط مهامه (DAG) وبدء عملية استرداد.',
    errorTitle: 'تعذّر تحميل الكتيّب',
    errorDescription: 'موجز الكتيّب غير متاح. أعد المحاولة لإعادة تحميله.',
    retry: 'إعادة المحاولة',
    loading: 'جارٍ تحميل الكتيّب…',

    runbookCreatedAnnouncement: (name) => `تم إنشاء الكتيّب ${name}.`,
    runStartedAnnouncement: (id) => `بدأ تشغيل الكتيّب ${id}.`,

    taskFlow: {
      listAriaLabel: 'مسار مهام الكتيّب',
      sequence: 'الخطوة',
      task: 'المهمة',
      owner: 'المالك',
      team: 'الفريق',
      action: 'الأتمتة',
      planned: 'المخطّط',
      actual: 'الفعلي',
      dependencies: 'تعتمد على',
      noDependencies: 'لا توجد تبعيات',
      criticalPath: 'المسار الحرج',
      onCriticalPath: 'على المسار الحرج',
      required: 'إلزامية',
      optional: 'اختيارية',
      totalTasks: 'المهام',
      criticalPathDuration: 'مدة المسار الحرج',
      completed: 'المكتملة',
      projectedFinish: 'وقت الانتهاء المتوقّع',
      onTrack: 'ضمن المسار',
      behindSchedule: 'متأخّر عن الجدول',
      emptyTitle: 'لا توجد مهام بعد',
      emptyDescription: 'أضِف مهامًا لبناء تسلسل الاسترداد.',
      taskTypes: {
        manual: 'يدوية',
        automated: 'مؤتمتة',
        approval_gate: 'بوابة موافقة',
        comms: 'اتصالات',
        milestone: 'محطة رئيسية',
      },
      statuses: {
        pending: 'معلّقة',
        runnable: 'قابلة للتشغيل',
        running: 'قيد التشغيل',
        complete: 'مكتملة',
        skipped: 'متخطّاة',
        failed: 'فاشلة',
        blocked: 'محجوبة',
      },
    },
  },
};

/** English surface, exported for non-React callers and as the default resolution. */
export const runbookStudioLabels: RunbookStudioLabels = runbookStudioLabelBundle.en;

/**
 * useRunbookStudioLabels resolves the Runbook Studio labels against the active
 * locale (English fallback / default), mirroring the shared `useDRLabels` hook.
 * Pass `labels.taskFlow` straight to the DS `<RunbookTaskFlow labels={...} />`.
 */
export function useRunbookStudioLabels(): RunbookStudioLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(runbookStudioLabelBundle, locale), [locale]);
}
