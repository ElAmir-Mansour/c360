"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Eye,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, type PageHeaderTag } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/error-state";
import { EmptyState } from "@/components/common/empty-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { useAuditTimeline } from "@/hooks/use-audit";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";
import type { AuditChange, AuditTimelineEvent, AuditTimelineParams } from "@/types/audit";

const ACTION_STYLES: Record<string, { color: string; icon: React.ComponentType<{ className?: string }> }> = {
  create: { color: "bg-primary", icon: Plus },
  update: { color: "bg-status-info", icon: Pencil },
  delete: { color: "bg-status-error", icon: Trash2 },
  access: { color: "bg-neutral-ink/35", icon: Eye },
};

function getActionStyle(action: string) {
  const lower = action.toLowerCase();
  if (lower.includes("create")) return ACTION_STYLES.create;
  if (lower.includes("update") || lower.includes("modify") || lower.includes("edit"))
    return ACTION_STYLES.update;
  if (lower.includes("delete") || lower.includes("remove"))
    return ACTION_STYLES.delete;
  return ACTION_STYLES.access;
}

function formatChangeValue(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "string") return `"${val}"`;
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}

function TimelineEventCard({ event }: { event: AuditTimelineEvent }) {
  const [expanded, setExpanded] = useState(false);
  const t = useT('admin');
  const style = getActionStyle(event.action);
  const Icon = style.icon;

  return (
    <div className="relative flex gap-4 pb-6 last:pb-0">
      {/* Timeline rail */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-white shrink-0",
            style.color
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 w-px bg-border mt-2" />
      </div>

      {/* Event content */}
      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                {event.action}
              </code>
              <span className="text-sm text-muted-foreground">{t('rt.by')}</span>
              <span className="text-sm font-medium truncate">
                {event.user_name || t('rt.system')}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {formatDateTime(event.timestamp)}
            </p>
            {event.summary && (
              <p className="text-sm text-muted-foreground mt-1">
                {event.summary}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {event.changes.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="text-xs"
              >
                {expanded ? (
                  <ChevronDown className="h-3 w-3 me-1" />
                ) : (
                  <ChevronRight className="h-3 w-3 me-1" />
                )}
                {event.changes.length > 1
                  ? t('rt.changesPlural', { n: event.changes.length })
                  : t('rt.changeSingular', { n: event.changes.length })}
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/admin/audit/logs/${event.id}`}>
                <Eye className="h-3 w-3" />
              </Link>
            </Button>
          </div>
        </div>

        {expanded && event.changes.length > 0 && (
          <div className="mt-3 rounded-md border bg-muted/20 overflow-hidden">
            <table className="w-full text-xs font-mono">
              <tbody>
                {event.changes.map((change: AuditChange) => (
                  <tr
                    key={change.field}
                    className="border-b last:border-0"
                  >
                    <td className="px-2 py-1.5 font-semibold whitespace-nowrap w-32">
                      {change.field}
                    </td>
                    <td className="px-2 py-1.5 text-status-error break-all">
                      {formatChangeValue(change.old_value)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground w-6 text-center">
                      →
                    </td>
                    <td className="px-2 py-1.5 text-primary dark:text-primary break-all">
                      {formatChangeValue(change.new_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface ResourceTimelineProps {
  resourceId: string;
}

export function ResourceTimeline({ resourceId }: ResourceTimelineProps) {
  const [params, setParams] = useState<AuditTimelineParams>({});
  const [showFilters, setShowFilters] = useState(false);
  const t = useT('admin');

  const { data: timeline, isLoading, error, refetch } = useAuditTimeline(
    resourceId,
    params
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="card" className="h-32" label={t('rt.loadingTimeline')} />
        <LoadingSkeleton variant="list" count={5} />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        error={error}
        message={
          error instanceof Error
            ? error.message
            : t('rt.failedLoad')
        }
        onRetry={() => refetch()}
      />
    );
  }

  const eventCount = timeline?.events.length ?? 0;
  const headerTags: PageHeaderTag[] = [];
  if (timeline?.resource_type) {
    headerTags.push({ label: timeline.resource_type, tone: "neutral" });
  }
  headerTags.push({
    label: t('rt.eventsCount', { n: eventCount }),
    tone: "info",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('rt.eyebrow')}
        title={timeline?.resource_name || resourceId}
        description={t('rt.desc')}
        tags={headerTags}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/audit">
              <ArrowLeft className="me-1.5 h-4 w-4" />
              {t('rt.backToAudit')}
            </Link>
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="me-1 h-3.5 w-3.5" />
          {t('rt.filters')}
        </Button>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timeline-action">{t('rt.action')}</Label>
                <Input
                  id="timeline-action"
                  placeholder={t('rt.actionPlaceholder')}
                  value={params.action ?? ""}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      action: e.target.value || undefined,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeline-from">{t('rt.from')}</Label>
                <Input
                  id="timeline-from"
                  type="date"
                  value={params.date_from ?? ""}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      date_from: e.target.value || undefined,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeline-to">{t('rt.to')}</Label>
                <Input
                  id="timeline-to"
                  type="date"
                  value={params.date_to ?? ""}
                  onChange={(e) =>
                    setParams((p) => ({
                      ...p,
                      date_to: e.target.value || undefined,
                    }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      {!timeline?.events.length ? (
        <EmptyState
          icon={Clock}
          size="compact"
          title={t('rt.noEvents')}
          description={t('rt.noEventsDesc')}
        />
      ) : (
        <div className="ps-2">
          {timeline.events.map((event) => (
            <TimelineEventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
