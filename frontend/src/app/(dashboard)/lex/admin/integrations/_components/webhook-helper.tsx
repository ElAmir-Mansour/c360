'use client';

/**
 * WebhookHelper (Feature 3).
 *
 * Surfaces the connector's inbound URLs (callback / redirect / SCIM) from the
 * catalog `callback_templates`, resolved with THIS endpoint id + the active
 * tenant id, each with a copy button. Offers a "Send test event" action
 * (sendWebhookTest → InvokeResult) and a "last event received {ago}" indicator
 * read from endpoint metadata (`last_received_event_at`).
 *
 * The catalog is fetched here; if the live catalog is unavailable this helper
 * warns instead of implying the connector exposes no inbound URLs. URL templates
 * interpolate `{tenant}`, `{id}`, `{endpoint}`, and `{base}` (the gateway
 * origin) tokens.
 *
 * For an HR/SCIM connector (kind=hr) it also renders {@link ScimTokenSection} —
 * the copy-once "Issue SCIM token" surface + the non-secret token list — which
 * hides itself when the backend SCIM-token routes are not wired (404).
 *
 * RBAC: "Send test event" and "Issue SCIM token" are MANAGE actions; hidden when
 * `canManage === false`.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  Radio,
  Send,
  ShieldAlert,
  ShieldCheck,
  Webhook,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CopyButton } from '@/components/shared/copy-button';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  getCatalogResult,
  issueScimToken,
  listScimTokensResult,
  sendWebhookTest,
  type IntegrationEndpoint,
  type InvokeResult,
  type IssuedScimToken,
} from '@/lib/lex/integrations';
import { useDetailOpsLabels, fillOpsToken } from '../_lib/detail-ops-labels';
import { formatRelative, readMetaString } from '../_lib/detail-ops-format';

interface WebhookHelperProps {
  endpoint: IntegrationEndpoint;
  canManage: boolean;
}

/** Resolve a callback URL template against this endpoint + tenant. */
function resolveTemplate(template: string, endpoint: IntegrationEndpoint, tenantId: string): string {
  const base =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : '';
  return template
    .replace(/\{tenant(_id)?\}/g, tenantId)
    .replace(/\{(endpoint|id|endpoint_id)\}/g, endpoint.id)
    .replace(/\{kind\}/g, endpoint.kind)
    .replace(/\{base(_url)?\}/g, base);
}

export function WebhookHelper({ endpoint, canManage }: WebhookHelperProps) {
  const t = useDetailOpsLabels();
  const { locale, direction } = useLocaleOrDefault();
  const { tenant } = useAuth();
  const tenantId = tenant?.id ?? endpoint.tenant_id ?? '';
  const [result, setResult] = useState<InvokeResult | null>(null);

  const catalogQuery = useQuery({
    queryKey: ['lex-integration-catalog'],
    queryFn: () => getCatalogResult(),
    staleTime: 5 * 60_000,
  });
  const catalogEntries = catalogQuery.data?.entries ?? [];
  const catalogDegraded = catalogQuery.isError || (catalogQuery.data?.degraded ?? false);

  const templates = useMemo(() => {
    const entry = catalogEntries.find((c) => c.kind === endpoint.kind);
    const raw = entry?.callback_templates ?? {};
    return Object.entries(raw).map(([label, template]) => ({
      label,
      url: resolveTemplate(template, endpoint, tenantId),
    }));
  }, [catalogEntries, endpoint, tenantId]);

  const lastReceived = readMetaString(endpoint.metadata, 'last_received_event_at');

  const sendTest = useMutation({
    mutationFn: () => sendWebhookTest(endpoint.id),
    onSuccess: (res) => {
      setResult(res);
      showSuccess(t.toastWebhookSent);
    },
    onError: (e) => showBackendError(e, t.opsError),
  });

  return (
    <div className="space-y-3" dir={direction} lang={locale}>
      <p className="text-xs text-muted-foreground">{t.webhookSubtitle}</p>

      {/* Last inbound event indicator. */}
      <div className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
        <Radio
          className={cn('h-3.5 w-3.5', lastReceived ? 'text-primary' : 'text-muted-foreground')}
          aria-hidden
        />
        <span className={lastReceived ? 'text-foreground' : 'text-muted-foreground'}>
          {lastReceived
            ? fillOpsToken(t.webhookLastReceived, 'ago', formatRelative(lastReceived, locale))
            : t.webhookNeverReceived}
        </span>
      </div>

      {/* URL list. */}
      {catalogQuery.isLoading ? (
        <LoadingSkeleton variant="list-item" count={2} />
      ) : catalogDegraded ? (
        <div className="flex items-start gap-2 rounded-lg border border-warning-300/60 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:bg-warning-800/15 dark:text-warning-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-0.5">
            <p className="font-medium">{t.webhookTitle}</p>
            <p className="text-xs">{t.opsError}</p>
          </div>
        </div>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title={t.webhookNoTemplates}
          description={t.webhookSubtitle}
          size="compact"
        />
      ) : (
        <ul className="space-y-2">
          {templates.map((tpl) => (
            <li key={tpl.label} className="rounded-lg border bg-card/60 p-2.5">
              <div className="mb-1 text-overline font-medium uppercase text-muted-foreground">
                {tpl.label}
              </div>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 truncate rounded bg-muted/40 px-2 py-1 text-caption text-foreground/80"
                  dir="ltr"
                  title={tpl.url}
                >
                  {tpl.url}
                </code>
                <CopyButton value={tpl.url} label={t.webhookCopy} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Send test event. */}
      {canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => sendTest.mutate()}
          disabled={sendTest.isPending}
        >
          {sendTest.isPending ? (
            <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Send className="me-1.5 h-3.5 w-3.5" aria-hidden />
          )}
          {sendTest.isPending ? t.webhookSending : t.webhookSendTest}
        </Button>
      ) : (
        <p className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {t.manageOnlyNote}
        </p>
      )}

      {/* Test result. */}
      {result ? (
        <div
          className={cn(
            'space-y-1 rounded-lg border px-3 py-2 text-xs',
            result.success
              ? 'border-primary/30 bg-primary/5'
              : 'border-destructive/40 bg-destructive/5',
          )}
        >
          <div className="flex items-center gap-1.5 font-medium">
            {result.success ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
            )}
            {result.success ? t.webhookTestOk : t.webhookTestFailed}
          </div>
          {result.detail ? <p className="text-muted-foreground">{result.detail}</p> : null}
        </div>
      ) : null}

      {/* Inbound SCIM bearer tokens — HR/SCIM connector activation (kind=hr). */}
      {endpoint.kind === 'hr' ? (
        <ScimTokenSection endpoint={endpoint} canManage={canManage} />
      ) : null}
    </div>
  );
}

/**
 * ScimTokenSection — issue + list the inbound SCIM bearer tokens that activate an
 * HR/SCIM connector (kind=hr). Issuing mints a raw bearer shown EXACTLY ONCE
 * (copy-once); the list shows only non-secret metadata. The backend routes are
 * nil-guarded, so a 404/read failure collapses to "unavailable" and the whole
 * surface hides itself rather than erroring.
 *
 * RBAC: issuing is a MANAGE action; the button is hidden/disabled for read-only
 * users (issue route gates lex:integration:manage).
 */
function ScimTokenSection({
  endpoint,
  canManage,
}: {
  endpoint: IntegrationEndpoint;
  canManage: boolean;
}) {
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();
  const ar = locale === 'ar';
  const L = {
    title: ar ? 'رموز SCIM الواردة' : 'Inbound SCIM tokens',
    subtitle: ar
      ? 'رمز حامل يُصادق خادم SCIM الوارد لهذا الموصّل. يظهر الرمز الخام مرة واحدة فقط.'
      : 'A bearer token that authenticates this connector’s inbound SCIM server. The raw token is shown once only.',
    issue: ar ? 'إصدار رمز SCIM' : 'Issue SCIM token',
    issuing: ar ? 'جارٍ الإصدار…' : 'Issuing…',
    dialogTitle: ar ? 'إصدار رمز SCIM' : 'Issue SCIM token',
    dialogBody: ar
      ? 'سيُعرض الرمز الخام مرة واحدة فقط بعد الإصدار. انسخه فورًا وخزّنه بأمان.'
      : 'The raw token is shown exactly once after issuing. Copy it now and store it securely.',
    label: ar ? 'التسمية' : 'Label',
    labelPlaceholder: ar ? 'مثال: خادم SCIM للموارد البشرية' : 'e.g. HR SCIM server',
    rotate: ar ? 'إبطال الرموز السابقة (تدوير)' : 'Revoke existing tokens (rotate)',
    confirm: ar ? 'إصدار' : 'Issue',
    cancel: ar ? 'إلغاء' : 'Cancel',
    close: ar ? 'إغلاق' : 'Close',
    copy: ar ? 'نسخ الرمز' : 'Copy token',
    copyOnceWarning: ar
      ? 'لن يُعرض هذا الرمز مرة أخرى. انسخه الآن.'
      : 'This token will not be shown again. Copy it now.',
    empty: ar ? 'لا توجد رموز SCIM مُصدَرة بعد.' : 'No SCIM tokens issued yet.',
    revoked: ar ? 'مُبطَل' : 'Revoked',
    expires: ar ? 'ينتهي' : 'Expires',
    lastUsed: ar ? 'آخر استخدام' : 'Last used',
    never: ar ? 'لم يُستخدم' : 'Never used',
    manageOnly: ar
      ? 'يتطلب إصدار الرموز صلاحية الإدارة.'
      : 'Issuing tokens requires manage permission.',
    toastIssued: ar ? 'تم إصدار رمز SCIM' : 'SCIM token issued',
    error: ar ? 'تعذّر إتمام العملية' : 'Operation failed',
  };

  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [rotate, setRotate] = useState(false);
  const [issued, setIssued] = useState<IssuedScimToken | null>(null);

  const listKey = ['lex-integration-scim-tokens', endpoint.id] as const;
  const tokensQuery = useQuery({
    queryKey: listKey,
    queryFn: () => listScimTokensResult(endpoint.id),
    staleTime: 30_000,
  });

  const issue = useMutation({
    mutationFn: () =>
      issueScimToken(endpoint.id, { label: label.trim() || 'SCIM', rotate }),
    onSuccess: async (res) => {
      setIssued(res);
      showSuccess(L.toastIssued);
      await qc.invalidateQueries({ queryKey: listKey });
    },
    onError: (e) => showBackendError(e, L.error),
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Clear the one-time token from memory when the dialog closes.
      setIssued(null);
      setLabel('');
      setRotate(false);
    }
  }

  // Feature-unavailable (404 / read failure / non-SCIM endpoint): hide the surface.
  if (tokensQuery.data?.unavailable) return null;

  const tokens = tokensQuery.data?.tokens ?? [];

  return (
    <section className="space-y-2 border-t pt-4" dir={direction} lang={locale}>
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        {L.title}
      </h3>
      <p className="text-caption text-muted-foreground">{L.subtitle}</p>

      {/* Existing tokens (non-secret metadata only). */}
      {tokensQuery.isLoading ? (
        <LoadingSkeleton variant="list-item" count={1} />
      ) : tokens.length === 0 ? (
        <p className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {L.empty}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tokens.map((tok) => (
            <li
              key={tok.id}
              className="flex items-center justify-between gap-2 rounded-lg border bg-card/60 px-2.5 py-2 text-xs"
            >
              <div className="min-w-0 space-y-0.5">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-caption" dir="ltr">
                    {tok.token_prefix}
                  </code>
                  {tok.label ? <span className="truncate text-foreground/80">{tok.label}</span> : null}
                </div>
                <div className="text-overline text-muted-foreground">
                  {tok.last_used_at
                    ? `${L.lastUsed}: ${formatRelative(tok.last_used_at, locale)}`
                    : L.never}
                  {tok.expires_at ? ` · ${L.expires}: ${formatRelative(tok.expires_at, locale)}` : ''}
                </div>
              </div>
              {tok.revoked_at ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-destructive/40 bg-destructive/5 px-2 py-0.5 text-overline font-medium text-destructive">
                  <ShieldAlert className="h-3 w-3" aria-hidden />
                  {L.revoked}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => setOpen(true)}
        >
          <KeyRound className="me-1.5 h-3.5 w-3.5" aria-hidden />
          {L.issue}
        </Button>
      ) : (
        <p className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {L.manageOnly}
        </p>
      )}

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent dir={direction} lang={locale}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" aria-hidden />
              {L.dialogTitle}
            </DialogTitle>
            <DialogDescription>{L.dialogBody}</DialogDescription>
          </DialogHeader>

          {issued ? (
            /* Copy-once reveal. */
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-lg border border-warning-300/60 bg-warning-50 px-3 py-2 text-xs text-warning-800 dark:bg-warning-800/15 dark:text-warning-200">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>{L.copyOnceWarning}</span>
              </div>
              <div className="flex items-center gap-2">
                <code
                  className="flex-1 truncate rounded bg-muted/40 px-2 py-1.5 font-mono text-caption text-foreground/90"
                  dir="ltr"
                  title={issued.token}
                >
                  {issued.token}
                </code>
                <CopyButton value={issued.token} label={L.copy} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="scim-label">{L.label}</Label>
                <Input
                  id="scim-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={L.labelPlaceholder}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
                <Label htmlFor="scim-rotate" className="flex items-center gap-1.5 text-sm">
                  <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {L.rotate}
                </Label>
                <Switch id="scim-rotate" checked={rotate} onCheckedChange={setRotate} />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            {issued ? (
              <Button type="button" onClick={() => onOpenChange(false)}>
                {L.close}
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  {L.cancel}
                </Button>
                <Button
                  type="button"
                  onClick={() => issue.mutate()}
                  disabled={issue.isPending}
                >
                  {issue.isPending ? (
                    <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <KeyRound className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  )}
                  {issue.isPending ? L.issuing : L.confirm}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
