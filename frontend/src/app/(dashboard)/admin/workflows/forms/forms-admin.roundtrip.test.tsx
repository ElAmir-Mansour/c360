/**
 * THE ROUND-TRIP PROOF for the Forms admin authoring loop:
 *
 *   design -> save (canonical /forms API) -> reload -> render -> submit -> validate
 *
 * It drives the REAL editor ({@link FormDefinitionDialog}) and the REAL runtime
 * renderer ({@link TaskFormRenderer}) against MSW handlers that mirror the EXACT
 * backend envelopes emitted by internal/workflow/handler/form_handler.go:
 *
 *   GET  /api/v1/workflows/forms        -> {"forms":[...],"total":n}   (ListForms)
 *   POST /api/v1/workflows/forms        -> the BARE FormDefinition      (CreateForm, 201)
 *   GET  /api/v1/workflows/forms/{id}   -> the BARE FormDefinition      (GetForm)
 *   PUT  /api/v1/workflows/forms/{id}   -> the BARE FormDefinition      (UpdateForm)
 *
 * NOTE: there is NO {data} wrapper anywhere — the single-resource endpoints
 * return the bare object, the list returns the {forms,total} envelope. Mocking a
 * {data} wrapper here would mask the very read-path contract this test guards.
 *
 * The authored form carries everything the loop must survive:
 *   - a bilingual {ar,en} label on the required field
 *   - a required field
 *   - a minLength=3 validation rule
 *   - a SECOND field gated by a visibleWhen conditional
 *
 * Assertions:
 *   1. SAVE captures a POST body that is EXACTLY {name, locales, default_locale,
 *      fields} (no id/tenant_id/timestamps/version) with object-form {ar,en}
 *      labels and the rule / visibleWhen carried through.
 *   2. RELOAD via the list + get handlers returns the bare definition.
 *   3. RENDER with TaskFormRenderer shows the EN label under locale=en and the AR
 *      label with dir="rtl" under locale=ar.
 *   4. Submitting with the required field empty is BLOCKED (onSubmit NOT called).
 *   5. Submitting valid data calls onSubmit with the entered value.
 */
import { createRef } from 'react';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getLocaleDirection, type AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';
import { FormDefinitionDialog } from './_components/form-definition-dialog';
import { TaskFormRenderer } from '../tasks/components/task-form-renderer';
import {
  listFormDefinitions,
  getFormDefinition,
  FORMS_API_BASE,
} from '@/lib/forms-api';
import type { FormDefinition } from '@/types/forms';

// This test proves the form authoring/runtime data contract, not Radix's focus
// trap. Keeping the real dialog and opening a nested Radix Select can recurse
// between two focus scopes in jsdom; use structural dialog primitives here so
// the real editor and real Select controls remain under test.
vi.mock('@/components/ui/dialog', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  const container = (tag: 'div' | 'h2' | 'p' | 'button', role?: string) => {
    const Component = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
      ({ children, ...props }, ref) =>
        React.createElement(tag, { ...props, ...(role ? { role } : {}), ref }, children),
    );
    Component.displayName = `MockDialog${tag}`;
    return Component;
  };

  return {
    Dialog: ({ open = true, children }: { open?: boolean; children: React.ReactNode }) =>
      open ? React.createElement(React.Fragment, null, children) : null,
    DialogPortal: ({ children }: { children: React.ReactNode }) => children,
    DialogOverlay: container('div'),
    DialogClose: container('button'),
    DialogTrigger: container('button'),
    DialogContent: container('div', 'dialog'),
    DialogHeader: container('div'),
    DialogFooter: container('div'),
    DialogTitle: container('h2'),
    DialogDescription: container('p'),
  };
});

const API_URL = 'http://localhost:8080';

// ── MSW state: the in-memory "persisted" definition the backend would store. ──
let capturedPostBody: Record<string, unknown> | null = null;
let stored: FormDefinition | null = null;

const server = setupServer(
  // ListForms -> {"forms":[...],"total":n}
  http.get(`${API_URL}${FORMS_API_BASE}`, () =>
    HttpResponse.json({
      forms: stored ? [stored] : [],
      total: stored ? 1 : 0,
    }),
  ),
  // CreateForm -> the BARE FormDefinition (201). Captures the wire body and
  // assigns the server-owned columns the handler would set.
  http.post(`${API_URL}${FORMS_API_BASE}`, async ({ request }) => {
    capturedPostBody = (await request.json()) as Record<string, unknown>;
    stored = {
      id: 'form-123',
      tenant_id: 'tenant-x',
      version: 1,
      created_at: '2026-06-14T00:00:00Z',
      updated_at: '2026-06-14T00:00:00Z',
      name: capturedPostBody.name as string,
      locales: capturedPostBody.locales as string[],
      default_locale: capturedPostBody.default_locale as string,
      fields: capturedPostBody.fields as FormDefinition['fields'],
    };
    return HttpResponse.json(stored, { status: 201 });
  }),
  // GetForm -> the BARE FormDefinition.
  http.get(`${API_URL}${FORMS_API_BASE}/form-123`, () =>
    stored ? HttpResponse.json(stored) : new HttpResponse(null, { status: 404 }),
  ),
  // UpdateForm -> the BARE FormDefinition.
  http.put(`${API_URL}${FORMS_API_BASE}/form-123`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    stored = { ...(stored as FormDefinition), ...(body as Partial<FormDefinition>) };
    return HttpResponse.json(stored);
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  capturedPostBody = null;
  stored = null;
});
afterAll(() => server.close());

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** Renders the editor dialog under QueryClient + a (dashboard) en LocaleProvider. */
function renderEditor() {
  const queryClient = createClient();
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <LocaleProvider
        locale="en"
        direction={getLocaleDirection('en')}
        messages={getMessages('en')}
      >
        <FormDefinitionDialog
          open
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, onSaved };
}

/**
 * Renders the runtime renderer for the reloaded definition in a given locale,
 * with an external submit button that submits the renderer's own <form> via its
 * formRef (the renderer owns the <form>; the live task UI submits it the same way).
 */
function renderRuntime(
  fields: FormDefinition['fields'],
  locale: AppLocale,
  onSubmit: (data: Record<string, unknown>) => void,
) {
  const formRef = createRef<HTMLFormElement>();
  return render(
    <LocaleProvider
      locale={locale}
      direction={getLocaleDirection(locale)}
      messages={getMessages(locale)}
    >
      <TaskFormRenderer
        fields={fields}
        readOnly={false}
        onSubmit={onSubmit}
        formRef={formRef}
      />
      <button type="button" onClick={() => formRef.current?.requestSubmit()}>
        submit
      </button>
    </LocaleProvider>,
  );
}

describe('Forms admin round-trip: design -> save -> reload -> render -> submit -> validate', () => {
  it('authors a bilingual+required+minLength+conditional form, SAVES the exact wire body, then RELOADS and RENDERS it under en/ar with working validation', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderEditor();

    // ── DESIGN: name + a required text field with a bilingual label + minLength ──
    await user.type(screen.getByLabelText('Form name'), 'change-approval');

    // Add the first field via the real FormSchemaBuilder control.
    await user.click(screen.getByRole('button', { name: /add field/i }));

    // Name the field `reason`.
    const fieldNameInput = await screen.findByLabelText('Field name');
    await user.clear(fieldNameInput);
    await user.type(fieldNameInput, 'reason');

    // Bilingual {ar,en} label.
    await user.type(screen.getByLabelText('Label Arabic'), 'السبب');
    await user.type(screen.getByLabelText('Label English'), 'Reason');

    // Required toggle ON.
    await user.click(screen.getByLabelText('Required'));

    // Add a minLength validation rule (param=3).
    await addSelectOption(user, screen.getByLabelText('Add validation rule'), 'Min length');
    const ruleParam = await screen.findByLabelText('Rule minLength param');
    await user.clear(ruleParam);
    await user.type(ruleParam, '3');

    // ── DESIGN: a SECOND field gated by a visibleWhen conditional on `reason`. ──
    await user.click(screen.getByRole('button', { name: /add field/i }));

    // The newly-added field's editor is open; its Field name input is the 2nd one.
    const allFieldNames = screen.getAllByLabelText('Field name');
    const secondFieldName = allFieldNames[allFieldNames.length - 1];
    await user.clear(secondFieldName);
    await user.type(secondFieldName, 'details');
    // Give it an EN label so it can be asserted later if needed.
    const enLabels = screen.getAllByLabelText('Label English');
    await user.type(enLabels[enLabels.length - 1], 'Details');

    // Add the visibleWhen condition: details visible when `reason` is set.
    const addConditionButtons = screen.getAllByRole('button', { name: /add condition/i });
    await user.click(addConditionButtons[addConditionButtons.length - 1]);
    const conditionFields = screen.getAllByLabelText('Condition field');
    await user.type(conditionFields[conditionFields.length - 1], 'reason');
    const operatorTriggers = screen.getAllByLabelText('Condition operator');
    await addSelectOption(user, operatorTriggers[operatorTriggers.length - 1], 'is set');

    // ── SAVE ──
    await user.click(screen.getByRole('button', { name: /create form/i }));

    // The dialog closes on a successful save.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    // ── ASSERT 1: the captured POST body is EXACTLY the allowed keys, with
    //    object-form bilingual labels and the rule / visibleWhen carried over. ──
    const body = capturedPostBody as Record<string, unknown>;
    expect(body).not.toBeNull();
    expect(Object.keys(body).sort()).toEqual(
      ['default_locale', 'fields', 'locales', 'name'].sort(),
    );
    expect(body).not.toHaveProperty('id');
    expect(body).not.toHaveProperty('tenant_id');
    expect(body).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('created_at');
    expect(body).not.toHaveProperty('updated_at');

    expect(body.name).toBe('change-approval');
    expect(body.locales).toEqual(['ar', 'en']);
    expect(body.default_locale).toBe('ar');

    const sentFields = body.fields as Array<Record<string, unknown>>;
    expect(sentFields).toHaveLength(2);

    const reason = sentFields.find((f) => f.name === 'reason')!;
    // Object-form bilingual label (NOT a bare string).
    expect(reason.label).toEqual({ ar: 'السبب', en: 'Reason' });
    expect(reason.required).toBe(true);
    expect(reason.validation).toEqual([{ kind: 'minLength', param: 3 }]);

    const details = sentFields.find((f) => f.name === 'details')!;
    expect(details.visibleWhen).toEqual([{ field: 'reason', operator: 'isSet' }]);

    // ── RELOAD: read the persisted definition back through the real client,
    //    proving the read path matches the {forms,total} + bare-object contract. ──
    const list = await listFormDefinitions();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('form-123');

    const reloaded = await getFormDefinition('form-123');
    expect(reloaded.name).toBe('change-approval');
    expect(reloaded.fields).toHaveLength(2);
    const reloadedReason = reloaded.fields.find((f) => f.name === 'reason')!;
    expect(reloadedReason.label).toEqual({ ar: 'السبب', en: 'Reason' });

    // ── RENDER (en): the EN label renders, the AR label does not. ──
    const en = renderRuntime(reloaded.fields, 'en', vi.fn());
    expect(within(en.container).getByText('Reason')).toBeInTheDocument();
    expect(within(en.container).queryByText('السبب')).not.toBeInTheDocument();
    expect(en.container.querySelector('form')).toHaveAttribute('dir', 'ltr');
    en.unmount();

    // ── RENDER (ar): the AR label renders with dir="rtl". ──
    const ar = renderRuntime(reloaded.fields, 'ar', vi.fn());
    expect(within(ar.container).getByText('السبب')).toBeInTheDocument();
    expect(within(ar.container).queryByText('Reason')).not.toBeInTheDocument();
    expect(ar.container.querySelector('form')).toHaveAttribute('dir', 'rtl');
    ar.unmount();
  });

  it('the reloaded form BLOCKS submit when the required field is empty and ALLOWS it once valid', async () => {
    const user = userEvent.setup();

    // Seed the store as if a previous create had persisted the definition.
    stored = {
      id: 'form-123',
      tenant_id: 'tenant-x',
      version: 1,
      name: 'change-approval',
      locales: ['ar', 'en'],
      default_locale: 'ar',
      fields: [
        {
          name: 'reason',
          type: 'text',
          label: { ar: 'السبب', en: 'Reason' },
          required: true,
          validation: [{ kind: 'minLength', param: 3 }],
        },
        {
          name: 'details',
          type: 'text',
          label: { ar: 'تفاصيل', en: 'Details' },
          required: false,
          visibleWhen: [{ field: 'reason', operator: 'isSet' }],
        },
      ],
    };

    const reloaded = await getFormDefinition('form-123');
    const onSubmit = vi.fn();
    renderRuntime(reloaded.fields, 'en', onSubmit);

    // Empty required field -> submit is BLOCKED.
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());

    // Too-short value still fails the minLength rule -> still BLOCKED.
    await user.type(screen.getByLabelText(/reason/i), 'ab');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => expect(onSubmit).not.toHaveBeenCalled());

    // Valid value -> submit FIRES with the entered data.
    await user.clear(screen.getByLabelText(/reason/i));
    await user.type(screen.getByLabelText(/reason/i), 'High risk change');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ reason: 'High risk change' });
  });
});

/**
 * addSelectOption opens a Radix <Select> by clicking its trigger and chooses the
 * option whose accessible name matches `optionName`. Radix renders the listbox
 * in a portal, so we query the document-level option role.
 */
async function addSelectOption(
  user: ReturnType<typeof userEvent.setup>,
  trigger: HTMLElement,
  optionName: string | RegExp,
) {
  await user.click(trigger);
  const option = await screen.findByRole('option', { name: optionName });
  await user.click(option);
}
