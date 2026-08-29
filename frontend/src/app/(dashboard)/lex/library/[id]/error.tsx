'use client';

import { useEffect } from 'react';
import { ErrorState } from '@/components/common/error-state';

/** Route-level error boundary for a single reference-library document detail. */
export default function LibraryDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('lex reference-library detail error boundary', error);
  }, [error]);

  return (
    <div className="p-6">
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
