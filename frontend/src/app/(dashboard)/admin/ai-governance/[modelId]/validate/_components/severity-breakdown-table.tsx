'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber, formatPercentage, titleCase } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import type { AIValidationMetricsSummary } from '@/types/ai-governance';

interface SeverityBreakdownTableProps {
  title?: string;
  label?: string;
  breakdown: Record<string, AIValidationMetricsSummary>;
  order?: string[];
}

const severityOrder = ['critical', 'high', 'medium', 'low', 'unclassified'];

export function SeverityBreakdownTable({
  title,
  label,
  breakdown,
  order = severityOrder,
}: SeverityBreakdownTableProps) {
  const t = useT('admin');
  const resolvedTitle = title ?? t('sbt.title');
  const resolvedLabel = label ?? t('sbt.label');
  const sevLabel = (s: string) => {
    const key = `sbt.sev.${s}`;
    const v = t(key);
    return v === key ? titleCase(s) : v;
  };
  const entries = Object.entries(breakdown).sort((left, right) => {
    const leftIndex = order.indexOf(left[0]);
    const rightIndex = order.indexOf(right[0]);
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex);
  });

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{resolvedTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{resolvedLabel}</TableHead>
              <TableHead>{t('sbt.precision')}</TableHead>
              <TableHead>{t('sbt.recall')}</TableHead>
              <TableHead>{t('sbt.f1')}</TableHead>
              <TableHead>{t('sbt.count')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  {t('sbt.empty')}
                </TableCell>
              </TableRow>
            ) : null}
            {entries.map(([key, metrics]) => (
              <TableRow key={key}>
                <TableCell className="font-medium">{sevLabel(key)}</TableCell>
                <TableCell>{formatPercentage(metrics.precision, 1)}</TableCell>
                <TableCell>{formatPercentage(metrics.recall, 1)}</TableCell>
                <TableCell>{formatPercentage(metrics.f1_score, 1)}</TableCell>
                <TableCell>{formatNumber(metrics.dataset_size)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
