'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2, Paperclip, Sparkles, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { useDebounce } from '@/hooks/use-debounce';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatBytes } from '@/lib/format';
import { showApiError } from '@/lib/toast';
import {
  consultationsApi,
  type ArchiveConsultationPayload,
  type AttachConsultationDocumentPayload,
  type ClassifyConsultationPayload,
  type ConsultationPriority,
  type ConsultationType,
  type RespondConsultationPayload,
  type RouteConsultationPayload,
  type StartConsultationApprovalPayload,
} from '@/lib/lex/consultations';
import {
  CONSULTATION_PRIORITY_OPTIONS,
  CONSULTATION_TYPE_OPTIONS,
  type ConsultationLabels,
  useConsultationLabels,
} from './labels';

function FooterButtons({
  labels,
  loading,
  disabled,
  onCancel,
}: {
  labels: ConsultationLabels['dialogs'];
  loading: boolean;
  disabled?: boolean;
  onCancel: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        {labels.cancel}
      </Button>
      <Button type="submit" disabled={loading || disabled}>
        {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
        {labels.submit}
      </Button>
    </DialogFooter>
  );
}

/* ------------------------------------------------------------------------- *
 * Classify dialog.
 * ------------------------------------------------------------------------- */

export function ConsultationClassifyDialog({
  open,
  currentType,
  currentPriority,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  currentType: ConsultationType;
  currentPriority: ConsultationPriority;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: ClassifyConsultationPayload) => void;
}) {
  const L = useConsultationLabels();
  const d = L.dialogs;
  const [type, setType] = useState<ConsultationType>(currentType);
  const [priority, setPriority] = useState<ConsultationPriority>(currentPriority);

  useEffect(() => {
    if (open) {
      setType(currentType);
      setPriority(currentPriority);
    }
  }, [open, currentType, currentPriority]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.classifyTitle}</DialogTitle>
          <DialogDescription>{d.classifyDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ type, priority, notes: '' });
          }}
        >
          <FormField name="type" label={d.type} required>
            <Select value={type} onValueChange={(v) => setType(v as ConsultationType)}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONSULTATION_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {L.filters.typeOptions[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField name="priority" label={d.priority} required>
            <Select value={priority} onValueChange={(v) => setPriority(v as ConsultationPriority)}>
              <SelectTrigger id="priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONSULTATION_PRIORITY_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {L.filters.priorityOptions[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FooterButtons labels={d} loading={loading} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Route dialog (advisor select from directory).
 * ------------------------------------------------------------------------- */

export function ConsultationRouteDialog({
  open,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: RouteConsultationPayload) => void;
}) {
  const L = useConsultationLabels();
  const d = L.dialogs;
  const [advisorId, setAdvisorId] = useState('');
  const [advisorName, setAdvisorName] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Server-side search: `enterpriseApi.users.list` forwards `search` to
  // GET /api/v1/users, so we debounce + re-query rather than load all 200.
  const debouncedSearch = useDebounce(search, 250);

  const usersQuery = useQuery({
    queryKey: ['enterprise-users', 'lex-consultation-route', debouncedSearch],
    queryFn: () =>
      enterpriseApi.users.list({
        page: 1,
        per_page: 50,
        order: 'asc',
        search: debouncedSearch.trim() || undefined,
      }),
    enabled: open,
  });
  const users = usersQuery.data?.data ?? [];

  // Open-consultation counts per advisor → render alongside each name so the
  // dispatcher can route to the least-loaded advisor.
  const workloadQuery = useQuery({
    queryKey: ['lex-consultation-advisor-workload'],
    queryFn: () => consultationsApi.advisorWorkload(),
    enabled: open,
  });
  const workloadById = useMemo(() => {
    const map = new Map<string, number>();
    for (const w of workloadQuery.data ?? []) map.set(w.advisor_id, w.open_count);
    return map;
  }, [workloadQuery.data]);

  useEffect(() => {
    if (open) {
      setAdvisorId('');
      setAdvisorName(null);
      setSearch('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.routeTitle}</DialogTitle>
          <DialogDescription>{d.routeDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              advisor_id: advisorId,
              advisor_name: advisorName,
              notes: '',
            });
          }}
        >
          <FormField name="advisor" label={d.advisor} required>
            <div className="space-y-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={L.advisorPicker.searchPlaceholder}
                aria-label={L.advisorPicker.searchPlaceholder}
              />
              <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                {usersQuery.isLoading ? (
                  <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                    <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  </div>
                ) : users.length === 0 ? (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {d.advisorPlaceholder}
                  </div>
                ) : (
                  <ul role="listbox" aria-label={d.advisor}>
                    {users.map((u) => {
                      const name = userDisplayName(u);
                      const openCount = workloadById.get(u.id);
                      const selected = u.id === advisorId;
                      return (
                        <li key={u.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              setAdvisorId(u.id);
                              setAdvisorName(name);
                            }}
                            className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm hover:bg-muted focus:bg-muted focus:outline-none ${
                              selected ? 'bg-primary/10 text-primary' : ''
                            }`}
                          >
                            <span className="truncate">{name}</span>
                            {openCount !== undefined ? (
                              <Badge variant="secondary" className="shrink-0">
                                {L.advisorPicker.openCount(openCount)}
                              </Badge>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </FormField>
          <FooterButtons
            labels={d}
            loading={loading}
            disabled={!advisorId}
            onCancel={() => onOpenChange(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Respond dialog.
 * ------------------------------------------------------------------------- */

export function ConsultationRespondDialog({
  open,
  loading,
  consultationId,
  slaResponseDueAt,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  /**
   * Optional consultation id used by the in-dialog "Draft with AI" action
   * (POST /consultations/{id}/respond/draft). Optional so existing callers that
   * predate the AI-draft affordance keep working unchanged — the button is only
   * shown when an id is supplied.
   */
  consultationId?: string;
  slaResponseDueAt?: string | null;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: RespondConsultationPayload) => void;
}) {
  const L = useConsultationLabels();
  const d = L.dialogs;
  const { locale } = useLocaleOrDefault();
  const [response, setResponse] = useState('');
  const [useAi, setUseAi] = useState(false);
  // Tracks whether the CURRENT textarea content originated from the AI draft
  // (cleared as soon as the user edits it manually).
  const [fromAi, setFromAi] = useState(false);
  const [lateJustification, setLateJustification] = useState('');
  const isLate = Boolean(
    slaResponseDueAt && Date.now() > new Date(slaResponseDueAt).getTime(),
  );

  useEffect(() => {
    if (open) {
      setResponse('');
      setUseAi(false);
      setFromAi(false);
      setLateJustification('');
    }
  }, [open]);

  const draftMutation = useMutation({
    mutationFn: () => {
      if (!consultationId) throw new Error('missing consultation id');
      return consultationsApi.draftResponse(consultationId, { locale });
    },
    onSuccess: (res) => {
      setResponse(res.draft);
      setFromAi(true);
      // The user now has a concrete draft to review/edit, so the "let the
      // backend draft on submit" checkbox is no longer meaningful.
      setUseAi(false);
    },
    // 409 (status must be `routed`) / 422 (no drafter) surface as a toast; the
    // dialog stays open and usable for a manual response.
    onError: showApiError,
  });

  const drafting = draftMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.respondTitle}</DialogTitle>
          <DialogDescription>{d.respondDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (isLate && !lateJustification.trim()) return;
            onSubmit({
              response: response.trim(),
              use_ai: useAi,
              notes: '',
              ...(isLate ? { late_justification: lateJustification.trim() } : {}),
            });
          }}
        >
          {consultationId ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={drafting}
                onClick={() => draftMutation.mutate()}
              >
                {drafting ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="me-1.5 h-4 w-4" />
                )}
                {drafting
                  ? L.aiDraft.drafting
                  : fromAi
                    ? L.aiDraft.regenerate
                    : L.aiDraft.draftWithAi}
              </Button>
              {fromAi ? (
                <Badge variant="default">
                  <Sparkles className="me-1 h-3 w-3" />
                  {L.aiDraft.aiGenerated}
                </Badge>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Checkbox
              id="use_ai"
              checked={useAi}
              onCheckedChange={(v) => setUseAi(v === true)}
            />
            <Label htmlFor="use_ai" className="cursor-pointer text-sm">
              {d.useAi}
            </Label>
          </div>
          <FormField name="response" label={fromAi ? L.aiDraft.editDraft : d.response} required={!useAi}>
            <Textarea
              id="response"
              value={response}
              onChange={(e) => {
                setResponse(e.target.value);
                if (fromAi) setFromAi(false);
              }}
              placeholder={d.responsePlaceholder}
              rows={5}
            />
          </FormField>
          {isLate ? (
            <div className="space-y-2 rounded-lg border border-warning-300 bg-warning-50/60 p-3 dark:bg-warning-700/10">
              <Label htmlFor="consultation-dialog-late-justification">
                {locale === 'ar' ? 'مبرر تجاوز اتفاقية مستوى الخدمة' : 'Late SLA justification'}{' '}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="consultation-dialog-late-justification"
                value={lateJustification}
                onChange={(event) => setLateJustification(event.target.value)}
                placeholder={locale === 'ar' ? 'اشرح سبب تسجيل الرد بعد الموعد المحدد.' : 'Explain why the response was recorded after its SLA deadline.'}
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                {locale === 'ar'
                  ? 'يظهر فقط لمدير الإدارة القانونية ومدير العقود.'
                  : 'Visible only to the Legal Director and Contracts Manager.'}
              </p>
            </div>
          ) : null}
          <FooterButtons
            labels={d}
            loading={loading}
            disabled={drafting || (!useAi && response.trim().length === 0) || (isLate && !lateJustification.trim())}
            onCancel={() => onOpenChange(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Archive dialog.
 * ------------------------------------------------------------------------- */

export function ConsultationArchiveDialog({
  open,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: ArchiveConsultationPayload) => void;
}) {
  const L = useConsultationLabels();
  const d = L.dialogs;
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.archiveTitle}</DialogTitle>
          <DialogDescription>{d.archiveDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ reason: reason.trim() });
          }}
        >
          <FormField name="reason" label={d.reason}>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={d.reasonPlaceholder}
              rows={3}
            />
          </FormField>
          <FooterButtons labels={d} loading={loading} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Attach document dialog.
 * ------------------------------------------------------------------------- */

export function ConsultationAttachDialog({
  open,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: AttachConsultationDocumentPayload) => void;
}) {
  const L = useConsultationLabels();
  const d = L.dialogs;
  // Real file picker → Files service. After upload we hold the returned
  // FileRecord and submit the SAME { file_id, file_name, file_size, kind }
  // contract (plus content_type, which the payload already supports).
  const [uploaded, setUploaded] = useState<{
    fileId: string;
    fileName: string;
    fileSize: number;
    contentType: string | null;
  } | null>(null);
  const [kind, setKind] = useState('attachment');

  useEffect(() => {
    if (open) {
      setUploaded(null);
      setKind('attachment');
    }
  }, [open]);

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      enterpriseApi.files.upload(file, {
        suite: 'lex',
        entity_type: 'consultation_document',
        lifecycle_policy: 'standard',
      }),
    onSuccess: (record) => {
      setUploaded({
        fileId: record.id,
        fileName: record.original_name,
        fileSize: record.size_bytes,
        contentType: record.content_type ?? null,
      });
    },
    onError: showApiError,
  });

  const uploading = uploadMutation.isPending;
  const hasFile = uploaded !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.attachTitle}</DialogTitle>
          <DialogDescription>{d.attachDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!uploaded) return;
            onSubmit({
              file_id: uploaded.fileId,
              file_name: uploaded.fileName,
              file_size: uploaded.fileSize,
              content_type: uploaded.contentType,
              kind: kind.trim() || 'attachment',
            });
          }}
        >
          <FormField name="file" label={d.fileName} required>
            {hasFile ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate text-sm font-medium">{uploaded.fileName}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(uploaded.fileSize)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setUploaded(null)}
                  aria-label={L.filePicker.noFileSelected}
                  className="shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-sm hover:border-muted-foreground/50 ${
                  uploading ? 'pointer-events-none opacity-60' : ''
                }`}
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <Upload className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
                <span className="text-muted-foreground">
                  {uploading ? L.filePicker.upload : L.filePicker.browseFiles}
                </span>
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadMutation.mutate(file);
                    e.target.value = '';
                  }}
                />
              </label>
            )}
          </FormField>
          <FormField name="kind" label={d.kind}>
            <Input
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder={d.kindPlaceholder}
            />
          </FormField>
          <FooterButtons
            labels={d}
            loading={loading}
            disabled={!hasFile || uploading}
            onCancel={() => onOpenChange(false)}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Start approval dialog.
 * ------------------------------------------------------------------------- */

export function ConsultationApprovalDialog({
  open,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: StartConsultationApprovalPayload) => void;
}) {
  const L = useConsultationLabels();
  const d = L.dialogs;
  const [approverRole, setApproverRole] = useState('legal_director');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) {
      setApproverRole('legal_director');
      setNotes('');
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.approvalTitle}</DialogTitle>
          <DialogDescription>{d.approvalDescription}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ approver_role: approverRole.trim(), notes: notes.trim() });
          }}
        >
          {/*
            The approver is fixed by policy: legal-director is the only role granted
            lex:consultation:approve in the SoD matrix, so the backend addresses the
            single approval task to that constant and ignores any caller-supplied
            role. Render it read-only rather than as an editable input — an editable
            free-text here is misleading (silently dropped) and, if it were honoured,
            any other value would produce a task no user could clear.
          */}
          <FormField name="approver_role" label={d.approverRole}>
            <Input id="approver_role" value={approverRole} readOnly disabled />
          </FormField>
          <FormField name="notes" label={d.notes}>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={d.notesPlaceholder}
              rows={3}
            />
          </FormField>
          <FooterButtons labels={d} loading={loading} onCancel={() => onOpenChange(false)} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
