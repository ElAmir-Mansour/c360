'use client';

/**
 * OrgMetadataPanel — READ-ONLY display of an org-entity's custom-attributes /
 * metadata master-data map.
 *
 * Pure presentational: no fetching, no mutation. Renders populated standard
 * schema fields as labeled key→value rows (skipping blanks, localizing both the
 * field label and the governorate value), then any extra non-schema keys under
 * an "Additional attributes" group. An empty map renders a subtle
 * "No attributes set" line.
 *
 * Mount: inside a SectionCard on the org-entity detail page.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  ORG_METADATA_SCHEMA,
  isBlank,
  isSaudiGovernorateKey,
  metadataValueToString,
  extraMetadataKeys,
} from '../../_lib/org-metadata-schema';
import { resolveMetadataLabels, type OrgMetadataLabels } from '../../_lib/org-metadata-i18n';

interface OrgMetadataPanelProps {
  metadata: Record<string, unknown>;
}

interface DisplayRow {
  key: string;
  label: string;
  value: string;
}

export default function OrgMetadataPanel({ metadata }: OrgMetadataPanelProps) {
  const { locale, direction } = useLocaleOrDefault();
  const labels: OrgMetadataLabels = useMemo(() => resolveMetadataLabels(locale), [locale]);

  const schemaRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [];
    for (const field of ORG_METADATA_SCHEMA) {
      const raw = metadata[field.key];
      if (isBlank(raw)) continue;
      const value =
        field.key === 'governorate' && isSaudiGovernorateKey(raw)
          ? labels.governorates[raw]
          : metadataValueToString(raw);
      if (value === '') continue;
      rows.push({ key: field.key, label: labels.fields[field.key], value });
    }
    return rows;
  }, [metadata, labels]);

  const extraRows = useMemo<DisplayRow[]>(() => {
    const rows: DisplayRow[] = [];
    for (const key of extraMetadataKeys(metadata)) {
      const value = metadataValueToString(metadata[key]);
      if (value === '') continue;
      rows.push({ key, label: key, value });
    }
    return rows;
  }, [metadata]);

  if (schemaRows.length === 0 && extraRows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" dir={direction} lang={locale}>
        {labels.panel.empty}
      </p>
    );
  }

  return (
    <div className="space-y-4" dir={direction} lang={locale}>
      {schemaRows.length > 0 ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {schemaRows.map((row) => (
            <KeyValue key={row.key} label={row.label} value={row.value} />
          ))}
        </dl>
      ) : null}

      {extraRows.length > 0 ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {labels.panel.additionalTitle}
          </p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {extraRows.map((row) => (
              <KeyValue key={row.key} label={row.label} value={row.value} mono />
            ))}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function KeyValue({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className={mono ? 'font-mono text-xs text-muted-foreground' : 'text-xs text-muted-foreground'}>
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}
