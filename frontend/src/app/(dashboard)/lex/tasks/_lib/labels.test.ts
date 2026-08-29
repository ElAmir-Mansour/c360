import { describe, expect, it } from 'vitest';

import { MANAGER_TASK_STATUS_ORDER, managerTasksCopy } from './labels';

describe('manager task labels', () => {
  it('covers every backend status in English and Arabic', () => {
    const en = managerTasksCopy('en');
    const ar = managerTasksCopy('ar');

    expect(Object.keys(en.status)).toEqual(MANAGER_TASK_STATUS_ORDER);
    expect(Object.keys(ar.status)).toEqual(MANAGER_TASK_STATUS_ORDER);
    for (const status of MANAGER_TASK_STATUS_ORDER) {
      expect(en.status[status].trim()).not.toBe('');
      expect(ar.status[status].trim()).not.toBe('');
      expect(ar.status[status]).not.toBe(en.status[status]);
    }
  });

  it('provides complete Arabic action and dialog copy for the RTL surface', () => {
    const ar = managerTasksCopy('ar');

    expect(ar.page.title).toBe('المهام');
    expect(ar.actions.start).toBeTruthy();
    expect(ar.actions.submit).toBeTruthy();
    expect(ar.actions.review).toBeTruthy();
    expect(ar.createDialog.assigneeLabel).toBeTruthy();
    expect(ar.reviewDialog.return).toBeTruthy();
  });
});
