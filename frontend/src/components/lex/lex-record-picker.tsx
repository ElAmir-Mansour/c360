'use client';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  AsyncRecordPicker,
  type AsyncRecordPickerLabels,
  type RecordPickerOption,
} from '@/components/shared/forms/async-record-picker';
import { resolveLocalized } from '@/lib/i18n/localized';
import { casesApi } from '@/lib/lex/cases';
import { consultationsApi } from '@/lib/lex/consultations';
import { investigationsApi } from '@/lib/lex/investigations';
import { lexRequestsApi } from '@/lib/lex/requests';
import { settlementsApi } from '@/lib/lex/settlements';
import { enterpriseApi } from '@/lib/enterprise';

export type LexRecordKind =
  | 'case'
  | 'consultation'
  | 'contract'
  | 'document'
  | 'file'
  | 'investigation'
  | 'legal_request'
  | 'matter'
  | 'sla_clock'
  | 'settlement';

interface LexRecordPickerProps {
  id?: string;
  kind: LexRecordKind;
  ariaLabel: string;
  value: string;
  onChange: (id: string, option?: RecordPickerOption) => void;
  enabled?: boolean;
  disabled?: boolean;
  required?: boolean;
  allowClear?: boolean;
  selectedLabel?: string;
  labels?: Partial<AsyncRecordPickerLabels>;
  excludeIds?: string[];
  className?: string;
}

const PAGE_SIZE = 50;

/** Searchable selector across the main Watheeq legal record catalogs. */
export function LexRecordPicker({
  id,
  kind,
  ariaLabel,
  value,
  onChange,
  enabled = true,
  disabled = false,
  required = false,
  allowClear = false,
  selectedLabel,
  labels,
  excludeIds = [],
  className,
}: LexRecordPickerProps) {
  const { locale } = useLocaleOrDefault();

  return (
    <AsyncRecordPicker
      id={id}
      ariaLabel={ariaLabel}
      queryKey={['lex-record-picker', kind, locale, excludeIds.slice().sort().join(',')]}
      loadOptions={async (search) => {
        const params = { page: 1, per_page: PAGE_SIZE, search: search || undefined, order: 'asc' as const };
        let options: RecordPickerOption[];

        switch (kind) {
          case 'case': {
            const response = await casesApi.listCases(params);
            options = response.data.map((record) => ({
              value: record.id,
              label: resolveLocalized(record.title, locale) || record.case_number,
              description: record.case_number,
            }));
            break;
          }
          case 'consultation': {
            const response = await consultationsApi.list(params);
            options = response.data.map((record) => ({
              value: record.id,
              label: resolveLocalized(record.title, locale) || record.consultation_number,
              description: record.consultation_number,
            }));
            break;
          }
          case 'contract': {
            const response = search
              ? await enterpriseApi.lex.searchContracts(search, params)
              : await enterpriseApi.lex.listContracts(params);
            options = response.data.map((record) => {
              const contractNumber =
                'contract_number' in record && typeof record.contract_number === 'string'
                  ? record.contract_number
                  : undefined;
              return {
                value: record.id,
                label: record.title,
                description: contractNumber || record.party_b_name,
              };
            });
            break;
          }
          case 'document': {
            const response = await enterpriseApi.lex.listDocuments(params);
            options = response.data.map((record) => ({
              value: record.id,
              label: record.title,
              description: record.file_name ?? record.type,
            }));
            break;
          }
          case 'file': {
            const response = await enterpriseApi.files.list({ page: 1, per_page: 100, suite: 'lex' });
            const term = search.toLocaleLowerCase();
            options = response.data
              .filter((record) =>
                term
                  ? [record.original_name, record.name, record.entity_type]
                      .filter(Boolean)
                      .some((part) => part!.toLocaleLowerCase().includes(term))
                  : true,
              )
              .map((record) => ({
                value: record.id,
                label: record.original_name || record.name,
                description: record.entity_type ? `${record.entity_type} · ${record.status}` : record.status,
                metadata: {
                  sizeBytes: record.size_bytes,
                  contentHash: record.checksum_sha256,
                },
              }));
            break;
          }
          case 'investigation': {
            const response = await investigationsApi.list(params);
            options = response.data.map((record) => ({
              value: record.id,
              label: record.subject || record.investigation_number,
              description: record.investigation_number,
            }));
            break;
          }
          case 'legal_request': {
            const response = await lexRequestsApi.listRequests(params);
            options = response.data.map((record) => ({
              value: record.id,
              label: resolveLocalized(record.title, locale) || record.request_number,
              description: record.request_number,
              keywords: [record.request_type, record.requester_name, record.status],
            }));
            break;
          }
          case 'matter': {
            const response = await enterpriseApi.lex.listMatters(params);
            options = response.data.map((record) => ({
              value: record.id,
              label: record.title || record.matter_number,
              description: record.matter_number,
            }));
            break;
          }
          case 'sla_clock': {
            const [clockResponse, requestResponse] = await Promise.all([
              lexRequestsApi.listSlaClocks({ page: 1, per_page: PAGE_SIZE, order: 'asc' }),
              lexRequestsApi.listRequests(params),
            ]);
            const requestsById = new Map(requestResponse.data.map((request) => [request.id, request]));
            const term = search.toLocaleLowerCase();

            options = clockResponse.data
              .map((record) => {
                const clock = record as typeof record & {
                  legal_request_id?: string;
                  service_code?: string;
                  priority?: string;
                  turnaround_due_at?: string;
                };
                const request = clock.legal_request_id
                  ? requestsById.get(clock.legal_request_id)
                  : undefined;
                const title = request
                  ? resolveLocalized(request.title, locale) || request.request_number
                  : clock.service_code || (locale === 'ar' ? 'ساعة اتفاقية الخدمة' : 'SLA clock');
                const due = clock.turnaround_due_at
                  ? new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en', {
                      dateStyle: 'medium',
                    }).format(new Date(clock.turnaround_due_at))
                  : undefined;
                const context = [request?.request_number, clock.service_code, clock.priority, due]
                  .filter(Boolean)
                  .join(' · ');

                return {
                  value: record.id,
                  label: title,
                  description: context || undefined,
                  keywords: [request?.request_number, clock.service_code, clock.priority].filter(
                    (part): part is string => Boolean(part),
                  ),
                };
              })
              .filter((option) =>
                term
                  ? [option.label, option.description, ...(option.keywords ?? [])]
                      .filter(Boolean)
                      .some((part) => part!.toLocaleLowerCase().includes(term))
                  : true,
              );
            break;
          }
          case 'settlement': {
            const response = await settlementsApi.list(params);
            options = response.data.map((record) => ({
              value: record.id,
              label: record.title || record.reference,
              description: record.reference,
            }));
            break;
          }
        }

        const excluded = new Set(excludeIds);
        return options.filter((option) => !excluded.has(option.value));
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
