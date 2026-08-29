import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { Consultation } from '@/lib/lex/consultations';
import type { ConsultationArchiveLabels } from './archive-labels';

export function consultationResolvedAt(consultation: Consultation): string | null {
  // The consultation reporting API defines resolution/turnaround at the first
  // recorded response. Approval and archive timestamps are later lifecycle
  // milestones and must not silently move the resolved date.
  return consultation.responded_at ?? null;
}

export function formatAverageResponse(
  minutes: number,
  locale: AppLocale,
): { value: string; unit: string } | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  const formatter = new Intl.NumberFormat(locale === 'ar' ? 'ar-SA' : 'en-US', {
    maximumFractionDigits: 1,
  });

  if (minutes < 60) {
    return {
      value: formatter.format(Math.round(minutes)),
      unit: locale === 'ar' ? 'دقيقة' : 'min',
    };
  }

  if (minutes < 1440) {
    return {
      value: formatter.format(minutes / 60),
      unit: locale === 'ar' ? 'ساعة' : 'hrs',
    };
  }

  return {
    value: formatter.format(minutes / 1440),
    unit: locale === 'ar' ? 'يوم' : 'days',
  };
}

function escapeCsv(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export function buildConsultationsCsv(
  consultations: Consultation[],
  locale: AppLocale,
  labels: Pick<ConsultationArchiveLabels, 'export'>,
): string {
  const header = [
    labels.export.number,
    labels.export.title,
    labels.export.type,
    labels.export.requester,
    labels.export.department,
    labels.export.advisor,
    labels.export.status,
    labels.export.priority,
    labels.export.submitted,
    labels.export.resolved,
  ];

  const rows = consultations.map((consultation) => [
    consultation.consultation_number,
    resolveLocalized(consultation.title, locale) || consultation.consultation_number,
    consultation.type,
    consultation.requester_name,
    consultation.department ?? '',
    consultation.advisor_name ?? '',
    consultation.status,
    consultation.priority,
    consultation.created_at,
    consultationResolvedAt(consultation) ?? '',
  ]);

  return [header, ...rows]
    .map((row) => row.map(escapeCsv).join(','))
    .join('\n');
}
