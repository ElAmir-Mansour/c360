'use client';

import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2 } from 'lucide-react';
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
import type {
  DRProtectedSite,
  DRReplicationStream,
  DRTopologyAddEdgeRequest,
} from '@/types/clario-dr';
import { ProvisionField } from '../../_components/provision/provision-field';
import { useTopologyLabels } from '../../_components/topology/topology-labels';
import { useTopologyPageLabels } from './topology-page-labels';

/**
 * Real backend tokens (`internal/dr/topology`): node roles and edge modes.
 * `service.AddEdge` defaults role to `target`/`source` and mode to `async`, and
 * rejects anything outside these sets — so the form offers exactly these.
 */
const ROLE_TOKENS = ['source', 'relay', 'target'] as const;
const MODE_TOKENS = ['sync', 'async'] as const;

/**
 * Zod schema mirroring the REAL {@link DRTopologyAddEdgeRequest}: `from_site_id`,
 * `to_site_id`, `stream_id` are required; `from_role`/`to_role`/`mode`/`priority`
 * are optional (the backend supplies defaults). `priority` is a non-negative
 * integer (lower ranks higher); empty leaves it to the backend default.
 */
function buildEdgeSchema(siteError: string, streamError: string) {
  return z.object({
    from_site_id: z.string().trim().min(1, siteError),
    to_site_id: z.string().trim().min(1, siteError),
    stream_id: z.string().trim().min(1, streamError),
    from_role: z.enum(ROLE_TOKENS),
    to_role: z.enum(ROLE_TOKENS),
    mode: z.enum(MODE_TOKENS),
    priority: z
      .union([z.coerce.number().int().min(0), z.literal('')])
      .optional(),
  });
}

type EdgeFormValues = z.infer<ReturnType<typeof buildEdgeSchema>>;

export interface AddEdgeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wired to `useTopologyActions().addTopologyEdge(groupId, payload)`. */
  onAddEdge: (payload: DRTopologyAddEdgeRequest) => void;
  submitting: boolean;
  /** Sites an edge can connect (the tenant's protected sites). */
  sites: DRProtectedSite[];
  /** Replication streams an edge can run over. */
  streams: DRReplicationStream[];
}

/**
 * Add-topology-edge dialog: connect a source site to a recovery site over a
 * replication stream, with role/mode/priority. Builds a real
 * {@link DRTopologyAddEdgeRequest} from a zod-valid form. Priority is sent only
 * when supplied; an empty priority defers to the backend default. Gated upstream
 * by `dr:write`. Bilingual + RTL-safe (logical spacing, foundation copy).
 */
export function AddEdgeDialog({
  open,
  onOpenChange,
  onAddEdge,
  submitting,
  sites,
  streams,
}: AddEdgeDialogProps) {
  const labels = useTopologyLabels();
  const pageLabels = useTopologyPageLabels();

  const schema = useMemo(
    () => buildEdgeSchema(labels.fromSitePlaceholder, labels.streamPlaceholder),
    [labels.fromSitePlaceholder, labels.streamPlaceholder],
  );

  const {
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<EdgeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      from_site_id: '',
      to_site_id: '',
      stream_id: '',
      from_role: 'source',
      to_role: 'target',
      mode: 'async',
      priority: '',
    },
  });

  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const hasSites = sites.length > 0;
  const hasStreams = streams.length > 0;
  const canSubmit = hasSites && hasStreams;

  const submit = handleSubmit((values) => {
    const payload: DRTopologyAddEdgeRequest = {
      from_site_id: values.from_site_id,
      to_site_id: values.to_site_id,
      stream_id: values.stream_id,
      from_role: values.from_role,
      to_role: values.to_role,
      mode: values.mode,
    };
    if (typeof values.priority === 'number') {
      payload.priority = values.priority;
    }
    onAddEdge(payload);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={submit} className="space-y-5" noValidate>
          <DialogHeader>
            <DialogTitle>{labels.addEdgeDialogTitle}</DialogTitle>
            <DialogDescription>{labels.addEdgeDialogDescription}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <ProvisionField label={labels.fromSiteLabel} required error={errors.from_site_id?.message}>
              {(props) => (
                <Controller
                  control={control}
                  name="from_site_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!hasSites}>
                      <SelectTrigger
                        id={props.id}
                        aria-invalid={props['aria-invalid']}
                        aria-describedby={props['aria-describedby']}
                      >
                        <SelectValue placeholder={labels.fromSitePlaceholder} />
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

            <ProvisionField label={labels.fromRoleLabel}>
              {(props) => (
                <Controller
                  control={control}
                  name="from_role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_TOKENS.map((role) => (
                          <SelectItem key={role} value={role}>
                            {pageLabels.roleOptions[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </ProvisionField>

            <ProvisionField label={labels.toSiteLabel} required error={errors.to_site_id?.message}>
              {(props) => (
                <Controller
                  control={control}
                  name="to_site_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!hasSites}>
                      <SelectTrigger
                        id={props.id}
                        aria-invalid={props['aria-invalid']}
                        aria-describedby={props['aria-describedby']}
                      >
                        <SelectValue placeholder={labels.toSitePlaceholder} />
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

            <ProvisionField label={labels.toRoleLabel}>
              {(props) => (
                <Controller
                  control={control}
                  name="to_role"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLE_TOKENS.map((role) => (
                          <SelectItem key={role} value={role}>
                            {pageLabels.roleOptions[role]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </ProvisionField>

            <ProvisionField label={labels.streamLabel} required error={errors.stream_id?.message}>
              {(props) => (
                <Controller
                  control={control}
                  name="stream_id"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!hasStreams}>
                      <SelectTrigger
                        id={props.id}
                        aria-invalid={props['aria-invalid']}
                        aria-describedby={props['aria-describedby']}
                      >
                        <SelectValue placeholder={labels.streamPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        {streams.map((stream) => (
                          <SelectItem key={stream.id} value={stream.id}>
                            {stream.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </ProvisionField>

            <ProvisionField label={labels.modeLabel}>
              {(props) => (
                <Controller
                  control={control}
                  name="mode"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id={props.id} aria-describedby={props['aria-describedby']}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MODE_TOKENS.map((mode) => (
                          <SelectItem key={mode} value={mode}>
                            {pageLabels.modeOptions[mode]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </ProvisionField>

            <ProvisionField label={labels.priorityLabel} help={labels.priorityHint} error={errors.priority?.message}>
              {(props) => (
                <Controller
                  control={control}
                  name="priority"
                  render={({ field }) => (
                    <Input
                      id={props.id}
                      type="number"
                      min={0}
                      inputMode="numeric"
                      aria-invalid={props['aria-invalid']}
                      aria-describedby={props['aria-describedby']}
                      value={field.value ?? ''}
                      onChange={(event) => field.onChange(event.target.value)}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              )}
            </ProvisionField>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={submitting || !canSubmit}>
              {submitting ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden />
                  {labels.submit}
                </>
              ) : (
                labels.submit
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
