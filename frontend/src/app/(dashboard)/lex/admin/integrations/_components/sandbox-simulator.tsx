'use client';

/**
 * SandboxSimulator (Feature 9).
 *
 * A clearly-labelled SANDBOX panel that runs mock connector operations via
 * sandboxInvoke — side-effect-free exploration for gov-gated kinds only
 * (najiz, nafath_verify). Each kind exposes a small op menu:
 *   - nafath_verify: `request` → {transId, random} (number-match), `status`
 *   - najiz:         `pull_hearings` → mock hearings list
 *
 * The result payload is connector-defined, so it is rendered as pretty JSON with
 * a couple of highlighted well-known fields (transId / number-match) for Nafath.
 *
 * RBAC: running a sandbox op is a MANAGE action; the Run button is disabled for
 * read-only users and a note is shown.
 */
import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  CheckCircle2,
  FlaskConical,
  Loader2,
  Play,
  XCircle,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showSuccess, showBackendError } from '@/lib/toast';
import { cn } from '@/lib/utils';
import {
  sandboxInvoke,
  type IntegrationEndpoint,
  type IntegrationKind,
  type InvokeResult,
} from '@/lib/lex/integrations';
import { useDetailOpsLabels, type DetailOpsLabels } from '../_lib/detail-ops-labels';
import { prettyJson, readMetaString } from '../_lib/detail-ops-format';

interface SandboxSimulatorProps {
  endpoint: IntegrationEndpoint;
  canManage: boolean;
}

/** Kinds that expose a sandbox simulator. */
const SANDBOX_KINDS: ReadonlySet<IntegrationKind> = new Set<IntegrationKind>([
  'najiz',
  'nafath_verify',
]);

export function isSandboxKind(kind: string): boolean {
  return SANDBOX_KINDS.has(kind as IntegrationKind);
}

interface OpOption {
  op: string;
  label: (t: DetailOpsLabels) => string;
  hint: (t: DetailOpsLabels) => string;
  payload?: Record<string, unknown>;
}

const OPS: Partial<Record<IntegrationKind, OpOption[]>> = {
  nafath_verify: [
    {
      op: 'request',
      label: (t) => t.sandboxNafathRequest,
      hint: (t) => t.sandboxNafathHint,
      payload: { national_id: '1000000000' },
    },
    {
      op: 'status',
      label: (t) => t.sandboxNafathStatus,
      hint: (t) => t.sandboxNafathHint,
    },
  ],
  najiz: [
    {
      op: 'pull_hearings',
      label: (t) => t.sandboxNajizHearings,
      hint: (t) => t.sandboxNajizHint,
    },
  ],
};

export function SandboxSimulator({ endpoint, canManage }: SandboxSimulatorProps) {
  const t = useDetailOpsLabels();
  const { locale, direction } = useLocaleOrDefault();

  const ops = useMemo(() => OPS[endpoint.kind] ?? [], [endpoint.kind]);
  const [op, setOp] = useState<string>(ops[0]?.op ?? '');
  const [result, setResult] = useState<InvokeResult | null>(null);

  const selectedOp = ops.find((o) => o.op === op) ?? ops[0];

  const invoke = useMutation({
    mutationFn: () => sandboxInvoke(endpoint.id, op, selectedOp?.payload ?? {}),
    onSuccess: (res) => {
      setResult(res);
      showSuccess(t.toastSandboxDone);
    },
    onError: (e) => showBackendError(e, t.opsError),
  });

  // Pull a couple of highlighted Nafath fields out of an opaque output bag.
  const transId =
    endpoint.kind === 'nafath_verify' ? readMetaString(result?.output, 'transId') : undefined;
  const random =
    endpoint.kind === 'nafath_verify'
      ? readMetaString(result?.output, 'random') ?? readMetaString(result?.output, 'randomNumber')
      : undefined;

  if (ops.length === 0) return null;

  return (
    <section
      className="space-y-3 rounded-xl border-2 border-dashed border-warning-300/80 bg-warning-50/40 p-4 dark:border-warning-700/60 dark:bg-warning-700/10"
      dir={direction}
      lang={locale}
      aria-label={t.sandboxTitle}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FlaskConical className="h-4 w-4 text-warning-600" aria-hidden />
          {t.sandboxTitle}
        </h3>
        <span className="inline-flex items-center gap-1 rounded-full border border-warning-300 bg-warning-100 px-2 py-0.5 text-overline font-bold uppercase text-warning-700 dark:bg-warning-700/20 dark:text-warning-300">
          {t.sandboxBadge}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t.sandboxSubtitle}</p>
      <p className="rounded-lg bg-warning-100/60 px-3 py-2 text-caption text-warning-700 dark:bg-warning-700/15 dark:text-warning-300">
        {t.sandboxBadgeNote}
      </p>

      {/* Op picker + run. */}
      <div className="space-y-1.5">
        <Label htmlFor="sandbox-op">{t.sandboxOpLabel}</Label>
        <div className="flex items-center gap-2">
          <Select value={op} onValueChange={(v) => { setOp(v); setResult(null); }}>
            <SelectTrigger id="sandbox-op" className="flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ops.map((o) => (
                <SelectItem key={o.op} value={o.op}>
                  {o.label(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="secondary"
            onClick={() => invoke.mutate()}
            disabled={!canManage || invoke.isPending || !op}
          >
            {invoke.isPending ? (
              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="me-1.5 h-3.5 w-3.5" aria-hidden />
            )}
            {invoke.isPending ? t.sandboxRunning : t.sandboxRun}
          </Button>
        </div>
        {selectedOp ? (
          <p className="text-caption text-muted-foreground">{selectedOp.hint(t)}</p>
        ) : null}
      </div>

      {!canManage ? (
        <p className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {t.manageOnlyNote}
        </p>
      ) : null}

      {/* Result. */}
      {result ? (
        <div className="space-y-2">
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium',
              result.success
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-destructive/40 bg-destructive/5 text-destructive',
            )}
          >
            {result.success ? (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <XCircle className="h-3.5 w-3.5" aria-hidden />
            )}
            {result.success ? t.sandboxOk : t.sandboxFailed}
          </div>

          {/* Highlighted Nafath fields. */}
          {(transId || random) ? (
            <div className="grid grid-cols-2 gap-2">
              {transId ? (
                <div className="rounded-lg border bg-card/60 px-3 py-2">
                  <div className="text-overline uppercase text-muted-foreground">
                    {t.sandboxNafathTransId}
                  </div>
                  <div className="font-mono text-sm" dir="ltr">{transId}</div>
                </div>
              ) : null}
              {random ? (
                <div className="rounded-lg border bg-card/60 px-3 py-2">
                  <div className="text-overline uppercase text-muted-foreground">
                    {t.sandboxNafathRandom}
                  </div>
                  <div className="font-mono text-lg font-bold text-primary" dir="ltr">{random}</div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div>
            <div className="mb-1 text-caption font-medium text-muted-foreground">
              {t.sandboxResultTitle}
            </div>
            <pre
              className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-caption leading-relaxed"
              dir="ltr"
            >
              {prettyJson(result.output)}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
