import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

// The cases list deliberately has NO KPI row. Its six-tile StatTile header was
// removed because every tile duplicated a preset filter button in the toolbar
// directly beneath it, which is why it is absent from the contract below and
// guarded by its own regression test instead.
const casesListPath =
  'src/app/(dashboard)/lex/cases/_components/list-workspace/case-list-workspace.tsx';

const listKpiSurfaces = [
  {
    name: 'matters',
    path: 'src/app/(dashboard)/lex/matters/page.tsx',
    grid: 'matter-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-5',
    cardClass: 'matter-kpi-card',
    renderedTiles: 1,
  },
  {
    name: 'settlements',
    path: 'src/app/(dashboard)/lex/settlements/page.tsx',
    grid: 'settlement-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4',
    cardClass: 'settlement-kpi-card',
    renderedTiles: 4,
  },
] as const;

describe('compact Lex list KPI contract', () => {
  it.each(listKpiSurfaces)(
    'keeps the $name list on medium StatTiles in a balanced responsive grid',
    ({ path, grid, cardClass, renderedTiles }) => {
      const source = read(path);

      expect(source).toContain("from '@/components/shared/stat-tile'");
      expect(source).not.toContain("from '@/components/shared/kpi-card'");
      expect(source).toContain(grid);
      expect(source.match(/<StatTile\b/g)).toHaveLength(renderedTiles);
      expect(source.match(/size="md"/g)).toHaveLength(renderedTiles);
      expect(source.match(/appearance="operational"/g)).toHaveLength(renderedTiles);
      expect(source).toContain(cardClass);
    },
  );

  it('does not restore the verbose descriptions removed from the KPI rows', () => {
    const surface = (name: string) =>
      read(listKpiSurfaces.find((entry) => entry.name === name)!.path);
    const cases = read(casesListPath);
    const matters = surface('matters');
    const settlements = surface('settlements');

    expect(cases).not.toContain('description={w.statDetails.portfolioScope}');
    expect(cases).not.toContain('description={w.statDetails.activeDocket}');
    expect(matters).not.toContain('description={tile.description}');
    expect(settlements).not.toContain('description={L.statDetails.portfolioScope}');
  });

  it('does not restore the duplicated KPI header on the cases list', () => {
    const cases = read(casesListPath);

    expect(cases).not.toContain("from '@/components/shared/stat-tile'");
    expect(cases).not.toContain("from '@/components/shared/kpi-card'");
    expect(cases.match(/<StatTile\b/g)).toBeNull();
    expect(cases).not.toContain('case-kpi-grid');
    expect(cases).not.toContain('case-kpi-card');
  });
});
