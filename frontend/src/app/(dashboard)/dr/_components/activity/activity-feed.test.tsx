import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, within } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRAttestationLedgerEntry, DRFailoverStep } from '@/types/clario-dr';
import { ledgerToActivity } from '../../_lib/collaboration';
import { ActivityFeed } from './activity-feed';
import { activityFeedLabels } from './activity-feed-labels';

/**
 * Tests for the war-room ActivityFeed — the immutable decision/action record.
 *
 * Every fixture uses the REAL `DRAttestationLedgerEntry` / `DRFailoverStep`
 * shapes from `@/types/clario-dr` (no invented fields), and the events are
 * produced by the same foundation selector `ledgerToActivity()` the war-room
 * uses, so the test exercises the real merge + ordering path. `next/link`
 * renders a plain anchor under jsdom, so no router mock is required; the feed
 * pulls the locale from the `renderWithQuery` LocaleProvider.
 */

const RUN_ID = 'run-live-777';

function ledgerEntry(overrides: Partial<DRAttestationLedgerEntry> = {}): DRAttestationLedgerEntry {
  return {
    id: 'led-1',
    tenant_id: 't1',
    seq: 1,
    entry_type: 'failover_attestation',
    subject_id: RUN_ID,
    payload: { actor: 'alice@clario.dev' },
    payload_hash: 'aa11',
    prev_hash: '0000',
    entry_hash: 'bb22',
    anchored_root: null,
    created_at: '2026-06-14T10:00:00Z',
    ...overrides,
  };
}

function step(overrides: Partial<DRFailoverStep> = {}): DRFailoverStep {
  return {
    id: 'step-1',
    run_id: RUN_ID,
    step: 'execute',
    status: 'completed',
    started_at: '2026-06-14T09:30:00Z',
    finished_at: '2026-06-14T09:31:00Z',
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('ActivityFeed (decision & action record)', () => {
  it('renders ledger + step events newest-first with actor and verb', () => {
    // Ledger entry (10:00) is newer than the step (09:31) => ledger row first.
    const entries = [ledgerEntry()];
    const steps = [step()];
    const events = ledgerToActivity(entries, steps);

    renderWithQuery(<ActivityFeed events={events} />);

    const feed = screen.getByTestId('run-activity-feed');
    const rows = within(feed).getAllByRole('listitem');
    expect(rows).toHaveLength(2);

    // Newest (ledger) first: real actor + human verb for the entry type.
    expect(within(rows[0]).getByText('alice@clario.dev')).toBeInTheDocument();
    expect(within(rows[0]).getByText('sealed a failover attestation')).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute('data-source', 'ledger');

    // Older (step) second: human verb for the step token.
    expect(within(rows[1]).getByText('executed the failover')).toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('data-source', 'step');

    // Count badge reflects the merged total.
    expect(within(feed).getByText(`2 ${activityFeedLabels.en.eventsBadge}`)).toBeInTheDocument();
  });

  it('attributes an actor-less ledger entry to the system actor', () => {
    // Payload carries no actor/acted_by => the selector falls back to 'system'.
    const events = ledgerToActivity([ledgerEntry({ payload: { note: 'no actor here' } })], []);

    renderWithQuery(<ActivityFeed events={events} />);

    const feed = screen.getByTestId('run-activity-feed');
    expect(within(feed).getByText(/^system$/)).toBeInTheDocument();
    expect(within(feed).queryByText('alice@clario.dev')).not.toBeInTheDocument();
  });

  it('exposes a ledger deep-link on ledger events scoped to the subject', () => {
    const events = ledgerToActivity([ledgerEntry()], []);

    renderWithQuery(<ActivityFeed events={events} />);

    const link = screen.getByRole('link', { name: new RegExp(activityFeedLabels.en.ledgerLinkLabel, 'i') });
    expect(link).toHaveAttribute(
      'href',
      `/dr/prove/ledger?subject=${encodeURIComponent(RUN_ID)}`,
    );
  });

  it('does not render a ledger link for step-sourced events', () => {
    const events = ledgerToActivity([], [step()]);

    renderWithQuery(<ActivityFeed events={events} />);

    expect(
      screen.queryByRole('link', { name: new RegExp(activityFeedLabels.en.ledgerLinkLabel, 'i') }),
    ).not.toBeInTheDocument();
  });

  it('renders an honest empty state when there is no activity', () => {
    renderWithQuery(<ActivityFeed events={[]} />);

    expect(screen.getByText(activityFeedLabels.en.emptyTitle)).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('renders an error state with a retry handler', () => {
    const onRetry = vi.fn();
    renderWithQuery(<ActivityFeed events={[]} errored onRetry={onRetry} />);

    expect(screen.getByText(activityFeedLabels.en.loadError)).toBeInTheDocument();
  });

  it('resolves the feed chrome to professional MSA under the Arabic locale', () => {
    const events = ledgerToActivity([ledgerEntry()], []);

    renderWithQuery(<ActivityFeed events={events} />, { locale: 'ar' });

    const feed = screen.getByTestId('run-activity-feed');
    // Heading + ledger deep-link label come from the bilingual bundle's `ar` side.
    expect(within(feed).getByText(activityFeedLabels.ar.heading)).toBeInTheDocument();
    expect(
      within(feed).getByRole('link', { name: new RegExp(activityFeedLabels.ar.ledgerLinkLabel) }),
    ).toBeInTheDocument();
    // The English chrome must not leak through in Arabic mode.
    expect(within(feed).queryByText(activityFeedLabels.en.heading)).not.toBeInTheDocument();
    // The subject id stays in an explicit LTR run inside the RTL feed.
    const subject = within(feed).getByTitle(RUN_ID);
    expect(subject).toHaveAttribute('dir', 'ltr');
  });
});
