'use client';

import { Fragment, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPercentage, titleCase, truncate } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import type { AIValidationPredictionSample } from '@/types/ai-governance';

interface FNSampleTableProps {
  samples: AIValidationPredictionSample[];
}

export function FNSampleTable({ samples }: FNSampleTableProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const t = useT('admin');

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{t('vs.fnTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('vs.colEvent')}</TableHead>
              <TableHead>{t('vs.colPredicted')}</TableHead>
              <TableHead>{t('vs.colActual')}</TableHead>
              <TableHead>{t('vs.colConfidence')}</TableHead>
              <TableHead>{t('vs.colRule')}</TableHead>
              <TableHead>{t('vs.colExplanation')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {samples.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-sm text-muted-foreground">
                  {t('vs.noFn')}
                </TableCell>
              </TableRow>
            ) : null}
            {samples.map((sample) => {
              const key = sample.prediction_id ?? sample.input_hash;
              const open = expandedRow === key;
              return (
                <Fragment key={key}>
                  <TableRow className="cursor-pointer" onClick={() => setExpandedRow(open ? null : key)}>
                    <TableCell className="font-medium">
                      <div>{sample.input_hash.slice(0, 12)}...</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {sample.severity ? titleCase(sample.severity) : t('vs.unclassified')}
                      </div>
                    </TableCell>
                    <TableCell>{titleCase(sample.predicted_label)}</TableCell>
                    <TableCell>{titleCase(sample.expected_label)}</TableCell>
                    <TableCell>{formatPercentage(sample.confidence, 1)}</TableCell>
                    <TableCell>{sample.rule_type || t('vs.unknown')}</TableCell>
                    <TableCell className="max-w-[200px] sm:max-w-[320px] text-muted-foreground">
                      {truncate(sample.explanation || t('vs.noExplanation'), 110)}
                    </TableCell>
                  </TableRow>
                  {open ? (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-secondary/80">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                          <div className="space-y-2 text-sm text-foreground">
                            <div className="font-medium text-foreground">{t('vs.fullExplanation')}</div>
                            <p>{sample.explanation || t('vs.noExplanation')}</p>
                          </div>
                          <div className="space-y-3 text-sm text-foreground">
                            <div>
                              <div className="font-medium text-foreground">{t('vs.predictedOutput')}</div>
                              <pre className="mt-2 overflow-auto rounded-xl bg-card p-3 text-xs text-foreground">
                                {JSON.stringify(sample.predicted_output, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <div className="font-medium text-foreground">{t('vs.eventDetails')}</div>
                              <pre className="mt-2 overflow-auto rounded-xl bg-card p-3 text-xs text-foreground">
                                {JSON.stringify(sample.input_summary, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
