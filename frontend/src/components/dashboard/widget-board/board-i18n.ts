/**
 * Widget-board local bilingual strings.
 *
 * The board's chrome (edit mode, picker, empty states) resolves labels from the
 * active locale via `useLocaleOrDefault()` — the same inline en/ar pattern the
 * Lex suite uses for suite-local labels — so no shared i18n catalog edits are
 * required and the board stays fully self-contained.
 */

export interface BilingualText {
  en: string;
  ar: string;
}

/** Resolve a bilingual label for the active locale (Arabic-first app default). */
export function pickText(text: BilingualText, locale: string): string {
  return locale === 'ar' ? text.ar : text.en;
}

export const BOARD_TEXT = {
  customize: { en: 'Customize dashboard', ar: 'تخصيص لوحة المعلومات' },
  editMode: { en: 'Customize mode', ar: 'وضع التخصيص' },
  editHint: {
    en: 'Drag, resize, or use the keyboard controls. Changes follow you across devices.',
    ar: 'اسحب أو غيّر الحجم أو استخدم عناصر تحكم لوحة المفاتيح. تتزامن التغييرات عبر أجهزتك.',
  },
  addWidget: { en: 'Add widget', ar: 'إضافة أداة' },
  resetDefault: { en: 'Reset to default', ar: 'إعادة التعيين إلى الافتراضي' },
  done: { en: 'Done', ar: 'تم' },
  removeWidget: { en: 'Remove widget', ar: 'إزالة الأداة' },
  noContent: { en: 'Nothing to show right now', ar: 'لا يوجد محتوى للعرض حاليًا' },
  pickerTitle: { en: 'Dashboard widgets', ar: 'أدوات لوحة المعلومات' },
  pickerDescription: {
    en: 'Choose which widgets appear on your dashboard.',
    ar: 'اختر الأدوات التي تظهر في لوحة المعلومات الخاصة بك.',
  },
  emptyBoard: {
    en: 'All widgets are hidden. Add widgets to build your dashboard.',
    ar: 'جميع الأدوات مخفية. أضف أدوات لبناء لوحة المعلومات.',
  },
  editModeOn: { en: 'Customize mode is on', ar: 'وضع التخصيص مفعّل' },
  editModeOff: { en: 'Customize mode is off', ar: 'وضع التخصيص متوقف' },
  preset: { en: 'Role view', ar: 'عرض الدور' },
  scope: { en: 'Suite scope', ar: 'نطاق الجناح' },
  horizon: { en: 'Time horizon', ar: 'النطاق الزمني' },
  alertThreshold: { en: 'Alert threshold', ar: 'حد التنبيه' },
  presetsRecommended: { en: 'Recommended', ar: 'موصى به' },
  presetsMyWork: { en: 'My work', ar: 'عملي' },
  presetsOperations: { en: 'Operations', ar: 'العمليات' },
  presetsExecutive: { en: 'Executive risk', ar: 'المخاطر التنفيذية' },
  presetsAdmin: { en: 'Administrator', ar: 'المسؤول' },
  scopeAll: { en: 'All suites', ar: 'كل الأجنحة' },
  scopeWatheeq: { en: 'Watheeq legal', ar: 'وثيق القانوني' },
  scopeCyber: { en: 'Cyber', ar: 'الأمن السيبراني' },
  scopeData: { en: 'Data', ar: 'البيانات' },
  horizonDays: { en: 'days', ar: 'يومًا' },
  thresholdCritical: { en: 'Critical only', ar: 'حرج فقط' },
  thresholdHigh: { en: 'High and critical', ar: 'عالٍ وحرج' },
  thresholdMedium: { en: 'Medium and above', ar: 'متوسط فأعلى' },
  saveTeamDefault: { en: 'Set as team default', ar: 'تعيين كافتراضي للفريق' },
  teamDefaultSaved: { en: 'Team default saved', ar: 'تم حفظ الإعداد الافتراضي للفريق' },
  syncSaving: { en: 'Saving…', ar: 'جارٍ الحفظ…' },
  syncSaved: { en: 'Saved across devices', ar: 'محفوظ عبر الأجهزة' },
  syncLocal: { en: 'Saved on this device; cloud sync unavailable', ar: 'محفوظ على هذا الجهاز؛ المزامنة السحابية غير متاحة' },
  moveEarlier: { en: 'Move earlier', ar: 'نقل للأعلى' },
  moveLater: { en: 'Move later', ar: 'نقل للأسفل' },
  makeNarrower: { en: 'Make narrower', ar: 'تقليل العرض' },
  makeWider: { en: 'Make wider', ar: 'زيادة العرض' },
  widgetMoved: { en: 'Widget position updated', ar: 'تم تحديث موضع الأداة' },
  widgetResized: { en: 'Widget size updated', ar: 'تم تحديث حجم الأداة' },
} satisfies Record<string, BilingualText>;
