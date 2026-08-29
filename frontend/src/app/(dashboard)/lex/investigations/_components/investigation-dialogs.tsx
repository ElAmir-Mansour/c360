"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { FileText, Loader2, Trash2, UploadCloud } from "lucide-react";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/shared/forms/form-field";
import { LexRecordPicker } from "@/components/lex/lex-record-picker";
import { Progress } from "@/components/ui/progress";
import { enterpriseApi } from "@/lib/enterprise/api";
import { showApiError } from "@/lib/toast";
import type { FileRecord } from "@/types/models";
import { ROLE_ROSTER } from "../../admin/role-matrix/_lib/legal-role-matrix";
import type {
  AddInvestigationPartyPayload,
  InvestigationParty,
  InvestigationStatus,
  RecordInvestigationRecommendationsPayload,
  RecordInvestigationResultsPayload,
  RecordInvestigationStatementPayload,
  StartInvestigationApprovalPayload,
  UploadInvestigationEvidencePayload,
} from "@/lib/lex/investigations";
import {
  INVESTIGATION_PARTY_ROLE_OPTIONS,
  type InvestigationLabels,
  useInvestigationLabels,
} from "./labels";

const EVIDENCE_TYPE_OPTIONS = [
  "document",
  "email",
  "image",
  "video",
  "audio",
  "statement",
  "system_log",
  "financial_record",
  "physical",
  "other",
] as const;

const EVIDENCE_SOURCE_OPTIONS = [
  "direct_upload",
  "existing_file",
  "case_document",
  "email_archive",
  "interview",
  "system_export",
  "physical_collection",
  "other",
] as const;

const MAX_EVIDENCE_FILE_BYTES = 25 * 1024 * 1024;
const EVIDENCE_FILE_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.png,.jpg,.jpeg,.gif,.webp,.mp3,.wav,.m4a,.mp4,.mov,.webm";

function PlainFormProvider({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

function FooterButtons({
  labels,
  loading,
  disabled,
  submitLabel,
  onCancel,
}: {
  labels: InvestigationLabels["dialogs"];
  loading: boolean;
  disabled?: boolean;
  submitLabel?: string;
  onCancel: () => void;
}) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        {labels.cancel}
      </Button>
      <Button type="submit" disabled={loading || disabled}>
        {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
        {submitLabel ?? labels.submit}
      </Button>
    </DialogFooter>
  );
}

/* ------------------------------------------------------------------------- *
 * Status dialog.
 * ------------------------------------------------------------------------- */

export function InvestigationStatusDialog({
  open,
  options,
  slaDeadline,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  options: InvestigationStatus[];
  slaDeadline?: string | null;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (status: InvestigationStatus, lateJustification?: string) => void;
}) {
  const L = useInvestigationLabels();
  const { locale } = useLocaleOrDefault();
  const d = L.dialogs;
  const [value, setValue] = useState<InvestigationStatus | "">("");
  const [lateJustification, setLateJustification] = useState("");
  const isLate =
    (value === "closed" || value === "cancelled") &&
    Boolean(slaDeadline && Date.now() > new Date(slaDeadline).getTime());

  useEffect(() => {
    if (open) {
      setValue(options[0] ?? "");
      setLateJustification("");
    }
  }, [open, options]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.statusTitle}</DialogTitle>
          <DialogDescription>{d.statusDescription}</DialogDescription>
        </DialogHeader>
        <PlainFormProvider>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (value) onSubmit(value, isLate ? lateJustification.trim() : undefined);
            }}
          >
            <FormField name="status" label={d.statusLabel} required>
              <Select
                value={value}
                onValueChange={(v) => setValue(v as InvestigationStatus)}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {L.filters.statusOptions[o] ?? o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            {isLate ? (
              <div className="space-y-1.5">
                <Label>
                  {locale === "ar" ? "مبرر تجاوز اتفاقية مستوى الخدمة" : "SLA delay justification"}
                </Label>
                <Textarea
                  rows={4}
                  value={lateJustification}
                  onChange={(event) => setLateJustification(event.target.value)}
                  placeholder={
                    locale === "ar"
                      ? "اشرح سبب إنهاء التحقيق بعد الموعد المحدد في اتفاقية مستوى الخدمة."
                      : "Explain why the investigation ended after its SLA deadline."
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {locale === "ar"
                    ? "يظهر هذا المبرر فقط للمدير القانوني ومدير القضايا القانونية."
                    : "Visible only to the Legal Director and Legal Cases Manager."}
                </p>
              </div>
            ) : null}
            <FooterButtons
              labels={d}
              loading={loading}
              disabled={!value || (isLate && !lateJustification.trim())}
              onCancel={() => onOpenChange(false)}
            />
          </form>
        </PlainFormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Party dialog.
 * ------------------------------------------------------------------------- */

export function InvestigationPartyDialog({
  open,
  loading,
  party,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  party?: InvestigationParty | null;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: AddInvestigationPartyPayload) => void;
}) {
  const L = useInvestigationLabels();
  const d = L.dialogs;
  const isEdit = Boolean(party);
  const [role, setRole] =
    useState<AddInvestigationPartyPayload["role"]>("witness");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [contact, setContact] = useState("");

  useEffect(() => {
    if (open) {
      setRole(party?.role ?? "witness");
      setName(party?.name ?? "");
      setIdentifier(party?.identifier ?? "");
      setContact(party?.contact ?? "");
    }
  }, [open, party]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? d.partyEditTitle : d.partyTitle}</DialogTitle>
          <DialogDescription>
            {isEdit ? d.partyEditDescription : d.partyDescription}
          </DialogDescription>
        </DialogHeader>
        <PlainFormProvider>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit({
                role,
                name: name.trim(),
                identifier: identifier.trim() || null,
                contact: contact.trim() || null,
                metadata: party?.metadata ?? undefined,
              });
            }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="role" label={d.partyRole} required>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as typeof role)}
                >
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVESTIGATION_PARTY_ROLE_OPTIONS.map((o) => (
                      <SelectItem key={o} value={o}>
                        {L.filters.roleOptions[o]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="name" label={d.partyName} required>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={d.partyNamePlaceholder}
                />
              </FormField>
            </div>
            <FormField name="identifier" label={d.partyIdentifier}>
              <Input
                id="identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={d.partyIdentifierPlaceholder}
              />
            </FormField>
            <FormField name="contact" label={d.partyContact}>
              <Input
                id="contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={d.partyContactPlaceholder}
              />
            </FormField>
            <FooterButtons
              labels={d}
              loading={loading}
              disabled={name.trim().length === 0}
              submitLabel={isEdit ? d.save : d.submit}
              onCancel={() => onOpenChange(false)}
            />
          </form>
        </PlainFormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Statement dialog.
 * ------------------------------------------------------------------------- */

export function InvestigationStatementDialog({
  open,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: RecordInvestigationStatementPayload) => void;
}) {
  const L = useInvestigationLabels();
  const d = L.dialogs;
  const [deponentName, setDeponentName] = useState("");
  const [statement, setStatement] = useState("");
  const [takenBy, setTakenBy] = useState("");
  const [takenAt, setTakenAt] = useState("");

  useEffect(() => {
    if (open) {
      setDeponentName("");
      setStatement("");
      setTakenBy("");
      setTakenAt("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.statementTitle}</DialogTitle>
          <DialogDescription>{d.statementDescription}</DialogDescription>
        </DialogHeader>
        <PlainFormProvider>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit({
                deponent_name: deponentName.trim(),
                statement: statement.trim(),
                taken_by: takenBy.trim(),
                taken_at: takenAt
                  ? new Date(`${takenAt}T00:00:00Z`).toISOString()
                  : null,
              });
            }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="deponent_name" label={d.deponentName} required>
                <Input
                  id="deponent_name"
                  value={deponentName}
                  onChange={(e) => setDeponentName(e.target.value)}
                  placeholder={d.deponentNamePlaceholder}
                />
              </FormField>
              <FormField name="taken_by" label={d.takenBy} required>
                <Input
                  id="taken_by"
                  value={takenBy}
                  onChange={(e) => setTakenBy(e.target.value)}
                  placeholder={d.takenByPlaceholder}
                />
              </FormField>
            </div>
            <FormField name="taken_at" label={d.takenAt}>
              <Input
                id="taken_at"
                type="date"
                value={takenAt}
                onChange={(e) => setTakenAt(e.target.value)}
              />
            </FormField>
            <FormField name="statement" label={d.statementBody} required>
              <Textarea
                id="statement"
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder={d.statementBodyPlaceholder}
                rows={4}
              />
            </FormField>
            <FooterButtons
              labels={d}
              loading={loading}
              disabled={
                deponentName.trim().length === 0 ||
                statement.trim().length === 0
              }
              onCancel={() => onOpenChange(false)}
            />
          </form>
        </PlainFormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Evidence dialog.
 * ------------------------------------------------------------------------- */

export function InvestigationEvidenceDialog({
  investigationId,
  open,
  loading,
  onOpenChange,
  onSubmit,
}: {
  investigationId: string;
  open: boolean;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: UploadInvestigationEvidencePayload) => void;
}) {
  const L = useInvestigationLabels();
  const d = L.dialogs;
  const [title, setTitle] = useState("");
  const [evidenceType, setEvidenceType] =
    useState<(typeof EVIDENCE_TYPE_OPTIONS)[number]>("document");
  const [description, setDescription] = useState("");
  const [collectedBy, setCollectedBy] = useState("");
  const [collectedAt, setCollectedAt] = useState("");
  const [fileId, setFileId] = useState("");
  const [uploadedFile, setUploadedFile] = useState<FileRecord | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [source, setSource] =
    useState<(typeof EVIDENCE_SOURCE_OPTIONS)[number]>("existing_file");
  const [previewNote, setPreviewNote] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTitle("");
      setEvidenceType("document");
      setDescription("");
      setCollectedBy("");
      setCollectedAt(new Date().toISOString().slice(0, 10));
      setFileId("");
      setUploadedFile(null);
      setUploadingFile(false);
      setUploadProgress(0);
      setUploadError("");
      setDocumentName("");
      setSource("existing_file");
      setPreviewNote("");
    }
  }, [open]);

  const uploadProof = async (file: File) => {
    setUploadError("");
    if (file.size > MAX_EVIDENCE_FILE_BYTES) {
      setUploadError(d.evidenceFileTooLarge);
      return;
    }

    setUploadingFile(true);
    setUploadProgress(0);
    try {
      const record = await enterpriseApi.files.upload(
        file,
        {
          suite: "lex",
          entity_type: "legal_investigation",
          entity_id: investigationId,
          lifecycle_policy: "audit_retention",
        },
        setUploadProgress,
      );
      setUploadedFile(record);
      setFileId(record.id);
      setDocumentName(record.original_name);
      setTitle((current) => current.trim() || record.original_name);
      setSource("direct_upload");
    } catch (error) {
      setUploadError(d.evidenceUploadFailed);
      showApiError(error);
    } finally {
      setUploadingFile(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.evidenceTitle}</DialogTitle>
          <DialogDescription>{d.evidenceDescription}</DialogDescription>
        </DialogHeader>
        <PlainFormProvider>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit({
                title: title.trim(),
                evidence_type: evidenceType,
                description: description.trim(),
                collected_by: collectedBy.trim(),
                collected_at: collectedAt
                  ? new Date(`${collectedAt}T00:00:00Z`).toISOString()
                  : null,
                file_id: fileId.trim() || null,
                metadata: {
                  source,
                  document_name: documentName.trim() || null,
                  preview_note: previewNote.trim() || null,
                  capture_mode: uploadedFile
                    ? "direct_upload"
                    : fileId.trim()
                      ? "file_reference"
                      : "manual_reference",
                  file_size_bytes: uploadedFile?.size_bytes ?? null,
                  content_type: uploadedFile?.content_type ?? null,
                  checksum_sha256: uploadedFile?.checksum_sha256 ?? null,
                  virus_scan_status: uploadedFile?.virus_scan_status ?? null,
                },
              });
            }}
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="title" label={d.evidenceTitleField} required>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={d.evidenceTitlePlaceholder}
                />
              </FormField>
              <FormField
                name="evidence_type"
                label={d.evidenceTypeField}
                required
              >
                <Select
                  value={evidenceType}
                  onValueChange={(value) =>
                    setEvidenceType(
                      value as (typeof EVIDENCE_TYPE_OPTIONS)[number],
                    )
                  }
                >
                  <SelectTrigger id="evidence_type">
                    <SelectValue placeholder={d.evidenceTypePlaceholder} />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_TYPE_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {d.evidenceTypeOptions[option] ?? option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <section className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-4">
                <h3 className="text-sm font-semibold">
                  {d.evidenceWorkspaceTitle}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {d.evidenceWorkspaceDescription}
                </p>
              </div>

              <div className="mb-4 rounded-lg border border-dashed border-primary/40 bg-background p-4">
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept={EVIDENCE_FILE_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadProof(file);
                    event.target.value = "";
                  }}
                  disabled={uploadingFile || loading}
                />
                {uploadedFile ? (
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm font-semibold"
                        title={uploadedFile.original_name}
                      >
                        {uploadedFile.original_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {(uploadedFile.size_bytes / (1024 * 1024)).toFixed(2)}{" "}
                        MB
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setUploadedFile(null);
                        setFileId("");
                        setDocumentName("");
                        setSource("existing_file");
                      }}
                      aria-label={d.evidenceRemoveUpload}
                      title={d.evidenceRemoveUpload}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <UploadCloud className="h-7 w-7 text-primary" aria-hidden />
                    <div>
                      <p className="text-sm font-semibold">
                        {d.evidenceUploadTitle}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {d.evidenceUploadHint}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={uploadingFile || loading}
                    >
                      {uploadingFile ? (
                        <Loader2
                          className="me-1.5 h-4 w-4 animate-spin"
                          aria-hidden
                        />
                      ) : (
                        <UploadCloud className="me-1.5 h-4 w-4" aria-hidden />
                      )}
                      {uploadingFile
                        ? d.evidenceUploading(uploadProgress)
                        : d.evidenceUploadButton}
                    </Button>
                  </div>
                )}
                {uploadingFile ? (
                  <Progress
                    value={uploadProgress}
                    className="mt-3 h-1.5"
                    aria-label={d.evidenceUploading(uploadProgress)}
                  />
                ) : null}
                {uploadError ? (
                  <p
                    className="mt-2 text-xs font-medium text-destructive"
                    role="alert"
                  >
                    {uploadError}
                  </p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  name="file_id"
                  label={d.fileId}
                  description={d.evidencePickerHint}
                >
                  <LexRecordPicker
                    id="file_id"
                    kind="file"
                    ariaLabel={d.fileId}
                    value={fileId}
                    onChange={(value, option) => {
                      setFileId(value);
                      setUploadedFile(null);
                      setSource(value ? "existing_file" : "other");
                      if (option?.label) setDocumentName(option.label);
                    }}
                    enabled={open}
                    allowClear
                    labels={{
                      select: d.fileIdPlaceholder,
                      search: d.evidencePickerHint,
                    }}
                  />
                </FormField>
                <FormField name="document_name" label={d.evidenceDocumentName}>
                  <Input
                    id="document_name"
                    value={documentName}
                    onChange={(e) => setDocumentName(e.target.value)}
                    placeholder={d.evidenceDocumentNamePlaceholder}
                  />
                </FormField>
                <FormField name="source" label={d.evidenceSource}>
                  <Select
                    value={source}
                    onValueChange={(value) =>
                      setSource(
                        value as (typeof EVIDENCE_SOURCE_OPTIONS)[number],
                      )
                    }
                  >
                    <SelectTrigger id="source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_SOURCE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {d.evidenceSourceOptions[option] ?? option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField name="collected_at" label={d.collectedAt}>
                  <Input
                    id="collected_at"
                    type="date"
                    value={collectedAt}
                    onChange={(e) => setCollectedAt(e.target.value)}
                  />
                </FormField>
                <FormField name="collected_by" label={d.collectedBy}>
                  <Input
                    id="collected_by"
                    value={collectedBy}
                    onChange={(e) => setCollectedBy(e.target.value)}
                    placeholder={d.collectedByPlaceholder}
                  />
                </FormField>
                <FormField
                  name="preview_note"
                  label={d.evidencePreviewNote}
                  description={d.evidenceReuseHint}
                >
                  <Input
                    id="preview_note"
                    value={previewNote}
                    onChange={(e) => setPreviewNote(e.target.value)}
                    placeholder={d.evidencePreviewNotePlaceholder}
                  />
                </FormField>
              </div>
            </section>

            <FormField name="description" label={d.evidenceDescField}>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={d.evidenceDescPlaceholder}
                rows={3}
              />
            </FormField>
            <FooterButtons
              labels={d}
              loading={loading}
              disabled={
                uploadingFile ||
                title.trim().length === 0 ||
                evidenceType.trim().length === 0
              }
              onCancel={() => onOpenChange(false)}
            />
          </form>
        </PlainFormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Results (findings) dialog.
 * ------------------------------------------------------------------------- */

export function InvestigationResultsDialog({
  open,
  initialFindings,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  initialFindings?: string;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: RecordInvestigationResultsPayload) => void;
}) {
  const L = useInvestigationLabels();
  const d = L.dialogs;
  const [findings, setFindings] = useState("");
  const [generateAi, setGenerateAi] = useState(false);
  const [approvalReady, setApprovalReady] = useState(false);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (open) {
      setFindings(initialFindings ?? "");
      setGenerateAi(false);
      setApprovalReady(false);
      setPrompt("");
    }
  }, [open, initialFindings]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.resultsTitle}</DialogTitle>
          <DialogDescription>{d.resultsDescription}</DialogDescription>
        </DialogHeader>
        <PlainFormProvider>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit({
                findings: findings.trim(),
                generate_ai: generateAi,
                findings_prompt: prompt.trim(),
                metadata: {
                  brief_workspace: {
                    section: "findings",
                    mode: generateAi ? "ai_regenerate" : "manual_accept",
                    approval_ready: approvalReady,
                    prompt_style: "investigation_brief",
                  },
                },
              });
            }}
          >
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="generate_ai"
                  checked={generateAi}
                  onCheckedChange={(v) => setGenerateAi(v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <Label
                    htmlFor="generate_ai"
                    className="cursor-pointer text-sm font-medium"
                  >
                    {d.generateAi}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {generateAi ? d.aiBriefGuidance : d.aiPreviewGuidance}
                  </p>
                </div>
              </div>
            </div>

            {generateAi ? (
              <FormField name="findings_prompt" label={d.aiPrompt} required>
                <Textarea
                  id="findings_prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={d.aiPromptPlaceholder}
                  rows={4}
                />
              </FormField>
            ) : (
              <FormField name="findings" label={d.findings} required>
                <Textarea
                  id="findings"
                  value={findings}
                  onChange={(e) => setFindings(e.target.value)}
                  placeholder={d.findingsPlaceholder}
                  rows={6}
                />
              </FormField>
            )}

            <ApprovalReadinessToggle
              checked={approvalReady}
              labels={d}
              onCheckedChange={setApprovalReady}
            />

            <FooterButtons
              labels={d}
              loading={loading}
              submitLabel={generateAi ? d.regenerateDraft : d.acceptDraft}
              disabled={
                generateAi
                  ? prompt.trim().length === 0
                  : findings.trim().length === 0
              }
              onCancel={() => onOpenChange(false)}
            />
          </form>
        </PlainFormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Recommendations dialog.
 * ------------------------------------------------------------------------- */

export function InvestigationRecommendationsDialog({
  open,
  initialValue,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  initialValue?: string;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: RecordInvestigationRecommendationsPayload) => void;
}) {
  const L = useInvestigationLabels();
  const d = L.dialogs;
  const [recommendations, setRecommendations] = useState("");
  const [generateAi, setGenerateAi] = useState(false);
  const [approvalReady, setApprovalReady] = useState(false);
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (open) {
      setRecommendations(initialValue ?? "");
      setGenerateAi(false);
      setApprovalReady(false);
      setPrompt("");
    }
  }, [open, initialValue]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.recommendationsTitle}</DialogTitle>
          <DialogDescription>{d.recommendationsDescription}</DialogDescription>
        </DialogHeader>
        <PlainFormProvider>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit({
                recommendations: recommendations.trim(),
                generate_ai: generateAi,
                recommendations_prompt: prompt.trim(),
                metadata: {
                  brief_workspace: {
                    section: "recommendations",
                    mode: generateAi ? "ai_regenerate" : "manual_accept",
                    approval_ready: approvalReady,
                    prompt_style: "investigation_brief",
                  },
                },
              });
            }}
          >
            <div className="rounded-lg border bg-muted/20 p-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="rec_generate_ai"
                  checked={generateAi}
                  onCheckedChange={(v) => setGenerateAi(v === true)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <Label
                    htmlFor="rec_generate_ai"
                    className="cursor-pointer text-sm font-medium"
                  >
                    {d.generateAi}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {generateAi ? d.aiBriefGuidance : d.aiPreviewGuidance}
                  </p>
                </div>
              </div>
            </div>

            {generateAi ? (
              <FormField
                name="recommendations_prompt"
                label={d.aiPrompt}
                required
              >
                <Textarea
                  id="recommendations_prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={d.aiPromptPlaceholder}
                  rows={4}
                />
              </FormField>
            ) : (
              <FormField
                name="recommendations"
                label={d.recommendations}
                required
              >
                <Textarea
                  id="recommendations"
                  value={recommendations}
                  onChange={(e) => setRecommendations(e.target.value)}
                  placeholder={d.recommendationsPlaceholder}
                  rows={6}
                />
              </FormField>
            )}

            <ApprovalReadinessToggle
              checked={approvalReady}
              labels={d}
              onCheckedChange={setApprovalReady}
            />

            <FooterButtons
              labels={d}
              loading={loading}
              submitLabel={generateAi ? d.regenerateDraft : d.acceptDraft}
              disabled={
                generateAi
                  ? prompt.trim().length === 0
                  : recommendations.trim().length === 0
              }
              onCancel={() => onOpenChange(false)}
            />
          </form>
        </PlainFormProvider>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Start approval dialog.
 * ------------------------------------------------------------------------- */

export function InvestigationApprovalDialog({
  open,
  loading,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  loading: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: StartInvestigationApprovalPayload) => void;
}) {
  const L = useInvestigationLabels();
  const d = L.dialogs;
  const { locale } = useLocaleOrDefault();
  const roleOptions = useMemo(
    () =>
      ROLE_ROSTER.map((role) => ({
        value: role.slug,
        label: locale === "ar" ? role.roleAr : role.roleEn,
      })),
    [locale],
  );
  const [approverRole, setApproverRole] = useState("legal-director");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setApproverRole("legal-director");
      setNotes("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{d.approvalTitle}</DialogTitle>
          <DialogDescription>{d.approvalDescription}</DialogDescription>
        </DialogHeader>
        <PlainFormProvider>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit({
                approver_role: approverRole.trim(),
                notes: notes.trim(),
              });
            }}
          >
            <FormField name="approver_role" label={d.approverRole} required>
              <Select
                value={approverRole}
                onValueChange={(v) => setApproverRole(v)}
              >
                <SelectTrigger id="approver_role">
                  <SelectValue placeholder={d.approverRolePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {roleOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <FooterButtons
              labels={d}
              loading={loading}
              disabled={approverRole.trim().length === 0}
              onCancel={() => onOpenChange(false)}
            />
          </form>
        </PlainFormProvider>
      </DialogContent>
    </Dialog>
  );
}

function ApprovalReadinessToggle({
  checked,
  labels,
  onCheckedChange,
}: {
  checked: boolean;
  labels: InvestigationLabels["dialogs"];
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <Checkbox
          id="approval_ready"
          checked={checked}
          onCheckedChange={(value) => onCheckedChange(value === true)}
          className="mt-0.5"
        />
        <div className="min-w-0">
          <Label
            htmlFor="approval_ready"
            className="cursor-pointer text-sm font-medium"
          >
            {labels.approvalReadinessLabel}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {labels.approvalReadinessHint}
          </p>
        </div>
      </div>
    </div>
  );
}
