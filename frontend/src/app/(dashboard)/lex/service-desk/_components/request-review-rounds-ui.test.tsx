import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import {
  lexRequestsApi,
  type LegalRequestAttachment,
  type RequestNote,
  type SLAClock,
} from '@/lib/lex/requests';
import { RequestAttachmentsPanel } from './request-attachments-panel';
import { RequestNoteComposer } from './request-note-composer';
import { SlaHeroRibbon } from './sla-hero-ribbon';
import { SlaPanel } from './sla-panel';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

function renderInEnglish(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </LocaleProvider>,
  );
}

function note(id: string, cycle: number, body: string): RequestNote {
  return {
    id,
    tenant_id: 'tenant-1',
    request_id: 'request-1',
    cycle,
    body,
    mentions: [],
    author_id: `author-${cycle}`,
    author_name: cycle === 1 ? 'Business requester' : 'Legal reviewer',
    created_at: `2026-07-0${cycle}T09:00:00.000Z`,
    updated_at: `2026-07-0${cycle}T09:00:00.000Z`,
  };
}

function attachment(
  id: string,
  cycle: number,
  originalName: string,
  virusScanStatus = 'clean',
): LegalRequestAttachment {
  return {
    id,
    tenant_id: 'tenant-1',
    legal_request_id: 'request-1',
    cycle,
    file_id: `file-${id}`,
    original_name: originalName,
    content_type: 'application/pdf',
    size_bytes: 1024,
    checksum_sha256: `checksum-${id}`,
    file_version: cycle,
    virus_scan_status: virusScanStatus,
    uploaded_by: `author-${cycle}`,
    created_at: `2026-07-0${cycle}T09:00:00.000Z`,
    updated_at: `2026-07-0${cycle}T09:00:00.000Z`,
  };
}

function stoppedClock(): SLAClock {
  return {
    id: 'clock-2',
    tenant_id: 'tenant-1',
    legal_request_id: 'request-1',
    service_code: 'LEGAL_CONSULTATION',
    priority: 'normal',
    clock_started_at: '2026-07-02T09:00:00.000Z',
    ack_due_at: '2026-07-02T10:00:00.000Z',
    turnaround_due_at: '2099-07-04T09:00:00.000Z',
    escalation_l1_due_at: '2099-07-03T09:00:00.000Z',
    escalation_l2_due_at: '2099-07-03T12:00:00.000Z',
    escalation_l3_due_at: '2099-07-03T15:00:00.000Z',
    ack_done: true,
    ack_done_at: '2026-07-02T09:30:00.000Z',
    escalation_level: 0,
    breached: false,
    outcome: 'stopped',
    resolved_at: '2026-07-02T12:00:00.000Z',
    stopped_at: '2026-07-02T12:00:00.000Z',
    cycle: 2,
    metadata: {},
    created_at: '2026-07-02T09:00:00.000Z',
    updated_at: '2026-07-02T12:00:00.000Z',
  };
}

afterEach(() => vi.restoreAllMocks());

describe('request review-round UI', () => {
  it('keeps comments separated by round and marks the newest round current', async () => {
    vi.spyOn(lexRequestsApi, 'listRequestNotes').mockResolvedValue([
      note('note-1', 1, 'Please clarify the requested legal position.'),
      note('note-2', 2, 'The business supplied the requested clarification.'),
    ]);

    renderInEnglish(<RequestNoteComposer requestId="request-1" />);

    expect(await screen.findByText('Round 1')).toBeInTheDocument();
    const roundTwo = screen.getByText('Round 2').closest('[data-review-round="2"]');
    expect(roundTwo).not.toBeNull();
    expect(within(roundTwo as HTMLElement).getByText('Current round')).toBeInTheDocument();
    expect(screen.getByText('Please clarify the requested legal position.')).toBeInTheDocument();
    expect(screen.getByText('The business supplied the requested clarification.')).toBeInTheDocument();
  });

  it('keeps file uploads attributable to their review rounds and scan state', async () => {
    vi.spyOn(lexRequestsApi, 'listRequestAttachments').mockResolvedValue([
      attachment('attachment-1', 1, 'initial-brief.pdf'),
      attachment('attachment-2', 2, 'revised-brief.pdf', 'pending'),
    ]);

    renderInEnglish(<RequestAttachmentsPanel requestId="request-1" />);

    expect(await screen.findByText('initial-brief.pdf')).toBeInTheDocument();
    expect(screen.getByText('revised-brief.pdf')).toBeInTheDocument();
    expect(screen.getByText('Round 1')).toBeInTheDocument();
    expect(screen.getByText('Round 2')).toBeInTheDocument();
    expect(screen.getByText('Unavailable for review')).toBeInTheDocument();
    const previewButtons = screen.getAllByRole('button', { name: 'Preview' });
    expect(previewButtons[0]).toBeEnabled();
    expect(previewButtons[1]).toBeDisabled();
  });

  it('presents a returned round as SLA stopped in both the tab and persistent ribbon', async () => {
    vi.spyOn(lexRequestsApi, 'getRequestClock').mockResolvedValue(stoppedClock());

    renderInEnglish(
      <>
        <SlaPanel requestId="request-1" status="returned" />
        <SlaHeroRibbon requestId="request-1" status="returned" />
      </>,
    );

    expect(await screen.findByText('Round 2 · SLA stopped')).toBeInTheDocument();
    expect(screen.getByText('SLA stopped')).toBeInTheDocument();
    expect(screen.getAllByText(/A new SLA starts when the request is sent back/)).toHaveLength(2);
    expect(screen.queryByText(/clock has not started/i)).not.toBeInTheDocument();
  });
});
