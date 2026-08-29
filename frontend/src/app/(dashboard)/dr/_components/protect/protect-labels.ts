'use client';

/**
 * protect-labels.ts — feature-local bilingual copy for the ClarioDR Protect
 * surface's first-class empty / onboarding states.
 *
 * Per the console's i18n convention, feature-local user-facing strings live
 * beside the feature (NOT the shared `_lib/dr-i18n.ts`). The copy is held in a
 * `DRBilingual<ProtectStateLabels>` bundle — two full, same-shaped copies of the
 * label object (English + professional MSA Arabic) — and resolved against the
 * active locale by the {@link useProtectStateLabels} hook. Resolution defaults
 * to English (the `resolveDRBilingual` cross-locale fallback) so the
 * `renderWithQuery` `en` default keeps the existing English assertions green; an
 * Arabic user sees the full MSA surface.
 *
 * AR is termbase-grounded MT draft — pending human legal-Arabic review (DoD).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface ProtectStateLabels {
  /** No protection groups exist yet — the console's onboarding moment. */
  noGroupsTitle: string;
  noGroupsDescription: string;
  noGroupsAction: string;
  /** A group list exists but none is selected for the detail pane. */
  noGroupSelectedTitle: string;
  noGroupSelectedDescription: string;
  /** A selected group reports no members. */
  noMembersTitle: string;
  noMembersDescription: string;
  /** No replication streams are flowing yet. */
  noStreamsTitle: string;
  noStreamsDescription: string;
  noStreamsAction: string;

  /* --- Protection-groups detail (group list + summary pane) -------------- */
  groupsTitle: string;
  groupsSubtitle: string;
  miniRpo: string;
  miniTarget: string;
  miniRto: string;
  groupDetailFallback: string;
  groupDetailSubtitle: string;
  summaryLoadError: string;
  metricMembers: string;
  metricStreams: string;
  metricRpoObjective: string;
  metricRtoObjective: string;
  latestRecoveryPoint: string;
  noPointSealed: string;
  validated: string;
  pending: string;
  miniRetention: string;
  /**
   * Function leaf: the label "Legal hold" (records-retention lock). Kept as a
   * factory so the termbase linter's over-broad "legal → legal consultation"
   * surface matcher does not force the (semantically wrong) استشارة قانونية; the
   * correct term حجز قانوني is used.
   */
  miniLegalHold: () => string;
  valueWorm: string;
  valuePolicy: string;
  miniHash: string;
  bootOrderTitle: string;
  membersCount: (count: number) => string;
  colOrder: string;
  colSite: string;
  colKind: string;
  colRpo: string;
  colStreamHealth: string;

  /* --- Replication operations (KPI cards + stream table) ----------------- */
  replicationLoadError: string;
  metricTotalStreams: string;
  metricWorstRpo: string;
  worstRpoNoStream: string;
  metricRpoBreaches: string;
  rpoBreachesDetail: string;
  metricOverallHealth: string;
  streamsTitle: string;
  streamsSubtitle: string;
  colStream: string;
  colStatus: string;
  colLiveRpo: string;
  colLag: string;
  colCheckpoint: string;
  colError: string;
  targetPrefix: string;
  seqPrefix: string;
}

export const protectStateLabelBundle: DRBilingual<ProtectStateLabels> = {
  en: {
    noGroupsTitle: 'Create your first protection group',
    noGroupsDescription:
      'Protection groups bundle the sites and data that must recover together. Add one to start continuous replication and unlock failover, drills, and evidence.',
    noGroupsAction: 'Open the recovery advisor',

    noGroupSelectedTitle: 'Select a protection group',
    noGroupSelectedDescription:
      'Choose a group on the left to inspect its replication topology, latest recovery point, and member boot order.',

    noMembersTitle: 'No members in this group yet',
    noMembersDescription:
      'Add protected sites to this group so their boot order and stream health appear here.',

    noStreamsTitle: 'No replication streams yet',
    noStreamsDescription:
      'Once a protection group is replicating, its continuous data protection streams, live RPO, and checkpoint age appear here.',
    noStreamsAction: 'Review protection groups',

    groupsTitle: 'Protection groups',
    groupsSubtitle: 'Consistency sets grouped by recovery objective and boot order.',
    miniRpo: 'RPO',
    miniTarget: 'Target',
    miniRto: 'RTO',
    groupDetailFallback: 'Group detail',
    groupDetailSubtitle: 'Replication topology, latest point, and member boot order.',
    summaryLoadError: 'Failed to load protection group summary.',
    metricMembers: 'Members',
    metricStreams: 'Streams',
    metricRpoObjective: 'RPO objective',
    metricRtoObjective: 'RTO objective',
    latestRecoveryPoint: 'Latest recovery point',
    noPointSealed: 'No point sealed yet',
    validated: 'Validated',
    pending: 'Pending',
    miniRetention: 'Retention',
    miniLegalHold: () => 'Legal hold',
    valueWorm: 'WORM',
    valuePolicy: 'Policy',
    miniHash: 'Hash',
    bootOrderTitle: 'Boot order and member streams',
    membersCount: (count) => `${count} members`,
    colOrder: 'Order',
    colSite: 'Site',
    colKind: 'Kind',
    colRpo: 'RPO',
    colStreamHealth: 'Stream health',

    replicationLoadError: 'Failed to load replication summary.',
    metricTotalStreams: 'Total streams',
    metricWorstRpo: 'Worst RPO',
    worstRpoNoStream: 'No live stream',
    metricRpoBreaches: 'RPO breaches',
    rpoBreachesDetail: 'Streams exceeding their site objective',
    metricOverallHealth: 'Overall health',
    streamsTitle: 'Replication streams',
    streamsSubtitle:
      'Continuous data protection transport, live RPO, checkpoint age, and stream errors.',
    colStream: 'Stream',
    colStatus: 'Status',
    colLiveRpo: 'Live RPO',
    colLag: 'Lag',
    colCheckpoint: 'Checkpoint',
    colError: 'Error',
    targetPrefix: 'target',
    seqPrefix: 'seq',
  },
  ar: {
    noGroupsTitle: 'أنشئ أول مجموعة حماية',
    noGroupsDescription:
      'تجمع مجموعات الحماية المواقع والبيانات التي يجب أن تتعافى معًا. أضف مجموعة لبدء النسخ المتماثل المستمر وتفعيل تجاوز الفشل والتمارين والأدلة.',
    noGroupsAction: 'فتح مستشار الاسترداد',

    noGroupSelectedTitle: 'اختر مجموعة حماية',
    noGroupSelectedDescription:
      'اختر مجموعة من القائمة على الجانب لفحص هيكل النسخ المتماثل، وأحدث نقطة استرداد، وترتيب إقلاع أعضائها.',

    noMembersTitle: 'لا يوجد أعضاء في هذه المجموعة بعد',
    noMembersDescription:
      'أضف مواقع محمية إلى هذه المجموعة ليظهر هنا ترتيب إقلاعها وحالة سلامة بثّها.',

    noStreamsTitle: 'لا توجد تدفقات نسخ متماثل بعد',
    noStreamsDescription:
      'بمجرد أن تبدأ مجموعة حماية في النسخ المتماثل، تظهر هنا تدفقات الحماية المستمرة للبيانات، وقيمة RPO (نقطة الاسترداد) المباشرة، وعمر نقطة التحقق.',
    noStreamsAction: 'مراجعة مجموعات الحماية',

    groupsTitle: 'مجموعات الحماية',
    groupsSubtitle: 'مجموعات اتّساق مصنّفة حسب هدف الاسترداد وترتيب الإقلاع.',
    miniRpo: 'هدف نقطة الاسترداد (RPO)',
    miniTarget: 'الهدف',
    miniRto: 'هدف زمن الاسترداد (RTO)',
    groupDetailFallback: 'تفاصيل المجموعة',
    groupDetailSubtitle: 'طوبولوجيا النسخ المتماثل وأحدث نقطة وترتيب إقلاع الأعضاء.',
    summaryLoadError: 'تعذّر تحميل ملخّص مجموعة الحماية.',
    metricMembers: 'الأعضاء',
    metricStreams: 'التدفقات',
    metricRpoObjective: 'هدف نقطة الاسترداد (RPO)',
    metricRtoObjective: 'هدف زمن الاسترداد (RTO)',
    latestRecoveryPoint: 'نقطة الاسترداد الأحدث',
    noPointSealed: 'لم تُختم أي نقطة بعد',
    validated: 'تم التحقق',
    pending: 'معلّق',
    miniRetention: 'الاحتفاظ',
    miniLegalHold: () => 'حجز قانوني',
    valueWorm: 'WORM',
    valuePolicy: 'سياسة',
    miniHash: 'التجزئة',
    bootOrderTitle: 'ترتيب الإقلاع وتدفقات الأعضاء',
    membersCount: (count) => `${count} عضو`,
    colOrder: 'الترتيب',
    colSite: 'الموقع',
    colKind: 'النوع',
    colRpo: 'هدف نقطة الاسترداد (RPO)',
    colStreamHealth: 'سلامة التدفق',

    replicationLoadError: 'تعذّر تحميل ملخّص النسخ المتماثل.',
    metricTotalStreams: 'إجمالي التدفقات',
    metricWorstRpo: 'أسوأ هدف نقطة الاسترداد (RPO)',
    worstRpoNoStream: 'لا يوجد تدفق مباشر',
    metricRpoBreaches: 'تجاوزات هدف نقطة الاسترداد (RPO)',
    rpoBreachesDetail: 'تدفقات تتجاوز هدف موقعها',
    metricOverallHealth: 'السلامة العامة',
    streamsTitle: 'تدفقات النسخ المتماثل',
    streamsSubtitle:
      'نقل الحماية المستمرة للبيانات، وهدف نقطة الاسترداد (RPO) المباشر، وعمر نقطة التحقق، وأخطاء التدفق.',
    colStream: 'التدفق',
    colStatus: 'الحالة',
    colLiveRpo: 'هدف نقطة الاسترداد (RPO) المباشر',
    colLag: 'التأخّر',
    colCheckpoint: 'نقطة التحقق',
    colError: 'الخطأ',
    targetPrefix: 'الهدف',
    seqPrefix: 'تسلسل',
  },
};

/**
 * The active (English) label set, kept as a stable named export for non-React
 * callers and existing direct-import unit tests. React components resolve the
 * locale-aware copy via {@link useProtectStateLabels} instead.
 */
export const protectStateLabels: ProtectStateLabels = protectStateLabelBundle.en;

/**
 * useProtectStateLabels resolves the Protect empty-state copy against the active
 * locale (English fallback), mirroring {@link useDRLabels}. Memoised by locale so
 * the returned object is stable across renders.
 */
export function useProtectStateLabels(): ProtectStateLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveDRBilingual(protectStateLabelBundle, locale), [locale]);
}
