import { describe, expect, it, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { LexAccessDenied } from './lex-access-denied';
import {
  describeRequirement,
  findSwitchableRoles,
  requirementKeys,
} from './access-denied-utils';
import type { LegalRoleSummary } from './use-lex-access';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: replaceMock,
    refresh: refreshMock,
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const advisor: LegalRoleSummary = {
  slug: 'legal-advisor',
  name_en: 'Legal Advisor / Consultant',
  name_ar: 'المستشار القانوني',
  tier: 'Legal',
  org_unit: 'Advisory / Contracts',
  escalation_level: 0,
};

const casesManager: LegalRoleSummary = {
  slug: 'legal-cases-manager',
  name_en: 'Cases & Investigations Section Manager',
  name_ar: 'مدير قسم القضايا والتحقيقات',
  tier: 'Legal',
  org_unit: 'Legal Department',
  escalation_level: 0,
};

describe('access-denied-utils', () => {
  it('requirementKeys flattens string / anyOf / allOf', () => {
    expect(requirementKeys('lex:case:view')).toEqual(['lex:case:view']);
    expect(requirementKeys({ anyOf: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(requirementKeys({ allOf: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(requirementKeys(undefined)).toEqual([]);
  });

  it('describeRequirement joins anyOf with OR and allOf with AND', () => {
    const labels = { and: 'AND', or: 'OR' };
    expect(describeRequirement('lex:case:view', labels)).toBe('lex:case:view');
    expect(describeRequirement({ anyOf: ['a', 'b'] }, labels)).toBe('a OR b');
    expect(describeRequirement({ allOf: ['a', 'b'] }, labels)).toBe('a AND b');
  });

  it('findSwitchableRoles returns only OTHER held roles that grant the requirement', () => {
    const available = [advisor, casesManager];
    // Active = advisor (cannot view cases); cases-manager CAN view cases.
    const switchable = findSwitchableRoles('lex:case:view', available, 'legal-advisor');
    expect(switchable.map((r) => r.slug)).toEqual(['legal-cases-manager']);
  });

  it('findSwitchableRoles excludes the active role even if it would qualify', () => {
    const switchable = findSwitchableRoles(
      'lex:contract:view',
      [advisor, casesManager],
      'legal-advisor',
    );
    // advisor (active) is excluded; cases-manager has no contract:view.
    expect(switchable).toEqual([]);
  });
});

describe('LexAccessDenied', () => {
  it('shows the required permission and the active legal role', () => {
    renderWithQuery(
      <LexAccessDenied
        requirement="lex:case:view"
        resourceName="Litigation Cases"
        activeRole={advisor}
        availableRoles={[advisor]}
        accessState="READY"
      />,
    );

    expect(screen.getByTestId('lex-access-denied')).toBeInTheDocument();
    expect(screen.getByTestId('required-permission')).toHaveTextContent('lex:case:view');
    expect(screen.getByTestId('active-role')).toHaveTextContent(
      'Legal Advisor / Consultant',
    );
    // Headline names the blocked resource.
    expect(
      screen.getByText(/do not have access to Litigation Cases/i),
    ).toBeInTheDocument();
  });

  it('renders an anyOf requirement as an OR list', () => {
    renderWithQuery(
      <LexAccessDenied
        requirement={{ anyOf: ['lex:report:read', 'lex:audit:read'] }}
        activeRole={advisor}
        availableRoles={[advisor]}
      />,
    );
    expect(screen.getByTestId('required-permission')).toHaveTextContent(
      'lex:report:read OR lex:audit:read',
    );
  });

  it('offers a Switch persona affordance when another held role would grant access', async () => {
    const onSwitch = vi.fn().mockResolvedValue({});
    renderWithQuery(
      <LexAccessDenied
        requirement="lex:case:view"
        activeRole={advisor}
        availableRoles={[advisor, casesManager]}
        accessState="READY"
        onSwitchPersona={onSwitch}
      />,
    );

    const block = screen.getByTestId('switch-persona');
    expect(block).toBeInTheDocument();
    const button = screen.getByRole('button', {
      name: /Switch to Cases & Investigations Section Manager/i,
    });
    fireEvent.click(button);
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith('legal-cases-manager'));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('does NOT show Switch persona when no other held role qualifies', () => {
    renderWithQuery(
      <LexAccessDenied
        requirement="lex:case:view"
        activeRole={advisor}
        availableRoles={[advisor]}
        accessState="READY"
        onSwitchPersona={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('switch-persona')).not.toBeInTheDocument();
  });

  it('shows the no-legal-role message for NO_LEX_ROLE_ASSIGNED', () => {
    renderWithQuery(
      <LexAccessDenied
        requirement="lex:case:view"
        activeRole={null}
        availableRoles={[]}
        accessState="NO_LEX_ROLE_ASSIGNED"
      />,
    );
    expect(screen.queryByTestId('required-permission')).not.toBeInTheDocument();
    expect(screen.getByText(/not assigned any legal-affairs role/i)).toBeInTheDocument();
  });
});
