'use client';

/**
 * State + persistence for the Case Qualification & Evidence tab.
 *
 * The qualification assessment (legal-fitness checklist, strong/weak points, and
 * completion) is persisted under `legalCase.metadata.qualification` through the
 * REAL `casesApi.updateCase` endpoint. Because the backend replaces the whole
 * `metadata` object on update, every write reads the current metadata, spreads
 * it, and swaps only the `qualification` key — sibling keys (e.g.
 * `beneficiary_entity_id`) are preserved. A local draft is the source of truth
 * for rapid toggles so concurrent writes never clobber each other; it re-syncs
 * from the server whenever the case refetches.
 *
 * Evidence (documents), witnesses (parties role=witness) and expert reports are
 * read from their real endpoints — nothing here is fabricated.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { casesApi, type LegalCase, type LegalExpertAssignment } from '@/lib/lex/cases';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  QUALIFICATION_CRITERIA,
  type PositionBand,
  type QualificationCriterion,
  type QualificationLabels,
} from './qualification-i18n';

/** Shape persisted under `metadata.qualification`. */
export interface QualificationRecord {
  criteria: Partial<Record<QualificationCriterion, boolean>>;
  strong_points: string[];
  weak_points: string[];
  status: 'in_progress' | 'complete';
  completed_at?: string;
  completed_by?: string;
  updated_at?: string;
}

export interface CasePosture {
  /** 0–100 position strength; null when the risk matrix is not assessed. */
  pct: number | null;
  band: PositionBand | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    : [];
}

/** Parse (and normalize) the persisted qualification blob into a full record. */
export function parseQualification(metadata: LegalCase['metadata']): QualificationRecord {
  const raw = asRecord(asRecord(metadata).qualification);
  const criteriaRaw = asRecord(raw.criteria);
  const criteria: Partial<Record<QualificationCriterion, boolean>> = {};
  for (const key of QUALIFICATION_CRITERIA) {
    if (typeof criteriaRaw[key] === 'boolean') criteria[key] = criteriaRaw[key] as boolean;
  }
  return {
    criteria,
    strong_points: asStringArray(raw.strong_points),
    weak_points: asStringArray(raw.weak_points),
    status: raw.status === 'complete' ? 'complete' : 'in_progress',
    completed_at: typeof raw.completed_at === 'string' ? raw.completed_at : undefined,
    completed_by: typeof raw.completed_by === 'string' ? raw.completed_by : undefined,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  };
}

/** Position strength = inverse of the assessed risk severity (likelihood×impact, 1–25). */
export function derivePosture(legalCase: LegalCase): CasePosture {
  const l = legalCase.risk_likelihood;
  const i = legalCase.risk_impact;
  if (typeof l !== 'number' || typeof i !== 'number' || l < 1 || i < 1) {
    return { pct: null, band: null };
  }
  const riskScore = Math.min(25, Math.max(1, l * i));
  const pct = Math.round(((25 - riskScore) / 24) * 100); // 1→100%, 25→0%
  const band: PositionBand =
    pct >= 75 ? 'very_strong' : pct >= 55 ? 'strong' : pct >= 35 ? 'moderate' : 'weak';
  return { pct, band };
}

interface UseCaseQualificationArgs {
  legalCase: LegalCase;
  caseId: string;
  canWrite: boolean;
  onChanged: () => Promise<void> | void;
  labels: QualificationLabels;
}

export function useCaseQualification({
  legalCase,
  caseId,
  canWrite,
  onChanged,
  labels,
}: UseCaseQualificationArgs) {
  // Local draft is the source of truth for in-flight edits; re-sync when the
  // server case changes (updated_at moves on every persisted write).
  const [record, setRecord] = useState<QualificationRecord>(() =>
    parseQualification(legalCase.metadata),
  );
  const lastSyncedAt = useRef(legalCase.updated_at);
  useEffect(() => {
    if (legalCase.updated_at !== lastSyncedAt.current) {
      lastSyncedAt.current = legalCase.updated_at;
      setRecord(parseQualification(legalCase.metadata));
    }
  }, [legalCase.updated_at, legalCase.metadata]);

  const persistMutation = useMutation({
    mutationFn: (next: QualificationRecord) =>
      casesApi.updateCase(caseId, {
        metadata: { ...asRecord(legalCase.metadata), qualification: next },
      }),
    onError: (error) => {
      // Roll the draft back to the server truth on failure.
      setRecord(parseQualification(legalCase.metadata));
      showApiError(error);
    },
    onSuccess: async () => {
      await onChanged();
    },
  });

  const persist = useCallback(
    (patch: Partial<QualificationRecord>, toastMessage?: string) => {
      setRecord((current) => {
        const next: QualificationRecord = {
          ...current,
          ...patch,
          updated_at: new Date().toISOString(),
        };
        persistMutation.mutate(next, {
          onSuccess: () => {
            if (toastMessage) showSuccess(toastMessage);
          },
        });
        return next;
      });
    },
    [persistMutation],
  );

  const toggleCriterion = useCallback(
    (criterion: QualificationCriterion, checked: boolean) => {
      if (!canWrite) return;
      persist(
        { criteria: { ...record.criteria, [criterion]: checked } },
        labels.toast.checklistSaved,
      );
    },
    [canWrite, persist, record.criteria, labels.toast.checklistSaved],
  );

  const setPoints = useCallback(
    (kind: 'strong_points' | 'weak_points', points: string[]) => {
      if (!canWrite) return;
      persist({ [kind]: points } as Partial<QualificationRecord>, labels.toast.pointsSaved);
    },
    [canWrite, persist, labels.toast.pointsSaved],
  );

  const complete = useCallback(() => {
    if (!canWrite) return;
    persist(
      { status: 'complete', completed_at: new Date().toISOString() },
      labels.toast.completed,
    );
  }, [canWrite, persist, labels.toast.completed]);

  const reopen = useCallback(() => {
    if (!canWrite) return;
    persist(
      { status: 'in_progress', completed_at: undefined, completed_by: undefined },
      labels.toast.reopened,
    );
  }, [canWrite, persist, labels.toast.reopened]);

  // "Request additional documents" creates a REAL open task on the case.
  const requestDocsMutation = useMutation({
    mutationFn: () =>
      casesApi.defineTask(caseId, {
        title: labels.requestDocsTaskTitle,
        priority: 'high',
        status: 'open',
      }),
    onSuccess: async () => {
      showSuccess(labels.toast.docsRequested);
      await onChanged();
    },
    onError: showApiError,
  });

  // Real evidence + expert sources.
  const documentsQuery = useQuery({
    queryKey: ['lex-case-documents', caseId],
    queryFn: () => casesApi.listCaseDocuments(caseId),
    enabled: Boolean(caseId),
  });
  const expertsQuery = useQuery({
    queryKey: ['lex-case-experts', caseId],
    queryFn: () => casesApi.listExperts(caseId),
    enabled: Boolean(caseId),
  });

  const metCount = QUALIFICATION_CRITERIA.filter((c) => record.criteria[c]).length;
  const totalCount = QUALIFICATION_CRITERIA.length;
  const readinessPct = Math.round((metCount / totalCount) * 100);
  const posture = useMemo(() => derivePosture(legalCase), [legalCase]);
  const witnesses = useMemo(
    () => (legalCase.parties ?? []).filter((p) => p.role === 'witness'),
    [legalCase.parties],
  );
  const experts: LegalExpertAssignment[] = expertsQuery.data ?? [];

  return {
    record,
    metCount,
    totalCount,
    readinessPct,
    posture,
    witnesses,
    experts,
    documents: documentsQuery.data ?? [],
    documentsLoading: documentsQuery.isLoading,
    expertsLoading: expertsQuery.isLoading,
    saving: persistMutation.isPending,
    requesting: requestDocsMutation.isPending,
    toggleCriterion,
    setPoints,
    complete,
    reopen,
    requestDocs: () => requestDocsMutation.mutate(),
    allCriteriaMet: metCount === totalCount,
    isComplete: record.status === 'complete',
  };
}
