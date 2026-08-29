'use client';

/**
 * Case & Investigation — Control & Monitoring Panel (`/lex/cases/control`).
 *
 * A monitoring dashboard over the litigation + investigation portfolio: headline
 * KPIs, recent case/investigation tables, and case-type breakdowns. Every number
 * comes from the consolidated
 * `/dashboard/cases-control` backend read model. Static sibling of `[id]`, so
 * `/lex/cases/control` resolves here and never collides with a case detail route.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, Plus, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { LexRouteGuard } from '../../_guards/lex-route-guard';
import { CaseFormDialog } from '../_components/case-form-dialog';
import { useControlPanel } from './_lib/use-control-panel';
import { useControlPanelLabels } from './_lib/labels';
import {
  isWithinActivityWindow,
  type ActivityWindowDays,
} from './_lib/activity-window';
import { ControlKpis } from './_components/control-kpis';
import { RecentCasesCard } from './_components/recent-cases-card';
import { CasesByTypeCard } from './_components/cases-by-type-card';
import { ActiveInvestigationsCard } from './_components/active-investigations-card';
import { ManagerControlNav } from './_components/manager-control-nav';

function SectionError({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm"
    >
      <h2 className="text-h4 font-semibold text-foreground">{title}</h2>
      <p className="mx-auto mt-2 max-w-prose text-body-sm text-muted-foreground">
        {message}
      </p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

function ControlPanelContent() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const t = useControlPanelLabels();
  const panel = useControlPanel();
  const canAddCase = hasPermission('lex:case:add');
  const canAssign = hasPermission('lex:case:assign');
  const [createOpen, setCreateOpen] = useState(false);
  const [activityWindow, setActivityWindow] = useState<ActivityWindowDays>(30);
  const recentCases = useMemo(
    () =>
      panel.recentCases.filter((item) =>
        isWithinActivityWindow(item.updated_at, panel.generatedAt, activityWindow),
      ),
    [activityWindow, panel.generatedAt, panel.recentCases],
  );
  const recentInvestigations = useMemo(
    () =>
      panel.recentInvestigations.filter((item) =>
        isWithinActivityWindow(item.updated_at, panel.generatedAt, activityWindow),
      ),
    [activityWindow, panel.generatedAt, panel.recentInvestigations],
  );
  const activityOptions: Array<{ days: ActivityWindowDays; label: string }> = [
    { days: 1, label: t.page.today },
    { days: 7, label: t.page.sevenDays },
    { days: 30, label: t.page.thirtyDays },
  ];

  return (
    <div dir={direction} lang={locale} className="space-y-6">
      <header className="space-y-4">
        <div className="inline-flex max-w-full flex-wrap items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
          <span>{t.page.role}</span>
          <span className="text-muted-foreground" aria-hidden>·</span>
          <span className="text-muted-foreground">{t.page.roleContext}</span>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              {t.page.title}
            </h1>
            <p className="mt-2 text-body-sm font-medium text-muted-foreground">
              {t.page.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label={t.page.activityWindow}
              className="flex flex-wrap items-center gap-2"
            >
              {activityOptions.map((option) => {
                const selected = option.days === activityWindow;
                return (
                  <Button
                    key={option.days}
                    type="button"
                    variant={selected ? 'default' : 'outline'}
                    size="sm"
                    aria-pressed={selected}
                    onClick={() => setActivityWindow(option.days)}
                    className={cn(
                      'h-9 gap-1.5 rounded-lg px-3 text-sm font-semibold',
                      selected
                        ? 'shadow-none'
                        : 'bg-card text-foreground hover:border-primary/50 hover:bg-primary/5',
                    )}
                  >
                    <CalendarDays className="h-4 w-4" aria-hidden />
                    {option.label}
                  </Button>
                );
              })}
            </div>
            {canAddCase ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="me-1.5 h-4 w-4" aria-hidden />
                {t.page.addCase}
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <ManagerControlNav />

      {panel.isError ? (
        <SectionError
          title={t.states.errorTitle}
          message={t.states.errorBody}
          retryLabel={t.states.retry}
          onRetry={panel.refetch}
        />
      ) : (
        <>
          <ControlKpis kpis={panel.kpis} loading={panel.isLoading} />

          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1.9fr)_minmax(300px,1fr)]">
            <div className="space-y-6">
              <RecentCasesCard
                cases={recentCases}
                loading={panel.isLoading}
                canAssign={canAssign}
              />
              <ActiveInvestigationsCard
                investigations={recentInvestigations}
                loading={panel.isLoading}
                canAssign={canAssign}
              />
            </div>
            <div className="space-y-6">
              <CasesByTypeCard slices={panel.caseTypes} loading={panel.isLoading} />
              <CasesByTypeCard
                slices={panel.investigationTypes}
                loading={panel.isLoading}
                kind="investigations"
              />
            </div>
          </div>
        </>
      )}

      <CaseFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(legalCase) => router.push(`/lex/cases/${legalCase.id}`)}
      />
    </div>
  );
}

export default function LexCaseControlPanelPage() {
  return (
    <LexRouteGuard route="/lex/cases/control">
      <ControlPanelContent />
    </LexRouteGuard>
  );
}
