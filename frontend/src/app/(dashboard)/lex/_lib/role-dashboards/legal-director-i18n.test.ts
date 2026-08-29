import { describe, expect, it } from 'vitest';

import {
  LEGAL_DIRECTOR_DASHBOARD_NAMESPACE,
  legalDirectorDashboardMessages,
  resolveLegalDirectorDashboardLabels,
} from './legal-director-i18n';
import { resolveLexLabels } from '../lex-i18n';
import {
  hasNamespace,
  readNamespaceMessage,
} from '@/lib/i18n/registry';

function fingerprint(value: unknown, path = ''): Record<string, string> {
  if (typeof value === 'function') return { [path]: `function:${value.length}` };
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, string>>((result, [key, child]) => {
        Object.assign(
          result,
          fingerprint(child, path ? `${path}.${key}` : key),
        );
        return result;
      }, {});
  }
  return { [path]: typeof value };
}

describe('Legal Director dashboard labels', () => {
  it('keeps the English and Arabic catalogue shapes identical', () => {
    expect(fingerprint(legalDirectorDashboardMessages.ar)).toEqual(
      fingerprint(legalDirectorDashboardMessages.en),
    );
  });

  it('registers static leaves in the dedicated namespace', () => {
    expect(hasNamespace(LEGAL_DIRECTOR_DASHBOARD_NAMESPACE)).toBe(true);
    expect(
      readNamespaceMessage(
        LEGAL_DIRECTOR_DASHBOARD_NAMESPACE,
        'en',
        'panels.escalations',
      ),
    ).toBe('Escalation & Risk Warnings');
    expect(
      readNamespaceMessage(
        LEGAL_DIRECTOR_DASHBOARD_NAMESPACE,
        'ar',
        'actions.retry',
      ),
    ).toBe('إعادة المحاولة');
  });

  it('leaves the Calendar panel title in the existing lex.calendar catalogue', () => {
    expect(
      readNamespaceMessage(
        LEGAL_DIRECTOR_DASHBOARD_NAMESPACE,
        'en',
        'panels.calendar',
      ),
    ).toBeUndefined();
  });

  it('resolves professional Arabic copy and preserves caller-formatted numerals', () => {
    const labels = resolveLegalDirectorDashboardLabels('ar');

    expect(labels.hero.roleEyebrow).toBe('المدير القانوني');
    expect(labels.window.sevenDays('٧')).toBe('٧ أيام');
    expect(labels.window.sevenDays('7')).toBe('7 أيام');
    expect(labels.values.warnings('١', true)).toBe('١ تنبيهًا');
  });

  it('does not assign a count or percentage unit to Active Consultations', () => {
    const label = resolveLegalDirectorDashboardLabels('en').kpis.activeConsultations;

    expect(label).toBe('Active Consultations');
    expect(label).not.toContain('%');
    expect(label.toLowerCase()).not.toContain('rate');
    expect(label.toLowerCase()).not.toContain('count');
  });

  it('reuses the canonical Lex domain labels instead of owning a duplicate map', () => {
    expect(resolveLegalDirectorDashboardLabels('en').domains).toEqual(
      resolveLexLabels('en').overview.domains,
    );
    expect(resolveLegalDirectorDashboardLabels('ar').domains).toEqual(
      resolveLexLabels('ar').overview.domains,
    );
  });

  it('keeps zero and empty state copy distinct', () => {
    const labels = resolveLegalDirectorDashboardLabels('en');

    expect(labels.states.escalations.zero).toBe('No warnings');
    expect(labels.states.escalations.empty).toBe('No warning data available');
    expect(labels.states.serviceRequests.zero).not.toBe(
      labels.states.serviceRequests.empty,
    );
    expect(labels.states.aiAgent.zero).not.toBe(labels.states.aiAgent.empty);
    expect(labels.states.calendar.zero).not.toBe(labels.states.calendar.empty);
  });
});
