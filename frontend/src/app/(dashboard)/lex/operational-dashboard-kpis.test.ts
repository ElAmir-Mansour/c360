import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('operational dashboard KPI surfaces', () => {
  it('keeps detailed analytics compact, flat and free of helper copy', () => {
    const source = read('src/app/(dashboard)/lex/reports/analytics/page.tsx');
    const metricCard = read(
      'src/app/(dashboard)/lex/reports/analytics/_components/analytics-metric-card.tsx',
    );

    expect(source).toContain('from "./_components/analytics-metric-card"');
    // The KPI grid keeps the same compact base track list, but the widest
    // breakpoint follows SHOW_SATISFACTION_METRIC: six tiles when satisfaction
    // is shown, five when the flag hides it. Assert the base classes and both
    // branches so the grid can never drift out of sync with the tile count.
    expect(source).toContain(
      'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
    );
    expect(source).toContain(
      'SHOW_SATISFACTION_METRIC ? "xl:grid-cols-6" : "xl:grid-cols-5"',
    );
    expect(source).toContain('<AnalyticsMetricCard');
    expect(metricCard).toContain('onClick={onAction}');
    expect(metricCard).toContain('min-h-32');
    expect(metricCard).not.toContain('shadow-elevation-1 transition-shadow');
    expect(metricCard).not.toContain('helper={labels.metrics.');
  });

  it('renders permission-filtered command-center metrics through the balanced strip', () => {
    const source = read('src/app/(dashboard)/lex/_components/cross-domain-kpis.tsx');

    expect(source).toContain("from '@/components/lex/kpi-strip'");
    expect(source).toContain('<LexKpiStrip');
    expect(source).toContain('className="cross-domain-kpi-grid"');
    expect(source).not.toContain("from './command-ui'");
    expect(source).not.toContain('<StatBlock');
    expect(source).not.toContain('gap-4');
  });
});
