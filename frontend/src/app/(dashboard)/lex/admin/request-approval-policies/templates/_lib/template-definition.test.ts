/**
 * Pure unit tests for the template definition logic. Every export here is
 * deterministic + side-effect-free, so these run without React/MSW.
 *
 * Covers: round-trip draft⇄definition fidelity, the structured-managed-key
 * clobber fix (the key regression), the full validation rule matrix, instantiate
 * override building, and the conflict-check payload resolution (overrides win).
 */

import { describe, expect, it } from 'vitest';
import {
  buildInstantiateOverrides,
  definitionFromDraft,
  draftFromDefinition,
  emptyApprover,
  emptyExtraMetadata,
  emptyFormField,
  emptyTemplateDraft,
  resolvePolicyPayloadForConflictCheck,
  STRUCTURED_MANAGED_KEYS,
  type TemplateDefinitionDraft,
  validateDefinition,
} from './template-definition';

function baseDraft(overrides: Partial<TemplateDefinitionDraft> = {}): TemplateDefinitionDraft {
  return { ...emptyTemplateDraft(), ...overrides };
}

describe('round-trip draftFromDefinition(definitionFromDraft(draft))', () => {
  it('preserves a richly-populated parallel/all draft', () => {
    const draft = baseDraft({
      request_type: 'contract_review',
      service_id: 'svc-7',
      stage: 'requester',
      department: 'Legal',
      priority_tier: 'urgent',
      priority: '20',
      min_value: '1000',
      max_value: '50000',
      currency: 'SAR',
      mode: 'sequential',
      quorum: 'all',
      quorum_n: '',
      approvers: [
        { type: 'role', ref: 'legal_counsel', label: 'Legal Counsel' },
        { type: 'user', ref: 'user-42', label: '' },
      ],
      form_fields: [
        {
          name: 'priority_band',
          type: 'select',
          label: 'Priority band',
          required: true,
          options: 'high, medium, low',
          placeholder: 'Pick one',
          description: 'Select the priority band',
        },
      ],
      require_authority_evidence: true,
      required_role: 'legal_director',
      required_authority_amount: '500000',
      valid_from: '2026-01-01',
      valid_until: '2026-12-31',
      extra_metadata: [{ key: 'routing_note', value: 'fast track' }],
    });

    const round = draftFromDefinition(definitionFromDraft(draft));

    expect(round.request_type).toBe('contract_review');
    expect(round.service_id).toBe('svc-7');
    expect(round.stage).toBe('requester');
    expect(round.department).toBe('Legal');
    expect(round.priority_tier).toBe('urgent');
    expect(round.priority).toBe('20');
    expect(round.min_value).toBe('1000');
    expect(round.max_value).toBe('50000');
    expect(round.currency).toBe('SAR');
    expect(round.mode).toBe('sequential');
    expect(round.quorum).toBe('all');
    expect(round.require_authority_evidence).toBe(true);
    expect(round.required_role).toBe('legal_director');
    expect(round.required_authority_amount).toBe('500000');
    expect(round.valid_from).toBe('2026-01-01');
    expect(round.valid_until).toBe('2026-12-31');

    // Approvers preserved verbatim (label trimmed/dropped when empty).
    expect(round.approvers).toEqual([
      { type: 'role', ref: 'legal_counsel', label: 'Legal Counsel' },
      { type: 'user', ref: 'user-42', label: '' },
    ]);

    // Form field with select options preserved (CSV re-joined with ", ").
    expect(round.form_fields).toEqual([
      {
        name: 'priority_band',
        type: 'select',
        label: 'Priority band',
        required: true,
        options: 'high, medium, low',
        placeholder: 'Pick one',
        description: 'Select the priority band',
      },
    ]);

    // Non-colliding extra metadata survives.
    expect(round.extra_metadata).toEqual([{ key: 'routing_note', value: 'fast track' }]);
  });

  it('preserves n_of_m quorum with quorum_n', () => {
    const draft = baseDraft({
      mode: 'parallel',
      quorum: 'n_of_m',
      quorum_n: '2',
      approvers: [
        { type: 'role', ref: 'a', label: '' },
        { type: 'role', ref: 'b', label: '' },
        { type: 'role', ref: 'c', label: '' },
      ],
    });

    const definition = definitionFromDraft(draft);
    expect(definition.quorum).toBe('n_of_m');
    expect(definition.quorum_n).toBe(2);

    const round = draftFromDefinition(definition);
    expect(round.quorum).toBe('n_of_m');
    expect(round.quorum_n).toBe('2');
  });

  it('nulls quorum_n when quorum is not n_of_m', () => {
    const draft = baseDraft({ quorum: 'all', quorum_n: '5' });
    expect(definitionFromDraft(draft).quorum_n).toBeNull();
  });

  it('preserves the authority block and validity dates round-trip', () => {
    const draft = baseDraft({
      require_authority_evidence: true,
      required_role: 'cfo',
      required_authority_amount: '750000',
      valid_from: '2027-03-01',
      valid_until: '2027-09-01',
    });

    const round = draftFromDefinition(definitionFromDraft(draft));
    expect(round.require_authority_evidence).toBe(true);
    expect(round.required_role).toBe('cfo');
    expect(round.required_authority_amount).toBe('750000');
    expect(round.valid_from).toBe('2027-03-01');
    expect(round.valid_until).toBe('2027-09-01');
  });
});

describe('definitionFromDraft — clobber fix (managed keys win over extra metadata)', () => {
  it('DROPS an extra_metadata entry that collides with a STRUCTURED_MANAGED_KEY', () => {
    const draft = baseDraft({
      department: 'Legal',
      mode: 'sequential',
      approvers: [{ type: 'role', ref: 'legal_counsel', label: '' }],
      extra_metadata: [
        // Collide with managed keys — these must NEVER overwrite structured state.
        { key: 'department', value: 'HIJACKED' },
        { key: 'mode', value: 'parallel' },
        { key: 'approvers', value: '[]' },
        // A non-colliding key that must survive.
        { key: 'routing_hint', value: 'expedite' },
      ],
    });

    const definition = definitionFromDraft(draft);

    // Managed keys keep the structured values, NOT the metadata values.
    expect(definition.department).toBe('Legal');
    expect(definition.mode).toBe('sequential');
    expect(definition.approvers).toEqual([{ type: 'role', ref: 'legal_counsel' }]);

    // Non-colliding extra key survives (parsed: a bare string stays a string).
    expect(definition.routing_hint).toBe('expedite');
  });

  it('guards every STRUCTURED_MANAGED_KEY against metadata override', () => {
    const draft = baseDraft({
      extra_metadata: STRUCTURED_MANAGED_KEYS.map((key) => ({ key, value: 'pwned' })),
    });

    const definition = definitionFromDraft(draft);
    for (const key of STRUCTURED_MANAGED_KEYS) {
      expect(definition[key]).not.toBe('pwned');
    }
  });

  it('preserves edited approvers (never silently produces [])', () => {
    const draft = baseDraft({
      approvers: [
        { type: 'role', ref: 'finance_director', label: 'Finance Director' },
        { type: 'user', ref: 'u-99', label: '' },
      ],
    });

    expect(definitionFromDraft(draft).approvers).toEqual([
      { type: 'role', ref: 'finance_director', label: 'Finance Director' },
      { type: 'user', ref: 'u-99' },
    ]);
  });

  it('parses a JSON-valued extra metadata entry while a bare string stays a string', () => {
    const draft = baseDraft({
      extra_metadata: [
        { key: 'jsonish', value: '{"a":1}' },
        { key: 'plain', value: 'hello' },
      ],
    });

    const definition = definitionFromDraft(draft);
    expect(definition.jsonish).toEqual({ a: 1 });
    expect(definition.plain).toBe('hello');
  });
});

describe('validateDefinition', () => {
  it('returns [] for a fully-valid draft', () => {
    const draft = baseDraft({
      approvers: [{ type: 'role', ref: 'legal_counsel', label: '' }],
    });
    expect(validateDefinition(draft)).toEqual([]);
  });

  it('flags an invalid mode', () => {
    const draft = baseDraft({ mode: 'diagonal' as never });
    expect(validateDefinition(draft)).toContain('mode_invalid');
  });

  it('flags an invalid quorum', () => {
    const draft = baseDraft({ quorum: 'most' as never });
    expect(validateDefinition(draft)).toContain('quorum_invalid');
  });

  it('flags an invalid stage', () => {
    const draft = baseDraft({ stage: 'reviewer' as never });
    expect(validateDefinition(draft)).toContain('stage_invalid');
  });

  it('flags n_of_m with quorum_n < 1', () => {
    const draft = baseDraft({
      quorum: 'n_of_m',
      quorum_n: '0',
      approvers: [{ type: 'role', ref: 'a', label: '' }],
    });
    expect(validateDefinition(draft)).toContain('quorum_at_least_one');
  });

  it('flags n_of_m with quorum_n exceeding approver count', () => {
    const draft = baseDraft({
      quorum: 'n_of_m',
      quorum_n: '3',
      approvers: [
        { type: 'role', ref: 'a', label: '' },
        { type: 'role', ref: 'b', label: '' },
      ],
    });
    expect(validateDefinition(draft)).toContain('quorum_exceeds_approvers');
  });

  it('flags an approver row with content but an empty ref', () => {
    const draft = baseDraft({
      approvers: [
        { type: 'role', ref: 'a', label: '' },
        { type: 'role', ref: '', label: 'Has a label but no ref' },
      ],
    });
    expect(validateDefinition(draft)).toContain('approver_ref_required');
  });

  it('flags zero (valid) approvers', () => {
    const draft = baseDraft({
      approvers: [{ type: 'role', ref: '', label: '' }],
    });
    expect(validateDefinition(draft)).toContain('approver_required');
  });

  it('flags min_value > max_value', () => {
    const draft = baseDraft({
      min_value: '500',
      max_value: '100',
      approvers: [{ type: 'role', ref: 'a', label: '' }],
    });
    expect(validateDefinition(draft)).toContain('min_exceeds_max');
  });

  it('flags a negative authority amount', () => {
    const draft = baseDraft({
      required_authority_amount: '-1',
      approvers: [{ type: 'role', ref: 'a', label: '' }],
    });
    expect(validateDefinition(draft)).toContain('authority_amount_negative');
  });

  it('flags a select form field with no options', () => {
    const draft = baseDraft({
      approvers: [{ type: 'role', ref: 'a', label: '' }],
      form_fields: [
        {
          name: 'choice',
          type: 'select',
          label: 'Choice',
          required: false,
          options: '',
          placeholder: '',
          description: '',
        },
      ],
    });
    expect(validateDefinition(draft)).toContain('form_field_select_needs_option:1');
  });

  it('flags valid_from after valid_until', () => {
    const draft = baseDraft({
      valid_from: '2026-12-31',
      valid_until: '2026-01-01',
      approvers: [{ type: 'role', ref: 'a', label: '' }],
    });
    expect(validateDefinition(draft)).toContain('valid_from_after_until');
  });

  it('flags an incomplete form field (content but missing name)', () => {
    const draft = baseDraft({
      approvers: [{ type: 'role', ref: 'a', label: '' }],
      form_fields: [
        {
          name: '',
          type: 'text',
          label: 'A label',
          required: false,
          options: '',
          placeholder: '',
          description: '',
        },
      ],
    });
    expect(validateDefinition(draft)).toContain('form_field_incomplete:1');
  });
});

describe('buildInstantiateOverrides', () => {
  it('returns undefined when nothing is set', () => {
    expect(
      buildInstantiateOverrides({ name: '', status: '', requestType: '', department: '' }),
    ).toBeUndefined();
  });

  it('omits empty fields and trims the provided ones', () => {
    expect(
      buildInstantiateOverrides({
        name: '  Renamed policy  ',
        status: '',
        requestType: '  consultation ',
        department: '',
      }),
    ).toEqual({ name: 'Renamed policy', request_type: 'consultation' });
  });

  it('includes a non-empty status', () => {
    expect(
      buildInstantiateOverrides({ name: '', status: 'active', requestType: '', department: '' }),
    ).toEqual({ status: 'active' });
  });

  it('builds the full override patch when every field is provided', () => {
    expect(
      buildInstantiateOverrides({
        name: 'P',
        status: 'draft',
        requestType: 'litigation',
        department: 'Legal',
      }),
    ).toEqual({
      name: 'P',
      status: 'draft',
      request_type: 'litigation',
      department: 'Legal',
    });
  });
});

describe('resolvePolicyPayloadForConflictCheck', () => {
  const definition = {
    name: 'Template policy',
    status: 'active',
    priority: 5,
    request_type: 'consultation',
    department: 'Legal',
    mode: 'parallel',
    quorum: 'all',
    currency: 'sar',
    approvers: [{ type: 'role', ref: 'legal_counsel' }],
    min_value: 100,
    max_value: 9000,
  };

  it('uses the definition values when there are no overrides', () => {
    const payload = resolvePolicyPayloadForConflictCheck(definition, undefined);
    expect(payload.name).toBe('Template policy');
    expect(payload.request_type).toBe('consultation');
    expect(payload.department).toBe('Legal');
    expect(payload.currency).toBe('SAR'); // formatCurrency upcases
    expect(payload.approvers).toEqual([{ type: 'role', ref: 'legal_counsel' }]);
    expect(payload.metadata).toEqual({
      source: 'watheeq_request_approval_template_instantiate',
    });
  });

  it('lets overrides win per-field over the definition', () => {
    const payload = resolvePolicyPayloadForConflictCheck(definition, {
      name: 'Overridden',
      request_type: 'litigation',
      department: 'Compliance',
      status: 'draft',
    });

    expect(payload.name).toBe('Overridden');
    expect(payload.request_type).toBe('litigation');
    expect(payload.department).toBe('Compliance');
    expect(payload.status).toBe('draft');
    // Non-overridden fields still come from the definition.
    expect(payload.mode).toBe('parallel');
    expect(payload.min_value).toBe(100);
  });

  it('falls back to safe defaults when both definition and overrides are empty', () => {
    const payload = resolvePolicyPayloadForConflictCheck(null, undefined);
    expect(payload.name).toBe('');
    expect(payload.status).toBe('active');
    expect(payload.priority).toBe(10);
    expect(payload.mode).toBe('parallel');
    expect(payload.quorum).toBe('all');
    expect(payload.currency).toBe('SAR');
    expect(payload.approvers).toEqual([]);
  });
});

describe('factory defaults', () => {
  it('emptyApprover / emptyFormField / emptyExtraMetadata return fresh blanks', () => {
    expect(emptyApprover()).toEqual({ type: 'role', ref: '', label: '' });
    expect(emptyFormField()).toEqual({
      name: '',
      type: 'text',
      label: '',
      required: false,
      options: '',
      placeholder: '',
      description: '',
    });
    expect(emptyExtraMetadata()).toEqual({ key: '', value: '' });
  });

  it('emptyTemplateDraft seeds exactly one blank approver', () => {
    expect(emptyTemplateDraft().approvers).toEqual([{ type: 'role', ref: '', label: '' }]);
  });
});
