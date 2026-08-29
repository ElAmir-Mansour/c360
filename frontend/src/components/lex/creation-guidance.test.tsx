import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import { LexCreationGuidance } from './creation-guidance';

describe('LexCreationGuidance', () => {
  it('renders actionable English guidance in English mode', () => {
    render(
      <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
        <LexCreationGuidance workflow="contract" />
      </LocaleProvider>,
    );

    expect(screen.getByRole('note')).toHaveAttribute('data-lex-creation-guidance', 'contract');
    expect(screen.getByText('Use the source agreement as the reference')).toBeInTheDocument();
    expect(screen.getByText(/Upload the latest version/)).toBeInTheDocument();
  });

  it('renders the matching Arabic guidance in Arabic mode', () => {
    render(
      <LocaleProvider locale="ar" direction="rtl" messages={getMessages('ar')}>
        <LexCreationGuidance workflow="report" />
      </LocaleProvider>,
    );

    expect(screen.getByText('ابنِ التقرير حول قرار واحد')).toBeInTheDocument();
    expect(screen.getByText(/عاين النتيجة/)).toBeInTheDocument();
  });
});
