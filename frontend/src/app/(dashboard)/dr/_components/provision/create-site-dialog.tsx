'use client';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
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
import type { DRCreateSiteRequest } from '@/types/clario-dr';
import { ProvisionDialogShell } from './provision-dialog-shell';
import { ProvisionField } from './provision-field';
import { useProvisionLabels } from './provision-labels';

/** Backend site-kind enum (model.SiteKind*) — the exact accepted values. */
const SITE_KINDS = ['vm', 'database', 'fileset', 'iac'] as const;

/**
 * Zod schema for the create-protected-site form. Mirrors the real
 * {@link DRCreateSiteRequest} shape exactly (name/kind/primary_endpoint plus the
 * two objective seconds) — no invented fields. RTO/RPO are coerced from the
 * numeric inputs and must be a positive integer count of seconds, matching the
 * backend's `>= 1` objective requirement. Messages are injected from the
 * bilingual label bundle so validation copy is localized.
 */
function buildSiteSchema(messages: {
  nameError: string;
  kindError: string;
  endpointError: string;
  rtoError: string;
  rpoError: string;
}) {
  return z.object({
    name: z.string().trim().min(1, messages.nameError),
    kind: z.enum(SITE_KINDS, { errorMap: () => ({ message: messages.kindError }) }),
    primary_endpoint: z.string().trim().min(1, messages.endpointError),
    rto_objective_seconds: z.coerce
      .number({ invalid_type_error: messages.rtoError })
      .int(messages.rtoError)
      .min(1, messages.rtoError),
    rpo_objective_seconds: z.coerce
      .number({ invalid_type_error: messages.rpoError })
      .int(messages.rpoError)
      .min(1, messages.rpoError),
  });
}

type SiteFormValues = z.infer<ReturnType<typeof buildSiteSchema>>;

export interface CreateSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useProvisioningActions().createSite`. */
  onCreate: (payload: DRCreateSiteRequest) => void;
  submitting: boolean;
}

/**
 * Create-protected-site dialog. A `react-hook-form` + `zod` form that builds a
 * real {@link DRCreateSiteRequest} and hands it to the provisioning action hook.
 * The dialog never opens for an operator without `dr:write` — the trigger that
 * opens it is gated upstream by the shared `dr-write-gate`. Bilingual + RTL-safe.
 */
export function CreateSiteDialog({
  open,
  onOpenChange,
  onCreate,
  submitting,
}: CreateSiteDialogProps) {
  const labels = useProvisionLabels();
  const L = labels.site;

  const schema = useMemo(
    () =>
      buildSiteSchema({
        nameError: L.nameError,
        kindError: L.kindError,
        endpointError: L.endpointError,
        rtoError: L.rtoError,
        rpoError: L.rpoError,
      }),
    [L.nameError, L.kindError, L.endpointError, L.rtoError, L.rpoError],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<SiteFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      kind: 'vm',
      primary_endpoint: '',
      rto_objective_seconds: 900,
      rpo_objective_seconds: 300,
    },
  });

  // Reset to pristine defaults each time the dialog (re)opens so a prior draft
  // never leaks into a new site.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const submit = handleSubmit((values) => {
    onCreate({
      name: values.name.trim(),
      kind: values.kind,
      primary_endpoint: values.primary_endpoint.trim(),
      rto_objective_seconds: values.rto_objective_seconds,
      rpo_objective_seconds: values.rpo_objective_seconds,
    });
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

      <ProvisionField
        label={L.kindLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        error={errors.kind?.message}
      >
        {(props) => (
          <Controller
            control={control}
            name="kind"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id={props.id}
                  aria-invalid={props['aria-invalid']}
                  aria-describedby={props['aria-describedby']}
                >
                  <SelectValue placeholder={L.kindPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {SITE_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {L.kindOptions[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </ProvisionField>

      <ProvisionField
        label={L.endpointLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        error={errors.primary_endpoint?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...register('primary_endpoint')}
            placeholder={L.endpointPlaceholder}
            autoComplete="off"
          />
        )}
      </ProvisionField>

      <div className="grid gap-4 sm:grid-cols-2">
        <ProvisionField
          label={L.rtoLabel}
          required
          requiredHint={labels.actions.requiredFieldHint}
          help={L.rtoHelp}
          error={errors.rto_objective_seconds?.message}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              {...register('rto_objective_seconds')}
            />
          )}
        </ProvisionField>

        <ProvisionField
          label={L.rpoLabel}
          required
          requiredHint={labels.actions.requiredFieldHint}
          help={L.rpoHelp}
          error={errors.rpo_objective_seconds?.message}
        >
          {(props) => (
            <Input
              {...props}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              {...register('rpo_objective_seconds')}
            />
          )}
        </ProvisionField>
      </div>
    </ProvisionDialogShell>
  );
}
