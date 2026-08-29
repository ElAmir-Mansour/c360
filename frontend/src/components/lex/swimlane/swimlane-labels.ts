/**
 * Bilingual (English + Modern Standard Arabic) copy for the read-only PRD
 * swimlane visualization (Diagram A / Diagram B).
 *
 * Follows the canonical lex i18n contract (`lex/_lib/lex-i18n`): a
 * `LexBilingual<T> = { en, ar }` bundle with two FULL same-shaped copies,
 * resolved per locale by {@link useSwimlaneLabels}. The Arabic lane titles for
 * Diagram B mirror the seeded approval-policy labels verbatim
 * (مدير الإدارة الطالبة / الرئيس التنفيذي للقطاع / مدير الإدارة القانونية) so the
 * graphical chain reads identically to the live gate.
 */

import { type LexBilingual } from '@/app/(dashboard)/lex/_lib/lex-i18n';
import type { LaneLabelKey, StageLabelKey } from './diagram-models';

export interface SwimlaneLabels {
  /** Card header shown above the canvas, per diagram. */
  diagramTitle: { A: string; B: string };
  diagramSubtitle: { A: string; B: string };
  laneHeading: string;
  lanes: Record<LaneLabelKey, string>;
  stages: Record<StageLabelKey, string>;
  legend: {
    heading: string;
    done: string;
    current: string;
    future: string;
    offpath: string;
  };
  terminal: {
    returned: string;
    cancelled: string;
    hint: string;
  };
  /** Accessible label for the whole diagram region. */
  ariaDiagram: string;
}

export const swimlaneLabels: LexBilingual<SwimlaneLabels> = {
  en: {
    diagramTitle: {
      A: 'Service request workflow',
      B: 'Lawsuit filing workflow',
    },
    diagramSubtitle: {
      A: 'Requester and legal provider swimlanes, with the live position highlighted.',
      B: 'Sequential filing approval chain — Department Manager, Executive Manager for the Group, then Legal Department Manager.',
    },
    laneHeading: 'Lane',
    lanes: {
      requester: 'Requester',
      provider: 'Legal provider',
      deptManager: 'Department Manager',
      execManager: 'Executive Manager for the Group',
      legalManager: 'Legal Department Manager',
    },
    stages: {
      draft: 'Draft',
      submitted: 'Submitted',
      providerApproval: 'Approval',
      approved: 'Approved',
      routed: 'Routed',
      inExecution: 'In execution',
      delivered: 'Delivered',
      closed: 'Closed',
      fileRequest: 'File request',
      deptReview: 'Department review',
      execReview: 'Executive review',
      legalReview: 'Legal review',
      filed: 'Lawsuit filed',
    },
    legend: {
      heading: 'Legend',
      done: 'Completed',
      current: 'Current position',
      future: 'Upcoming',
      offpath: 'Off the main path',
    },
    terminal: {
      returned: 'Returned',
      cancelled: 'Cancelled',
      hint: 'This request left the main workflow, so no stage is currently active.',
    },
    ariaDiagram: 'Read-only workflow swimlane diagram',
  },
  ar: {
    diagramTitle: {
      A: 'سير عمل طلب الخدمة',
      B: 'سير عمل رفع الدعوى القضائية',
    },
    diagramSubtitle: {
      A: 'مسارات مقدّم الطلب ومقدّم الخدمة القانونية، مع إبراز الموضع الحالي.',
      B: 'سلسلة اعتماد تسلسلية لرفع الدعوى — مدير الإدارة الطالبة، ثم الرئيس التنفيذي للقطاع، ثم مدير الإدارة القانونية.',
    },
    laneHeading: 'المسار',
    lanes: {
      requester: 'مقدّم الطلب',
      provider: 'مقدّم الخدمة القانونية',
      deptManager: 'مدير الإدارة الطالبة',
      execManager: 'الرئيس التنفيذي للقطاع',
      legalManager: 'مدير الإدارة القانونية',
    },
    stages: {
      draft: 'مسوّدة',
      submitted: 'مُقدّم',
      providerApproval: 'الموافقة',
      approved: 'معتمد',
      routed: 'مُوجَّه',
      inExecution: 'قيد التنفيذ',
      delivered: 'تم التسليم',
      closed: 'مغلق',
      fileRequest: 'تقديم الطلب',
      deptReview: 'مراجعة الإدارة الطالبة',
      execReview: 'مراجعة الرئيس التنفيذي',
      legalReview: 'المراجعة القانونية',
      filed: 'تم قيد الدعوى',
    },
    legend: {
      heading: 'مفتاح الرموز',
      done: 'مكتمل',
      current: 'الموضع الحالي',
      future: 'قادم',
      offpath: 'خارج المسار الرئيسي',
    },
    terminal: {
      returned: 'مُعاد',
      cancelled: 'مُلغى',
      hint: 'خرج هذا الطلب من سير العمل الرئيسي، لذا لا توجد مرحلة نشطة حاليًا.',
    },
    ariaDiagram: 'مخطط مسارات سير العمل للاطّلاع فقط',
  },
};
