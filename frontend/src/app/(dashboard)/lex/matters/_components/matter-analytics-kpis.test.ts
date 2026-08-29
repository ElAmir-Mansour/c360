import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(
    process.cwd(),
    'src/app/(dashboard)/lex/matters/_components/matter-analytics.tsx',
  ),
  'utf8',
);

describe('Matter analytics KPI presentation', () => {
  it('uses five compact operational StatTiles in a balanced grid', () => {
    expect(source).toContain("from '@/components/shared/stat-tile'");
    expect(source).not.toContain("from '@/components/shared/detail-stat-card'");
    expect(source).toContain(
      'matter-analytics-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-5',
    );
    expect(source.match(/<StatTile\b/g)).toHaveLength(5);
    expect(source.match(/size="md"/g)).toHaveLength(5);
    expect(source.match(/appearance="operational"/g)).toHaveLength(5);
    expect(source.match(/className="matter-analytics-kpi-card"/g)).toHaveLength(5);
  });

  it('keeps verbose aging helpers out of the headline tiles', () => {
    expect(source).not.toContain('helper={labels.aging.overdueHelper}');
    expect(source).not.toContain('helper={labels.aging.avgCycleTimeHelper}');
    expect(source).not.toContain('helper={labels.aging.oldestOpenHelper}');
  });
});
