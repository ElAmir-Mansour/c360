import { describe, expect, it } from 'vitest';
import {
  buildReportCsv,
  createDefaultReportDefinition,
  groupReportRows,
  mapSavedReportDefinition,
  normalizeReportDefinition,
  reportDefinitionPayload,
  type ReportBuilderRow,
} from './report-builder';

describe('Lex report builder definitions', () => {
  it('creates a complete source-aware default', () => {
    const definition = createDefaultReportDefinition('obligations');

    expect(definition.source).toBe('obligations');
    expect(definition.columns).toContain('due_date');
    expect(definition.groupBy).toBe('status');
    expect(definition.sortBy).toBe('due_date');
  });

  it('rejects unknown sources and strips unknown fields and filters', () => {
    expect(normalizeReportDefinition({ source: 'unknown' })).toBeNull();

    const definition = normalizeReportDefinition({
      source: 'contracts',
      name: '  Portfolio report  ',
      columns: ['title', 'malicious_sql', 'status'],
      filters: [
        { field: 'status', value: 'active' },
        { field: 'drop_table', value: 'yes' },
      ],
      sortBy: 'malicious_sql',
      groupBy: 'party_b_name',
      visualization: 'map',
    });

    expect(definition).toMatchObject({
      source: 'contracts',
      columns: ['title', 'status'],
      filters: [{ field: 'status', value: 'active' }],
      sortBy: 'created_at',
      groupBy: 'status',
      visualization: 'table',
    });
  });

  it('round-trips a saved definition through the opaque saved-view payload', () => {
    const definition = {
      ...createDefaultReportDefinition('cases'),
      name: 'High-risk cases',
      filters: [{ field: 'risk_rating', value: 'high' }],
      visualization: 'donut' as const,
      groupBy: 'risk_rating',
    };
    const payload = reportDefinitionPayload(definition);

    const saved = mapSavedReportDefinition({
      id: 'view-1',
      tenant_id: 'tenant-1',
      owner_user_id: 'user-1',
      namespace: 'lex-report-builder',
      name: 'High-risk cases',
      scope: 'team',
      payload,
      created_at: '2026-07-23T00:00:00Z',
      updated_at: '2026-07-23T01:00:00Z',
    });

    expect(saved).toMatchObject({
      id: 'view-1',
      scope: 'team',
      definition: {
        source: 'cases',
        name: 'High-risk cases',
        visualization: 'donut',
        groupBy: 'risk_rating',
      },
    });
  });
});

describe('Lex report builder output helpers', () => {
  const rows: ReportBuilderRow[] = [
    {
      id: '1',
      title: { en: 'Vendor, renewal', ar: 'تجديد المورد' },
      status: 'active',
    },
    {
      id: '2',
      title: '=HYPERLINK("https://example.invalid")',
      status: 'draft',
    },
    {
      id: '3',
      title: 'Second active',
      status: 'active',
    },
  ];

  it('groups the preview deterministically by the selected field', () => {
    expect(groupReportRows(rows, 'status', 'en', 'Not set')).toEqual([
      { name: 'active', value: 2 },
      { name: 'draft', value: 1 },
    ]);
  });

  it('exports only selected columns with CSV escaping and formula protection', () => {
    const definition = {
      ...createDefaultReportDefinition('contracts'),
      columns: ['title', 'status'],
    };
    const csv = buildReportCsv(
      definition,
      rows,
      'en',
      (field) => ({ title: 'Title', status: 'Status' })[field] ?? field,
    );

    expect(csv.startsWith('\uFEFFTitle,Status')).toBe(true);
    expect(csv).toContain('"Vendor, renewal",active');
    expect(csv).toContain(`'=HYPERLINK(""https://example.invalid"")`);
    expect(csv).not.toContain('risk_level');
  });
});
