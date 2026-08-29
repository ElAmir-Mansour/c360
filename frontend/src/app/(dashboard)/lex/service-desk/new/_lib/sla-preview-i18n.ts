/**
 * Bilingual labels for the SlaPromisePreview component (improvement #4: live SLA
 * promise preview). EN is the default surface; AR is professional Modern
 * Standard Arabic.
 *
 * Resolve via the established sibling pattern:
 *   const { locale } = useLocaleOrDefault();
 *   const t = locale === 'ar' ? slaPreviewLabels.ar : slaPreviewLabels.en;
 *
 * Unit strings are keyed by the backend `SLAAckUnit` so the acknowledgement
 * line reads naturally in both languages (and pluralises in English).
 */
export interface SlaPreviewLabels {
  /** Panel heading. */
  panelTitle: string;
  /** Acknowledgement line; receives the formatted "{value} {unit}" window. */
  acknowledgedWithin: (window: string) => string;
  /**
   * Turnaround line; receives the From–To working-day window and the formatted
   * upper-bound date. When `fromDays === toDays` it reads as a single figure.
   */
  resolvedWithin: (fromDays: number, toDays: number, by: string) => string;
  /** Small escalation hint heading. */
  escalationLabel: string;
  /** Renders a single escalation tier, e.g. "L1 · day 1". */
  escalationTier: (level: 1 | 2 | 3, day: number) => string;
  /** Approximation disclaimer; the working calendar is authoritative. */
  approximateNote: string;
  /** Priority chip text. */
  priorityUrgent: string;
  priorityNormal: string;
  priorityEmergency: string;
  /** Informational state shown when no service is selected yet. */
  selectServiceTitle: string;
  selectServiceBody: string;
  /** Informational state shown when the selected service has no SLA target. */
  noTargetTitle: string;
  noTargetBody: (priority: string) => string;
  noTargetOwner: string;
  /** Informational state shown when the SLA target lookup is unavailable. */
  previewUnavailableTitle: string;
  previewUnavailableBody: string;
  /** Acknowledgement-window unit renderers (value-aware for EN plurals). */
  unitWorkingDays: (value: number) => string;
  unitWorkingHours: (value: number) => string;
}

export const slaPreviewLabels: { en: SlaPreviewLabels; ar: SlaPreviewLabels } = {
  en: {
    panelTitle: 'Service-level promise',
    acknowledgedWithin: (window) => `Acknowledged within ${window}`,
    resolvedWithin: (fromDays, toDays, by) =>
      fromDays === toDays
        ? `Resolved within ${toDays} working ${toDays === 1 ? 'day' : 'days'} · by ~${by}`
        : `Resolved within ${fromDays}–${toDays} working days · by ~${by}`,
    escalationLabel: 'Escalation',
    escalationTier: (level, day) => `L${level} · day ${day}`,
    approximateNote: 'Dates are approximate; the working calendar is authoritative.',
    priorityUrgent: 'Urgent',
    priorityNormal: 'Normal',
    priorityEmergency: 'Emergency',
    selectServiceTitle: 'Choose a service to preview timing',
    selectServiceBody:
      'The SLA preview appears after the selected service and priority match an active target.',
    noTargetTitle: 'Timeline will be confirmed after intake',
    noTargetBody: (priority) =>
      `This service has no active ${priority.toLowerCase()} SLA target. The legal team will confirm acknowledgement and turnaround after review.`,
    noTargetOwner: 'Legal Operations owns SLA target configuration.',
    previewUnavailableTitle: 'SLA preview is unavailable',
    previewUnavailableBody:
      'The legal team will confirm acknowledgement and turnaround after intake.',
    unitWorkingDays: (value) => `${value} working ${value === 1 ? 'day' : 'days'}`,
    unitWorkingHours: (value) => `${value} working ${value === 1 ? 'hour' : 'hours'}`,
  },
  ar: {
    panelTitle: 'التزام مستوى الخدمة',
    acknowledgedWithin: (window) => `الإقرار خلال ${window}`,
    resolvedWithin: (fromDays, toDays, by) =>
      fromDays === toDays
        ? `الإنجاز خلال ${toDays} يوم عمل · بحلول ~${by} تقريبًا`
        : `الإنجاز خلال ${fromDays}–${toDays} يوم عمل · بحلول ~${by} تقريبًا`,
    escalationLabel: 'التصعيد',
    escalationTier: (level, day) => `المستوى ${level} · اليوم ${day}`,
    approximateNote: 'التواريخ تقريبية؛ تقويم العمل هو المرجع المعتمد.',
    priorityUrgent: 'عاجل',
    priorityNormal: 'عادي',
    priorityEmergency: 'طارئ',
    selectServiceTitle: 'اختر خدمة لمعاينة المدة المتوقعة',
    selectServiceBody:
      'تظهر معاينة اتفاقية مستوى الخدمة بعد مطابقة الخدمة والأولوية المحددتين مع هدف نشط.',
    noTargetTitle: 'سيتم تأكيد المدة بعد استلام الطلب',
    noTargetBody: (priority) =>
      `لا يوجد هدف نشط لاتفاقية مستوى الخدمة بأولوية ${priority} لهذه الخدمة. سيؤكد فريق الشؤون القانونية مدة الإقرار والإنجاز بعد المراجعة.`,
    noTargetOwner: 'تتولى عمليات الشؤون القانونية تهيئة أهداف اتفاقية مستوى الخدمة.',
    previewUnavailableTitle: 'معاينة اتفاقية مستوى الخدمة غير متاحة',
    previewUnavailableBody:
      'سيؤكد فريق الشؤون القانونية مدة الإقرار والإنجاز بعد استلام الطلب.',
    unitWorkingDays: (value) => `${value} يوم عمل`,
    unitWorkingHours: (value) => `${value} ساعة عمل`,
  },
};
