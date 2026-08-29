import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';

import { ProgressBar, ProgressBarSkeleton } from './progress-bar';

function fillOf(container: HTMLElement): HTMLElement {
  const fill = container.querySelector<HTMLElement>('[data-progress-fill]');
  if (!fill) throw new Error('Progress fill is missing');
  return fill;
}

describe('ProgressBar', () => {
  it('exposes caller-supplied localized semantics and raw values', () => {
    const { container } = renderWithQuery(
      <ProgressBar label="Critical: 13 of 31" value={13} max={31} tone="critical" />,
    );

    const progress = screen.getByRole('progressbar', { name: 'Critical: 13 of 31' });
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuenow', '13');
    expect(progress).toHaveAttribute('aria-valuemax', '31');
    expect(progress).toHaveAttribute('data-value', '13');
    expect(progress).toHaveAttribute('data-max', '31');
    expect(Number.parseFloat(fillOf(container).style.inlineSize)).toBeCloseTo(41.935, 2);
  });

  it('renders a zero/max-zero input without division artifacts', () => {
    const { container } = renderWithQuery(
      <ProgressBar label="No workload" value={0} max={0} tone="optimal" />,
    );

    expect(fillOf(container)).toHaveStyle({ inlineSize: '0%' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '0');
  });

  it('clamps only the visual fill while preserving over-limit data', () => {
    const { container } = renderWithQuery(
      <ProgressBar label="Capacity exceeded" value={18} max={15} tone="critical" />,
    );

    expect(fillOf(container)).toHaveStyle({ inlineSize: '100%' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '15');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', 'Capacity exceeded');
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-value', '18');
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-max', '15');
  });

  it('clamps negative visual fill without changing the provided value', () => {
    const { container } = renderWithQuery(
      <ProgressBar label="Negative source value" value={-1} max={15} tone="medium" />,
    );

    expect(fillOf(container)).toHaveStyle({ inlineSize: '0%' });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('progressbar')).toHaveAttribute('data-value', '-1');
  });

  it('supports all escalation and workload tones through generated tokens', () => {
    const styleSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/progress-bar.module.css',
      ),
      'utf8',
    );

    expect(styleSource).toMatch(/\.critical\s*{[^}]*var\(--wt-critical\)/);
    expect(styleSource).toMatch(/\.high\s*{[^}]*var\(--wt-high\)/);
    expect(styleSource).toMatch(/\.medium\s*{[^}]*var\(--wt-medium\)/);
    expect(styleSource).toMatch(/\.optimal\s*{[^}]*var\(--wt-ok\)/);
  });

  it('uses the workload track by default and exposes the Figma escalation size', () => {
    const { unmount } = renderWithQuery(
      <ProgressBar label="Workload" value={1} max={2} tone="optimal" />,
    );

    expect(screen.getByRole('progressbar').className).not.toContain('escalationSize');

    unmount();
    renderWithQuery(
      <ProgressBar
        label="Escalation severity"
        value={1}
        max={2}
        tone="medium"
        size="escalation"
      />,
    );

    expect(screen.getByRole('progressbar').className).toContain('escalationSize');
  });

  it('provides a localized loading companion', () => {
    renderWithQuery(<ProgressBarSkeleton label="Loading workload" />);

    expect(screen.getByLabelText('Loading workload')).toHaveAttribute('aria-busy', 'true');
  });

  it('uses logical sizing, generated color tokens, and no embedded copy', () => {
    const componentSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/progress-bar.tsx',
      ),
      'utf8',
    );
    const styleSource = readFileSync(
      join(
        process.cwd(),
        'src/app/(dashboard)/lex/_components/role-dashboard/widgets/progress-bar.module.css',
      ),
      'utf8',
    );
    const sources = `${componentSource}\n${styleSource}`;

    expect(componentSource).toContain('inlineSize');
    expect(styleSource).toContain('inline-size');
    expect(sources).not.toMatch(/#[\da-f]{3,8}/i);
    expect(componentSource).not.toMatch(/>\s*[A-Za-z][^<{]*</);
  });
});
