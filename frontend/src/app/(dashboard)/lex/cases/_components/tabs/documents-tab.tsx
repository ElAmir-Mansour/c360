'use client';

import { statisticHint } from '@/lib/lex/statistic-hint';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  FileArchive,
  FileText,
  FolderOpen,
  GitCompareArrows,
  Link2,
  ListChecks,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { formatDateTime } from '@/lib/format';
import { enterpriseApi } from '@/lib/enterprise';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  casesApi,
  formatCaseToken,
  type CaseClassificationCascade,
  type CaseDocumentLink,
  type CaseHearingReport,
  type LegalCase,
  type LegalCaseVersion,
  type LegalDefendantAttachment,
  type LegalExpertDocument,
  type LegalJudgment,
  type LegalPleading,
  type LegalPleadingAttachment,
} from '@/lib/lex/cases';
import type { JsonObject } from '@/types/suites';
import { useCaseLabels, type CaseLabels } from '../labels';
import { useDeepTabLabels } from './deep-tab-labels';
import {
  buildEvidenceSummary,
  metadataNumber,
  resolveRecordText,
} from './deep-tab-model';

type DocumentsLabels = CaseLabels['documents'];

type DocumentSource =
  | 'pleading'
  | 'hearing'
  | 'expert'
  | 'judgment'
  | 'defendant'
  | 'repository'
  | 'local_upload'
  | 'local_link'
  | 'local_reuse';

interface DocumentsTabProps {
  caseId?: string;
  canWrite?: boolean;
}

type EvidenceMetricScope = 'all' | 'admitted' | 'review' | 'challenged' | 'strength' | `category:${string}`;

interface LocalDocument {
  id: string;
  kind: 'upload' | 'link' | 'reuse';
  title: string;
  caption?: string;
  url?: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
  category?: string;
  repository_document_id?: string;
  created_at: string;
}

interface CaseDocument {
  id: string;
  source: DocumentSource;
  title: string;
  subtitle?: string;
  caption?: string;
  fileName?: string;
  fileId?: string | null;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
  preview?: string;
  meta?: Record<string, string>;
  category?: string;
  tags?: string[];
  repositoryDocumentId?: string;
  local?: boolean;
  confidentiality?: string;
  documentStatus?: string;
  documentType?: string;
  repositoryState?: string;
  localState?: string;
  sourceDetail?: string;
  healthWarnings?: string[];
  evidenceStatus?: string;
  courtReference?: string;
  submittedBy?: string;
  submittedAt?: string;
  evidenceStrength?: number;
}

interface SnapshotDiff {
  path: string;
  before: string;
  after: string;
}

interface EvidenceChecklistItem {
  id: string;
  label: string;
  description: string;
  category?: DocumentCategory;
  count: number;
  met: boolean;
  required: boolean;
  actionMode?: 'upload' | 'link' | 'reuse';
}

interface DocumentHealthSummary {
  checklist: EvidenceChecklistItem[];
  missing: EvidenceChecklistItem[];
  metCount: number;
  requiredCount: number;
  repositoryCount: number;
  localMetadataCount: number;
  metadataOnlyCount: number;
  linkedSourceCount: number;
  versionCount: number;
  diffAvailable: boolean;
}

function sourceLabel(dl: DocumentsLabels, source: DocumentSource): string {
  return dl.sourceLabels[source] ?? formatCaseToken(source);
}

const DOCUMENT_TYPE_OPTIONS = [
  'filing',
  'correspondence',
  'memo',
  'opinion',
  'policy',
  'regulation',
  'template',
  'resolution',
  'power_of_attorney',
  'other',
] as const;

const DOCUMENT_CATEGORY_OPTIONS = [
  'case_file',
  'pleading',
  'hearing',
  'expert',
  'judgment',
  'defendant',
  'evidence',
  'correspondence',
] as const;

type DocumentCategory = (typeof DOCUMENT_CATEGORY_OPTIONS)[number];

const SOURCE_CATEGORY_MAP: Partial<Record<DocumentSource, DocumentCategory>> = {
  pleading: 'pleading',
  hearing: 'hearing',
  expert: 'expert',
  judgment: 'judgment',
  defendant: 'defendant',
  repository: 'case_file',
  local_upload: 'case_file',
  local_link: 'correspondence',
  local_reuse: 'case_file',
};

function compactText(value: string | null | undefined, fallback = 'Not set'): string {
  const text = value?.trim();
  return text ? text : fallback;
}

function formatBytes(value?: number): string | undefined {
  if (!value || value <= 0) return undefined;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function versionLabel(version: LegalCaseVersion, dl: DocumentsLabels): string {
  const reason = compactText(version.change_reason, dl.snapshotFallback);
  return `v${version.version} - ${reason}`;
}

function normalizeSnapshotValue(value: unknown, notSet: string): string {
  if (value === null || value === undefined || value === '') return notSet;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenSnapshot(
  value: unknown,
  notSet: string,
  prefix = '',
  output: Record<string, string> = {},
): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) output[prefix] = normalizeSnapshotValue(value, notSet);
    return output;
  }

  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenSnapshot(child, notSet, path, output);
      return;
    }
    output[path] = normalizeSnapshotValue(child, notSet);
  });

  return output;
}

function diffVersions(before: LegalCaseVersion | undefined, after: LegalCaseVersion | undefined, notSet: string): SnapshotDiff[] {
  if (!before || !after) return [];
  const left = flattenSnapshot(before.snapshot, notSet);
  const right = flattenSnapshot(after.snapshot, notSet);
  return Array.from(new Set([...Object.keys(left), ...Object.keys(right)]))
    .sort()
    .filter((path) => left[path] !== right[path])
    .map((path) => ({
      path,
      before: left[path] ?? notSet,
      after: right[path] ?? notSet,
    }));
}

function pleadingDocuments(pleadings: LegalPleading[], dl: DocumentsLabels): CaseDocument[] {
  return pleadings.flatMap((pleading) => {
    const docs: CaseDocument[] = [
      {
        id: `pleading:${pleading.id}`,
        source: 'pleading',
        title: pleading.title,
        subtitle: `${pleading.pleading_number} - ${formatCaseToken(pleading.type)}`,
        caption: pleading.ai_generated ? dl.captionText.aiPleadingDraft : dl.captionText.pleadingDraft,
        createdAt: pleading.created_at,
        updatedAt: pleading.updated_at,
        preview: pleading.body,
        meta: {
          [dl.metaKeys.status]: formatCaseToken(pleading.status),
          [dl.metaKeys.version]: String(pleading.current_version),
        },
      },
    ];

    (pleading.attachments ?? []).forEach((attachment: LegalPleadingAttachment) => {
      docs.push({
        id: `pleading-attachment:${attachment.id}`,
        source: 'pleading',
        title: attachment.caption || attachment.file_name,
        subtitle: pleading.title,
        caption: attachment.caption,
        fileName: attachment.file_name,
        fileId: attachment.file_id,
        createdAt: attachment.created_at,
        preview: pleading.body,
        meta: { [dl.metaKeys.pleading]: pleading.pleading_number },
      });
    });

    return docs;
  });
}

function hearingDocuments(reports: CaseHearingReport[], dl: DocumentsLabels): CaseDocument[] {
  return reports.map((report) => ({
    id: `hearing-report:${report.id}`,
    source: 'hearing',
    title: report.title,
    subtitle: formatCaseToken(report.type),
    caption: report.decision,
    fileId: report.file_id,
    createdAt: report.created_at,
    updatedAt: report.updated_at,
    preview: [report.body, report.decision ? `${dl.captionText.decisionPrefix}: ${report.decision}` : '']
      .filter(Boolean)
      .join('\n\n'),
    meta: report.recorded_at ? { [dl.metaKeys.recorded]: formatDateTime(report.recorded_at) } : undefined,
  }));
}

function expertDocuments(experts: Array<{ expert_name: string; documents?: LegalExpertDocument[] }>): CaseDocument[] {
  return experts.flatMap((expert) =>
    (expert.documents ?? []).map((document) => ({
      id: `expert-document:${document.id}`,
      source: 'expert' as const,
      title: document.caption || document.file_name,
      subtitle: expert.expert_name,
      caption: document.caption,
      fileName: document.file_name,
      fileId: document.file_id,
      createdAt: document.created_at,
    })),
  );
}

function judgmentDocuments(judgments: LegalJudgment[], dl: DocumentsLabels): CaseDocument[] {
  return judgments.map((judgment) => ({
    id: `judgment:${judgment.id}`,
    source: 'judgment',
    title: judgment.judgment_ref,
    subtitle: judgment.outcome ? formatCaseToken(judgment.outcome) : dl.captionText.judgmentRecord,
    caption: judgment.recommendation
      ? `${dl.captionText.recommendationPrefix}: ${formatCaseToken(judgment.recommendation)}`
      : undefined,
    fileId: judgment.file_id,
    createdAt: judgment.created_at,
    updatedAt: judgment.updated_at,
    preview: [judgment.summary, judgment.study_notes].filter(Boolean).join('\n\n'),
    meta: {
      [dl.metaKeys.judgmentDate]: judgment.judgment_date ? formatDateTime(judgment.judgment_date) : dl.notSet,
      [dl.metaKeys.objectionDeadline]: judgment.objection_deadline
        ? formatDateTime(judgment.objection_deadline)
        : dl.notSet,
    },
  }));
}

function defendantDocuments(
  defendantCases: Array<{ plaintiff_name: string; response_memo?: string; attachments?: LegalDefendantAttachment[]; created_at: string; updated_at: string }>,
  dl: DocumentsLabels,
): CaseDocument[] {
  return defendantCases.flatMap((defendantCase) => {
    const docs: CaseDocument[] = [];
    if (defendantCase.response_memo) {
      docs.push({
        id: `defendant-response:${defendantCase.plaintiff_name}:${defendantCase.updated_at}`,
        source: 'defendant',
        title: dl.captionText.responseMemoTitle(defendantCase.plaintiff_name),
        subtitle: dl.captionText.responseMemo,
        createdAt: defendantCase.created_at,
        updatedAt: defendantCase.updated_at,
        preview: defendantCase.response_memo,
      });
    }

    (defendantCase.attachments ?? []).forEach((attachment) => {
      docs.push({
        id: `defendant-attachment:${attachment.id}`,
        source: 'defendant',
        title: attachment.caption || attachment.file_name,
        subtitle: defendantCase.plaintiff_name,
        caption: attachment.caption,
        fileName: attachment.file_name,
        fileId: attachment.file_id,
        createdAt: attachment.created_at,
        meta: attachment.kind ? { [dl.metaKeys.kind]: formatCaseToken(attachment.kind) } : undefined,
      });
    });

    return docs;
  });
}

function localDocuments(documents: LocalDocument[], dl: DocumentsLabels): CaseDocument[] {
  const ls = dl.localState;
  return documents.map((document) => {
    const source = document.kind === 'reuse' ? 'local_reuse' : document.kind === 'link' ? 'local_link' : 'local_upload';
    return {
      id: `local:${document.id}`,
      source,
      title: document.title,
      subtitle: document.kind === 'link' ? document.url : document.file_name,
      caption: document.caption,
      fileName: document.file_name,
      url: document.url,
      createdAt: document.created_at,
      preview: document.caption,
      local: true,
      category: document.category,
      repositoryDocumentId: document.repository_document_id,
      repositoryState: document.repository_document_id ? ls.repositoryReferenced : ls.notLinkedToRepository,
      localState:
        document.kind === 'upload'
          ? ls.localUploadMetadataOnly
          : document.kind === 'link'
            ? ls.externalLinkMetadata
            : ls.repositoryReuseMetadata,
      sourceDetail:
        document.kind === 'upload'
          ? ls.browserFileMetadata
          : document.kind === 'link'
            ? ls.externalUrl
            : ls.repositoryReuse,
      healthWarnings:
        document.kind === 'upload'
          ? [ls.uploadWarning]
          : document.kind === 'link'
            ? [ls.linkWarning]
            : undefined,
      meta: {
        [dl.metaKeys.type]: document.mime_type || (document.kind === 'link' ? dl.captionText.externalLink : dl.captionText.localFileMetadata),
        [dl.metaKeys.size]: formatBytes(document.file_size) ?? dl.captionText.notStored,
        [dl.metaKeys.category]: document.category ? formatCaseToken(document.category) : dl.notSet,
        ...(document.repository_document_id ? { [dl.metaKeys.repositoryDocument]: document.repository_document_id } : {}),
      },
    };
  });
}

function caseDocumentLinks(links: CaseDocumentLink[], dl: DocumentsLabels): CaseDocument[] {
  return links.map((link) => {
    const externalUrl = metadataString(link.document?.metadata, 'external_url');
    const sourceNote = metadataString(link.document?.metadata, 'source_note');
    const localFileName = metadataString(link.document?.metadata, 'local_file_name');
    const metadataOnly = link.source === 'metadata' || Boolean(localFileName);
    const evidenceStatus = resolveRecordText(link, 'evidence_status');
    const courtReference = resolveRecordText(link, 'court_reference');
    const submittedBy = resolveRecordText(link, 'submitted_by');
    const submittedAt = resolveRecordText(link, 'submitted_at');
    const evidenceStrength =
      metadataNumber(link.metadata, 'evidence_strength', 'strength') ??
      metadataNumber(link.document?.metadata, 'evidence_strength', 'strength');
    const healthWarnings = [
      metadataOnly && !link.document?.file_id ? dl.localState.uploadMetadataWarning : undefined,
      link.source === 'external_link' && !externalUrl ? dl.localState.externalSourceWarning : undefined,
    ].filter((warning): warning is string => Boolean(warning));

    return {
      id: `case-document:${link.id}`,
      source: 'repository',
      title: link.document?.title ?? link.notes ?? link.document_id,
      subtitle: link.source ? formatCaseToken(link.source) : dl.captionText.caseRepository,
      caption: link.notes || link.document?.description,
      fileName: link.document?.file_name ?? localFileName ?? undefined,
      fileId: link.document?.file_id,
      createdAt: link.created_at,
      updatedAt: link.document?.updated_at,
      preview: externalUrl ?? sourceNote ?? link.notes ?? link.document?.description,
      category: link.category ?? link.document?.category ?? undefined,
      tags: link.document?.tags,
      repositoryDocumentId: link.document_id,
      confidentiality: link.document?.confidentiality,
      documentStatus: link.document?.status,
      documentType: link.document?.type,
      repositoryState: link.document
        ? dl.captionText.repositoryRecord(formatCaseToken(link.document.status))
        : dl.captionText.linkedByIdOnly,
      localState: metadataOnly ? dl.captionText.uploadMetadataCaptured : dl.captionText.noLocalState,
      sourceDetail: link.source ? formatCaseToken(link.source) : dl.captionText.caseRepository,
      healthWarnings: healthWarnings.length > 0 ? healthWarnings : undefined,
      evidenceStatus,
      courtReference,
      submittedBy,
      submittedAt,
      evidenceStrength,
      meta: {
        [dl.metaKeys.type]: link.document?.type ? formatCaseToken(link.document.type) : dl.notSet,
        [dl.metaKeys.status]: link.document?.status ? formatCaseToken(link.document.status) : dl.notSet,
        [dl.metaKeys.confidentiality]: link.document?.confidentiality ? formatCaseToken(link.document.confidentiality) : dl.notSet,
        [dl.metaKeys.version]: link.document?.current_version ? String(link.document.current_version) : dl.notSet,
        [dl.metaKeys.source]: link.source ? formatCaseToken(link.source) : dl.notSet,
      },
    };
  });
}

function metadataString(metadata: JsonObject | null | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function parseTags(value: string): string[] {
  return Array.from(new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean)));
}

function normalizeSearchText(value: string | null | undefined): string {
  return value?.toLowerCase().replace(/[_-]+/g, ' ').trim() ?? '';
}

function localizedText(value: { en?: string; ar?: string } | undefined): string {
  return [value?.en, value?.ar].filter(Boolean).join(' ');
}

function caseHintText(legalCase?: LegalCase, classification?: CaseClassificationCascade): string {
  return [
    legalCase?.case_type,
    legalCase?.classification_id,
    legalCase?.competent_court,
    legalCase?.description,
    classification?.code,
    localizedText(classification?.name),
    ...(classification?.chain ?? []).flatMap((item) => [item.code, localizedText(item.name), ...(item.path ?? [])]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function caseHintLabel(
  dl: DocumentsLabels,
  locale: AppLocale,
  legalCase?: LegalCase,
  classification?: CaseClassificationCascade,
): string {
  const classificationLabel =
    classification?.chain && classification.chain.length > 0
      ? classification.chain
          .map((item) => compactText(resolveLocalized(item.name, locale) || item.code, dl.notSet))
          .join(' / ')
      : classification?.name
        ? compactText(resolveLocalized(classification.name, locale) || classification.code, dl.notSet)
        : undefined;
  return [
    legalCase?.case_type ? `${dl.metaKeys.type}: ${formatCaseToken(legalCase.case_type)}` : undefined,
    classificationLabel ? `${dl.field.category}: ${classificationLabel}` : undefined,
  ]
    .filter(Boolean)
    .join(' | ');
}

function documentMatchesCategory(document: CaseDocument, category: DocumentCategory): boolean {
  if (document.category === category || SOURCE_CATEGORY_MAP[document.source] === category) return true;

  const haystack = normalizeSearchText(
    [
      document.title,
      document.subtitle,
      document.caption,
      document.fileName,
      document.sourceDetail,
      ...(document.tags ?? []),
      ...Object.values(document.meta ?? {}),
    ]
      .filter(Boolean)
      .join(' '),
  );

  if (category === 'evidence') {
    return /\b(evidence|exhibit|proof|supporting|attachment|annex|دليل|مرفق|بينة)\b/u.test(haystack);
  }
  if (category === 'correspondence') {
    return /\b(correspondence|letter|email|notice|notification|memo|إشعار|خطاب|مراسلة)\b/u.test(haystack);
  }
  if (category === 'case_file') {
    return /\b(case file|court file|registry|najiz|ملف|محكمة)\b/u.test(haystack);
  }

  return haystack.includes(category.replace(/_/g, ' '));
}

function countDocumentsForCategory(documents: CaseDocument[], category: DocumentCategory): number {
  return documents.filter((document) => documentMatchesCategory(document, category)).length;
}

function buildDocumentHealthSummary({
  documents,
  legalCase,
  classification,
  versions,
  diffCount,
  dl,
}: {
  documents: CaseDocument[];
  legalCase?: LegalCase;
  classification?: CaseClassificationCascade;
  versions: LegalCaseVersion[];
  diffCount: number;
  dl: DocumentsLabels;
}): DocumentHealthSummary {
  const hints = caseHintText(legalCase, classification);
  const isPlaintiffCase = legalCase?.company_status === 'plaintiff';
  const isDefendantCase = legalCase?.company_status === 'defendant';
  const hasHearing = (legalCase?.hearings?.length ?? 0) > 0 || /\b(hearing|session|court|جلسة|محكمة)\b/u.test(hints);
  const hasExpertHint = /\b(expert|technical|forensic|engineering|medical|خبير|خبرة|فني)\b/u.test(hints);
  const hasJudgmentHint = /\b(judgment|appeal|objection|award|حكم|اعتراض|استئناف)\b/u.test(hints);

  const checklist: EvidenceChecklistItem[] = [];
  const addItem = (
    id: string,
    label: string,
    category: DocumentCategory | undefined,
    description: string,
    required: boolean,
    actionMode: EvidenceChecklistItem['actionMode'] = 'upload',
    explicitCount?: number,
  ) => {
    const count = explicitCount ?? (category ? countDocumentsForCategory(documents, category) : 0);
    checklist.push({
      id,
      label,
      category,
      description,
      required,
      actionMode,
      count,
      met: count > 0,
    });
  };

  const cl = dl.checklist;
  addItem('case-file', cl.caseFile, 'case_file', cl.caseFileDescription, true, 'upload');
  addItem('evidence', cl.evidence, 'evidence', cl.evidenceDescription, true, 'upload');
  addItem('correspondence', cl.correspondence, 'correspondence', cl.correspondenceDescription, true, 'link');
  addItem(
    'repository-link',
    cl.repositoryLink,
    'case_file',
    cl.repositoryLinkDescription,
    false,
    'reuse',
    documents.filter((document) => document.repositoryDocumentId).length,
  );

  if (isPlaintiffCase || /\b(pleading|claim|statement|مذكرة|دعوى)\b/u.test(hints)) {
    addItem('pleading', cl.pleadings, 'pleading', cl.pleadingsDescription, true, 'upload');
  }
  if (hasHearing) {
    addItem('hearing', cl.hearing, 'hearing', cl.hearingDescription, true, 'upload');
  }
  if (hasExpertHint) {
    addItem('expert', cl.expert, 'expert', cl.expertDescription, true, 'upload');
  }
  if (hasJudgmentHint || legalCase?.status === 'closed') {
    addItem('judgment', cl.judgment, 'judgment', cl.judgmentDescription, legalCase?.status === 'closed', 'upload');
  }
  if (isDefendantCase) {
    addItem('defendant', cl.defendant, 'defendant', cl.defendantDescription, true, 'upload');
  }

  checklist.push({
    id: 'version-compare',
    label: cl.versionCompare,
    description: diffCount > 0 ? cl.versionCompareDiff(diffCount) : cl.versionCompareNeeds,
    count: versions.length,
    met: versions.length >= 2,
    required: false,
  });

  const requiredItems = checklist.filter((item) => item.required);
  const metCount = requiredItems.filter((item) => item.met).length;

  return {
    checklist,
    missing: checklist.filter((item) => !item.met && item.category),
    metCount,
    requiredCount: requiredItems.length,
    repositoryCount: documents.filter((document) => document.repositoryDocumentId).length,
    localMetadataCount: documents.filter((document) => document.local || document.localState?.toLowerCase().includes('metadata')).length,
    metadataOnlyCount: documents.filter((document) =>
      (document.healthWarnings ?? []).some((warning) => warning.toLowerCase().includes('metadata')),
    ).length,
    linkedSourceCount: documents.filter((document) => document.url || document.source === 'local_link').length,
    versionCount: versions.length,
    diffAvailable: versions.length >= 2,
  };
}

export function DocumentsTab({ caseId: caseIdProp, canWrite: canWriteProp }: DocumentsTabProps = {}) {
  const labels = useCaseLabels();
  const deepLabels = useDeepTabLabels();
  const t = labels.documents;
  const { locale } = useLocaleOrDefault();
  const queryClient = useQueryClient();
  const params = useParams<{ id?: string }>();
  const { hasPermission } = useAuth();
  const caseId = caseIdProp ?? params?.id ?? '';
  // §9 — case-document mutations fall back to the case edit verb (the parent
  // case page passes lex:case:edit through `canWriteProp`).
  const canWrite = canWriteProp ?? hasPermission('lex:case:edit');
  const canViewDocuments = hasPermission('lex:document:view');
  const storageKey = `clario360:lex:case-documents:${caseId}`;
  const [storedDocuments, setStoredDocuments] = useLocalStorage<LocalDocument[]>(storageKey, []);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [documentMode, setDocumentMode] = useState<'upload' | 'link' | 'reuse'>('upload');
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [documentType, setDocumentType] = useState<(typeof DOCUMENT_TYPE_OPTIONS)[number]>('filing');
  const [documentCategory, setDocumentCategory] = useState<(typeof DOCUMENT_CATEGORY_OPTIONS)[number]>('evidence');
  const [tagInput, setTagInput] = useState('');
  const [reuseDocumentId, setReuseDocumentId] = useState('');
  const [evidenceStatus, setEvidenceStatus] = useState('submitted');
  const [courtReference, setCourtReference] = useState('');
  const [submittedBy, setSubmittedBy] = useState('');
  const [evidenceStrength, setEvidenceStrength] = useState('');
  const [beforeVersionId, setBeforeVersionId] = useState('');
  const [afterVersionId, setAfterVersionId] = useState('');
  const [documentMetricScope, setDocumentMetricScope] = useState<'repository' | 'metadata' | null>(null);
  const [evidenceMetricScope, setEvidenceMetricScope] = useState<EvidenceMetricScope | null>(null);

  const caseQuery = useQuery({
    queryKey: ['lex-case', caseId, 'documents-tab'],
    queryFn: () => casesApi.getCase(caseId),
    enabled: Boolean(caseId),
  });
  const isPlaintiffCase = caseQuery.data?.company_status === 'plaintiff';
  const isDefendantCase = caseQuery.data?.company_status === 'defendant';

  const classificationQuery = useQuery({
    queryKey: ['lex-case-classification-cascade', caseQuery.data?.classification_id],
    queryFn: () => casesApi.getClassificationCascade(caseQuery.data?.classification_id ?? ''),
    enabled: Boolean(caseQuery.data?.classification_id),
    retry: false,
  });

  const pleadingsQuery = useQuery({
    queryKey: ['lex-case-pleadings', caseId],
    queryFn: () => casesApi.listPleadings(caseId),
    enabled: Boolean(caseId) && isPlaintiffCase,
  });

  const expertsQuery = useQuery({
    queryKey: ['lex-case-experts', caseId],
    queryFn: () => casesApi.listExperts(caseId),
    enabled: Boolean(caseId) && isPlaintiffCase,
  });

  const judgmentsQuery = useQuery({
    queryKey: ['lex-case-judgments', caseId],
    queryFn: () => casesApi.listJudgments(caseId),
    enabled: Boolean(caseId) && isPlaintiffCase,
  });

  const defendantQuery = useQuery({
    queryKey: ['lex-case-defendant', caseId],
    queryFn: () => casesApi.listDefendant(caseId),
    enabled: Boolean(caseId) && isDefendantCase,
    retry: false,
  });

  const versionsQuery = useQuery({
    queryKey: ['lex-case-versions', caseId],
    queryFn: () => casesApi.listCaseVersions(caseId),
    enabled: Boolean(caseId),
  });

  const repositoryQuery = useQuery({
    queryKey: ['lex-case-repository-documents', caseId],
    queryFn: () =>
      casesApi.listRepositoryDocuments({
        page: 1,
        per_page: 100,
        sort: 'updated_at',
        order: 'desc',
      }),
    enabled: Boolean(caseId),
    retry: false,
  });

  const caseDocumentsQuery = useQuery({
    queryKey: ['lex-case-documents', caseId],
    queryFn: () => casesApi.listCaseDocuments(caseId),
    enabled: Boolean(caseId),
    retry: false,
  });

  const hearingReportQueries = useQueries({
    queries: (caseQuery.data?.hearings ?? []).map((hearing) => ({
      queryKey: ['lex-case-hearing-reports', caseId, hearing.id],
      queryFn: () => casesApi.listHearingReports(caseId, hearing.id),
      enabled: Boolean(caseId && hearing.id),
      retry: false,
    })),
  });

  const hearingReports = useMemo(
    () => hearingReportQueries.flatMap((query) => query.data ?? []),
    [hearingReportQueries],
  );

  const repositoryItems = useMemo(() => repositoryQuery.data?.data ?? [], [repositoryQuery.data]);
  const linkedRepositoryIds = useMemo(
    () => new Set((caseDocumentsQuery.data ?? []).map((link) => link.document_id)),
    [caseDocumentsQuery.data],
  );
  const reusableRepositoryItems = useMemo(
    () => repositoryItems.filter((document) => !linkedRepositoryIds.has(document.id)),
    [linkedRepositoryIds, repositoryItems],
  );

  const documents = useMemo(() => {
    const all = [
      ...caseDocumentLinks(caseDocumentsQuery.data ?? [], t),
      ...localDocuments(storedDocuments, t),
      ...pleadingDocuments(pleadingsQuery.data ?? [], t),
      ...hearingDocuments(hearingReports, t),
      ...expertDocuments(expertsQuery.data ?? []),
      ...judgmentDocuments(judgmentsQuery.data ?? [], t),
      ...defendantDocuments(defendantQuery.data ?? [], t),
    ];

    return all.sort((a, b) => {
      const left = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
      const right = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
      return right - left;
    });
  }, [
    caseDocumentsQuery.data,
    defendantQuery.data,
    expertsQuery.data,
    hearingReports,
    judgmentsQuery.data,
    pleadingsQuery.data,
    storedDocuments,
    t,
  ]);

  const evidenceDocuments = useMemo(() => {
    const matched = documents.filter(
      (document) =>
        document.category === 'evidence' ||
        document.source === 'expert' ||
        Boolean(document.evidenceStatus) ||
        documentMatchesCategory(document, 'evidence'),
    );
    return matched.length > 0 ? matched : documents;
  }, [documents]);
  const scopedEvidenceDocuments = useMemo(() => {
    if (documentMetricScope === 'repository') {
      return documents.filter((document) => Boolean(document.repositoryDocumentId));
    }
    if (documentMetricScope === 'metadata') {
      return documents.filter((document) =>
        document.healthWarnings?.some((warning) => warning.toLowerCase().includes('metadata')),
      );
    }
    if (evidenceMetricScope === 'admitted') {
      return evidenceDocuments.filter((document) => document.evidenceStatus === 'admitted');
    }
    if (evidenceMetricScope === 'review') {
      return evidenceDocuments.filter((document) =>
        document.evidenceStatus === 'pending' || document.evidenceStatus === 'submitted',
      );
    }
    if (evidenceMetricScope === 'challenged') {
      return evidenceDocuments.filter((document) =>
        document.evidenceStatus === 'rejected' || document.evidenceStatus === 'withdrawn',
      );
    }
    if (evidenceMetricScope === 'strength') {
      const scored = evidenceDocuments.filter((document) =>
        typeof document.evidenceStrength === 'number' && Number.isFinite(document.evidenceStrength),
      );
      return scored.length > 0 ? scored : evidenceDocuments;
    }
    if (evidenceMetricScope?.startsWith('category:')) {
      const category = evidenceMetricScope.slice('category:'.length);
      return evidenceDocuments.filter(
        (document) => (document.category ?? document.documentType ?? document.source).trim() === category,
      );
    }
    return evidenceDocuments;
  }, [documentMetricScope, documents, evidenceDocuments, evidenceMetricScope]);
  const evidenceSummary = useMemo(
    () =>
      buildEvidenceSummary(
        evidenceDocuments.map((document) => ({
          status: document.evidenceStatus,
          category: document.category ?? document.documentType ?? document.source,
          strength: document.evidenceStrength,
        })),
      ),
    [evidenceDocuments],
  );

  useEffect(() => {
    if (!selectedId && documents[0]) setSelectedId(documents[0].id);
    if (selectedId && !documents.some((document) => document.id === selectedId)) {
      setSelectedId(documents[0]?.id ?? '');
    }
  }, [documents, selectedId]);

  const versions = useMemo(
    () => [...(versionsQuery.data ?? [])].sort((a, b) => b.version - a.version),
    [versionsQuery.data],
  );

  useEffect(() => {
    if (versions.length === 0) return;
    setAfterVersionId((current) => current || versions[0]?.id || '');
    setBeforeVersionId((current) => current || versions[1]?.id || versions[0]?.id || '');
  }, [versions]);

  const selectedDocument = documents.find((document) => document.id === selectedId) ?? documents[0];
  const beforeVersion = versions.find((version) => version.id === beforeVersionId);
  const afterVersion = versions.find((version) => version.id === afterVersionId);
  const versionDiff = diffVersions(beforeVersion, afterVersion, t.notSet);
  const documentHealth = useMemo(
    () =>
      buildDocumentHealthSummary({
        documents,
        legalCase: caseQuery.data,
        classification: classificationQuery.data,
        versions,
        diffCount: versionDiff.length,
        dl: t,
      }),
    [caseQuery.data, classificationQuery.data, documents, versionDiff.length, versions, t],
  );
  const hintLabel = caseHintLabel(t, locale, caseQuery.data, classificationQuery.data);
  const relatedDocumentsLoading =
    isPlaintiffCase && (pleadingsQuery.isLoading || expertsQuery.isLoading || judgmentsQuery.isLoading);
  const relatedDocumentsError =
    isPlaintiffCase && pleadingsQuery.isError && expertsQuery.isError && judgmentsQuery.isError;
  const isLoading =
    caseQuery.isLoading ||
    relatedDocumentsLoading ||
    (isDefendantCase && defendantQuery.isLoading) ||
    versionsQuery.isLoading ||
    repositoryQuery.isLoading ||
    caseDocumentsQuery.isLoading ||
    hearingReportQueries.some((query) => query.isLoading);
  const hasHardError = documents.length === 0 && (caseQuery.isError || relatedDocumentsError || caseDocumentsQuery.isError);

  const handleDocumentMetric = (metric: 'required' | 'repository' | 'metadata' | 'versions') => {
    if (metric === 'repository' || metric === 'metadata') {
      const nextScope = metric === 'repository' ? 'repository' : 'metadata';
      const opening = documentMetricScope !== nextScope;
      setDocumentMetricScope(opening ? nextScope : null);
      setEvidenceMetricScope(null);
      if (opening) {
        const contributors = metric === 'repository'
          ? documents.filter((document) => Boolean(document.repositoryDocumentId))
          : documents.filter((document) =>
              document.healthWarnings?.some((warning) => warning.toLowerCase().includes('metadata')),
            );
        if (contributors[0]) setSelectedId(contributors[0].id);
      }
      requestAnimationFrame(() => {
        document.getElementById('case-document-submission-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }

    setDocumentMetricScope(null);
    setEvidenceMetricScope(null);
    const target = metric === 'versions' ? 'case-document-version-compare' : 'case-document-health-checklist';
    requestAnimationFrame(() => {
      document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleEvidenceMetric = (scope: EvidenceMetricScope) => {
    const opening = evidenceMetricScope !== scope;
    setEvidenceMetricScope(opening ? scope : null);
    setDocumentMetricScope(null);
    if (opening) {
      const contributors = scope === 'admitted'
        ? evidenceDocuments.filter((document) => document.evidenceStatus === 'admitted')
        : scope === 'review'
          ? evidenceDocuments.filter((document) => document.evidenceStatus === 'pending' || document.evidenceStatus === 'submitted')
          : scope === 'challenged'
            ? evidenceDocuments.filter((document) => document.evidenceStatus === 'rejected' || document.evidenceStatus === 'withdrawn')
            : scope === 'strength'
              ? (() => {
                  const scored = evidenceDocuments.filter((document) => typeof document.evidenceStrength === 'number' && Number.isFinite(document.evidenceStrength));
                  return scored.length > 0 ? scored : evidenceDocuments;
                })()
              : scope.startsWith('category:')
                ? evidenceDocuments.filter((document) => (document.category ?? document.documentType ?? document.source).trim() === scope.slice('category:'.length))
                : evidenceDocuments;
      if (contributors[0]) setSelectedId(contributors[0].id);
    }
    requestAnimationFrame(() => {
      document.getElementById('case-document-submission-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const resetAddDialog = () => {
    setDocumentMode('upload');
    setLinkTitle('');
    setLinkUrl('');
    setCaption('');
    setSelectedFile(null);
    setUploadProgress(0);
    setDocumentType('filing');
    setDocumentCategory('evidence');
    setTagInput('');
    setReuseDocumentId('');
    setEvidenceStatus('submitted');
    setCourtReference('');
    setSubmittedBy('');
    setEvidenceStrength('');
  };

  const openAddDocumentDialog = (mode: 'upload' | 'link' | 'reuse' = 'upload', category: DocumentCategory = 'evidence') => {
    resetAddDialog();
    setDocumentMode(mode);
    setDocumentCategory(category);
    setAddOpen(true);
  };

  const saveDocumentMutation = useMutation({
    mutationFn: async () => {
      const title =
        linkTitle.trim() ||
        selectedFile?.name ||
        reusableRepositoryItems.find((document) => document.id === reuseDocumentId)?.title ||
        '';

      // Reuse: link an existing repository document by id.
      if (documentMode === 'reuse') {
        return (casesApi.addCaseDocument as unknown as (
          targetCaseId: string,
          payload: Record<string, unknown>,
        ) => Promise<CaseDocumentLink>)(caseId, {
          document_id: reuseDocumentId,
          category: documentCategory,
          source: 'reuse',
          notes: caption.trim(),
          evidence_status: evidenceStatus,
          court_reference: courtReference.trim() || null,
          submitted_by: submittedBy.trim() || null,
          submitted_at: new Date().toISOString(),
          metadata: {
            evidence_strength: evidenceStrength ? Number(evidenceStrength) : null,
          },
        });
      }

      // Upload: when a file is chosen, upload the real bytes to the platform
      // file-service first, then link the resulting file_id to the case. The
      // backend creates a repository document from the FileReference and marks
      // the link source="uploaded_reference" — no more metadata-only stub.
      if (documentMode === 'upload' && selectedFile) {
        setUploadProgress(0);
        const uploaded = await enterpriseApi.files.upload(
          selectedFile,
          {
            suite: 'lex',
            entity_type: 'legal_case',
            entity_id: caseId,
            tags: Array.from(
              new Set(['legal_case', 'case_document', documentCategory, documentType]),
            ).join(','),
            lifecycle_policy: 'standard',
          },
          setUploadProgress,
        );
        try {
          return await (casesApi.addCaseDocument as unknown as (
            targetCaseId: string,
            payload: Record<string, unknown>,
          ) => Promise<CaseDocumentLink>)(caseId, {
            title: title || uploaded.original_name,
            type: documentType,
            description: caption.trim() || title || uploaded.original_name,
            category: documentCategory,
            confidentiality: 'internal',
            tags: parseTags(tagInput),
            notes: caption.trim(),
            evidence_status: evidenceStatus,
            court_reference: courtReference.trim() || null,
            submitted_by: submittedBy.trim() || null,
            submitted_at: new Date().toISOString(),
            metadata: {
              evidence_strength: evidenceStrength ? Number(evidenceStrength) : null,
            },
            document: {
              file_id: uploaded.id,
              file_name: uploaded.original_name,
              file_size_bytes: uploaded.size_bytes,
              content_hash: uploaded.checksum_sha256,
            },
          });
        } catch (linkError) {
          // Bytes uploaded but the case link failed — best-effort remove the now
          // orphaned file so a retry doesn't accumulate dangling uploads.
          await enterpriseApi.files.delete(uploaded.id).catch(() => {});
          throw linkError;
        }
      }

      // Link (external URL) or a metadata-only record (Upload mode saved with a
      // title but no file chosen).
      const documentMetadata: JsonObject = {
        source: documentMode,
        source_note: caption.trim() || null,
      };
      if (documentMode === 'link') documentMetadata.external_url = linkUrl.trim();
      return (casesApi.addCaseDocument as unknown as (
        targetCaseId: string,
        payload: Record<string, unknown>,
      ) => Promise<CaseDocumentLink>)(caseId, {
        title,
        type: documentType,
        description: caption.trim() || title,
        category: documentCategory,
        confidentiality: 'internal',
        tags: parseTags(tagInput),
        source: documentMode === 'link' ? 'external_link' : 'metadata',
        notes: caption.trim(),
        evidence_status: evidenceStatus,
        court_reference: courtReference.trim() || null,
        submitted_by: submittedBy.trim() || null,
        submitted_at: new Date().toISOString(),
        metadata: {
          evidence_strength: evidenceStrength ? Number(evidenceStrength) : null,
        },
        document_metadata: documentMetadata,
      });
    },
    onSuccess: async (link) => {
      showSuccess(documentMode === 'upload' && selectedFile ? t.docUploaded : t.docLinked);
      setSelectedId(`case-document:${link.id}`);
      setAddOpen(false);
      resetAddDialog();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lex-case-documents', caseId] }),
        queryClient.invalidateQueries({ queryKey: ['lex-case-repository-documents', caseId] }),
      ]);
    },
    onError: showApiError,
  });

  const addDocument = () => {
    saveDocumentMutation.mutate();
  };

  const removeLocalDocument = (document: CaseDocument) => {
    if (!document.local) return;
    const localId = document.id.replace(/^local:/, '');
    setStoredDocuments((current) => current.filter((item) => item.id !== localId));
    showSuccess(t.localRemoved);
  };

  const removeCaseDocumentMutation = useMutation({
    mutationFn: (documentId: string) => casesApi.deleteCaseDocument(caseId, documentId.replace(/^case-document:/, '')),
    onSuccess: async () => {
      showSuccess(t.linkRemoved);
      await queryClient.invalidateQueries({ queryKey: ['lex-case-documents', caseId] });
    },
    onError: showApiError,
  });

  return (
    <SectionCard
      title={deepLabels.evidence.title}
      description={deepLabels.evidence.description}
      actions={
        canWrite ? (
          <Button size="sm" onClick={() => openAddDocumentDialog()}>
            <Plus className="me-1.5 h-3.5 w-3.5" />
            {t.add}
          </Button>
        ) : undefined
      }
    >
      {isLoading ? (
        <LoadingSkeleton variant="list-item" count={3} />
      ) : hasHardError ? (
        <ErrorState
          message={t.loadError}
          onRetry={() => {
            void caseQuery.refetch();
            if (isPlaintiffCase) {
              void pleadingsQuery.refetch();
              void expertsQuery.refetch();
              void judgmentsQuery.refetch();
            }
            if (isDefendantCase) void defendantQuery.refetch();
            void versionsQuery.refetch();
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.9fr)]">
          <div className="space-y-4">
            {documents.length === 0 ? (
              <div className="rounded-lg border p-6">
                <EmptyState icon={FolderOpen} title={t.emptyTitle} description={t.emptyDescription} />
              </div>
            ) : (
              <div id="case-document-submission-log" className="scroll-mt-24">
                <EvidenceSubmissionLog
                  documents={scopedEvidenceDocuments}
                  selectedId={selectedDocument?.id}
                  onSelect={setSelectedId}
                  labels={deepLabels}
                  documentLabels={t}
                />
              </div>
            )}

            <DocumentHealthWorkspace
              summary={documentHealth}
              caseHint={hintLabel}
              canWrite={canWrite}
              reusableRepositoryCount={reusableRepositoryItems.length}
              onAction={openAddDocumentDialog}
              activeMetric={documentMetricScope}
              onMetricAction={handleDocumentMetric}
            />
          </div>

          <div className="space-y-4">
            <EvidenceSummaryRail
              summary={evidenceSummary}
              labels={deepLabels}
              activeScope={evidenceMetricScope}
              onScopeChange={handleEvidenceMetric}
            />
            <div id="case-document-version-compare" className="scroll-mt-24 rounded-lg border">
              <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{selectedDocument?.title ?? t.previewTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {selectedDocument ? sourceLabel(t, selectedDocument.source) : t.selectPrompt}
                  </p>
                </div>
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
              {selectedDocument ? (
                <div className="space-y-4 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{sourceLabel(t, selectedDocument.source)}</Badge>
                    {selectedDocument.fileId ? <Badge variant="secondary">{t.fileIdLinked}</Badge> : null}
                    {selectedDocument.repositoryDocumentId ? <Badge variant="secondary">{t.repository}</Badge> : null}
                    {selectedDocument.local ? <Badge variant="warning">{t.localMetadata}</Badge> : null}
                    {selectedDocument.confidentiality ? (
                      <Badge variant="outline">{formatCaseToken(selectedDocument.confidentiality)}</Badge>
                    ) : null}
                    {selectedDocument.documentStatus ? (
                      <Badge variant={selectedDocument.documentStatus === 'active' ? 'success' : 'secondary'}>
                        {formatCaseToken(selectedDocument.documentStatus)}
                      </Badge>
                    ) : null}
                  </div>

                  {selectedDocument.healthWarnings?.length ? (
                    <div className="space-y-2">
                      {selectedDocument.healthWarnings.map((warning) => (
                        <div
                          key={warning}
                          className="flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700 dark:text-warning-300"
                        >
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{warning}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <p className="text-sm font-semibold">{t.chainTitle}</p>
                    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      <PreviewField label={t.field.source} value={selectedDocument.sourceDetail ?? sourceLabel(t, selectedDocument.source)} notSet={t.notSet} />
                      <PreviewField label={t.field.repositoryState} value={selectedDocument.repositoryState} notSet={t.notSet} />
                      <PreviewField label={t.field.localState} value={selectedDocument.localState ?? t.noLocalMetadata} notSet={t.notSet} />
                      <PreviewField
                        label={t.field.confidentiality}
                        value={selectedDocument.confidentiality ? formatCaseToken(selectedDocument.confidentiality) : undefined}
                        notSet={t.notSet}
                      />
                      <PreviewField
                        label={t.field.category}
                        value={selectedDocument.category ? formatCaseToken(selectedDocument.category) : undefined}
                        notSet={t.notSet}
                      />
                      <PreviewField label={t.field.tags} value={selectedDocument.tags?.join(', ')} notSet={t.notSet} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <PreviewField label={t.field.fileName} value={selectedDocument.fileName} notSet={t.notSet} />
                    <PreviewField label={t.field.documentType} value={selectedDocument.documentType ? formatCaseToken(selectedDocument.documentType) : undefined} notSet={t.notSet} />
                    <PreviewField label={t.field.fileId} value={selectedDocument.fileId ?? undefined} notSet={t.notSet} />
                    <PreviewField
                      label={t.field.updated}
                      value={
                        selectedDocument.updatedAt ? <RelativeTime date={selectedDocument.updatedAt} /> : undefined
                      }
                      notSet={t.notSet}
                    />
                    <PreviewField
                      label={t.field.created}
                      value={selectedDocument.createdAt ? formatDateTime(selectedDocument.createdAt) : undefined}
                      notSet={t.notSet}
                    />
                    <PreviewField label={t.field.caseDiff} value={documentHealth.diffAvailable ? t.diffAvailable : t.diffNeedsVersions} notSet={t.notSet} />
                  </div>
                  {selectedDocument.meta ? (
                    <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                      {Object.entries(selectedDocument.meta).map(([label, value]) => (
                        <PreviewField key={label} label={label} value={value} notSet={t.notSet} />
                      ))}
                    </div>
                  ) : null}
                  {selectedDocument.url ? (
                    <Button variant="outline" size="sm" asChild>
                      <a href={selectedDocument.url} target="_blank" rel="noreferrer">
                        <ExternalLink className="me-1.5 h-3.5 w-3.5" />
                        {t.openLink}
                      </a>
                    </Button>
                  ) : null}
                  {selectedDocument.preview || selectedDocument.caption ? (
                    <ScrollArea className="max-h-64 rounded-md border bg-muted/30 p-3">
                      <p className="whitespace-pre-line text-sm text-muted-foreground">
                        {selectedDocument.preview || selectedDocument.caption}
                      </p>
                    </ScrollArea>
                  ) : (
                    <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                      {t.noPreview}
                    </div>
                  )}
                  {(canWrite &&
                    (selectedDocument.local || selectedDocument.id.startsWith('case-document:'))) ||
                  (canViewDocuments && selectedDocument.repositoryDocumentId) ? (
                    <div className="flex flex-wrap gap-2">
                      {canWrite && selectedDocument.id.startsWith('case-document:') ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => removeCaseDocumentMutation.mutate(selectedDocument.id)}
                          disabled={removeCaseDocumentMutation.isPending}
                        >
                          <Trash2 className="me-1.5 h-3.5 w-3.5" />
                          {t.removeFromCase}
                        </Button>
                      ) : null}
                      {canWrite && selectedDocument.local ? (
                        <Button size="sm" variant="outline" onClick={() => removeLocalDocument(selectedDocument)}>
                          <Trash2 className="me-1.5 h-3.5 w-3.5" />
                          {t.removeLocalMetadata}
                        </Button>
                      ) : null}
                      {canViewDocuments && selectedDocument.repositoryDocumentId ? (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/lex/documents?document=${encodeURIComponent(selectedDocument.repositoryDocumentId)}`}>
                            <ExternalLink className="me-1.5 h-3.5 w-3.5" />
                            {t.openRepository}
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="p-4 text-sm text-muted-foreground">{t.selectToPreview}</div>
              )}
            </div>

            <div className="rounded-lg border">
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <p className="font-semibold">{t.versionCompareTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t.versionCompareDescription}</p>
                </div>
                <GitCompareArrows className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="space-y-4 p-4">
                {versions.length < 2 ? (
                  <p className="text-sm text-muted-foreground">{t.versionCompareNeedsTwo}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>{t.before}</Label>
                        <Select value={beforeVersionId} onValueChange={setBeforeVersionId}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {versions.map((version) => (
                              <SelectItem key={version.id} value={version.id}>
                                {versionLabel(version, t)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>{t.after}</Label>
                        <Select value={afterVersionId} onValueChange={setAfterVersionId}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {versions.map((version) => (
                              <SelectItem key={version.id} value={version.id}>
                                {versionLabel(version, t)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {beforeVersion ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {formatDateTime(beforeVersion.created_at)}
                        </span>
                      ) : null}
                      {afterVersion ? (
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3 w-3" />
                          {formatDateTime(afterVersion.created_at)}
                        </span>
                      ) : null}
                    </div>
                    <Separator />
                    {versionDiff.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t.noDiff}</p>
                    ) : (
                      <ScrollArea className="max-h-72">
                        <div className="space-y-2 pe-3">
                          {versionDiff.slice(0, 40).map((item) => (
                            <div key={item.path} className="rounded-md border p-3">
                              <p className="text-xs font-semibold text-muted-foreground">{item.path}</p>
                              <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                                <div className="rounded bg-error-50 p-2 text-error-700">
                                  <span className="text-xs font-semibold">{t.before}</span>
                                  <p className="mt-1 break-words">{item.before}</p>
                                </div>
                                <div className="rounded bg-success-50 p-2 text-success-700">
                                  <span className="text-xs font-semibold">{t.after}</span>
                                  <p className="mt-1 break-words">{item.after}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                          {versionDiff.length > 40 ? (
                            <p className="text-xs text-muted-foreground">{t.diffMore(versionDiff.length)}</p>
                          ) : null}
                        </div>
                      </ScrollArea>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {canWrite ? (
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            setAddOpen(open);
            if (!open) resetAddDialog();
          }}
        >
          <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t.addDialogTitle}</DialogTitle>
              <DialogDescription>{t.addDialogDescription}</DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-2">
              <Button
                type="button"
                variant={documentMode === 'upload' ? 'default' : 'outline'}
                onClick={() => setDocumentMode('upload')}
              >
                <Upload className="me-1.5 h-3.5 w-3.5" />
                {t.modeUpload}
              </Button>
              <Button
                type="button"
                variant={documentMode === 'link' ? 'default' : 'outline'}
                onClick={() => setDocumentMode('link')}
              >
                <Link2 className="me-1.5 h-3.5 w-3.5" />
                {t.modeLink}
              </Button>
              <Button
                type="button"
                variant={documentMode === 'reuse' ? 'default' : 'outline'}
                onClick={() => setDocumentMode('reuse')}
              >
                <FolderOpen className="me-1.5 h-3.5 w-3.5" />
                {t.modeReuse}
              </Button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t.type}</Label>
                  <Select value={documentType} onValueChange={(value) => setDocumentType(value as typeof documentType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type}>
                          {formatCaseToken(type)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t.category}</Label>
                  <Select value={documentCategory} onValueChange={(value) => setDocumentCategory(value as typeof documentCategory)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_CATEGORY_OPTIONS.map((category) => (
                        <SelectItem key={category} value={category}>
                          {formatCaseToken(category)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {documentMode === 'upload' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="document_file">{t.file}</Label>
                  <Input
                    id="document_file"
                    type="file"
                    onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">{t.fileHint}</p>
                  {saveDocumentMutation.isPending && selectedFile ? (
                    <div className="space-y-1">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary transition-[width]"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{t.uploadProgress(uploadProgress)}</p>
                    </div>
                  ) : null}
                </div>
              ) : documentMode === 'link' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="document_url">{t.url}</Label>
                  <Input
                    id="document_url"
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    placeholder={t.urlPlaceholder}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>{t.repositoryDocument}</Label>
                  <Select value={reuseDocumentId} onValueChange={setReuseDocumentId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t.repositoryDocumentPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {reusableRepositoryItems.map((document) => (
                        <SelectItem key={document.id} value={document.id}>
                          {document.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {repositoryQuery.isError ? (
                    <p className="text-xs text-muted-foreground">{t.repositoryLoadError}</p>
                  ) : null}
                </div>
              )}

              {documentMode !== 'reuse' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="document_title">{t.docTitle}</Label>
                  <Input
                    id="document_title"
                    value={linkTitle}
                    onChange={(event) => setLinkTitle(event.target.value)}
                    placeholder={documentMode === 'upload' ? selectedFile?.name ?? t.docTitlePlaceholder : t.docTitlePlaceholder}
                  />
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{deepLabels.evidence.courtStatus}</Label>
                  <Select value={evidenceStatus} onValueChange={setEvidenceStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">{deepLabels.evidence.pendingLabel}</SelectItem>
                      <SelectItem value="submitted">{deepLabels.evidence.submittedLabel}</SelectItem>
                      <SelectItem value="admitted">{deepLabels.evidence.admittedLabel}</SelectItem>
                      <SelectItem value="rejected">{deepLabels.evidence.rejectedLabel}</SelectItem>
                      <SelectItem value="withdrawn">{deepLabels.evidence.withdrawnLabel}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="court_reference">{deepLabels.common.reference}</Label>
                  <Input
                    id="court_reference"
                    dir="ltr"
                    value={courtReference}
                    onChange={(event) => setCourtReference(event.target.value)}
                    placeholder="COURT-EVID-..."
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="submitted_by">{deepLabels.evidence.submittedBy}</Label>
                  <Input
                    id="submitted_by"
                    dir="auto"
                    value={submittedBy}
                    onChange={(event) => setSubmittedBy(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="evidence_strength">{deepLabels.evidence.strength}</Label>
                  <Input
                    id="evidence_strength"
                    type="number"
                    min={0}
                    max={100}
                    value={evidenceStrength}
                    onChange={(event) => setEvidenceStrength(event.target.value)}
                    placeholder="0-100"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="document_tags">{t.tags}</Label>
                <Input
                  id="document_tags"
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  placeholder={t.tagsPlaceholder}
                  disabled={documentMode === 'reuse'}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="document_caption">{t.caption}</Label>
                <Textarea
                  id="document_caption"
                  rows={3}
                  value={caption}
                  onChange={(event) => setCaption(event.target.value)}
                  placeholder={t.captionPlaceholder}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
                {labels.form.cancel}
              </Button>
              <Button
                type="button"
                onClick={addDocument}
                disabled={
                  saveDocumentMutation.isPending ||
                  (documentMode === 'upload' ? !selectedFile && !linkTitle.trim() : documentMode === 'link' ? !linkTitle.trim() || !linkUrl.trim() : !reuseDocumentId)
                }
              >
                {saveDocumentMutation.isPending ? (
                  <Clock3 className="me-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileArchive className="me-1.5 h-3.5 w-3.5" />
                )}
                {documentMode === 'reuse' ? t.linkDocument : t.saveDocument}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </SectionCard>
  );
}

function EvidenceSubmissionLog({
  documents,
  selectedId,
  onSelect,
  labels,
  documentLabels,
}: {
  documents: CaseDocument[];
  selectedId?: string;
  onSelect: (id: string) => void;
  labels: ReturnType<typeof useDeepTabLabels>;
  documentLabels: DocumentsLabels;
}) {
  return (
    <div className="space-y-4">
      {documents.map((document) => {
        const status = document.evidenceStatus ?? 'pending';
        const statusLabel =
          {
            admitted: labels.evidence.admittedLabel,
            pending: labels.evidence.pendingLabel,
            submitted: labels.evidence.submittedLabel,
            rejected: labels.evidence.rejectedLabel,
            withdrawn: labels.evidence.withdrawnLabel,
          }[status] ?? formatCaseToken(status);
        const statusVariant =
          status === 'admitted'
            ? 'success'
            : status === 'rejected' || status === 'withdrawn'
              ? 'destructive'
              : 'warning';
        const type = document.documentType ?? document.category ?? document.source;
        const submittedBy = document.submittedBy ?? document.subtitle;
        const submittedAt = document.submittedAt ?? document.createdAt;

        return (
          <button
            key={document.id}
            type="button"
            className={`w-full rounded-xl border bg-card p-4 text-start shadow-elevation-1 transition hover:border-primary/40 ${
              selectedId === document.id ? 'border-primary/60 ring-1 ring-primary/20' : 'border-border/80'
            }`}
            onClick={() => onSelect(document.id)}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-foreground" dir="auto">{document.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {labels.evidence.submittedBy}:{' '}
                  <span className="font-medium text-foreground" dir="auto">
                    {submittedBy ?? labels.common.notSet}
                  </span>
                </p>
                {submittedAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(submittedAt)}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="info">{formatCaseToken(type)}</Badge>
                <Badge variant={statusVariant}>{statusLabel}</Badge>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" dir="auto">
                    {document.fileName ?? document.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {document.fileId ? documentLabels.fileIdLinked : documentLabels.badgeRecord}
                  </p>
                </div>
              </div>
              {document.courtReference ? (
                <p className="text-xs text-muted-foreground">
                  {labels.common.reference}:{' '}
                  <span className="font-semibold text-foreground" dir="ltr">
                    {document.courtReference}
                  </span>
                </p>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EvidenceSummaryRail({
  summary,
  labels,
  activeScope,
  onScopeChange,
}: {
  summary: ReturnType<typeof buildEvidenceSummary>;
  labels: ReturnType<typeof useDeepTabLabels>;
  activeScope: EvidenceMetricScope | null;
  onScopeChange: (scope: EvidenceMetricScope) => void;
}) {
  const maxCategory = Math.max(1, ...Object.values(summary.categories));
  return (
    <>
      <div className="rounded-xl border border-border/80 bg-card p-5 shadow-elevation-1">
        <h3 className="font-semibold text-foreground">{labels.evidence.summary}</h3>
        <div className="mt-4 space-y-3 text-sm">
          <EvidenceSummaryRow label={labels.evidence.total} value={summary.total} onAction={() => onScopeChange('all')} active={activeScope === 'all'} />
          <EvidenceSummaryRow label={labels.evidence.admitted} value={summary.admitted} tone="success" onAction={() => onScopeChange('admitted')} active={activeScope === 'admitted'} />
          <EvidenceSummaryRow label={labels.evidence.review} value={summary.underReview} tone="warning" onAction={() => onScopeChange('review')} active={activeScope === 'review'} />
          <EvidenceSummaryRow label={labels.evidence.challenged} value={summary.challenged} tone="destructive" onAction={() => onScopeChange('challenged')} active={activeScope === 'challenged'} />
        </div>
        <div className="mt-4 border-t border-border/70 pt-4">
          <button
            type="button"
            onClick={() => onScopeChange('strength')}
            aria-pressed={activeScope === 'strength'}
            className="flex w-full items-center justify-between gap-3 rounded text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="font-semibold">{labels.evidence.strength}</p>
            <p className="font-semibold text-success-700">{summary.strength}%</p>
          </button>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={labels.evidence.strength}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={summary.strength}
          >
            <div
              className="h-full rounded-full bg-success-600 transition-[width]"
              style={{ width: `${summary.strength}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{labels.evidence.strengthHint}</p>
        </div>
      </div>

      <div className="rounded-xl border border-border/80 bg-card p-5 shadow-elevation-1">
        <h3 className="font-semibold text-foreground">{labels.evidence.categories}</h3>
        <div className="mt-4 space-y-3">
          {Object.entries(summary.categories).map(([category, count]) => (
            <button
              key={category}
              type="button"
              onClick={() => onScopeChange(`category:${category}`)}
              aria-pressed={activeScope === `category:${category}`}
              className="block w-full rounded text-start transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-center justify-between gap-3 text-xs">
                <span>{category === 'uncategorized' ? labels.evidence.uncategorized : formatCaseToken(category)}</span>
                <span className="font-semibold">{count}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.round((count / maxCategory) * 100)}%` }}
                />
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function EvidenceSummaryRow({
  label,
  value,
  tone = 'default',
  onAction,
  active,
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
  onAction: () => void;
  active: boolean;
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success-700',
    warning: 'text-warning-700',
    destructive: 'text-error-700',
  }[tone];
  return (
    <button
      type="button"
      onClick={onAction}
      title={statisticHint(label)}
      aria-pressed={active}
      className="flex w-full items-center justify-between gap-3 rounded text-start transition hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${toneClass}`}>{value}</span>
    </button>
  );
}

function DocumentHealthWorkspace({
  summary,
  caseHint,
  canWrite,
  reusableRepositoryCount,
  onAction,
  activeMetric,
  onMetricAction,
}: {
  summary: DocumentHealthSummary;
  caseHint: string;
  canWrite: boolean;
  reusableRepositoryCount: number;
  onAction: (mode: 'upload' | 'link' | 'reuse', category: DocumentCategory) => void;
  activeMetric: 'repository' | 'metadata' | null;
  onMetricAction: (metric: 'required' | 'repository' | 'metadata' | 'versions') => void;
}) {
  const labels = useCaseLabels();
  const h = labels.documents.health;
  const completion = summary.requiredCount > 0 ? Math.round((summary.metCount / summary.requiredCount) * 100) : 100;
  const missingEvidence = summary.missing.filter((item) => item.category);

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{h.title}</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {caseHint || h.hintFallback}
          </p>
        </div>
        <Badge variant={completion >= 80 ? 'success' : completion >= 50 ? 'warning' : 'destructive'}>
          {h.ready(completion)}
        </Badge>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <HealthMetric label={h.required} value={`${summary.metCount}/${summary.requiredCount}`} onAction={() => onMetricAction('required')} />
        <HealthMetric label={h.repository} value={summary.repositoryCount} onAction={() => onMetricAction('repository')} pressed={activeMetric === 'repository'} />
        <HealthMetric label={h.metadataOnly} value={summary.metadataOnlyCount} warning={summary.metadataOnlyCount > 0} onAction={() => onMetricAction('metadata')} pressed={activeMetric === 'metadata'} />
        <HealthMetric label={h.versions} value={summary.diffAvailable ? h.versionsDiff(summary.versionCount) : summary.versionCount} onAction={() => onMetricAction('versions')} />
      </div>

      {missingEvidence.length > 0 ? (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-warning-700 dark:text-warning-300" />
            {h.missingTitle}
          </div>
          <div className="space-y-2">
            {missingEvidence.slice(0, 5).map((item) => (
              <div key={item.id} className="rounded-md border bg-card/70 px-3 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                  </div>
                  <Badge variant={item.required ? 'warning' : 'outline'}>{item.required ? h.requiredBadge : h.recommendedBadge}</Badge>
                </div>
                {canWrite && item.category ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => onAction('upload', item.category!)}>
                      <Upload className="me-1.5 h-3.5 w-3.5" />
                      {h.uploadMetadata}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => onAction('link', item.category!)}>
                      <Link2 className="me-1.5 h-3.5 w-3.5" />
                      {h.linkUrl}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reusableRepositoryCount === 0}
                      onClick={() => onAction('reuse', item.category!)}
                    >
                      <FolderOpen className="me-1.5 h-3.5 w-3.5" />
                      {h.reuseRepository}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            {missingEvidence.length > 5 ? (
              <p className="text-xs text-muted-foreground">{h.moreMissing(missingEvidence.length - 5)}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
          <CheckCircle2 className="h-4 w-4" />
          {h.allRepresented}
        </div>
      )}

      <div id="case-document-health-checklist" className="scroll-mt-24 mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
        {summary.checklist.map((item) => (
          <div key={item.id} className="flex items-start gap-2 rounded-md border bg-card/60 px-3 py-2">
            {item.met ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-700 dark:text-warning-300" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{item.label}</p>
                <Badge variant={item.required ? 'outline' : 'secondary'}>{item.required ? h.requiredItemBadge : h.healthItemBadge}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.met ? h.linkedSuffix(item.count) : item.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {summary.localMetadataCount > 0 || summary.linkedSourceCount > 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Database className="h-3.5 w-3.5" />
          <span>{h.localRecords(summary.localMetadataCount)}</span>
          <span>{h.externalSources(summary.linkedSourceCount)}</span>
        </div>
      ) : null}
    </div>
  );
}

function HealthMetric({
  label,
  value,
  warning = false,
  onAction,
  pressed = false,
}: {
  label: string;
  value: ReactNode;
  warning?: boolean;
  onAction: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onAction}
      title={statisticHint(label)}
      aria-pressed={pressed}
      data-pressed={pressed}
      className="rounded-md border bg-card/70 px-3 py-2 text-start transition hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[pressed=true]:border-primary data-[pressed=true]:bg-primary/10"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={warning ? 'mt-1 text-lg font-semibold text-warning-700 dark:text-warning-300' : 'mt-1 text-lg font-semibold'}>
        {value}
      </p>
    </button>
  );
}

function PreviewField({ label, value, notSet }: { label: string; value?: ReactNode; notSet: string }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 break-words text-sm">{value || notSet}</div>
    </div>
  );
}
