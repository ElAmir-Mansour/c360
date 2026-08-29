/**
 * Consistent bilingual hover copy for statistic cards that do not use the
 * shared StatTile primitive. Callers can still provide more precise copy when
 * the calculation or reporting window needs to be explained.
 */
export function statisticHint(label: string, actionable = true): string {
  const isArabic = /[\u0600-\u06ff]/.test(label);

  if (actionable) {
    return isArabic
      ? `${label} — افتح السجلات المساهمة في هذه الإحصائية`
      : `${label} — open the records contributing to this statistic`;
  }

  return isArabic
    ? `${label} — إحصائية محسوبة من النطاق الحالي`
    : `${label} — calculated from the current scope`;
}
