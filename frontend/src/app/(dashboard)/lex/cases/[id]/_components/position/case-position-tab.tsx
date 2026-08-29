'use client';

import { useMutation } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  Loader2,
  UserRound,
} from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLexFormat } from '@/lib/lex/ksa';
import {
  casesApi,
  type CaseCompanyStatus,
  type CaseParty,
  type LegalCase,
} from '@/lib/lex/cases';
import { useCaseCourtName } from '../../../_components/case-court';
import { derivePosture } from '../qualification/use-case-qualification';
import { useCasePositionLabels } from './case-position-i18n';

interface CasePositionTabProps {
  legalCase: LegalCase;
  caseId: string;
  canWrite: boolean;
  onChanged: () => Promise<void> | void;
}

export function resolveOpposingParty(
  parties: CaseParty[],
  companyStatus: CaseCompanyStatus,
): CaseParty | undefined {
  const opposingRole = companyStatus === 'plaintiff' ? 'defendant' : 'plaintiff';
  return parties.find((party) => party.role === opposingRole);
}

function metadataString(metadata: LegalCase['metadata'], key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function CasePositionTab({
  legalCase,
  caseId,
  canWrite,
  onChanged,
}: CasePositionTabProps) {
  const t = useCasePositionLabels();
  const f = useLexFormat();
  const courtName = useCaseCourtName();
  const parties = legalCase.parties ?? [];
  const opposingParty = resolveOpposingParty(parties, legalCase.company_status);
  const opposingRepresentative = parties.find((party) => party.role === 'lawyer');
  const posture = derivePosture(legalCase);
  // The retired court number is no longer a circuit fallback: it was a
  // different fact and stopped being captured at intake.
  const courtCircuit =
    metadataString(legalCase.metadata, 'court_circuit') ??
    metadataString(legalCase.metadata, 'judicial_circuit');

  const roleMutation = useMutation({
    mutationFn: (companyStatus: CaseCompanyStatus) =>
      casesApi.updateCase(caseId, { company_status: companyStatus }),
    onSuccess: async () => {
      showSuccess(t.toast.roleUpdated);
      await onChanged();
    },
    onError: showApiError,
  });

  const scoreLabel =
    posture.pct === null ? t.strength.notAssessed : `${f.formatNumber(posture.pct)}%`;
  const strengthLabel =
    posture.band === null ? t.strength.notAssessed : t.strength.bands[posture.band];

  return (
    <div className="space-y-4" aria-label={t.heading}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SectionCard
          title={
            <span className="inline-flex items-center gap-2">
              <UserRound className="h-4 w-4 text-primary" aria-hidden />
              {t.role.title}
            </span>
          }
          description={t.role.description}
          actions={
            roleMutation.isPending ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {t.role.saving}
              </span>
            ) : undefined
          }
        >
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/50 p-1">
            {(['plaintiff', 'defendant'] as const).map((status) => {
              const selected = legalCase.company_status === status;
              return (
                <Button
                  key={status}
                  type="button"
                  variant={selected ? 'default' : 'ghost'}
                  aria-pressed={selected}
                  disabled={!canWrite || roleMutation.isPending}
                  className={cn(
                    'min-h-10 rounded-lg px-3 py-2 text-sm font-semibold',
                    selected
                      ? 'shadow-sm'
                      : 'text-muted-foreground hover:bg-background hover:text-foreground',
                    (!canWrite || roleMutation.isPending) && 'cursor-not-allowed opacity-70',
                  )}
                  onClick={() => {
                    if (!selected) roleMutation.mutate(status);
                  }}
                >
                  {t.role.options[status]}
                </Button>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title={
            <span className="inline-flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" aria-hidden />
              {t.strength.title}
            </span>
          }
          description={t.strength.overall}
        >
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0 space-y-2">
              <p
                className={cn(
                  'text-lg font-bold',
                  posture.band ? 'text-success-700 dark:text-success-400' : 'text-muted-foreground',
                )}
              >
                {strengthLabel}
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                {posture.pct === null
                  ? t.strength.notAssessedHint
                  : t.strength.assessedHint(scoreLabel)}
              </p>
            </div>
            <div className="grid size-20 shrink-0 place-items-center rounded-full border-8 border-success-100 bg-card dark:border-success-900/40">
              <span className="text-lg font-bold tabular-nums text-foreground">{scoreLabel}</span>
            </div>
          </div>
          <Progress
            value={posture.pct ?? 0}
            aria-label={`${t.strength.overall}: ${scoreLabel}`}
            className="mt-4 h-2"
            indicatorClassName={posture.pct === null ? 'bg-muted-foreground/30' : 'bg-success-600'}
          />
        </SectionCard>
      </div>

      <SectionCard
        title={
          <span className="inline-flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" aria-hidden />
            {t.facts.title}
          </span>
        }
        description={t.facts.description}
      >
        <dl className="divide-y rounded-xl border">
          <FactRow
            label={t.facts.opponent}
            value={opposingParty?.name}
            fallback={t.facts.notSet}
          />
          <FactRow
            label={t.facts.opponentRepresentative}
            value={opposingRepresentative?.name}
            fallback={t.facts.notSet}
          />
          <FactRow
            label={t.facts.court}
            value={courtName(legalCase)}
            fallback={t.facts.notSet}
          />
          <FactRow
            label={t.facts.circuit}
            value={courtCircuit}
            fallback={t.facts.notSet}
          />
        </dl>
      </SectionCard>

    </div>
  );
}

function FactRow({
  label,
  value,
  fallback,
}: {
  label: string;
  value?: string | null;
  fallback: string;
}) {
  const resolved = value?.trim() || fallback;
  return (
    <div className="grid grid-cols-1 gap-1 px-4 py-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-center">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm font-semibold', resolved === fallback && 'text-muted-foreground')}>
        {resolved}
      </dd>
    </div>
  );
}
