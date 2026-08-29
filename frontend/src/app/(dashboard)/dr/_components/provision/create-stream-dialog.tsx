'use client';

import { useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DRCreateStreamRequest, DRProtectedSite } from '@/types/clario-dr';
import { ProvisionDialogShell } from './provision-dialog-shell';
import { ProvisionField } from './provision-field';
import { useProvisionLabels } from './provision-labels';

/**
 * The only initial status the backend accepts for a new stream.
 * `service.CreateStream` rejects any other asserted status ("new streams must
 * start pending"), so this is the sole exposed (and submitted) value.
 */
const PENDING_STATUS = 'pending';

/** Zod schema mirroring the real {@link DRCreateStreamRequest} (site_id + status). */
function buildStreamSchema(siteError: string) {
  return z.object({
    site_id: z.string().trim().min(1, siteError),
    // Locked to "pending" — backend rejects anything else on create.
    status: z.literal(PENDING_STATUS),
  });
}

type StreamFormValues = z.infer<ReturnType<typeof buildStreamSchema>>;

export interface CreateStreamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useProvisioningActions().createStream`. */
  onCreate: (payload: DRCreateStreamRequest) => void;
  submitting: boolean;
  /** Sites a stream can be opened for. */
  sites: DRProtectedSite[];
}

/**
 * Create-replication-stream dialog: open a continuous data-protection stream for
 * a protected site. The status field is locked to `pending` (the only value the
 * backend accepts on create) and explained inline. Builds a real
 * {@link DRCreateStreamRequest}. Gated upstream by `dr:write`. Bilingual + RTL-safe.
 */
export function CreateStreamDialog({
  open,
  onOpenChange,
  onCreate,
  submitting,
  sites,
}: CreateStreamDialogProps) {
  const labels = useProvisionLabels();
  const L = labels.stream;

  const schema = useMemo(() => buildStreamSchema(L.siteError), [L.siteError]);

  const {
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<StreamFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { site_id: '', status: PENDING_STATUS },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const hasSites = sites.length > 0;

  const submit = handleSubmit((values) => {
    onCreate({ site_id: values.site_id, status: values.status });
  });

  return (
    <ProvisionDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={L.dialogTitle}
      description={L.dialogDescription}
      onSubmit={submit}
      submitting={submitting}
      submitDisabled={!hasSites}
    >
      <ProvisionField
        label={L.siteLabel}
        required
        requiredHint={labels.actions.requiredFieldHint}
        error={errors.site_id?.message}
      >
        {(props) => (
          <Controller
            control={control}
            name="site_id"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} disabled={!hasSites}>
                <SelectTrigger
                  id={props.id}
                  aria-invalid={props['aria-invalid']}
                  aria-describedby={props['aria-describedby']}
                >
                  <SelectValue placeholder={L.sitePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {sites.map((site) => (
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

      <ProvisionField label={L.statusLabel} help={L.statusHelp}>
        {(props) => (
          <Select value={PENDING_STATUS} disabled>
            <SelectTrigger
              id={props.id}
              aria-describedby={props['aria-describedby']}
            >
              <SelectValue placeholder={L.statusPendingOption} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PENDING_STATUS}>{L.statusPendingOption}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </ProvisionField>
    </ProvisionDialogShell>
  );
}
