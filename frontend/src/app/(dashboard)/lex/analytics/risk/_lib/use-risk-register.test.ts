import { describe, expect, it } from 'vitest';

import { buildRiskRegister, type RawDomainRecord } from './use-risk-register';
import type {
  LexContract,
  LexObligation,
  LexComplianceAlert,
  LexComplianceRule,
} from '@/types/suites';

/* Minimal fixtures — the builder reads only a handful of fields, so we cast
 * partials rather than construct full domain records. */
const contract = (over: Partial<LexContract>): LexContract =>
  ({ id: 'c1', title: 'Master Services Agreement', type: 'services', status: 'active', ...over } as unknown as LexContract);

const obligation = (over: Partial<LexObligation>): LexObligation =>
  ({ id: 'o', title: 'Obligation', status: 'open', priority: 'medium', contract_id: 'c1', days_until_due: 10, owner_name: 'Ada' , ...over } as unknown as LexObligation);

const rule = (over: Partial<LexComplianceRule>): LexComplianceRule =>
  ({ id: 'r', name: 'Rule', enabled: true, contract_types: [], severity: 'medium', ...over } as unknown as LexComplianceRule);

const alert = (over: Partial<LexComplianceAlert>): LexComplianceAlert =>
  ({ id: 'a', title: 'Alert', contract_id: 'c1', status: 'open', severity: 'high', ...over } as unknown as LexComplianceAlert);

const raw = (over: Partial<RawDomainRecord>): RawDomainRecord => ({ id: 'x', ...over });

function emptyInputs() {
  return {
    contracts: [], obligations: [], rules: [], alerts: [],
    cases: [], requests: [], investigations: [], consultations: [], settlements: [],
  };
}

describe('buildRiskRegister — relationship fan-out', () => {
  it('joins a contract to its obligations and controls with failing counts', () => {
    const { records } = buildRiskRegister({
      ...emptyInputs(),
      contracts: [contract({ id: 'c1', risk_level: 'high', type: 'nda', total_value: 1000 })],
      obligations: [
        obligation({ id: 'o1', contract_id: 'c1', status: 'open', days_until_due: 5 }),
        obligation({ id: 'o2', contract_id: 'c1', status: 'open', days_until_due: -3 }), // overdue
        obligation({ id: 'o3', contract_id: 'c1', status: 'completed', days_until_due: 2 }), // not open
        obligation({ id: 'o4', contract_id: 'other', status: 'open', days_until_due: 1 }), // other contract
      ],
      // 7 applicable controls: 5 scoped to nda + 2 all-types; 1 disabled (ignored)
      rules: [
        ...Array.from({ length: 5 }, (_, i) => rule({ id: `r${i}`, contract_types: ['nda'] })),
        rule({ id: 'rAllA', contract_types: [] }),
        rule({ id: 'rAllB', contract_types: [] }),
        rule({ id: 'rOff', contract_types: ['nda'], enabled: false }),
        rule({ id: 'rOther', contract_types: ['services'] }), // not applicable to nda
      ],
      alerts: [
        alert({ id: 'a1', contract_id: 'c1', status: 'open' }),
        alert({ id: 'a2', contract_id: 'c1', status: 'investigating' }),
        alert({ id: 'a3', contract_id: 'c1', status: 'resolved' }), // not failing
      ],
    });

    const c = records.find((r) => r.id === 'c1');
    expect(c).toBeTruthy();
    expect(c!.relationsAvailable).toBe(true);
    expect(c!.severity).toBe('high');
    expect(c!.obligationOpen).toBe(2); // o1, o2
    expect(c!.obligationOverdue).toBe(1); // o2
    expect(c!.controlCount).toBe(7); // 5 nda + 2 all-types (disabled + non-applicable excluded)
    expect(c!.failingCount).toBe(2); // a1, a2 (a3 resolved)
    expect(c!.compliance).toBe('at_risk'); // >=2 failing
    expect(c!.obligations).toHaveLength(2);
    expect(c!.controls).toHaveLength(2);
  });

  it('promotes a critical contract severity from score >= 85', () => {
    const { records } = buildRiskRegister({
      ...emptyInputs(),
      contracts: [contract({ id: 'c1', risk_score: 92, risk_level: 'high' })],
    });
    expect(records[0].severity).toBe('critical');
  });

  it('normalizes non-contract domains and marks them relation-less', () => {
    const { records, summary } = buildRiskRegister({
      ...emptyInputs(),
      cases: [raw({ id: 'k1', title: 'Al-Othaim v. Supplier', risk_rating: 'critical' })],
      requests: [raw({ id: 'q1', title: 'Refund', priority: 'urgent' })],
      consultations: [raw({ id: 's1', title: 'Advice', priority: 'low', sla_status: 'breached' })],
      settlements: [raw({ id: 't1', title: 'Vendor settlement', value: 5000 })],
    });

    const kase = records.find((r) => r.id === 'k1')!;
    expect(kase.domain).toBe('case');
    expect(kase.severity).toBe('critical');
    expect(kase.relationsAvailable).toBe(false);
    expect(kase.obligationOpen).toBe(0);

    expect(records.find((r) => r.id === 'q1')!.severity).toBe('critical'); // urgent -> critical
    expect(records.find((r) => r.id === 's1')!.severity).toBe('high'); // sla breach bump
    const settlement = records.find((r) => r.id === 't1')!;
    expect(settlement.severity).toBe('none');
    expect(settlement.value).toBe(5000);

    expect(summary.byDomain.case).toBe(1);
    expect(summary.byDomain.settlement).toBe(1);
    expect(summary.criticalHigh).toBe(3); // case + request (critical) + consultation (high)
  });

  it('ranks critical/high and failing-heavy records first', () => {
    const { records } = buildRiskRegister({
      ...emptyInputs(),
      contracts: [
        contract({ id: 'low', risk_level: 'low' }),
        contract({ id: 'crit', risk_level: 'critical' }),
      ],
    });
    expect(records[0].id).toBe('crit');
  });
});
