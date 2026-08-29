import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getLocaleDirection, type AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';
import { KpiLiveAnnouncer, type KpiAnnouncementItem } from './kpi-live-announcer';

function Announcer({ locale = 'en', items }: { locale?: AppLocale; items: KpiAnnouncementItem[] }) {
  return (
    <LocaleProvider
      locale={locale}
      direction={getLocaleDirection(locale)}
      messages={getMessages(locale)}
    >
      <KpiLiveAnnouncer items={items} throttleMs={500} />
    </LocaleProvider>
  );
}

describe('KpiLiveAnnouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not announce the initial load and groups rapid KPI changes', () => {
    const { rerender } = render(
      <Announcer items={[{ id: 'tasks', label: 'Pending tasks', value: 1 }]} />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('');

    rerender(
      <Announcer
        items={[
          { id: 'tasks', label: 'Pending tasks', value: 2 },
          { id: 'alerts', label: 'Open alerts', value: 3 },
        ]}
      />,
    );
    rerender(
      <Announcer
        items={[
          { id: 'tasks', label: 'Pending tasks', value: 4 },
          { id: 'alerts', label: 'Open alerts', value: 5 },
        ]}
      />,
    );

    act(() => vi.advanceTimersByTime(499));
    expect(status).toHaveTextContent('');
    act(() => vi.advanceTimersByTime(1));
    expect(status).toHaveTextContent('Dashboard updated. Pending tasks: 4; Open alerts: 5.');
  });

  it('announces with Arabic copy and Arabic-Indic numerals', () => {
    const { rerender } = render(
      <Announcer locale="ar" items={[{ id: 'tasks', label: 'المهام المعلقة', value: 1 }]} />,
    );

    rerender(
      <Announcer locale="ar" items={[{ id: 'tasks', label: 'المهام المعلقة', value: 3 }]} />,
    );
    act(() => vi.advanceTimersByTime(500));

    expect(screen.getByRole('status')).toHaveTextContent(
      'تم تحديث لوحة المعلومات. المهام المعلقة: ٣',
    );
  });
});
