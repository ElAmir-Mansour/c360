'use client';

/**
 * "Recent Consultations" — the wide left panel's second table. A compact list of
 * the most recent advisory consultations that deep links into each consultation
 * page (where routing to an advisor and the response flow live). The bilingual
 * `title` resolves through `resolveLocalized`, the type token through
 * `resolveConsultationTypeLabel`, and status through the shared
 * `<LexStatusChip domain="consultation">`.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { SimpleTable, type Column } from '@/components/shared/simple-table';
import { StatusBadge } from '@/components/shared/status-badge';
import type { Consultation } from '@/lib/lex/consultations';
import { resolveConsultationTypeLabel } from '../../../consultations/[id]/_components/consultation-enums-i18n';
import { CONSULTATION_STATUS_BADGE_MAP } from '../_lib/status-maps';
import { useContractsControlLabels } from '../_lib/labels';

interface RecentConsultationVM extends Record<string, unknown> {
  id: string;
  reference: string;
  typeLabel: string;
  status: string;
  advisor: string;
  assigned: boolean;
}

export function RecentConsultationsCard({
  consultations,
  loading,
}: {
  consultations: Consultation[];
  loading?: boolean;
}) {
  const t = useContractsControlLabels();
  const { locale, direction } = useLocale();
  const router = useRouter();
  const columnLabels = t.recentConsultations.columns;

  const rows = useMemo<RecentConsultationVM[]>(
    () =>
      consultations.map((c) => {
        const advisor = c.advisor_name?.trim();
        return {
          id: c.id,
          reference:
            c.consultation_number?.trim() ||
            resolveLocalized(c.title, locale) ||
            t.recentConsultations.untitled,
          typeLabel: resolveConsultationTypeLabel(c.type, locale),
          status: c.status,
          advisor: advisor || t.recentConsultations.unassigned,
          assigned: Boolean(advisor),
        };
      }),
    [consultations, locale, t.recentConsultations.untitled, t.recentConsultations.unassigned],
  );

  const columns: Column<RecentConsultationVM>[] = [
    {
      key: 'reference',
      header: columnLabels.reference,
      render: (item) => (
        <Link
          href={`/lex/consultations/${item.id}`}
          className="font-semibold text-foreground hover:text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {item.reference}
        </Link>
      ),
    },
    {
      key: 'typeLabel',
      header: columnLabels.type,
      render: (item) => <span className="text-muted-foreground">{item.typeLabel}</span>,
    },
    {
      key: 'status',
      header: columnLabels.status,
      render: (item) => (
        <StatusBadge status={item.status} map={CONSULTATION_STATUS_BADGE_MAP} size="sm" />
      ),
    },
    {
      key: 'advisor',
      header: columnLabels.advisor,
      render: (item) => (
        <span className={item.assigned ? 'text-foreground' : 'text-muted-foreground'}>
          {item.advisor}
        </span>
      ),
    },
  ];

  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
      dir={direction}
      lang={locale}
      aria-label={t.recentConsultations.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h4 font-semibold text-foreground">{t.recentConsultations.title}</h2>
        <Link
          href="/lex/consultations"
          className="inline-flex items-center gap-1 text-body-sm font-semibold text-primary hover:underline"
        >
          {t.recentConsultations.viewAll}
          <ArrowRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>

      <div className="mt-4">
        <SimpleTable<RecentConsultationVM>
          columns={columns}
          data={rows}
          loading={loading}
          emptyMessage={t.recentConsultations.empty}
          ariaLabel={t.recentConsultations.title}
          getRowKey={(item) => item.id}
          onRowClick={(item) => router.push(`/lex/consultations/${item.id}`)}
        />
      </div>
    </section>
  );
}
