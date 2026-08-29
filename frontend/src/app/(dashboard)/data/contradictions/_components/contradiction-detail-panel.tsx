'use client';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { type Contradiction } from '@/lib/data-suite';
import { getClassificationBadge, qualitySeverityVisuals } from '@/lib/data-suite/utils';
import { useDataLabels, type DataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface ContradictionDetailPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contradiction: Contradiction | null;
  onInvestigate: (contradiction: Contradiction) => void;
  onAccept: (contradiction: Contradiction) => void;
  onResolve: (contradiction: Contradiction) => void;
  onFalsePositive: (contradiction: Contradiction) => void;
}

export function ContradictionDetailPanel({
  open,
  onOpenChange,
  contradiction,
  onInvestigate,
  onAccept,
  onResolve,
  onFalsePositive,
}: ContradictionDetailPanelProps) {
  const labels = useDataLabels();
  const severity = contradiction ? qualitySeverityVisuals[contradiction.severity] : null;
  const typeLabels: Record<Contradiction['type'], string> = {
    logical: labels.contradictions.ctLogical,
    semantic: labels.contradictions.ctSemantic,
    temporal: labels.contradictions.ctTemporal,
    analytical: labels.contradictions.ctAnalytical,
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>{contradiction?.title ?? labels.contradictions.detailTitle}</SheetTitle>
          <SheetDescription>{contradiction?.description ?? labels.contradictions.detailPrompt}</SheetDescription>
        </SheetHeader>

        {contradiction ? (
          <div className="mt-6 space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{typeLabels[contradiction.type]}</Badge>
              {severity ? (
                <Badge variant="outline" className={severity.className}>
                  {severity.label}
                </Badge>
              ) : null}
              <Badge variant="outline">
                {labels.contradictions.status[
                  contradiction.status as keyof typeof labels.contradictions.status
                ] ?? contradiction.status}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {labels.contradictions.confidence((contradiction.confidence_score * 100).toFixed(0))}
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <SourceComparisonCard title={labels.contradictions.sourceA} source={contradiction.source_a} labels={labels} />
              <SourceComparisonCard title={labels.contradictions.sourceB} source={contradiction.source_b} labels={labels} />
            </div>

            <div className="space-y-3">
              <h4 className="font-medium">{labels.contradictions.sampleRecords}</h4>
              <div className="rounded-lg border">
                <pre className="overflow-x-auto p-4 text-xs">{JSON.stringify(contradiction.sample_records, null, 2)}</pre>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="font-medium">{labels.contradictions.resolutionGuidance}</div>
              <div className="mt-2 text-sm text-muted-foreground">{contradiction.resolution_guidance}</div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => onInvestigate(contradiction)}>
                {labels.contradictions.investigate}
              </Button>
              <Button type="button" variant="outline" onClick={() => onAccept(contradiction)}>
                {labels.contradictions.acceptRisk}
              </Button>
              <Button type="button" onClick={() => onResolve(contradiction)}>
                {labels.contradictions.resolve}
              </Button>
              <Button type="button" variant="ghost" onClick={() => onFalsePositive(contradiction)}>
                {labels.contradictions.markFalsePositive}
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function SourceComparisonCard({
  title,
  source,
  labels,
}: {
  title: string;
  source: Contradiction['source_a'];
  labels: DataLabels;
}) {
  const classification = getClassificationBadge(
    typeof source.metadata?.classification === 'string' ? source.metadata.classification : undefined,
  );

  return (
    <div className="rounded-lg border p-4">
      <div className="font-medium">{title}</div>
      <div className="mt-3 space-y-2 text-sm">
        <div>{source.source_name}</div>
        <div className="text-muted-foreground">
          {source.table_name ?? source.model_name ?? labels.contradictions.unknownEntity}
          {source.column_name ? `.${source.column_name}` : ''}
        </div>
        <div className="font-mono text-xs">{`${source.value ?? '—'}`}</div>
        <Badge variant="outline" className={classification.className}>
          {classification.label}
        </Badge>
      </div>
    </div>
  );
}
