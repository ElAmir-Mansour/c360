import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { FaqAccordion, SAMPLE_FAQ_ITEMS, type FaqItem } from './faq-accordion';

const items: FaqItem[] = [
  { id: 'a', question: 'What is an RTO drill?', answer: 'A timed recovery rehearsal.' },
  { id: 'b', question: 'Where does data live?', answer: 'In your sovereign boundary.' },
  { id: 'c', question: 'Can steps be blocked?', answer: 'Yes, human gates can block a run.' },
];

describe('FaqAccordion', () => {
  it('renders all questions as accessible buttons that start collapsed', () => {
    renderWithQuery(<FaqAccordion items={items} heading="FAQ" />);

    const triggers = screen.getAllByRole('button');
    expect(triggers).toHaveLength(items.length);
    triggers.forEach((trigger) => {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('expands a panel via keyboard and toggles aria-expanded', async () => {
    const user = userEvent.setup();
    renderWithQuery(<FaqAccordion items={items} heading="FAQ" />);

    const first = screen.getByRole('button', { name: /What is an RTO drill/i });
    expect(first).toHaveAttribute('aria-expanded', 'false');

    // Keyboard activation: focus then Enter.
    first.focus();
    expect(first).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('A timed recovery rehearsal.')).toBeVisible();

    // Space collapses it again (single + collapsible).
    await user.keyboard(' ');
    expect(first).toHaveAttribute('aria-expanded', 'false');
  });

  it('navigates between triggers with ArrowDown (Radix roving focus)', async () => {
    const user = userEvent.setup();
    renderWithQuery(<FaqAccordion items={items} heading="FAQ" />);

    const [first, second] = screen.getAllByRole('button');
    first.focus();
    await user.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
  });

  it('allows multiple open panels in multiple mode', async () => {
    const user = userEvent.setup();
    renderWithQuery(<FaqAccordion type="multiple" items={items} heading="FAQ" />);

    const [first, second] = screen.getAllByRole('button');
    await user.click(first);
    await user.click(second);

    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(second).toHaveAttribute('aria-expanded', 'true');
  });

  it('associates a visible heading with the section landmark', () => {
    renderWithQuery(<FaqAccordion items={SAMPLE_FAQ_ITEMS} heading="ClarioDR recovery, answered" />);
    const region = screen.getByRole('region', { name: 'ClarioDR recovery, answered' });
    expect(region).toBeInTheDocument();
  });
});
