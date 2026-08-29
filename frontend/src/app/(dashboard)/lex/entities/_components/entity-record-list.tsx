'use client';

/**
 * ENTITY-360 detail — linked-record lists for the contracts / cases /
 * settlements tabs. Renders each linked record as a color-accented, elevated row
 * (via the shared `rowAccentClass`) that links back to its source detail page.
 *
 * KSA-formatted (SAR currency + relative time via `useLexFormat`), bilingual via
 * the injected label bundle, RTL-safe through logical spacing + `rtl:` arrows.
 */

import Link from 'next/link';
import { ChevronRight, Hash } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLexFormat } from '@/lib/lex/ksa';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { LexStatusChip } from '@/components/lex/status-chip';
import { rowAccentClass } from '@/components/lex/row-accents';
import {
  lexContractStatusLabels,
  resolveLexBilingual,
} from '../../_lib/lex-i18n';
import { LexEmptyState } from '@/components/lex/empty-state';
import type {
  EntityCaseLink,
  EntityContractLink,
  EntityLink,
  EntitySettlementLink,
} from '../_lib/entity-data';
import type { EntityLabels } from '../_lib/entity-i18n';

export interface EntityRecordListProps {
  records: EntityLink[];
  labels: EntityLabels['detail'];
  emptyLabel: string;
}

export function EntityRecordList({ records, labels, emptyLabel }: EntityRecordListProps) {
  const f = useLexFormat();
  const { locale } = useLocaleOrDefault();
  const contractStatusLabels = resolveLexBilingual(lexContractStatusLabels, locale);

  if (records.length === 0) {
    return (
      <LexEmptyState title={emptyLabel} />
    );
  }

  return (
    <ul className="space-y-2.5">
      {records.map((record, index) => (
        <li
          key={`${record.kind}-${record.id}`}
          className="motion-safe:animate-fade-up"
          style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}
        >
          <Link
            href={record.href}
            className={cn(
              'group flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-4 py-3',
              rowAccentClass('status', record.status),
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className="min-w-0 truncate text-sm font-medium text-foreground group-hover:text-primary"
                  dir="auto"
                >
                  {record.title}
                </p>
                <StatusFor
                  record={record}
                  contractStatusLabels={contractStatusLabels}
                />
                {record.kind === 'case' ? (
                  <CaseSideBadge record={record} labels={labels} />
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span className="inline-flex min-w-0 items-center gap-1 font-mono" dir="ltr">
                  <Hash className="h-3 w-3 shrink-0" aria-hidden />
                  <span className="truncate">
                    {record.reference || labels.record.noReference}
                  </span>
                </span>
                {hasValue(record) ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="font-medium tabular-nums text-foreground" dir="ltr">
                      {f.formatCurrency(record.value as number, {
                        currency: record.currency ?? 'SAR',
                      })}
                    </span>
                  </>
                ) : null}
                <span aria-hidden>·</span>
                <span>{f.formatRelative(record.updatedAt)}</span>
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:text-primary rtl:-scale-x-100 motion-safe:group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function hasValue(
  record: EntityLink,
): record is (EntityContractLink | EntitySettlementLink) & { value: number } {
  return (
    (record.kind === 'contract' || record.kind === 'settlement') &&
    record.value !== null &&
    record.value !== undefined
  );
}

function StatusFor({
  record,
  contractStatusLabels,
}: {
  record: EntityLink;
  contractStatusLabels: Record<string, string>;
}) {
  if (record.kind === 'contract') {
    return (
      <LexStatusChip
        value={record.status}
        domain="generic"
        labels={contractStatusLabels}
        size="sm"
      />
    );
  }
  if (record.kind === 'case') {
    return <LexStatusChip value={record.status} domain="case" size="sm" />;
  }
  return <LexStatusChip value={record.status} domain="settlement" size="sm" />;
}

function CaseSideBadge({
  record,
  labels,
}: {
  record: EntityCaseLink;
  labels: EntityLabels['detail'];
}) {
  const isPlaintiff = record.companyStatus === 'plaintiff';
  return (
    <span
      className={cn(
        'badge-base',
        // When the CLIENT is plaintiff, the counterparty is the defendant.
        isPlaintiff ? 'badge-info' : 'badge-warning',
      )}
    >
      {isPlaintiff ? labels.record.asPlaintiff : labels.record.asDefendant}
    </span>
  );
}
