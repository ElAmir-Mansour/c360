'use client';

import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { DRCreateRunbookRequest, DRGroupRollup } from '@/types/clario-dr';
import { ProvisionField } from '../../_components/provision/provision-field';
import { useRunbookStudioLabels } from '../../_components/runbook-studio/runbook-studio-labels';
import { RunbookDialogShell } from './runbook-dialog-shell';

/**
 * Zod schema for the create-runbook form. Mirrors the real
 * {@link DRCreateRunbookRequest} exactly: `name` required, `description` and
 * `group_id` optional (sent only when non-empty). `import_steps` is intentionally
 * not exposed in this dialog — tasks are authored individually via the add-task
 * dialog after the runbook exists. The required-name message is injected from the
 * bilingual studio bundle so the validation copy is localized.
 */
function buildSchema(nameError: string) {
  return z.object({
    name: z.string().trim().min(1, nameError),
    description: z.string().trim().optional(),
    group_id: z.string().trim().optional(),
  });
}

type RunbookFormValues = z.infer<ReturnType<typeof buildSchema>>;

const UNBOUND_GROUP_VALUE = '__tenant_wide__';

export interface CreateRunbookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useRunbookStudioActions().createRunbook`. */
  onCreate: (payload: DRCreateRunbookRequest) => void;
  submitting: boolean;
  /** Tenant protection groups used to present names while retaining ids in the payload. */
  groups: DRGroupRollup[];
  /**
   * Optional protection-group id to pre-fill the group field with — used when the
   * dialog is opened from a catalog row so the new runbook is scoped to that group
   * without the operator typing/pasting a UUID. Still editable in the form.
   */
  defaultGroupId?: string | null;
}

export function CreateRunbookDialog({
  open,
  onOpenChange,
  onCreate,
  submitting,
  groups,
  defaultGroupId,
}: CreateRunbookDialogProps) {
  const labels = useRunbookStudioLabels();

  const schema = useMemo(() => buildSchema(labels.nameLabel), [labels.nameLabel]);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RunbookFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '', group_id: '' },
  });

  useEffect(() => {
    if (open) reset({ name: '', description: '', group_id: defaultGroupId ?? '' });
  }, [open, reset, defaultGroupId]);

  const submit = handleSubmit((values) => {
    const description = values.description?.trim();
    const groupId = values.group_id?.trim();
    onCreate({
      name: values.name.trim(),
      ...(description ? { description } : {}),
      ...(groupId ? { group_id: groupId } : {}),
    });
  });

  return (
    <RunbookDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={labels.createDialogTitle}
      description={labels.createDialogDescription}
      onSubmit={submit}
      submitting={submitting}
    >
      <ProvisionField label={labels.nameLabel} required error={errors.name?.message}>
        {(props) => (
          <Input
            {...props}
            {...register('name')}
            placeholder={labels.namePlaceholder}
            autoComplete="off"
          />
        )}
      </ProvisionField>

      <ProvisionField label={labels.descriptionLabel}>
        {(props) => (
          <Textarea
            {...props}
            {...register('description')}
            placeholder={labels.descriptionPlaceholder}
            rows={3}
          />
        )}
      </ProvisionField>

      <ProvisionField label={labels.groupLabel}>
        {(props) => (
          <Controller
            control={control}
            name="group_id"
            render={({ field }) => (
              <Select
                value={field.value || UNBOUND_GROUP_VALUE}
                onValueChange={(value) =>
                  field.onChange(value === UNBOUND_GROUP_VALUE ? '' : value)
                }
              >
                <SelectTrigger
                  id={props.id}
                  aria-invalid={props['aria-invalid']}
                  aria-describedby={props['aria-describedby']}
                >
                  <SelectValue placeholder={labels.groupPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNBOUND_GROUP_VALUE}>{labels.groupPlaceholder}</SelectItem>
                  {groups.map((group) => (
                    <SelectItem key={group.group_id} value={group.group_id}>
                      {group.name}
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
