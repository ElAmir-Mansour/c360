'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpenText,
  Cpu,
  Database,
  ExternalLink,
  Gauge,
  HardDrive,
  HeartPulse,
  LayoutTemplate,
  LockKeyhole,
  Network,
  PlayCircle,
  Server,
  ShieldCheck,
  Sparkles,
  Timer,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { StatCard } from '@/components/shared/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LaunchButton } from './_components/launch-button';
import { ProfileSelector } from './_components/profile-selector';
import { ServerList } from './_components/server-list';
import { TemplateGallery } from './_components/template-gallery';
import { notebookApi, type NotebookProfile, type NotebookServer, type NotebookTemplate } from '@/lib/notebooks';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { showApiError, showSuccess, showWarning } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { ApiError } from '@/types/api';
import { useNotebooksLabels, type NotebooksLabels } from './_lib/notebooks-i18n';

/** Poll every 5 s while any server is transitioning; every 30 s otherwise. */
const POLL_FAST_MS = 5_000;
const POLL_SLOW_MS = 30_000;

function hasTransitioningServer(servers: NotebookServer[] | undefined): boolean {
  return servers?.some((s) => s.status === 'starting' || s.status === 'stopping') ?? false;
}

function formatProfileLabel(profile: string): string {
  return profile
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function difficultyCount(templates: NotebookTemplate[], difficulty: NotebookTemplate['difficulty']): number {
  return templates.filter((template) => template.difficulty === difficulty).length;
}

export default function NotebookWorkspacePage() {
  const t = useNotebooksLabels();
  const queryClient = useQueryClient();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [busyServerId, setBusyServerId] = useState<string | null>(null);
  const [busyTemplateId, setBusyTemplateId] = useState<string | null>(null);

  const healthQuery = useQuery({
    queryKey: ['notebook-health'],
    queryFn: notebookApi.checkHealth,
    refetchInterval: 60_000,
  });

  const profilesQuery = useQuery({
    queryKey: ['notebook-profiles'],
    queryFn: notebookApi.listProfiles,
  });
  const templatesQuery = useQuery({
    queryKey: ['notebook-templates'],
    queryFn: notebookApi.listTemplates,
  });

  // Adaptive polling: faster while a server is starting or stopping so the
  // UI reflects the state transition promptly without hammering the API at rest.
  const serversQuery = useQuery({
    queryKey: ['notebook-servers'],
    queryFn: notebookApi.listServers,
    refetchInterval: (query) =>
      hasTransitioningServer(query.state.data) ? POLL_FAST_MS : POLL_SLOW_MS,
  });

  const activeServer = useMemo<NotebookServer | null>(
    () => serversQuery.data?.find((server) => server.status === 'running' || server.status === 'starting') ?? null,
    [serversQuery.data],
  );
  const servers = serversQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];
  const templates = templatesQuery.data ?? [];

  // Real summary metrics for the tonal strip: live server count, governed
  // template count, and hub health. Each maps onto a semantic tone.
  const runningServers = servers.filter(
    (server) => server.status === 'running' || server.status === 'starting',
  ).length;
  const transitioningServers = servers.filter(
    (server) => server.status === 'starting' || server.status === 'stopping',
  ).length;
  const templateCount = templates.length;
  const profileCount = profiles.length;
  const sparkProfileCount = profiles.filter((profile) => profile.spark_enabled).length;
  const hubHealthy = healthQuery.isSuccess && healthQuery.data.status === 'ok';
  const hubUnavailable = healthQuery.isSuccess && !hubHealthy;
  const hubStatusLabel = healthQuery.isLoading
    ? t.page.hubChecking
    : hubHealthy
      ? t.page.hubReachable
      : t.page.hubDegraded;
  const hubStatusTone = healthQuery.isLoading ? 'info' : hubHealthy ? 'success' : 'danger';
  const totalMemoryMB = servers.reduce((sum, server) => sum + (server.memory_mb || 0), 0);
  const totalMemoryLimitMB = servers.reduce((sum, server) => sum + (server.memory_limit_mb || 0), 0);
  const activeProfile = activeServer ? formatProfileLabel(activeServer.profile || 'notebook-server') : t.page.noServer;
  const lastActivityLabel = activeServer?.last_activity
    ? formatDistanceToNow(new Date(activeServer.last_activity), { addSuffix: true })
    : t.page.notActive;

  const startMutation = useMutation({
    mutationFn: (profile: NotebookProfile) => notebookApi.startServer(profile.slug),
    onSuccess: async (server) => {
      showSuccess(t.toasts.serverRequested, t.toasts.serverStarting(server.profile));
      setSelectorOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['notebook-servers'] });
    },
    onError: (error) => {
      if (isNotebookHubUnavailable(error)) {
        showWarning(
          t.toasts.serviceUnavailableTitle,
          t.toasts.serviceUnavailableBody,
        );
        void healthQuery.refetch();
        return;
      }
      showApiError(error);
    },
  });

  const stopMutation = useMutation({
    mutationFn: (server: NotebookServer) => notebookApi.stopServer(server.id),
    // Set busy state immediately on mutation start so the button disables
    // before the async mutationFn even begins (prevents duplicate clicks).
    onMutate: (server) => setBusyServerId(server.id),
    onSuccess: async () => {
      showSuccess(t.toasts.serverStopped);
      await queryClient.invalidateQueries({ queryKey: ['notebook-servers'] });
    },
    onError: showApiError,
    onSettled: () => setBusyServerId(null),
  });

  const copyMutation = useMutation({
    mutationFn: (template: NotebookTemplate) => {
      if (!activeServer) {
        throw new Error(t.toasts.launchServerBeforeTemplate);
      }
      return notebookApi.copyTemplate(activeServer.id, template.id);
    },
    onMutate: (template) => setBusyTemplateId(template.id),
    onSuccess: async (result) => {
      showSuccess(t.toasts.templateCopied, t.toasts.templateOpening);
      window.open(result.open_url, '_blank', 'noopener,noreferrer');
      await queryClient.invalidateQueries({ queryKey: ['notebook-servers'] });
    },
    onError: showApiError,
    onSettled: () => setBusyTemplateId(null),
  });

  return (
    <PermissionRedirect permission="*:read">
      <div className="space-y-6">
        {hubUnavailable && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {t.page.hubUnreachableAlert}
              {healthQuery.data.jupyterhub.error ? ` (${healthQuery.data.jupyterhub.error})` : ''}
            </AlertDescription>
          </Alert>
        )}
        <PageHeader
          eyebrow={t.page.eyebrow}
          title={t.page.title}
          description={t.page.description}
          tags={[
            {
              label: hubStatusLabel,
              tone: hubStatusTone,
              icon: <HeartPulse className="h-3.5 w-3.5" />,
            },
            {
              label: t.page.profilesTag(profileCount),
              tone: 'info',
              icon: <Cpu className="h-3.5 w-3.5" />,
            },
            {
              label: t.page.templatesTag(templateCount),
              tone: 'primary',
              icon: <LayoutTemplate className="h-3.5 w-3.5" />,
            },
          ]}
          stats={[
            { label: t.page.activeProfile, value: activeProfile },
            { label: t.page.lastActivity, value: lastActivityLabel },
          ]}
          actions={
            <>
              {activeServer ? (
                <Button asChild variant="outline">
                  <a href={activeServer.url} target="_blank" rel="noreferrer">
                    {t.page.openActiveLab}
                    <ExternalLink className="ms-2 h-4 w-4" />
                  </a>
                </Button>
              ) : null}
              <LaunchButton
                label={t.page.launchNotebook}
                disabled={Boolean(activeServer) || !hubHealthy || healthQuery.isLoading}
                onClick={() => setSelectorOpen(true)}
              />
            </>
          }
        />

        {/* Tonal summary strip — live servers ride `emerald` (health/running),
            templates ride `sky` (count), hub health is emerald/rose. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label={t.stats.liveServers} value={runningServers} tone="emerald" icon={Server} />
          <StatCard
            label={t.stats.transitioning}
            value={transitioningServers}
            tone={transitioningServers > 0 ? 'gold' : 'slate'}
            icon={Timer}
          />
          <StatCard label={t.stats.templates} value={templateCount} tone="sky" icon={LayoutTemplate} />
          <StatCard
            label={t.stats.jupyterhub}
            value={hubHealthy ? t.stats.healthy : t.stats.degraded}
            tone={healthQuery.isLoading ? 'sky' : hubHealthy ? 'emerald' : 'rose'}
            icon={HeartPulse}
          />
        </div>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.85fr)] xl:gap-5">
          <Card>
            <CardHeader className="border-b border-border/60">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                    <BookOpenText className="h-6 w-6" />
                  </div>
                  <div>
                    <CardTitle className="text-xl">{t.servers.title}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {activeServer?.last_activity
                        ? t.servers.activityUpdated(formatDistanceToNow(new Date(activeServer.last_activity), { addSuffix: true }))
                        : t.servers.launchHint}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs sm:min-w-72">
                  <MetricTile icon={Gauge} label={t.servers.cpuLoad} value={`${Math.round(activeServer?.cpu_percent ?? 0)}%`} />
                  <MetricTile
                    icon={HardDrive}
                    label={t.servers.memory}
                    value={
                      totalMemoryLimitMB > 0
                        ? `${Math.round(totalMemoryMB)} / ${Math.round(totalMemoryLimitMB)} MB`
                        : '0 MB'
                    }
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <ServerList
                servers={servers}
                busyServerId={busyServerId}
                onStop={(server) => stopMutation.mutate(server)}
              />
            </CardContent>
          </Card>

          <div className="space-y-4">
            <ProfileLaunchPanel
              t={t}
              profiles={profiles}
              activeServer={activeServer}
              hubHealthy={hubHealthy}
              busy={startMutation.isPending}
              onSelect={(profile) => startMutation.mutate(profile)}
              onBrowseProfiles={() => setSelectorOpen(true)}
            />
            <OperationsPanel
              t={t}
              hubHealthy={hubHealthy}
              healthError={healthQuery.data?.jupyterhub.error}
              profileCount={profileCount}
              sparkProfileCount={sparkProfileCount}
              templateCount={templateCount}
              activeServer={activeServer}
            />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-h3 font-semibold">{t.templates.title}</h2>
              <p className="text-sm text-muted-foreground">{t.templates.description}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{t.templates.beginnerCount(difficultyCount(templates, 'beginner'))}</Badge>
              <Badge variant="secondary">{t.templates.intermediateCount(difficultyCount(templates, 'intermediate'))}</Badge>
              <Badge variant="secondary">{t.templates.advancedCount(difficultyCount(templates, 'advanced'))}</Badge>
            </div>
          </div>
          <TemplateGallery
            templates={templates}
            activeServer={activeServer}
            busyTemplateId={busyTemplateId}
            onOpenTemplate={(template) => copyMutation.mutate(template)}
          />
        </section>

        <ProfileSelector
          open={selectorOpen}
          onOpenChange={setSelectorOpen}
          profiles={profilesQuery.data ?? []}
          busy={startMutation.isPending}
          disabled={!hubHealthy}
          unavailableReason={healthQuery.data?.jupyterhub.error}
          onSelect={(profile) => startMutation.mutate(profile)}
        />
      </div>
    </PermissionRedirect>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-overline font-semibold uppercase tracking-caps-wide">{label}</span>
      </div>
      <p className="mt-2 text-sm font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function ProfileLaunchPanel({
  t,
  profiles,
  activeServer,
  hubHealthy,
  busy,
  onSelect,
  onBrowseProfiles,
}: {
  t: NotebooksLabels;
  profiles: NotebookProfile[];
  activeServer: NotebookServer | null;
  hubHealthy: boolean;
  busy: boolean;
  onSelect: (profile: NotebookProfile) => void;
  onBrowseProfiles: () => void;
}) {
  const featuredProfiles = profiles.slice(0, 3);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{t.profiles.title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t.profiles.description}</p>
          </div>
          <Badge variant={activeServer ? 'success' : 'outline'}>
            {activeServer ? t.profiles.serverActive : t.profiles.readyCount(profiles.length)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hubHealthy ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-warning-700 dark:text-warning-300">
            {t.profiles.healthPaused}
          </div>
        ) : null}
        {featuredProfiles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
            {t.profiles.emptyProfiles}
          </div>
        ) : (
          featuredProfiles.map((profile) => (
            <ProfileRow
              key={profile.slug}
              t={t}
              profile={profile}
              disabled={Boolean(activeServer) || busy || !hubHealthy}
              onSelect={onSelect}
            />
          ))
        )}
        {profiles.length > featuredProfiles.length ? (
          <Button
            variant="outline"
            className="w-full"
            onClick={onBrowseProfiles}
            disabled={Boolean(activeServer) || !hubHealthy}
          >
            {t.profiles.viewAll}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function isNotebookHubUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const apiError = error as Partial<ApiError>;
  return (
    apiError.status === 502 ||
    apiError.status === 503 ||
    apiError.code === 'BAD_GATEWAY' ||
    apiError.code === 'SERVICE_UNAVAILABLE'
  );
}

function ProfileRow({
  t,
  profile,
  disabled,
  onSelect,
}: {
  t: NotebooksLabels;
  profile: NotebookProfile;
  disabled: boolean;
  onSelect: (profile: NotebookProfile) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{t.profiles.profileSuffix(profile.display_name)}</p>
            {profile.default ? <Badge variant="success">{t.profiles.defaultBadge}</Badge> : null}
            {profile.spark_enabled ? <Badge variant="outline">{t.profiles.sparkBadge}</Badge> : null}
          </div>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{profile.description}</p>
        </div>
        <Button size="sm" disabled={disabled} onClick={() => onSelect(profile)}>
          <PlayCircle className="me-1.5 h-3.5 w-3.5" />
          {t.profiles.start}
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-caption text-muted-foreground">
        <span className="rounded-md bg-muted/50 px-2 py-1">{t.profiles.cpu} {profile.cpu}</span>
        <span className="rounded-md bg-muted/50 px-2 py-1">{t.profiles.ram} {profile.memory}</span>
        <span className="rounded-md bg-muted/50 px-2 py-1">{t.profiles.disk} {profile.storage}</span>
      </div>
    </div>
  );
}

function OperationsPanel({
  t,
  hubHealthy,
  healthError,
  profileCount,
  sparkProfileCount,
  templateCount,
  activeServer,
}: {
  t: NotebooksLabels;
  hubHealthy: boolean;
  healthError?: string;
  profileCount: number;
  sparkProfileCount: number;
  templateCount: number;
  activeServer: NotebookServer | null;
}) {
  const items = [
    {
      icon: HeartPulse,
      label: t.operations.hubStatus,
      value: hubHealthy ? t.operations.available : t.operations.degraded,
      tone: 'text-success-600',
      danger: !hubHealthy,
      detail: healthError ?? t.operations.hubCheckDetail,
    },
    {
      icon: ShieldCheck,
      label: t.operations.governance,
      value: t.operations.ssoEnforced,
      tone: 'text-sky-600',
      detail: t.operations.governanceDetail,
    },
    {
      icon: Sparkles,
      label: t.operations.sparkProfiles,
      value: t.operations.sparkOf(sparkProfileCount, profileCount),
      tone: 'text-violet-600',
      detail: t.operations.sparkDetail,
    },
    {
      icon: LayoutTemplate,
      label: t.operations.templateLibrary,
      value: t.operations.templateCount(templateCount),
      tone: 'text-warning-700 dark:text-warning-300',
      detail: activeServer ? t.operations.templateReadyDetail : t.operations.templateLaunchDetail,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.operations.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/70 p-3">
            {(() => {
              const Icon = item.icon;
              return (
                <div className={cn('rounded-lg bg-muted/60 p-2', item.danger ? 'text-rose-600' : item.tone)}>
                  <Icon className="h-4 w-4" />
                </div>
              );
            })()}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="text-xs font-semibold uppercase tracking-caps-wide text-muted-foreground">{item.label}</p>
                <p className="text-sm font-semibold text-foreground">{item.value}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.detail}</p>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border/60 bg-background/70 p-3 text-center">
          <ReadinessMini icon={LockKeyhole} label={t.operations.access} value={t.operations.accessValue} />
          <ReadinessMini icon={Network} label={t.operations.network} value={t.operations.networkValue} />
          <ReadinessMini icon={Database} label={t.operations.data} value={t.operations.dataValue} />
        </div>
      </CardContent>
    </Card>
  );
}

function ReadinessMini({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <Icon className="mx-auto h-4 w-4 text-primary" />
      <p className="text-overline font-semibold uppercase tracking-caps-wide text-muted-foreground">{label}</p>
      <p className="text-xs font-medium text-foreground">{value}</p>
    </div>
  );
}
