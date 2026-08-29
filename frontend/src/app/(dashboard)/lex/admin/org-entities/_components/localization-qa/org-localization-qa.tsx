'use client';

/**
 * Bilingual completeness QA panel (Watheeq / Saudi) — CAP for the Lex
 * Legal-Affairs org-entity admin. Fetches the full org-entity registry, scans
 * every entity name and role label for AR/EN completeness, and surfaces the
 * coverage KPIs plus a deep-linkable list of missing translations. Writes are
 * out of scope: each row links to the entity's existing edit form.
 *
 * Mount this on the org-entities list page inside the "Health & QA" section,
 * alongside the escalation/health panel. It is fully self-contained (owns its
 * own query, loading, empty, and error states) and requires no props.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Languages } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { lexAdminApi, type OrgEntity } from '@/lib/lex/admin';
import { exportCsv } from '../../../_lib/admin-feature-utils';
import { scanLocalization, type LocalizationGap } from '../../_lib/org-localization';
import { localizationQaLabels } from '../../_lib/localization-qa-i18n';
import { LocalizationCoverageKpi } from './localization-coverage-kpi';
import { MissingTranslationRow } from './missing-translation-row';

/** Defensive cap so an unbounded registry can't spin forever. */
const PER_PAGE = 100;
const MAX_PAGES = 50;

/** Fetch every org entity by walking the paginated endpoint to exhaustion. */
async function fetchAllOrgEntities(): Promise<OrgEntity[]> {
  const all: OrgEntity[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await lexAdminApi.listOrgEntities({ page, per_page: PER_PAGE });
    all.push(...res.data);
    const totalPages = res.meta?.total_pages ?? 1;
    if (page >= totalPages || res.data.length === 0) break;
  }
  return all;
}

export default function OrgLocalizationQa() {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? localizationQaLabels.ar : localizationQaLabels.en;

  const {
    data: entities,
    isPending,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['lex-admin-org-entities', 'l10n'],
    queryFn: fetchAllOrgEntities,
  });

  const scan = useMemo(() => scanLocalization(entities ?? []), [entities]);

  function handleExport() {
    const rows = scan.items.map((gap: LocalizationGap) => ({
      [t.csvHeaders.entity_code]: gap.entityCode,
      [t.csvHeaders.scope]: gap.scope,
      [t.csvHeaders.role_key]: gap.roleKey ?? '',
      [t.csvHeaders.missing_side]: gap.missing,
      [t.csvHeaders.present_text]: gap.present,
    }));
    exportCsv('org-missing-translations.csv', rows);
  }

  const headerActions =
    !isPending && !isError && scan.items.length > 0 ? (
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download className="me-2 h-4 w-4" aria-hidden />
        {t.exportButton}
      </Button>
    ) : null;

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <Languages className="h-4 w-4 text-primary" aria-hidden />
          {t.title}
        </span>
      }
      description={t.description}
      actions={headerActions}
    >
      {isPending ? (
        <div className="space-y-4">
          <LoadingSkeleton variant="kpi" count={3} label={t.loadingLabel} />
          <LoadingSkeleton variant="list" count={4} label={t.loadingLabel} />
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertTriangle}
          title={t.errorTitle}
          description={t.errorDescription}
          action={{ label: t.retry, onClick: () => void refetch() }}
          size="compact"
        />
      ) : (
        <div className="space-y-6">
          <LocalizationCoverageKpi coverage={scan.coverage} labels={t} />

          {scan.items.length === 0 ? (
            <EmptyState icon={CheckCircle2} title={t.emptyTitle} description={t.emptyDescription} size="compact" />
          ) : (
            <div id="localization-qa-records" className="scroll-mt-24 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-foreground">{t.missingTitle}</h4>
                <Badge variant="warning">{t.missingCount(scan.items.length)}</Badge>
              </div>
              <ul
                className="divide-y divide-border/70 rounded-lg border border-border/70 bg-card/40"
                aria-busy={isFetching}
              >
                {scan.items.map((gap) => (
                  <MissingTranslationRow
                    key={`${gap.entityId}:${gap.scope}:${gap.roleKey ?? 'name'}`}
                    gap={gap}
                    labels={t}
                  />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
