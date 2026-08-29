'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useT } from '@/components/providers/locale-provider';
import type { AIExplanation } from '@/types/ai-governance';

interface ExplanationViewerProps {
  explanation: AIExplanation | null;
}

export function ExplanationViewer({ explanation }: ExplanationViewerProps) {
  const t = useT('admin');
  if (!explanation) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground sm:p-6">
          {t('ev.empty')}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3">
          <span>{t('ev.title')}</span>
          <Badge variant="outline">{t('ev.confidence', { pct: Math.round(explanation.confidence * 100) })}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl bg-muted/30 p-4 text-sm leading-6">{explanation.human_readable}</div>
        <div className="rounded-xl border border-border/70">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('ev.factor')}</TableHead>
                <TableHead>{t('ev.value')}</TableHead>
                <TableHead>{t('ev.impact')}</TableHead>
                <TableHead>{t('ev.description')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {explanation.factors.map((factor) => (
                <TableRow key={`${factor.name}-${factor.value}`}>
                  <TableCell className="font-medium">{factor.name}</TableCell>
                  <TableCell>{factor.value}</TableCell>
                  <TableCell>{Math.round(factor.impact * 100)}%</TableCell>
                  <TableCell className="text-muted-foreground">{factor.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <pre className="overflow-x-auto rounded-xl bg-auth-dark p-4 text-xs text-emerald-100/90">
          {JSON.stringify(explanation.structured, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
