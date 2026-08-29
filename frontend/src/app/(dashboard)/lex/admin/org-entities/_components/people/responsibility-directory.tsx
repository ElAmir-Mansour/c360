/**
 * ResponsibilityDirectory — the "People" surface of the org-entity admin module.
 *
 * It fetches the full org-entity registry, flattens every role assignment into
 * rows of (entity, role_key, user), and resolves each holder to a named person
 * via the shared people directory. The result is a filterable table plus a KPI
 * strip and an escalation-risk (vacancy + overload) panel.
 *
 * Mounted by the orchestrator as a "People" section/tab on the org-entities list
 * page. Fully self-contained: owns its own loading / empty / error states.
 */
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Users, UserCheck, ShieldAlert, AlertTriangle, SearchX } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { StatTile } from '@/components/shared/stat-tile';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { SectionCard } from '@/components/suites/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ORG_ROLE_KEYS, lexAdminApi, type OrgEntity, type OrgRole, type OrgRoleKey } from '@/lib/lex/admin';
import { peopleLabels } from '../../_lib/people-i18n';
import { usePeopleDirectory } from '../../_lib/org-people';
import RoleHolderChip from './role-holder-chip';
import { PeopleVacancyPanel, detectVacancies, detectOverload } from './people-vacancy-panel';

/** react-query key for the directory's entity fetch (distinct from the list page). */
const RESPONSIBILITY_ENTITIES_KEY = ['org-entities', 'responsibility-directory'] as const;

const ALL_ROLES = '__all__';

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

interface AssignmentRow {
  key: string;
  entity: OrgEntity;
  role: OrgRole;
}

interface ResponsibilityDirectoryProps {
  /** Reserved for write affordances; the directory is read-only today. */
  canWrite?: boolean;
}

/** Flatten every entity's roles into one row per assignment. */
function flattenAssignments(entities: OrgEntity[]): AssignmentRow[] {
  const rows: AssignmentRow[] = [];
  for (const entity of entities) {
    for (const role of entity.roles ?? []) {
      if (!role.user_id) continue;
      rows.push({ key: `${entity.id}:${role.role_key}:${role.user_id}`, entity, role });
    }
  }
  return rows;
}

export function ResponsibilityDirectory({ canWrite = false }: ResponsibilityDirectoryProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? peopleLabels.ar : peopleLabels.en;
  const directory = usePeopleDirectory();

  const [roleFilter, setRoleFilter] = useState<OrgRoleKey | typeof ALL_ROLES>(ALL_ROLES);
  const [search, setSearch] = useState('');
  const [vacantOnly, setVacantOnly] = useState(false);

  const query = useQuery({
    queryKey: RESPONSIBILITY_ENTITIES_KEY,
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500 }),
    staleTime: 60 * 1000,
  });

  const entities = useMemo(() => query.data?.data ?? [], [query.data]);
  const assignments = useMemo(() => flattenAssignments(entities), [entities]);

  /* ---- KPIs (computed over the full, unfiltered dataset) ----------------- */
  const kpis = useMemo(() => {
    const distinctPeople = new Set(assignments.map((a) => a.role.user_id)).size;
    const vacancies = detectVacancies(entities).length;
    const overloaded = detectOverload(entities).length;
    return { distinctPeople, vacancies, overloaded };
  }, [assignments, entities]);
  const roleCount = assignments.length;
  const vacancyShare = percent(kpis.vacancies, Math.max(entities.length, 1));
  const overloadShare = percent(kpis.overloaded, Math.max(kpis.distinctPeople, 1));

  /* ---- Filtered rows ------------------------------------------------------ */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assignments.filter(({ entity, role }) => {
      if (roleFilter !== ALL_ROLES && role.role_key !== roleFilter) {
        return false;
      }
      if (vacantOnly) {
        // "Vacant only" surfaces assignments whose holder could not be resolved
        // to a real directory person — an unfilled / stale binding.
        if (directory.has(role.user_id)) {
          return false;
        }
      }
      if (term) {
        const haystack = [
          directory.fullName(role.user_id),
          directory.email(role.user_id) ?? '',
          role.user_id,
          resolveLocalized(role.label, locale),
          entity.code,
          resolveLocalized(entity.name, locale),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) {
          return false;
        }
      }
      return true;
    });
  }, [assignments, roleFilter, vacantOnly, search, directory, locale]);

  const filtersActive = roleFilter !== ALL_ROLES || search.trim() !== '' || vacantOnly;
  const clearFilters = () => {
    setRoleFilter(ALL_ROLES);
    setSearch('');
    setVacantOnly(false);
  };

  /* ---- States ------------------------------------------------------------ */
  if (query.isLoading) {
    return (
      <div className="space-y-4">
        <LoadingSkeleton variant="kpi" count={3} label={t.directory.loading} />
        <LoadingSkeleton variant="table" count={6} />
      </div>
    );
  }

  if (query.isError) {
    return (
      <SectionCard title={t.directory.title} description={t.directory.description}>
        <EmptyState
          icon={AlertTriangle}
          title={t.directory.errorTitle}
          description={t.directory.errorDescription}
          action={{ label: t.directory.retry, onClick: () => void query.refetch() }}
        />
      </SectionCard>
    );
  }

  if (assignments.length === 0) {
    return (
      <SectionCard title={t.directory.title} description={t.directory.description}>
        <EmptyState icon={Users} title={t.directory.emptyTitle} description={t.directory.emptyDescription} />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5" data-can-write={canWrite || undefined}>
      {/* KPI strip */}
      <div className="responsibility-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label={t.kpis.roleHolders}
          value={kpis.distinctPeople}
          icon={UserCheck}
          themeClass="kpi-theme-emerald"
          detail={t.kpis.roleHolders}
          detailValue={roleCount}
          size="md"
          appearance="operational"
          className="responsibility-kpi-card"
          href="#responsibility-directory-records"
        />
        <StatTile
          label={t.kpis.vacancies}
          value={kpis.vacancies}
          icon={ShieldAlert}
          themeClass={kpis.vacancies > 0 ? 'kpi-theme-red' : 'kpi-theme-primary'}
          progress={vacancyShare}
          progressLabel={t.kpis.vacancies}
          detail={t.directory.title}
          detailValue={`${vacancyShare}%`}
          size="md"
          appearance="operational"
          className="responsibility-kpi-card"
          href="#responsibility-risk-records"
        />
        <StatTile
          label={t.kpis.overloaded}
          value={kpis.overloaded}
          icon={AlertTriangle}
          themeClass={kpis.overloaded > 0 ? 'kpi-theme-amber' : 'kpi-theme-primary'}
          progress={overloadShare}
          progressLabel={t.kpis.overloaded}
          detail={t.directory.title}
          detailValue={`${overloadShare}%`}
          size="md"
          appearance="operational"
          className="responsibility-kpi-card"
          href="#responsibility-risk-records"
        />
      </div>

      {/* Escalation-risk panels */}
      <div id="responsibility-risk-records" className="scroll-mt-24">
        <PeopleVacancyPanel entities={entities} />
      </div>

      {/* Directory table */}
      <div id="responsibility-directory-records" className="scroll-mt-24">
        <SectionCard
          title={t.directory.title}
          description={t.directory.description}
          actions={<span className="text-xs text-muted-foreground">{t.table.resultCount(filtered.length)}</span>}
          contentClassName="space-y-4 pt-2"
        >
          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="sm:w-56">
              <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as OrgRoleKey | typeof ALL_ROLES)}>
                <SelectTrigger>
                  <SelectValue placeholder={t.table.allRoles} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ROLES}>{t.table.allRoles}</SelectItem>
                  {ORG_ROLE_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>
                      {t.roleKeys[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.table.searchPlaceholder}
              />
            </div>
            <Button
              type="button"
              variant={vacantOnly ? 'default' : 'outline'}
              size="sm"
              aria-pressed={vacantOnly}
              onClick={() => setVacantOnly((v) => !v)}
              className="shrink-0"
            >
              <ShieldAlert className="me-1.5 h-4 w-4" aria-hidden />
              {t.table.vacantOnly}
            </Button>
          </div>

          {/* Rows */}
          {filtered.length === 0 ? (
            <EmptyState
              icon={SearchX}
              size="compact"
              title={t.directory.noMatchTitle}
              description={t.directory.noMatchDescription}
              action={filtersActive ? { label: t.directory.clearFilters, onClick: clearFilters } : undefined}
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full border-collapse text-start text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-start text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2.5 text-start font-medium">{t.table.person}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{t.table.role}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{t.table.entity}</th>
                    <th className="px-3 py-2.5 text-start font-medium">{t.table.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(({ key, entity, role }) => (
                    <tr key={key} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2.5 align-middle">
                        <RoleHolderChip userId={role.user_id} label={role.label} size="sm" />
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <Badge variant="outline">{t.roleKeys[role.role_key]}</Badge>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <Link
                          href={`/lex/admin/org-entities/${entity.id}`}
                          className="inline-flex items-center gap-1.5 font-medium text-foreground hover:text-primary hover:underline"
                        >
                          <span className="font-mono text-xs text-muted-foreground">{entity.code}</span>
                          <span className="truncate">{resolveLocalized(entity.name, locale)}</span>
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <PersonStatusBadge userId={role.user_id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

/** Small status chip resolved via the people directory; degrades to "unknown". */
function PersonStatusBadge({ userId }: { userId: string }) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? peopleLabels.ar : peopleLabels.en;
  const directory = usePeopleDirectory();
  const status = directory.status(userId);

  const key = (status ?? 'unknown') as keyof typeof t.personStatus;
  const label = t.personStatus[key] ?? t.personStatus.unknown;
  const variant =
    status === 'active'
      ? 'success'
      : status === 'suspended'
        ? 'destructive'
        : status === 'invited'
          ? 'default'
          : 'secondary';

  return <Badge variant={variant}>{label}</Badge>;
}

export default ResponsibilityDirectory;
