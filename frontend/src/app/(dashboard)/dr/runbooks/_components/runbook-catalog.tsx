'use client';

/**
 * RunbookCatalog — a browsable, selectable list of the tenant's runbook scopes so
 * operators don't have to know or paste a runbook UUID.
 *
 * ClarioDR's Runbook Studio backend exposes no `GET /studio/runbooks` collection
 * (only create / get-by-id / put), so a literal "list every runbook" view is not
 * available without a backend change. The honest, available browse surface is the
 * tenant's PROTECTION GROUPS — each group is the scope a recovery runbook
 * orchestrates. This catalog renders those groups as selectable rows: each row's
 * primary action opens the create-runbook dialog pre-bound to that group, so a
 * new runbook is authored against the right scope without typing an id. The
 * `?runbook=` open-by-id input above the catalog remains the path to re-open an
 * existing runbook by id.
 *
 * Bilingual (English + Modern Standard Arabic, copy resolved upstream and passed
 * in) and RTL-safe via logical spacing.
 */

import Link from 'next/link';
import { ArrowRight, Boxes, Plus, Timer } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { DRGroupRollup } from '@/types/clario-dr';
import type { RunbookPageLabels } from './runbook-page-labels';

export interface RunbookCatalogProps {
  groups: DRGroupRollup[];
  labels: RunbookPageLabels;
  /** True only once posture has loaded (so an empty list isn't shown mid-fetch). */
  loaded: boolean;
  /** Whether the operator may author runbooks (dr:write). Disables the row CTA. */
  canCreate: boolean;
  /** Open the create dialog pre-bound to the given protection group. */
  onCreateForGroup: (groupId: string) => void;
}

/** Resolve a group's canonical id (rollups key on `group_id`). */
function rollupId(group: DRGroupRollup): string | null {
  const id = (group.group_id ?? '').trim();
  return id && id !== 'null' && id !== 'undefined' ? id : null;
}

function formatSeconds(value: number | null | undefined, notSetLabel: string): string {
  if (value == null || value < 0) return notSetLabel;
  if (value < 60) return `${value}s`;
  if (value % 3600 === 0) return `${value / 3600}h`;
  if (value % 60 === 0) return `${value / 60}m`;
  return `${Math.round(value / 60)}m`;
}

export function RunbookCatalog({
  groups,
  labels,
  loaded,
  canCreate,
  onCreateForGroup,
}: RunbookCatalogProps) {
  const scopes = groups
    .map((group) => ({ group, id: rollupId(group) }))
    .filter((entry): entry is { group: DRGroupRollup; id: string } => Boolean(entry.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Boxes className="h-4 w-4 text-primary" aria-hidden />
          {labels.catalogTitle}
        </CardTitle>
        <CardDescription>{labels.catalogDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {loaded && scopes.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Boxes}
            title={labels.setupTitle}
            description={labels.setupDescription}
            action={{ label: labels.setupProtectionCta, href: '/dr/protect' }}
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {scopes.map(({ group, id }) => (
              <li
                key={id}
                className="rounded-lg border bg-card p-4"
              >
                <div className="flex h-full flex-col gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{group.name || id}</span>
                      {group.health ? (
                        <Badge variant="outline" className="normal-case">
                          {labels.catalogGroupHealthLabel(group.health)}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">{id}</div>
                    <dl className="grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-4">
                      <div>
                        <dt className="font-medium text-foreground">{labels.catalogMembersLabel}</dt>
                        <dd className="tabular-nums">{group.member_count}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">{labels.catalogStreamsLabel}</dt>
                        <dd className="tabular-nums">{group.stream_count}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">{labels.catalogRtoLabel}</dt>
                        <dd className="tabular-nums">
                          {formatSeconds(group.rto_objective_seconds, labels.catalogNotSet)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-foreground">{labels.catalogRpoLabel}</dt>
                        <dd className="tabular-nums">
                          {formatSeconds(group.rpo_objective_seconds, labels.catalogNotSet)}
                        </dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Timer className="h-3.5 w-3.5" aria-hidden />
                        {group.latest_recovery_point?.is_validated
                          ? labels.catalogValidatedPoint
                          : labels.catalogNoValidatedPoint}
                      </span>
                      {group.last_run?.run_id ? (
                        <Link
                          href={`/dr/runs/${encodeURIComponent(group.last_run.run_id)}`}
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          {labels.catalogLastRun}
                          <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canCreate}
                      onClick={() => onCreateForGroup(id)}
                    >
                      <Plus className="me-1.5 h-4 w-4" aria-hidden />
                      {labels.catalogCreateForGroup}
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default RunbookCatalog;
