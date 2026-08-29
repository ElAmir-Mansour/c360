'use client';

/**
 * ENTITY-360 detail — shared activity derivation.
 *
 * An entity is an AGGREGATION, not a record, so there is no per-entity audit
 * endpoint. The honest activity story is the timeline of its linked records'
 * `updated_at` moments (contracts / cases / settlements), humanized into
 * `LexActivityEvent`s. Extracted here so the full Activity tab (page) and the
 * right-rail activity mini derive from ONE source and never diverge.
 */

import type { LexActivityEvent, LexActivityTone } from '@/components/lex/activity-timeline';
import type { EntityFootprint, EntityLink } from '../../_lib/entity-data';
import type { EntityLabels } from '../../_lib/entity-i18n';

export function buildEntityActivityEvents(
  entity: EntityFootprint,
  labels: EntityLabels['detail'],
): LexActivityEvent[] {
  const events: LexActivityEvent[] = [];

  const push = (record: EntityLink, action: string, tone: LexActivityTone) => {
    events.push({
      id: `${record.kind}-${record.id}`,
      actor: { name: entity.name },
      action,
      target: record.title,
      at: record.updatedAt,
      tone,
    });
  };

  for (const c of entity.contracts) push(c, labels.activityVerbs.contract, 'info');
  for (const k of entity.cases) push(k, labels.activityVerbs.case, 'warning');
  for (const s of entity.settlements) push(s, labels.activityVerbs.settlement, 'success');

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
