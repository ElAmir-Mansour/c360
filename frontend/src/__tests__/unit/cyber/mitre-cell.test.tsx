import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MitreCell } from '@/app/(dashboard)/cyber/mitre/_components/mitre-cell';
import type { MITRETechniqueCoverage } from '@/types/cyber';

// TooltipProvider requires wrapping
import { TooltipProvider } from '@/components/ui/tooltip';

function wrap(ui: React.ReactNode) {
  return render(<TooltipProvider>{ui}</TooltipProvider>);
}

function makeTech(overrides: Partial<MITRETechniqueCoverage> = {}): MITRETechniqueCoverage {
  return {
    technique_id: 'T1059',
    technique_name: 'Command and Scripting Interpreter',
    tactic_ids: ['TA0002'],
    tactic_id: 'TA0002',
    tactic_name: 'Execution',
    rule_count: 0,
    alert_count: 0,
    threat_count: 0,
    active_threat_count: 0,
    has_detection: false,
    coverage_state: 'idle',
    high_fp_rule_count: 0,
    description: 'Adversaries may abuse scripting interpreters.',
    platforms: ['Windows', 'Linux'],
    ...overrides,
  };
}

describe('MitreCell', () => {
  it('renders covered state with primary brand background', () => {
    const tech = makeTech({ coverage_state: 'covered', rule_count: 2, alert_count: 5, has_detection: true });
    const { container } = wrap(
      <MitreCell technique={tech} selected={false} highlighted={false} onSelect={vi.fn()} />,
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('bg-primary/10');
    expect(btn?.className).toContain('border-primary/30');
  });

  it('renders noisy state with amber background', () => {
    const tech = makeTech({ coverage_state: 'noisy', rule_count: 1, alert_count: 0, has_detection: true, high_fp_rule_count: 1 });
    const { container } = wrap(
      <MitreCell technique={tech} selected={false} highlighted={false} onSelect={vi.fn()} />,
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('bg-warning-50');
    expect(btn?.className).toContain('border-warning-300');
  });

  it('renders gap state with red background and warning icon', () => {
    const tech = makeTech({ coverage_state: 'gap', rule_count: 0, alert_count: 0, has_detection: false, active_threat_count: 1 });
    const { container } = wrap(
      <MitreCell technique={tech} selected={false} highlighted={false} onSelect={vi.fn()} />,
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('bg-error-50');
    expect(btn?.className).toContain('border-error-300');
    // Warning icon (AlertTriangle) should be present for gap state
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders idle state with muted secondary background', () => {
    const tech = makeTech({ coverage_state: 'idle' });
    const { container } = wrap(
      <MitreCell technique={tech} selected={false} highlighted={false} onSelect={vi.fn()} />,
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('bg-secondary');
    expect(btn?.className).toContain('border-primary/15');
  });

  it('fires onSelect callback on click', () => {
    const onSelect = vi.fn();
    const tech = makeTech({ coverage_state: 'covered', rule_count: 1, alert_count: 1, has_detection: true });
    const { container } = wrap(
      <MitreCell technique={tech} selected={false} highlighted={false} onSelect={onSelect} />,
    );
    const btn = container.querySelector('button');
    fireEvent.click(btn!);
    expect(onSelect).toHaveBeenCalledWith(tech);
  });

  it('renders technique ID', () => {
    const tech = makeTech({ technique_id: 'T1059' });
    wrap(<MitreCell technique={tech} selected={false} highlighted={false} onSelect={vi.fn()} />);
    expect(screen.getByText('T1059')).toBeTruthy();
  });

  it('renders technique name', () => {
    const tech = makeTech({ technique_name: 'Command and Scripting Interpreter' });
    wrap(<MitreCell technique={tech} selected={false} highlighted={false} onSelect={vi.fn()} />);
    expect(screen.getByText('Command and Scripting Interpreter')).toBeTruthy();
  });

  it('applies selected ring when selected', () => {
    const tech = makeTech({ coverage_state: 'covered' });
    const { container } = wrap(
      <MitreCell technique={tech} selected={true} highlighted={false} onSelect={vi.fn()} />,
    );
    const btn = container.querySelector('button');
    expect(btn?.className).toContain('ring-2');
    expect(btn?.className).toContain('ring-primary');
  });
});
