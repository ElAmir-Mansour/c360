'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ChevronsUpDown, HandHelping, Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useSupportLabels } from '@/app/(dashboard)/lex/inbox/_lib/support-i18n';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AsyncRecordPicker } from '@/components/shared/forms/async-record-picker';
import { useLexFormat } from '@/lib/lex/ksa';
import { cn } from '@/lib/utils';
import {
  lexSupportApi,
  lexSupportSubjectApi,
  type CreateLexSupportRequest,
  type LexSupportPriority,
  type LexSupportSubjectType,
  type LocalizedText,
} from '@/lib/lex/support';

const OPEN_SUPPORT_EVENT = 'clario360:lex-support:open';
export const LEX_SUPPORT_QUERY_KEY = ['lex-support-requests'] as const;

export interface LexSupportContext {
  subjectType: LexSupportSubjectType;
  subjectId: string;
}

/** Order shown in the record-type selector; mirrors the accepted subject types. */
const SUBJECT_TYPES: readonly LexSupportSubjectType[] = [
  'case',
  'contract',
  'consultation',
  'matter',
  'investigation',
  'request',
] as const;

/** Sentinel for "no linked record" — Radix Select rejects an empty item value. */
const NO_SUBJECT = 'none';

/**
 * Imperative seam for any case/contract/consultation detail action. The global
 * host owns the dialog, so callers do not duplicate queries or form state.
 */
export function openLexSupportComposer(context?: LexSupportContext): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<LexSupportContext | undefined>(OPEN_SUPPORT_EVENT, {
      detail: context,
    }),
  );
}

const LEX_RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Resolve the contextual pair from a UUID-backed Lex detail URL; static workspaces do not bind context. */
export function supportContextFromPathname(pathname: string): LexSupportContext | undefined {
  const patterns: Array<[RegExp, LexSupportSubjectType]> = [
    [/^\/lex\/cases\/([^/]+)(?:\/|$)/, 'case'],
    [/^\/lex\/contracts\/([^/]+)(?:\/|$)/, 'contract'],
    [/^\/lex\/consultations\/([^/]+)(?:\/|$)/, 'consultation'],
    [/^\/lex\/matters\/([^/]+)(?:\/|$)/, 'matter'],
    [/^\/lex\/investigations\/([^/]+)(?:\/|$)/, 'investigation'],
    [/^\/lex\/service-desk\/([^/]+)(?:\/|$)/, 'request'],
  ];
  for (const [pattern, subjectType] of patterns) {
    const match = pattern.exec(pathname);
    const subjectId = match?.[1];
    if (subjectId && LEX_RECORD_ID.test(subjectId)) {
      return { subjectType, subjectId };
    }
  }
  return undefined;
}

export function AskForSupportButton({
  context,
  compact = false,
  className,
}: {
  context?: LexSupportContext;
  compact?: boolean;
  className?: string;
}) {
  const labels = useSupportLabels();
  return (
    <Button
      type="button"
      variant="secondary"
      size={compact ? 'icon' : 'default'}
      className={className}
      aria-label={labels.ask}
      title={compact ? labels.ask : undefined}
      onClick={() => openLexSupportComposer(context)}
    >
      <HandHelping className="h-4 w-4" aria-hidden />
      {compact ? <span className="sr-only">{labels.ask}</span> : labels.ask}
    </Button>
  );
}

function localize(value: LocalizedText, locale: string): string {
  return (locale === 'ar' ? value.ar : value.en) || value.en || value.ar;
}

function displayName(person: { first_name: string; last_name: string }): string {
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim();
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

interface SearchablePickerOption {
  value: string;
  primary: string;
  secondary?: string;
  avatarUrl?: string | null;
  initials?: string;
  kind: 'entity' | 'member';
}

function SearchablePicker({
  id,
  value,
  options,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  disabled,
  invalid,
  describedBy,
  direction,
  onChange,
}: {
  id: string;
  value: string;
  options: SearchablePickerOption[];
  placeholder: string;
  searchPlaceholder: string;
  emptyMessage: string;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  direction: 'ltr' | 'rtl';
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          disabled={disabled}
          className="h-auto min-h-10 w-full justify-between gap-2 px-3 py-2 text-start font-normal"
        >
          <span className={cn('min-w-0 flex-1', !selected && 'text-muted-foreground')}>
            {selected ? <PickerOption option={selected} compact /> : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent dir={direction} align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  keywords={[option.primary, option.secondary ?? '']}
                  className="gap-2 py-2"
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <PickerOption option={option} />
                  <Check className={cn('ms-auto h-4 w-4 shrink-0', value === option.value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function PickerOption({ option, compact = false }: { option: SearchablePickerOption; compact?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {option.kind === 'member' ? (
        <Avatar className={compact ? 'h-6 w-6' : 'h-8 w-8'}>
          {option.avatarUrl ? <AvatarImage src={option.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-xs">{option.initials || '—'}</AvatarFallback>
        </Avatar>
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
          <Building2 className="h-4 w-4 text-primary" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{option.primary}</span>
        {!compact && option.secondary ? <span className="block truncate text-xs text-muted-foreground">{option.secondary}</span> : null}
      </span>
    </span>
  );
}

export function SupportComposerHost() {
  const labels = useSupportLabels();
  const { locale, direction } = useLocaleOrDefault();
  const format = useLexFormat();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  /**
   * The linked record. Seeded from the caller/URL context when the dialog is
   * opened, then fully user-owned: the picker can re-point it or clear it.
   */
  const [linkType, setLinkType] = useState<LexSupportSubjectType | ''>('');
  const [linkId, setLinkId] = useState('');
  const [entityId, setEntityId] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<LexSupportPriority>('normal');
  const [businessDays, setBusinessDays] = useState('');
  const [previewBusinessDays, setPreviewBusinessDays] = useState<number>();
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<LexSupportContext | undefined>).detail;
      setLinkType(detail?.subjectType ?? '');
      setLinkId(detail?.subjectId ?? '');
      setOpen(true);
    };
    window.addEventListener(OPEN_SUPPORT_EVENT, handleOpen);
    return () => window.removeEventListener(OPEN_SUPPORT_EVENT, handleOpen);
  }, []);

  const entitiesQuery = useQuery({
    queryKey: ['lex-support-directory', 'entities'],
    queryFn: () => lexSupportApi.directory(),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });
  const membersQuery = useQuery({
    queryKey: ['lex-support-directory', 'members', entityId],
    queryFn: () => lexSupportApi.directory(entityId),
    enabled: open && Boolean(entityId),
    staleTime: 30_000,
    retry: false,
  });

  /**
   * Lazy, fail-soft lookup of the linked record's human identifier. A rejection
   * — including a 403 on a record the requester cannot read — is never surfaced
   * as an error and never blocks submission; the bare type label is shown.
   */
  const linkedRecordQuery = useQuery({
    queryKey: ['lex-support-subject', linkType, linkId],
    queryFn: () => lexSupportSubjectApi.resolve(linkType as LexSupportSubjectType, linkId),
    enabled: open && Boolean(linkType) && Boolean(linkId),
    staleTime: 60_000,
    retry: false,
  });
  const linkedNumber = linkedRecordQuery.data?.number?.trim() || '';
  /** Trigger label for an already-bound record: number, else title, else the bare type. */
  const linkedLabel =
    linkedNumber ||
    (linkedRecordQuery.data ? localize(linkedRecordQuery.data.title, locale) : '') ||
    (linkType ? labels.subjectType[linkType] : '');

  const parsedBusinessDays = businessDays.trim() ? Number(businessDays) : undefined;
  const invalidBusinessDays = parsedBusinessDays !== undefined && (
    !Number.isInteger(parsedBusinessDays) ||
    parsedBusinessDays < 1 ||
    parsedBusinessDays > 366
  );

  useEffect(() => {
    if (!open || invalidBusinessDays || parsedBusinessDays === undefined) {
      setPreviewBusinessDays(undefined);
      return;
    }
    const timer = window.setTimeout(() => setPreviewBusinessDays(parsedBusinessDays), 300);
    return () => window.clearTimeout(timer);
  }, [invalidBusinessDays, open, parsedBusinessDays]);

  const expiryPreviewQuery = useQuery({
    queryKey: ['lex-support-expiry-preview', previewBusinessDays],
    queryFn: () => lexSupportApi.previewExpiry(previewBusinessDays!),
    enabled: open && previewBusinessDays !== undefined,
    staleTime: 0,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateLexSupportRequest) => lexSupportApi.create(payload),
    onSuccess: async (request) => {
      await queryClient.invalidateQueries({ queryKey: LEX_SUPPORT_QUERY_KEY });
      toast.success(labels.composer.success, {
        description: request.expires_at
          ? labels.composer.expires(
              format.formatDate(request.expires_at, { dateStyle: 'medium', timeStyle: 'short' }),
            )
          : labels.composer.noExpiry,
      });
      resetAndClose();
    },
    onError: () => toast.error(labels.composer.failure),
  });

  const subjectError = submitted
    ? !subject.trim()
      ? labels.composer.required
      : characterCount(subject.trim()) > 200
        ? labels.composer.subjectTooLong
        : null
    : null;
  const bodyError = submitted && characterCount(body) > 10_000
    ? labels.composer.bodyTooLong
    : null;
  const businessDaysError = submitted && invalidBusinessDays
    ? labels.composer.businessDaysInvalid
    : null;
  const entityError = submitted && !entityId ? labels.composer.required : null;
  const memberError = submitted && !assigneeId ? labels.composer.required : null;
  // The link is optional, but a half-chosen link is not: the API stores the
  // type and the id together or not at all.
  const linkError = submitted && linkType && !linkId ? labels.composer.linkedRecordRequired : null;

  function resetAndClose() {
    setOpen(false);
    setLinkType('');
    setLinkId('');
    setEntityId('');
    setAssigneeId('');
    setSubject('');
    setBody('');
    setPriority('normal');
    setBusinessDays('');
    setPreviewBusinessDays(undefined);
    setSubmitted(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next && !mutation.isPending) resetAndClose();
    else setOpen(next);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (
      !entityId ||
      !assigneeId ||
      (linkType && !linkId) ||
      !subject.trim() ||
      characterCount(subject.trim()) > 200 ||
      characterCount(body) > 10_000 ||
      invalidBusinessDays ||
      (parsedBusinessDays !== undefined && (
        expiryPreviewQuery.isPending ||
        expiryPreviewQuery.isError ||
        expiryPreviewQuery.data?.business_days !== parsedBusinessDays
      ))
    ) return;
    mutation.mutate({
      target_entity_id: entityId,
      assignee_id: assigneeId,
      subject: subject.trim(),
      body: body.trim() || undefined,
      priority,
      business_days: parsedBusinessDays,
      subject_type: linkType && linkId ? linkType : undefined,
      subject_id: linkType && linkId ? linkId : undefined,
    });
  }

  const members = membersQuery.data?.members ?? [];
  const memberPlaceholder = !entityId
    ? labels.composer.memberDisabled
    : membersQuery.isLoading
      ? labels.loading
      : labels.composer.memberPlaceholder;
  const entityOptions: SearchablePickerOption[] = (entitiesQuery.data?.entities ?? []).map((entity) => ({
    value: entity.id,
    primary: localize(entity.name, locale),
    secondary: entity.code,
    kind: 'entity',
  }));
  const memberOptions: SearchablePickerOption[] = members.map((member) => ({
    value: member.user_id,
    primary: displayName(member) || member.employee_code,
    secondary: [localize(member.title, locale), member.employee_code].filter(Boolean).join(' · '),
    avatarUrl: member.avatar_url,
    initials: [member.first_name, member.last_name].filter(Boolean).map((part) => part.slice(0, 1)).join('').slice(0, 2).toUpperCase(),
    kind: 'member',
  }));

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir={direction} lang={locale} className="max-w-2xl">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <HandHelping className="h-5 w-5 text-primary" aria-hidden />
            {labels.composer.title}
          </DialogTitle>
          <DialogDescription>{labels.composer.description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-5" onSubmit={handleSubmit} noValidate>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{labels.composer.linkedRecord}</legend>
            {linkType ? (
              <p className="badge-base badge-neutral w-fit" role="status">
                {linkedNumber ? (
                  <>
                    {labels.composer.contextRecord(labels.subjectType[linkType])}{' '}
                    <bdi dir="ltr">{linkedNumber}</bdi>
                  </>
                ) : (
                  labels.composer.context(labels.subjectType[linkType])
                )}
              </p>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
              <Select
                value={linkType || NO_SUBJECT}
                onValueChange={(value) => {
                  setLinkType(value === NO_SUBJECT ? '' : (value as LexSupportSubjectType));
                  setLinkId('');
                }}
              >
                <SelectTrigger id="support-link-type" aria-label={labels.composer.linkedRecordType}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUBJECT}>{labels.composer.linkedRecordNone}</SelectItem>
                  {SUBJECT_TYPES.map((value) => (
                    <SelectItem key={value} value={value}>{labels.subjectType[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AsyncRecordPicker
                id="support-link-record"
                ariaLabel={labels.composer.linkedRecordPicker}
                queryKey={['lex-support-subject-search', linkType, locale]}
                loadOptions={async (search) => {
                  if (!linkType) return [];
                  const records = await lexSupportSubjectApi.search(linkType, search);
                  // Seed the resolver cache so selecting a listed record shows
                  // its number immediately instead of re-fetching it.
                  for (const record of records) {
                    queryClient.setQueryData(
                      ['lex-support-subject', record.subject_type, record.subject_id],
                      record,
                    );
                  }
                  return records.map((record) => {
                    const title = localize(record.title, locale);
                    return {
                      value: record.subject_id,
                      label: record.number || title,
                      description: record.number ? title || undefined : undefined,
                    };
                  });
                }}
                value={linkId}
                onChange={(value) => {
                  setLinkId(value);
                  // Clearing the record removes the link outright rather than
                  // stranding a record type with nothing attached to it.
                  if (!value) setLinkType('');
                }}
                enabled={Boolean(linkType)}
                allowClear
                selectedLabel={linkedLabel || undefined}
                labels={{
                  select: labels.composer.linkedRecordSelect,
                  search: labels.composer.linkedRecordSearch,
                  loading: labels.composer.linkedRecordLoading,
                  empty: labels.composer.linkedRecordEmpty,
                  loadError: labels.composer.linkedRecordError,
                  retry: labels.retry,
                  clear: labels.composer.linkedRecordClear,
                }}
              />
            </div>
            {linkError ? (
              // The picker owns its own aria-label and takes no describedBy, so
              // the error announces itself instead.
              <p role="alert" className="text-xs text-destructive">{linkError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{labels.composer.linkedRecordHint}</p>
            )}
          </fieldset>

          {entitiesQuery.isError ? (
            <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <p>{labels.composer.directoryError}</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2 gap-2"
                onClick={() => entitiesQuery.refetch()}
              >
                <RotateCw className="h-4 w-4" aria-hidden />
                {labels.retry}
              </Button>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="support-entity">{labels.composer.entity}</Label>
              <SearchablePicker
                id="support-entity"
                value={entityId}
                options={entityOptions}
                placeholder={entitiesQuery.isLoading ? labels.loading : labels.composer.entityPlaceholder}
                searchPlaceholder={labels.composer.entitySearch}
                emptyMessage={labels.composer.noEntities}
                direction={direction}
                invalid={Boolean(entityError)}
                describedBy={entityError ? 'support-entity-error' : undefined}
                onChange={(value) => {
                  setEntityId(value);
                  setAssigneeId('');
                }}
                disabled={entitiesQuery.isLoading || entitiesQuery.isError}
              />
              {entityError ? <p id="support-entity-error" className="text-xs text-destructive">{entityError}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="support-assignee">{labels.composer.member}</Label>
              <SearchablePicker
                id="support-assignee"
                value={assigneeId}
                options={memberOptions}
                placeholder={memberPlaceholder}
                searchPlaceholder={labels.composer.memberSearch}
                emptyMessage={labels.composer.noMembers}
                direction={direction}
                invalid={Boolean(memberError)}
                describedBy={memberError ? 'support-assignee-error' : undefined}
                onChange={setAssigneeId}
                disabled={!entityId || membersQuery.isLoading || membersQuery.isError || members.length === 0}
              />
              {membersQuery.isError ? <p className="text-xs text-destructive">{labels.composer.directoryError}</p> : null}
              {!membersQuery.isLoading && entityId && !membersQuery.isError && members.length === 0 ? (
                <p className="text-xs text-muted-foreground">{labels.composer.noMembers}</p>
              ) : null}
              {memberError ? <p id="support-assignee-error" className="text-xs text-destructive">{memberError}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-subject">{labels.composer.subject}</Label>
            <Input
              id="support-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              maxLength={201}
              aria-invalid={Boolean(subjectError)}
              aria-describedby={subjectError ? 'support-subject-error' : undefined}
              placeholder={labels.composer.subjectPlaceholder}
            />
            {subjectError ? <p id="support-subject-error" className="text-xs text-destructive">{subjectError}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="support-body">{labels.composer.body}</Label>
            <Textarea
              id="support-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={labels.composer.bodyPlaceholder}
              maxLength={10_000}
              aria-invalid={Boolean(bodyError)}
              aria-describedby={bodyError ? 'support-body-error' : undefined}
            />
            {bodyError ? <p id="support-body-error" className="text-xs text-destructive">{bodyError}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="support-priority">{labels.composer.priority}</Label>
              <Select value={priority} onValueChange={(value) => setPriority(value as LexSupportPriority)}>
                <SelectTrigger id="support-priority"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(['low', 'normal', 'high'] as const).map((value) => (
                    <SelectItem key={value} value={value}>{labels.priority[value]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="support-days">{labels.composer.businessDays}</Label>
              <Input
                id="support-days"
                type="number"
                inputMode="numeric"
                min={1}
                max={366}
                step={1}
                value={businessDays}
                onChange={(event) => setBusinessDays(event.target.value)}
                placeholder={labels.composer.noExpiry}
                aria-invalid={Boolean(businessDaysError)}
                aria-describedby={businessDaysError ? 'support-days-error support-days-hint' : 'support-days-hint'}
              />
              <p id="support-days-hint" className="text-xs text-muted-foreground">{labels.composer.businessDaysHint}</p>
              {businessDaysError ? <p id="support-days-error" className="text-xs text-destructive">{businessDaysError}</p> : null}
              {!invalidBusinessDays && parsedBusinessDays !== undefined && expiryPreviewQuery.isPending ? (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin" aria-hidden />
                  {labels.composer.previewLoading}
                </p>
              ) : null}
              {!invalidBusinessDays && parsedBusinessDays !== undefined && expiryPreviewQuery.isError ? (
                <div role="alert" className="text-xs text-destructive">
                  <p>{labels.composer.previewError}</p>
                  <Button type="button" variant="ghost" size="sm" className="mt-1 gap-2" onClick={() => expiryPreviewQuery.refetch()}>
                    <RotateCw className="h-3.5 w-3.5" aria-hidden />
                    {labels.retry}
                  </Button>
                </div>
              ) : null}
              {expiryPreviewQuery.data && expiryPreviewQuery.data.business_days === parsedBusinessDays ? (
                <p role="status" className="text-xs font-medium text-primary">
                  {labels.composer.previewExpires(format.formatDate(expiryPreviewQuery.data.expires_at, { dateStyle: 'medium', timeStyle: 'short' }))}
                </p>
              ) : null}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={resetAndClose}>
              {labels.composer.cancel}
            </Button>
            <Button
              type="submit"
              variant="secondary"
              className="gap-2"
              disabled={
                mutation.isPending ||
                entitiesQuery.isError ||
                (!invalidBusinessDays && parsedBusinessDays !== undefined && (
                  expiryPreviewQuery.isPending ||
                  expiryPreviewQuery.isError ||
                  expiryPreviewQuery.data?.business_days !== parsedBusinessDays
                ))
              }
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden /> : <HandHelping className="h-4 w-4" aria-hidden />}
              {mutation.isPending ? labels.composer.submitting : labels.composer.submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
