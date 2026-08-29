'use client';

import { useEffect, useMemo, useState } from 'react';
import { PlayCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import { formatStepTypeLabel } from '../../../definition-i18n';
import type { BackendStepDefinition } from '@/types/models';
import type { SimulateRequestBody } from '../use-workflow-lifecycle';
import {
  buildDecisionPoints,
  buildSimulateBody,
  initialDecisionValues,
  type DecisionField,
  type DecisionValues,
  type FieldValue,
} from '../simulate-decision-model';

interface SimulateConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  steps: BackendStepDefinition[];
  isPending: boolean;
  onRun: (body: SimulateRequestBody) => void;
}

/**
 * Pre-simulate decision picker. Lists each gate the dry run must answer — human
 * approvals plus any step whose output a guard reads — and lets the user pick the
 * decision + key output values before running. Defaults follow the happy path so
 * one click reaches the End step instead of the loop guard.
 */
export function SimulateConfigDialog({
  open,
  onOpenChange,
  steps,
  isPending,
  onRun,
}: SimulateConfigDialogProps) {
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const points = useMemo(() => buildDecisionPoints(steps), [steps]);
  const [values, setValues] = useState<DecisionValues>(() => initialDecisionValues(points));

  // Re-seed happy-path defaults each time the dialog opens (or the graph changes).
  useEffect(() => {
    if (open) setValues(initialDecisionValues(points));
  }, [open, points]);

  function setApproved(stepId: string, approved: boolean) {
    setValues((prev) => ({ ...prev, [stepId]: { ...prev[stepId], approved } }));
  }

  function setField(stepId: string, field: string, value: FieldValue) {
    setValues((prev) => ({
      ...prev,
      [stepId]: { ...prev[stepId], outputs: { ...prev[stepId]?.outputs, [field]: value } },
    }));
  }

  function renderControl(stepId: string, f: DecisionField) {
    const val = values[stepId]?.outputs[f.field];
    if (f.control === 'boolean') {
      return (
        <Switch
          checked={Boolean(val)}
          onCheckedChange={(c) => setField(stepId, f.field, c)}
          aria-label={f.label}
        />
      );
    }
    if (f.control === 'select') {
      return (
        <Select value={String(val ?? '')} onValueChange={(v) => setField(stepId, f.field, v)}>
          <SelectTrigger className="h-8 w-44">
            <SelectValue placeholder={t('scfg.selectPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {(f.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    if (f.control === 'number') {
      return (
        <Input
          type="number"
          className="h-8 w-32"
          value={val === undefined || val === '' ? '' : String(val)}
          onChange={(e) => setField(stepId, f.field, e.target.value === '' ? '' : Number(e.target.value))}
          aria-label={f.label}
        />
      );
    }
    return (
      <Input
        className="h-8 w-44"
        value={String(val ?? '')}
        onChange={(e) => setField(stepId, f.field, e.target.value)}
        aria-label={f.label}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlayCircle className="h-5 w-5 text-primary" aria-hidden />
            {t('scfg.title')}
          </DialogTitle>
          <DialogDescription>
            {t('scfg.desc')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pe-1">
          {points.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('scfg.noDecisionPoints')}
            </p>
          ) : (
            points.map((p) => (
              <div key={p.stepId} className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.stepName}</p>
                    <Badge variant="outline" className="mt-0.5 text-overline">
                      {formatStepTypeLabel(p.stepType, locale)}
                    </Badge>
                  </div>
                  {p.isHumanGate ? (
                    <div className="inline-flex shrink-0 rounded-md border p-0.5 text-xs" role="group" aria-label={t('scfg.decisionAria')}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setApproved(p.stepId, true)}
                        aria-pressed={values[p.stepId]?.approved === true}
                        className={cn(
                          'h-7 rounded px-2.5',
                          values[p.stepId]?.approved
                            ? 'bg-status-success/15 font-medium text-status-success'
                            : 'text-muted-foreground',
                        )}
                      >
                        {t('scfg.approve')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setApproved(p.stepId, false)}
                        aria-pressed={values[p.stepId]?.approved === false}
                        className={cn(
                          'h-7 rounded px-2.5',
                          values[p.stepId]?.approved === false
                            ? 'bg-status-error/15 font-medium text-status-error'
                            : 'text-muted-foreground',
                        )}
                      >
                        {t('scfg.reject')}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {p.fields.length > 0 ? (
                  <div className="space-y-2 border-t pt-2">
                    {p.fields.map((f) => (
                      <div key={f.field} className="flex items-center justify-between gap-3">
                        <Label className="text-xs text-muted-foreground" title={f.field}>
                          {f.label}
                        </Label>
                        {renderControl(p.stepId, f)}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setValues(initialDecisionValues(points))}
            disabled={points.length === 0}
          >
            {t('scfg.reset')}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('scfg.cancel')}
            </Button>
            <Button size="sm" onClick={() => onRun(buildSimulateBody(points, values))} disabled={isPending}>
              <PlayCircle className="me-1 h-3.5 w-3.5" aria-hidden />
              {isPending ? t('scfg.running') : t('scfg.run')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
