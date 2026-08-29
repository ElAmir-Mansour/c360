'use client';

/**
 * #6 Linked-subject card — when a request has spawned a downstream matter
 * (`subject_type` + `subject_id` populated), this card surfaces a deep link to
 * it. The subject can be a case/litigation, a contract, an investigation, or a
 * consultation/legal-opinion — each has its OWN detail page, so the link keys
 * off `subject_type` via {@link matterTarget}. Renders nothing when no subject
 * is linked.
 */

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import type { LegalRequest } from '@/lib/lex/requests';
import { useDetailExtraLabels } from './detail-extra-labels';
import { useSubjectTypeLabel } from './lex-enums-i18n';
import { matterTarget, type MatterKind } from './matter-target';

interface Props {
  request: LegalRequest;
}

/** Map the shared matter kind to this card's link-label key. */
const LINK_KEY_BY_KIND: Record<
  MatterKind,
  'caseLink' | 'contractLink' | 'investigationLink' | 'consultationLink'
> = {
  case: 'caseLink',
  contract: 'contractLink',
  investigation: 'investigationLink',
  consultation: 'consultationLink',
};

export function LinkedSubjectCard({ request }: Props) {
  const labels = useDetailExtraLabels();
  const t = labels.linkedSubject;
  const subjectTypeLabel = useSubjectTypeLabel();

  const subjectType = request.subject_type ?? '';
  const subjectId = request.subject_id ?? '';
  if (!subjectType || !subjectId) {
    return null;
  }

  const target = matterTarget(subjectType);
  const href = `${target.base}/${subjectId}`;
  const Icon = target.icon;
  const linkLabel = t[LINK_KEY_BY_KIND[target.kind]];

  return (
    <SectionCard title={t.title} description={t.description}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium capitalize">{subjectTypeLabel(subjectType)}</p>
            <p className="truncate font-mono text-xs text-muted-foreground" title={subjectId}>
              {t.subjectId}: {subjectId.slice(0, 12)}
            </p>
          </div>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            {linkLabel}
            <ArrowRight className="ms-1.5 h-3.5 w-3.5 rtl:rotate-180" aria-hidden />
          </Link>
        </Button>
      </div>
    </SectionCard>
  );
}
