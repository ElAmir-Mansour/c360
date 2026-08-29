import { render, screen } from '@testing-library/react';
import { ShieldAlert } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/button';
import { PanelShell } from './panel-shell';

function allClasses(root: HTMLElement): string {
  return Array.from(root.querySelectorAll<HTMLElement>('[class]'))
    .concat(root)
    .map((element) => element.className)
    .join(' ');
}

describe('PanelShell', () => {
  it('renders an accessible section with caller-provided heading, description, icon, action, and body', () => {
    render(
      <PanelShell
        title="Escalation & Risk Warnings"
        description="Warnings requiring review"
        icon={ShieldAlert}
        action={<Button type="button">Open warnings</Button>}
      >
        <p>Panel body</p>
      </PanelShell>,
    );

    const region = screen.getByRole('region', { name: 'Escalation & Risk Warnings' });
    const heading = screen.getByRole('heading', { level: 2 });
    const description = screen.getByText('Warnings requiring review');

    expect(region.tagName).toBe('SECTION');
    expect(region).toHaveAttribute('aria-labelledby', heading.id);
    expect(region).toHaveAttribute('aria-describedby', description.id);
    expect(region).toHaveTextContent('Panel body');
    expect(region.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('button', { name: 'Open warnings' })).toBeInTheDocument();
  });

  it('binds panel chrome and typography to approved Watheeq tokens', () => {
    render(<PanelShell title="Panel title">Body</PanelShell>);

    const region = screen.getByRole('region', { name: 'Panel title' });
    const heading = screen.getByRole('heading', { name: 'Panel title' });
    const classes = allClasses(region);

    expect(region.className).toContain('bg-[var(--wt-surface)]');
    expect(region.className).toContain('border-[length:var(--wt-card-border-width)]');
    expect(region.className).toContain('border-[color:var(--wt-teal-300)]');
    expect(region.className).toContain('rounded-[var(--wt-radius-card)]');
    expect(region.className).toContain('shadow-[var(--wt-elevation)]');
    expect(heading.className).toContain('text-[length:var(--wt-font-size-panel-title)]');
    expect(heading.className).toContain('leading-[var(--wt-line-height-panel-title)]');
    expect(classes).toContain('text-[length:var(--wt-font-size-body)]');
    expect(classes).toContain('leading-[var(--wt-line-height-body)]');
    expect(classes).not.toMatch(/#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(/i);
  });

  it('uses logical RTL-safe utilities and supplies visible action focus treatment', () => {
    render(
      <PanelShell
        title="تنبيهات المخاطر"
        description="بيانات تتطلب المراجعة"
        action={<a href="#panel-details">عرض التفاصيل</a>}
      >
        المحتوى
      </PanelShell>,
    );

    const region = screen.getByRole('region', { name: 'تنبيهات المخاطر' });
    const classes = allClasses(region);

    expect(classes).toContain('ms-auto');
    expect(classes).toContain('text-start');
    expect(classes).toContain('[&_a:focus-visible]:ring-2');
    expect(classes).toContain('[&_a:focus-visible]:ring-[color:var(--wt-teal-700)]');
    expect(classes).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-/);
  });
});
