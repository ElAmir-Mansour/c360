'use client';

import { PlugZap } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { IntegrationHealthCopy } from './integration-health';

/**
 * Informational notice shown when the backend external-integrations API is
 * ABSENT because `DR_INTEGRATIONS_ENC_KEY` is unset (the catalog router is not
 * mounted, so the list request 404s — see `isIntegrationsFeatureDisabled`).
 *
 * This is deliberately NOT an error surface: the platform is healthy, the
 * capability is simply not enabled. It uses the neutral/primary tone (not the
 * destructive tone of `ErrorState`), explains the operator-facing remediation,
 * and surfaces the exact environment variable to set.
 *
 * Copy is fully bilingual via the resolved {@link IntegrationHealthCopy}; the
 * env-var name is a literal identifier (kept verbatim across locales). Layout
 * uses logical properties (`text-start`, `ms-*`) so it mirrors correctly in RTL.
 */
export function IntegrationsDisabledNotice({
  copy,
}: {
  copy: IntegrationHealthCopy;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div
          role="status"
          className="flex flex-col items-center gap-4 px-6 py-12 text-center"
        >
          <div className="rounded-full bg-primary/10 p-4">
            <PlugZap className="h-8 w-8 text-primary" aria-hidden />
          </div>
          <div className="max-w-xl space-y-2">
            <h3 className="text-base font-medium text-foreground">
              {copy.featureDisabledTitle}
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {copy.featureDisabledDescription}
            </p>
          </div>
          <p className="max-w-xl rounded-lg border bg-muted/40 px-4 py-3 text-start text-xs leading-5 text-muted-foreground">
            {copy.featureDisabledEnvHint}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
