/**
 * PeopleVacancyPanel — escalation-risk surface for the responsibility directory.
 *
 * Two risk classes are computed from the org-entity registry:
 *   1. VACANCIES — active `department` entities with no `department_manager`
 *      bound, and active `section` entities with no `section_supervisor`. These
 *      break the escalation ladder, so each is a deep link to fix it.
 *   2. OVERLOAD — any single `user_id` holding roles across N ≥ 3 distinct
 *      entities is a concentration risk and is flagged with the count.
 *
 * The pure detectors are exported so the parent directory can reuse them for the
 * KPI strip without recomputing or refetching.
 */
'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { AlertTriangle, ShieldAlert, UserX, ExternalLink, CheckCircle2, Users } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SectionCard } from '@/components/suites/section-card';
import type { OrgEntity, OrgRoleKey } from '@/lib/lex/admin';
import { peopleLabels } from '../../_lib/people-i18n';
import { usePeopleDirectory } from '../../_lib/org-people';
import RoleHolderChip from './role-holder-chip';

/** Number of distinct entities at/above which a person is "overloaded". */
export const OVERLOAD_THRESHOLD = 3;

export type VacancyKind = 'department_manager' | 'section_supervisor';

export interface VacancyRow {
  entity: OrgEntity;
  kind: VacancyKind;
}

export interface OverloadRow {
  userId: string;
  /** Distinct entities this person holds a role on. */
  entityCount: number;
}

/** Does an active entity of `type` have a role of `roleKey` bound directly? */
function hasRole(entity: OrgEntity, roleKey: OrgRoleKey): boolean {
  return (entity.roles ?? []).some((r) => r.role_key === roleKey && Boolean(r.user_id));
}

/**
 * detectVacancies — pure detector. Active departments missing a department
 * manager and active sections missing a section supervisor.
 */
export function detectVacancies(entities: OrgEntity[]): VacancyRow[] {
  const rows: VacancyRow[] = [];
  for (const entity of entities) {
    if (!entity.active) continue;
    if (entity.entity_type === 'department' && !hasRole(entity, 'department_manager')) {
      rows.push({ entity, kind: 'department_manager' });
    } else if (entity.entity_type === 'section' && !hasRole(entity, 'section_supervisor')) {
      rows.push({ entity, kind: 'section_supervisor' });
    }
  }
  return rows;
}

/**
 * detectOverload — pure detector. Counts distinct entities each user holds a
 * role on, returning those at/above {@link OVERLOAD_THRESHOLD}, busiest first.
 */
export function detectOverload(entities: OrgEntity[]): OverloadRow[] {
  const byUser = new Map<string, Set<string>>();
  for (const entity of entities) {
    for (const role of entity.roles ?? []) {
      if (!role.user_id) continue;
      const set = byUser.get(role.user_id) ?? new Set<string>();
      set.add(role.entity_id || entity.id);
      byUser.set(role.user_id, set);
    }
  }
  const rows: OverloadRow[] = [];
  for (const [userId, set] of byUser) {
    if (set.size >= OVERLOAD_THRESHOLD) {
      rows.push({ userId, entityCount: set.size });
    }
  }
  rows.sort((a, b) => b.entityCount - a.entityCount);
  return rows;
}

interface PeopleVacancyPanelProps {
  entities: OrgEntity[];
}

export function PeopleVacancyPanel({ entities }: PeopleVacancyPanelProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? peopleLabels.ar : peopleLabels.en;
  const directory = usePeopleDirectory();

  const vacancies = detectVacancies(entities);
  const overloaded = detectOverload(entities);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning-700 dark:text-warning-300" aria-hidden />
            {t.vacancy.title}
            {vacancies.length > 0 ? (
              <Badge variant="warning">{vacancies.length}</Badge>
            ) : null}
          </span>
        }
        description={t.vacancy.description}
        contentClassName="space-y-2"
      >
        {vacancies.length === 0 ? (
          <EmptyRow
            icon={<CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />}
            title={t.vacancy.emptyTitle}
            description={t.vacancy.emptyDescription}
          />
        ) : (
          vacancies.map(({ entity, kind }) => (
            <div
              key={`${entity.id}-${kind}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-warning-100/70 bg-warning-50/50 px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <UserX className="h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    <span className="font-mono text-xs text-muted-foreground">{entity.code}</span>
                    {' · '}
                    {resolveLocalized(entity.name, locale)}
                  </p>
                  <p className="text-xs text-warning-700 dark:text-warning-300">
                    {kind === 'department_manager'
                      ? t.vacancy.missingDepartmentManager
                      : t.vacancy.missingSectionSupervisor}
                  </p>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" className="shrink-0">
                <Link href={`/lex/admin/org-entities/${entity.id}`}>
                  <ExternalLink className="me-1.5 h-3.5 w-3.5" aria-hidden />
                  {t.vacancy.open}
                </Link>
              </Button>
            </div>
          ))
        )}
      </SectionCard>

      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning-700 dark:text-warning-300" aria-hidden />
            {t.overload.title}
            {overloaded.length > 0 ? (
              <Badge variant="warning">{overloaded.length}</Badge>
            ) : null}
          </span>
        }
        description={t.overload.description}
        contentClassName="space-y-2"
      >
        {overloaded.length === 0 ? (
          <EmptyRow
            icon={<Users className="h-4 w-4 text-muted-foreground" aria-hidden />}
            title={t.overload.emptyTitle}
            description={t.overload.emptyDescription}
          />
        ) : (
          overloaded.map(({ userId, entityCount }) => (
            <div
              key={userId}
              className="flex items-center justify-between gap-3 rounded-lg border border-warning-100/70 bg-warning-50/40 px-3 py-2"
            >
              <RoleHolderChip userId={userId} size="sm" />
              <Badge variant="warning" className="shrink-0">
                {t.overload.roleSpread(entityCount)}
              </Badge>
            </div>
          ))
        )}
      </SectionCard>

      {/* Touch the directory so an in-flight fetch keeps chips warm even when the
          panels render before resolution; purely cosmetic, no behavior. */}
      <span className="sr-only" aria-hidden>
        {directory.isLoading ? t.directory.loading : ''}
      </span>
    </div>
  );
}

function EmptyRow({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-dashed border-border/70 px-3 py-3">
      {icon}
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default PeopleVacancyPanel;
