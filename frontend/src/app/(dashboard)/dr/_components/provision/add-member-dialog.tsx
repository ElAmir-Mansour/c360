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
import type { DRAddGroupMemberRequest, DRProtectedSite } from '@/types/clario-dr';
import { ProvisionDialogShell } from './provision-dialog-shell';
import { ProvisionField } from './provision-field';
import { useProvisionLabels } from './provision-labels';

/**
 * Zod schema mirroring the real {@link DRAddGroupMemberRequest} (site_id +
 * boot_order). `boot_order` is coerced from the numeric input and must be a
 * non-negative integer (lower boots first; 0 is valid). Messages are localized.
 */
function buildMemberSchema(messages: { siteError: string; bootOrderError: string }) {
  return z.object({
    site_id: z.string().trim().min(1, messages.siteError),
    boot_order: z.coerce
      .number({ invalid_type_error: messages.bootOrderError })
      .int(messages.bootOrderError)
      .min(0, messages.bootOrderError),
  });
}

type MemberFormValues = z.infer<ReturnType<typeof buildMemberSchema>>;

export interface AddMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useProvisioningActions().addMember(groupId, payload)`. */
  onAdd: (payload: DRAddGroupMemberRequest) => void;
  submitting: boolean;
  /** Sites the operator can add — already filtered to those not yet in the group. */
  eligibleSites: DRProtectedSite[];
}

/**
 * Add-member dialog: pick a protected site and set its boot order within a
 * protection group. The group id is supplied by the caller (it curries the
 * provisioning action), so this dialog only builds the real
 * {@link DRAddGroupMemberRequest}. When no eligible site remains the picker is
 * disabled and submit is blocked, with a helpful empty-option message. Gated
 * upstream by `dr:write`. Bilingual + RTL-safe.
 */
export function AddMemberDialog({
  open,
  onOpenChange,
  onAdd,
  submitting,
  eligibleSites,
}: AddMemberDialogProps) {
  const labels = useProvisionLabels();
  const L = labels.member;

  const schema = useMemo(
    () => buildMemberSchema({ siteError: L.siteError, bootOrderError: L.bootOrderError }),
    [L.siteError, L.bootOrderError],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<MemberFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { site_id: '', boot_order: 0 },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const hasEligibleSites = eligibleSites.length > 0;

  const submit = handleSubmit((values) => {
    onAdd({ site_id: values.site_id, boot_order: values.boot_order });
  });

  return (
    <ProvisionDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={L.dialogTitle}
      description={L.dialogDescription}
      onSubmit={submit}
      submitting={submitting}
      submitDisabled={!hasEligibleSites}
    >
      <ProvisionField
        label={L.siteLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        error={errors.site_id?.message}
        help={hasEligibleSites ? undefined : L.noEligibleSites}
      >
        {(props) => (
          <Controller
            control={control}
            name="site_id"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={!hasEligibleSites}
              >
                <SelectTrigger
                  id={props.id}
                  aria-invalid={props['aria-invalid']}
                  aria-describedby={props['aria-describedby']}
                >
                  <SelectValue placeholder={L.sitePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {eligibleSites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </ProvisionField>

      <ProvisionField
        label={L.bootOrderLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        help={L.bootOrderHelp}
        error={errors.boot_order?.message}
      >
        {(props) => (
          <Input
            {...props}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            {...register('boot_order')}
          />
        )}
      </ProvisionField>
    </ProvisionDialogShell>
  );
}
