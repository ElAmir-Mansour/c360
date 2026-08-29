'use client';

import { RouteError } from '@/components/common/route-error';

/**
 * Route-level error boundary for the Portfolio Risk & Value dashboard. Uses the
 * shared `RouteError` surface (retry + report) so failures degrade gracefully
 * without taking down the surrounding lex shell.
 */
export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} segment="Portfolio Risk & Value" />;
}
