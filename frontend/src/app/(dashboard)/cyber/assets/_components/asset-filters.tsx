import type { FetchParams, FilterConfig } from '@/types/table';
import type { AssetLabels } from '../_lib/assets-i18n';
import { assetLabels } from '../_lib/assets-i18n';

export function flattenAssetFetchParams(params: FetchParams): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    page: params.page,
    per_page: params.per_page,
    sort: params.sort,
    order: params.order,
    search: params.search,
  };

  for (const [key, value] of Object.entries(params.filters ?? {})) {
    if (!value || (typeof value === 'string' && value.length === 0)) {
      continue;
    }
    flat[key] = value;
  }

  return flat;
}

export function getAssetFilters(t: AssetLabels = assetLabels.en): FilterConfig[] {
  const f = t.filters;
  return [
    {
      key: 'type',
      label: f.type,
      type: 'multi-select',
      options: [
        { label: f.typeOptions.server, value: 'server' },
        { label: f.typeOptions.endpoint, value: 'endpoint' },
        { label: f.typeOptions.cloudResource, value: 'cloud_resource' },
        { label: f.typeOptions.networkDevice, value: 'network_device' },
        { label: f.typeOptions.iotDevice, value: 'iot_device' },
        { label: f.typeOptions.application, value: 'application' },
        { label: f.typeOptions.database, value: 'database' },
        { label: f.typeOptions.container, value: 'container' },
      ],
    },
    {
      key: 'criticality',
      label: f.criticality,
      type: 'multi-select',
      options: [
        { label: f.critOptions.critical, value: 'critical' },
        { label: f.critOptions.high, value: 'high' },
        { label: f.critOptions.medium, value: 'medium' },
        { label: f.critOptions.low, value: 'low' },
      ],
    },
    {
      key: 'status',
      label: f.status,
      type: 'multi-select',
      options: [
        { label: f.statusOptions.active, value: 'active' },
        { label: f.statusOptions.inactive, value: 'inactive' },
        { label: f.statusOptions.decommissioned, value: 'decommissioned' },
        { label: f.statusOptions.unknown, value: 'unknown' },
      ],
    },
    {
      key: 'discovery_source',
      label: f.discoverySource,
      type: 'multi-select',
      options: [
        { label: f.sourceOptions.manual, value: 'manual' },
        { label: f.sourceOptions.networkScan, value: 'network_scan' },
        { label: f.sourceOptions.cloudScan, value: 'cloud_scan' },
        { label: f.sourceOptions.agent, value: 'agent' },
        { label: f.sourceOptions.import, value: 'import' },
      ],
    },
    {
      key: 'has_vulnerabilities',
      label: f.hasVulnerabilities,
      type: 'select',
      options: [
        { label: f.yes, value: 'true' },
        { label: f.no, value: 'false' },
      ],
    },
    {
      key: 'owner',
      label: f.owner,
      type: 'text',
      placeholder: f.ownerPlaceholder,
    },
    {
      key: 'department',
      label: f.department,
      type: 'text',
      placeholder: f.departmentPlaceholder,
    },
    {
      key: 'tag',
      label: f.tag,
      type: 'text',
      placeholder: f.tagPlaceholder,
    },
    {
      key: 'discovered_after',
      label: f.discoveredAfter,
      type: 'date-range',
    },
  ];
}
