'use client';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { lexAdminApi, type OrgEntity, type OrgEntityType } from '@/lib/lex/admin';
import {
  AsyncRecordPicker,
  type AsyncRecordPickerLabels,
  type RecordPickerOption,
} from './async-record-picker';

const ENTITY_TYPE_LABELS: Record<'en' | 'ar', Record<OrgEntityType, string>> = {
  en: {
    company: 'Company',
    business_unit: 'Business unit',
    department: 'Department',
    section: 'Section',
    shared_services_unit: 'Shared-services unit',
  },
  ar: {
    company: 'شركة',
    business_unit: 'وحدة أعمال',
    department: 'إدارة',
    section: 'قسم',
    shared_services_unit: 'وحدة خدمات مشتركة',
  },
};

export interface OrgEntityPickerProps {
  id?: string;
  ariaLabel: string;
  value: string;
  onChange: (entityId: string, option?: RecordPickerOption) => void;
  enabled?: boolean;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  selectedLabel?: string;
  labels?: Partial<AsyncRecordPickerLabels>;
  className?: string;
}

/** Converts registry entities into human-readable picker options; UUIDs stay internal. */
export function orgEntityOptions(
  entities: OrgEntity[],
  search: string,
  locale: 'en' | 'ar',
): RecordPickerOption[] {
  const query = search.trim().toLocaleLowerCase();

  return entities
    .filter((entity) => entity.active)
    .filter((entity) => {
      if (!query) return true;
      return [entity.code, entity.name.en, entity.name.ar]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(query);
    })
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((entity) => {
      const name = resolveLocalized(entity.name, locale) || entity.code;
      return {
        value: entity.id,
        label: name,
        triggerLabel: `${name} — ${entity.code}`,
        description: `${ENTITY_TYPE_LABELS[locale][entity.entity_type]} · ${entity.code}`,
        keywords: [entity.code, entity.name.en, entity.name.ar],
        metadata: { code: entity.code, name, entity_type: entity.entity_type },
      };
    });
}

/** Searchable active organisational-unit picker backed by the tenant registry. */
export function OrgEntityPicker({
  id,
  ariaLabel,
  value,
  onChange,
  enabled = true,
  disabled = false,
  required = false,
  allowClear = false,
  selectedLabel,
  labels,
  className,
}: OrgEntityPickerProps) {
  const { locale } = useLocaleOrDefault();
  const side = locale === 'ar' ? 'ar' : 'en';

  return (
    <AsyncRecordPicker
      id={id}
      ariaLabel={ariaLabel}
      queryKey={['lex-active-org-entity-picker', side]}
      loadOptions={async (search) => {
        const response = await lexAdminApi.listOrgEntities({
          page: 1,
          per_page: 500,
          sort: 'code',
          order: 'asc',
          search,
          filters: { active: 'true' },
        });
        return orgEntityOptions(response.data, search, side);
      }}
      value={value}
      onChange={onChange}
      enabled={enabled}
      disabled={disabled}
      required={required}
      allowClear={allowClear}
      selectedLabel={selectedLabel}
      labels={labels}
      className={className}
    />
  );
}
