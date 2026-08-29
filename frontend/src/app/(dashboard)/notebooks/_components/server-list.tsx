'use client';

import { formatDistanceToNow } from 'date-fns';
import { Activity, Clock3, ExternalLink, Server, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ResourceUsage } from './resource-usage';
import type { NotebookServer } from '@/lib/notebooks';
import { cn } from '@/lib/utils';
import { useNotebooksLabels } from '../_lib/notebooks-i18n';

function formatProfileLabel(profile: string): string {
  return profile
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

interface ServerListProps {
  servers: NotebookServer[];
  busyServerId: string | null;
  onStop: (server: NotebookServer) => void;
}

export function ServerList({ servers, busyServerId, onStop }: ServerListProps) {
  const t = useNotebooksLabels();
  if (servers.length === 0) {
    return (
      <div className="grid gap-4 rounded-2xl border border-dashed border-border/70 bg-background/70 p-5 text-sm text-muted-foreground md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Server className="h-7 w-7" />
        </div>
        <div>
          <p className="font-medium text-foreground">{t.servers.emptyTitle}</p>
          <p className="mt-1">{t.servers.emptyDescription}</p>
          <div className="mt-4 grid gap-2 text-xs sm:grid-cols-3">
            <EmptyStep label="1" value={t.servers.stepChooseProfile} />
            <EmptyStep label="2" value={t.servers.stepStartPod} />
            <EmptyStep label="3" value={t.servers.stepOpenTemplate} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {servers.map((server) => (
        <div key={server.id} className="overflow-hidden rounded-2xl border border-border/70 bg-background/70">
          <div className="flex flex-col gap-4 border-b border-border/60 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <h3 className="text-h4 font-semibold text-foreground">
                  {formatProfileLabel(server.profile || 'notebook-server')}
                </h3>
                <Badge
                  variant={server.status === 'running' ? 'success' : 'secondary'}
                  className={cn(server.status === 'starting' && 'border-warning-300/60 bg-warning-50 text-warning-700')}
                >
                  {server.status}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" />
                  {server.started_at
                    ? t.servers.startedAgo(formatDistanceToNow(new Date(server.started_at), { addSuffix: true }))
                    : t.servers.startedRecently}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  {server.last_activity
                    ? t.servers.lastActivityAgo(formatDistanceToNow(new Date(server.last_activity), { addSuffix: true }))
                    : t.servers.lastActivityUnknown}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button asChild variant="outline" size="sm">
                <a href={server.url} target="_blank" rel="noreferrer">
                  {t.servers.openJupyterLab}
                  <ExternalLink className="ms-2 h-4 w-4" />
                </a>
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={busyServerId === server.id}
                onClick={() => onStop(server)}
              >
                <Square className="me-2 h-4 w-4" />
                {t.servers.stopServer}
              </Button>
            </div>
          </div>
          <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <ResourceUsage
              cpuPercent={server.cpu_percent}
              memoryMB={server.memory_mb}
              memoryLimitMB={server.memory_limit_mb}
            />
            <div className="grid grid-cols-2 gap-2 text-xs lg:w-56">
              <RuntimePill label={t.servers.cpuLoad} value={`${server.cpu_percent.toFixed(0)}%`} />
              <RuntimePill label={t.servers.ramUsed} value={`${server.memory_mb} MB`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyStep({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/70 px-3 py-2">
      <span className="me-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-caption font-semibold text-primary">
        {label}
      </span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}

function RuntimePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/70 px-3 py-2">
      <p className="text-overline font-semibold uppercase tracking-caps-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
