'use client';

import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { formatDateTime } from '@/lib/format';
import { casesApi, formatCaseToken } from '@/lib/lex/cases';
import { useCaseLabels } from '../labels';

interface AuditTabProps {
  caseId: string;
}

export function AuditTab({ caseId }: AuditTabProps) {
  const labels = useCaseLabels();
  const t = labels.audit;

  const auditQuery = useQuery({
    queryKey: ['lex-case-audit', caseId],
    queryFn: () => casesApi.listCaseAudit(caseId),
  });

  const entries = auditQuery.data ?? [];

  return (
    <SectionCard title={t.title} description={t.description}>
      {auditQuery.isLoading ? (
        <LoadingSkeleton variant="list-item" count={4} />
      ) : auditQuery.isError ? (
        <ErrorState message={t.error} onRetry={() => void auditQuery.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={History} title={t.emptyTitle} description={t.emptyDescription} />
      ) : (
        <ol className="relative space-y-4 border-s ps-5">
          {entries.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -start-[1.4rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
              <p className="text-sm font-medium">{formatCaseToken(entry.action)}</p>
              {entry.from_status || entry.to_status ? (
                <p className="text-xs text-muted-foreground">
                  {formatCaseToken(entry.from_status ?? '')} → {formatCaseToken(entry.to_status ?? '')}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{formatDateTime(entry.created_at)}</p>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}
