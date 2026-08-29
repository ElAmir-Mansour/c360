'use client';

import { useEffect, useMemo } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DRCreateBootServicesRequest } from '@/types/clario-dr';
import { ProvisionField } from '../../_components/provision/provision-field';
import { useTopologyPageLabels } from './topology-page-labels';

/** Real backend probe kinds (`internal/dr/bootgraph`): http / tcp / script. */
const PROBE_KINDS = ['http', 'tcp', 'script'] as const;

/**
 * Zod schema mirroring one entry of the REAL
 * {@link DRCreateBootServicesRequest}`.services[]`: `name`, `probe_kind`, and
 * `probe_target` are required; `kind`/`boot_action`/`probe_expect_status`/
 * `boot_timeout_seconds`/`health_retries`/`depends_on` are optional. Numeric
 * fields accept an empty string (omitted → backend default); `depends_on` is a
 * free-text comma-separated list parsed to `string[]` on submit.
 */
function buildServicesSchema(nameError: string, targetError: string) {
  // Numeric fields stay as form strings (a `<input type="number">` yields a
  // string); they are validated as "empty OR a non-negative integer" and parsed
  // to a real number on submit. Keeping them as strings means the form's value
  // type matches its input type (no zod input/output divergence), and an empty
  // field is omitted from the payload (backend default) rather than coerced to 0.
  const optionalIntString = z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d+$/.test(value), { message: '' });
  return z.object({
    services: z
      .array(
        z.object({
          name: z.string().trim().min(1, nameError),
          kind: z.string().trim().optional(),
          probe_kind: z.enum(PROBE_KINDS),
          probe_target: z.string().trim().min(1, targetError),
          probe_expect_status: optionalIntString,
          boot_timeout_seconds: optionalIntString,
          health_retries: optionalIntString,
          depends_on: z.string().trim().optional(),
        }),
      )
      .min(1),
  });
}

type ServicesFormValues = z.infer<ReturnType<typeof buildServicesSchema>>;

const EMPTY_SERVICE: ServicesFormValues['services'][number] = {
  name: '',
  kind: '',
  probe_kind: 'tcp',
  probe_target: '',
  probe_expect_status: '',
  boot_timeout_seconds: '',
  health_retries: '',
  depends_on: '',
};

export interface DefineBootServicesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useBootActions().defineBootServices(groupId, payload)`. */
  onDefine: (payload: DRCreateBootServicesRequest) => void;
  submitting: boolean;
}

/**
 * Define-boot-services dialog: declare each recoverable service, its health
 * probe, and its dependencies as a dynamic list of rows. Builds a real
 * {@link DRCreateBootServicesRequest} (numeric/dependency fields are sent only
 * when supplied; an empty value defers to the backend default). At least one row
 * is always present. Gated upstream by `dr:write`. Bilingual + RTL-safe.
 */
export function DefineBootServicesDialog({
  open,
  onOpenChange,
  onDefine,
  submitting,
}: DefineBootServicesDialogProps) {
  const labels = useTopologyPageLabels();

  const schema = useMemo(
    () => buildServicesSchema(labels.serviceNameError, labels.probeTargetError),
    [labels.serviceNameError, labels.probeTargetError],
  );

  const {
    handleSubmit,
    control,
    register,
    reset,
    formState: { errors },
  } = useForm<ServicesFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { services: [{ ...EMPTY_SERVICE }] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'services' });

  useEffect(() => {
    if (open) reset({ services: [{ ...EMPTY_SERVICE }] });
  }, [open, reset]);

  const submit = handleSubmit((values) => {
    // Empty numeric strings are omitted (backend default); a present value is a
    // validated digit string parsed to a real number.
    const parseInteger = (value?: string): number | undefined => {
      const trimmed = (value ?? '').trim();
      return trimmed === '' ? undefined : Number.parseInt(trimmed, 10);
    };
    const services: DRCreateBootServicesRequest['services'] = values.services.map((svc) => {
      const dependsOn = (svc.depends_on ?? '')
        .split(',')
        .map((dep) => dep.trim())
        .filter(Boolean);
      const entry: DRCreateBootServicesRequest['services'][number] = {
        name: svc.name,
        probe_kind: svc.probe_kind,
        probe_target: svc.probe_target,
      };
      if (svc.kind && svc.kind.trim()) entry.kind = svc.kind.trim();
      const probeExpectStatus = parseInteger(svc.probe_expect_status);
      const bootTimeoutSeconds = parseInteger(svc.boot_timeout_seconds);
      const healthRetries = parseInteger(svc.health_retries);
      if (probeExpectStatus !== undefined) entry.probe_expect_status = probeExpectStatus;
      if (bootTimeoutSeconds !== undefined) entry.boot_timeout_seconds = bootTimeoutSeconds;
      if (healthRetries !== undefined) entry.health_retries = healthRetries;
      if (dependsOn.length > 0) entry.depends_on = dependsOn;
      return entry;
    });
    onDefine({ services });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{labels.defineServicesTitle}</DialogTitle>
            <DialogDescription>{labels.defineServicesDescription}</DialogDescription>
          </DialogHeader>

          <ul className="space-y-4">
            {fields.map((row, index) => (
              <li
                key={row.id}
                className="space-y-4 rounded-card border border-outline-subtle p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-body-sm font-semibold text-content-primary">
                    {labels.serviceRowHeading(index + 1)}
                  </h3>
                  {fields.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="me-1.5 h-4 w-4" aria-hidden />
                      {labels.removeServiceRow}
                    </Button>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ProvisionField
                    label={labels.serviceNameLabel}
                    required
                    error={errors.services?.[index]?.name?.message}
                  >
                    {(props) => (
                      <Input
                        id={props.id}
                        aria-invalid={props['aria-invalid']}
                        aria-describedby={props['aria-describedby']}
                        placeholder={labels.serviceNamePlaceholder}
                        {...register(`services.${index}.name` as const)}
                      />
                    )}
                  </ProvisionField>

                  <ProvisionField label={labels.serviceKindLabel}>
                    {(props) => (
                      <Input
                        id={props.id}
                        aria-describedby={props['aria-describedby']}
                        placeholder={labels.serviceKindPlaceholder}
                        {...register(`services.${index}.kind` as const)}
                      />
                    )}
                  </ProvisionField>

                  <ProvisionField label={labels.probeKindLabel}>
                    {(props) => (
                      <Controller
                        control={control}
                        name={`services.${index}.probe_kind` as const}
                        render={({ field }) => (
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PROBE_KINDS.map((kind) => (
                                <SelectItem key={kind} value={kind}>
                                  {labels.probeKindOptions[kind]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    )}
                  </ProvisionField>

                  <ProvisionField
                    label={labels.probeTargetLabel}
                    required
                    error={errors.services?.[index]?.probe_target?.message}
                  >
                    {(props) => (
                      <Input
                        id={props.id}
                        aria-invalid={props['aria-invalid']}
                        aria-describedby={props['aria-describedby']}
                        placeholder={labels.probeTargetPlaceholder}
                        {...register(`services.${index}.probe_target` as const)}
                      />
                    )}
                  </ProvisionField>

                  <ProvisionField label={labels.probeExpectStatusLabel} help={labels.probeExpectStatusHint}>
                    {(props) => (
                      <Input
                        id={props.id}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-describedby={props['aria-describedby']}
                        {...register(`services.${index}.probe_expect_status` as const)}
                      />
                    )}
                  </ProvisionField>

                  <ProvisionField label={labels.bootTimeoutLabel} help={labels.bootTimeoutHint}>
                    {(props) => (
                      <Input
                        id={props.id}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-describedby={props['aria-describedby']}
                        {...register(`services.${index}.boot_timeout_seconds` as const)}
                      />
                    )}
                  </ProvisionField>

                  <ProvisionField label={labels.healthRetriesLabel} help={labels.healthRetriesHint}>
                    {(props) => (
                      <Input
                        id={props.id}
                        type="number"
                        min={0}
                        inputMode="numeric"
                        aria-describedby={props['aria-describedby']}
                        {...register(`services.${index}.health_retries` as const)}
                      />
                    )}
                  </ProvisionField>

                  <ProvisionField label={labels.dependsOnLabel} help={labels.dependsOnHint}>
                    {(props) => (
                      <Input
                        id={props.id}
                        aria-describedby={props['aria-describedby']}
                        placeholder={labels.dependsOnPlaceholder}
                        {...register(`services.${index}.depends_on` as const)}
                      />
                    )}
                  </ProvisionField>
                </div>
              </li>
            ))}
          </ul>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ ...EMPTY_SERVICE })}
          >
            <Plus className="me-1.5 h-4 w-4" aria-hidden />
            {labels.addServiceRow}
          </Button>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  {labels.defineServicesSubmit}
                </>
              ) : (
                labels.defineServicesSubmit
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
