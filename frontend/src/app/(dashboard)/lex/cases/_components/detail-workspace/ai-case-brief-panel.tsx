'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, RefreshCw, Sparkles } from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { formatDateTime, truncate } from '@/lib/format';
import {
  formatCaseToken,
  type CaseHearing,
  type CaseParty,
  type CaseTask,
  type LegalCase,
  type LegalCaseAuditEntry,
  type LegalExpertAssignment,
  type LegalJudgment,
  type LegalPleading,
} from '@/lib/lex/cases';
import { useCaseCourtName } from '../case-court';
import { useCaseLabels } from '../labels';
import { useDetailWorkspaceLabels } from './workspace-labels';
import { activeTaskCount, type DeadlineItem } from './workflow-metrics';

interface AiCaseBriefPanelProps {
  legalCase: LegalCase;
  title: string;
  parties: CaseParty[];
  hearings: CaseHearing[];
  tasks: CaseTask[];
  auditEntries: LegalCaseAuditEntry[];
  pleadings: LegalPleading[];
  experts: LegalExpertAssignment[];
  judgments: LegalJudgment[];
  deadlines: DeadlineItem[];
}

interface CaseBrief {
  posture: string;
  facts: string[];
  risks: string[];
  nextSteps: string[];
}

export function AiCaseBriefPanel({
  legalCase,
  title,
  parties,
  hearings,
  tasks,
  auditEntries,
  pleadings,
  experts,
  judgments,
  deadlines,
}: AiCaseBriefPanelProps) {
  const caseLabels = useCaseLabels();
  const labels = useDetailWorkspaceLabels();
  const courtName = useCaseCourtName();
  const t = labels.aiBrief;
  const [refreshVersion, setRefreshVersion] = useState(0);
  const brief = useMemo(
    () => {
      void refreshVersion;
      return buildDeterministicBrief({
        legalCase,
        title,
        parties,
        hearings,
        tasks,
        auditEntries,
        pleadings,
        experts,
        judgments,
        deadlines,
        caseLabels,
        briefLabels: labels.aiBrief,
        // Resolved outside the builder: the builder is a plain function and the
        // reference-vs-legacy court choice is locale-aware.
        courtLabel: courtName(legalCase),
      });
    },
    [
      auditEntries,
      caseLabels,
      courtName,
      deadlines,
      experts,
      hearings,
      judgments,
      labels.aiBrief,
      legalCase,
      parties,
      pleadings,
      refreshVersion,
      tasks,
      title,
    ],
  );

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {t.title}
        </span>
      }
      description={t.description}
      actions={
        <Button size="sm" variant="outline" onClick={() => setRefreshVersion((value) => value + 1)}>
          <RefreshCw className="me-1.5 h-3.5 w-3.5" />
          {t.refresh}
        </Button>
      }
    >
      <div className="space-y-4">
        <BriefBlock title={t.posture} items={[brief.posture]} icon="neutral" />
        <BriefBlock title={t.facts} items={brief.facts} icon="success" />
        <BriefBlock title={t.risks} items={brief.risks.length > 0 ? brief.risks : [t.noRisks]} icon="risk" />
        <BriefBlock title={t.nextSteps} items={brief.nextSteps.length > 0 ? brief.nextSteps : [t.noNextSteps]} icon="neutral" />
      </div>
    </SectionCard>
  );
}

function BriefBlock({
  title,
  items,
  icon,
}: {
  title: string;
  items: string[];
  icon: 'neutral' | 'success' | 'risk';
}) {
  const Icon = icon === 'risk' ? AlertTriangle : CheckCircle2;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={icon === 'risk' ? 'h-4 w-4 text-warning-700 dark:text-warning-300' : 'h-4 w-4 text-primary'} />
        <p className="text-sm font-semibold">{title}</p>
      </div>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item} className="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Server AI integration point: replace this deterministic builder with a mutation
// returning the same CaseBrief shape, then keep this function as the offline fallback.
function buildDeterministicBrief({
  legalCase,
  title,
  parties,
  hearings,
  tasks,
  auditEntries,
  pleadings,
  experts,
  judgments,
  deadlines,
  caseLabels,
  briefLabels,
  courtLabel,
}: AiCaseBriefPanelProps & {
  caseLabels: ReturnType<typeof useCaseLabels>;
  briefLabels: ReturnType<typeof useDetailWorkspaceLabels>['aiBrief'];
  /** Reference court name, or the legacy free text, or '' when neither is set. */
  courtLabel: string;
}): CaseBrief {
  const b = briefLabels.brief;
  const status =
    caseLabels.filters.statusOptions[legalCase.status] ?? formatCaseToken(legalCase.status);
  const priority =
    caseLabels.filters.priorityOptions[legalCase.priority] ?? formatCaseToken(legalCase.priority);
  const companyStatus =
    caseLabels.filters.companyStatusOptions[legalCase.company_status] ??
    formatCaseToken(legalCase.company_status);
  const strength = legalCase.strength
    ? caseLabels.filters.strengthOptions[legalCase.strength] ?? formatCaseToken(legalCase.strength)
    : briefLabels.notAssessed;
  const latestHearing = [...hearings].sort(
    (a, b) => new Date(b.hearing_date).getTime() - new Date(a.hearing_date).getTime(),
  )[0];
  const filedPleadings = pleadings.filter((pleading) => pleading.status === 'filed').length;
  const pendingJudgments = judgments.filter((judgment) => judgment.recommendation === 'pending').length;
  const criticalDeadlines = deadlines.filter((deadline) => deadline.severity === 'critical').length;
  const highDeadlines = deadlines.filter((deadline) => deadline.severity === 'high').length;
  const nextDeadline = deadlines[0];

  const facts = [
    b.summary(title, companyStatus, status, priority),
    b.workspaceCounts(parties.length, hearings.length, activeTaskCount(tasks), auditEntries.length),
  ];

  if (courtLabel) {
    facts.push(b.competentCourt(courtLabel));
  }
  if (legalCase.responsible_lawyer) {
    facts.push(b.responsibleLawyer(legalCase.responsible_lawyer));
  }
  if (legalCase.description) {
    facts.push(b.matterSummary(truncate(legalCase.description, 180)));
  }
  if (latestHearing) {
    facts.push(
      b.latestHearing(
        formatDateTime(latestHearing.hearing_date),
        latestHearing.decision ? truncate(latestHearing.decision, 120) : '',
      ),
    );
  }
  if (pleadings.length > 0 || experts.length > 0 || judgments.length > 0) {
    facts.push(b.filings(filedPleadings, pleadings.length, experts.length, judgments.length));
  }

  const risks: string[] = [];
  if (criticalDeadlines > 0) risks.push(b.criticalDeadlines(criticalDeadlines));
  if (highDeadlines > 0) risks.push(b.highDeadlines(highDeadlines));
  if (legalCase.priority === 'critical' || legalCase.priority === 'high') risks.push(b.casePriority(priority));
  if (!legalCase.strength) risks.push(b.strengthNotAssessed);
  if (legalCase.strength === 'weak') risks.push(b.strengthWeak);
  if (!legalCase.responsible_lawyer) risks.push(b.noResponsibleLawyer);
  if (pendingJudgments > 0) risks.push(b.pendingJudgments(pendingJudgments));

  const nextSteps: string[] = [];
  if (nextDeadline) {
    nextSteps.push(b.reviewDeadline(nextDeadline.title, formatDateTime(nextDeadline.date)));
  }
  if (!legalCase.responsible_lawyer) nextSteps.push(b.assignLawyer);
  if (!legalCase.strength) nextSteps.push(b.completeStrength);
  if (tasks.length === 0) nextSteps.push(b.createTask);
  if (!hearings.some((hearing) => new Date(hearing.hearing_date).getTime() >= Date.now())) {
    nextSteps.push(b.confirmHearing);
  }

  return {
    posture: `${legalCase.case_number || title} • ${status} • ${priority} • ${strength}`,
    facts,
    risks,
    nextSteps,
  };
}
