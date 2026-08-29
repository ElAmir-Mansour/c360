import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LexPlaybookPortfolioRow } from '@/types/suites';
import {
  PLAYBOOK_OK_THRESHOLD,
  PLAYBOOK_WARN_THRESHOLD,
  exportDeviationsForContracts,
  filterBelowPlaybookThreshold,
  isBelowPlaybookThreshold,
  normalizeComplianceScore,
  playbookComplianceTone,
} from './use-playbook-scores';

const { exportContractClauseDeviationsMock, downloadBlobMock } = vi.hoisted(() => ({
  exportContractClauseDeviationsMock: vi.fn(),
  downloadBlobMock: vi.fn(),
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    lex: {
      exportContractClauseDeviations: exportContractClauseDeviationsMock,
      getPlaybookPortfolio: vi.fn(),
    },
  },
}));

vi.mock('@/lib/format', () => ({
  downloadBlob: downloadBlobMock,
}));

function portfolioRow(
  overrides: Partial<LexPlaybookPortfolioRow> = {},
): LexPlaybookPortfolioRow {
  return {
    contract_id: 'c-1',
    contract_title: 'Master Services Agreement',
    contract_type: 'service_agreement',
    playbook_id: 'p-1',
    playbook_name: 'Standard MSA Playbook',
    compliance_score: 95,
    missing_count: 0,
    altered_count: 0,
    extra_count: 0,
    generated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  exportContractClauseDeviationsMock.mockReset();
  downloadBlobMock.mockReset();
});

describe('normalizeComplianceScore', () => {
  it('clamps and rounds onto the 0-100 integer scale', () => {
    expect(normalizeComplianceScore(89.6)).toBe(90);
    expect(normalizeComplianceScore(120)).toBe(100);
    expect(normalizeComplianceScore(-5)).toBe(0);
  });

  it('returns null for unset / non-finite values (off-playbook)', () => {
    expect(normalizeComplianceScore(null)).toBeNull();
    expect(normalizeComplianceScore(undefined)).toBeNull();
    expect(normalizeComplianceScore(Number.NaN)).toBeNull();
  });
});

describe('playbookComplianceTone', () => {
  it('classifies against the ok/warn/danger thresholds', () => {
    expect(playbookComplianceTone(100)).toBe('ok');
    expect(playbookComplianceTone(PLAYBOOK_OK_THRESHOLD)).toBe('ok');
    expect(playbookComplianceTone(PLAYBOOK_OK_THRESHOLD - 1)).toBe('warn');
    expect(playbookComplianceTone(PLAYBOOK_WARN_THRESHOLD)).toBe('warn');
    expect(playbookComplianceTone(PLAYBOOK_WARN_THRESHOLD - 1)).toBe('danger');
    expect(playbookComplianceTone(0)).toBe('danger');
  });

  it('maps missing scores to the neutral off-playbook tone', () => {
    expect(playbookComplianceTone(null)).toBe('none');
    expect(playbookComplianceTone(undefined)).toBe('none');
  });
});

describe('isBelowPlaybookThreshold', () => {
  it('is true only for scored contracts strictly below the threshold', () => {
    expect(isBelowPlaybookThreshold(89)).toBe(true);
    expect(isBelowPlaybookThreshold(PLAYBOOK_OK_THRESHOLD)).toBe(false);
    expect(isBelowPlaybookThreshold(null)).toBe(false);
    expect(isBelowPlaybookThreshold(undefined)).toBe(false);
  });

  it('honours a custom threshold', () => {
    expect(isBelowPlaybookThreshold(69, 70)).toBe(true);
    expect(isBelowPlaybookThreshold(70, 70)).toBe(false);
  });
});

describe('filterBelowPlaybookThreshold', () => {
  it('narrows rows to scored contracts below the threshold, excluding off-playbook rows', () => {
    const scoresById = new Map<string, LexPlaybookPortfolioRow>([
      ['a', portfolioRow({ contract_id: 'a', compliance_score: 95 })],
      ['b', portfolioRow({ contract_id: 'b', compliance_score: 62 })],
      ['c', portfolioRow({ contract_id: 'c', compliance_score: 88 })],
      // 'd' intentionally absent — off-playbook.
    ]);
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

    expect(filterBelowPlaybookThreshold(rows, scoresById).map((r) => r.id)).toEqual([
      'b',
      'c',
    ]);
    expect(filterBelowPlaybookThreshold(rows, scoresById, 70).map((r) => r.id)).toEqual([
      'b',
    ]);
  });
});

describe('exportDeviationsForContracts', () => {
  it('exports on-playbook selections, skips off-playbook rows, and counts failures', async () => {
    const scoresById = new Map<string, LexPlaybookPortfolioRow>([
      ['c-1', portfolioRow({ contract_id: 'c-1' })],
      ['c-2', portfolioRow({ contract_id: 'c-2', compliance_score: 55 })],
    ]);
    const blob = new Blob(['csv'], { type: 'text/csv' });
    exportContractClauseDeviationsMock.mockImplementation((id: string) =>
      id === 'c-1' ? Promise.resolve(blob) : Promise.reject(new Error('boom')),
    );

    const summary = await exportDeviationsForContracts(
      ['c-1', 'c-2', 'c-off'],
      scoresById,
    );

    expect(summary).toEqual({ exported: 1, skippedOffPlaybook: 1, failed: 1 });
    // Only on-playbook contracts hit the endpoint.
    expect(exportContractClauseDeviationsMock).toHaveBeenCalledTimes(2);
    expect(exportContractClauseDeviationsMock).not.toHaveBeenCalledWith('c-off');
    expect(downloadBlobMock).toHaveBeenCalledTimes(1);
    expect(downloadBlobMock).toHaveBeenCalledWith(blob, 'clause-deviations-c-1.csv');
  });
});
