'use client';

import { useMemo, useState } from 'react';
import { formatISO, subDays } from 'date-fns';
import { FlaskConical } from 'lucide-react';

import { apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { DetectionRule, DetectionRuleTestResult } from '@/types/cyber';
import { parseApiError } from '@/lib/format';

import { useRulesLabels } from '../_lib/rules-i18n';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';

interface RuleTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rule: DetectionRule | null;
}

export function RuleTestDialog({ open, onOpenChange, rule }: RuleTestDialogProps) {
  const t = useRulesLabels();
  const [limit, setLimit] = useState(1000);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DetectionRuleTestResult | null>(null);

  const requestBody = useMemo(
    () => ({
      date_from: formatISO(subDays(new Date(), 14)),
      limit,
    }),
    [limit],
  );

  async function handleRun() {
    if (!rule) {
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiPost<{ data: DetectionRuleTestResult }>(API_ENDPOINTS.CYBER_RULE_TEST(rule.id), requestBody);
      setResult(response.data);
    } catch (caughtError) {
      setError(parseApiError(caughtError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" />
            {t.testDialog.title}
          </DialogTitle>
          <DialogDescription>
            {t.testDialog.description(rule?.name ?? t.testDialog.fallbackRuleName)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[220px_1fr]">
          <div className="space-y-4 rounded-soft border p-4">
            <div className="space-y-2">
              <Label htmlFor="rule-test-limit">{t.testDialog.eventLimit}</Label>
              <Input
                id="rule-test-limit"
                type="number"
                min={100}
                max={5000}
                step={100}
                value={limit}
                onChange={(event) => setLimit(Number(event.target.value) || 1000)}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {t.testDialog.backendHint(requestBody.date_from)}
            </p>
            <Button className="w-full" onClick={() => void handleRun()} disabled={running || !rule}>
              {running ? t.testDialog.running : t.testDialog.runTest}
            </Button>
            {error ? (
              <div className="rounded-2xl border border-error-100 bg-error-50 dark:border-error-700 dark:bg-error-700/30 px-3 py-2 text-sm text-error-600 dark:text-error-300">
                {error}
              </div>
            ) : null}
          </div>

          <div className="rounded-soft border p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{t.testDialog.results}</p>
                <p className="text-sm text-muted-foreground">
                  {result ? t.testDialog.matchesFound(result.count) : t.testDialog.runToPreview}
                </p>
              </div>
              {result ? <Badge variant="outline">{t.testDialog.matchesBadge(result.count)}</Badge> : null}
            </div>

            <ScrollArea className="h-[420px] pe-3">
              <div className="space-y-3">
                {result?.matches?.length ? (
                  result.matches.map((match, index) => (
                    <div key={`${match.timestamp}-${index}`} className="rounded-2xl border bg-auth-dark/95 p-4 text-emerald-100">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{t.testDialog.match(index + 1)}</span>
                        <span className="font-mono text-xs text-emerald-100/60">{new Date(match.timestamp).toLocaleString()}</span>
                      </div>
                      <pre className="mt-3 overflow-x-auto text-xs">
                        {JSON.stringify(match.match_details, null, 2)}
                      </pre>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                    {t.testDialog.noMatches}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.testDialog.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
