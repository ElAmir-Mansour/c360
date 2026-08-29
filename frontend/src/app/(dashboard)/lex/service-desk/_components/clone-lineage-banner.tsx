'use client';

/**
 * #12 Clone-lineage banner — surfaces the execution-state clone lineage. If this
 * request was cloned from another (`cloned_from_request_id`) and/or was
 * continued as another (`clone_request_id`), it renders a banner with deep links
 * to those requests. Renders nothing when no lineage exists or while loading.
 */

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, GitBranch } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  lexRequestsApi,
  requestCanHaveExecutionState,
  type RequestStatus,
} from '@/lib/lex/requests';
import { useDetailExtraLabels } from './detail-extra-labels';

interface Props {
  requestId: string;
  status: RequestStatus;
}

export function CloneLineageBanner({ requestId, status }: Props) {
  const labels = useDetailExtraLabels();
  const t = labels.clone;
  const executionExpected = requestCanHaveExecutionState(status);

  const executionQuery = useQuery({
    queryKey: ['lex-request-execution', requestId],
    queryFn: () => lexRequestsApi.getExecution(requestId),
    enabled: Boolean(requestId) && executionExpected,
    retry: false,
  });

  const state = executionQuery.data?.state ?? null;
  const clonedFrom = state?.cloned_from_request_id ?? null;
  const continuedAs = state?.clone_request_id ?? null;

  if (!clonedFrom && !continuedAs) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-primary/20 bg-primary/[0.06] px-4 py-3">
      <div className="flex items-center gap-2 text-sm">
        <GitBranch className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <span className="font-medium text-foreground">
          {clonedFrom ? t.clonedFrom(t.refFallback(clonedFrom)) : t.bothPrefix}
          {clonedFrom && continuedAs ? ' · ' : ''}
          {continuedAs ? t.continuedAs(t.refFallback(continuedAs)) : ''}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {clonedFrom ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/lex/service-desk/${clonedFrom}`}>
              {t.viewOrigin}
              <ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        ) : null}
        {continuedAs ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/lex/service-desk/${continuedAs}`}>
              {t.viewContinuation}
              <ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
