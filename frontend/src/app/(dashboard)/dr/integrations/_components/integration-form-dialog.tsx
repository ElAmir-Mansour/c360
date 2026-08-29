'use client';

import { useEffect, useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type {
  DRCreateIntegrationRequest,
  DRIntegration,
  DRIntegrationCredentials,
  DRIntegrationKind,
  DRIntegrationVendor,
} from '@/lib/clario-dr';
import { useIntegrationConstants, vendorsForKind } from './integration-constants';
import { useIntegrationHealthLabels } from './integration-health';

interface IntegrationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing integration; null when creating. */
  integration: DRIntegration | null;
  /** Disables the submit control while a create/update mutation is in flight. */
  submitting?: boolean;
  onSubmit: (payload: DRCreateIntegrationRequest) => Promise<void> | void;
}

interface FormState {
  name: string;
  kind: DRIntegrationKind;
  vendor: string;
  endpoint: string;
  enabled: boolean;
  username: string;
  token: string;
  caCertPem: string;
}

const DEFAULT_KIND: DRIntegrationKind = 'hypervisor';

function defaultState(): FormState {
  return {
    name: '',
    kind: DEFAULT_KIND,
    vendor: vendorsForKind(DEFAULT_KIND)[0]?.value ?? '',
    endpoint: '',
    enabled: true,
    username: '',
    token: '',
    caCertPem: '',
  };
}

function stateFromIntegration(integration: DRIntegration): FormState {
  return {
    name: integration.name,
    kind: (integration.kind as DRIntegrationKind) ?? DEFAULT_KIND,
    vendor: integration.vendor,
    endpoint: integration.endpoint,
    enabled: integration.enabled,
    // Credentials are write-only and never returned — always start blank.
    username: '',
    token: '',
    caCertPem: '',
  };
}

export function IntegrationFormDialog({
  open,
  onOpenChange,
  integration,
  submitting = false,
  onSubmit,
}: IntegrationFormDialogProps) {
  const isEditing = Boolean(integration);
  const copy = useIntegrationHealthLabels();
  const constants = useIntegrationConstants();
  const [state, setState] = useState<FormState>(defaultState);

  useEffect(() => {
    if (!open) return;
    setState(integration ? stateFromIntegration(integration) : defaultState());
  }, [open, integration]);

  const vendorOptions = useMemo(
    () => constants.vendorsForKind(state.kind),
    [constants, state.kind],
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setState((current) => ({ ...current, [key]: value }));
  };

  const handleKindChange = (kind: string) => {
    const nextKind = kind as DRIntegrationKind;
    const options = vendorsForKind(nextKind);
    const stillValid = options.some((option) => option.value === state.vendor);
    setState((current) => ({
      ...current,
      kind: nextKind,
      vendor: stillValid ? current.vendor : options[0]?.value ?? '',
    }));
  };

  const canSubmit =
    state.name.trim().length > 0 &&
    state.vendor.trim().length > 0 &&
    state.endpoint.trim().length > 0 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    const credentials: DRIntegrationCredentials = {};
    if (state.username.trim()) credentials.username = state.username.trim();
    if (state.token.trim()) credentials.token = state.token.trim();
    if (state.caCertPem.trim()) credentials.ca_cert_pem = state.caCertPem.trim();
    const hasCredentials = Object.keys(credentials).length > 0;

    const payload: DRCreateIntegrationRequest = {
      name: state.name.trim(),
      kind: state.kind,
      vendor: state.vendor as DRIntegrationVendor,
      endpoint: state.endpoint.trim(),
      enabled: state.enabled,
      ...(hasCredentials ? { credentials } : {}),
    };

    await onSubmit(payload);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? copy.dialogEditTitle : copy.dialogCreateTitle}
          </DialogTitle>
          <DialogDescription>{copy.dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="integration-name">{copy.fieldName}</Label>
            <Input
              id="integration-name"
              value={state.name}
              placeholder={copy.fieldNamePlaceholder}
              onChange={(event) => update('name', event.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="integration-kind">{copy.fieldKind}</Label>
              <Select value={state.kind} onValueChange={handleKindChange}>
                <SelectTrigger id="integration-kind">
                  <SelectValue placeholder={copy.fieldKindPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {constants.kindOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="integration-vendor">{copy.fieldVendor}</Label>
              <Select
                value={state.vendor}
                onValueChange={(value) => update('vendor', value)}
                disabled={vendorOptions.length === 0}
              >
                <SelectTrigger id="integration-vendor">
                  <SelectValue placeholder={copy.fieldVendorPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {vendorOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="integration-endpoint">{copy.fieldEndpoint}</Label>
            <Input
              id="integration-endpoint"
              value={state.endpoint}
              placeholder={copy.fieldEndpointPlaceholder}
              onChange={(event) => update('endpoint', event.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="integration-enabled">{copy.fieldEnabled}</Label>
              <p className="text-xs text-muted-foreground">{copy.fieldEnabledHint}</p>
            </div>
            <Switch
              id="integration-enabled"
              checked={state.enabled}
              onCheckedChange={(checked) => update('enabled', checked)}
            />
          </div>

          <Separator />

          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              {copy.credentialsHeading}
            </div>
            <p className="text-xs text-muted-foreground">
              {isEditing ? copy.credentialsHintEditing : copy.credentialsHintCreating}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="integration-username">{copy.fieldUsername}</Label>
            <Input
              id="integration-username"
              autoComplete="off"
              value={state.username}
              placeholder={copy.fieldUsernamePlaceholder}
              onChange={(event) => update('username', event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="integration-token">{copy.fieldToken}</Label>
            <Input
              id="integration-token"
              type="password"
              autoComplete="new-password"
              value={state.token}
              placeholder={
                isEditing ? copy.fieldTokenPlaceholderEditing : copy.fieldTokenPlaceholderCreating
              }
              onChange={(event) => update('token', event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="integration-ca-cert">{copy.fieldCaCert}</Label>
            <Textarea
              id="integration-ca-cert"
              rows={4}
              className="font-mono text-xs"
              value={state.caCertPem}
              placeholder={copy.fieldCaCertPlaceholder}
              onChange={(event) => update('caCertPem', event.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {copy.dialogCancel}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting
              ? copy.dialogSaving
              : isEditing
                ? copy.dialogSaveChanges
                : copy.dialogCreate}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
