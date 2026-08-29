'use client';

import { useState } from 'react';
import { CheckCircle2, FlaskConical, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAbacSimulate } from '@/hooks/use-platform';
import { useT } from '@/components/providers/locale-provider';
import { showApiError } from '@/lib/toast';
import type { AbacSimulateRequest, AbacSimulateResult } from '@/types/platform';
import { cn } from '@/lib/utils';

const SUBJECT_PLACEHOLDER = `{
  "role": "super_admin",
  "ip": "10.1.2.3"
}`;

const RESOURCE_PLACEHOLDER = `{
  "tenant_id": "aaaa-...",
  "owner": "u-1"
}`;

type JsonError = 'notObject' | 'invalid';

/** Parse a JSON textarea, returning [value, errorCode]. */
function parseJson(raw: string): [Record<string, unknown> | null, JsonError | null] {
  const trimmed = raw.trim();
  if (trimmed === '') return [{}, null];
  try {
    const v = JSON.parse(trimmed);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      return [null, 'notObject'];
    }
    return [v as Record<string, unknown>, null];
  } catch {
    return [null, 'invalid'];
  }
}

export function AbacSimulateForm() {
  const t = useT();
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [subjectRaw, setSubjectRaw] = useState(SUBJECT_PLACEHOLDER);
  const [resourceRaw, setResourceRaw] = useState(RESOURCE_PLACEHOLDER);
  const [result, setResult] = useState<AbacSimulateResult | null>(null);

  const simulate = useAbacSimulate();

  const [subject, subjectErr] = parseJson(subjectRaw);
  const [resource, resourceErr] = parseJson(resourceRaw);

  const jsonErrorText = (e: JsonError) =>
    e === 'notObject'
      ? t('platformConsole.identity.jsonNotObject')
      : t('platformConsole.identity.jsonInvalid');

  const canRun =
    action.trim() !== '' &&
    resourceType.trim() !== '' &&
    !subjectErr &&
    !resourceErr;

  const handleRun = async () => {
    if (!canRun || !subject || !resource) return;
    const req: AbacSimulateRequest = {
      action: action.trim(),
      resource_type: resourceType.trim(),
      subject,
      resource,
    };
    try {
      const res = await simulate.mutateAsync(req);
      setResult(res);
    } catch (err) {
      setResult(null);
      showApiError(err);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="space-y-4 p-5">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" aria-hidden />
          <h3 className="font-semibold text-foreground">
            {t('platformConsole.identity.simulateHeading')}
          </h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('platformConsole.identity.simulateHint')}
        </p>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sim-action">
              {t('platformConsole.identity.action')}
            </Label>
            <Input
              id="sim-action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="impersonate"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sim-resource-type">
              {t('platformConsole.identity.resourceType')}
            </Label>
            <Input
              id="sim-resource-type"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value)}
              placeholder="platform.tenant"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sim-subject">
            {t('platformConsole.identity.subjectAttributes')}
          </Label>
          <Textarea
            id="sim-subject"
            value={subjectRaw}
            onChange={(e) => setSubjectRaw(e.target.value)}
            rows={5}
            dir="ltr"
            className={cn('font-mono text-xs', subjectErr && 'border-destructive')}
          />
          {subjectErr && (
            <p className="text-xs text-destructive">{jsonErrorText(subjectErr)}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="sim-resource">
            {t('platformConsole.identity.resourceAttributes')}
          </Label>
          <Textarea
            id="sim-resource"
            value={resourceRaw}
            onChange={(e) => setResourceRaw(e.target.value)}
            rows={5}
            dir="ltr"
            className={cn('font-mono text-xs', resourceErr && 'border-destructive')}
          />
          {resourceErr && (
            <p className="text-xs text-destructive">{jsonErrorText(resourceErr)}</p>
          )}
        </div>

        <Button onClick={handleRun} disabled={!canRun || simulate.isPending}>
          {simulate.isPending
            ? t('platformConsole.identity.evaluating')
            : t('platformConsole.identity.runSimulation')}
        </Button>
      </Card>

      <Card className="space-y-4 p-5" aria-live="polite">
        <h3 className="font-semibold text-foreground">
          {t('platformConsole.identity.result')}
        </h3>
        {!result ? (
          <p className="text-sm text-muted-foreground">
            {t('platformConsole.identity.resultPlaceholder')}
          </p>
        ) : (
          <div className="space-y-4">
            <div
              className={cn(
                'flex items-center gap-3 rounded-xl border p-4',
                result.decision === 'allow'
                  ? 'border-primary/30 bg-primary/10'
                  : 'border-error-300/50 bg-error-50 dark:border-error-700/40 dark:bg-error-700/15',
              )}
            >
              {result.decision === 'allow' ? (
                <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden />
              ) : (
                <XCircle className="h-6 w-6 text-destructive" aria-hidden />
              )}
              <div>
                <p className="text-lg font-semibold uppercase tracking-wide">
                  {result.decision === 'allow'
                    ? t('platformConsole.identity.effectAllow')
                    : t('platformConsole.identity.effectDeny')}
                </p>
                {result.matched_policy_name && (
                  <p className="text-xs text-muted-foreground">
                    {t('platformConsole.identity.matchedLabel')}{' '}
                    {result.matched_policy_name}
                  </p>
                )}
              </div>
            </div>

            {result.evaluated && result.evaluated.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('platformConsole.identity.evaluationTrace')}
                </p>
                <ul className="space-y-1.5">
                  {result.evaluated.map((step) => (
                    <li
                      key={step.policy_id}
                      className={cn(
                        'flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2 text-sm',
                        step.matched && 'bg-secondary/50',
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {step.policy_name}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge
                          variant={
                            step.effect === 'allow' ? 'success' : 'destructive'
                          }
                        >
                          {step.effect === 'allow'
                            ? t('platformConsole.identity.effectAllow')
                            : t('platformConsole.identity.effectDeny')}
                        </Badge>
                        {step.matched ? (
                          <Badge variant="default">
                            {t('platformConsole.identity.matched')}
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            {t('platformConsole.identity.skipped')}
                          </Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
