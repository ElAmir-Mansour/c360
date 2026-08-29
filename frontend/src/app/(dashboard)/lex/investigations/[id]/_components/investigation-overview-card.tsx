'use client';

/**
 * Dense Overview card for the investigations detail page — a compact key/value
 * grid of the investigation's core state, mirroring the Service Desk request
 * Overview. Empty *writable* fields (department, linked case) become an inline
 * "+ Add" affordance that opens the existing edit dialog; empty read-only
 * fields show a muted "not set". Every enum token (status, priority) is
 * localized via the co-located enum resolvers.
 *
 * Read-only and prop-driven — it renders from the already-loaded
 * `investigation` and reuses the pre-existing `useInvestigationLabels().detail`
 * copy, so nothing new needs fetching or translating twice.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import type { Investigation } from '@/lib/lex/investigations';
import type { InvestigationLabels } from '../../_components/labels';
import {
  useInvestigationPriorityLabel,
  useInvestigationStatusLabel,
} from './investigation-enums-i18n';
import { useInvestigationOverviewLabels } from './investigation-overview-labels';

export interface InvestigationOverviewCardProps {
  investigation: Investigation;
  labels: InvestigationLabels;
  canWrite: boolean;
  onEdit: () => void;
  className?: string;
}

export function InvestigationOverviewCard({
  investigation,
  labels,
  canWrite,
  onEdit,
  className,
}: InvestigationOverviewCardProps) {
  const f = useLexFormat();
  const D = labels.detail;
  const overview = useInvestigationOverviewLabels();
  const statusLabel = useInvestigationStatusLabel();
  const priorityLabel = useInvestigationPriorityLabel();

  const caseId = investigation.case_id?.trim();

  return (
    <SectionCard
      title={D.overviewTitle}
      description={D.overviewDescription}
      className={className}
    >
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <MetaField label={D.metadata.number} value={investigation.investigation_number} mono />
        <MetaField label={D.metricStatus} value={statusLabel(investigation.status)} />
        <MetaField label={D.metricPriority} value={priorityLabel(investigation.priority)} />
        <MetaField label={D.metadata.lead} value={investigation.lead_investigator} notSet={D.notSet} />
        <MetaField
          label={D.metadata.department}
          value={investigation.department}
          onAdd={canWrite ? onEdit : undefined}
          addLabel={overview.addField}
          notSet={D.notSet}
        />
        <MetaField
          label={D.metadata.linkedCase}
          value={
            caseId ? (
              <Link
                href={`/lex/cases/${caseId}`}
                className="font-mono text-xs text-primary hover:underline"
              >
                {caseId}
              </Link>
            ) : undefined
          }
          onAdd={canWrite ? onEdit : undefined}
          addLabel={overview.addField}
          notSet={D.none}
        />
        <MetaField label={D.metadata.created} value={f.formatDual(investigation.created_at)} />
        <MetaField
          label={D.metadata.updated}
          value={f.formatRelative(investigation.updated_at)}
          tabularNums
        />
        <MetaField
          label={overview.createdBy}
          value={investigation.created_by}
          notSet={D.notSet}
          mono
        />
        <MetaField
          label={D.metadata.aiDrafted}
          value={investigation.ai_drafted ? D.yes : D.no}
        />
      </dl>
    </SectionCard>
  );
}

/* A compact key/value field. Empty values become an inline "add" affordance
   (opens the edit dialog) when the viewer can write, otherwise a muted value. */
function MetaField({
  label,
  value,
  onAdd,
  addLabel,
  notSet,
  tabularNums = false,
  mono = false,
}: {
  label: string;
  value: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  notSet?: string;
  tabularNums?: boolean;
  mono?: boolean;
}) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '');
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={cn(
          'text-sm font-medium text-foreground',
          tabularNums && 'tabular-nums',
          mono && !isEmpty && typeof value === 'string' && 'font-mono text-xs',
        )}
        dir="auto"
      >
        {isEmpty ? (
          onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {addLabel}
            </button>
          ) : (
            <span className="font-normal text-muted-foreground">{notSet ?? '—'}</span>
          )
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
