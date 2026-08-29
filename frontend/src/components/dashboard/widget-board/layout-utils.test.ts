import { describe, expect, it } from 'vitest';

import {
  applyBoardPreset,
  buildDefaultLayout,
  createEmptyBoard,
  sanitizeUserBoard,
} from './layout-utils';

describe('dashboard board preferences', () => {
  it('migrates a legacy layout to safe role and decision defaults', () => {
    expect(
      sanitizeUserBoard({
        hidden: ['activity-timeline', 42],
        sized: [],
        layouts: {},
      }),
    ).toMatchObject({
      hidden: ['activity-timeline'],
      preset: 'recommended',
      scope: 'all',
      horizonDays: 30,
      alertThreshold: 'high',
    });
  });

  it('applies a role preset while clearing stale layout geometry', () => {
    const customized = {
      ...createEmptyBoard(),
      layouts: { lg: [{ i: 'my-tasks', x: 0, y: 0, w: 12, h: 40 }] },
    };

    const result = applyBoardPreset(customized, 'my-work');

    expect(result.preset).toBe('my-work');
    expect(result.hidden).toContain('suites-launcher');
    expect(result.layouts).toEqual({});
  });

  it('uses an intermediate multi-column layout on tablets', () => {
    const layout = buildDefaultLayout('md', ['recent-alerts', 'my-tasks']);

    expect(layout).toHaveLength(2);
    expect(layout.map((item) => item.w)).toEqual([4, 4]);
  });
});
