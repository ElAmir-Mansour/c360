import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { AnalyticsLabels } from './analytics-labels';
import type { WorkloadMatrix } from './use-legal-ops-analytics';
import { WorkloadHeatmap } from './workload-heatmap';

const labels: AnalyticsLabels['heatmap'] = {
  title: 'Workload',
  description: 'Workload by officer and practice area',
  officer: 'Officer',
  practiceArea: 'Practice area',
  total: 'Total',
  legendLight: 'Light',
  legendHeavy: 'Heavy',
  cellTooltip: (officer, area, count) => `${officer} / ${area}: ${count}`,
  unassigned: 'Unassigned',
  empty: 'Empty',
  emptyHint: 'No cases',
  showActiveOnly: 'Active only',
};

const matrix: WorkloadMatrix = {
  officers: [
    { id: 'officer-1', label: 'Ali', total: 2, active: 2, caseIds: ['case-1', 'case-2'] },
    { id: '__unassigned__', label: 'Unassigned', total: 1, active: 1, caseIds: ['case-3'] },
  ],
  areas: [
    { key: 'commercial', label: 'Commercial', total: 2, caseIds: ['case-1', 'case-2'] },
    { key: '__unassigned__', label: 'Unassigned', total: 1, caseIds: ['case-3'] },
  ],
  cells: new Map([
    [
      'officer-1',
      new Map([
        ['commercial', { count: 2, active: 2, caseIds: ['case-1', 'case-2'] }],
        ['__unassigned__', { count: 0, active: 0, caseIds: [] }],
      ]),
    ],
    [
      '__unassigned__',
      new Map([
        ['commercial', { count: 0, active: 0, caseIds: [] }],
        ['__unassigned__', { count: 1, active: 1, caseIds: ['case-3'] }],
      ]),
    ],
  ]),
  max: 2,
  maxActive: 2,
};

describe('WorkloadHeatmap drilldowns', () => {
  it('links each number to the exact active case scope, including unassigned buckets', () => {
    renderWithQuery(<WorkloadHeatmap matrix={matrix} labels={labels} />);

    const scopedCell = screen.getByRole('gridcell', { name: 'Ali / Commercial: 2' });
    expect(scopedCell).toHaveAttribute('href', expect.stringContaining('handling_officer_id=officer-1'));
    expect(scopedCell).toHaveAttribute('href', expect.stringContaining('case_type=commercial'));
    expect(scopedCell.getAttribute('href')?.match(/status=/g)).toHaveLength(6);

    const unassignedCell = screen.getByRole('gridcell', { name: 'Unassigned / Unassigned: 1' });
    expect(unassignedCell).toHaveAttribute('href', expect.stringContaining('handling_officer_unassigned=true'));
    expect(unassignedCell).toHaveAttribute('href', expect.stringContaining('case_type_unassigned=true'));

    expect(screen.getByRole('gridcell', { name: 'Total / Total: 3' })).toHaveAttribute(
      'href',
      expect.stringContaining('/lex/cases?'),
    );
  });
});
