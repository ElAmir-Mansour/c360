'use client';

/**
 * Side-by-side drift diff between a LINKED legal entity and the platform unit it
 * maps to. Renders only the fields that actually differ (EN name, AR name,
 * active flag) and offers a "Fix drift" action that pushes the platform values
 * onto the legal entity. Presentational + a single mutation callback — all
 * query wiring lives in the parent view.
 */
import { ArrowLeftRight, Check, GitCompareArrows } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { OrgEntity } from '@/lib/lex/admin';
import { platformUnitName, type PlatformOrgUnit } from '../../_lib/platform-sync-api';
import { labels } from '../../_lib/platform-sync-i18n';

export interface DriftField {
  /** Stable key used for React lists. */
  key: 'name_en' | 'name_ar' | 'active';
  label: string;
  legal: string;
  platform: string;
}

export interface PlatformUnitDiffRowProps {
  entity: OrgEntity;
  unit: PlatformOrgUnit;
  /** Pre-computed differing fields (parent owns the comparison). */
  fields: DriftField[];
  canWrite?: boolean;
  fixing?: boolean;
  /** Apply the platform unit's values onto the legal entity. */
  onFix: () => void;
}

function DiffCell({ value, tone }: { value: string; tone: 'legal' | 'platform' }) {
  return (
    <span
      className={
        tone === 'legal'
          ? 'rounded bg-warning-50 px-1.5 py-0.5 font-medium text-warning-700 dark:text-warning-300'
          : 'rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary'
      }
    >
      {value || '—'}
    </span>
  );
}

export function PlatformUnitDiffRow({
  entity,
  unit,
  fields,
  canWrite = false,
  fixing = false,
  onFix,
}: PlatformUnitDiffRowProps) {
  const { locale, direction } = useLocaleOrDefault();
  const t = locale === 'ar' ? labels.ar : labels.en;

  return (
    <div
      dir={direction}
      className="rounded-lg border border-warning-100 bg-warning-50/40 p-3"
      data-testid="platform-unit-diff-row"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitCompareArrows className="h-4 w-4 text-warning-700 dark:text-warning-300" aria-hidden />
          <span className="text-sm font-medium text-warning-700 dark:text-warning-300">{t.driftTitle}</span>
          <Badge variant="warning">{fields.length}</Badge>
        </div>
        {canWrite ? (
          <Button size="sm" variant="outline" onClick={onFix} disabled={fixing}>
            <Check className="me-1.5 h-3.5 w-3.5" aria-hidden />
            {fixing ? t.fixing : t.fixDrift}
          </Button>
        ) : null}
      </div>

      {/* Column legend */}
      <div className="mb-1 grid grid-cols-[minmax(6rem,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-overline uppercase text-muted-foreground">
        <span />
        <span>{t.legalSide}</span>
        <span aria-hidden />
        <span>{t.platformSide}</span>
      </div>

      <div className="space-y-1.5">
        {fields.map((field) => (
          <div
            key={field.key}
            className="grid grid-cols-[minmax(6rem,1fr)_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm"
          >
            <span className="text-xs font-medium text-muted-foreground">{field.label}</span>
            <DiffCell value={field.legal} tone="legal" />
            <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <DiffCell value={field.platform} tone="platform" />
          </div>
        ))}
      </div>

      <p className="mt-2 text-caption text-muted-foreground">
        <span className="font-mono">{entity.code}</span>
        {' → '}
        <span className="font-mono">{unit.code ?? platformUnitName(unit, locale)}</span>
      </p>
    </div>
  );
}

export default PlatformUnitDiffRow;
