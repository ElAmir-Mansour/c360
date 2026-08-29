/**
 * Bilingual (EN / AR — MSA) label catalog for the org-entity change-history
 * timeline. Default surface language is English; Arabic strings are provided for
 * RTL rendering.
 *
 * Each label is a `{ en, ar }` pair. Resolve one with the `tt` helper:
 *
 *   const { locale } = useLocaleOrDefault();
 *   const lang = locale === 'ar' ? 'ar' : 'en';
 *   tt(auditLabels.title, lang);
 */
import type { OrgAuditEvent } from './org-audit-api';

export type Lang = 'en' | 'ar';

export interface BilingualText {
  en: string;
  ar: string;
}

/** Resolve a bilingual pair for the active language (defaults to EN). */
export function tt(text: BilingualText, lang: Lang): string {
  return lang === 'ar' ? text.ar : text.en;
}

export const auditLabels = {
  title: { en: 'Change history', ar: 'سجل التغييرات' },
  description: {
    en: 'Audit timeline across all organizational entities.',
    ar: 'الجدول الزمني للتدقيق عبر جميع الكيانات التنظيمية.',
  },
  descriptionEntity: {
    en: 'Audit timeline for this entity.',
    ar: 'الجدول الزمني للتدقيق لهذا الكيان.',
  },
  loading: { en: 'Loading change history…', ar: 'جارٍ تحميل سجل التغييرات…' },
  emptyTitle: { en: 'No changes recorded', ar: 'لا توجد تغييرات مسجلة' },
  emptyDescription: {
    en: 'Audit events will appear here as entities are created, updated, or reorganized.',
    ar: 'ستظهر أحداث التدقيق هنا عند إنشاء الكيانات أو تحديثها أو إعادة تنظيمها.',
  },
  localOnlyNotice: {
    en: 'Showing locally captured snapshots — the audit service is unavailable.',
    ar: 'يتم عرض اللقطات المحفوظة محليًا — خدمة التدقيق غير متاحة.',
  },
  expand: { en: 'Show changes', ar: 'عرض التغييرات' },
  collapse: { en: 'Hide changes', ar: 'إخفاء التغييرات' },
  system: { en: 'System', ar: 'النظام' },
  today: { en: 'Today', ar: 'اليوم' },
  yesterday: { en: 'Yesterday', ar: 'الأمس' },
  field: { en: 'Field', ar: 'الحقل' },
  oldValue: { en: 'Before', ar: 'قبل' },
  newValue: { en: 'After', ar: 'بعد' },
  noChanges: { en: 'No field-level changes captured.', ar: 'لم يتم التقاط أي تغييرات على مستوى الحقول.' },
  empty: { en: '—', ar: '—' },
} satisfies Record<string, BilingualText>;

/** Per-action display names. */
export const actionLabels: Record<OrgAuditEvent['action'], BilingualText> = {
  created: { en: 'Created', ar: 'تم الإنشاء' },
  updated: { en: 'Updated', ar: 'تم التحديث' },
  role_assigned: { en: 'Role assigned', ar: 'تم تعيين دور' },
  role_removed: { en: 'Role removed', ar: 'تمت إزالة دور' },
  reparented: { en: 'Reparented', ar: 'تم تغيير الكيان الأصل' },
  activated: { en: 'Activated', ar: 'تم التفعيل' },
  deactivated: { en: 'Deactivated', ar: 'تم التعطيل' },
  deleted: { en: 'Deleted', ar: 'تم الحذف' },
  snapshot: { en: 'Snapshot', ar: 'لقطة' },
};

/** Badge variant per action (green = success, red = destructive, amber = warning, muted = secondary). */
export function actionBadgeVariant(
  action: OrgAuditEvent['action'],
): 'success' | 'destructive' | 'warning' | 'secondary' {
  switch (action) {
    case 'created':
    case 'role_assigned':
    case 'activated':
      return 'success';
    case 'deleted':
    case 'role_removed':
    case 'deactivated':
      return 'destructive';
    case 'updated':
    case 'reparented':
      return 'warning';
    case 'snapshot':
    default:
      return 'secondary';
  }
}

/**
 * Human-readable label for a snapshot_reason captured by the page
 * (e.g. 'before_delete', 'before_bulk_activate'). Falls back to a
 * title-cased version of the raw reason when not explicitly mapped.
 */
export function snapshotReasonLabel(reason: string | undefined, lang: Lang): string {
  if (!reason) return tt(actionLabels.snapshot, lang);
  const map: Record<string, BilingualText> = {
    before_delete: { en: 'Captured before delete', ar: 'تم الالتقاط قبل الحذف' },
    before_bulk_delete: { en: 'Captured before bulk delete', ar: 'تم الالتقاط قبل الحذف الجماعي' },
    before_bulk_activate: { en: 'Captured before bulk activate', ar: 'تم الالتقاط قبل التفعيل الجماعي' },
    before_bulk_deactivate: { en: 'Captured before bulk deactivate', ar: 'تم الالتقاط قبل التعطيل الجماعي' },
    before_activate: { en: 'Captured before activate', ar: 'تم الالتقاط قبل التفعيل' },
    before_deactivate: { en: 'Captured before deactivate', ar: 'تم الالتقاط قبل التعطيل' },
    before_role_change: { en: 'Captured before role change', ar: 'تم الالتقاط قبل تغيير الدور' },
    before_update: { en: 'Captured before update', ar: 'تم الالتقاط قبل التحديث' },
  };
  const entry = map[reason];
  if (entry) return tt(entry, lang);
  return reason
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
