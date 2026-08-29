'use client';

/**
 * Related card — right-rail SectionCard gathering everything a Legal
 * *Investigation* connects to, in one ~360px surface:
 *
 *   1. LINKED CASE — a compact deep link to the case the investigation is
 *      anchored to (mirrors the hero + command-header case routing), or a muted
 *      "not linked" line.
 *   2. RECORDS — in-page jump rows for Parties / Statements / Evidence, each
 *      with a live count, that smooth-scroll to their editable section in the
 *      main column (the page owns the scroll via `onJump`).
 *   3. GOVERNANCE REFERENCES — copyable workflow-instance and reminder-
 *      obligation ids, plus an AI-drafted flag, shown only when present.
 *
 * Fully prop-driven from the already-loaded `investigation` — no network calls.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Bot,
  ChevronRight,
  ExternalLink,
  Files,
  Gavel,
  GitBranch,
  BellRing,
  MessageSquare,
  Users,
} from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import type { Investigation } from '@/lib/lex/investigations';
import { useInvestigationRelatedCardLabels } from './investigation-related-card-labels';
import { CopyIdButton } from './rail-bits';

/** Anchor ids of the editable sections in the main column (set on the page). */
export type InvestigationSectionAnchor =
  | 'investigation-parties'
  | 'investigation-statements'
  | 'investigation-evidence';

export interface InvestigationRelatedCardProps {
  investigation: Investigation;
  onJump: (anchor: InvestigationSectionAnchor) => void;
  className?: string;
}

function RailSubheading({ icon: Icon, children }: { icon: typeof Files; children: ReactNode }) {
  return (
    <div className="mb-2.5 flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="text-overline font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

/** In-page jump row — icon disc, label, live count, trailing chevron. */
function JumpRow({
  icon: Icon,
  label,
  count,
  ariaLabel,
  onClick,
}: {
  icon: typeof Users;
  label: string;
  count: number;
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="group flex w-full items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 text-start shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      <Badge variant="neutral" size="sm" className="tabular-nums">
        {count}
      </Badge>
      <ChevronRight
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:rotate-180"
        aria-hidden
      />
    </button>
  );
}

/** A copyable governance id row. */
function GovernanceIdRow({
  icon: Icon,
  label,
  value,
  copyId,
  copied,
}: {
  icon: typeof GitBranch;
  label: string;
  value: string;
  copyId: string;
  copied: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-2.5 py-2">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="truncate font-mono text-xs text-foreground" dir="ltr" title={value}>
          {value}
        </p>
      </div>
      <CopyIdButton value={value} label={copyId} doneLabel={copied} />
    </div>
  );
}

export function InvestigationRelatedCard({
  investigation,
  onJump,
  className,
}: InvestigationRelatedCardProps) {
  const labels = useInvestigationRelatedCardLabels();

  const partyCount = investigation.parties?.length ?? 0;
  const statementCount = investigation.statements?.length ?? 0;
  const evidenceCount = investigation.evidence?.length ?? 0;
  const caseId = investigation.case_id?.trim();
  const workflowId = investigation.workflow_instance_id?.trim();
  const reminderId = investigation.reminder_obligation_id?.trim();
  const hasGovernance = Boolean(workflowId || reminderId || investigation.ai_drafted);

  return (
    <SectionCard
      title={labels.cardTitle}
      description={labels.cardDescription}
      className={className}
    >
      <div className="divide-y divide-border/60">
        {/* 1. Linked case */}
        <section className="py-4 first:pt-0">
          <RailSubheading icon={Gavel}>{labels.linkedMatter}</RailSubheading>
          {caseId ? (
            <Link
              href={`/lex/cases/${caseId}`}
              aria-label={labels.openCase}
              className="group flex items-center gap-2.5 rounded-lg border border-border/60 bg-card/50 px-2.5 py-2 shadow-elevation-1 transition-colors duration-fast ease-standard hover:border-primary/30 hover:bg-primary/5"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Gavel className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {labels.openCase}
                </span>
                <span
                  className="block truncate font-mono text-xs text-muted-foreground"
                  dir="ltr"
                  title={caseId}
                >
                  {caseId}
                </span>
              </span>
              <ExternalLink
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                aria-hidden
              />
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">{labels.noCase}</p>
          )}
        </section>

        {/* 2. Records — in-page jumps with live counts */}
        <section className="py-4">
          <RailSubheading icon={Files}>{labels.records}</RailSubheading>
          <div className="space-y-2">
            <JumpRow
              icon={Users}
              label={labels.parties}
              count={partyCount}
              ariaLabel={labels.jumpAria(labels.parties)}
              onClick={() => onJump('investigation-parties')}
            />
            <JumpRow
              icon={MessageSquare}
              label={labels.statements}
              count={statementCount}
              ariaLabel={labels.jumpAria(labels.statements)}
              onClick={() => onJump('investigation-statements')}
            />
            <JumpRow
              icon={Files}
              label={labels.evidence}
              count={evidenceCount}
              ariaLabel={labels.jumpAria(labels.evidence)}
              onClick={() => onJump('investigation-evidence')}
            />
          </div>
        </section>

        {/* 3. Governance references */}
        {hasGovernance ? (
          <section className="py-4 last:pb-0">
            <RailSubheading icon={GitBranch}>{labels.governance}</RailSubheading>
            <div className="space-y-2">
              {workflowId ? (
                <GovernanceIdRow
                  icon={GitBranch}
                  label={labels.workflowInstance}
                  value={workflowId}
                  copyId={labels.copyId}
                  copied={labels.copied}
                />
              ) : null}
              {reminderId ? (
                <GovernanceIdRow
                  icon={BellRing}
                  label={labels.reminderObligation}
                  value={reminderId}
                  copyId={labels.copyId}
                  copied={labels.copied}
                />
              ) : null}
              {investigation.ai_drafted ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-2">
                  <Bot className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="text-xs font-medium text-foreground">{labels.aiDrafted}</span>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </SectionCard>
  );
}
