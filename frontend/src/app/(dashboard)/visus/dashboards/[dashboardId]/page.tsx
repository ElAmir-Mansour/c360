'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LayoutGrid, LayoutTemplate, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { RelativeTime } from '@/components/shared/relative-time';
import { enterpriseApi } from '@/lib/enterprise';
import { safeJsonPreview, sortWidgetsByLayout } from '@/lib/enterprise/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import type { VisusKPIDefinition, VisusWidget } from '@/types/suites';
import { compactWidgetPositions } from '../../_components/form-utils';
import { WidgetFormDialog } from './_components/widget-form-dialog';
import { WidgetPreviewDialog } from './_components/widget-preview-dialog';
import { WidgetRenderer } from './_widgets/widget-renderer';
import { pickEnumLabel, useVisusDashboardDetailLabels, useVisusEnumLabels } from '../../_lib/visus-i18n';

export default function VisusDashboardDetailPage() {
  const t = useVisusDashboardDetailLabels();
  const enums = useVisusEnumLabels();
  const params = useParams<{ dashboardId: string }>();
  const queryClient = useQueryClient();
  const dashboardId = params?.dashboardId ?? '';
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<VisusWidget | null>(null);
  const [previewWidget, setPreviewWidget] = useState<VisusWidget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VisusWidget | null>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('view');

  const dashboardQuery = useQuery({
    queryKey: ['visus-dashboard-detail', dashboardId],
    queryFn: () => enterpriseApi.visus.getDashboard(dashboardId),
  });
  const widgetTypesQuery = useQuery({
    queryKey: ['visus-widget-types'],
    queryFn: () => enterpriseApi.visus.listWidgetTypes(),
  });
  const kpisQuery = useQuery({
    queryKey: ['visus-widget-kpis'],
    queryFn: () => enterpriseApi.visus.listKpis({ page: 1, per_page: 200, sort: 'name', order: 'asc' }),
  });

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => enterpriseApi.visus.createWidget(dashboardId, payload),
    onSuccess: async () => {
      showSuccess(t.toastWidgetCreated);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboard-detail', dashboardId] });
      setWidgetOpen(false);
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: unknown }) => enterpriseApi.visus.updateWidget(dashboardId, id, payload),
    onSuccess: async () => {
      showSuccess(t.toastWidgetUpdated);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboard-detail', dashboardId] });
      setEditingWidget(null);
      setWidgetOpen(false);
    },
    onError: showApiError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => enterpriseApi.visus.deleteWidget(dashboardId, id),
    onSuccess: async () => {
      showSuccess(t.toastWidgetDeleted);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboard-detail', dashboardId] });
      setDeleteTarget(null);
    },
    onError: showApiError,
  });

  const arrangeMutation = useMutation({
    mutationFn: (widgets: VisusWidget[]) => enterpriseApi.visus.updateWidgetLayout(dashboardId, compactWidgetPositions(widgets)),
    onSuccess: async () => {
      showSuccess(t.toastLayoutNormalized);
      await queryClient.invalidateQueries({ queryKey: ['visus-dashboard-detail', dashboardId] });
    },
    onError: showApiError,
  });

  const dashboard = dashboardQuery.data;
  const widgets = sortWidgetsByLayout(dashboard?.widgets ?? []);
  const widgetTypes = widgetTypesQuery.data ?? [];
  const kpis = (kpisQuery.data?.data ?? []) as VisusKPIDefinition[];

  if (dashboardQuery.isLoading) {
    return (
      <PermissionRedirect permission="visus:read">
        <div className="space-y-6">
          <LoadingSkeleton variant="card" count={2} />
        </div>
      </PermissionRedirect>
    );
  }

  if (dashboardQuery.isError || !dashboard) {
    return (
      <PermissionRedirect permission="visus:read">
        <ErrorState
          title={t.errorTitle}
          message={t.errorMessage}
          onRetry={() => void dashboardQuery.refetch()}
        />
      </PermissionRedirect>
    );
  }

  return (
    <PermissionRedirect permission="visus:read">
      <div className="space-y-6">
        <PageHeader
          title={dashboard.name}
          description={dashboard.description}
          actions={
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/visus/dashboards">
                  <ArrowLeft className="me-2 h-4 w-4" />
                  {t.backToDashboards}
                </Link>
              </Button>
              <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label={t.viewModeAria}>
                <Button
                  variant={mode === 'view' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={mode === 'view'}
                  onClick={() => setMode('view')}
                >
                  <LayoutGrid className="me-2 h-4 w-4" />
                  {t.viewMode}
                </Button>
                <Button
                  variant={mode === 'edit' ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={mode === 'edit'}
                  onClick={() => setMode('edit')}
                >
                  <Settings2 className="me-2 h-4 w-4" />
                  {t.editMode}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={widgets.length < 2 || arrangeMutation.isPending}
                onClick={() => arrangeMutation.mutate(widgets)}
              >
                <Sparkles className="me-2 h-4 w-4" />
                {arrangeMutation.isPending ? t.arranging : t.autoArrange}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setEditingWidget(null);
                  setWidgetOpen(true);
                }}
              >
                <Plus className="me-2 h-4 w-4" />
                {t.addWidget}
              </Button>
            </>
          }
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          <DetailStatCard
            label={t.statVisibility}
            tone="slate"
            value={
              <div className="space-y-2">
                <span className="capitalize">{pickEnumLabel(enums.visibility, dashboard.visibility)}</span>
                {(dashboard.is_default || dashboard.is_system) && (
                  <div className="flex flex-wrap gap-2">
                    {dashboard.is_default ? <Badge variant="secondary">{t.badgeDefault}</Badge> : null}
                    {dashboard.is_system ? <Badge variant="outline">{t.badgeSystem}</Badge> : null}
                  </div>
                )}
              </div>
            }
          />
          <DetailStatCard
            label={t.statWidgets}
            tone="sky"
            value={widgets.length}
            helper={t.gridColumns(dashboard.grid_columns)}
          />
          <DetailStatCard
            label={t.statUpdated}
            tone="gold"
            value={
              <div className="space-y-1">
                <RelativeTime date={dashboard.updated_at} />
                <p className="text-xs font-normal text-muted-foreground">
                  {t.createdPrefix} <RelativeTime date={dashboard.created_at} />
                </p>
              </div>
            }
          />
          <DetailStatCard
            label={t.statTags}
            tone="sky"
            value={
              <div className="space-y-2">
                <span>{dashboard.tags.length}</span>
                <div className="flex flex-wrap gap-2">
                  {dashboard.tags.length > 0 ? (
                    dashboard.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm font-normal text-muted-foreground">{t.noTags}</span>
                  )}
                </div>
              </div>
            }
          />
        </div>

        {widgets.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title={t.emptyTitle}
            description={t.emptyDescription}
            action={{
              label: t.addWidget,
              onClick: () => {
                setEditingWidget(null);
                setWidgetOpen(true);
              },
            }}
          />
        ) : (
          <div className="grid auto-rows-[84px] grid-cols-12 gap-4">
            {widgets.map((widget) => {
              const gridStyle = {
                gridColumn: `span ${widget.position.w} / span ${widget.position.w}`,
                gridRow: `span ${widget.position.h} / span ${widget.position.h}`,
              };
              if (mode === 'view') {
                return (
                  <WidgetRenderer
                    key={widget.id}
                    dashboardId={dashboardId}
                    widget={widget}
                    style={gridStyle}
                    onEdit={(w) => {
                      setEditingWidget(w);
                      setWidgetOpen(true);
                    }}
                    onDelete={(w) => setDeleteTarget(w)}
                    onPreviewRaw={(w) => setPreviewWidget(w)}
                  />
                );
              }
              return (
                <Card
                  key={widget.id}
                  style={gridStyle}
                  className="card-interactive overflow-hidden"
                >
                <CardHeader className="space-y-2 pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">{widget.title}</CardTitle>
                      {widget.subtitle ? <CardDescription>{widget.subtitle}</CardDescription> : null}
                    </div>
                    <Badge variant="outline">{pickEnumLabel(enums.widgetType, widget.type)}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>
                      x:{widget.position.x} y:{widget.position.y}
                    </span>
                    <span>
                      {widget.position.w}x{widget.position.h}
                    </span>
                    <span>{t.refreshSuffix(widget.refresh_interval_seconds)}</span>
                  </div>
                  <pre className="max-h-36 overflow-auto rounded-lg border bg-muted/40 p-3 text-caption leading-5">
                    {safeJsonPreview(widget.config)}
                  </pre>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPreviewWidget(widget)}>
                      {t.previewData}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingWidget(widget);
                        setWidgetOpen(true);
                      }}
                    >
                      {t.editWidget}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(widget)}>
                      <Trash2 className="me-1.5 h-3.5 w-3.5" />
                      {t.deleteWidget}
                    </Button>
                  </div>
                </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <WidgetFormDialog
          open={widgetOpen}
          onOpenChange={(open) => {
            setWidgetOpen(open);
            if (!open) {
              setEditingWidget(null);
            }
          }}
          dashboard={dashboard}
          widget={editingWidget}
          widgetTypes={widgetTypes}
          kpis={kpis}
          pending={createMutation.isPending || updateMutation.isPending}
          onSubmit={async (payload) => {
            if (editingWidget) {
              // Strip `type` — backend UpdateWidgetRequest does not accept it
              // (DecodeJSON uses DisallowUnknownFields).
              const { type: _type, ...updatePayload } = payload as Record<string, unknown>;
              await updateMutation.mutateAsync({ id: editingWidget.id, payload: updatePayload });
              return;
            }
            await createMutation.mutateAsync(payload);
          }}
        />

        <WidgetPreviewDialog
          dashboardId={dashboardId}
          widget={previewWidget}
          open={Boolean(previewWidget)}
          onOpenChange={(open) => {
            if (!open) setPreviewWidget(null);
          }}
        />

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          title={t.deleteWidgetTitle}
          description={t.deleteWidgetDescription(deleteTarget?.title ?? '')}
          confirmLabel={t.deleteWidgetConfirm}
          variant="destructive"
          loading={deleteMutation.isPending}
          onConfirm={async () => {
            if (!deleteTarget) return;
            await deleteMutation.mutateAsync(deleteTarget.id);
          }}
        />
      </div>
    </PermissionRedirect>
  );
}
