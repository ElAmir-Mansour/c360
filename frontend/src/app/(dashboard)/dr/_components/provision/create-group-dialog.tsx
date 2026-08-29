'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import type { DRCreateGroupRequest } from '@/types/clario-dr';
import { ProvisionDialogShell } from './provision-dialog-shell';
import { ProvisionField } from './provision-field';
import { useProvisionLabels } from './provision-labels';

/** Zod schema mirroring the real {@link DRCreateGroupRequest} (name only). */
function buildGroupSchema(nameError: string) {
  return z.object({
    name: z.string().trim().min(1, nameError),
  });
}

type GroupFormValues = z.infer<ReturnType<typeof buildGroupSchema>>;

export interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useProvisioningActions().createGroup`. */
  onCreate: (payload: DRCreateGroupRequest) => void;
  submitting: boolean;
}

/**
 * Create-protection-group dialog. Bundles the sites that must recover together.
 * `react-hook-form` + `zod`; builds a real {@link DRCreateGroupRequest}. Gated
 * upstream by `dr:write`. Bilingual + RTL-safe.
 */
export function CreateGroupDialog({
  open,
  onOpenChange,
  onCreate,
  submitting,
}: CreateGroupDialogProps) {
  const labels = useProvisionLabels();
  const L = labels.group;

  const schema = useMemo(() => buildGroupSchema(L.nameError), [L.nameError]);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GroupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '' },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const submit = handleSubmit((values) => {
    onCreate({ name: values.name.trim() });
  });

  return (
    <ProvisionDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={L.dialogTitle}
      description={L.dialogDescription}
      onSubmit={submit}
      submitting={submitting}
    >
      <ProvisionField
        label={L.nameLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        error={errors.name?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...register('name')}
            placeholder={L.namePlaceholder}
            autoComplete="off"
          />
        )}
      </ProvisionField>
    </ProvisionDialogShell>
  );
}
