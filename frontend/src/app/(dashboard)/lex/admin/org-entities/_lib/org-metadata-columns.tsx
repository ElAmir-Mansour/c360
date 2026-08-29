'use client';

/**
 * Table-column factory for org-entity metadata master-data.
 *
 * The orchestrator can spread a few high-value metadata columns into the
 * existing org-entities DataTable. Each column reads `entity.metadata[key]` and
 * renders the value (string/number) as text, localizing the governorate key and
 * falling back to an em-dash when absent.
 *
 * `METADATA_TABLE_KEYS` is the curated subset surfaced by default;
 * `getMetadataColumn(key)` builds the `ColumnDef<OrgEntity>` for any schema key.
 */

import type { ColumnDef } from '@tanstack/react-table';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { OrgEntity } from '@/lib/lex/admin';
import {
  isSaudiGovernorateKey,
  metadataValueToString,
  type OrgMetadataFieldKey,
} from './org-metadata-schema';
import { resolveMetadataLabels } from './org-metadata-i18n';

const EM_DASH = '—';

/** Curated, high-value metadata columns the orchestrator surfaces by default. */
export const METADATA_TABLE_KEYS: OrgMetadataFieldKey[] = [
  'cost_center',
  'governorate',
  'cr_number',
];

/** Cell renderer (needs hook access for locale-resolved labels). */
function MetadataCell({ entity, fieldKey }: { entity: OrgEntity; fieldKey: OrgMetadataFieldKey }) {
  const { locale } = useLocaleOrDefault();
  const labels = resolveMetadataLabels(locale);
  const raw = entity.metadata?.[fieldKey];

  let display: string;
  if (fieldKey === 'governorate' && isSaudiGovernorateKey(raw)) {
    display = labels.governorates[raw];
  } else {
    display = metadataValueToString(raw);
  }

  return (
    <span className={display === '' ? 'text-muted-foreground' : undefined}>
      {display === '' ? EM_DASH : display}
    </span>
  );
}

/** Header renderer (locale-resolved column label). */
function MetadataHeader({ fieldKey }: { fieldKey: OrgMetadataFieldKey }) {
  const { locale } = useLocaleOrDefault();
  const labels = resolveMetadataLabels(locale);
  return <>{labels.columns[fieldKey] ?? labels.fields[fieldKey]}</>;
}

/**
 * Build a `ColumnDef<OrgEntity>` for a metadata schema key. The cell reads
 * `entity.metadata[key]`; sorting is disabled (metadata is a JSON map, not a
 * first-class sortable column on the backend).
 */
export function getMetadataColumn(key: OrgMetadataFieldKey): ColumnDef<OrgEntity> {
  return {
    id: `metadata.${key}`,
    enableSorting: false,
    header: () => <MetadataHeader fieldKey={key} />,
    cell: ({ row }) => <MetadataCell entity={row.original} fieldKey={key} />,
  };
}
