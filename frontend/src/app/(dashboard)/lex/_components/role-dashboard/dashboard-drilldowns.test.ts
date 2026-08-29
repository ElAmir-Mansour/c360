import { describe, expect, it } from 'vitest';

import {
  contractStatusDrilldownHref,
  escalationDrilldownHref,
  kpiDrilldownHref,
  resolutionDrilldownHref,
  serviceDistributionHref,
  workforceDomainHref,
  workloadDrilldownHref,
} from './dashboard-drilldowns';

describe('dashboard drill-down routes', () => {
  it('maps every executive aggregate to an existing Lex register', () => {
    expect(kpiDrilldownHref('slaCompliance')).toBe('/lex/service-desk/sla-board');
    expect(kpiDrilldownHref('activeContracts')).toBe('/lex/contracts');
    expect(serviceDistributionHref('litigations')).toBe('/lex/cases');
    expect(serviceDistributionHref('other')).toBe('/lex/reports/analytics');
    expect(workloadDrilldownHref('renewals')).toBe('/lex/contracts');
    expect(resolutionDrilldownHref('legal_cases')).toBe('/lex/cases');
    expect(resolutionDrilldownHref('unknown')).toBe('/lex/reports/analytics');
    expect(workforceDomainHref('support')).toBe('/lex/inbox');
  });

  it('encodes filter values placed in drill-down query strings', () => {
    expect(contractStatusDrilldownHref('pending signature')).toBe(
      '/lex/contracts?status=pending%20signature',
    );
    expect(escalationDrilldownHref('high & urgent')).toBe(
      '/lex/inbox?severity=high%20%26%20urgent',
    );
  });
});
