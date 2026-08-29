import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const directTileSurfaces = [
  {
    name: 'service catalog',
    path: 'src/app/(dashboard)/lex/admin/service-catalog/page.tsx',
    grid: 'service-catalog-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
    cardClass: 'service-catalog-kpi-card',
    cards: 3,
  },
  {
    name: 'classifications',
    path: 'src/app/(dashboard)/lex/admin/classifications/page.tsx',
    grid: 'classification-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4',
    cardClass: 'classification-kpi-card',
    cards: 4,
  },
  {
    name: 'escalations',
    path: 'src/app/(dashboard)/lex/admin/escalations/page.tsx',
    grid: 'escalation-kpi-grid grid grid-cols-2 gap-3 xl:grid-cols-4',
    cardClass: 'escalation-kpi-card',
    cards: 4,
  },
  {
    name: 'legal holds',
    path: 'src/app/(dashboard)/lex/admin/legal-holds/page.tsx',
    grid: 'legal-hold-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
    cardClass: 'legal-hold-kpi-card',
    cards: 3,
  },
  {
    name: 'service detail',
    path: 'src/app/(dashboard)/lex/admin/service-catalog/_components/service-detail-view.tsx',
    grid: 'service-detail-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4',
    cardClass: 'service-detail-kpi-card',
    cards: 4,
  },
  {
    name: 'organization registry',
    path: 'src/app/(dashboard)/lex/admin/org-entities/page.tsx',
    grid: 'org-entity-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
    cardClass: 'org-entity-kpi-card',
    cards: 3,
  },
  {
    name: 'escalation coverage',
    path: 'src/app/(dashboard)/lex/admin/org-entities/_components/escalation-coverage/escalation-coverage-matrix.tsx',
    grid: 'escalation-coverage-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4',
    cardClass: 'escalation-coverage-kpi-card',
    cards: 4,
  },
  {
    name: 'localization coverage',
    path: 'src/app/(dashboard)/lex/admin/org-entities/_components/localization-qa/localization-coverage-kpi.tsx',
    grid: 'localization-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
    cardClass: 'localization-kpi-card',
    cards: 3,
  },
  {
    name: 'organization health',
    path: 'src/app/(dashboard)/lex/admin/org-entities/_components/org-health/org-health-panel.tsx',
    grid: 'org-health-kpi-grid grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3',
    cardClass: 'org-health-kpi-card',
    cards: 3,
  },
  {
    name: 'responsibility directory',
    path: 'src/app/(dashboard)/lex/admin/org-entities/_components/people/responsibility-directory.tsx',
    grid: 'responsibility-kpi-grid grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
    cardClass: 'responsibility-kpi-card',
    cards: 3,
  },
  {
    name: 'platform sync',
    path: 'src/app/(dashboard)/lex/admin/org-entities/_components/platform-sync/platform-sync-view.tsx',
    grid: 'platform-sync-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4',
    cardClass: 'platform-sync-kpi-card',
    cards: 4,
  },
] as const;

describe('compact Watheeq Admin KPI contract', () => {
  it('opts the admin health dashboard into the shared operational strip', () => {
    const source = read(
      'src/app/(dashboard)/lex/admin/_components/admin-health-dashboard.tsx',
    );

    expect(source).toContain('appearance="operational"');
    expect(source).toContain('className="admin-health-kpi-grid"');
    expect(source).not.toContain('description: t.kpiCritical');
    expect(source).not.toContain('description: t.kpiWarnings');
  });

  it.each(directTileSurfaces)(
    'keeps the $name KPIs compact and balanced',
    ({ path, grid, cardClass, cards }) => {
      const source = read(path);

      expect(source).toContain(grid);
      expect(source).toContain("from '@/components/shared/stat-tile'");
      expect(source).not.toContain("from '@/components/shared/kpi-card'");
      expect(source.match(/<StatTile\b/g)).toHaveLength(cards);
      expect(source.match(/size="md"/g)).toHaveLength(cards);
      expect(source.match(/appearance="operational"/g)).toHaveLength(cards);
      expect(source).toContain(cardClass);
    },
  );

  it('removes verbose description copy from the converted admin KPI rows', () => {
    expect(read(directTileSurfaces[0].path)).not.toContain(
      'description={kpiCopy.total}',
    );
    expect(read(directTileSurfaces[1].path)).not.toContain(
      'description={kpiCopy.translations}',
    );
    expect(read(directTileSurfaces[2].path)).not.toContain(
      'description={labels.copy.gaps}',
    );
    expect(read(directTileSurfaces[3].path)).not.toContain(
      'description={copy.stats.activeHint}',
    );
    expect(read(directTileSurfaces[4].path)).not.toContain(
      'description={kpiCopy.mailboxes}',
    );
    expect(read(directTileSurfaces[5].path)).not.toContain(
      'description={kpiCopy.departments}',
    );
    expect(read(directTileSurfaces[6].path)).not.toContain(
      'description={kpiCopy.coverage}',
    );
    expect(read(directTileSurfaces[7].path)).not.toContain(
      'description={labels.kpiEntitiesDesc}',
    );
    expect(read(directTileSurfaces[8].path)).not.toContain(
      'description={t.groupCritical}',
    );
    expect(read(directTileSurfaces[9].path)).not.toContain(
      'description={t.kpis.vacanciesHint}',
    );
    expect(read(directTileSurfaces[10].path)).not.toContain(
      'description={t.kpiDriftHint}',
    );
  });
});
