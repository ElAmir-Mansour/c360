'use client';

import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DRRunbookStartRunRequest } from '@/types/clario-dr';
import { ProvisionField } from '../../_components/provision/provision-field';
import { useRunbookStudioLabels } from '../../_components/runbook-studio/runbook-studio-labels';
import { RunbookDialogShell } from './runbook-dialog-shell';
import { useRunbookPageLabels } from './runbook-page-labels';

/** Backend runbook run modes — `runbookstudio/model.go` (`RunModeLive`/`RunModeRehearsal`). */
const RUN_MODES = ['live', 'rehearsal'] as const;

export interface StartRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useRunbookStudioActions().startRun(runbookId, payload)`. */
  onStart: (payload: DRRunbookStartRunRequest) => void;
  submitting: boolean;
}

interface StartRunFormValues {
  mode: (typeof RUN_MODES)[number];
}

export function StartRunDialog({ open, onOpenChange, onStart, submitting }: StartRunDialogProps) {
  const labels = useRunbookStudioLabels();
  const pageLabels = useRunbookPageLabels();

  const { handleSubmit, control, reset } = useForm<StartRunFormValues>({
    defaultValues: { mode: 'rehearsal' },
  });

  useEffect(() => {
    if (open) reset({ mode: 'rehearsal' });
  }, [open, reset]);

  const submit = handleSubmit((values) => {
    onStart({ mode: values.mode });
  });

  return (
    <RunbookDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={labels.startRunTriggerLabel}
      description={labels.description}
      onSubmit={submit}
      submitting={submitting}
      submitLabel={labels.startRunTriggerLabel}
    >
      <ProvisionField label={labels.runModeLabel}>
        {(props) => (
          <Controller
            control={control}
            name="mode"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id={props.id}
                  aria-invalid={props['aria-invalid']}
                  aria-describedby={props['aria-describedby']}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RUN_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {pageLabels.runModeLabels[mode] ?? mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </ProvisionField>
    </RunbookDialogShell>
  );
}
