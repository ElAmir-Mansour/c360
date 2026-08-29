'use client';

/**
 * A single row in the org-entity audit timeline. Shows an action Badge, the
 * actor, a localized summary, the entity code (org-wide mode), and a relative
 * timestamp. Rows with a before/after payload are expandable to reveal the
 * field-level diff (AuditDiff).
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { AuditDiff } from './audit-diff';
import {
  actionBadgeVariant,
  actionLabels,
  auditLabels,
  snapshotReasonLabel,
  tt,
  type Lang,
} from '../../_lib/org-audit-i18n';
import type { OrgAuditEvent } from '../../_lib/org-audit-api';

interface AuditEventRowProps {
  event: OrgAuditEvent;
  /** When true (org-wide mode), surface the entity code alongside the summary. */
  showEntityCode?: boolean;
}

function safeFormat(at: string, pattern: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return at;
  return format(parsed, pattern);
}

function safeDistance(at: string): string {
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) return '';
  try {
    return formatDistanceToNow(parsed, { addSuffix: true });
  } catch {
    return '';
  }
}

export function AuditEventRow({ event, showEntityCode = false }: AuditEventRowProps) {
  const { locale } = useLocaleOrDefault();
  const lang: Lang = locale === 'ar' ? 'ar' : 'en';

  const hasDiff = !!event.before || !!event.after;
  const [open, setOpen] = useState(false);

  const actionLabel = tt(actionLabels[event.action], lang);
  const actor = event.actor && event.actor.length > 0 ? event.actor : tt(auditLabels.system, lang);

  // For snapshot events the summary carries the snapshot_reason key; humanize it.
  const summary =
    event.action === 'snapshot'
      ? snapshotReasonLabel(event.summary, lang)
      : (event.summary ?? '');

  return (
    <li className="relative ps-6">
      {/* timeline node */}
      <span
        className="absolute start-0 top-1.5 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-background bg-muted-foreground/50 rtl:translate-x-1/2"
        aria-hidden
      />
      <div className="rounded-lg border border-border/70 bg-card px-3 py-2.5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={actionBadgeVariant(event.action)}>{actionLabel}</Badge>
          {showEntityCode && event.entity_code ? (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
              {event.entity_code}
            </span>
          ) : null}
          <span className="text-sm font-medium text-foreground">{actor}</span>
          <span
            className="ms-auto whitespace-nowrap text-xs text-muted-foreground"
            title={safeFormat(event.at, 'PPpp')}
          >
            {safeDistance(event.at)}
          </span>
        </div>

        {summary ? <p className="mt-1 text-sm text-muted-foreground">{summary}</p> : null}

        {hasDiff ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 h-6 gap-1 px-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setOpen((prev) => !prev)}
              aria-expanded={open}
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
              )}
              {open ? tt(auditLabels.collapse, lang) : tt(auditLabels.expand, lang)}
            </Button>
            {open ? <AuditDiff before={event.before} after={event.after} /> : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

export default AuditEventRow;
