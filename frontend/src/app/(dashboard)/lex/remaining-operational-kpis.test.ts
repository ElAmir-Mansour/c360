import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const adminSurfaces = [
  {
    name: 'working calendars',
    path: 'src/app/(dashboard)/lex/admin/working-calendars/page.tsx',
    grid: 'working-calendar-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3',
    cardClass: 'working-calendar-kpi-card',
    cards: 3,
    removedDescription: 'description={kpiCopy.total}',
  },
  {
    name: 'SLA targets',
    path: 'src/app/(dashboard)/lex/admin/sla-targets/page.tsx',
    grid: 'sla-target-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3',
    cardClass: 'sla-target-kpi-card',
    cards: 3,
    removedDescription: 'description={kpiCopy.active}',
  },
  {
    name: 'attachment policies',
    path: 'src/app/(dashboard)/lex/admin/attachment-policies/page.tsx',
    grid: 'attachment-policy-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3',
    cardClass: 'attachment-policy-kpi-card',
    cards: 3,
    removedDescription: 'description={kpiCopy.slots}',
  },
  {
    name: 'request approval templates',
    path: 'src/app/(dashboard)/lex/admin/request-approval-policies/templates/page.tsx',
    grid: 'request-approval-template-kpi-grid grid grid-cols-2 gap-3',
    cardClass: 'request-approval-template-kpi-card',
    cards: 2,
    removedDescription: 'description={kpiCopy.templates}',
  },
  {
    name: 'contract approval templates',
    path: 'src/app/(dashboard)/lex/admin/contract-approval-policies/templates/page.tsx',
    grid: 'contract-approval-template-kpi-grid grid grid-cols-2 gap-3',
    cardClass: 'contract-approval-template-kpi-card',
    cards: 2,
    removedDescription: 'description={t.metricCopy.templates}',
  },
] as const;

describe('remaining operational KPI rollout', () => {
  it.each(adminSurfaces)(
    'keeps $name compact, flat and balanced',
    ({ path, grid, cardClass, cards, removedDescription }) => {
      const source = read(path);

      expect(source).toContain("from '@/components/shared/stat-tile'");
      expect(source).not.toContain("from '@/components/shared/kpi-card'");
      expect(source).toContain(grid);
      expect(source.match(/<StatTile\b/g)).toHaveLength(cards);
      expect(source.match(/size="md"/g)).toHaveLength(cards);
      expect(source.match(/appearance="operational"/g)).toHaveLength(cards);
      expect(source).toContain(cardClass);
      expect(source).not.toContain(removedDescription);
      expect(source).not.toMatch(/kpi-theme-(?:gold|rose|teal|slate)/);
    },
  );

  it('compacts every settlements headline, report and cycle KPI', () => {
    const source = read(
      'src/app/(dashboard)/lex/settlements/_components/settlement-analytics.tsx',
    );

    expect(source).toContain("from '@/components/shared/stat-tile'");
    expect(source).not.toContain("from '@/components/shared/kpi-card'");
    expect(source).not.toContain("from '@/components/shared/detail-stat-card'");
    expect(source).toContain(
      'settlement-analytics-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6',
    );
    expect(source).toContain(
      'settlement-report-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6',
    );
    expect(source).toContain(
      'settlement-cycle-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5',
    );
    expect(source.match(/<StatTile\b/g)).toHaveLength(17);
    expect(source.match(/size="md"/g)).toHaveLength(17);
    expect(source.match(/appearance="operational"/g)).toHaveLength(17);
    expect(source).not.toMatch(/kpi-theme-(?:gold|rose|teal|slate)/);
    expect(source).not.toContain('description={labels.kpis.settledValueHelper}');
    expect(source).not.toContain('helper={labels.cycle.avgDaysHelper}');
  });
});
