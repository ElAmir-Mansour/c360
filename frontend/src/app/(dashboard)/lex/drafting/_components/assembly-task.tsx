'use client';

import { type FormEvent, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { enterpriseApi } from '@/lib/enterprise';
import { parseApiError } from '@/lib/format';
import { formatCurrency } from '@/lib/format/currency';
import type {
  JsonObject,
  JsonValue,
  LexDraftingAssemblyResult,
  LexDraftingTemplateSection,
} from '@/types/suites';
import {
  type DraftingErrorState,
  DraftingResultActionBar,
  DraftingResultShell,
  useDraftingLabels,
} from './drafting-shared';
import { ObjectArrayEditor, TemplateSectionEditor } from './drafting-structured-editors';
import {
  DraftingRiskDashboard,
  EditableResultPanel,
  QualityChecklist,
  SaveDraftTargetActions,
} from './drafting-workspace-panels';
import { saveDraftingRun } from './drafting-workspace';

const SAMPLE_SECTIONS: LexDraftingTemplateSection[] = [
  {
    id: 'intro',
    heading: 'Master Services Agreement',
    body: 'This agreement is between {{customer_name}} and {{supplier_name}} for managed cloud services.',
  },
  {
    id: 'data-processing',
    heading: 'Data Processing',
    body: 'Supplier shall process personal data only on documented instructions and maintain appropriate technical and organizational safeguards.',
    condition: 'include_data_processing == true',
  },
  {
    id: 'arbitration',
    heading: 'Dispute Resolution',
    body: 'Disputes shall first be escalated to executive negotiation and then referred to arbitration seated in {{venue}}.',
    condition: 'include_arbitration',
  },
  {
    id: 'liability-cap',
    heading: 'Liability Cap',
    body: "Each party's aggregate liability shall not exceed {{liability_cap}}, except for confidentiality breaches, fraud, or willful misconduct.",
    condition: 'liability_cap',
  },
];

const SAMPLE_VARIABLES: JsonObject = {
  customer_name: 'Watheeq Cloud LLC',
  supplier_name: 'Clario360 Ltd',
  include_data_processing: true,
  include_arbitration: true,
  venue: 'Riyadh',
  liability_cap: formatCurrency(500000, { locale: 'en', minimumFractionDigits: 0, maximumFractionDigits: 0 }),
};

function variablesToRows(variables: JsonObject): JsonObject[] {
  return Object.entries(variables).map(([key, value]) => ({
    key,
    value: String(value ?? ''),
    type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string',
  }));
}

function parseVariableValue(value: string, type: string): JsonValue {
  if (type === 'boolean') {
    return ['true', 'yes', '1'].includes(value.trim().toLowerCase());
  }
  if (type === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === 'json') {
    return JSON.parse(value) as JsonValue;
  }
  return value;
}

function variableRowsToObject(rows: JsonObject[]): JsonObject {
  const variables: JsonObject = {};
  for (const row of rows) {
    const key = String(row.key ?? '').trim();
    if (!key) continue;
    variables[key] = parseVariableValue(String(row.value ?? ''), String(row.type ?? 'string').toLowerCase());
  }
  return variables;
}

export function AssemblyTask() {
  const labels = useDraftingLabels();
  const t = labels.assembly;
  const [sections, setSections] = useState<LexDraftingTemplateSection[]>(SAMPLE_SECTIONS);
  const [variableRows, setVariableRows] = useState<JsonObject[]>(() => variablesToRows(SAMPLE_VARIABLES));
  const [result, setResult] = useState<LexDraftingAssemblyResult | null>(null);
  const [editableText, setEditableText] = useState('');
  const [error, setError] = useState<DraftingErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setEditableText('');

    let variables: JsonObject;
    try {
      const invalidSectionIndex = sections.findIndex((section) => !section.heading.trim() || !section.body.trim());
      if (invalidSectionIndex >= 0) {
        throw new Error(t.sectionFieldsError(invalidSectionIndex + 1));
      }
      variables = variableRowsToObject(variableRows);
    } catch (err) {
      setError({
        title: labels.errors.genericTitle,
        message: err instanceof Error ? err.message : t.invalidJson,
        unavailable: false,
      });
      return;
    }

    setIsLoading(true);
    try {
      const assembled = await enterpriseApi.lex.drafting.assembleTemplate({ sections, variables });
      setResult(assembled);
      setEditableText(assembled.document);
      saveDraftingRun({
        task: 'assembly',
        title: t.actionTitle,
        input: { sections, variables },
        result: assembled,
        text: assembled.document,
        riskLevel: assembled.unresolved_vars.length ? 'needs review' : 'ready',
      });
    } catch (err) {
      setError({ title: labels.errors.genericTitle, message: parseApiError(err), unavailable: false });
    } finally {
      setIsLoading(false);
    }
  };

  const loadSample = () => {
    setSections(SAMPLE_SECTIONS);
    setVariableRows(variablesToRows(SAMPLE_VARIABLES));
    setError(null);
    setResult(null);
    setEditableText('');
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
      <SectionCard
        title={t.cardTitle}
        description={t.cardDescription}
        actions={
          <Button type="button" variant="outline" size="sm" onClick={loadSample}>
            {t.loadSample}
          </Button>
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <TemplateSectionEditor sections={sections} onChange={setSections} />
          <ObjectArrayEditor
            label={t.variables}
            rows={variableRows}
            onChange={setVariableRows}
            sampleRow={{ key: 'new_variable', value: 'Value', type: 'string' }}
          />
          <QualityChecklist
            items={[
              { id: 'sections', label: 'Template sections', ok: sections.length > 0 },
              {
                id: 'section-body',
                label: 'Section text',
                ok: sections.every((section) => section.heading.trim().length > 0 && section.body.trim().length > 0),
              },
              {
                id: 'variables',
                label: 'Variable keys',
                ok: variableRows.every((row) => String(row.key ?? '').trim().length > 0),
              },
            ]}
          />

          <Button type="submit" disabled={isLoading} className="w-full sm:w-auto">
            {isLoading ? (
              <Loader2 className="me-2 h-4 w-4 animate-spin" />
            ) : (
              <FileText className="me-2 h-4 w-4" />
            )}
            {t.submit}
          </Button>
        </form>
      </SectionCard>

      <SectionCard title={t.resultTitle} description={t.resultDescription}>
        <DraftingResultShell
          isLoading={isLoading}
          error={error}
          isEmpty={!result}
          emptyHeading={t.emptyHeading}
          emptyIcon={<FileText className="h-8 w-8" />}
        >
          {result ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <AssemblyStat
                  label={t.included}
                  values={result.included_sections}
                  variant="success"
                  noneLabel={labels.common.none}
                />
                <AssemblyStat
                  label={t.skipped}
                  values={result.skipped_sections}
                  variant="outline"
                  noneLabel={labels.common.none}
                />
                <AssemblyStat
                  label={t.unresolved}
                  values={result.unresolved_vars}
                  variant={result.unresolved_vars.length ? 'warning' : 'success'}
                  noneLabel={labels.common.none}
                />
              </div>

              <div className="rounded-lg border bg-muted/30 p-4">
                <pre className="whitespace-pre-wrap break-words text-sm leading-7">{editableText || result.document}</pre>
              </div>

              <DraftingResultActionBar
                copyText={editableText || result.document}
                sourceTask="assembly"
                title={t.actionTitle}
                json={result}
              />
              <EditableResultPanel title={t.editableTitle} value={editableText} onChange={setEditableText} />
              <DraftingRiskDashboard
                riskLevel={result.unresolved_vars.length ? t.needsReview : t.ready}
                issues={result.unresolved_vars.map((item) => t.unresolvedVariable(item))}
              />
              <SaveDraftTargetActions
                title={t.actionTitle}
                text={editableText || result.document}
                payload={{ source_task: 'assembly' }}
              />
            </div>
          ) : null}
        </DraftingResultShell>
      </SectionCard>
    </div>
  );
}

function AssemblyStat({
  label,
  values,
  variant,
  noneLabel,
}: {
  label: string;
  values: string[];
  variant: 'success' | 'outline' | 'warning';
  noneLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => setExpanded((current) => !current)}
      aria-expanded={expanded}
      className="h-auto flex-col items-stretch rounded-lg border p-3 text-start font-normal transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
        <Badge variant={variant}>{values.length}</Badge>
      </div>
      <p className={`mt-2 text-xs text-muted-foreground ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>
        {values.length ? values.join(', ') : noneLabel}
      </p>
    </Button>
  );
}
