'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useCreateWorkflowInstance } from '@/hooks/use-workflow-instances-ext';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import type { WorkflowDefinition, WorkflowInstance, WorkflowVariable } from '@/types/models';
import { getAdminWorkflowLabels } from '../../tasks/_lib/admin-workflow-i18n';

interface StartWorkflowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new instance after it is created. When omitted the dialog
   *  navigates to the admin instance detail page as the default. */
  onSuccess?: (instance: WorkflowInstance) => void;
}

export function StartWorkflowDialog({
  open,
  onOpenChange,
  onSuccess,
}: StartWorkflowDialogProps) {
  const router = useRouter();
  const t = useT('admin');
  const { locale } = useLocaleOrDefault();
  const labels = getAdminWorkflowLabels(locale);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedDefId, setSelectedDefId] = useState('');
  const [variables, setVariables] = useState<Record<string, unknown>>({});
  const [defSearch, setDefSearch] = useState('');

  const { data: definitionsData } = useWorkflowDefinitions({
    status: 'active',
    per_page: 100,
  });
  const createMutation = useCreateWorkflowInstance();

  const activeDefinitions = useMemo(
    () => definitionsData?.data ?? [],
    [definitionsData],
  );
  const filteredDefs = useMemo(() => {
    if (!defSearch) return activeDefinitions;
    const q = defSearch.toLowerCase();
    return activeDefinitions.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.category ?? '').toLowerCase().includes(q),
    );
  }, [activeDefinitions, defSearch]);

  const selectedDef = activeDefinitions.find((d) => d.id === selectedDefId);

  function handleReset() {
    setStep(1);
    setSelectedDefId('');
    setVariables({});
    setDefSearch('');
  }

  function handleOpenChange(v: boolean) {
    if (!v) handleReset();
    onOpenChange(v);
  }

  function handleSelectDef(def: WorkflowDefinition) {
    setSelectedDefId(def.id);
    // Initialize variables with defaults
    const defaults: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(def.variables)) {
      defaults[name] = v.default ?? getDefaultForType(v.type);
    }
    setVariables(defaults);
    setStep(2);
  }

  function handleStart() {
    createMutation.mutate(
      { definition_id: selectedDefId, input_variables: variables },
      {
        onSuccess: (instance) => {
          handleOpenChange(false);
          if (onSuccess) {
            onSuccess(instance);
          } else {
            router.push(`/admin/workflows/instances/${instance.id}`);
          }
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('sw.title')}</DialogTitle>
          <DialogDescription>
            {step === 1 && t('sw.descStep1')}
            {step === 2 && t('sw.descStep2')}
            {step === 3 && t('sw.descStep3')}
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Select definition */}
        {step === 1 && (
          <div className="space-y-3">
            <Input
              placeholder={t('sw.searchDefs')}
              value={defSearch}
              onChange={(e) => setDefSearch(e.target.value)}
              className="h-8"
            />
            <div className="max-h-64 overflow-y-auto space-y-1">
              {filteredDefs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  {t('sw.noActiveDefs')}
                </p>
              ) : (
                filteredDefs.map((def) => (
                  <button
                    key={def.id}
                    className="w-full text-start rounded-md px-3 py-2 hover:bg-accent transition-colors"
                    onClick={() => handleSelectDef(def)}
                    type="button"
                  >
                    <div className="text-sm font-medium">{def.name}</div>
                    {def.description && (
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {def.description}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Step 2: Variables */}
        {step === 2 && selectedDef && (
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {Object.keys(selectedDef.variables).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('sw.noVars')}
              </p>
            ) : (
              Object.entries(selectedDef.variables).map(([name, v]) => (
                <VariableField
                  key={name}
                  variable={{ name, type: v.type as 'string' | 'number' | 'boolean' | 'date' | 'json', default_value: v.default, required: false, description: '' }}
                  value={variables[name]}
                  onChange={(val) =>
                    setVariables((prev) => ({ ...prev, [name]: val }))
                  }
                />
              ))
            )}
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && selectedDef && (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">
                {t('sw.workflow')}
              </Label>
              <p className="text-sm font-medium">{selectedDef.name}</p>
            </div>
            {Object.keys(variables).length > 0 && (
              <div>
                <Label className="text-xs text-muted-foreground">
                  {t('sw.variables')}
                </Label>
                <div className="mt-1 text-xs font-mono bg-muted rounded p-2 max-h-32 overflow-y-auto">
                  {Object.entries(variables).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-muted-foreground">{k}:</span>{' '}
                      {String(v)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep((s) => (s - 1) as 1 | 2 | 3)}
            >
              {labels.common.back}
            </Button>
          )}
          {step === 2 && (
            <Button onClick={() => setStep(3)}>{t('sw.review')}</Button>
          )}
          {step === 3 && (
            <Button
              onClick={handleStart}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending && (
                <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
              )}
              {t('sw.title')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VariableField({
  variable,
  value,
  onChange,
}: {
  variable: WorkflowVariable;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">
        {variable.name}
        {variable.required && <span className="text-destructive ms-0.5">*</span>}
      </Label>
      {variable.description && (
        <p className="text-overline text-muted-foreground">
          {variable.description}
        </p>
      )}

      {variable.type === 'boolean' ? (
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange(v)}
        />
      ) : variable.type === 'number' ? (
        <Input
          type="number"
          value={value !== undefined ? String(value) : ''}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-8 text-sm"
        />
      ) : variable.type === 'date' ? (
        <Input
          type="date"
          value={value !== undefined ? String(value) : ''}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm"
        />
      ) : variable.type === 'json' ? (
        <Textarea
          value={
            typeof value === 'string' ? value : JSON.stringify(value, null, 2)
          }
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value));
            } catch {
              onChange(e.target.value);
            }
          }}
          rows={3}
          className="text-sm font-mono"
        />
      ) : (
        <Input
          value={value !== undefined ? String(value) : ''}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm"
        />
      )}
    </div>
  );
}

function getDefaultForType(type: string): unknown {
  switch (type) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'json':
      return {};
    default:
      return '';
  }
}
