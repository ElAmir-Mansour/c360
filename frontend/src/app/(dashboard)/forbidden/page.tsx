'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ForbiddenState } from '@/components/common/forbidden-state';

/**
 * Designed 403 route. Guards and API-failure paths can send users here with
 * optional context: `/forbidden?permission=lex:contract:approve`.
 */
function ForbiddenContent() {
  const searchParams = useSearchParams();
  const permission = searchParams.get('permission') ?? undefined;

  return <ForbiddenState permission={permission} size="page" />;
}

export default function ForbiddenPage() {
  return (
    // useSearchParams requires a Suspense boundary during prerendering.
    <Suspense fallback={null}>
      <ForbiddenContent />
    </Suspense>
  );
}
