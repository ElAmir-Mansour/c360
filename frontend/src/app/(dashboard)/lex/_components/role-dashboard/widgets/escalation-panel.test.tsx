import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';

import {
  EscalationPanel,
  EscalationPanelState,
  type EscalationPanelProps,
} from './escalation-panel';

const levels = [
  { level: 'critical', count: 13, href: '/lex/inbox?severity=critical' },
  { level: 'high', count: 31, href: '/lex/inbox?severity=high' },
  { level: 'medium', count: 1, href: '/lex/inbox?severity=medium' },
] satisfies EscalationPanelProps['levels'];

function fillFor(progressbar: HTMLElement): HTMLElement {
  const fill = progressbar.querySelector<HTMLElement>('[data-progress-fill]');
  if (!fill) throw new Error('Progress fill is missing');
  return fill;
}

describe('EscalationPanel', () => {
  it('uses the largest supplied level as the bar denominator, never totalLabel', () => {
    renderWithQuery(<EscalationPanel levels={levels} totalLabel="45 warnings" />);

    const critical = screen.getByRole('progressbar', { name: 'Critical: 13' });
    const high = screen.getByRole('progressbar', { name: 'High: 31' });
    const medium = screen.getByRole('progressbar', { name: 'Medium: 1' });

    expect(Number.parseFloat(fillFor(critical).style.inlineSize)).toBeCloseTo(41.935, 2);
    expect(fillFor(high)).toHaveStyle({ inlineSize: '100%' });
    expect(Number.parseFloat(fillFor(medium).style.inlineSize)).toBeCloseTo(3.226, 2);
    expect(screen.getByText('45 warnings')).toBeVisible();
    expect(screen.getByRole('link', { name: /Open Critical: 13/ })).toHaveAttribute(
      'href',
      '/lex/inbox?severity=critical',
    );
  });

  it('preserves partial arrays and a supplied total label without deriving either', () => {
    renderWithQuery(
      <EscalationPanel
        levels={[{ level: 'medium', count: 2, href: '/lex/inbox?severity=medium' }]}
        totalLabel="99 warnings"
      />,
    );

    expect(screen.getByRole('progressbar', { name: 'Medium: 2' })).toBeVisible();
    expect(screen.queryByText('Critical')).not.toBeInTheDocument();
    expect(screen.getByText('99 warnings')).toBeVisible();
  });

  it('renders an empty array as the localized empty state', () => {
    renderWithQuery(<EscalationPanel levels={[]} totalLabel="0 warnings" />);

    expect(screen.getByText('No warning data available')).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('keeps numeric zero in the ready state', () => {
    renderWithQuery(
      <EscalationPanel
        levels={[
          { level: 'critical', count: 0, href: '/lex/inbox?severity=critical' },
          { level: 'high', count: 0, href: '/lex/inbox?severity=high' },
        ]}
        totalLabel="0 warnings"
      />,
    );

    expect(screen.queryByText('No warning data available')).not.toBeInTheDocument();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0 warnings')).toBeVisible();
  });

  it('provides a localized accessible table equivalent', () => {
    renderWithQuery(<EscalationPanel levels={levels.slice(0, 2)} totalLabel="44 warnings" />);

    const table = screen.getByRole('table', {
      name: 'Escalation & Risk Warnings data table',
    });
    expect(within(table).getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Count' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('formats numbers and labels for Arabic while preserving input order', () => {
    renderWithQuery(
      <EscalationPanel levels={levels.slice(0, 2)} totalLabel="٤٤ تنبيهًا" />,
      { locale: 'ar' },
    );

    expect(screen.getByRole('heading', { name: 'تنبيهات التصعيد والمخاطر' })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'حرجة: ١٣' })).toBeVisible();
    expect(screen.getByRole('progressbar', { name: 'عالية: ٣١' })).toBeVisible();
  });

  it('exports loading, empty, and retryable error companions', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { unmount } = renderWithQuery(<EscalationPanelState state="loading" />);

    expect(screen.getByRole('status', { name: 'Loading warnings' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    unmount();
    const empty = renderWithQuery(<EscalationPanelState state="empty" />);
    expect(screen.getByText('No warning data available')).toBeVisible();

    empty.unmount();
    renderWithQuery(<EscalationPanelState state="error" onRetry={onRetry} />);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('contains no color literals, shadows, physical-direction CSS, or embedded copy', () => {
    const componentSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/escalation-panel.tsx',
      ),
      'utf8',
    );
    const styleSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/escalation-panel.module.css',
      ),
      'utf8',
    );
    const sources = `${componentSource}\n${styleSource}`;

    expect(sources).not.toMatch(/#[\da-f]{3,8}/i);
    expect(styleSource).not.toMatch(/box-shadow/i);
    expect(styleSource).not.toMatch(/(?:margin|padding|inset|border)-(?:left|right)/i);
    expect(styleSource).not.toMatch(/text-align:\s*(?:left|right)/i);
    expect(componentSource).not.toMatch(/>[ \t]*[A-Za-z][^<{\r\n]*</);
  });
});
