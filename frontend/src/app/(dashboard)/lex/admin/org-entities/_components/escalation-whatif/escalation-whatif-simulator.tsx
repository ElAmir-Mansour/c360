'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Network,
  RotateCcw,
  Search,
  ShieldAlert,
  SignpostBig,
} from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import { lexAdminApi, type OrgEntity } from '@/lib/lex/admin';
import {
  ESCALATION_ROLE_KEYS,
  effectiveRecipients,
  recomputeEffectiveLadder,
  uncoveredCount,
} from '../../_lib/escalation-whatif';
import { whatIfLabels } from '../../_lib/escalation-whatif-i18n';
import { WhatIfRecipientRow } from './whatif-recipient-row';

interface EscalationWhatIfSimulatorProps {
  /** When provided, the picker is preselected to this entity (detail page). */
  entityId?: string;
}

export default function EscalationWhatIfSimulator({
  entityId,
}: EscalationWhatIfSimulatorProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? whatIfLabels.ar : whatIfLabels.en;

  const [selectedId, setSelectedId] = useState<string | undefined>(entityId);
  const [pickerSearch, setPickerSearch] = useState('');
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());

  // Keep the selection in sync if the mounting page swaps the preselected id.
  useEffect(() => {
    setSelectedId(entityId);
  }, [entityId]);

  // Resetting toggles whenever the selected entity changes avoids leaking an
  // "on leave" flag from one entity's simulation into another's.
  useEffect(() => {
    setUnavailable(new Set());
  }, [selectedId]);

  // Full tenant load: the ladder recompute must walk REAL ancestry, so we need
  // every entity (and its roles), not just the selected one.
  const entitiesQuery = useQuery({
    queryKey: ['lex-admin-org-entities', 'whatif'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500 }),
  });
  const entities: OrgEntity[] = useMemo(
    () => entitiesQuery.data?.data ?? [],
    [entitiesQuery.data],
  );

  const ladderQuery = useQuery({
    queryKey: ['lex-admin-org-entities', 'whatif', 'escalation', selectedId],
    queryFn: () => lexAdminApi.getOrgEscalation(selectedId as string),
    enabled: Boolean(selectedId),
  });

  const filteredEntities = useMemo(() => {
    const needle = pickerSearch.trim().toLowerCase();
    if (!needle) return entities;
    return entities.filter((e) => {
      const haystack = [
        e.code,
        resolveLocalized(e.name, 'en'),
        resolveLocalized(e.name, 'ar'),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [entities, pickerSearch]);

  const selectedEntity = useMemo(
    () => entities.find((e) => e.id === selectedId) ?? null,
    [entities, selectedId],
  );

  // The effective ladder is recomputed locally on every toggle.
  const levels = useMemo(() => {
    if (!ladderQuery.data) return [];
    return recomputeEffectiveLadder(ladderQuery.data, entities, unavailable);
  }, [ladderQuery.data, entities, unavailable]);

  const effective = useMemo(() => effectiveRecipients(levels), [levels]);
  const uncovered = useMemo(() => uncoveredCount(levels), [levels]);

  // Base holder user-id per level, used to drive each row's on-leave switch.
  const baseUserIdByLevel = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of ladderQuery.data?.recipients ?? []) {
      map.set(r.level, r.user_id);
    }
    return map;
  }, [ladderQuery.data]);

  const toggleUnavailable = (userId: string, next: boolean) => {
    setUnavailable((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(userId);
      else copy.delete(userId);
      return copy;
    });
  };

  const picker = (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{t.pickerLabel}</span>
      <Select
        value={selectedId ?? ''}
        onValueChange={(v) => setSelectedId(v)}
        disabled={entitiesQuery.isLoading || entities.length === 0}
      >
        <SelectTrigger className="sm:max-w-md" aria-label={t.pickerLabel}>
          <SelectValue placeholder={t.pickerPlaceholder}>
            {selectedEntity
              ? `${selectedEntity.code} · ${
                  resolveLocalized(selectedEntity.name, locale) || selectedEntity.code
                }`
              : t.pickerPlaceholder}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {/* Sticky search box. Stop key events from reaching Radix typeahead. */}
          <div className="sticky top-0 z-10 bg-[var(--card-bg)] p-1.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground ltr:left-3 rtl:right-3"
                aria-hidden
              />
              <Input
                value={pickerSearch}
                onChange={(e) => setPickerSearch(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder={t.pickerSearchPlaceholder}
                className="h-9 ps-9"
                aria-label={t.pickerSearchPlaceholder}
              />
            </div>
          </div>
          {filteredEntities.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground">
              {t.pickerNoMatches}
            </div>
          ) : (
            filteredEntities.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{e.code}</span>
                  <span>{resolveLocalized(e.name, locale) || e.code}</span>
                  <Badge variant="outline" className="px-1.5 py-0 tracking-normal">
                    {t.entityTypes[e.entity_type]}
                  </Badge>
                </span>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <SectionCard title={t.title} description={t.description}>
      <div className="space-y-5">
        {/* Entity picker (hidden behind loading/empty/error of the entity list) */}
        {entitiesQuery.isLoading ? (
          <LoadingSkeleton variant="form" count={1} />
        ) : entitiesQuery.isError ? (
          <EmptyState
            icon={AlertTriangle}
            title={t.errorTitle}
            description={t.errorDescription}
            action={{ label: t.retry, onClick: () => entitiesQuery.refetch() }}
          />
        ) : entities.length === 0 ? (
          <EmptyState
            icon={Network}
            title={t.entitiesEmptyTitle}
            description={t.entitiesEmptyDescription}
          />
        ) : (
          <>
            {picker}

            {!selectedId ? (
              <EmptyState
                icon={SignpostBig}
                title={t.selectPromptTitle}
                description={t.selectPromptDescription}
                size="compact"
              />
            ) : ladderQuery.isLoading ? (
              <LoadingSkeleton variant="list" count={3} label={t.loadingLadder} />
            ) : ladderQuery.isError ? (
              <EmptyState
                icon={AlertTriangle}
                title={t.errorTitle}
                description={t.errorDescription}
                action={{ label: t.retry, onClick: () => ladderQuery.refetch() }}
                size="compact"
              />
            ) : (
              <>
                {/* Ladder section */}
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <h3 className="text-sm font-semibold">{t.ladderHeading}</h3>
                      <p className="text-xs text-muted-foreground">{t.ladderHint}</p>
                    </div>
                    {unavailable.size > 0 ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="warning" className="tracking-normal">
                          {t.unavailableCount(unavailable.size)}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setUnavailable(new Set())}
                        >
                          <RotateCcw className="me-1.5 size-3.5" aria-hidden />
                          {t.resetToggles}
                        </Button>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    {levels.map((level) => {
                      const baseUserId = baseUserIdByLevel.get(level.level) ?? null;
                      return (
                        <WhatIfRecipientRow
                          key={level.level}
                          level={level}
                          labels={t}
                          locale={locale}
                          baseUserId={baseUserId}
                          unavailable={baseUserId ? unavailable.has(baseUserId) : false}
                          onToggle={toggleUnavailable}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Effective recipients summary */}
                <EffectiveSummary
                  recipients={effective}
                  uncovered={uncovered}
                  labels={t}
                  locale={locale}
                />
              </>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */

function EffectiveSummary({
  recipients,
  uncovered,
  labels,
  locale,
}: {
  recipients: ReturnType<typeof effectiveRecipients>;
  uncovered: number;
  labels: typeof whatIfLabels.en;
  locale: 'en' | 'ar';
}) {
  const allFire = uncovered === 0 && recipients.length === ESCALATION_ROLE_KEYS.length;

  return (
    <div
      className={cn(
        'space-y-3 rounded-lg border p-4',
        uncovered > 0 ? 'border-rose-200 bg-rose-50/40' : 'border-primary/20 bg-primary/[0.04]',
      )}
    >
      <div className="flex items-start gap-2">
        {uncovered > 0 ? (
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-rose-600" aria-hidden />
        ) : (
          <BellRing className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        )}
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{labels.effectiveTitle}</h3>
          <p className="text-xs text-muted-foreground">{labels.effectiveDescription}</p>
        </div>
      </div>

      {recipients.length === 0 ? (
        <p className="text-sm font-medium text-rose-700">{labels.effectiveEmpty}</p>
      ) : (
        <ol className="space-y-1.5">
          {recipients.map((r) => (
            <li
              key={`${r.level}-${r.user_id}`}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              <Badge variant="outline" className="px-1.5 py-0 tracking-normal">
                {labels.levelBadge(r.level)}
              </Badge>
              <span className="text-muted-foreground">{labels.willNotify}</span>
              <span className="font-medium">
                {resolveLocalized(r.label, locale) || r.user_id}
              </span>
              <span className="text-xs text-muted-foreground">
                ({labels.roleKeys[r.role_key]} · {labels.fromEntity} {r.entity_code})
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="flex items-center gap-1.5 text-xs font-medium">
        {allFire ? (
          <>
            <CheckCircle2 className="size-3.5 text-primary" aria-hidden />
            <span className="text-primary">{labels.effectiveAllFire}</span>
          </>
        ) : uncovered > 0 ? (
          <>
            <ShieldAlert className="size-3.5 text-rose-600" aria-hidden />
            <span className="text-rose-700">{labels.effectiveSomeUncovered(uncovered)}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
