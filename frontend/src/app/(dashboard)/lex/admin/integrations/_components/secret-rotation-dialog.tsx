'use client';

/**
 * SecretRotationDialog (Feature 7).
 *
 * Lets an operator rotate one secret config field without ever seeing the
 * current value. Flow: pick a secret field (from the kind schema's
 * `secret === true` specs) → enter a new value → optionally Test the connection
 * → Rotate (rotateSecret). The current secret is never rendered; the input is
 * write-only and the endpoint comes back with the field still masked.
 *
 * Last-rotated + expiry hints are read from the endpoint metadata
 * (`<field>_rotated_at` / `secret_rotated_at`, `<field>_expires_at` /
 * `secret_expires_at`); an expiry in the past surfaces a warning.
 *
 * RBAC: the whole surface is a MANAGE action — the parent only mounts it when
 * `canManage` is true, but the trigger is still disabled defensively.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  getSchema,
  rotateSecret,
  testConnection,
  type FieldSpec,
  type IntegrationEndpoint,
  type TestResult,
} from '@/lib/lex/integrations';
import { useDetailOpsLabels, fillOpsToken } from '../_lib/detail-ops-labels';
import { formatRelative, isPast, readMetaString } from '../_lib/detail-ops-format';

interface SecretRotationDialogProps {
  endpoint: IntegrationEndpoint;
  canManage: boolean;
  /** Refetch the endpoint after a successful rotation. */
  onRotated?: () => void;
}

function rotatedAt(meta: Record<string, unknown> | undefined, field: string): string | undefined {
  return (
    readMetaString(meta, `${field}_rotated_at`) ??
    readMetaString(meta, `${field}_last_rotated`) ??
    readMetaString(meta, 'secret_rotated_at')
  );
}

function expiresAt(meta: Record<string, unknown> | undefined, field: string): string | undefined {
  return (
    readMetaString(meta, `${field}_expires_at`) ??
    readMetaString(meta, `${field}_expiry`) ??
    readMetaString(meta, 'secret_expires_at')
  );
}

export function SecretRotationDialog({
  endpoint,
  canManage,
  onRotated,
}: SecretRotationDialogProps) {
  const t = useDetailOpsLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [field, setField] = useState<string>('');
  const [value, setValue] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const schemaQuery = useQuery({
    queryKey: ['lex-integration-schema', endpoint.kind],
    queryFn: () => getSchema(endpoint.kind),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  const secretFields = useMemo<FieldSpec[]>(
    () => (schemaQuery.data ?? []).filter((f) => f.secret),
    [schemaQuery.data],
  );

  const selected = secretFields.find((f) => f.key === field) ?? null;
  const meta = endpoint.metadata;
  const lastRotated = field ? rotatedAt(meta, field) : undefined;
  const expiry = field ? expiresAt(meta, field) : undefined;
  const expired = isPast(expiry);

  function reset() {
    setField('');
    setValue('');
    setTestResult(null);
  }

  const test = useMutation({
    mutationFn: () => testConnection(endpoint.id),
    onSuccess: (res) => setTestResult(res),
    onError: (e) => showBackendError(e, t.opsError),
  });

  const rotate = useMutation({
    mutationFn: () => rotateSecret(endpoint.id, field, value),
    onSuccess: async () => {
      showSuccess(t.toastSecretRotated);
      await qc.invalidateQueries({ queryKey: ['lex-integration', endpoint.id] });
      onRotated?.();
      setOpen(false);
      reset();
    },
    onError: (e) => showBackendError(e, t.opsError),
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setOpen(true)}
        disabled={!canManage}
      >
        <KeyRound className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {t.rotateOpen}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir={direction} lang={locale}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" aria-hidden />
              {t.rotateDialogTitle}
            </DialogTitle>
            <DialogDescription>{t.rotateDialogBody}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* No secrets case. */}
            {schemaQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">{t.rotating}</p>
            ) : secretFields.length === 0 ? (
              <p className="rounded-lg border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                {t.rotateNoSecrets}
              </p>
            ) : (
              <>
                {/* Field picker. */}
                <div className="space-y-1.5">
                  <Label htmlFor="rotate-field">{t.rotateField}</Label>
                  <Select value={field} onValueChange={(v) => { setField(v); setTestResult(null); }}>
                    <SelectTrigger id="rotate-field">
                      <SelectValue placeholder={t.rotateFieldPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {secretFields.map((f) => (
                        <SelectItem key={f.key} value={f.key}>
                          {resolveLocalized(f.label, locale) || f.key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Rotation metadata. */}
                {field ? (
                  <div className="space-y-1 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                    <p className="text-muted-foreground">
                      {lastRotated
                        ? fillOpsToken(t.rotateLastRotated, 'ago', formatRelative(lastRotated, locale))
                        : t.rotateNeverRotated}
                    </p>
                    {expiry ? (
                      <p
                        className={cn(
                          'inline-flex items-center gap-1.5',
                          expired ? 'font-medium text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {expired ? (
                          <ShieldAlert className="h-3 w-3" aria-hidden />
                        ) : (
                          <AlertTriangle className="h-3 w-3" aria-hidden />
                        )}
                        {expired
                          ? t.rotateExpired
                          : fillOpsToken(t.rotateExpiryWarning, 'when', formatRelative(expiry, locale))}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* New value (write-only). */}
                <div className="space-y-1.5">
                  <Label htmlFor="rotate-value">{t.rotateNewValue}</Label>
                  <Input
                    id="rotate-value"
                    type="password"
                    autoComplete="new-password"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={t.rotateNewValuePlaceholder}
                    disabled={!field}
                    dir="ltr"
                  />
                  <p className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
                    <ShieldCheck className="h-3 w-3" aria-hidden />
                    {t.rotateNeverShowOld}
                  </p>
                </div>

                {/* Test result. */}
                {testResult ? (
                  <div
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs',
                      testResult.reachable
                        ? 'border-primary/30 bg-primary/5 text-primary'
                        : 'border-destructive/40 bg-destructive/5 text-destructive',
                    )}
                  >
                    {testResult.reachable ? (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {testResult.detail || (testResult.reachable ? t.rotateTestFirst : t.opsError)}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t.rotateCancel}
            </Button>
            {secretFields.length > 0 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => test.mutate()}
                  disabled={test.isPending || rotate.isPending}
                >
                  {test.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {t.rotateTestFirst}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (!value.trim()) {
                      showBackendError(new Error(t.rotateEmptyValue), t.rotateEmptyValue);
                      return;
                    }
                    rotate.mutate();
                  }}
                  disabled={!field || !value.trim() || rotate.isPending}
                >
                  {rotate.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {rotate.isPending ? t.rotating : t.rotateConfirm}
                </Button>
              </>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
