import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocaleProvider, useLocale } from './locale-provider';
import { getMessages } from '@/lib/i18n/messages';

function LocaleProbe() {
  const { direction, locale, t } = useLocale();

  return (
    <output dir={direction}>
      {locale}:{t('shell.skipToMain')}
    </output>
  );
}

describe('LocaleProvider', () => {
  it('exposes English shell copy with LTR direction', () => {
    render(
      <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
        <LocaleProbe />
      </LocaleProvider>,
    );

    expect(screen.getByText('en:Skip to main content')).toHaveAttribute('dir', 'ltr');
  });

  it('exposes Arabic shell copy with RTL direction', () => {
    render(
      <LocaleProvider locale="ar" direction="rtl" messages={getMessages('ar')}>
        <LocaleProbe />
      </LocaleProvider>,
    );

    expect(screen.getByText('ar:تخطي إلى المحتوى الرئيسي')).toHaveAttribute('dir', 'rtl');
  });
});
