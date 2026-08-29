'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { StatusBadge } from '@/components/shared/status-badge';
import { workflowDefinitionStatusConfig } from '@/lib/status-configs';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';

const WORKLOAD_LABELS = {
  en: {
    technicalCode: 'Technical code',
    customCategory: 'Custom category',
    categories: {
      approval: 'Approval',
      onboarding: 'Onboarding',
      review: 'Review',
      escalation: 'Escalation',
      notification: 'Notification',
      data_pipeline: 'Data pipeline',
      compliance: 'Compliance',
      custom: 'Custom',
    },
    statuses: {
      draft: 'Draft',
      active: 'Active',
      deprecated: 'Deprecated',
      archived: 'Archived',
    },
  },
  ar: {
    technicalCode: 'رمز تقني',
    customCategory: 'فئة مخصصة',
    categories: {
      approval: 'اعتماد',
      onboarding: 'تهيئة',
      review: 'مراجعة',
      escalation: 'تصعيد',
      notification: 'إشعار',
      data_pipeline: 'خط بيانات',
      compliance: 'امتثال',
      custom: 'مخصص',
    },
    statuses: {
      draft: 'مسودة',
      active: 'نشط',
      deprecated: 'متقادم',
      archived: 'مؤرشف',
    },
  },
} as const;

type WorkloadLabels = {
  technicalCode: string;
  customCategory: string;
  categories: Record<string, string>;
  statuses: Record<string, string>;
};

function labelFromCode(labels: Record<string, string>, code: string, fallback: string): string {
  return labels[code] ?? fallback;
}

export function TaskWorkloadTable() {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const localLabels: WorkloadLabels = locale === 'ar' ? WORKLOAD_LABELS.ar : WORKLOAD_LABELS.en;
  const { data, isLoading, isError } = useWorkflowDefinitions({
    per_page: 20,
    sort: 'instance_count',
    order: 'desc',
  });

  const definitions = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {t('twt.title')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSkeleton variant="table-row" count={5} />
        ) : isError ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('twt.failedLoad')}
          </p>
        ) : definitions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {t('twt.empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('twt.colName')}</TableHead>
                <TableHead>{t('twt.colCategory')}</TableHead>
                <TableHead>{t('twt.colStatus')}</TableHead>
                <TableHead className="text-end">{t('twt.colSteps')}</TableHead>
                <TableHead className="text-end">{t('twt.colInstances')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {definitions.map((def) => (
                <TableRow key={def.id}>
                  <TableCell className="font-medium">{def.name}</TableCell>
                  <TableCell>
                    {def.category ? (
                      <Badge variant="outline" className="text-xs" title={`${localLabels.technicalCode}: ${def.category}`}>
                        {labelFromCode(localLabels.categories, def.category, localLabels.customCategory)}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={def.status}
                      config={workflowDefinitionStatusConfig}
                      label={labelFromCode(localLabels.statuses, def.status, def.status)}
                      title={`${localLabels.technicalCode}: ${def.status}`}
                    />
                  </TableCell>
                  <TableCell className="text-end text-sm">
                    {def.step_count ?? 0}
                  </TableCell>
                  <TableCell className="text-end text-sm font-medium">
                    {def.instance_count ?? 0}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
