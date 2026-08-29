import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  DashboardPrimitiveState,
  type DashboardPrimitiveStateProps,
} from './dashboard-primitive-state';

describe('DashboardPrimitiveState', () => {
  it('announces a caller-localized loading label and uses skeletons, never a spinner', () => {
    const { container } = render(
      <DashboardPrimitiveState state="loading" label="جارٍ تحميل بيانات اللوحة" />,
    );

    const state = screen.getByRole('status', { name: 'جارٍ تحميل بيانات اللوحة' });
    expect(state).toHaveAttribute('aria-busy', 'true');
    expect(state).toHaveAttribute('aria-live', 'polite');
    expect(state).toHaveTextContent('جارٍ تحميل بيانات اللوحة');
    expect(container.querySelectorAll('.skeleton-shimmer')).toHaveLength(3);
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  it('renders a localized empty state as a polite status', () => {
    render(
      <DashboardPrimitiveState
        state="empty"
        title="لا توجد تحذيرات"
        description="لم تُسجّل أي تحذيرات في هذه الفترة."
      />,
    );

    const state = screen.getByRole('status');
    expect(state).toHaveAttribute('aria-live', 'polite');
    expect(state).toHaveTextContent('لا توجد تحذيرات');
    expect(state).toHaveTextContent('لم تُسجّل أي تحذيرات في هذه الفترة.');
  });

  it('renders an assertive error with a localized retry action', () => {
    const onRetry = vi.fn();
    render(
      <DashboardPrimitiveState
        state="error"
        title="تعذّر تحميل البيانات"
        description="حاول مرة أخرى."
        retryLabel="إعادة المحاولة"
        onRetry={onRetry}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('تعذّر تحميل البيانات');
    const retry = screen.getByRole('button', { name: 'إعادة المحاولة' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(alert).toHaveClass(
      '[&_button]:bg-[var(--wt-teal-700)]',
      '[&_button]:text-[color:var(--wt-surface)]',
      '[&_button]:shadow-none',
    );
  });

  it('does not expose zero as a non-ready state', () => {
    type ZeroVariant = Extract<DashboardPrimitiveStateProps, { state: 'zero' }>;
    expectTypeOf<ZeroVariant>().toEqualTypeOf<never>();

    const validStates: DashboardPrimitiveStateProps['state'][] = [
      'loading',
      'empty',
      'error',
    ];
    expect(validStates).not.toContain('zero');
  });
});
