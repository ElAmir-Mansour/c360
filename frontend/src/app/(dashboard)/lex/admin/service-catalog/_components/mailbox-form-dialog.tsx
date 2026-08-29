'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  lexAdminApi,
  type IntakeMailbox,
  type OrgEntity,
  type ServiceCatalogEntry,
} from '@/lib/lex/admin';
import {
  useAdminCommonLabels,
  useServiceCatalogLabels,
  type ServiceCatalogLabels,
} from '../../_lib/admin-labels';

const NO_SERVICE = '__none__';
const NO_ENTITY = '__none__';
const MAILBOX_QUERY_KEY = ['lex-admin-intake-mailboxes'] as const;

function buildSchema(
  mode: 'create' | 'edit',
  errors: ServiceCatalogLabels['mailboxAdmin']['form']['errors'],
) {
  return z.object({
    address: z
      .string()
      .trim()
      .refine((v) => mode === 'edit' || v.length > 0, { message: errors.addressRequired })
      .refine((v) => mode === 'edit' || v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
        message: errors.addressInvalid,
      }),
    request_type: z.string().trim().min(1, errors.requestTypeRequired),
    service_id: z.string(),
    beneficiary_entity_id: z.string(),
    active: z.boolean(),
    ingest_secret: z
      .string()
      .refine((v) => mode === 'edit' || v.trim().length > 0, { message: errors.secretRequired }),
  });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  mailbox?: IntakeMailbox | null;
  mode?: 'create' | 'edit';
  services?: ServiceCatalogEntry[];
  orgEntities?: OrgEntity[];
  requestTypeOptions?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function defaults(mailbox?: IntakeMailbox | null): FormValues {
  return {
    address: mailbox?.address ?? '',
    request_type: mailbox?.request_type ?? '',
    service_id: mailbox?.service_id ?? NO_SERVICE,
    beneficiary_entity_id: mailbox?.beneficiary_entity_id ?? NO_ENTITY,
    active: mailbox?.active ?? true,
    ingest_secret: '',
  };
}

/** Cryptographically strong 32-char base64url shared secret (192 bits). */
function generateSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function MailboxFormDialog({
  mailbox,
  mode,
  services = [],
  orgEntities = [],
  requestTypeOptions = [],
  open,
  onOpenChange,
}: Props) {
  const resolvedMode: 'create' | 'edit' = mode ?? (mailbox ? 'edit' : 'create');
  const isEdit = resolvedMode === 'edit' && Boolean(mailbox);
  const qc = useQueryClient();
  const t = useServiceCatalogLabels();
  const m = t.mailboxAdmin;
  const common = useAdminCommonLabels();
  const { locale } = useLocaleOrDefault();
  const schema = useMemo(() => buildSchema(resolvedMode, m.form.errors), [resolvedMode, m.form.errors]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(mailbox),
  });

  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const requestTypeListId = useMemo(
    () => `mailbox-request-type-options-${mailbox?.id ?? resolvedMode}`,
    [mailbox?.id, resolvedMode],
  );

  useEffect(() => {
    if (open) {
      form.reset(defaults(mailbox));
      setIssuedSecret(null);
    }
  }, [open, mailbox, form]);

  const activeServices = useMemo(
    () => services.filter((service) => service.active || service.id === mailbox?.service_id),
    [services, mailbox?.service_id],
  );

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      const serviceId = v.service_id === NO_SERVICE ? null : v.service_id;
      const beneficiaryId = v.beneficiary_entity_id === NO_ENTITY ? null : v.beneficiary_entity_id;
      const secret = v.ingest_secret.trim();
      if (isEdit && mailbox) {
        await lexAdminApi.updateIntakeMailbox(mailbox.id, {
          request_type: v.request_type,
          service_id: serviceId,
          beneficiary_entity_id: beneficiaryId,
          active: v.active,
          ...(secret ? { ingest_secret: secret } : {}),
        });
        return { rotated: Boolean(secret), secret };
      }
      await lexAdminApi.createIntakeMailbox({
        address: v.address.trim(),
        request_type: v.request_type,
        service_id: serviceId,
        beneficiary_entity_id: beneficiaryId,
        ingest_secret: secret,
        active: v.active,
      });
      return { rotated: false, secret };
    },
    onSuccess: async (result) => {
      showSuccess(isEdit ? (result.rotated ? m.toast.rotated : common.toast.updated) : m.toast.created);
      await qc.invalidateQueries({ queryKey: MAILBOX_QUERY_KEY });
      // A freshly issued secret (on create, or on an edit that rotated it) is
      // never returned by the API — reveal it once, then the operator closes.
      if (result.secret) {
        setIssuedSecret(result.secret);
      } else {
        onOpenChange(false);
      }
    },
    onError: showApiError,
  });

  const copySecret = async () => {
    if (!issuedSecret) return;
    try {
      await navigator.clipboard.writeText(issuedSecret);
      showSuccess(m.secretPanel.copied);
    } catch {
      showApiError(new Error(m.secretPanel.copyFailed));
    }
  };

  const serviceLabel = (service: ServiceCatalogEntry) =>
    `${resolveLocalized(service.name, locale) || service.code} (${service.code})`;
  const entityLabel = (entity: OrgEntity) =>
    `${resolveLocalized(entity.name, locale) || entity.code} (${entity.code})`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? m.form.editTitle : m.form.createTitle}</DialogTitle>
          <DialogDescription>{isEdit ? m.form.editDescription : m.form.createDescription}</DialogDescription>
        </DialogHeader>

        {issuedSecret ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-warning-300 bg-warning-50 p-4 dark:border-warning-700 dark:bg-warning-950/40">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning-700 dark:text-warning-300" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">{m.secretPanel.title}</p>
                <p className="text-xs text-muted-foreground">{m.secretPanel.warning}</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issued_secret">{m.form.ingestSecret}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="issued_secret"
                  readOnly
                  dir="ltr"
                  value={issuedSecret}
                  className="font-mono text-xs"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={copySecret}>
                  <Copy className="me-1.5 h-4 w-4" />
                  {m.secretPanel.copy}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                {m.secretPanel.done}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <FormProvider {...form}>
            <form className="space-y-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
              {!isEdit ? <LexCreationGuidance workflow="service" /> : null}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  name="address"
                  label={m.form.address}
                  required={!isEdit}
                  description={isEdit ? m.form.addressImmutable : undefined}
                >
                  <Input
                    id="address"
                    type="email"
                    dir="ltr"
                    {...form.register('address')}
                    placeholder={m.form.addressPlaceholder}
                    disabled={isEdit}
                  />
                </FormField>
                <FormField name="request_type" label={m.form.requestType} required>
                  <Input
                    id="request_type"
                    list={requestTypeListId}
                    {...form.register('request_type')}
                    placeholder={m.form.requestTypePlaceholder}
                  />
                  <datalist id={requestTypeListId}>
                    {requestTypeOptions.map((value) => (
                      <option key={value} value={value} />
                    ))}
                  </datalist>
                </FormField>
                <FormField name="service_id" label={m.form.service}>
                  <Select
                    value={form.watch('service_id')}
                    onValueChange={(v) => form.setValue('service_id', v, { shouldValidate: true })}
                  >
                    <SelectTrigger id="service_id">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_SERVICE}>{m.form.serviceNone}</SelectItem>
                      {activeServices.map((service) => (
                        <SelectItem key={service.id} value={service.id}>
                          {serviceLabel(service)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField name="beneficiary_entity_id" label={m.form.beneficiary}>
                  <Select
                    value={form.watch('beneficiary_entity_id')}
                    onValueChange={(v) =>
                      form.setValue('beneficiary_entity_id', v, { shouldValidate: true })
                    }
                  >
                    <SelectTrigger id="beneficiary_entity_id">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ENTITY}>{m.form.beneficiaryNone}</SelectItem>
                      {orgEntities.map((entity) => (
                        <SelectItem key={entity.id} value={entity.id}>
                          {entityLabel(entity)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>

              <FormField
                name="ingest_secret"
                label={m.form.ingestSecret}
                required={!isEdit}
                description={isEdit ? m.form.ingestSecretRotateHint : m.form.ingestSecretCreateHint}
              >
                <div className="flex items-center gap-2">
                  <Input
                    id="ingest_secret"
                    dir="ltr"
                    autoComplete="off"
                    className="font-mono text-xs"
                    {...form.register('ingest_secret')}
                    placeholder={m.form.ingestSecretPlaceholder}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => form.setValue('ingest_secret', generateSecret(), { shouldValidate: true })}
                  >
                    <KeyRound className="me-1.5 h-4 w-4" />
                    {m.form.generate}
                  </Button>
                </div>
              </FormField>

              <div className="flex items-center gap-2">
                <Switch
                  id="active"
                  checked={form.watch('active')}
                  onCheckedChange={(c) => form.setValue('active', c)}
                />
                <Label htmlFor="active">{m.form.active}</Label>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {common.cancel}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                  {isEdit ? common.save : common.create}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}
