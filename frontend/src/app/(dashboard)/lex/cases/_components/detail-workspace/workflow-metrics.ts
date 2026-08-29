import { differenceInCalendarDays, isValid, parseISO, startOfToday } from 'date-fns';
import type {
  CaseHearing,
  CaseTask,
  LegalExpertAssignment,
  LegalJudgment,
} from '@/lib/lex/cases';

export type DeadlineRiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type DeadlineItemType = 'task' | 'hearing' | 'expert' | 'judgment';

export interface DeadlineItem {
  id: string;
  type: DeadlineItemType;
  title: string;
  date: string;
  daysUntil: number;
  severity: DeadlineRiskLevel;
  detail?: string;
}

export interface DeadlineSource {
  tasks: CaseTask[];
  hearings: CaseHearing[];
  experts?: LegalExpertAssignment[];
  judgments?: LegalJudgment[];
}

export interface DeadlineSummary {
  level: DeadlineRiskLevel;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  overdueCount: number;
  activeCount: number;
  nextItem: DeadlineItem | null;
  typeCounts: Record<DeadlineItemType, number>;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

function getSeverity(daysUntil: number): DeadlineRiskLevel {
  if (daysUntil <= 2) return 'critical';
  if (daysUntil <= 7) return 'high';
  if (daysUntil <= 14) return 'medium';
  return 'low';
}

function openTask(task: CaseTask): boolean {
  return task.status !== 'done' && task.status !== 'cancelled';
}

function activeExpert(expert: LegalExpertAssignment): boolean {
  return expert.status !== 'closed' && expert.status !== 'cancelled' && !expert.report_received_at;
}

export function buildDeadlineItems({
  tasks,
  hearings,
  experts = [],
  judgments = [],
}: DeadlineSource): DeadlineItem[] {
  const today = startOfToday();
  const items: DeadlineItem[] = [];

  for (const task of tasks) {
    const date = parseDate(task.due_date);
    if (!date || !openTask(task)) continue;
    const daysUntil = differenceInCalendarDays(date, today);
    items.push({
      id: `task:${task.id}`,
      type: 'task',
      title: task.title,
      date: task.due_date ?? task.updated_at,
      daysUntil,
      severity: getSeverity(daysUntil),
      detail: task.priority,
    });
  }

  for (const hearing of hearings) {
    const date = parseDate(hearing.hearing_date);
    if (!date) continue;
    const daysUntil = differenceInCalendarDays(date, today);
    if (daysUntil < 0) continue;
    items.push({
      id: `hearing:${hearing.id}`,
      type: 'hearing',
      title: hearing.location || 'Hearing',
      date: hearing.hearing_date,
      daysUntil,
      severity: getSeverity(daysUntil),
      detail: hearing.decision || undefined,
    });
  }

  for (const expert of experts) {
    const date = parseDate(expert.report_due_date);
    if (!date || !activeExpert(expert)) continue;
    const daysUntil = differenceInCalendarDays(date, today);
    items.push({
      id: `expert:${expert.id}`,
      type: 'expert',
      title: expert.expert_name,
      date: expert.report_due_date ?? expert.updated_at,
      daysUntil,
      severity: getSeverity(daysUntil),
      detail: expert.specialization,
    });
  }

  for (const judgment of judgments) {
    const date = parseDate(judgment.objection_deadline);
    if (!date) continue;
    const daysUntil = differenceInCalendarDays(date, today);
    items.push({
      id: `judgment:${judgment.id}`,
      type: 'judgment',
      title: judgment.judgment_ref,
      date: judgment.objection_deadline ?? judgment.updated_at,
      daysUntil,
      severity: getSeverity(daysUntil),
      detail: judgment.recommendation,
    });
  }

  return items.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    return a.title.localeCompare(b.title);
  });
}

export function summarizeDeadlineRisk(items: DeadlineItem[]): DeadlineSummary {
  const criticalCount = items.filter((item) => item.severity === 'critical').length;
  const highCount = items.filter((item) => item.severity === 'high').length;
  const mediumCount = items.filter((item) => item.severity === 'medium').length;
  const lowCount = items.filter((item) => item.severity === 'low').length;
  const overdueCount = items.filter((item) => item.daysUntil < 0).length;
  const level: DeadlineRiskLevel =
    criticalCount > 0 ? 'critical' : highCount > 0 ? 'high' : items.length > 0 ? 'medium' : 'low';
  const typeCounts: Record<DeadlineItemType, number> = {
    task: 0,
    hearing: 0,
    expert: 0,
    judgment: 0,
  };

  for (const item of items) {
    typeCounts[item.type] += 1;
  }

  return {
    level,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    overdueCount,
    activeCount: items.length,
    nextItem: items[0] ?? null,
    typeCounts,
  };
}

export function activeTaskCount(tasks: CaseTask[]): number {
  return tasks.filter(openTask).length;
}
