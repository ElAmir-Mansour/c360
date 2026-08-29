'use client';

import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { formatNumber } from '@/lib/format';
import type { LexDocumentRepositorySummary } from '@/types/suites';
import type { DocumentsLabels } from '../_lib/documents-labels';

/** One toggleable quick-filter chip backed by a single URL-param filter key. */
interface ChipSpec {
  key: string;
  value: string;
  label: string;
  count?: number;
}

function Chip({
  spec,
  active,
  onToggle,
}: {
  spec: ChipSpec;
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-card text-muted-foreground hover:bg-muted/60',
      )}
    >
      <span className="truncate">{spec.label}</span>
      {typeof spec.count === 'number' ? (
        <span className={cn('tabular-nums', active ? 'text-primary' : 'text-muted-foreground/70')}>
          {formatNumber(spec.count)}
        </span>
      ) : null}
    </button>
  );
}

function ChipGroup({
  heading,
  chips,
  activeFilters,
  onToggle,
}: {
  heading: string;
  chips: ChipSpec[];
  activeFilters: Record<string, string | string[]>;
  onToggle: (key: string, value: string) => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{heading}</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((chip) => {
          const current = activeFilters[chip.key];
          const active = Array.isArray(current) ? current.includes(chip.value) : current === chip.value;
          return (
            <Chip
              key={`${chip.key}:${chip.value}`}
              spec={chip}
              active={active}
              onToggle={() => onToggle(chip.key, chip.value)}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * DocumentQuickFilters renders the taxonomy + retention quick-filter chips
 * sourced from the repository summary. Each chip writes a single URL-param
 * filter via `setFilter`; clicking an active chip clears it. Guards every
 * summary field with nullish defaults so a partial/empty summary still renders.
 */
export function DocumentQuickFilters({
  summary,
  labels,
  activeFilters,
  setFilter,
}: {
  summary?: LexDocumentRepositorySummary;
  labels: DocumentsLabels;
  activeFilters: Record<string, string | string[]>;
  setFilter: (key: string, value: string | string[] | undefined) => void;
}) {
  const { locale } = useLocaleOrDefault();
  const t = labels.chips;

  const typeChips: ChipSpec[] = Object.entries(summary?.by_type ?? {}).map(([value, count]) => ({
    key: 'type',
    value,
    label: labels.enums.types[value] ?? unknownDocumentEnum('type', value, locale),
    count,
  }));
  const statusChips: ChipSpec[] = Object.entries(summary?.by_status ?? {}).map(([value, count]) => ({
    key: 'status',
    value,
    label: labels.enums.statuses[value] ?? unknownDocumentEnum('status', value, locale),
    count,
  }));
  const confidentialityChips: ChipSpec[] = Object.entries(summary?.by_confidentiality ?? {}).map(
    ([value, count]) => ({
      key: 'confidentiality',
      value,
      label: labels.enums.confidentiality[value] ?? unknownDocumentEnum('confidentiality', value, locale),
      count,
    }),
  );
  const categoryChips: ChipSpec[] = Object.entries(summary?.by_category ?? {}).map(([value, count]) => ({
    key: 'category',
    value,
    label: value,
    count,
  }));

  const retention = summary?.retention;
  const retentionChips: ChipSpec[] = [];
  if ((retention?.disposition_due ?? 0) > 0) {
    retentionChips.push({
      key: 'disposition_due',
      value: 'true',
      label: t.dispositionDue,
      count: retention?.disposition_due ?? 0,
    });
  }
  if ((retention?.missing_policy ?? 0) > 0) {
    retentionChips.push({
      key: 'missing_retention_policy',
      value: 'true',
      label: t.missingRetention,
      count: retention?.missing_policy ?? 0,
    });
  }

  const toggle = (key: string, value: string) => {
    const current = activeFilters[key];
    const isActive = Array.isArray(current) ? current.includes(value) : current === value;
    setFilter(key, isActive ? undefined : value);
  };

  const hasAnyChips =
    typeChips.length > 0 ||
    statusChips.length > 0 ||
    confidentialityChips.length > 0 ||
    categoryChips.length > 0 ||
    retentionChips.length > 0;

  if (!hasAnyChips) return null;

  return (
    <div className="space-y-3 rounded-md border bg-card/60 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.heading}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ChipGroup heading={t.typeGroup} chips={typeChips} activeFilters={activeFilters} onToggle={toggle} />
        <ChipGroup heading={t.statusGroup} chips={statusChips} activeFilters={activeFilters} onToggle={toggle} />
        <ChipGroup
          heading={t.confidentialityGroup}
          chips={confidentialityChips}
          activeFilters={activeFilters}
          onToggle={toggle}
        />
        <ChipGroup heading={t.categoryGroup} chips={categoryChips} activeFilters={activeFilters} onToggle={toggle} />
        <ChipGroup heading={labels.summary.retentionDue} chips={retentionChips} activeFilters={activeFilters} onToggle={toggle} />
      </div>
    </div>
  );
}

function unknownDocumentEnum(kind: 'type' | 'status' | 'confidentiality', value: string, locale: string): string {
  if (locale !== 'ar') return value.replace(/_/g, ' ');
  if (kind === 'status') return 'حالة غير معروفة';
  if (kind === 'confidentiality') return 'سرية غير معروفة';
  return 'نوع غير معروف';
}
