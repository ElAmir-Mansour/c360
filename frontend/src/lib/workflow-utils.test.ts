import { describe, expect, it } from 'vitest';
import {
  buildDynamicZodSchema,
  formatSLAStatus,
  evalCondition,
  conditionsHold,
  isFieldVisible,
  isFieldRequired,
  isValueEmpty,
  isValidCron,
} from './workflow-utils';
import type {
  Condition,
  ConditionOperator,
  FormField,
  HumanTask,
} from '@/types/models';

const formFields: FormField[] = [
  { name: 'notes', type: 'text', label: 'Notes', required: true },
  { name: 'approved', type: 'boolean', label: 'Approved', required: false },
  {
    name: 'decision',
    type: 'select',
    label: 'Decision',
    required: true,
    options: ['approve', 'reject'],
  },
];

const baseTask: HumanTask = {
  id: 'task-1',
  name: 'Review Task',
  description: 'Review a pending item',
  instance_id: 'instance-1',
  definition_name: 'Approval Workflow',
  workflow_name: 'Approval Workflow',
  step_id: 'review',
  status: 'pending',
  priority: 1,
  form_schema: [],
  form_data: null,
  sla_deadline: null,
  sla_breached: false,
  claimed_by: null,
  claimed_by_name: null,
  assignee_role: 'reviewer',
  assignee_id: null,
  metadata: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe('workflow-utils', () => {
  it('buildDynamicZodSchema enforces required text fields', () => {
    const schema = buildDynamicZodSchema(formFields);
    const result = schema.safeParse({
      notes: '',
      approved: undefined,
      decision: 'approve',
    });

    expect(result.success).toBe(false);
  });

  it('buildDynamicZodSchema accepts optional booleans', () => {
    const schema = buildDynamicZodSchema(formFields);
    const result = schema.safeParse({
      notes: 'Looks good',
      decision: 'approve',
    });

    expect(result.success).toBe(true);
  });

  it('buildDynamicZodSchema enforces required select fields', () => {
    const schema = buildDynamicZodSchema(formFields);
    const result = schema.safeParse({
      notes: 'Looks good',
      decision: '',
    });

    expect(result.success).toBe(false);
  });

  it('formatSLAStatus handles overdue tasks', () => {
    const task = {
      ...baseTask,
      sla_deadline: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      sla_breached: true,
    };

    expect(formatSLAStatus(task)).toEqual({
      text: 'Overdue by 2h',
      color: 'text-red-600',
      urgent: true,
    });
  });

  it('formatSLAStatus handles soon deadlines', () => {
    // Use 2.5 hours to avoid truncation edge case in differenceInHours
    const task = {
      ...baseTask,
      sla_deadline: new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString(),
      sla_breached: false,
    };

    const result = formatSLAStatus(task);
    expect(result.text).toBe('2h left');
    expect(result.color).toBe('text-orange-600');
    expect(result.urgent).toBe(true);
  });

  it('formatSLAStatus handles no deadline', () => {
    expect(formatSLAStatus(baseTask)).toEqual({
      text: 'No deadline',
      color: 'text-muted-foreground',
      urgent: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Two-sided parity: these mirror backend/internal/forms/validate_test.go so the
// FE Zod engine accepts/rejects exactly what the Go ValidateSubmission does.
// ---------------------------------------------------------------------------

const bi = (ar: string, en: string) => ({ ar, en });

/** sampleForm mirrors validate_test.go sampleForm() (canonical, bilingual). */
function sampleForm(): FormField[] {
  return [
    {
      name: 'name',
      type: 'text',
      label: bi('الاسم', 'Name'),
      required: true,
      validation: [
        { kind: 'minLength', param: 2 },
        { kind: 'maxLength', param: 10 },
      ],
    },
    {
      name: 'age',
      type: 'number',
      label: bi('العمر', 'Age'),
      required: false,
      validation: [
        { kind: 'min', param: 18 },
        { kind: 'max', param: 120 },
      ],
    },
    {
      name: 'email',
      type: 'email',
      label: bi('البريد', 'Email'),
      required: false,
      validation: [{ kind: 'email' }],
    },
    {
      name: 'website',
      type: 'url',
      label: bi('الموقع', 'Website'),
      required: false,
      validation: [{ kind: 'url' }],
    },
    {
      name: 'ref',
      type: 'text',
      label: bi('المرجع', 'Ref'),
      required: false,
      validation: [{ kind: 'uuid' }],
    },
    {
      name: 'code',
      type: 'text',
      label: bi('الرمز', 'Code'),
      required: false,
      validation: [{ kind: 'pattern', param: '^[A-Z]{3}$' }],
    },
    {
      name: 'schedule',
      type: 'text',
      label: bi('الجدول', 'Schedule'),
      required: false,
      validation: [{ kind: 'cron' }],
    },
    {
      name: 'color',
      type: 'select',
      label: bi('اللون', 'Color'),
      required: false,
      options: [
        { value: 'red', label: bi('أحمر', 'Red') },
        { value: 'blue', label: bi('أزرق', 'Blue') },
      ],
    },
    { name: 'active', type: 'boolean', label: bi('نشط', 'Active'), required: false },
  ];
}

const validSample = (): Record<string, unknown> => ({
  name: 'Alice',
  age: 30,
  email: 'a@example.com',
  website: 'https://example.com',
  ref: '123e4567-e89b-12d3-a456-426614174000',
  code: 'ABC',
  schedule: '0 9 * * 1',
  color: 'red',
  active: true,
});

describe('buildDynamicZodSchema — submission parity (mirrors validate_test.go)', () => {
  it('a fully valid submission passes (TestValidateSubmission_Pass)', () => {
    const values = validSample();
    const schema = buildDynamicZodSchema(sampleForm(), { locale: 'en', values });
    expect(schema.safeParse(values).success).toBe(true);
  });

  const failureCases: Array<{
    name: string;
    mutate: (d: Record<string, unknown>) => void;
  }> = [
    { name: 'missing required name', mutate: (d) => delete d.name },
    { name: 'empty required name', mutate: (d) => (d.name = '  ') },
    { name: 'name too short (minLength)', mutate: (d) => (d.name = 'A') },
    { name: 'name too long (maxLength)', mutate: (d) => (d.name = 'AbcdefghijK') },
    { name: 'age below min', mutate: (d) => (d.age = 10) },
    { name: 'age above max', mutate: (d) => (d.age = 200) },
    { name: 'age wrong type', mutate: (d) => (d.age = 'old') },
    { name: 'bad email', mutate: (d) => (d.email = 'nope') },
    { name: 'bad url', mutate: (d) => (d.website = 'not a url') },
    { name: 'bad uuid', mutate: (d) => (d.ref = 'xyz') },
    { name: 'bad pattern', mutate: (d) => (d.code = 'abcd') },
    { name: 'bad cron', mutate: (d) => (d.schedule = 'not cron') },
    { name: 'bad enum option', mutate: (d) => (d.color = 'green') },
    { name: 'boolean wrong type', mutate: (d) => (d.active = 'yes') },
  ];

  for (const tc of failureCases) {
    it(`rejects: ${tc.name} (TestValidateSubmission_Failures)`, () => {
      const values = validSample();
      tc.mutate(values);
      const schema = buildDynamicZodSchema(sampleForm(), { locale: 'en', values });
      expect(schema.safeParse(values).success).toBe(false);
    });
  }

  it('optional absent fields are skipped (TestValidateSubmission_OptionalAbsentIsSkipped)', () => {
    const values = { name: 'Alice' };
    const schema = buildDynamicZodSchema(sampleForm(), { locale: 'en', values });
    expect(schema.safeParse(values).success).toBe(true);
  });

  it('valid minLength accepts the boundary', () => {
    const fields: FormField[] = [
      { name: 'name', type: 'text', label: bi('الاسم', 'Name'), required: true, validation: [{ kind: 'minLength', param: 2 }] },
    ];
    const ok = buildDynamicZodSchema(fields, { values: { name: 'Al' } });
    expect(ok.safeParse({ name: 'Al' }).success).toBe(true);
  });
});

describe('buildDynamicZodSchema — requiredWhen (TestValidateSubmission_RequiredWhen)', () => {
  const fields: FormField[] = [
    { name: 'needsReason', type: 'boolean', label: bi('يحتاج سبب', 'Needs reason'), required: false },
    {
      name: 'reason',
      type: 'text',
      label: bi('السبب', 'Reason'),
      required: false,
      requiredWhen: [{ field: 'needsReason', operator: 'eq', value: true }],
    },
  ];

  it('condition true and value missing -> fails', () => {
    const values = { needsReason: true };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(false);
  });
  it('condition false -> passes', () => {
    const values = { needsReason: false };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
  it('condition true and value present -> passes', () => {
    const values = { needsReason: true, reason: 'because' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
});

describe('buildDynamicZodSchema — requiredIf rule (TestValidateSubmission_RequiredIfRule)', () => {
  const fields: FormField[] = [
    { name: 'country', type: 'text', label: bi('الدولة', 'Country'), required: false },
    {
      name: 'state',
      type: 'text',
      label: bi('الولاية', 'State'),
      required: false,
      validation: [{ kind: 'requiredIf', param: [{ field: 'country', operator: 'eq', value: 'US' }] }],
    },
  ];

  it('requiredIf true -> missing state fails', () => {
    const values = { country: 'US' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(false);
  });
  it('requiredIf false -> missing state ok', () => {
    const values = { country: 'FR' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
  it('requiredIf true with value present -> ok', () => {
    const values = { country: 'US', state: 'CA' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
});

describe('buildDynamicZodSchema — hidden field excluded (TestValidateSubmission_HiddenFieldExcluded)', () => {
  const fields: FormField[] = [
    {
      name: 'status',
      type: 'select',
      label: bi('الحالة', 'Status'),
      required: false,
      options: [
        { value: 'approved', label: bi('موافق', 'Approved') },
        { value: 'rejected', label: bi('مرفوض', 'Rejected') },
      ],
    },
    {
      name: 'reason',
      type: 'text',
      label: bi('السبب', 'Reason'),
      required: true,
      visibleWhen: [{ field: 'status', operator: 'eq', value: 'rejected' }],
    },
  ];

  it('a required field hidden by visibleWhen=false PASSES safeParse (excluded)', () => {
    const values = { status: 'approved' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });

  it('the same field is ENFORCED when visible', () => {
    const values = { status: 'rejected' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(false);
  });

  it('visible required field satisfied -> passes', () => {
    const values = { status: 'rejected', reason: 'missing docs' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
});

describe('buildDynamicZodSchema — multiselect + enum (TestValidateSubmission_MultiSelectAndEnum)', () => {
  const fields: FormField[] = [
    {
      name: 'tags',
      type: 'multiselect',
      label: bi('الوسوم', 'Tags'),
      required: false,
      options: [
        { value: 'a', label: bi('أ', 'A') },
        { value: 'b', label: bi('ب', 'B') },
      ],
    },
  ];

  it('valid multiselect passes', () => {
    const values = { tags: ['a', 'b'] };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
  it('multiselect with unknown option fails enum', () => {
    const values = { tags: ['a', 'zzz'] };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(false);
  });
  it('multiselect wrong container type fails', () => {
    const values = { tags: 'a' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(false);
  });
});

describe('buildDynamicZodSchema — daterange (TestValidateSubmission_DateRange)', () => {
  const fields: FormField[] = [
    { name: 'window', type: 'daterange', label: bi('النطاق', 'Window'), required: false },
  ];
  it('valid [start,end] pair passes', () => {
    const values = { window: ['2026-01-01', '2026-02-01'] };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
  it('single-element range fails', () => {
    const values = { window: ['2026-01-01'] };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(false);
  });
});

describe('buildDynamicZodSchema — condition operators via visibility (TestValidateSubmission_ConditionOperators)', () => {
  const fields: FormField[] = [
    { name: 'amount', type: 'number', label: bi('المبلغ', 'Amount'), required: false },
    { name: 'tier', type: 'text', label: bi('الفئة', 'Tier'), required: false },
    {
      name: 'approval',
      type: 'text',
      label: bi('الموافقة', 'Approval'),
      required: true,
      visibleWhen: [
        { field: 'amount', operator: 'gt', value: 1000 },
        { field: 'tier', operator: 'in', value: ['gold', 'platinum'] },
      ],
    },
  ];

  it('both conditions hold -> approval enforced (fails when absent)', () => {
    const values = { amount: 5000, tier: 'gold' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(false);
  });
  it('amount too small -> approval hidden -> passes', () => {
    const values = { amount: 500, tier: 'gold' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
  it('tier not in set -> approval hidden -> passes', () => {
    const values = { amount: 5000, tier: 'bronze' };
    const schema = buildDynamicZodSchema(fields, { values });
    expect(schema.safeParse(values).success).toBe(true);
  });
});

describe('buildDynamicZodSchema — authored bilingual message wins', () => {
  it('uses the author-supplied message in the active locale', () => {
    const fields: FormField[] = [
      {
        name: 'name',
        type: 'text',
        label: bi('الاسم', 'Name'),
        required: false,
        validation: [
          {
            kind: 'minLength',
            param: 5,
            message: bi('الاسم مطلوب', 'Name is mandatory'),
          },
        ],
      },
    ];
    const values = { name: 'ab' };
    const schemaEn = buildDynamicZodSchema(fields, { locale: 'en', values });
    const resEn = schemaEn.safeParse(values);
    expect(resEn.success).toBe(false);
    if (!resEn.success) {
      expect(resEn.error.issues[0]?.message).toBe('Name is mandatory');
    }
    const schemaAr = buildDynamicZodSchema(fields, { locale: 'ar', values });
    const resAr = schemaAr.safeParse(values);
    expect(resAr.success).toBe(false);
    if (!resAr.success) {
      expect(resAr.error.issues[0]?.message).toBe('الاسم مطلوب');
    }
  });
});

describe('evalCondition — all 13 operators (mirror Go operator vocabulary)', () => {
  const cases: Array<{
    op: ConditionOperator;
    values: Record<string, unknown>;
    cond: Omit<Condition, 'operator'>;
    expected: boolean;
  }> = [
    { op: 'eq', values: { x: 5 }, cond: { field: 'x', value: 5 }, expected: true },
    { op: 'eq', values: { x: 5 }, cond: { field: 'x', value: 6 }, expected: false },
    // numeric coercion across string/number, mirroring compareEqual.
    { op: 'eq', values: { x: '5' }, cond: { field: 'x', value: 5 }, expected: true },
    { op: 'neq', values: { x: 'a' }, cond: { field: 'x', value: 'b' }, expected: true },
    { op: 'neq', values: { x: 'a' }, cond: { field: 'x', value: 'a' }, expected: false },
    { op: 'gt', values: { x: 10 }, cond: { field: 'x', value: 5 }, expected: true },
    { op: 'gt', values: { x: 5 }, cond: { field: 'x', value: 5 }, expected: false },
    { op: 'gte', values: { x: 5 }, cond: { field: 'x', value: 5 }, expected: true },
    { op: 'lt', values: { x: 3 }, cond: { field: 'x', value: 5 }, expected: true },
    { op: 'lte', values: { x: 5 }, cond: { field: 'x', value: 5 }, expected: true },
    { op: 'lte', values: { x: 6 }, cond: { field: 'x', value: 5 }, expected: false },
    { op: 'in', values: { x: 'gold' }, cond: { field: 'x', value: ['gold', 'silver'] }, expected: true },
    { op: 'in', values: { x: 'bronze' }, cond: { field: 'x', value: ['gold', 'silver'] }, expected: false },
    { op: 'notIn', values: { x: 'bronze' }, cond: { field: 'x', value: ['gold'] }, expected: true },
    { op: 'notIn', values: { x: 'gold' }, cond: { field: 'x', value: ['gold'] }, expected: false },
    // contains: element membership in a LIST value only (mirrors Go evalIn, which
    // requires the field value be a list; a string field -> error -> false).
    { op: 'contains', values: { x: ['a', 'b'] }, cond: { field: 'x', value: 'b' }, expected: true },
    { op: 'contains', values: { x: ['a', 'b'] }, cond: { field: 'x', value: 'z' }, expected: false },
    // PARITY: contains against a STRING field is false on the backend (no
    // substring path) — the FE must agree.
    { op: 'contains', values: { x: 'hello world' }, cond: { field: 'x', value: 'world' }, expected: false },
    // PARITY: ordered comparison against a numeric STRING is false (Go toFloat64
    // rejects strings); only real numbers compare.
    { op: 'gt', values: { x: '10' }, cond: { field: 'x', value: 5 }, expected: false },
    { op: 'lt', values: { x: '3' }, cond: { field: 'x', value: 5 }, expected: false },
    { op: 'truthy', values: { x: 'yes' }, cond: { field: 'x' }, expected: true },
    { op: 'truthy', values: { x: '' }, cond: { field: 'x' }, expected: false },
    { op: 'falsy', values: { x: 0 }, cond: { field: 'x' }, expected: true },
    { op: 'falsy', values: { x: 1 }, cond: { field: 'x' }, expected: false },
    { op: 'isSet', values: { x: 'v' }, cond: { field: 'x' }, expected: true },
    { op: 'isSet', values: { x: '' }, cond: { field: 'x' }, expected: false },
    { op: 'isEmpty', values: { x: '' }, cond: { field: 'x' }, expected: true },
    { op: 'isEmpty', values: { x: 'v' }, cond: { field: 'x' }, expected: false },
  ];

  for (const c of cases) {
    it(`${c.op}: ${JSON.stringify(c.cond.value ?? c.values.x)} -> ${c.expected}`, () => {
      expect(
        evalCondition({ ...c.cond, operator: c.op } as Condition, c.values),
      ).toBe(c.expected);
    });
  }

  it('a value comparison against an absent field is false (mirrors Go short-circuit)', () => {
    expect(evalCondition({ field: 'missing', operator: 'eq', value: 1 }, {})).toBe(false);
    expect(evalCondition({ field: 'missing', operator: 'gt', value: 1 }, {})).toBe(false);
  });

  it('isSet/isEmpty resolve directly on absent fields without erroring', () => {
    expect(evalCondition({ field: 'missing', operator: 'isSet' }, {})).toBe(false);
    expect(evalCondition({ field: 'missing', operator: 'isEmpty' }, {})).toBe(true);
  });
});

describe('conditionsHold / isFieldVisible / isFieldRequired', () => {
  it('AND-combines conditions; empty list returns emptyResult', () => {
    const conds: Condition[] = [
      { field: 'a', operator: 'eq', value: 1 },
      { field: 'b', operator: 'eq', value: 2 },
    ];
    expect(conditionsHold(conds, { a: 1, b: 2 }, true)).toBe(true);
    expect(conditionsHold(conds, { a: 1, b: 3 }, true)).toBe(false);
    expect(conditionsHold([], {}, true)).toBe(true);
    expect(conditionsHold(undefined, {}, false)).toBe(false);
  });

  it('isFieldVisible: empty visibleWhen -> visible', () => {
    const f: FormField = { name: 'x', type: 'text', label: 'X', required: false };
    expect(isFieldVisible(f, {})).toBe(true);
  });

  it('isFieldRequired: static, requiredWhen, requiredIf all count', () => {
    const staticReq: FormField = { name: 'x', type: 'text', label: 'X', required: true };
    expect(isFieldRequired(staticReq, {})).toBe(true);

    const reqWhen: FormField = {
      name: 'r',
      type: 'text',
      label: 'R',
      required: false,
      requiredWhen: [{ field: 'flag', operator: 'truthy' }],
    };
    expect(isFieldRequired(reqWhen, { flag: true })).toBe(true);
    expect(isFieldRequired(reqWhen, { flag: false })).toBe(false);

    const reqIf: FormField = {
      name: 's',
      type: 'text',
      label: 'S',
      required: false,
      validation: [{ kind: 'requiredIf', param: [{ field: 'c', operator: 'eq', value: 'US' }] }],
    };
    expect(isFieldRequired(reqIf, { c: 'US' })).toBe(true);
    expect(isFieldRequired(reqIf, { c: 'FR' })).toBe(false);
  });
});

describe('isValueEmpty / isValidCron helpers (mirror Go isEmptyValue / cron shape)', () => {
  it('isValueEmpty matches Go isEmptyValue', () => {
    expect(isValueEmpty(null)).toBe(true);
    expect(isValueEmpty(undefined)).toBe(true);
    expect(isValueEmpty('  ')).toBe(true);
    expect(isValueEmpty([])).toBe(true);
    expect(isValueEmpty({})).toBe(true);
    expect(isValueEmpty('x')).toBe(false);
    expect(isValueEmpty(0)).toBe(false);
    expect(isValueEmpty(false)).toBe(false);
  });

  it('isValidCron accepts 5/6-field cron and rejects garbage', () => {
    expect(isValidCron('0 9 * * 1')).toBe(true);
    expect(isValidCron('*/5 * * * *')).toBe(true);
    expect(isValidCron('0 0 1 1 0 *')).toBe(true);
    expect(isValidCron('not cron')).toBe(false);
    expect(isValidCron('')).toBe(false);
  });
});

describe('buildDynamicZodSchema — legacy backward-compat (flat string labels/options)', () => {
  it('renders/validates the legacy flat 6-type form (string label, string[] options)', () => {
    const legacy: FormField[] = [
      { name: 'notes', type: 'text', label: 'Notes', required: true },
      { name: 'approved', type: 'boolean', label: 'Approved', required: false },
      { name: 'decision', type: 'select', label: 'Decision', required: true, options: ['approve', 'reject'] },
    ];
    const schema = buildDynamicZodSchema(legacy);
    expect(schema.safeParse({ notes: 'ok', decision: 'approve' }).success).toBe(true);
    expect(schema.safeParse({ notes: '', decision: 'approve' }).success).toBe(false);
    expect(schema.safeParse({ notes: 'ok', decision: 'nope' }).success).toBe(false);
  });
});
