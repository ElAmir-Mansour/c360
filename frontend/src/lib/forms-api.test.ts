import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  serializeFormDefinitionBody,
  serializeField,
  createFormDefinition,
  updateFormDefinition,
  listFormDefinitions,
  getFormDefinition,
  FORMS_API_BASE,
  type FormDefinitionDraft,
} from './forms-api';
import type { FormDefinition, FormField } from '@/types/forms';

const API_URL = 'http://localhost:8080';

const sampleFields: FormField[] = [
  {
    name: 'reason',
    type: 'text',
    // Mixed shapes: a bare-string label (legacy) MUST normalize to {ar,en}.
    label: 'Reason',
    required: true,
    validation: [
      { kind: 'minLength', param: 3, message: { ar: 'قصير', en: 'Too short' } },
    ],
  },
  {
    name: 'decision',
    type: 'select',
    label: { ar: 'القرار', en: 'Decision' },
    required: true,
    // Legacy string[] options MUST normalize to FormOption[] with bilingual labels.
    options: ['approve', 'reject'],
    visibleWhen: [{ field: 'reason', operator: 'isSet' }],
  },
];

const draft: FormDefinitionDraft = {
  // Row/audit columns that MUST be stripped from the wire body.
  id: 'should-not-appear',
  tenant_id: 'tenant-x',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  version: 4,
  name: 'approval-form',
  locales: ['ar', 'en'],
  default_locale: 'ar',
  fields: sampleFields,
} as FormDefinition;

describe('serializeFormDefinitionBody', () => {
  it('emits EXACTLY {name, locales, default_locale, fields} on create (no id/tenant/timestamps/version)', () => {
    const body = serializeFormDefinitionBody(draft);
    expect(Object.keys(body).sort()).toEqual(
      ['default_locale', 'fields', 'locales', 'name'].sort(),
    );
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('tenant_id');
    expect(body).not.toHaveProperty('created_at');
    expect(body).not.toHaveProperty('updated_at');
    expect(body).not.toHaveProperty('version');
  });

  it('includes version only when requested (update path)', () => {
    const body = serializeFormDefinitionBody(draft, { includeVersion: true });
    expect(body.version).toBe(4);
  });

  it('normalizes a bare-string label to object form {ar, en}', () => {
    const body = serializeFormDefinitionBody(draft);
    expect(body.fields[0].label).toEqual({ ar: 'Reason', en: 'Reason' });
  });

  it('normalizes string[] options to FormOption[] with bilingual object labels', () => {
    const body = serializeFormDefinitionBody(draft);
    expect(body.fields[1].options).toEqual([
      { value: 'approve', label: { ar: 'approve', en: 'approve' } },
      { value: 'reject', label: { ar: 'reject', en: 'reject' } },
    ]);
  });

  it('keeps a validation rule message as an object and carries visibleWhen', () => {
    const body = serializeFormDefinitionBody(draft);
    expect(body.fields[0].validation?.[0]).toEqual({
      kind: 'minLength',
      param: 3,
      message: { ar: 'قصير', en: 'Too short' },
    });
    expect(body.fields[1].visibleWhen).toEqual([{ field: 'reason', operator: 'isSet' }]);
  });

  it('serializeField omits empty optional placeholder/description and blank dir', () => {
    const wire = serializeField({
      name: 'x',
      type: 'text',
      label: { ar: 'أ', en: 'X' },
      required: false,
      placeholder: { ar: '', en: '' },
      description: '',
      dir: '',
    });
    expect(wire).not.toHaveProperty('placeholder');
    expect(wire).not.toHaveProperty('description');
    expect(wire).not.toHaveProperty('dir');
    expect(wire).not.toHaveProperty('validation');
    expect(wire).not.toHaveProperty('visibleWhen');
  });
});

describe('forms-api network serialization', () => {
  let capturedBody: unknown = null;

  // Responses mirror the REAL backend (internal/workflow/handler/form_handler.go):
  // list -> {"forms":[...],"total":n}; create/get/update -> the BARE FormDefinition
  // (no {data} wrapper). The earlier mock returned {data:...} which the backend
  // never emits and which masked a read-path contract break.
  const persisted = { ...(draft as FormDefinition), id: 'new-id', tenant_id: 'tenant-x' };

  const server = setupServer(
    http.get(`${API_URL}${FORMS_API_BASE}`, () =>
      HttpResponse.json({ forms: [persisted], total: 1 }),
    ),
    http.get(`${API_URL}${FORMS_API_BASE}/new-id`, () => HttpResponse.json(persisted)),
    http.post(`${API_URL}${FORMS_API_BASE}`, async ({ request }) => {
      capturedBody = await request.json();
      return HttpResponse.json(persisted, { status: 201 });
    }),
    http.put(`${API_URL}${FORMS_API_BASE}/new-id`, async ({ request }) => {
      capturedBody = await request.json();
      return HttpResponse.json(persisted);
    }),
  );

  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => {
    server.resetHandlers();
    capturedBody = null;
  });
  afterAll(() => server.close());

  it('createFormDefinition POSTs only the allowed keys with object-form labels', async () => {
    await createFormDefinition(draft);

    const body = capturedBody as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ['default_locale', 'fields', 'locales', 'name'].sort(),
    );
    const fields = body.fields as Array<Record<string, unknown>>;
    expect(fields[0].label).toEqual({ ar: 'Reason', en: 'Reason' });
    expect(fields[1].options).toEqual([
      { value: 'approve', label: { ar: 'approve', en: 'approve' } },
      { value: 'reject', label: { ar: 'reject', en: 'reject' } },
    ]);
  });

  it('createFormDefinition returns the bare FormDefinition the backend emits (no {data} unwrap)', async () => {
    const created = await createFormDefinition(draft);
    // Against the real bare-object response, the parsed result is the definition
    // itself — proving the read path matches the backend contract.
    expect(created.id).toBe('new-id');
    expect(created.name).toBe('approval-form');
  });

  it('updateFormDefinition PUTs the body including the version and returns the bare definition', async () => {
    const updated = await updateFormDefinition('new-id', draft);
    const body = capturedBody as Record<string, unknown>;
    expect(body.version).toBe(4);
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('tenant_id');
    expect(updated.id).toBe('new-id');
  });

  it('listFormDefinitions reads the {forms,total} envelope the backend emits', async () => {
    const forms = await listFormDefinitions();
    expect(Array.isArray(forms)).toBe(true);
    expect(forms).toHaveLength(1);
    expect(forms[0].id).toBe('new-id');
  });

  it('getFormDefinition reads a bare FormDefinition response', async () => {
    const fd = await getFormDefinition('new-id');
    expect(fd.id).toBe('new-id');
    expect(fd.name).toBe('approval-form');
  });
});
