'use client';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DRRunbook, DRRunbookUpdateRequest } from '@/types/clario-dr';
import { ProvisionField } from '../../_components/provision/provision-field';
import { useRunbookStudioLabels } from '../../_components/runbook-studio/runbook-studio-labels';
import { RunbookDialogShell } from './runbook-dialog-shell';
import { useRunbookPageLabels } from './runbook-page-labels';

/** Backend runbook (metadata) statuses — `runbookstudio/model.go`. */
const RUNBOOK_STATUSES = ['draft', 'published', 'archived'] as const;

/**
 * Zod schema for the edit-runbook-metadata form. Mirrors the real
 * {@link DRRunbookUpdateRequest} exactly: every field optional. `name` is still
 * required to be non-empty when present (the backend rejects a blank name); the
 * status is constrained to the real backend enum.
 */
function buildSchema(nameError: string) {
  return z.object({
    name: z.string().trim().min(1, nameError),
    description: z.string().trim().optional(),
    status: z.enum(RUNBOOK_STATUSES),
  });
}

type EditFormValues = z.infer<ReturnType<typeof buildSchema>>;

export interface EditRunbookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runbook: DRRunbook;
  /** Wired to `useRunbookStudioActions().updateRunbook(runbook.id, payload)`. */
  onUpdate: (payload: DRRunbookUpdateRequest) => void;
  submitting: boolean;
}

export function EditRunbookDialog({
  open,
  onOpenChange,
  runbook,
  onUpdate,
  submitting,
}: EditRunbookDialogProps) {
  const labels = useRunbookStudioLabels();
  const pageLabels = useRunbookPageLabels();

  const schema = useMemo(() => buildSchema(labels.nameLabel), [labels.nameLabel]);

  const defaultStatus = (RUNBOOK_STATUSES as readonly string[]).includes(runbook.status)
    ? (runbook.status as (typeof RUNBOOK_STATUSES)[number])
    : 'draft';

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<EditFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: runbook.name,
      description: runbook.description ?? '',
      status: defaultStatus,
    },
  });

  // Re-seed from the live runbook each time the dialog (re)opens so a prior draft
  // never leaks and the form reflects the latest saved metadata.
  useEffect(() => {
    if (open) {
      reset({
        name: runbook.name,
        description: runbook.description ?? '',
        status: defaultStatus,
      });
    }
  }, [open, reset, runbook.name, runbook.description, defaultStatus]);

  const submit = handleSubmit((values) => {
    onUpdate({
      name: values.name.trim(),
      description: values.description?.trim() ?? '',
      status: values.status,
    });
  });

  return (
    <RunbookDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={labels.editDialogTitle}
      description={labels.createDialogDescription}
      onSubmit={submit}
      submitting={submitting}
    >
      <ProvisionField label={labels.nameLabel} required error={errors.name?.message}>
        {(props) => (
          <Input {...props} {...register('name')} autoComplete="off" />
        )}
      </ProvisionField>

      <ProvisionField label={labels.descriptionLabel}>
        {(props) => <Textarea {...props} {...register('description')} rows={3} />}
      </ProvisionField>

      <ProvisionField label={labels.statusLabel}>
        {(props) => (
          <Controller
            control={control}
            name="status"
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
                  {RUNBOOK_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {pageLabels.runbookStatusLabels[status] ?? status}
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
