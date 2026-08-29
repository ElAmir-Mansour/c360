import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Investigation } from '@/lib/lex/investigations';
import { WorkspaceInvestigationRegister } from './deep/investigation-deep-dashboard';
import { buildInvestigationIntakeMetadata } from './investigation-form-dialog';
import {
  investigationBelongsToWorkspace,
  parseInvestigationWorkspace,
  scopeInvestigationsToWorkspace,
  withInvestigationWorkspaceMetadata,
} from './investigation-workspaces';

function investigation(
  id: string,
  metadata: Record<string, unknown> | null,
  status: Investigation['status'] = 'registered',
): Investigation {
  return {
    id,
    tenant_id: 'tenant-1',
    investigation_number: `INV-${id}`,
    subject: `Investigation ${id}`,
    lead_investigator: 'Lead Investigator',
    status,
    priority: 'medium',
    findings: '',
    recommendations: '',
    ai_drafted: false,
    metadata,
    created_by: 'user-1',
    created_at: '2026-07-01T09:00:00.000Z',
    updated_at: '2026-07-12T10:30:00.000Z',
  };
}

describe('investigation workspace scoping', () => {
  it('normalizes only supported workspace query values', () => {
    expect(parseInvestigationWorkspace('fraud')).toBe('fraud');
    expect(parseInvestigationWorkspace('Digital Forensics')).toBe('forensics');
    expect(parseInvestigationWorkspace('board-review')).toBe('board');
    expect(parseInvestigationWorkspace('everything')).toBeNull();
  });

  it('uses canonical metadata tags and never falls back to the whole portfolio', () => {
    const rows = [
      investigation('fraud', { workspace: 'fraud' }),
      investigation('legacy-fraud', { investigation_type: 'Internal Fraud' }),
      investigation('compliance', { workspace: 'compliance' }),
      investigation('untagged', null),
    ];

    expect(scopeInvestigationsToWorkspace(rows, 'fraud').map((row) => row.id)).toEqual([
      'fraud',
      'legacy-fraud',
    ]);
    expect(scopeInvestigationsToWorkspace(rows, 'compliance').map((row) => row.id)).toEqual([
      'compliance',
    ]);
    expect(scopeInvestigationsToWorkspace(rows, 'forensics')).toEqual([]);
  });

  it('keeps board review cross-workspace while retaining explicit board intake', () => {
    expect(investigationBelongsToWorkspace(investigation('board', { workspace: 'board' }), 'board'))
      .toBe(true);
    expect(
      investigationBelongsToWorkspace(
        investigation('review', { workspace: 'fraud' }, 'pending_approval'),
        'board',
      ),
    ).toBe(true);
    expect(investigationBelongsToWorkspace(investigation('active', { workspace: 'fraud' }), 'board'))
      .toBe(false);
  });

  it('adds both canonical create tags without discarding intake metadata', () => {
    const existing = withInvestigationWorkspaceMetadata({ intake_source: 'hotline' }, null);
    expect(buildInvestigationIntakeMetadata({
      case_id: null,
      subject: 'Forensic review',
      lead_investigator: 'Investigator',
      investigation_number: null,
      priority: 'medium',
      department: null,
      readiness_parties_identified: true,
      readiness_evidence_sources_identified: false,
      readiness_approval_path_ready: false,
    }, existing, 'forensics')).toEqual({
      intake_source: 'hotline',
      intake_readiness: {
        case_linked: false,
        parties_identified: true,
        evidence_sources_identified: false,
        approval_path_ready: false,
      },
      workspace: 'forensics',
      investigation_type: 'forensics',
    });
  });
});

describe('WorkspaceInvestigationRegister', () => {
  it('renders a semantic, actionable list before workspace analytics', () => {
    const row = investigation('fraud', { workspace: 'fraud' });
    render(
      <WorkspaceInvestigationRegister
        rows={[row]}
        workspace="fraud"
        isArabic={false}
        formatRelative={() => 'recently'}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Workspace work register' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Fraud Investigations work register' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Investigation fraud' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Open investigation' })).toHaveAttribute(
      'href',
      '/lex/investigations/fraud',
    );
  });
});
