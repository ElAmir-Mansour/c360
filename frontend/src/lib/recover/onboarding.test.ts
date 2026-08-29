import { describe, it, expect, vi, beforeEach } from 'vitest';

import { apiDelete, apiPost } from '@/lib/api';
import {
  activateRecoverSubSolutions,
  removeRecoverDemoData,
  RECOVER_ONBOARDING_ACTIVATE_ENDPOINT,
  RECOVER_ONBOARDING_DEMO_DATA_ENDPOINT,
} from './onboarding';

vi.mock('@/lib/api', () => ({
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));

const mockPost = vi.mocked(apiPost);
const mockDelete = vi.mocked(apiDelete);

describe('recover onboarding client helpers', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  it('exposes the contract endpoints', () => {
    expect(RECOVER_ONBOARDING_ACTIVATE_ENDPOINT).toBe('/api/recover/onboarding/activate');
    expect(RECOVER_ONBOARDING_DEMO_DATA_ENDPOINT).toBe('/api/recover/onboarding/demo-data');
  });

  it('posts the selected sub-solutions to the activate endpoint', async () => {
    mockPost.mockResolvedValue({
      results: [
        {
          sub_solution: 'it-dr',
          activated: true,
          already_seeded: false,
          application_keys: ['demo-it-dr-core-banking'],
          application_count: 1,
          runbook_count: 1,
        },
      ],
    });

    const result = await activateRecoverSubSolutions(['it-dr', 'cloud-dr']);

    expect(mockPost).toHaveBeenCalledWith(RECOVER_ONBOARDING_ACTIVATE_ENDPOINT, {
      sub_solutions: ['it-dr', 'cloud-dr'],
    });
    expect(result.results[0].application_count).toBe(1);
  });

  it('calls the demo-data endpoint for removal', async () => {
    mockDelete.mockResolvedValue({ runbooks_removed: 3, applications_removed: 3 });

    const result = await removeRecoverDemoData();

    expect(mockDelete).toHaveBeenCalledWith(RECOVER_ONBOARDING_DEMO_DATA_ENDPOINT);
    expect(result.applications_removed).toBe(3);
    expect(result.runbooks_removed).toBe(3);
  });

  it('propagates an activation error', async () => {
    mockPost.mockRejectedValue(new Error('not entitled'));
    await expect(activateRecoverSubSolutions(['it-dr'])).rejects.toThrow('not entitled');
  });
});
