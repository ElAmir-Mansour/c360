'use client';

/**
 * BeneficiaryPicker — improvement #2 for the Lex "New Legal Request" wizard.
 *
 * Replaces the wizard's free-text "Department" Input with a self-contained,
 * controlled org-entity picker. It fetches the active org-entity registry on its
 * own, renders a bilingual searchable Combobox, and emits a clean
 * {@link BeneficiarySelection} (or null on clear).
 *
 * The selection is what downstream eligibility & create wiring consumes:
 *   - `sel.code`     -> checkEligibility({ beneficiary_code })
 *   - `sel.entityId` -> createRequest({ beneficiary_entity_id })
 *
 * Controlled: the parent owns `value` (the selected entity id); this component
 * holds no selection state of its own. Logical-direction CSS only (ps/pe/ms/me),
 * so it mirrors correctly under RTL.
 */
import { AlertCircle, Building2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Combobox } from '@/components/shared/forms/combobox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { cn } from '@/lib/utils';
import { lexAdminApi, type OrgEntity, type OrgEntityType } from '@/lib/lex/admin';
import { beneficiaryLabels } from '../_lib/beneficiary-i18n';

/**
 * BeneficiarySelection is the clean, locale-resolved payload emitted on select.
 * `code` feeds eligibility; `entityId` is the stable id stored on the request;
 * `department` and `name` are the resolved display string (kept distinct so the
 * orchestrator can map them onto its own field names without re-resolving).
 */
export interface BeneficiarySelection {
  entityId: string;
  code: string;
  department: string;
  name: string;
}

export interface BeneficiaryPickerProps {
  /** Currently selected org-entity id (controlled). */
  value?: string;
  /** Emitted on select with the resolved selection, or null when cleared. */
  onChange: (sel: BeneficiarySelection | null) => void;
  /** Validation/error message to surface in the destructive style. */
  error?: string;
  /** Disables the control (e.g. while the wizard is submitting). */
  disabled?: boolean;
}

export default function BeneficiaryPicker({
  value,
  onChange,
  error,
  disabled,
}: BeneficiaryPickerProps) {
  const { locale } = useLocaleOrDefault();
  const t = locale === 'ar' ? beneficiaryLabels.ar : beneficiaryLabels.en;

  const entitiesQuery = useQuery({
    queryKey: ['lex-org-entities', 'beneficiary'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500 }),
  });

  const activeEntities: OrgEntity[] = (entitiesQuery.data?.data ?? []).filter(
    (entity) => entity.active,
  );

  const options = activeEntities.map((entity) => ({
    label: `${resolveLocalized(entity.name, locale)} · ${entity.code}`,
    value: entity.id,
  }));

  const selectedEntity = activeEntities.find((entity) => entity.id === value);

  const handleChange = (nextId: string) => {
    if (!nextId) {
      onChange(null);
      return;
    }
    const entity = activeEntities.find((candidate) => candidate.id === nextId);
    if (!entity) {
      onChange(null);
      return;
    }
    const name = resolveLocalized(entity.name, locale);
    onChange({
      entityId: entity.id,
      code: entity.code,
      department: name,
      name,
    });
  };

  const fieldId = 'beneficiary-entity';
  const labelId = `${fieldId}-label`;
  const helperId = `${fieldId}-helper`;
  const errorId = `${fieldId}-error`;
  const describedBy = error ? `${errorId} ${helperId}` : helperId;

  return (
    <div className="space-y-2">
      {/*
        The shared Combobox does not forward an id/aria-* to its trigger button,
        so the visible label is tied to the real focusable control by wrapping the
        Combobox in a labelled group (aria-labelledby) rather than an htmlFor that
        can only reach a non-interactive element.
      */}
      <Label id={labelId}>
        {t.fieldLabel}
        <span className="ms-1 text-destructive" aria-label={t.requiredA11y}>
          *
        </span>
      </Label>
      <p id={helperId} className="text-xs text-muted-foreground">
        {t.helper}
      </p>

      {entitiesQuery.isLoading ? (
        <Skeleton variant="list-item" role="status" aria-label={t.fieldLabel} />
      ) : entitiesQuery.isError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t.loadError}</span>
        </div>
      ) : options.length === 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <Building2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{t.emptyHint}</span>
        </div>
      ) : (
        <div role="group" aria-labelledby={labelId} aria-describedby={describedBy}>
          <Combobox
            options={options}
            value={value ?? ''}
            onChange={handleChange}
            placeholder={t.placeholder}
            searchPlaceholder={t.searchPlaceholder}
            ariaLabel={t.fieldLabel}
            ariaDescribedBy={describedBy}
            ariaInvalid={Boolean(error)}
            required
            disabled={disabled}
            className={cn(
              'w-full',
              error && 'border-destructive focus-visible:ring-destructive',
            )}
          />
        </div>
      )}

      {selectedEntity ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="secondary">
            {entityTypeLabel(selectedEntity.entity_type, locale === 'ar' ? 'ar' : 'en')}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {t.codeLabel}: {selectedEntity.code}
          </span>
        </div>
      ) : null}

      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Resolves the human, bilingual label for an org entity type. */
function entityTypeLabel(type: OrgEntityType, side: 'en' | 'ar'): string {
  return beneficiaryLabels[side].entityType[type];
}
