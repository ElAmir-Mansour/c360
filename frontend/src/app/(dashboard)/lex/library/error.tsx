'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/common/error-state';

/**
 * Route-level error boundary for the reference library. App Router mounts this
 * whenever the list page (or a shared child) throws during render, isolating the
 * failure to the library surface instead of blanking the dashboard shell.
 */
export default function LibraryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('lex reference-library error boundary', error);
  }, [error]);

  return (
    <div className="p-6">
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
