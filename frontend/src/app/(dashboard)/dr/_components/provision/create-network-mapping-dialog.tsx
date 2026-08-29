'use client';

import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import type { DRCreateNetworkMappingRequest } from '@/types/clario-dr';
import { ProvisionDialogShell } from './provision-dialog-shell';
import { ProvisionField } from './provision-field';
import { useProvisionLabels } from './provision-labels';

/**
 * IPv4 CIDR validator: four 0–255 octets and a /0–32 prefix length. Keeps the
 * client honest before the request reaches the backend's own CIDR parse.
 */
const CIDR_PATTERN =
  /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)\/(3[0-2]|[12]?\d)$/;

/** Zod schema mirroring the real {@link DRCreateNetworkMappingRequest}. */
function buildNetworkMappingSchema(messages: {
  profileError: string;
  primaryCidrError: string;
  recoveryCidrError: string;
}) {
  return z.object({
    profile: z.string().trim().min(1, messages.profileError),
    primary_cidr: z
      .string()
      .trim()
      .min(1, messages.primaryCidrError)
      .regex(CIDR_PATTERN, messages.primaryCidrError),
    recovery_cidr: z
      .string()
      .trim()
      .min(1, messages.recoveryCidrError)
      .regex(CIDR_PATTERN, messages.recoveryCidrError),
  });
}

type NetworkMappingFormValues = z.infer<ReturnType<typeof buildNetworkMappingSchema>>;

export interface CreateNetworkMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useProvisioningActions().createNetworkMapping(groupId, payload)`. */
  onCreate: (payload: DRCreateNetworkMappingRequest) => void;
  submitting: boolean;
}

/**
 * Create-network-mapping dialog: map a primary CIDR range to its recovery-site
 * range under a recovery profile so workloads re-address correctly on failover.
 * The group id is supplied by the caller (it curries the provisioning action).
 * Builds a real {@link DRCreateNetworkMappingRequest}. Gated upstream by
 * `dr:write`. Bilingual + RTL-safe; CIDR placeholders keep Western digits.
 */
export function CreateNetworkMappingDialog({
  open,
  onOpenChange,
  onCreate,
  submitting,
}: CreateNetworkMappingDialogProps) {
  const labels = useProvisionLabels();
  const L = labels.networkMapping;

  const schema = useMemo(
    () =>
      buildNetworkMappingSchema({
        profileError: L.profileError,
        primaryCidrError: L.primaryCidrError,
        recoveryCidrError: L.recoveryCidrError,
      }),
    [L.profileError, L.primaryCidrError, L.recoveryCidrError],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NetworkMappingFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { profile: '', primary_cidr: '', recovery_cidr: '' },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const submit = handleSubmit((values) => {
    onCreate({
      profile: values.profile.trim(),
      primary_cidr: values.primary_cidr.trim(),
      recovery_cidr: values.recovery_cidr.trim(),
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
        label={L.profileLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        error={errors.profile?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...register('profile')}
            placeholder={L.profilePlaceholder}
            autoComplete="off"
          />
        )}
      </ProvisionField>

      <ProvisionField
        label={L.primaryCidrLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        error={errors.primary_cidr?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...register('primary_cidr')}
            placeholder={L.primaryCidrPlaceholder}
            autoComplete="off"
            dir="ltr"
          />
        )}
      </ProvisionField>

      <ProvisionField
        label={L.recoveryCidrLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        error={errors.recovery_cidr?.message}
      >
        {(props) => (
          <Input
            {...props}
            {...register('recovery_cidr')}
            placeholder={L.recoveryCidrPlaceholder}
            autoComplete="off"
            dir="ltr"
          />
        )}
      </ProvisionField>
    </ProvisionDialogShell>
  );
}
