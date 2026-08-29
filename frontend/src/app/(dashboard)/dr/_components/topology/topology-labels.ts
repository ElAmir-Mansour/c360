/**
 * Feature-local bilingual label bundle for the recovery-topology surface — the
 * add-edge authoring form, the ranked failover-target panel, and the copy the
 * `NodeMap` design-system component (`@/components/product`, fed by
 * `topologyToGraph`) renders.
 *
 * Adopts the foundation bilingual contract (see `_lib/dr-i18n.ts`): the label
 * group is a `DRBilingual<TopologyLabels> = { en, ar }` bundle of two FULL,
 * identically-shaped copies — English in `en` and professional Modern Standard
 * Arabic in `ar`. The embedded `nodeMap` object is the exact `NodeMapLabels`
 * shape the DS component's `labels` prop expects (including the function-valued
 * `textAlternativeSummary(nodeCount, edgeCount)` and the nested `kinds` record),
 * present on BOTH sides with the same signatures; the topology-authoring copy
 * and the failover-candidate `health` record sit alongside it. Interpolation
 * params and Western digits (IP / CIDR) are preserved across both locales;
 * acronyms (RTO/RPO/DAG) are kept and glossed in Arabic.
 *
 * The topology component reads the resolved bundle via {@link useTopologyLabels}
 * and passes `labels.nodeMap` straight to `<NodeMap labels={...} />` (pairing it
 * with a locale-bound `statusLabel` from the shared `makeDRStatusLabel`). RTL is
 * handled by logical Tailwind props in the components; this file is copy only.
 */

'use client';

import { useMemo } from 'react';
import type { NodeMapLabels } from '@/components/product';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface TopologyLabels {
  /** Section heading + supporting copy. */
  title: string;
  description: string;

  /** Add-edge authoring form. */
  addEdgeTriggerLabel: string;
  addEdgeDialogTitle: string;
  addEdgeDialogDescription: string;
  fromSiteLabel: string;
  fromSitePlaceholder: string;
  toSiteLabel: string;
  toSitePlaceholder: string;
  fromRoleLabel: string;
  toRoleLabel: string;
  streamLabel: string;
  streamPlaceholder: string;
  modeLabel: string;
  priorityLabel: string;
  priorityHint: string;

  /** Site-role display names, keyed by canonical role token. */
  roles: Record<string, string>;
  /** Replication-mode display names, keyed by canonical mode token. */
  modes: Record<string, string>;

  /** Failover-target ranking panel. */
  failoverTargetHeading: string;
  selectedTargetLabel: string;
  rankingHeading: string;
  candidateEligible: string;
  candidateIneligible: string;
  candidateReasonLabel: string;
  lagLabel: string;
  priorityColumn: string;
  noFailoverTarget: string;
  /** Candidate-health display names, keyed by canonical health token. */
  health: Record<string, string>;

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

  /** "Edge from {from} to {to} added" announcement (screen-reader live region). */
  edgeAddedAnnouncement: (from: string, to: string) => string;

  /** The DS `NodeMap` component's `labels` prop (resolved per locale). */
  nodeMap: NodeMapLabels;
}

export const topologyLabelBundle: DRBilingual<TopologyLabels> = {
  en: {
    title: 'Recovery topology',
    description:
      'The directed graph of protected sites and their replication edges — author the failover relationships that drive the recovery sequence.',

    addEdgeTriggerLabel: 'Add edge',
    addEdgeDialogTitle: 'Add a topology edge',
    addEdgeDialogDescription:
      'Connect a source site to a recovery site over a replication stream. Priority orders competing failover targets.',
    fromSiteLabel: 'From site',
    fromSitePlaceholder: 'Select the source site',
    toSiteLabel: 'To site',
    toSitePlaceholder: 'Select the recovery site',
    fromRoleLabel: 'Source role',
    toRoleLabel: 'Target role',
    streamLabel: 'Replication stream',
    streamPlaceholder: 'Select the stream',
    modeLabel: 'Replication mode',
    priorityLabel: 'Priority',
    priorityHint: 'Lower numbers are preferred when ranking failover targets.',

    roles: {
      primary: 'Primary',
      standby: 'Standby',
      recovery: 'Recovery',
    },
    modes: {
      sync: 'Synchronous',
      async: 'Asynchronous',
    },

    failoverTargetHeading: 'Failover target',
    selectedTargetLabel: 'Selected target',
    rankingHeading: 'Candidate ranking',
    candidateEligible: 'Eligible',
    candidateIneligible: 'Ineligible',
    candidateReasonLabel: 'Reason',
    lagLabel: 'Apply lag',
    priorityColumn: 'Priority',
    noFailoverTarget: 'No eligible failover target',
    health: {
      healthy: 'Healthy',
      warning: 'Watch',
      critical: 'Critical',
      paused: 'Paused',
      streaming: 'Streaming',
      degraded: 'Degraded',
      error: 'Error',
    },

    submit: 'Add edge',
    cancel: 'Cancel',

    emptyTitle: 'No topology yet',
    emptyDescription:
      'Add a topology edge to connect protected sites and visualise the recovery graph.',
    errorTitle: 'Could not load topology',
    errorDescription: 'The topology feed is unavailable. Retry to reload the graph.',
    retry: 'Retry',
    loading: 'Loading topology…',

    edgeAddedAnnouncement: (from, to) => `Topology edge from ${from} to ${to} added.`,

    nodeMap: {
      figureAriaLabel: 'Recovery topology node map',
      diagramAriaLabel: 'Recovery topology diagram (scrollable)',
      textAlternativeHeading: 'Recovery topology — node detail',
      textAlternativeSummary: (nodeCount, edgeCount) =>
        `${nodeCount} sites connected by ${edgeCount} replication edges. The longest dependency chain is the critical path.`,
      node: 'Site',
      kind: 'Type',
      status: 'Role',
      dependsOn: 'Replicates from',
      criticalPath: 'Critical path',
      criticalPathHeading: 'Critical path (longest dependency chain)',
      onCriticalPath: 'on the critical path',
      yes: 'Yes',
      no: 'No',
      none: 'None',
      kinds: {
        site: 'Site',
        service: 'Service',
        task: 'Task',
      },
      emptyTitle: 'No sites to map',
      emptyDescription: 'Add topology edges to visualise the recovery graph.',
    },
  },
  ar: {
    title: 'طوبولوجيا الاسترداد',
    description:
      'المخطط الموجّه للمواقع المحمية وروابط النسخ المتماثل بينها — حرِّر علاقات تجاوز الفشل التي تقود تسلسل الاسترداد.',

    addEdgeTriggerLabel: 'إضافة رابط',
    addEdgeDialogTitle: 'إضافة رابط طوبولوجي',
    addEdgeDialogDescription:
      'اربط موقعًا مصدريًا بموقع استرداد عبر تدفّق نسخ متماثل. تُرتِّب الأولوية أهداف تجاوز الفشل المتنافسة.',
    fromSiteLabel: 'من الموقع',
    fromSitePlaceholder: 'اختر الموقع المصدر',
    toSiteLabel: 'إلى الموقع',
    toSitePlaceholder: 'اختر موقع الاسترداد',
    fromRoleLabel: 'دور المصدر',
    toRoleLabel: 'دور الهدف',
    streamLabel: 'تدفّق النسخ المتماثل',
    streamPlaceholder: 'اختر التدفّق',
    modeLabel: 'نمط النسخ المتماثل',
    priorityLabel: 'الأولوية',
    priorityHint: 'الأرقام الأصغر مُفضَّلة عند ترتيب أهداف تجاوز الفشل.',

    roles: {
      primary: 'أساسي',
      standby: 'احتياطي',
      recovery: 'استرداد',
    },
    modes: {
      sync: 'متزامن',
      async: 'غير متزامن',
    },

    failoverTargetHeading: 'هدف تجاوز الفشل',
    selectedTargetLabel: 'الهدف المختار',
    rankingHeading: 'ترتيب المرشّحين',
    candidateEligible: 'مؤهَّل',
    candidateIneligible: 'غير مؤهَّل',
    candidateReasonLabel: 'السبب',
    lagLabel: 'تأخّر التطبيق',
    priorityColumn: 'الأولوية',
    noFailoverTarget: 'لا يوجد هدف تجاوز فشل مؤهَّل',
    health: {
      healthy: 'سليم',
      warning: 'تحت المراقبة',
      critical: 'حرج',
      paused: 'متوقف مؤقتًا',
      streaming: 'قيد البث',
      degraded: 'متدهور',
      error: 'خطأ',
    },

    submit: 'إضافة رابط',
    cancel: 'إلغاء',

    emptyTitle: 'لا توجد طوبولوجيا بعد',
    emptyDescription:
      'أضِف رابطًا طوبولوجيًا لربط المواقع المحمية وتصوّر مخطط الاسترداد.',
    errorTitle: 'تعذّر تحميل الطوبولوجيا',
    errorDescription: 'موجز الطوبولوجيا غير متاح. أعد المحاولة لإعادة تحميل المخطط.',
    retry: 'إعادة المحاولة',
    loading: 'جارٍ تحميل الطوبولوجيا…',

    edgeAddedAnnouncement: (from, to) => `تمت إضافة رابط طوبولوجي من ${from} إلى ${to}.`,

    nodeMap: {
      figureAriaLabel: 'خريطة عُقد طوبولوجيا الاسترداد',
      diagramAriaLabel: 'مخطط طوبولوجيا الاسترداد (قابل للتمرير)',
      textAlternativeHeading: 'طوبولوجيا الاسترداد — تفاصيل العُقد',
      textAlternativeSummary: (nodeCount, edgeCount) =>
        `${nodeCount} موقعًا مترابطًا عبر ${edgeCount} رابط نسخ متماثل. أطول سلسلة تبعية تمثّل المسار الحرج.`,
      node: 'الموقع',
      kind: 'النوع',
      status: 'الدور',
      dependsOn: 'يُنسَخ من',
      criticalPath: 'المسار الحرج',
      criticalPathHeading: 'المسار الحرج (أطول سلسلة تبعية)',
      onCriticalPath: 'على المسار الحرج',
      yes: 'نعم',
      no: 'لا',
      none: 'لا شيء',
      kinds: {
        site: 'موقع',
        service: 'خدمة',
        task: 'مهمة',
      },
      emptyTitle: 'لا توجد مواقع لرسمها',
      emptyDescription: 'أضِف روابط طوبولوجية لتصوّر مخطط الاسترداد.',
    },
  },
};

/** English surface, exported for non-React callers and as the default resolution. */
export const topologyLabels: TopologyLabels = topologyLabelBundle.en;

/**
 * useTopologyLabels resolves the topology labels against the active locale
 * (English fallback / default), mirroring the shared `useDRLabels` hook. Pass
 * `labels.nodeMap` straight to the DS `<NodeMap labels={...} />`.
 */
export function useTopologyLabels(): TopologyLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(topologyLabelBundle, locale), [locale]);
}
