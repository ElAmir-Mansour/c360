import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const lexRoot = resolve(process.cwd(), 'src/app/(dashboard)/lex');

const guidedCreationFlows: Array<[path: string, marker: string]> = [
  ['cases/_components/case-form-dialog.tsx', 'workflow="case"'],
  ['consultations/_components/consultation-form-dialog.tsx', 'workflow="consultation"'],
  ['consultations/new/page.tsx', 'workflow="consultation"'],
  ['contracts/_components/contract-form-dialog.tsx', 'workflow="contract"'],
  ['contracts/new/_components/contract-drafting-workspace.tsx', 'workflow="contract"'],
  ['investigations/_components/investigation-form-dialog.tsx', 'workflow="investigation"'],
  ['matters/_components/matter-form-dialog.tsx', 'workflow="matter"'],
  ['settlements/_components/settlement-form-dialog.tsx', 'workflow="settlement"'],
  ['regulations/_components/regulation-form-dialog.tsx', 'workflow="regulation"'],
  ['playbooks/_components/playbook-dialog.tsx', 'workflow="playbook"'],
  ['documents/_components/document-form-dialog.tsx', 'workflow="document"'],
  ['signatures/_components/signature-envelope-dialog.tsx', 'workflow="signature"'],
  ['clause-library/_components/clause-form-dialog.tsx', 'workflow="clause"'],
  ['reports/builder/_components/save-report-dialog.tsx', 'workflow="report"'],
  ['service-desk/new/page.tsx', '<RequestGuidanceRail'],
  ['admin/integrations/new/page.tsx', 'workflow="integration"'],
  ['admin/attachment-policies/_components/attachment-policy-form-dialog.tsx', 'workflow="policy"'],
  ['admin/classifications/_components/classification-form-dialog.tsx', 'workflow="classification"'],
  ['cases/classifications/_components/classification-form-dialog.tsx', 'workflow="classification"'],
  ['admin/contract-approval-policies/templates/_components/template-form-dialog.tsx', 'workflow="policy"'],
  ['admin/request-approval-policies/_components/policy-form-dialog.tsx', 'workflow="policy"'],
  ['admin/request-approval-policies/templates/_components/template-form-dialog.tsx', 'workflow="policy"'],
  ['admin/legal-holds/_components/legal-hold-form-dialog.tsx', 'workflow="legal-hold"'],
  ['admin/org-entities/_components/org-entity-form-dialog.tsx', 'workflow="organization"'],
  ['admin/service-catalog/_components/mailbox-form-dialog.tsx', 'workflow="service"'],
  ['admin/service-catalog/_components/service-form-dialog.tsx', 'workflow="service"'],
  ['admin/sla-targets/_components/sla-target-form-dialog.tsx', 'workflow="policy"'],
  ['admin/working-calendars/_components/calendar-form-dialog.tsx', 'workflow="calendar"'],
  ['admin/working-calendars/_components/calendar-holidays-dialog.tsx', 'workflow="calendar"'],
  ['admin/contract-approval-policies/templates/_components/instantiate-template-dialog.tsx', 'workflow="policy"'],
  ['admin/request-approval-policies/templates/_components/instantiate-template-dialog.tsx', 'workflow="policy"'],
  ['admin/org-entities/_components/org-role-dialog.tsx', 'workflow="organization"'],
  ['admin/org-entities/_components/escalation-coverage/coverage-assign-dialog.tsx', 'workflow="organization"'],
  ['service-desk/_components/add-requirement-dialog.tsx', 'workflow="service"'],
  ['service-desk/_components/delivery-request-dialog.tsx', 'workflow="service-request"'],
  ['service-desk/intake/_simulate-inbound-dialog.tsx', 'workflow="service-request"'],
  ['settlements/_components/deadline-create-dialog.tsx', 'workflow="settlement"'],
  ['settlements/_components/negotiation-round-dialog.tsx', 'workflow="settlement"'],
  ['settlements/_components/delay-event-dialog.tsx', 'workflow="settlement"'],
  ['settlements/_components/timeline-estimate-dialog.tsx', 'workflow="settlement"'],
  ['settlements/_components/timeline-hold-dialog.tsx', 'workflow="settlement"'],
  ['documents/_components/bulk-import-csv-dialog.tsx', 'workflow="document"'],
  ['documents/_components/upload-version-dialog.tsx', 'workflow="document"'],
];

describe('Lex creation guidance coverage', () => {
  it('keeps every primary creation workflow contextual and guided', () => {
    const missing = guidedCreationFlows.flatMap(([path, marker]) => {
      const source = readFileSync(resolve(lexRoot, path), 'utf8');
      return source.includes(marker) ? [] : [`${path}: ${marker}`];
    });

    expect(missing, `Creation workflows without guidance:\n${missing.join('\n')}`).toEqual([]);
  });
});
