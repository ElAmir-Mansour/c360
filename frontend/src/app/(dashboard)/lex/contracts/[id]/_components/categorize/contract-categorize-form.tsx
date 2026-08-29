'use client';

/**
 * CAP-123 — Manual contract categorize form.
 *
 * Operator-curated categorization, DISTINCT from the AI `/classify` path: the
 * reviewer picks from the tenant's category catalog and applies the slugs onto
 * the contract's tags + a categorized_at/by stamp. Designed to mount in the
 * contract detail / review-desk AFTER the final-version upload (CAP-117).
 *
 * - Multi-select feeds from `GET /contracts/categories` (tenant catalog).
 * - Applied-category chips reflect which catalog slugs are already on the
 *   contract's tags (the persisted categorization).
 * - Save -> `POST /contracts/{id}/categorize`; on success we toast and call the
 *   caller's `onCategorized` so the detail surface refreshes.
 */

import { useMemo, useState } from 'react';
import { Tags } from 'lucide-react';

import { SectionCard } from '@/components/suites/section-card';
import { MultiSelect } from '@/components/shared/forms/multi-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { showApiError, showSuccess } from '@/lib/toast';

import {
  useCategorizeContract,
  useContractCategories,
  type ContractCategory,
} from './use-categorize';
import { useCategorizeLabels } from './contract-categorize-labels';

export interface ContractCategorizeFormProps {
  contractId: string;
  /** Current contract tags — used to seed the applied-category chips/selection. */
  contractTags: string[];
  /** Gate the apply action on lex:write. */
  canWrite?: boolean;
  /** Called after a successful categorize so the detail surface can refresh. */
  onCategorized?: () => void | Promise<void>;
}

export function ContractCategorizeForm({
  contractId,
  contractTags,
  canWrite = false,
  onCategorized,
}: ContractCategorizeFormProps) {
  const labels = useCategorizeLabels();
  const categoriesQuery = useContractCategories();
  const categorize = useCategorizeContract(contractId);

  const categories = useMemo<ContractCategory[]>(
    () => categoriesQuery.data ?? [],
    [categoriesQuery.data],
  );

  // The catalog slug set, so we can show only catalog-backed tags as "applied
  // categories" (a contract can carry free tags too — those are not categories).
  const catalogBySlug = useMemo(() => {
    const map = new Map<string, ContractCategory>();
    for (const c of categories) map.set(c.slug, c);
    return map;
  }, [categories]);

  const appliedSlugs = useMemo(
    () => contractTags.filter((tag) => catalogBySlug.has(tag)),
    [contractTags, catalogBySlug],
  );

  // Selection is seeded from the currently-applied categories; the operator
  // adds/removes and saves the resulting set.
  const [selected, setSelected] = useState<string[] | null>(null);
  const effectiveSelected = selected ?? appliedSlugs;

  const options = useMemo(
    () => categories.map((c) => ({ label: c.name, value: c.slug })),
    [categories],
  );

  const dirty = useMemo(() => {
    const a = [...effectiveSelected].sort();
    const b = [...appliedSlugs].sort();
    return a.length !== b.length || a.some((slug, i) => slug !== b[i]);
  }, [effectiveSelected, appliedSlugs]);

  const handleSave = () => {
    categorize.mutate(effectiveSelected, {
      onSuccess: async () => {
        showSuccess(labels.toastTitle, labels.toastDetail);
        setSelected(null);
        await onCategorized?.();
      },
      onError: showApiError,
    });
  };

  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          <Tags className="h-4 w-4" aria-hidden />
          {labels.title}
        </span>
      }
      description={labels.description}
      isLoading={categoriesQuery.isLoading}
      loadingVariant="list"
      loadingCount={2}
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-foreground">{labels.appliedHeading}</span>
          {appliedSlugs.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {appliedSlugs.map((slug) => (
                <Badge key={slug} variant="secondary">
                  {catalogBySlug.get(slug)?.name ?? slug}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{labels.appliedEmpty}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground" htmlFor="contract-categorize-select">
            {labels.categoriesLabel}
          </label>
          <MultiSelect
            options={options}
            selected={effectiveSelected}
            onChange={setSelected}
            placeholder={labels.selectPlaceholder}
            disabled={!canWrite || categorize.isPending}
          />
          {categoriesQuery.isError ? (
            <p className="text-sm text-destructive">{labels.catalogError}</p>
          ) : options.length === 0 && !categoriesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">{labels.catalogEmpty}</p>
          ) : null}
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={!canWrite || !dirty || categorize.isPending}
          >
            {categorize.isPending ? labels.saving : labels.save}
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}
