'use client';

/**
 * Read-only impact preview for the org re-parent ("Move") dialog. Given the
 * moved entity, the chosen new parent id, and the full entity pool, it renders:
 *
 *   - a metric strip: # of sub-entities that move + the projected new depth
 *     (with a warning when depth > 6);
 *   - the L1/L2/L3 escalation-delta table (before → after provider) with a
 *     colored change badge per row;
 *   - a prominent red summary when any entities lose escalation coverage;
 *   - a note that the backend escalation resolver remains authoritative.
 *
 * All compute is delegated to the pure `reparent-impact` helpers; this file is
 * presentation only. Logical-direction CSS throughout (ms-/me-/text-start).
 */
import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { AppLocale } from '@/lib/i18n';
import type { OrgEntity } from '@/lib/lex/admin';
import {
  collectDescendants,
  countEntitiesLosingCoverage,
  projectEscalationDelta,
  type EscalationChange,
  type EscalationDeltaRow,
} from '../../_lib/reparent-impact';
import type { ReorganizeLabels } from '../../_lib/reorganize-i18n';

/** Depth beyond which we warn operators. */
const DEEP_HIERARCHY_THRESHOLD = 6;

const CHANGE_BADGE: Record<EscalationChange, { className: string }> = {
  gained: { className: 'border-transparent bg-success-100 text-success-700 dark:bg-success-700 dark:text-success-300' },
  lost: { className: 'border-transparent bg-error-100 text-error-700 dark:bg-error-700 dark:text-error-300' },
  changed: { className: 'border-transparent bg-warning-100 text-warning-700 dark:bg-warning-800 dark:text-warning-300' },
  same: { className: 'border-transparent bg-muted text-muted-foreground' },
};

export interface ReparentImpactPreviewProps {
  /** The entity being moved. */
  entity: OrgEntity;
  /** The chosen new parent id, or `null` for "make root". */
  newParentId: string | null;
  /** Full entity pool (flat list) the projection runs over. */
  all: OrgEntity[];
  locale: AppLocale;
  t: ReorganizeLabels;
}

export function ReparentImpactPreview({
  entity,
  newParentId,
  all,
  locale,
  t,
}: ReparentImpactPreviewProps) {
  const byId = useMemo(() => new Map(all.map((e) => [e.id, e])), [all]);

  const descendantCount = useMemo(
    () => collectDescendants(entity.id, all).length,
    [entity.id, all],
  );

  const newDepth = useMemo(() => {
    if (!newParentId) return 1;
    const parent = byId.get(newParentId);
    // depth = parent's ancestor count + parent itself + 1 for the moved node.
    if (!parent) return 1;
    const parentDepth = parent.path.filter((id) => id !== parent.id).length + 1;
    return parentDepth + 1;
  }, [newParentId, byId]);

  const deltaRows = useMemo<EscalationDeltaRow[]>(
    () => projectEscalationDelta(entity, newParentId, all),
    [entity, newParentId, all],
  );

  // Only surface rows that actually change to keep the table scannable.
  const changedRows = useMemo(
    () => deltaRows.filter((row) => row.change !== 'same'),
    [deltaRows],
  );

  const losingCount = useMemo(
    () => countEntitiesLosingCoverage(deltaRows),
    [deltaRows],
  );

  const codeOrLabel = (entityId: string, fallbackCode: string): string => {
    const e = byId.get(entityId);
    if (!e) return fallbackCode;
    return resolveLocalized(e.name, locale) || e.code;
  };

  return (
    <div className="space-y-4">
      {/* Metric strip */}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t.impactTitle}</p>
          <p className="text-sm font-medium">{t.descendantsMoving(descendantCount)}</p>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{t.colLevel}</p>
          <p className="text-sm font-medium">{t.newDepth(newDepth)}</p>
        </div>
      </div>

      {newDepth > DEEP_HIERARCHY_THRESHOLD ? (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>{t.newDepth(newDepth)}</AlertTitle>
          <AlertDescription>{t.depthWarning(newDepth)}</AlertDescription>
        </Alert>
      ) : null}

      {/* Coverage-loss summary — prominent red */}
      {losingCount > 0 ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          <AlertTitle>{t.coverageLossSummary(losingCount)}</AlertTitle>
          <AlertDescription>{t.escalationTitle}</AlertDescription>
        </Alert>
      ) : null}

      {/* Escalation-delta table */}
      <div className="space-y-2">
        <p className="text-sm font-medium">{t.escalationTitle}</p>
        {changedRows.length === 0 ? (
          <Alert>
            <Info className="h-4 w-4" aria-hidden />
            <AlertDescription>{t.noEscalationImpact}</AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t.colEntity}</th>
                  <th className="px-3 py-2 text-start font-medium">{t.colLevel}</th>
                  <th className="px-3 py-2 text-start font-medium">{t.colBefore}</th>
                  <th className="px-3 py-2 text-start font-medium">{t.colAfter}</th>
                  <th className="px-3 py-2 text-start font-medium">{t.colChange}</th>
                </tr>
              </thead>
              <tbody>
                {changedRows.map((row) => (
                  <tr
                    key={`${row.entityId}-${row.level}`}
                    className="border-t"
                  >
                    <td className="px-3 py-2">
                      <span className="font-medium">{codeOrLabel(row.entityId, row.code)}</span>
                      <span className="ms-1.5 text-xs text-muted-foreground">{row.code}</span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">L{row.level}</td>
                    <td className="px-3 py-2">
                      {row.before ? (
                        <span className="font-mono text-xs">{row.before}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t.uncovered}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1">
                        <ArrowRight className="h-3 w-3 text-muted-foreground rtl:rotate-180" aria-hidden />
                        {row.after ? (
                          <span className="font-mono text-xs">{row.after}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">{t.uncovered}</span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={CHANGE_BADGE[row.change].className}>
                        {t.changeLabel[row.change]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Alert>
        <Info className="h-4 w-4" aria-hidden />
        <AlertDescription>{t.authoritativeNote}</AlertDescription>
      </Alert>
    </div>
  );
}

export default ReparentImpactPreview;
