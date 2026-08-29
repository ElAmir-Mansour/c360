import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button';

describe('Button brand contract', () => {
  it('uses the approved green for the primary action state sequence', () => {
    const classes = buttonVariants({ variant: 'default' });

    expect(classes).toContain('bg-action');
    expect(classes).toContain('text-white');
    expect(classes).toContain('hover:bg-action-hover');
    expect(classes).toContain('active:bg-action-active');
  });

  it('uses the same approved green for CTA buttons', () => {
    const classes = buttonVariants({ variant: 'cta' });

    expect(classes).toContain('bg-action');
    expect(classes).toContain('text-white');
  });

  it('uses the exact canvas, tint, border and ink for quiet variants', () => {
    expect(buttonVariants({ variant: 'outline' })).toEqual(
      expect.stringContaining('border-clario-border'),
    );
    expect(buttonVariants({ variant: 'outline' })).toEqual(
      expect.stringContaining('bg-clario-canvas'),
    );
    expect(buttonVariants({ variant: 'secondary' })).toEqual(
      expect.stringContaining('bg-clario-tint'),
    );
    expect(buttonVariants({ variant: 'ghost' })).toEqual(
      expect.stringContaining('text-clario-ink'),
    );
  });

  it('uses the exact border and muted values instead of opacity for disabled controls', () => {
    const classes = buttonVariants({ variant: 'default' });

    expect(classes).toContain('disabled:bg-clario-border');
    expect(classes).toContain('disabled:text-clario-muted');
    expect(classes).toContain('disabled:opacity-100');
    expect(classes).not.toContain('disabled:opacity-50');
  });

  it('selects DIN Next Arabic through the RTL font token', () => {
    expect(buttonVariants()).toContain('rtl:font-arabic');
  });
});
