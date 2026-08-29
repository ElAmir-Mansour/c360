'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import {
  ROLE_ROSTER,
  dominantVerb,
  type MatrixVerb,
  type RoleCode,
  type RoleRosterEntry,
} from '../_lib/legal-role-matrix';
import {
  MATRIX_DOMAINS,
  TOTAL_CAPABILITY_ROWS,
  deriveDomainVerbs,
  restrictedVerbs,
  roleCoverageCount,
} from '../_lib/legal-role-permissions';
import { useRuntimeRolePerms } from '../_lib/use-runtime-role-perms';
import {
  useRoleMatrixLabels,
  type MatrixDomainId,
  type RoleMatrixLabels,
} from '../_lib/role-matrix-labels';
import { verbChipClass } from './verb-style';

/** Tier-band tint for the column-group header (literal classes for JIT). */
const TIER_BAND: Record<RoleRosterEntry['tier'], string> = {
  Business: 'bg-brand-teal-50 text-brand-teal-700 dark:bg-brand-teal-500/10 dark:text-brand-teal-300',
  Legal: 'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300',
  Oversight: 'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300',
  Admin: 'bg-brand-primary-50 text-brand-primary-700 dark:bg-brand-primary-500/10 dark:text-brand-primary-300',
};

/** Contiguous run of roles sharing a tier (for the grouped band header). */
interface TierSpan {
  tier: RoleRosterEntry['tier'];
  count: number;
}

function tierSpans(): TierSpan[] {
  const spans: TierSpan[] = [];
  for (const role of ROLE_ROSTER) {
    const last = spans[spans.length - 1];
    if (last && last.tier === role.tier) last.count += 1;
    else spans.push({ tier: role.tier, count: 1 });
  }
  return spans;
}

function MatrixCell({
  verbs,
  restricted,
  roleName,
  capability,
  t,
}: {
  verbs: readonly MatrixVerb[];
  restricted: readonly string[];
  roleName: string;
  capability: string;
  t: RoleMatrixLabels;
}) {
  if (verbs.length === 0) {
    return (
      <td
        className="border-b border-e border-border/60 p-1 text-center align-middle"
        aria-label={t.noAccessAria(roleName, capability)}
      >
        <span className="text-muted-foreground/50" aria-hidden>
          —
        </span>
      </td>
    );
  }

  const top = dominantVerb(verbs)!;
  const verbNames = verbs.map((v) => t.verbName[v]).join(' · ');
  const restrictedNote = restricted
    .map((r) => (r === 'assign' ? t.restricted.assign : t.restricted.distribute))
    .join(' · ');
  const tip = restrictedNote
    ? `${verbNames} (${t.restricted.label}: ${restrictedNote})`
    : verbNames;

  return (
    <td
      className="border-b border-e border-border/60 p-1 text-center align-middle"
      aria-label={t.cellAria(roleName, capability, tip)}
    >
      <span
        title={tip}
        className={cn(
          'inline-flex min-w-[1.75rem] items-center justify-center gap-0.5 rounded-md border px-1.5 py-0.5 text-xs font-bold',
          verbChipClass(top),
        )}
      >
        {verbs.join('·')}
        {restricted.length > 0 ? (
          <span className="ms-0.5 text-overline font-semibold opacity-70" aria-hidden>
            *
          </span>
        ) : null}
      </span>
    </td>
  );
}

function DomainRow({
  domainId,
  prefix,
  permsByCode,
  roleNames,
  t,
}: {
  domainId: MatrixDomainId;
  prefix: string;
  permsByCode: Record<RoleCode, readonly string[]>;
  roleNames: Record<string, string>;
  t: RoleMatrixLabels;
}) {
  const title = t.domainName[domainId];
  return (
    <tr className="group hover:bg-muted/40">
      <th
        scope="row"
        className="sticky start-0 z-10 min-w-[14rem] max-w-[18rem] border-b border-e border-border/60 bg-card p-2 text-start align-middle font-normal group-hover:bg-muted/40"
      >
        <span className="block text-sm font-medium leading-5 text-foreground">{title}</span>
      </th>
      <td className="border-b border-e border-border/60 px-2 py-2 text-center align-middle">
        <span className="whitespace-nowrap font-mono text-caption text-muted-foreground">
          {prefix}
        </span>
      </td>
      {ROLE_ROSTER.map((role) => {
        const perms = permsByCode[role.code] ?? [];
        return (
          <MatrixCell
            key={role.code}
            verbs={deriveDomainVerbs(perms, prefix)}
            restricted={restrictedVerbs(perms, prefix)}
            roleName={roleNames[role.code]}
            capability={title}
            t={t}
          />
        );
      })}
    </tr>
  );
}

/** Drift / sync banner — surfaces doc↔runtime divergence (design v2 §6). */
function DriftBanner({ t }: { t: RoleMatrixLabels }) {
  const { drift, seeded, isLoading } = useRuntimeRolePerms();
  if (isLoading) return null;

  if (!seeded) {
    return (
      <div className="flex items-start gap-2 border-b border-border/60 bg-warning-50 px-4 py-2.5 text-xs text-warning-700 dark:bg-warning-700/15 dark:text-warning-300">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t.driftUnseeded}</span>
      </div>
    );
  }

  if (drift.length === 0) {
    return (
      <div className="flex items-center gap-2 border-b border-border/60 bg-success-50 px-4 py-2.5 text-xs text-success-700 dark:bg-success-700/15 dark:text-success-300">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t.driftSyncedLabel}</span>
      </div>
    );
  }

  return (
    <div className="border-b border-border/60 bg-error-50 px-4 py-2.5 text-xs text-error-700 dark:bg-error-700/15 dark:text-error-300">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{t.driftDetectedLabel(drift.length)}</span>
      </div>
      <ul className="mt-1.5 space-y-0.5 ps-5">
        {drift.map((d) => (
          <li key={d.slug} className="list-disc">
            {d.extra.length > 0 ? (
              <span className="block font-mono">{t.driftExtra(d.slug, d.extra.join(', '))}</span>
            ) : null}
            {d.missing.length > 0 ? (
              <span className="block font-mono">
                {t.driftMissing(d.slug, d.missing.join(', '))}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The 14-role × capability-domain grid. Header: tier bands → per-role columns
 * (code + bilingual name + reports-to/escalation tooltip + coverage). Body: one
 * row per lex domain, each role's cell DERIVED from the seeded role permission
 * set (design v2 §6) via `deriveDomainVerbs`. The cells therefore reflect the
 * SAME permissions the server enforces; a drift banner reconciles the canonical
 * source against the live tenant's `/api/v1/roles`. The first column and the
 * header are sticky; RTL-aware via logical `start`/`end` spacing.
 */
export function RoleMatrixGrid() {
  const { locale, direction } = useLocale();
  const t = useRoleMatrixLabels();
  const { permsByCode } = useRuntimeRolePerms();

  const roleNames = Object.fromEntries(
    ROLE_ROSTER.map((r) => [r.code, locale === 'ar' ? r.roleAr : r.roleEn]),
  ) as Record<string, string>;

  const spans = tierSpans();

  return (
    <section
      dir={direction}
      lang={locale}
      aria-label={t.pageTitle}
      className="card overflow-hidden p-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <span className="text-sm font-semibold text-foreground">{t.pageTitle}</span>
        <span className="text-xs text-muted-foreground">
          {t.rolesCount(ROLE_ROSTER.length)} · {t.capabilitiesCount(TOTAL_CAPABILITY_ROWS)}
        </span>
      </div>

      <p className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
        {t.sourceNote}
      </p>

      <DriftBanner t={t} />

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {/* Tier band row */}
            <tr>
              <th
                rowSpan={2}
                scope="col"
                className="sticky start-0 top-0 z-30 min-w-[14rem] border-b border-e border-border bg-muted p-2 text-start align-bottom text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t.capabilityColumn}
              </th>
              <th
                rowSpan={2}
                scope="col"
                className="sticky top-0 z-20 border-b border-e border-border bg-muted p-2 text-center align-bottom text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t.brdColumn}
              </th>
              {spans.map((span, i) => (
                <th
                  key={`${span.tier}-${i}`}
                  colSpan={span.count}
                  scope="colgroup"
                  className={cn(
                    'border-b border-e border-border p-1.5 text-center text-xs font-bold uppercase tracking-wide',
                    TIER_BAND[span.tier],
                  )}
                >
                  {t.tier[span.tier]}
                </th>
              ))}
            </tr>
            {/* Per-role column row */}
            <tr>
              {ROLE_ROSTER.map((role) => {
                const name = roleNames[role.code];
                const tip = [
                  name,
                  `${t.unit}: ${locale === 'ar' ? role.unitAr : role.unitEn}`,
                  `${t.reportsTo}: ${locale === 'ar' ? role.reportsToAr : role.reportsToEn}`,
                  role.escalationLevel ? `${t.escalation}: ${role.escalationLevel}` : null,
                ]
                  .filter(Boolean)
                  .join('\n');
                const coverage = roleCoverageCount(role.code);
                return (
                  <th
                    key={role.code}
                    scope="col"
                    title={tip}
                    className="sticky top-0 z-10 min-w-[3.25rem] border-b border-e border-border bg-muted p-1.5 text-center align-bottom"
                  >
                    <span className="block text-xs font-bold text-foreground">{role.code}</span>
                    <span className="mt-0.5 block max-w-[5rem] truncate text-caption font-normal leading-3 text-muted-foreground">
                      {name}
                    </span>
                    {role.escalationLevel ? (
                      <span className="mt-0.5 inline-block rounded bg-primary/10 px-1 text-overline font-semibold text-primary">
                        {role.escalationLevel}
                      </span>
                    ) : null}
                    <span className="mt-0.5 block text-overline tabular-nums text-muted-foreground/80">
                      {coverage}/{TOTAL_CAPABILITY_ROWS}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {MATRIX_DOMAINS.map((domain) => (
              <DomainRow
                key={domain.id}
                domainId={domain.id as MatrixDomainId}
                prefix={domain.prefix}
                permsByCode={permsByCode}
                roleNames={roleNames}
                t={t}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
