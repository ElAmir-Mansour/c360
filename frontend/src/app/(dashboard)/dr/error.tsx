'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDRErrorBoundaryLabels } from './_components/console/dr-error-boundary-labels';

/**
 * Route-segment error boundary for the whole ClarioDR (Recovery Operations)
 * console (Next.js App Router `error.tsx` contract). It catches render errors
 * thrown by any `/dr/*` page and presents a bilingual, token-driven recovery UI:
 * a `reset()` retry (re-mounts the failed segment) and a link back to the console
 * overview.
 *
 * Copy is resolved via {@link useDRErrorBoundaryLabels}, which reads the active
 * locale from the dashboard's mounted `LocaleProvider` (this boundary renders
 * inside the dashboard layout, so the provider is an ancestor) and falls back to
 * English otherwise. Layout uses logical properties (`text-center`, `ms-2`) so it
 * mirrors correctly under RTL. The container is a single `role="alert"` region so
 * assistive tech announces the failure on mount.
 */
export default function DRConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const labels = useDRErrorBoundaryLabels();

  useEffect(() => {
    // Surface to the console / any wired error reporter for diagnosis.
    console.error('[dr-console-error]', error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center"
    >
      <div className="mb-5 rounded-full bg-destructive/10 p-4">
        <AlertTriangle className="h-9 w-9 text-destructive" aria-hidden />
      </div>
      <h2 className="text-h4 font-semibold text-foreground">{labels.title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        {labels.description}
      </p>
      {error.digest ? (
        <p className="mt-2 font-mono text-xs text-muted-foreground/70">
          {labels.referenceLabel(error.digest)}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button onClick={reset}>
          <RefreshCw className="me-2 h-4 w-4" aria-hidden />
          {labels.retryAction}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dr">
            <ArrowLeft className="me-2 h-4 w-4" aria-hidden />
            {labels.backAction}
          </Link>
        </Button>
      </div>
    </div>
  );
}
