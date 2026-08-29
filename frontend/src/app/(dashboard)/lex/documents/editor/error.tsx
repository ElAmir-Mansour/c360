'use client';

import { ErrorState } from '@/components/common/error-state';
import { useEditorLabels } from '../_components/lex-editor-i18n';

export default function LexDocumentEditorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const labels = useEditorLabels();
  return (
    <ErrorState
      error={error}
      message={labels.routeError}
      onRetry={reset}
    />
  );
}
