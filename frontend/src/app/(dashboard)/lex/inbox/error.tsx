'use client';

import { RouteError } from '@/components/common/route-error';

/**
 * Route-level error boundary for the Approvals Inbox. Renders the shared
 * <RouteError> (retry + digest) scoped to the Inbox segment. Individual decision
 * sources fail soft inside the page itself; this boundary only catches a render
 * crash of the segment.
 */
export default function Error(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError {...props} segment="Inbox" />;
}
