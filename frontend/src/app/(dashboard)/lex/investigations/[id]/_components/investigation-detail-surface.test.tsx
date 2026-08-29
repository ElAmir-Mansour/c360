import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import type { Investigation } from '@/lib/lex/investigations';
import { resolveInvestigationLabels } from '../../_components/labels';
import {
  buildDetailTimeline,
  InvestigationDetailSurface,
  readMetadataString,
} from './investigation-detail-surface';
import { resolveInvestigationDetailSurfaceLabels } from './investigation-detail-surface-labels';

const investigation: Investigation = {
  id: 'inv-1',
  tenant_id: 'tenant-1',
  investigation_number: 'INV-2026-001',
  subject: 'Unauthorized procurement transactions',
  lead_investigator: 'Ahmad Mahmoud',
  status: 'in_progress',
  priority: 'critical',
  findings: '',
  recommendations: '',
  ai_drafted: false,
  department: 'Procurement',
  metadata: {
    investigation_type: 'Internal Fraud',
    estimated_completion: '2026-09-30T00:00:00.000Z',
    confidentiality: 'Restricted — Need-to-Know Basis',
  },
  created_by: 'user-1',
  created_at: '2026-07-01T09:00:00.000Z',
  updated_at: '2026-07-12T10:30:00.000Z',
  parties: [
    {
      id: 'party-1',
      tenant_id: 'tenant-1',
      investigation_id: 'inv-1',
      role: 'subject',
      name: 'Samer Al-Ghamdi',
      contact: 'Procurement Director',
      created_by: 'user-1',
      created_at: '2026-07-03T09:00:00.000Z',
      updated_at: '2026-07-03T09:00:00.000Z',
    },
  ],
  statements: [],
  evidence: [
    {
      id: 'evidence-1',
      tenant_id: 'tenant-1',
      investigation_id: 'inv-1',
      title: 'Procurement DB dump',
      description: 'Forensic transaction export',
      evidence_type: 'database',
      collected_by: 'Ahmad Mahmoud',
      collected_at: '2026-07-05T09:00:00.000Z',
      metadata: { sha256: '8f4a7c112233445566778899aabb2e91' },
      created_by: 'user-1',
      created_at: '2026-07-05T09:00:00.000Z',
      updated_at: '2026-07-05T09:00:00.000Z',
    },
  ],
};

function renderInEnglish(node: ReactNode) {
  return render(
    <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
      {node}
    </LocaleProvider>,
  );
}

describe('InvestigationDetailSurface', () => {
  it('renders the reference hierarchy from live investigation data', () => {
    renderInEnglish(
      <InvestigationDetailSurface
        investigation={investigation}
        auditEntries={[]}
        labels={resolveInvestigationLabels('en')}
        canWrite
        onEdit={vi.fn()}
        onShare={vi.fn()}
        onAddParty={vi.fn()}
        onEditParty={vi.fn()}
        onRemoveParty={vi.fn()}
        onAddEvidence={vi.fn()}
        onRemoveEvidence={vi.fn()}
        onRecordStatement={vi.fn()}
        onGenerateReport={vi.fn()}
        onOpenTimeline={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'INV-2026-001' })).toBeInTheDocument();
    expect(screen.getAllByText('Unauthorized procurement transactions')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Investigation Overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Persons of Interest (POIs)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence Chain of Custody' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quick Actions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Investigation Timeline' })).toBeInTheDocument();
    expect(screen.getByText('Samer Al-Ghamdi')).toBeInTheDocument();
    expect(screen.getByText(/EVID-01: Procurement DB dump/)).toBeInTheDocument();
    expect(screen.getByText(/8f4a7c11…2e91/)).toBeInTheDocument();
  });

  it('connects the visible actions to the existing update workflows', () => {
    const onEdit = vi.fn();
    const onShare = vi.fn();
    const onAddEvidence = vi.fn();
    const onRecordStatement = vi.fn();
    const onGenerateReport = vi.fn();

    renderInEnglish(
      <InvestigationDetailSurface
        investigation={investigation}
        auditEntries={[]}
        labels={resolveInvestigationLabels('en')}
        canWrite
        onEdit={onEdit}
        onShare={onShare}
        onAddParty={vi.fn()}
        onEditParty={vi.fn()}
        onRemoveParty={vi.fn()}
        onAddEvidence={onAddEvidence}
        onRemoveEvidence={vi.fn()}
        onRecordStatement={onRecordStatement}
        onGenerateReport={onGenerateReport}
        onOpenTimeline={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit File' }));
    fireEvent.click(screen.getByRole('button', { name: 'Share Access' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Evidence Item' }));
    fireEvent.click(screen.getByRole('button', { name: 'Schedule Witness Interview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate Progress Report' }));

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onShare).toHaveBeenCalledOnce();
    expect(onAddEvidence).toHaveBeenCalledOnce();
    expect(onRecordStatement).toHaveBeenCalledOnce();
    expect(onGenerateReport).toHaveBeenCalledOnce();
  });
});

describe('investigation detail surface helpers', () => {
  it('reads the first populated metadata alias', () => {
    expect(readMetadataString({ type: '', investigation_type: 'Internal Fraud' }, ['type', 'investigation_type']))
      .toBe('Internal Fraud');
  });

  it('keeps an opened event and a current-status endpoint in the compact timeline', () => {
    const entries = buildDetailTimeline(
      investigation,
      [],
      resolveInvestigationDetailSurfaceLabels('en'),
    );

    expect(entries[0]?.title).toBe('Investigation Officially Opened');
    expect(entries.at(-1)).toMatchObject({ current: true, title: 'In Progress' });
  });
});
