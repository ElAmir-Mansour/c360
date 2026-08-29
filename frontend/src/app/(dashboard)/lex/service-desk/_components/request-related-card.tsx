'use client';

/**
 * #8 Request-related rail card — the right-rail "Documents & links" surface for a
 * Legal Service Desk request detail page. It gathers, in one cohesive
 * ~360px-wide card, everything a request *connects to*:
 *
 *   1. ATTACHMENTS — the execution requirements of `kind === 'attachment'`, with
 *      a satisfied/missing status per item and a header counter. There is NO
 *      dedicated attachments endpoint: attachments are modelled as execution
 *      requirements, so this reuses the parent's execution query
 *      (`['lex-request-execution', request.id]`, shared cache — no double fetch).
 *      Files are not downloadable via any known URL, so we surface STATUS only.
 *   2. RELATED MATTER — a compact deep link to the case / consultation spawned
 *      from this request (mirrors the routing in `linked-subject-card.tsx`).
 *   3. CLONE LINEAGE — compact deep links to the origin / continuation request
 *      when the execution state carries clone lineage.
 *
 * Degrades gracefully: while the checklist loads it skeletons the attachments
 * subsection (related matter still renders from `request`); if the execution
 * query errors it hides attachments + lineage quietly and keeps related matter.
 * Bilingual (English + MSA) and RTL-correct via logical utilities.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  GitBranch,
  Link2,
  Paperclip,
  type LucideIcon,
} from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { cn } from '@/lib/utils';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  lexRequestsApi,
  requestCanHaveExecutionState,
  type LegalRequest,
  type RequirementItem,
} from '@/lib/lex/requests';
import { humanizeLexToken } from '../../_lib/humanize-lex-token';
import { useRequestRelatedLabels } from './request-related-card-labels';
import { useSubjectTypeLabel } from './lex-enums-i18n';
import { matterTarget, type MatterKind } from './matter-target';

export interface RequestRelatedCardProps {
  request: LegalRequest;
  className?: string;
}

/** Map the shared matter kind to this card's link-label key. */
const RELATED_LINK_KEY_BY_KIND: Record<
  MatterKind,
  'caseLink' | 'contractLink' | 'investigationLink' | 'consultationLink'
> = {
  case: 'caseLink',
  contract: 'contractLink',
  investigation: 'investigationLink',
  consultation: 'consultationLink',
};

/* ------------------------------------------------------------------------- *
 * Small building blocks.
 * ------------------------------------------------------------------------- */

function RailSubheading({
  icon: Icon,
  children,
  trailing,
}: {
  icon: typeof Paperclip;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
      {trailing ? <span className="ms-auto">{trailing}</span> : null}
    </div>
  );
}

/** A compact link row — icon disc, title + optional sub-line, trailing open glyph. */
function RailLinkRow({
  href,
  icon: Icon,
  title,
  subtitle,
  ariaLabel,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  ariaLabel: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground" dir="auto">
          {title}
        </span>
        {subtitle ? (
          <span
            className="block truncate font-mono text-xs text-muted-foreground"
            title={subtitle}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
      <ExternalLink
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
        aria-hidden
      />
    </Link>
  );
}

function AttachmentRow({
  item,
  locale,
  labels,
}: {
  item: RequirementItem;
  locale: AppLocale;
  labels: ReturnType<typeof useRequestRelatedLabels>;
}) {
  const name = resolveLocalized(item.label, locale) || humanizeLexToken(item.code, locale);
  return (
    <li className="flex items-start gap-2.5">
      {item.satisfied ? (
        <CheckCircle2
          className="mt-0.5 h-4 w-4 shrink-0 text-success-600 dark:text-success-300"
          aria-hidden
        />
      ) : (
        <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" aria-hidden />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium leading-snug text-foreground" dir="auto">
            {name}
          </span>
          {item.required ? (
            <Badge variant="outline" size="sm">
              {labels.attachments.required}
            </Badge>
          ) : null}
        </div>
        <span
          className={cn(
            'text-xs',
            item.satisfied
              ? 'text-success-600 dark:text-success-300'
              : 'text-muted-foreground',
          )}
        >
          {item.satisfied ? labels.attachments.attached : labels.attachments.missing}
        </span>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------------- *
 * Card.
 * ------------------------------------------------------------------------- */

export function RequestRelatedCard({ request, className }: RequestRelatedCardProps) {
  const { locale } = useLocaleOrDefault();
  const labels = useRequestRelatedLabels();
  const subjectTypeLabel = useSubjectTypeLabel();
  const executionExpected = requestCanHaveExecutionState(request.status);

  // Reuse the parent's exact execution query key so the cache is shared (no
  // duplicate network round-trip); `retry: false` matches the parent + banner.
  const executionQuery = useQuery({
    queryKey: ['lex-request-execution', request.id],
    queryFn: () => lexRequestsApi.getExecution(request.id),
    enabled: Boolean(request.id) && executionExpected,
    retry: false,
  });

  const executionLoading = executionExpected && executionQuery.isLoading;
  const executionErrored = executionExpected && executionQuery.isError;

  const attachments = (executionQuery.data?.requirements ?? []).filter(
    (r) => r.kind === 'attachment',
  );
  const attachedCount = attachments.filter((r) => r.satisfied).length;

  const state = executionQuery.data?.state ?? null;
  const clonedFrom = state?.cloned_from_request_id ?? null;
  const continuedAs = state?.clone_request_id ?? null;

  // --- Related matter (from `request`, always available) ---
  const subjectType = request.subject_type ?? '';
  const subjectId = request.subject_id ?? '';
  const hasRelated = Boolean(subjectType && subjectId);

  const blocks: ReactNode[] = [];

  // 1) ATTACHMENTS — skeleton while loading, hidden on error, else list/empty.
  if (executionLoading) {
    blocks.push(
      <section key="attachments" aria-busy>
        <RailSubheading icon={Paperclip}>{labels.attachments.heading}</RailSubheading>
        <LoadingSkeleton variant="list" count={3} label={labels.attachments.loading} />
      </section>,
    );
  } else if (executionExpected && !executionErrored) {
    blocks.push(
      <section key="attachments">
        <RailSubheading
          icon={Paperclip}
          trailing={
            attachments.length > 0 ? (
              <Badge variant="neutral" size="sm" className="tabular-nums">
                {labels.attachments.counter(attachedCount, attachments.length)}
              </Badge>
            ) : null
          }
        >
          {labels.attachments.heading}
        </RailSubheading>
        {attachments.length > 0 ? (
          <ul className="space-y-2.5">
            {attachments.map((item) => (
              <AttachmentRow key={item.id} item={item} locale={locale} labels={labels} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{labels.attachments.empty}</p>
        )}
      </section>,
    );
  }

  // 2) RELATED MATTER — compact deep link mirroring linked-subject-card routing.
  if (hasRelated) {
    const target = matterTarget(subjectType);
    const href = `${target.base}/${subjectId}`;
    blocks.push(
      <section key="related">
        <RailSubheading icon={Link2}>{labels.related.heading}</RailSubheading>
        <RailLinkRow
          href={href}
          icon={target.icon}
          title={subjectTypeLabel(subjectType)}
          subtitle={subjectId.slice(0, 12)}
          ariaLabel={labels.related[RELATED_LINK_KEY_BY_KIND[target.kind]]}
        />
      </section>,
    );
  }

  // 3) CLONE LINEAGE — only when the execution state carries lineage.
  if (!executionErrored && (clonedFrom || continuedAs)) {
    blocks.push(
      <section key="lineage">
        <RailSubheading icon={GitBranch}>{labels.clone.heading}</RailSubheading>
        <div className="space-y-2">
          {clonedFrom ? (
            <RailLinkRow
              href={`/lex/service-desk/${clonedFrom}`}
              icon={GitBranch}
              title={labels.clone.clonedFrom(labels.clone.refFallback(clonedFrom))}
              ariaLabel={labels.clone.viewOrigin}
            />
          ) : null}
          {continuedAs ? (
            <RailLinkRow
              href={`/lex/service-desk/${continuedAs}`}
              icon={GitBranch}
              title={labels.clone.continuedAs(labels.clone.refFallback(continuedAs))}
              ariaLabel={labels.clone.viewContinuation}
            />
          ) : null}
        </div>
      </section>,
    );
  }

  return (
    <SectionCard title={labels.cardTitle} description={labels.cardDescription} className={className}>
      {blocks.length > 0 ? (
        <div className="divide-y divide-border/60">
          {blocks.map((block, i) => (
            <div key={i} className="py-4 first:pt-0 last:pb-0">
              {block}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Paperclip} title={labels.emptyAll} size="compact" />
      )}
    </SectionCard>
  );
}
