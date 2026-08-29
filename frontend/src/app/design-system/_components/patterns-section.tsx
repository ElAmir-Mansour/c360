'use client';

/**
 * Patterns section — how the primitives compose into the three interaction
 * grammars every suite repeats: filter bars, destructive confirm + undo, and
 * validated forms with an accessible error summary.
 */

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { FormErrorSummary } from '@/components/ui/form-error-summary';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { SearchInput } from '@/components/shared/forms/search-input';
import { StatusBadge, genericStatusMap } from '@/components/shared/status-badge';

import { DsSection, Specimen } from './specimen';

/* -------------------------------------------------------------------------- */
/* Pattern: filter bar + active chips + saved views                            */
/* -------------------------------------------------------------------------- */

interface PolicyItem {
  id: string;
  name: string;
  suite: 'lex' | 'cyber' | 'acta';
  status: 'active' | 'draft' | 'disabled';
}

const POLICIES: PolicyItem[] = [
  { id: 'p1', name: 'Contract approval — two rounds', suite: 'lex', status: 'active' },
  { id: 'p2', name: 'DoA signature validation', suite: 'lex', status: 'active' },
  { id: 'p3', name: 'Settlement four-eyes review', suite: 'lex', status: 'draft' },
  { id: 'p4', name: 'DSPM exposure auto-remediation', suite: 'cyber', status: 'active' },
  { id: 'p5', name: 'CTI feed quarantine', suite: 'cyber', status: 'disabled' },
  { id: 'p6', name: 'Evidence retention — WORM', suite: 'acta', status: 'active' },
  { id: 'p7', name: 'Audit export approval', suite: 'acta', status: 'draft' },
];

const SUITE_OPTIONS = [
  { label: 'All suites', value: 'all' },
  { label: 'Lex', value: 'lex' },
  { label: 'Cyber', value: 'cyber' },
  { label: 'Acta', value: 'acta' },
];

const STATUS_OPTIONS = [
  { label: 'Any status', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Draft', value: 'draft' },
  { label: 'Disabled', value: 'disabled' },
];

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 ps-2.5 pe-1 py-0.5 text-xs font-medium text-primary">
      {label}
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onRemove}
        className="rounded-full p-0.5 outline-none transition-colors duration-fast ease-standard hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

function FilterBarPattern() {
  const [search, setSearch] = React.useState('');
  const [suite, setSuite] = React.useState('all');
  const [status, setStatus] = React.useState('all');

  const activeFilters = React.useMemo(() => {
    const params: Record<string, string | string[]> = {};
    if (suite !== 'all') params.suite = suite;
    if (status !== 'all') params.status = status;
    return params;
  }, [suite, status]);

  const results = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return POLICIES.filter(
      (p) =>
        (!q || p.name.toLowerCase().includes(q)) &&
        (suite === 'all' || p.suite === suite) &&
        (status === 'all' || p.status === status),
    );
  }, [search, suite, status]);

  const hasFilters = suite !== 'all' || status !== 'all' || search.trim() !== '';

  return (
    <Specimen
      id="pattern-filters"
      title="Filter bar"
      description="debounced search + scoped selects + removable active chips + saved views; the result count is announced politely"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Search policies…"
            className="w-full sm:w-64"
          />
          <Select value={suite} onValueChange={setSuite}>
            <SelectTrigger className="w-36" aria-label="Filter by suite">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUITE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-36" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setSuite('all');
                setStatus('all');
              }}
            >
              Clear all
            </Button>
          )}
        </div>

        {(suite !== 'all' || status !== 'all') && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
            {suite !== 'all' && (
              <FilterChip label={`Suite: ${suite}`} onRemove={() => setSuite('all')} />
            )}
            {status !== 'all' && (
              <FilterChip label={`Status: ${status}`} onRemove={() => setStatus('all')} />
            )}
          </div>
        )}

        <SavedViewsBar
          namespace="design-system.filter-pattern"
          activeFilters={activeFilters}
          onApply={(params) => {
            setSuite(typeof params.suite === 'string' ? params.suite : 'all');
            setStatus(typeof params.status === 'string' ? params.status : 'all');
          }}
        />

        <p aria-live="polite" className="text-xs text-muted-foreground">
          {results.length} of {POLICIES.length} policies
        </p>

        <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
          {results.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                <p className="text-caption uppercase tracking-wide text-muted-foreground">
                  {p.suite}
                </p>
              </div>
              <StatusBadge status={p.status} map={genericStatusMap} size="sm" />
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No policies match the current filters.
            </li>
          )}
        </ul>
      </div>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* Pattern: destructive confirm + undo toast                                   */
/* -------------------------------------------------------------------------- */

interface UndoItem {
  id: string;
  name: string;
}

const INITIAL_ITEMS: UndoItem[] = [
  { id: 'v1', name: 'Saved view — Breached SLAs' },
  { id: 'v2', name: 'Saved view — My assignments' },
  { id: 'v3', name: 'Saved view — Riyadh entities' },
];

function ConfirmUndoPattern() {
  const [items, setItems] = React.useState<UndoItem[]>(INITIAL_ITEMS);
  const [pending, setPending] = React.useState<UndoItem | null>(null);

  const requestDelete = (item: UndoItem) => setPending(item);

  const performDelete = () => {
    const item = pending;
    if (!item) return;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    toast(`Deleted “${item.name}”`, {
      action: {
        label: 'Undo',
        onClick: () =>
          setItems((prev) =>
            prev.some((i) => i.id === item.id) ? prev : [...prev, item],
          ),
      },
    });
  };

  return (
    <Specimen
      id="pattern-confirm-undo"
      title="Confirm + undo"
      description="destructive actions get an AlertDialog confirm, then an undo window via the toast action — never silent, never irreversible by accident"
      code={`<ConfirmDialog variant="destructive" … onConfirm={remove} />\ntoast('Deleted', { action: { label: 'Undo', onClick: restore } });`}
    >
      <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="truncate text-sm text-foreground">{item.name}</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => requestDelete(item)}
            >
              <Trash2 className="me-1.5 h-4 w-4" aria-hidden />
              Delete
            </Button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            Everything deleted — use the undo action in the toast, or reload.
          </li>
        )}
      </ul>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title="Delete saved view?"
        description={
          pending ? `“${pending.name}” will be removed for everyone on this tenant.` : ''
        }
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={performDelete}
      />
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* Pattern: form with error summary                                            */
/* -------------------------------------------------------------------------- */

const demoFormSchema = z.object({
  fullName: z.string().min(3, 'Enter at least 3 characters'),
  email: z.string().email('Enter a valid email address'),
  severity: z.enum(['critical', 'high', 'medium', 'low'], {
    errorMap: () => ({ message: 'Choose a severity' }),
  }),
  acknowledge: z.literal(true, {
    errorMap: () => ({ message: 'You must acknowledge the policy' }),
  }),
});

type DemoFormValues = z.infer<typeof demoFormSchema>;

const FIELD_LABELS: Record<string, string> = {
  fullName: 'Full name',
  email: 'Work email',
  severity: 'Severity',
  acknowledge: 'Acknowledgement',
};

function FormPattern() {
  const form = useForm<DemoFormValues>({
    resolver: zodResolver(demoFormSchema),
    defaultValues: {
      fullName: '',
      email: '',
      severity: undefined as unknown as DemoFormValues['severity'],
      acknowledge: false as unknown as DemoFormValues['acknowledge'],
    },
    mode: 'onSubmit',
  });

  const [submitted, setSubmitted] = React.useState(false);

  const onSubmit = (values: DemoFormValues) => {
    setSubmitted(true);
    toast.success(`Escalation filed for ${values.fullName}`);
    form.reset();
  };

  return (
    <Specimen
      id="pattern-form"
      title="Form with error summary"
      description="react-hook-form + zod; on invalid submit, FormErrorSummary receives focus and each entry click-focuses its field — inline FormMessage stays per-field"
      code={`<Form {...form}>\n  <FormErrorSummary fieldLabels={FIELD_LABELS} />\n  <FormField name="email" … />\n</Form>`}
    >
      <Form {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit, () => setSubmitted(false))}
          className="mx-auto flex max-w-lg flex-col gap-4"
        >
          <FormErrorSummary fieldLabels={FIELD_LABELS} />

          <FormField
            control={form.control}
            name="fullName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full name</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Sarah Al-Rashid" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Work email</FormLabel>
                <FormControl>
                  <Input type="email" inputMode="email" placeholder="name@company.sa" {...field} />
                </FormControl>
                <FormDescription>Notifications go to this address.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="severity"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Severity</FormLabel>
                <Select onValueChange={field.onChange} value={field.value ?? ''}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose severity" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="critical">Critical</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="acknowledge"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-xl border border-border/70 p-3">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel className="font-normal">
                    I acknowledge the escalation policy
                  </FormLabel>
                  <FormMessage />
                </div>
              </FormItem>
            )}
          />

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                form.reset();
                setSubmitted(false);
              }}
            >
              Reset
            </Button>
            <Button type="submit">Submit escalation</Button>
          </div>

          {submitted && (
            <p aria-live="polite" className="text-end text-xs text-status-success">
              Submitted — see the toast.
            </p>
          )}
        </form>
      </Form>
    </Specimen>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

export function PatternsSection() {
  return (
    <DsSection
      id="patterns"
      title="Patterns"
      description="Composition recipes — the approved way primitives combine for the interactions every suite repeats."
    >
      <FilterBarPattern />
      <div className="grid gap-8 xl:grid-cols-2">
        <ConfirmUndoPattern />
        <FormPattern />
      </div>
    </DsSection>
  );
}
