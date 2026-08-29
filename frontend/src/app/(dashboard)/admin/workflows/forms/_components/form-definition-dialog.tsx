'use client';

/**
 * FormDefinitionDialog authors a canonical {@link FormDefinition} end-to-end:
 * name + locales + default_locale + the fields[] (via the shared
 * {@link FormSchemaBuilder}), with a LIVE PREVIEW pane that renders the
 * currently-authored fields through the SAME runtime component task assignees
 * use ({@link TaskFormRenderer}). This closes the design -> render loop inside
 * the editor: every keystroke in the builder is reflected in the preview.
 *
 * Save serializes through forms-api (create/update), which strips the row/audit
 * columns and normalizes every localized label to the canonical `{ar,en}`
 * object form the backend's DisallowUnknownFields decoder requires.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import '../../../_lib/admin-i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LocaleProvider, useT } from '@/components/providers/locale-provider';
import { getLocaleDirection, type AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';
import { FormSchemaBuilder } from '../../definitions/[defId]/designer/components/form-schema-builder';
import { TaskFormRenderer } from '../../tasks/components/task-form-renderer';
import { useCreateForm, useUpdateForm } from '@/hooks/use-forms';
import { showError } from '@/lib/toast';
import type { Condition, FormDefinition, FormField } from '@/types/forms';

/**
 * sanitizeConditions strips the canonical Condition down to EXACTLY the keys the
 * backend `forms.Condition` accepts — `{field, operator, value?}`. The shared
 * ConditionBuilder (reused from the workflow designer) injects a legacy
 * `logic: 'and'|'or'` member for transition chaining; the form-engine Condition
 * has no such field, and the backend decodes the body with DisallowUnknownFields,
 * so an un-stripped `logic` would 400 the create/update. We drop it here, at the
 * authoring boundary, so the wire body matches the contract.
 */
function sanitizeConditions(conditions?: Condition[]): Condition[] | undefined {
  if (!conditions || conditions.length === 0) return undefined;
  return conditions.map((c) => {
    const clean: Condition = { field: c.field, operator: c.operator };
    if (c.value !== undefined) clean.value = c.value;
    return clean;
  });
}

/** sanitizeFields drops legacy/non-canonical keys from every field's conditions. */
function sanitizeFields(fields: FormField[]): FormField[] {
  return fields.map((f) => {
    const next: FormField = { ...f };
    const visibleWhen = sanitizeConditions(f.visibleWhen);
    const requiredWhen = sanitizeConditions(f.requiredWhen);
    if (visibleWhen) next.visibleWhen = visibleWhen;
    else delete next.visibleWhen;
    if (requiredWhen) next.requiredWhen = requiredWhen;
    else delete next.requiredWhen;
    if (f.validation && f.validation.length > 0) {
      next.validation = f.validation.map((rule) => {
        const when = sanitizeConditions(rule.when);
        return when ? { ...rule, when } : { ...rule, when: undefined };
      });
    }
    return next;
  });
}

interface FormDefinitionDialogProps {
  /** When set, the dialog edits this definition; otherwise it creates a new one. */
  form?: FormDefinition | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful save (the parent typically refetches the list). */
  onSaved?: () => void;
}

/** The two platform locales the engine supports, in canonical order. */
const SUPPORTED: AppLocale[] = ['ar', 'en'];

export function FormDefinitionDialog({
  form,
  open,
  onOpenChange,
  onSaved,
}: FormDefinitionDialogProps) {
  const t = useT('admin');
  const isEdit = Boolean(form);

  const [name, setName] = useState('');
  const [locales, setLocales] = useState<string[]>(['ar', 'en']);
  const [defaultLocale, setDefaultLocale] = useState('ar');
  const [fields, setFields] = useState<FormField[]>([]);
  // The preview pane resolves bilingual labels in this locale so the author can
  // flip between AR (RTL) and EN (LTR) and SEE the rendered, validated form.
  const [previewLocale, setPreviewLocale] = useState<AppLocale>('en');

  const createMutation = useCreateForm();
  const updateMutation = useUpdateForm();
  const isPending = createMutation.isPending || updateMutation.isPending;

  // Re-seed local state whenever the dialog opens (or the target form changes).
  useEffect(() => {
    if (!open) return;
    if (form) {
      setName(form.name ?? '');
      setLocales(form.locales?.length ? [...form.locales] : ['ar', 'en']);
      setDefaultLocale(form.default_locale || 'ar');
      setFields(form.fields ? structuredClone(form.fields) : []);
    } else {
      setName('');
      setLocales(['ar', 'en']);
      setDefaultLocale('ar');
      setFields([]);
    }
  }, [open, form]);

  const canSave = name.trim().length > 0 && !isPending;

  const handleSave = async () => {
    if (name.trim().length === 0) {
      showError(t('fd.nameRequired'));
      return;
    }
    // The authored content uses the CANONICAL field shape (labels may be a bare
    // string OR {ar,en}); forms-api normalizes every label to object form on the
    // wire. We pass it as a FormDefinitionDraft — for edit we spread the existing
    // row so the server-owned columns travel along (and are stripped by the
    // serializer); for create only the content keys exist.
    const content: Pick<
      FormDefinition,
      'name' | 'locales' | 'default_locale' | 'fields'
    > = {
      name: name.trim(),
      locales,
      default_locale: defaultLocale,
      // Strip the ConditionBuilder's legacy `logic` key so the wire conditions
      // match the backend's `{field, operator, value?}` contract.
      fields: sanitizeFields(fields),
    };
    try {
      if (isEdit && form) {
        // Carry the persisted version so the server can version / lock the change.
        await updateMutation.mutateAsync({
          id: form.id,
          draft: { ...form, ...content },
        });
      } else {
        await createMutation.mutateAsync(content as FormDefinition);
      }
      onSaved?.();
      onOpenChange(false);
    } catch {
      // Errors surface as toasts inside the mutation hooks; keep the dialog open.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? t('fd.editTitle') : t('fd.newTitle')}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('fd.editDesc', { name: form?.name ?? '', version: form?.version ?? '' })
              : t('fd.newDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-2">
          {/* ── DESIGN PANE ── */}
          <ScrollArea className="rounded-md border p-3">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="form-name" className="text-xs">
                  {t('fd.formName')}
                  <span className="text-destructive ms-0.5">*</span>
                </Label>
                <Input
                  id="form-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('fd.namePlaceholder')}
                  disabled={isPending}
                  className="h-8 text-sm font-mono"
                  aria-label={t('fd.formNameAria')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="form-locales" className="text-xs">
                    {t('fd.locales')}
                  </Label>
                  <Input
                    id="form-locales"
                    value={locales.join(', ')}
                    onChange={(e) =>
                      setLocales(
                        e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      )
                    }
                    placeholder="ar, en"
                    disabled={isPending}
                    className="h-8 text-sm"
                    aria-label={t('fd.locales')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="form-default-locale" className="text-xs">
                    {t('fd.defaultLocale')}
                  </Label>
                  <Input
                    id="form-default-locale"
                    value={defaultLocale}
                    onChange={(e) => setDefaultLocale(e.target.value.trim())}
                    placeholder="ar"
                    disabled={isPending}
                    className="h-8 text-sm"
                    aria-label={t('fd.defaultLocaleAria')}
                  />
                </div>
              </div>

              <FormSchemaBuilder
                fields={fields}
                onChange={setFields}
                readOnly={isPending}
              />
            </div>
          </ScrollArea>

          {/* ── LIVE PREVIEW PANE ── */}
          <div className="flex flex-col overflow-hidden rounded-md border">
            <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
              <span className="text-xs font-medium text-muted-foreground">
                {t('fd.livePreview')}
              </span>
              <div className="flex items-center gap-1">
                <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                {SUPPORTED.map((loc) => (
                  <Button
                    key={loc}
                    type="button"
                    size="sm"
                    variant={previewLocale === loc ? 'default' : 'outline'}
                    className="h-6 px-2 text-overline uppercase"
                    onClick={() => setPreviewLocale(loc)}
                    aria-label={t('fd.previewIn', { loc })}
                    aria-pressed={previewLocale === loc}
                  >
                    {loc}
                  </Button>
                ))}
              </div>
            </div>
            <ScrollArea className="flex-1 p-3">
              <FormPreview fields={fields} locale={previewLocale} />
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('fd.cancel')}
          </Button>
          <Button type="button" onClick={handleSave} disabled={!canSave}>
            {isPending ? t('fd.saving') : isEdit ? t('fd.saveChanges') : t('fd.createForm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface FormPreviewProps {
  fields: FormField[];
  locale: AppLocale;
}

/**
 * FormPreview renders the authored fields through the real {@link TaskFormRenderer}
 * under a locale-scoped LocaleProvider, so the preview honours bilingual labels,
 * RTL, conditional visibility and validation exactly as the live task form does.
 * Submission is local-only: it surfaces the validated payload so the author can
 * confirm the field names / shapes before saving.
 */
export function FormPreview({ fields, locale }: FormPreviewProps) {
  const t = useT('admin');
  const [lastSubmit, setLastSubmit] = useState<Record<string, unknown> | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Re-mount the renderer on locale / field-shape change so RHF defaults and the
  // dir attribute pick up the new schema. (TaskFormRenderer derives dir + schema
  // from the active locale via useLocaleOrDefault.)
  const previewKey = useMemo(
    () =>
      `${locale}:${fields.length}:${fields
        .map((f) => `${f.name}:${f.type}`)
        .join('|')}`,
    [locale, fields],
  );

  if (fields.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('fd.noFieldsYet')}
      </p>
    );
  }

  return (
    <LocaleProvider
      locale={locale}
      direction={getLocaleDirection(locale)}
      messages={getMessages(locale)}
    >
      <TaskFormRenderer
        key={previewKey}
        formRef={formRef}
        fields={fields}
        readOnly={false}
        onSubmit={(data) => setLastSubmit(data)}
      />
      <div className="mt-3 flex flex-col gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={() => formRef.current?.requestSubmit()}
        >
          {t('fd.testSubmit')}
        </Button>
        {lastSubmit && (
          <pre className="max-h-40 overflow-auto rounded bg-muted/50 p-2 text-overline">
            {JSON.stringify(lastSubmit, null, 2)}
          </pre>
        )}
      </div>
    </LocaleProvider>
  );
}
