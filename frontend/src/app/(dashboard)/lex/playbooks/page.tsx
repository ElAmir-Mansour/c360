'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Library, Plus, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import type { LexClausePlaybook, LexPlaybookTemplate } from '@/types/suites';
import { clampPercent } from './_components/deviation-meta';
import { DeviationReview } from './_components/deviation-review';
import { usePlaybookLabels } from './_components/labels';
import { useLexLabels } from '../_lib/lex-i18n';
import { PlaybookDialog, PlaybookTemplatePicker } from './_components/playbook-dialog';
import { PlaybookCatalog } from './_components/playbook-catalog';
import { PlaybookKpis } from './_components/playbook-kpis';

const PORTFOLIO_PATH = '/lex/playbooks/portfolio';

export default function LexPlaybooksPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const labels = usePlaybookLabels();
  const { commonActions } = useLexLabels();
  // §9/§13 — playbook authoring is catalog configuration; gate on catalog:manage.
  const canWrite = hasPermission('lex:catalog:manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateSeed, setTemplateSeed] = useState<LexPlaybookTemplate | null>(null);
  const [editingPlaybook, setEditingPlaybook] = useState<LexClausePlaybook | null>(null);
  const [deletePlaybook, setDeletePlaybook] = useState<LexClausePlaybook | null>(null);

  // Headline-metric source. The catalog runs its own paginated query; the KPI
  // cards summarise the full playbook set, so we keep a dedicated wide read.
  const summaryQuery = useQuery({
    queryKey: ['lex-playbooks', 'summary'],
    queryFn: () =>
      enterpriseApi.lex.listPlaybooks({
        page: 1,
        per_page: 100,
        sort: 'updated_at',
        order: 'desc',
      }),
  });

  const contractsQuery = useQuery({
    queryKey: ['lex-playbook-contracts'],
    queryFn: () =>
      enterpriseApi.lex.listContracts({
        page: 1,
        per_page: 50,
        sort: 'updated_at',
        order: 'desc',
      }),
  });

  // Needs-review count (#10): contracts scoring below 80% compliance. We only
  // read `.total` from a 1-row portfolio page filtered by max_score.
  const needsReviewQuery = useQuery({
    queryKey: ['lex-playbook-portfolio', 'needs-review'],
    queryFn: () => enterpriseApi.lex.getPlaybookPortfolio({ max_score: 80, per_page: 1 }),
  });

  // Portfolio compliance signal for the KPI strip: a wide read of scored
  // contracts so we can compute the mean compliance score client-side (no
  // dedicated aggregate endpoint). Sorted worst-first; capped server-side.
  const portfolioStatsQuery = useQuery({
    queryKey: ['lex-playbook-portfolio', 'kpi-stats'],
    queryFn: () =>
      enterpriseApi.lex.getPlaybookPortfolio({
        per_page: 100,
        order: 'asc',
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (playbookId: string) => enterpriseApi.lex.deletePlaybook(playbookId),
    onSuccess: async () => {
      showSuccess(labels.toast.deleted);
      setDeletePlaybook(null);
      await refreshPlaybooks();
    },
    onError: showApiError,
  });

  const contracts = contractsQuery.data?.data ?? [];
  const needsReviewCount = needsReviewQuery.data?.total ?? 0;

  const summary = useMemo(() => {
    const playbooks = summaryQuery.data?.data ?? [];
    const activeCount = playbooks.filter((playbook) => playbook.status === 'active').length;
    const standardClauses = playbooks.reduce((total, playbook) => total + playbook.clauses.length, 0);
    const requiredClauses = playbooks.reduce(
      (total, playbook) => total + playbook.clauses.filter((clause) => clause.required).length,
      0,
    );

    // Mean compliance across scored contracts (0–100). Scores may arrive as a
    // 0–1 fraction or an already-scaled 0–100 percent — clampPercent normalizes.
    const scored = portfolioStatsQuery.data?.data ?? [];
    const avgCompliance =
      scored.length > 0
        ? Math.round(scored.reduce((sum, row) => sum + clampPercent(row.compliance_score), 0) / scored.length)
        : null;

    return {
      total: playbooks.length,
      activeCount,
      standardClauses,
      requiredClauses,
      avgCompliance,
      needsReviewCount,
    };
  }, [summaryQuery.data, portfolioStatsQuery.data, needsReviewCount]);

  const refreshPlaybooks = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lex-playbooks'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-clause-deviations'] }),
      queryClient.invalidateQueries({ queryKey: ['lex-overview'] }),
    ]);
  };

  const openCreate = () => {
    setTemplateSeed(null);
    setCreateOpen(true);
  };

  const onTemplateSelected = (template: LexPlaybookTemplate) => {
    setTemplateSeed(template);
    setTemplatePickerOpen(false);
    setCreateOpen(true);
  };

  return (
    <LexRouteGuard route="/lex/playbooks">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader
          title={labels.page.title}
          description={labels.page.description}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {needsReviewCount > 0 ? (
                <Link href={PORTFOLIO_PATH}>
                  <Badge variant="warning" className="cursor-pointer whitespace-nowrap">
                    {labels.catalog.needsReview(needsReviewCount)}
                  </Badge>
                </Link>
              ) : null}
              <Button variant="outline" asChild>
                <Link href={PORTFOLIO_PATH}>
                  <LayoutGrid className="me-1.5 h-4 w-4" />
                  {labels.catalog.viewPortfolio}
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/lex/library">
                  <Library className="me-1.5 h-4 w-4" aria-hidden />
                  {commonActions.browseLibrary}
                </Link>
              </Button>
              {canWrite ? (
                <>
                  <Button variant="outline" onClick={() => setTemplatePickerOpen(true)}>
                    <Sparkles className="me-1.5 h-4 w-4" />
                    {labels.dialog.newFromTemplate}
                  </Button>
                  <Button onClick={openCreate} className="bg-brand-primary-600 text-white hover:bg-brand-primary-700">
                    <Plus className="me-1.5 h-4 w-4" />
                    {labels.page.createPlaybook}
                  </Button>
                </>
              ) : null}
            </div>
          }
        />

        <PlaybookKpis
          summary={summary}
          loading={summaryQuery.isLoading}
          complianceLoading={portfolioStatsQuery.isLoading || needsReviewQuery.isLoading}
          portfolioHref={PORTFOLIO_PATH}
        />

        <div id="playbook-catalog" className="scroll-mt-24">
          <SectionCard title={labels.catalog.title} description={labels.catalog.description}>
            <PlaybookCatalog
              canWrite={canWrite}
              onEdit={setEditingPlaybook}
              onDelete={setDeletePlaybook}
              onCreate={openCreate}
            />
          </SectionCard>
        </div>

        <DeviationReview
          contracts={contracts}
          contractsLoading={contractsQuery.isLoading}
          contractsError={contractsQuery.isError}
          onRetryContracts={() => void contractsQuery.refetch()}
        />

        {canWrite ? (
          <>
            <PlaybookTemplatePicker
              open={templatePickerOpen}
              onOpenChange={setTemplatePickerOpen}
              onSelect={onTemplateSelected}
            />
            <PlaybookDialog
              open={createOpen}
              templateSeed={templateSeed}
              onOpenChange={(open) => {
                setCreateOpen(open);
                if (!open) {
                  setTemplateSeed(null);
                }
              }}
              onSaved={refreshPlaybooks}
            />
            <PlaybookDialog
              playbook={editingPlaybook}
              open={editingPlaybook != null}
              onOpenChange={(open) => {
                if (!open) {
                  setEditingPlaybook(null);
                }
              }}
              onSaved={refreshPlaybooks}
            />
            <ConfirmDialog
              open={deletePlaybook != null}
              onOpenChange={(open) => {
                if (!open) {
                  setDeletePlaybook(null);
                }
              }}
              title={labels.confirmDelete.title}
              description={
                deletePlaybook ? labels.confirmDelete.description(deletePlaybook.name) : labels.confirmDelete.title
              }
              confirmLabel={labels.confirmDelete.confirmLabel}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={() => {
                if (deletePlaybook) {
                  deleteMutation.mutate(deletePlaybook.id);
                }
              }}
            />
          </>
        ) : null}
      </div>
    </LexRouteGuard>
  );
}
