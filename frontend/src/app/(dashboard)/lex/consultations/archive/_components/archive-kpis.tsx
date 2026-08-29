'use client';

import { CheckCircle2, Clock3, FolderArchive, MessagesSquare } from 'lucide-react';
import { StatTile } from '@/components/shared/stat-tile';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useLexFormat } from '@/lib/lex/ksa';
import type { ConsultationStats } from '@/lib/lex/consultations';
import { useConsultationArchiveLabels } from './archive-labels';
import { formatAverageResponse } from './archive-utils';

interface ConsultationArchiveKpisProps {
  totals?: ConsultationStats;
  monthly?: ConsultationStats;
  loading?: boolean;
  error?: boolean;
}

export function ConsultationArchiveKpis({
  totals,
  monthly,
  loading = false,
  error = false,
}: ConsultationArchiveKpisProps) {
  const labels = useConsultationArchiveLabels();
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const completed = (totals?.responded ?? 0) + (totals?.approved ?? 0);
  const average = formatAverageResponse(totals?.avg_respond_minutes ?? 0, locale);
  const responseSample = totals?.response_sample ?? 0;
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const archivePath = '/lex/consultations/archive';
  const accessibleTileCopy = '[&_.text-overline]:!text-foreground [&_.text-muted-foreground]:!text-foreground/80';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile
        label={labels.stats.total}
        value={f.formatNumber(totals?.total ?? 0)}
        icon={MessagesSquare}
        tone="info"
        appearance="operational"
        accent
        className={accessibleTileCopy}
        loading={loading}
        error={error}
        helper={labels.stats.allRecords}
        href={archivePath}
      />
      <StatTile
        label={labels.stats.thisMonth}
        value={f.formatNumber(monthly?.total ?? 0)}
        icon={FolderArchive}
        tone="success"
        appearance="operational"
        accent
        className={accessibleTileCopy}
        loading={loading}
        error={error}
        helper={labels.stats.createdThisMonth}
        href={`${archivePath}?created_from=${encodeURIComponent(monthStart.toISOString())}`}
      />
      <StatTile
        label={labels.stats.completed}
        value={f.formatNumber(completed)}
        icon={CheckCircle2}
        tone="warning"
        appearance="operational"
        accent
        className={accessibleTileCopy}
        loading={loading}
        error={error}
        helper={labels.stats.answeredOrClosed}
        href={`${archivePath}?status=responded%2Capproved%2Carchived`}
      />
      <StatTile
        label={labels.stats.averageResponse}
        value={average?.value ?? '—'}
        unit={average?.unit}
        icon={Clock3}
        tone="danger"
        appearance="operational"
        accent
        className={accessibleTileCopy}
        loading={loading}
        error={error}
        helper={average && responseSample > 0 ? labels.stats.responseSample(f.formatNumber(responseSample)) : undefined}
        href={archivePath}
      />
    </div>
  );
}
