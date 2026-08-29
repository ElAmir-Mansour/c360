'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Gauge, Plus, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { Button } from '@/components/ui/button';
import { useDataTable } from '@/hooks/use-data-table';
import { useAuth } from '@/hooks/use-auth';
import { useLocale } from '@/components/providers/locale-provider';
import { fetchSuitePaginated } from '@/lib/suite-api';
import type { FetchParams } from '@/types/table';
import type { LegalCase } from '@/lib/lex/cases';
import { CaseFormDialog } from './_components/case-form-dialog';
import { useCaseLabels } from './_components/labels';
import { CaseListWorkspace } from './_components/list-workspace/case-list-workspace';
import { useControlPanelLabels } from './control/_lib/labels';
import { canAccessWith, LEX_ROUTE_PERMISSIONS } from '@/lib/permissions';

const CASES_ENDPOINT = '/api/v1/lex/legal-cases';
const CASES_UI_QUERY_PARAMS = new Set(['view', 'preview']);

function sanitizeCaseFetchParams(params: FetchParams): FetchParams {
  const filters = { ...(params.filters ?? {}) };
  for (const key of CASES_UI_QUERY_PARAMS) {
    delete filters[key];
  }

  return {
    ...params,
    filters: Object.keys(filters).length > 0 ? filters : undefined,
  };
}

export default function LexCasesPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const labels = useCaseLabels();
  const controlLabels = useControlPanelLabels();
  const canViewControlPanel = canAccessWith(
    hasPermission,
    LEX_ROUTE_PERMISSIONS['/lex/cases/control'],
  );
  // §9/§18.4 — the list "New Case" CTA is an add action; gate on the
  // domain-specific add verb (not coarse lex:write). A super-admin's `lex:*`
  // wildcard still satisfies this via the authoritative resolver.
  const canWrite = hasPermission('lex:case:add');
  const [createOpen, setCreateOpen] = useState(false);

  const { tableProps } = useDataTable<LegalCase>({
    queryKey: 'lex-cases',
    fetchFn: (params) => fetchSuitePaginated<LegalCase>(CASES_ENDPOINT, sanitizeCaseFetchParams(params)),
    defaultPageSize: 25,
    defaultSort: { column: 'updated_at', direction: 'desc' },
    wsTopics: ['lex.legal-cases'],
  });

  return (
    <LexRouteGuard route="/lex/cases">
      <div dir={direction} lang={locale} className="space-y-6">
        <PageHeader
          title={labels.list.title}
          description={labels.list.description}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canViewControlPanel ? (
                <Button variant="outline" asChild>
                  <Link href="/lex/cases/control">
                    <Gauge className="me-1.5 h-4 w-4" />
                    {controlLabels.page.navShort}
                  </Link>
                </Button>
              ) : null}
              <Button variant="outline" asChild>
                <Link href="/lex/cases/classifications">
                  <ShieldCheck className="me-1.5 h-4 w-4" />
                  {labels.classification.pageTitle}
                </Link>
              </Button>
              {canWrite ? (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus className="me-1.5 h-4 w-4" />
                  {labels.list.newCase}
                </Button>
              ) : null}
            </div>
          }
        />

        <CaseListWorkspace tableProps={tableProps} />

        <CaseFormDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSaved={(legalCase) => router.push(`/lex/cases/${legalCase.id}`)}
        />
      </div>
    </LexRouteGuard>
  );
}
