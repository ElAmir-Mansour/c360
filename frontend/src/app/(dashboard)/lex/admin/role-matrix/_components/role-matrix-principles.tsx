'use client';

import { ShieldCheck, UserCheck, Eye } from 'lucide-react';
import { useLocale } from '@/components/providers/locale-provider';
import { useRoleMatrixLabels } from '../_lib/role-matrix-labels';

/**
 * Design-principles footnote — the least-privilege / separation-of-duties /
 * auditability invariants the matrix encodes (xlsx "Legend & Principles" sheet,
 * design §1). Informational only.
 */
export function RoleMatrixPrinciples() {
  const { locale, direction } = useLocale();
  const t = useRoleMatrixLabels();

  const items = [
    { icon: ShieldCheck, text: t.principleLeastPrivilege },
    { icon: UserCheck, text: t.principleSoD },
    { icon: Eye, text: t.principleAuditor },
  ];

  return (
    <section dir={direction} lang={locale} aria-label={t.principlesTitle} className="card p-5">
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{t.principlesTitle}</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {items.map(({ icon: Icon, text }, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-muted-foreground">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="leading-5">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
