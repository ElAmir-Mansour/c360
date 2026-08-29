import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import {
  ContractAuditDrawer,
  contractAuditDrawerLabels,
  contractAuditEventTone,
} from '@/app/(dashboard)/lex/contracts/_components/contract-audit-drawer';
import type { LexContractTimeline } from '@/types/suites';

const { getContractTimelineMock } = vi.hoisted(() => ({
  getContractTimelineMock: vi.fn(),
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>('@/lib/enterprise');
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        getContractTimeline: getContractTimelineMock,
      },
    },
  };
});

const timelineFixture: LexContractTimeline = {
  contract_id: 'contract-1',
  generated_at: '2026-07-01T10:00:00Z',
  events: [
    {
      id: 'evt-1',
      event_type: 'status_changed',
      title: 'moved the contract to active',
      description: 'draft → active',
      occurred_at: '2026-06-30T08:00:00Z',
      actor: 'Sara Legal',
      source: 'contracts.status_changed_at',
    },
    {
      id: 'evt-2',
      event_type: 'contract_created',
      title: 'created the contract',
      description: '',
      occurred_at: '2026-06-01T08:00:00Z',
      actor: null,
      source: 'contracts.created_at',
    },
  ],
};

beforeEach(() => {
  getContractTimelineMock.mockReset();
  getContractTimelineMock.mockResolvedValue(timelineFixture);
});

describe('ContractAuditDrawer', () => {
  it('fetches the timeline and renders the tamper-evident history in English', async () => {
    renderWithQuery(
      <ContractAuditDrawer
        contractId="contract-1"
        contractTitle="Master Services Agreement"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(contractAuditDrawerLabels.en.title)).toBeInTheDocument();
    expect(getContractTimelineMock).toHaveBeenCalledWith('contract-1');

    // Actor-attributed event plus the system fallback for actor-less rows.
    expect(await screen.findByText('Sara Legal')).toBeInTheDocument();
    // The label comes from the `status_changed` TOKEN, not from the server's
    // pre-rendered `title` — see the Arabic-leak regression below for why.
    expect(screen.getByText('Status changed')).toBeInTheDocument();
    expect(screen.getByText(contractAuditDrawerLabels.en.systemActor)).toBeInTheDocument();
    expect(screen.getByText(contractAuditDrawerLabels.en.eventCount(2))).toBeInTheDocument();
    expect(screen.getByText('Master Services Agreement')).toBeInTheDocument();
  });

  it('renders the Arabic surface under the ar locale', async () => {
    renderWithQuery(
      <ContractAuditDrawer contractId="contract-1" open onOpenChange={vi.fn()} />,
      { locale: 'ar' },
    );

    expect(await screen.findByText(contractAuditDrawerLabels.ar.title)).toBeInTheDocument();
    expect(
      await screen.findByText(contractAuditDrawerLabels.ar.systemActor),
    ).toBeInTheDocument();

    const rtlContent = document.querySelector('[dir="rtl"]');
    expect(rtlContent).not.toBeNull();
  });

  it('shows the empty state when the contract has no audit events', async () => {
    getContractTimelineMock.mockResolvedValue({
      contract_id: 'contract-1',
      generated_at: '2026-07-01T10:00:00Z',
      events: [],
    });

    renderWithQuery(
      <ContractAuditDrawer contractId="contract-1" open onOpenChange={vi.fn()} />,
    );

    expect(
      await screen.findByText(contractAuditDrawerLabels.en.emptyTitle),
    ).toBeInTheDocument();
  });

  it('stays dormant while closed (no fetch)', () => {
    renderWithQuery(
      <ContractAuditDrawer contractId="contract-1" open={false} onOpenChange={vi.fn()} />,
    );

    expect(getContractTimelineMock).not.toHaveBeenCalled();
  });
});

describe('contractAuditEventTone', () => {
  it('maps event types onto the shared tone ramp like the detail console', () => {
    expect(contractAuditEventTone('contract_created')).toBe('success');
    expect(contractAuditEventTone('status_changed')).toBe('info');
    expect(contractAuditEventTone('renewal_warning')).toBe('warning');
    expect(contractAuditEventTone('contract_terminated')).toBe('danger');
    expect(contractAuditEventTone('something_else')).toBe('neutral');
  });
});

/**
 * REGRESSION: Arabic history entries leaked into the English UI.
 *
 * `contract_service.go` synthesises the contract timeline with HARDCODED Arabic
 * `title`/`description` ("تغيّرت الحالة", "تم ربط سير العمل"), so an English-mode
 * reader saw Arabic rows. It does emit a stable `event_type` and structured
 * `metadata`, so the label is resolved from those instead of trusting the
 * server's prose.
 */
describe('ContractAuditDrawer — server prose is Arabic-only', () => {
  it('renders English labels even when the server sends Arabic titles', async () => {
    getContractTimelineMock.mockResolvedValue({
      contract_id: 'contract-1',
      generated_at: '2026-07-01T10:00:00Z',
      events: [
        {
          id: 'evt-ar-1',
          event_type: 'status_changed',
          title: 'تغيّرت الحالة',
          description: 'انتقل العقد إلى حالة مراجعة داخلية.',
          occurred_at: '2026-06-30T08:00:00Z',
          // A bare uuid is not a person; it must not be shown as the actor.
          actor: '2456d369-1037-4eef-821b-7cd670fa216c',
          source: 'contracts.status_changed_at',
          metadata: { status: 'internal_review' },
        },
        {
          id: 'evt-ar-2',
          event_type: 'workflow_linked',
          title: 'تم ربط سير العمل',
          description: 'تم ربط سير عمل مراجعة العقد بهذا العقد.',
          occurred_at: '2026-06-29T08:00:00Z',
          actor: null,
          source: 'contracts.workflow_instance_id',
        },
      ],
    } as unknown as LexContractTimeline);

    renderWithQuery(
      <ContractAuditDrawer
        contractId="contract-1"
        contractTitle="Master Services Agreement"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText('Status changed')).toBeInTheDocument();
    expect(screen.getByText('Workflow linked')).toBeInTheDocument();
    expect(screen.getByText('The contract moved to Internal review.')).toBeInTheDocument();

    // The Arabic the server sent must not reach an English reader.
    expect(screen.queryByText('تغيّرت الحالة')).not.toBeInTheDocument();
    expect(screen.queryByText('تم ربط سير العمل')).not.toBeInTheDocument();

    // The raw uuid actor is replaced by the system label rather than displayed.
    expect(
      screen.queryByText('2456d369-1037-4eef-821b-7cd670fa216c'),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(contractAuditDrawerLabels.en.systemActor).length,
    ).toBeGreaterThan(0);
  });
});
