'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Download, ScrollText } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { RelativeTime } from '@/components/shared/relative-time';
import { SectionCard } from '@/components/suites/section-card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { downloadBlob, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ConsultationAuditEntry } from '@/lib/lex/consultations';
import { formatConsultationToken, useConsultationLabels } from './labels';

/**
 * ConsultationAuditTimeline — readable vertical audit timeline for the
 * consultation detail page (#15).
 *
 * Data flow: the detail shell OWNS the audit query and passes the fetched
 * `entries` + `loading`. This component owns no entries query but DOES own a
 * small enterprise-users query so it can resolve `actor_user_id → display name`
 * (id→name map, fallback to a short id). On top of the timeline it adds actor /
 * action filters and a CSV export of the (filtered) rows.
 *
 * Public prop shape is stable: `{ entries, loading }`.
 */
export interface ConsultationAuditTimelineProps {
  entries: ConsultationAuditEntry[];
  loading?: boolean;
}

const ALL = '__all__';

function shortId(id: string): string {
  return id ? id.slice(0, 8) : '—';
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Compact single-line summary of a structured audit `detail` blob. */
function summarizeDetail(detail?: Record<string, unknown> | null): string {
  if (!detail || typeof detail !== 'object') return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value == null || value === '') continue;
    const text =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    parts.push(`${formatConsultationToken(key)}: ${text}`);
    if (parts.length >= 4) break;
  }
  return parts.join(' • ');
}

/** RFC-4180 CSV field escaping. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function ConsultationAuditTimeline({
  entries,
  loading = false,
}: ConsultationAuditTimelineProps) {
  const L = useConsultationLabels();
  const labels = L.detail;
  const A = L.audit;

  const [actorFilter, setActorFilter] = useState<string>(ALL);
  const [actionFilter, setActionFilter] = useState<string>(ALL);

  // Own users-directory query so actor ids resolve to names. Only meaningful
  // when there are entries to label.
  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-consultation-audit'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200, order: 'asc' }),
    enabled: entries.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of usersQuery.data?.data ?? []) {
      map.set(u.id, userDisplayName(u));
    }
    return map;
  }, [usersQuery.data]);

  const actorName = (id: string): string => nameById.get(id) ?? shortId(id);

  // Distinct actors / actions present, for the filter selects.
  const actorOptions = useMemo(() => {
    const ids = Array.from(new Set(entries.map((e) => e.actor_user_id)));
    return ids
      .map((id) => ({ id, name: actorName(id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, nameById]);

  const actionOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action))).sort(),
    [entries],
  );

  const filtered = useMemo(
    () =>
      entries.filter(
        (e) =>
          (actorFilter === ALL || e.actor_user_id === actorFilter) &&
          (actionFilter === ALL || e.action === actionFilter),
      ),
    [entries, actorFilter, actionFilter],
  );

  const handleExport = () => {
    const header = ['timestamp', 'actor', 'action', 'from_status', 'to_status', 'detail'];
    const rows = filtered.map((e) => [
      e.created_at,
      actorName(e.actor_user_id),
      e.action,
      e.from_status ?? '',
      e.to_status ?? '',
      summarizeDetail(e.detail),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => csvField(String(cell))).join(','))
      .join('\r\n');
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `consultation-audit-${Date.now()}.csv`);
  };

  return (
    <SectionCard
      title={A.title}
      description={labels.auditDescription}
      actions={
        !loading && entries.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={actorFilter} onValueChange={setActorFilter}>
              <SelectTrigger className="h-8 w-[160px]" aria-label={A.filterByActor}>
                <SelectValue placeholder={A.filterByActor} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{A.filterByActor}</SelectItem>
                {actorOptions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-8 w-[160px]" aria-label={A.filterByAction}>
                <SelectValue placeholder={A.filterByAction} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{A.filterByAction}</SelectItem>
                {actionOptions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {formatConsultationToken(action)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
              <Download className="me-1.5 h-3.5 w-3.5" aria-hidden />
              {A.exportCsv}
            </Button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <LoadingSkeleton variant="list-item" count={3} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={labels.auditEmptyTitle}
          description={labels.auditEmptyDescription}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          size="compact"
          title={labels.auditEmptyTitle}
          description={labels.auditEmptyDescription}
        />
      ) : (
        <ol className="relative space-y-5 ps-2">
          {/* The connecting rail runs along the logical start edge (RTL-safe). */}
          <span
            className="absolute inset-y-1 start-[15px] w-px bg-border"
            aria-hidden
          />
          {filtered.map((entry) => {
            const name = actorName(entry.actor_user_id);
            const detail = summarizeDetail(entry.detail);
            const hasTransition = Boolean(entry.from_status || entry.to_status);
            return (
              <li key={entry.id} className="relative flex gap-3">
                <Avatar className="z-[1] h-8 w-8 ring-2 ring-background">
                  <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
                    {initialsFromName(name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium">
                      {A.timelinePerformed(formatConsultationToken(entry.action))}
                    </span>
                    <span className="text-xs text-muted-foreground">{A.byActor(name)}</span>
                  </div>
                  {hasTransition ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {entry.from_status ? (
                        <Badge variant="outline">{formatConsultationToken(entry.from_status)}</Badge>
                      ) : null}
                      {entry.from_status && entry.to_status ? (
                        <ArrowRight className="h-3 w-3 text-muted-foreground rtl:rotate-180" aria-hidden />
                      ) : null}
                      {entry.to_status ? (
                        <Badge variant="secondary">{formatConsultationToken(entry.to_status)}</Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {detail ? (
                    <p className="text-xs text-muted-foreground">{detail}</p>
                  ) : null}
                  <div className={cn('flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground')}>
                    <span>{formatDateTime(entry.created_at)}</span>
                    <span aria-hidden>•</span>
                    <RelativeTime date={entry.created_at} className="text-[11px]" />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SectionCard>
  );
}
