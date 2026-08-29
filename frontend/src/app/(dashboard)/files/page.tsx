'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Database,
  Download,
  Eye,
  File as FileIcon,
  HardDrive,
  Layers,
  RefreshCw,
  ScanSearch,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { PageHeader } from '@/components/common/page-header';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { FileUpload } from '@/components/shared/forms/file-upload';
import {
  AsyncRecordPicker,
  type RecordPickerOption,
} from '@/components/shared/forms/async-record-picker';
import { StatCard, type StatTone } from '@/components/shared/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  TableSortHeader,
  type SortDirection,
  type SortState,
} from '@/components/ui/table-sort-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { apiGet } from '@/lib/api';
import { enterpriseApi } from '@/lib/enterprise/api';
import { downloadBlob, formatBytes, formatDateTime, formatRelativeTime, parseApiError, titleCase } from '@/lib/format';
import { useFilesLabels, useFileEnumLabel } from './_lib/files-i18n';
import type {
  FileItem,
  FileLifecyclePolicy,
  FilePresignedDownload,
  FileQuarantineEntry,
  FileRecord,
  FileStorageStat,
  FileSuite,
  FileVirusScanStatus,
} from '@/types/models';

const FILE_SUITES: FileSuite[] = ['platform', 'cyber', 'data', 'acta', 'lex', 'visus', 'models'];
const FILE_LIFECYCLE_POLICIES: FileLifecyclePolicy[] = [
  'standard',
  'temporary',
  'archive',
  'audit_retention',
];
const QUARANTINE_ACTIONS = ['restored', 'deleted', 'false_positive'] as const;
const FILE_LINK_NONE = '__none__';

interface FileLinkType {
  suite: FileSuite;
  value: string;
  label: string;
  endpoint: string;
}

const FILE_LINK_TYPES: FileLinkType[] = [
  { suite: 'lex', value: 'contract', label: 'Contract', endpoint: '/api/v1/lex/contracts' },
  { suite: 'lex', value: 'matter', label: 'Matter', endpoint: '/api/v1/lex/matters' },
  { suite: 'lex', value: 'document', label: 'Document', endpoint: '/api/v1/lex/documents' },
  { suite: 'lex', value: 'legal_case', label: 'Legal case', endpoint: '/api/v1/lex/legal-cases' },
  { suite: 'lex', value: 'investigation', label: 'Investigation', endpoint: '/api/v1/lex/investigations' },
  { suite: 'acta', value: 'meeting', label: 'Meeting', endpoint: '/api/v1/acta/meetings' },
  { suite: 'acta', value: 'committee', label: 'Committee', endpoint: '/api/v1/acta/committees' },
  { suite: 'cyber', value: 'alert', label: 'Alert', endpoint: '/api/v1/cyber/alerts' },
  { suite: 'cyber', value: 'remediation', label: 'Remediation', endpoint: '/api/v1/cyber/remediation' },
  { suite: 'data', value: 'source', label: 'Data source', endpoint: '/api/v1/data/sources' },
  { suite: 'data', value: 'model', label: 'Data model', endpoint: '/api/v1/data/models' },
  { suite: 'data', value: 'pipeline', label: 'Pipeline', endpoint: '/api/v1/data/pipelines' },
  { suite: 'visus', value: 'dashboard', label: 'Dashboard', endpoint: '/api/v1/visus/dashboards' },
  { suite: 'visus', value: 'report', label: 'Report', endpoint: '/api/v1/visus/reports' },
];

function fileLinkRecordLabel(record: Record<string, unknown>): RecordPickerOption | null {
  const id = typeof record.id === 'string' ? record.id : '';
  if (!id) return null;
  const primaryKeys = ['title', 'name', 'subject', 'original_name'];
  const referenceKeys = [
    'contract_number',
    'matter_number',
    'case_number',
    'investigation_number',
    'meeting_number',
    'reference',
    'code',
  ];
  const label = primaryKeys.map((key) => record[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '');
  const reference = referenceKeys.map((key) => record[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '');
  return {
    value: id,
    label: label ?? reference ?? 'Untitled record',
    description: reference && reference !== label ? reference : undefined,
  };
}

async function loadFileLinkOptions(config: FileLinkType, search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<unknown>(config.endpoint, {
    page: 1,
    per_page: 50,
    search: search || undefined,
    order: 'asc',
  });
  const rows = Array.isArray(response)
    ? response
    : response && typeof response === 'object' && Array.isArray((response as { data?: unknown }).data)
      ? (response as { data: unknown[] }).data
      : [];
  return rows
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
    .map(fileLinkRecordLabel)
    .filter((option): option is RecordPickerOption => option !== null);
}

type QuarantineAction = (typeof QUARANTINE_ACTIONS)[number];

function statusVariant(status: FileItem['status']): 'default' | 'success' | 'destructive' | 'warning' | 'outline' {
  switch (status) {
    case 'available':
      return 'success';
    case 'pending':
      return 'warning';
    case 'quarantined':
      return 'destructive';
    case 'processing':
      return 'default';
    default:
      return 'outline';
  }
}

function scanVariant(status: FileVirusScanStatus): 'default' | 'success' | 'destructive' | 'warning' | 'outline' {
  switch (status) {
    case 'clean':
    case 'skipped':
      return 'success';
    case 'infected':
      return 'destructive';
    case 'pending':
    case 'scanning':
      return 'warning';
    case 'error':
      return 'default';
    default:
      return 'outline';
  }
}

// The virus scan runs asynchronously server-side (the upload response is always
// 'pending'), so the detail dialog must poll to ever show a verdict. Bounded so
// a stalled/offline scanner stops after ~1 min instead of polling forever.
const SCAN_POLL_INTERVAL_MS = 4000;
const SCAN_POLL_MAX_ATTEMPTS = 15;
const isScanPending = (status: FileVirusScanStatus | undefined): boolean =>
  status === 'pending' || status === 'scanning';

/** Localized fallback for generic (non-enum) values such as access-log actions. */
function prettyLabelLocalized(value: string | null | undefined, notSet: string): string {
  if (!value) return notSet;
  return titleCase(value);
}

function normalizeRoleKeys(fileRoles: Array<{ slug: string; name: string }>): Set<string> {
  return new Set(
    fileRoles.flatMap((role) => {
      const slug = role.slug.toLowerCase();
      const name = role.name.toLowerCase().replace(/\s+/g, '_');
      return [slug, name];
    }),
  );
}

function PaginationControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const t = useFilesLabels();
  return (
    <div className="flex items-center justify-between border-t px-4 py-3">
      <p className="text-xs text-muted-foreground">
        {t.pagination.pageOf(String(page), String(totalPages))}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          {t.pagination.previous}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          {t.pagination.next}
        </Button>
      </div>
    </div>
  );
}

function StorageSummaryCard({
  title,
  value,
  caption,
  tone = 'slate',
  icon,
}: {
  title: string;
  value: string;
  caption: string;
  tone?: StatTone;
  icon?: LucideIcon;
}) {
  return (
    <div className="space-y-1">
      <StatCard label={title} value={value} tone={tone} icon={icon} />
      <p className="px-1 text-xs text-muted-foreground">{caption}</p>
    </div>
  );
}

function FileMetadataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[160px_1fr]">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function FileDetailDialog({
  fileId,
  open,
  onOpenChange,
  isAdmin,
  busyKey,
  onDownload,
  onOpenPresigned,
  onRescan,
  onDelete,
}: {
  fileId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  busyKey: string | null;
  onDownload: (file: FileRecord) => Promise<void>;
  onOpenPresigned: (file: FileRecord) => Promise<void>;
  onRescan: (file: FileRecord) => Promise<void>;
  onDelete: (file: FileRecord) => void;
}) {
  const t = useFilesLabels();
  const enumLabel = useFileEnumLabel();
  const [accessPage, setAccessPage] = useState(1);

  // Bounded poll counter, reset whenever the dialog targets a new file.
  const scanPollCountRef = useRef(0);
  useEffect(() => {
    scanPollCountRef.current = 0;
  }, [fileId, open]);

  const fileQuery = useQuery({
    queryKey: ['file-detail', fileId],
    queryFn: () => enterpriseApi.files.get(fileId ?? ''),
    enabled: open && Boolean(fileId),
    // Poll while the scan is in progress so the badge resolves on its own.
    refetchInterval: (query) => {
      if (!isScanPending(query.state.data?.virus_scan_status)) return false;
      if (scanPollCountRef.current >= SCAN_POLL_MAX_ATTEMPTS) return false;
      scanPollCountRef.current += 1;
      return SCAN_POLL_INTERVAL_MS;
    },
  });

  const versionsQuery = useQuery({
    queryKey: ['file-versions', fileId],
    queryFn: () => enterpriseApi.files.versions(fileId ?? ''),
    enabled: open && Boolean(fileId),
  });

  // When the primary file reaches a scan verdict, refresh the versions list
  // once so its per-version scan badges reflect the terminal status too.
  const primaryScanStatus = fileQuery.data?.virus_scan_status;
  useEffect(() => {
    if (primaryScanStatus && !isScanPending(primaryScanStatus)) {
      void versionsQuery.refetch();
    }
    // versionsQuery.refetch is stable; intentionally keyed on the status only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryScanStatus]);

  const accessLogQuery = useQuery({
    queryKey: ['file-access-log', fileId, accessPage],
    queryFn: () => enterpriseApi.files.accessLog(fileId ?? '', { page: accessPage, per_page: 10 }),
    enabled: open && Boolean(fileId),
  });

  const file = fileQuery.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setAccessPage(1);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{file?.original_name ?? t.detail.fallbackTitle}</DialogTitle>
          <DialogDescription>{t.detail.description}</DialogDescription>
        </DialogHeader>

        {fileQuery.isLoading ? (
          <LoadingSkeleton variant="text" count={4} />
        ) : fileQuery.isError || !file ? (
          <ErrorState
            title={t.detail.loadFailedTitle}
            message={t.detail.loadFailedMessage}
            onRetry={() => void fileQuery.refetch()}
          />
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant={statusVariant(file.status)}>{enumLabel('status', file.status)}</Badge>
              <Badge variant={scanVariant(file.virus_scan_status)}>{enumLabel('scan', file.virus_scan_status)}</Badge>
              <Badge variant="outline">v{file.version_number}</Badge>
              <Badge variant="outline">{enumLabel('lifecycle', file.lifecycle_policy)}</Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => void onDownload(file)}
                disabled={busyKey === `download:${file.id}` || file.status === 'quarantined'}
                title={
                  file.virus_scan_status === 'pending' || file.virus_scan_status === 'scanning'
                    ? t.detail.scanInProgress
                    : file.virus_scan_status === 'error'
                      ? t.detail.scanFailed
                      : undefined
                }
              >
                <Download className="me-2 h-4 w-4" />
                {t.detail.download}
              </Button>
              {!file.encrypted ? (
                <Button
                  variant="outline"
                  onClick={() => void onOpenPresigned(file)}
                  disabled={busyKey === `presigned:${file.id}` || file.status === 'quarantined'}
                >
                  <Eye className="me-2 h-4 w-4" />
                  {t.detail.openPresigned}
                </Button>
              ) : null}
              {isAdmin ? (
                <Button
                  variant="outline"
                  onClick={() => void onRescan(file)}
                  disabled={busyKey === `rescan:${file.id}`}
                >
                  <ScanSearch className="me-2 h-4 w-4" />
                  {t.detail.queueRescan}
                </Button>
              ) : null}
              <Button
                variant="destructive"
                onClick={() => onDelete(file)}
                disabled={busyKey === `delete:${file.id}`}
              >
                <Trash2 className="me-2 h-4 w-4" />
                {t.detail.delete}
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t.detail.metadataTitle}</CardTitle>
                <CardDescription>{t.detail.metadataDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <FileMetadataRow label={t.detail.suite} value={enumLabel('suite', file.suite)} />
                <FileMetadataRow label={t.detail.storedName} value={file.name} />
                <FileMetadataRow label={t.detail.sanitizedName} value={file.sanitized_name} />
                <FileMetadataRow label={t.detail.contentType} value={file.content_type} />
                <FileMetadataRow label={t.detail.detectedType} value={file.detected_content_type || t.detail.notDetected} />
                <FileMetadataRow label={t.detail.size} value={formatBytes(file.size_bytes)} />
                <FileMetadataRow label={t.detail.uploadedBy} value={file.uploaded_by} />
                <FileMetadataRow label={t.detail.checksum} value={<span className="break-all font-mono text-xs">{file.checksum_sha256}</span>} />
                <FileMetadataRow label={t.detail.entityLink} value={file.entity_type && file.entity_id ? `${file.entity_type} / ${file.entity_id}` : t.detail.notLinked} />
                <FileMetadataRow label={t.detail.expiresAt} value={file.expires_at ? formatDateTime(file.expires_at) : t.detail.noExpiry} />
                <FileMetadataRow label={t.detail.created} value={`${formatDateTime(file.created_at)} (${formatRelativeTime(file.created_at)})`} />
                <FileMetadataRow label={t.detail.updated} value={`${formatDateTime(file.updated_at)} (${formatRelativeTime(file.updated_at)})`} />
                <FileMetadataRow
                  label={t.detail.tags}
                  value={
                    file.tags.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {file.tags.map((tag) => (
                          <Badge key={tag} variant="outline">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      t.detail.noTags
                    )
                  }
                />
              </CardContent>
            </Card>

            <Tabs defaultValue="versions">
              <TabsList>
                <TabsTrigger value="versions">{t.detail.versionsTab}</TabsTrigger>
                <TabsTrigger value="access-log">{t.detail.accessLogTab}</TabsTrigger>
              </TabsList>

              <TabsContent value="versions">
                <Card>
                  <CardHeader>
                    <CardTitle>{t.detail.versionHistoryTitle}</CardTitle>
                    <CardDescription>{t.detail.versionHistoryDescription}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {versionsQuery.isLoading ? (
                      <LoadingSkeleton variant="list-item" count={3} />
                    ) : versionsQuery.isError ? (
                      <ErrorState
                        title={t.detail.versionsLoadFailedTitle}
                        message={t.detail.versionsLoadFailedMessage}
                        onRetry={() => void versionsQuery.refetch()}
                      />
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t.detail.colVersion}</TableHead>
                            <TableHead>{t.detail.colStatus}</TableHead>
                            <TableHead>{t.detail.colScan}</TableHead>
                            <TableHead>{t.detail.colCreated}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(versionsQuery.data ?? []).map((version) => (
                            <TableRow key={version.id}>
                              <TableCell className="font-medium">v{version.version_number}</TableCell>
                              <TableCell>
                                <Badge variant={statusVariant(version.status)}>{enumLabel('status', version.status)}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={scanVariant(version.virus_scan_status)}>
                                  {enumLabel('scan', version.virus_scan_status)}
                                </Badge>
                              </TableCell>
                              <TableCell>{formatDateTime(version.created_at)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="access-log">
                <Card>
                  <CardHeader>
                    <CardTitle>{t.detail.accessLogTitle}</CardTitle>
                    <CardDescription>{t.detail.accessLogDescription}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {accessLogQuery.isLoading ? (
                      <LoadingSkeleton variant="table-row" count={4} />
                    ) : accessLogQuery.isError ? (
                      <ErrorState
                        title={t.detail.accessLogFailedTitle}
                        message={t.detail.accessLogFailedMessage}
                        onRetry={() => void accessLogQuery.refetch()}
                      />
                    ) : accessLogQuery.data && accessLogQuery.data.data.length > 0 ? (
                      <>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t.detail.colAction}</TableHead>
                              <TableHead>{t.detail.colUser}</TableHead>
                              <TableHead>{t.detail.colIp}</TableHead>
                              <TableHead>{t.detail.colTime}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {accessLogQuery.data.data.map((entry) => (
                              <TableRow key={entry.id}>
                                <TableCell>{prettyLabelLocalized(entry.action, t.detail.notSet)}</TableCell>
                                <TableCell className="font-mono text-xs">{entry.user_id}</TableCell>
                                <TableCell>{entry.ip_address || t.detail.unknownIp}</TableCell>
                                <TableCell>{formatDateTime(entry.created_at)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        {accessLogQuery.data.meta.total_pages > 1 ? (
                          <PaginationControls
                            page={accessPage}
                            totalPages={accessLogQuery.data.meta.total_pages}
                            onPageChange={setAccessPage}
                          />
                        ) : null}
                      </>
                    ) : (
                      <EmptyState
                        icon={Database}
                        title={t.detail.noAccessTitle}
                        description={t.detail.noAccessDescription}
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function FilesPage() {
  const t = useFilesLabels();
  const enumLabel = useFileEnumLabel();
  const queryClient = useQueryClient();
  const { tenant, user, hasPermission } = useAuth();
  const roleKeys = user ? normalizeRoleKeys(user.roles) : new Set<string>();
  const isAdmin =
    hasPermission('files:*') ||
    roleKeys.has('super_admin') ||
    roleKeys.has('security-manager') ||
    roleKeys.has('security_manager');

  const [page, setPage] = useState(1);
  const [suiteFilter, setSuiteFilter] = useState<string>('all');
  const [sort, setSort] = useState<SortState>({ column: 'created_at', direction: 'desc' });
  const [activeTab, setActiveTab] = useState<'library' | 'quarantine'>('library');
  const [quarantinePage, setQuarantinePage] = useState(1);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<FileRecord | null>(null);
  const [quarantineResolution, setQuarantineResolution] = useState<{
    entry: FileQuarantineEntry;
    action: QuarantineAction;
  } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadConfig, setUploadConfig] = useState({
    suite: 'platform' as FileSuite,
    lifecycle_policy: 'standard' as FileLifecyclePolicy,
    tags: '',
    entity_type: '',
    entity_id: '',
    encrypt: false,
  });

  const filesQuery = useQuery({
    queryKey: ['files', page, suiteFilter],
    queryFn: () =>
      enterpriseApi.files.list({
        page,
        per_page: 25,
        suite: suiteFilter === 'all' ? undefined : suiteFilter,
      }),
  });
  const availableLinkTypes = FILE_LINK_TYPES.filter((option) => option.suite === uploadConfig.suite);
  const selectedLinkType = availableLinkTypes.find((option) => option.value === uploadConfig.entity_type);

  const handleSortChange = (column: string, direction: SortDirection) => {
    setSort({ column, direction });
  };

  // Client-side sort over the current page of file records. Server pagination is
  // preserved; this only reorders the rows already returned for the active page.
  const sortedFiles = useMemo(() => {
    const rows = filesQuery.data?.data ?? [];
    if (!sort.column) return rows;
    const factor = sort.direction === 'asc' ? 1 : -1;
    const value = (file: FileRecord): string | number => {
      switch (sort.column) {
        case 'name':
          return file.original_name?.toLowerCase() ?? '';
        case 'suite':
          return file.suite ?? '';
        case 'status':
          return file.status ?? '';
        case 'scan':
          return file.virus_scan_status ?? '';
        case 'size':
          return file.size_bytes ?? 0;
        case 'created_at':
          return new Date(file.created_at).getTime();
        default:
          return '';
      }
    };
    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      if (typeof left === 'number' && typeof right === 'number') {
        return (left - right) * factor;
      }
      return String(left).localeCompare(String(right)) * factor;
    });
  }, [filesQuery.data?.data, sort]);

  const statsQuery = useQuery({
    queryKey: ['file-storage-stats'],
    queryFn: () => enterpriseApi.files.stats(),
    enabled: isAdmin,
  });

  const quarantineQuery = useQuery({
    queryKey: ['file-quarantine', quarantinePage],
    queryFn: () => enterpriseApi.files.quarantine({ page: quarantinePage, per_page: 20 }),
    enabled: isAdmin,
  });

  const tenantStats = useMemo(() => {
    const stats = statsQuery.data ?? [];
    if (!tenant?.id) return stats;
    const matching = stats.filter((stat) => stat.tenant_id === tenant.id);
    return matching.length > 0 ? matching : stats;
  }, [statsQuery.data, tenant?.id]);

  const totalFiles = tenantStats.reduce((sum, stat) => sum + stat.file_count, 0);
  const totalStorage = tenantStats.reduce((sum, stat) => sum + stat.total_bytes, 0);
  const suiteBreakdown = useMemo(() => {
    return tenantStats.reduce<Record<string, FileStorageStat>>((acc, stat) => {
      const existing = acc[stat.suite];
      if (existing) {
        existing.file_count += stat.file_count;
        existing.total_bytes += stat.total_bytes;
        return acc;
      }
      acc[stat.suite] = { ...stat };
      return acc;
    }, {});
  }, [tenantStats]);

  const refreshAll = async () => {
    await Promise.all([
      filesQuery.refetch(),
      isAdmin ? statsQuery.refetch() : Promise.resolve(null),
      isAdmin ? quarantineQuery.refetch() : Promise.resolve(null),
      // Also refresh the open detail dialog so a rescan / manual refresh
      // reflects the latest scan verdict instead of a stale cached one.
      queryClient.invalidateQueries({ queryKey: ['file-detail'] }),
      queryClient.invalidateQueries({ queryKey: ['file-versions'] }),
    ]);
  };

  const openDetail = (fileId: string) => {
    setSelectedFileId(fileId);
    setDetailOpen(true);
  };

  const handleUpload = async (files: File[]) => {
    setUploading(true);
    setUploadProgress(0);

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        await enterpriseApi.files.upload(
          file,
          {
            suite: uploadConfig.suite,
            lifecycle_policy: uploadConfig.lifecycle_policy,
            encrypt: String(uploadConfig.encrypt),
            ...(uploadConfig.tags.trim() ? { tags: uploadConfig.tags.trim() } : {}),
            ...(uploadConfig.entity_type.trim() ? { entity_type: uploadConfig.entity_type.trim() } : {}),
            ...(uploadConfig.entity_id.trim() ? { entity_id: uploadConfig.entity_id.trim() } : {}),
          },
          (progress) => {
            const completed = index / files.length;
            const current = progress / 100 / files.length;
            setUploadProgress(Math.round((completed + current) * 100));
          },
        );
      }

      toast.success(files.length === 1 ? t.toasts.uploadedOne : t.toasts.uploadedMany(String(files.length)));
      await refreshAll();
    } catch (error) {
      toast.error(parseApiError(error));
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDownload = async (file: FileRecord) => {
    setBusyKey(`download:${file.id}`);
    if (file.virus_scan_status === 'pending' || file.virus_scan_status === 'scanning') {
      toast.warning(t.toasts.scanInProgress);
    } else if (file.virus_scan_status === 'error') {
      toast.warning(t.toasts.scanFailed);
    }
    try {
      const blob = await enterpriseApi.files.download(file.id);
      downloadBlob(blob, file.original_name || file.name);
    } catch (error) {
      toast.error(parseApiError(error));
    } finally {
      setBusyKey(null);
    }
  };

  const handleOpenPresigned = async (file: FileRecord) => {
    setBusyKey(`presigned:${file.id}`);
    try {
      const presigned: FilePresignedDownload = await enterpriseApi.files.getPresignedDownload(file.id);
      window.open(presigned.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast.error(parseApiError(error));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRescan = async (file: FileRecord) => {
    setBusyKey(`rescan:${file.id}`);
    try {
      await enterpriseApi.files.rescan(file.id);
      toast.success(t.toasts.rescanQueued);
      await refreshAll();
    } catch (error) {
      toast.error(parseApiError(error));
    } finally {
      setBusyKey(null);
    }
  };

  const handleDelete = async (file: FileRecord) => {
    setBusyKey(`delete:${file.id}`);
    try {
      await enterpriseApi.files.delete(file.id);
      toast.success(t.toasts.deleted);
      if (selectedFileId === file.id) {
        setDetailOpen(false);
        setSelectedFileId(null);
      }
      await refreshAll();
    } catch (error) {
      toast.error(parseApiError(error));
      throw error;
    } finally {
      setBusyKey(null);
    }
  };

  const handleResolveQuarantine = async (entry: FileQuarantineEntry, action: QuarantineAction) => {
    setBusyKey(`quarantine:${entry.id}:${action}`);
    try {
      await enterpriseApi.files.resolveQuarantine(entry.id, action);
      toast.success(t.toasts.quarantineMarked(enumLabel('quarantineAction', action)));
      await refreshAll();
    } catch (error) {
      toast.error(parseApiError(error));
      throw error;
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t.page.eyebrow}
        title={t.page.title}
        description={t.page.description}
        tags={[
          ...(filesQuery.data
            ? [
                {
                  label: t.page.filesTag(filesQuery.data.meta.total.toLocaleString()),
                  icon: <FileIcon className="h-3.5 w-3.5" aria-hidden />,
                  tone: 'primary' as const,
                },
              ]
            : []),
          ...(isAdmin && (quarantineQuery.data?.meta.total ?? 0) > 0
            ? [
                {
                  label: t.page.quarantinedTag(String(quarantineQuery.data?.meta.total ?? 0)),
                  icon: <ShieldAlert className="h-3.5 w-3.5" aria-hidden />,
                  tone: 'danger' as const,
                },
              ]
            : []),
        ]}
        actions={
          <Button variant="outline" onClick={() => void refreshAll()} disabled={filesQuery.isFetching || busyKey !== null}>
            <RefreshCw className={`me-2 h-4 w-4 ${filesQuery.isFetching ? 'animate-spin' : ''}`} />
            {t.page.refresh}
          </Button>
        }
      />

      {isAdmin ? (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StorageSummaryCard
            title={t.storage.trackedFiles}
            value={statsQuery.isLoading ? '...' : totalFiles.toLocaleString()}
            caption={t.storage.trackedFilesCaption}
            tone="emerald"
            icon={FileIcon}
          />
          <StorageSummaryCard
            title={t.storage.storageUsed}
            value={statsQuery.isLoading ? '...' : formatBytes(totalStorage)}
            caption={t.storage.storageUsedCaption}
            tone="sky"
            icon={HardDrive}
          />
          <StorageSummaryCard
            title={t.storage.quarantineBacklog}
            value={quarantineQuery.isLoading ? '...' : (quarantineQuery.data?.meta.total ?? 0).toLocaleString()}
            caption={t.storage.quarantineBacklogCaption}
            tone={(quarantineQuery.data?.meta.total ?? 0) > 0 ? 'rose' : 'slate'}
            icon={ShieldAlert}
          />
          <StorageSummaryCard
            title={t.storage.activeSuites}
            value={Object.keys(suiteBreakdown).length.toLocaleString()}
            caption={t.storage.activeSuitesCaption}
            tone="gold"
            icon={Layers}
          />
        </section>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t.upload.title}
          </CardTitle>
          <CardDescription>{t.upload.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <Label htmlFor="file-suite">{t.upload.suite}</Label>
              <Select
                value={uploadConfig.suite}
                onValueChange={(value) =>
                  setUploadConfig((current) => ({
                    ...current,
                    suite: value as FileSuite,
                    entity_type: '',
                    entity_id: '',
                  }))
                }
              >
                <SelectTrigger id="file-suite">
                  <SelectValue placeholder={t.upload.selectSuite} />
                </SelectTrigger>
                <SelectContent>
                  {FILE_SUITES.map((suite) => (
                    <SelectItem key={suite} value={suite}>
                      {enumLabel('suite', suite)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="file-policy">{t.upload.lifecyclePolicy}</Label>
              <Select
                value={uploadConfig.lifecycle_policy}
                onValueChange={(value) =>
                  setUploadConfig((current) => ({
                    ...current,
                    lifecycle_policy: value as FileLifecyclePolicy,
                  }))
                }
              >
                <SelectTrigger id="file-policy">
                  <SelectValue placeholder={t.upload.selectLifecyclePolicy} />
                </SelectTrigger>
                <SelectContent>
                  {FILE_LIFECYCLE_POLICIES.map((policy) => (
                    <SelectItem key={policy} value={policy}>
                      {enumLabel('lifecycle', policy)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="file-entity-type">{t.upload.entityType}</Label>
              <Select
                value={uploadConfig.entity_type || FILE_LINK_NONE}
                onValueChange={(value) =>
                  setUploadConfig((current) => ({
                    ...current,
                    entity_type: value === FILE_LINK_NONE ? '' : value,
                    entity_id: '',
                  }))
                }
              >
                <SelectTrigger id="file-entity-type">
                  <SelectValue placeholder={t.upload.entityTypePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILE_LINK_NONE}>{t.upload.entityTypePlaceholder}</SelectItem>
                  {availableLinkTypes.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="file-entity-id">{t.upload.entityId}</Label>
              <AsyncRecordPicker
                id="file-entity-id"
                ariaLabel={t.upload.entityId}
                queryKey={['file-upload-linked-record', uploadConfig.suite, uploadConfig.entity_type]}
                loadOptions={(search) => selectedLinkType ? loadFileLinkOptions(selectedLinkType, search) : Promise.resolve([])}
                value={uploadConfig.entity_id}
                onChange={(value) => setUploadConfig((current) => ({ ...current, entity_id: value }))}
                enabled={Boolean(selectedLinkType)}
                allowClear
                labels={{ select: t.upload.entityIdPlaceholder, search: t.upload.entityIdPlaceholder }}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="file-tags">{t.upload.tags}</Label>
              <Input
                id="file-tags"
                placeholder={t.upload.tagsPlaceholder}
                value={uploadConfig.tags}
                onChange={(event) =>
                  setUploadConfig((current) => ({ ...current, tags: event.target.value }))
                }
              />
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/70 px-4 py-3">
            <Checkbox
              id="file-encrypt"
              checked={uploadConfig.encrypt}
              onCheckedChange={(checked) =>
                setUploadConfig((current) => ({ ...current, encrypt: checked === true }))
              }
            />
            <div className="space-y-1">
              <Label htmlFor="file-encrypt" className="cursor-pointer">
                {t.upload.encryptLabel}
              </Label>
              <p className="text-sm text-muted-foreground">{t.upload.encryptDescription}</p>
            </div>
          </div>

          <FileUpload
            accept="*/*"
            maxSizeMB={100}
            multiple={false}
            onUpload={handleUpload}
            uploading={uploading}
            progress={uploadProgress}
          />
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'library' | 'quarantine')}>
        <TabsList>
          <TabsTrigger value="library">{t.tabs.library}</TabsTrigger>
          {isAdmin ? <TabsTrigger value="quarantine">{t.tabs.quarantine}</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="library" className="space-y-4">
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <Label htmlFor="suite-filter">{t.library.suiteFilter}</Label>
              <Select
                value={suiteFilter}
                onValueChange={(value) => {
                  setSuiteFilter(value);
                  setPage(1);
                }}
              >
                <SelectTrigger id="suite-filter" className="w-[220px]">
                  <SelectValue placeholder={t.library.allSuites} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.library.allSuites}</SelectItem>
                  {FILE_SUITES.map((suite) => (
                    <SelectItem key={suite} value={suite}>
                      {enumLabel('suite', suite)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <p className="text-sm text-muted-foreground">
              {filesQuery.data ? t.library.filesReturned(filesQuery.data.meta.total.toLocaleString()) : t.library.loadingInventory}
            </p>
          </div>

          {filesQuery.isLoading ? (
            <LoadingSkeleton variant="table" count={8} />
          ) : filesQuery.isError ? (
            <ErrorState message={t.library.loadFailed} onRetry={() => void filesQuery.refetch()} />
          ) : !filesQuery.data || filesQuery.data.data.length === 0 ? (
            <EmptyState
              icon={FileIcon}
              title={t.library.emptyTitle}
              description={t.library.emptyDescription}
            />
          ) : (
            <Card className="overflow-hidden">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="table-premium min-w-full">
                    <thead>
                      <tr>
                        <TableSortHeader column="name" sort={sort} onSortChange={handleSortChange}>
                          {t.library.colName}
                        </TableSortHeader>
                        <TableSortHeader column="suite" sort={sort} onSortChange={handleSortChange}>
                          {t.library.colSuite}
                        </TableSortHeader>
                        <TableSortHeader column="status" sort={sort} onSortChange={handleSortChange}>
                          {t.library.colStatus}
                        </TableSortHeader>
                        <TableSortHeader column="scan" sort={sort} onSortChange={handleSortChange}>
                          {t.library.colScan}
                        </TableSortHeader>
                        <TableSortHeader column="size" sort={sort} onSortChange={handleSortChange} align="right">
                          {t.library.colSize}
                        </TableSortHeader>
                        <TableSortHeader column="created_at" sort={sort} onSortChange={handleSortChange}>
                          {t.library.colCreated}
                        </TableSortHeader>
                        <th scope="col" className="w-[220px]">
                          <span className="sr-only">{t.detail.colAction}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFiles.map((file) => (
                        <tr key={file.id}>
                          <td className="py-4">
                            <div className="space-y-1">
                              <div className="font-medium text-foreground">{file.original_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {file.entity_type && file.entity_id
                                  ? `${file.entity_type} / ${file.entity_id}`
                                  : file.name}
                              </div>
                            </div>
                          </td>
                          <td className="py-4">{enumLabel('suite', file.suite)}</td>
                          <td className="py-4">
                            <Badge variant={statusVariant(file.status)}>{enumLabel('status', file.status)}</Badge>
                          </td>
                          <td className="py-4">
                            <Badge variant={scanVariant(file.virus_scan_status)}>
                              {enumLabel('scan', file.virus_scan_status)}
                            </Badge>
                          </td>
                          <td className="py-4 text-end tabular-nums">{formatBytes(file.size_bytes)}</td>
                          <td className="py-4">
                            <div className="space-y-1">
                              <div className="text-foreground">{formatDateTime(file.created_at)}</div>
                              <div className="text-xs text-muted-foreground">
                                {formatRelativeTime(file.created_at)}
                              </div>
                            </div>
                          </td>
                          <td className="py-4">
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => openDetail(file.id)}>
                                <Eye className="me-2 h-4 w-4" />
                                {t.library.inspect}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busyKey === `download:${file.id}` || file.status === 'quarantined'}
                                onClick={() => void handleDownload(file)}
                                title={
                                  file.virus_scan_status === 'pending' || file.virus_scan_status === 'scanning'
                                    ? t.detail.scanInProgress
                                    : file.virus_scan_status === 'error'
                                      ? t.detail.scanFailed
                                      : undefined
                                }
                              >
                                <Download className="me-2 h-4 w-4" />
                                {t.library.download}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {filesQuery.data.meta.total_pages > 1 ? (
                  <PaginationControls
                    page={page}
                    totalPages={filesQuery.data.meta.total_pages}
                    onPageChange={setPage}
                  />
                ) : null}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="quarantine" className="space-y-4">
            {!statsQuery.isLoading && Object.keys(suiteBreakdown).length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {Object.values(suiteBreakdown).map((stat) => (
                  <div key={stat.suite} className="space-y-1">
                    <StatCard label={enumLabel('suite', stat.suite)} value={formatBytes(stat.total_bytes)} tone="slate" icon={Database} />
                    <p className="px-1 text-xs text-muted-foreground">
                      {t.quarantine.trackedFileCount(stat.file_count.toLocaleString())}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {quarantineQuery.isLoading ? (
              <LoadingSkeleton variant="table" count={6} />
            ) : quarantineQuery.isError ? (
              <ErrorState
                title={t.quarantine.loadFailedTitle}
                message={t.quarantine.loadFailedMessage}
                onRetry={() => void quarantineQuery.refetch()}
              />
            ) : !quarantineQuery.data || quarantineQuery.data.data.length === 0 ? (
              <EmptyState
                icon={ShieldAlert}
                title={t.quarantine.emptyTitle}
                description={t.quarantine.emptyDescription}
              />
            ) : (
              <Card className="overflow-hidden">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldAlert className="h-5 w-5" />
                    {t.quarantine.title}
                  </CardTitle>
                  <CardDescription>{t.quarantine.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="table-premium min-w-full">
                      <thead>
                        <tr>
                          <th scope="col">{t.quarantine.colFileId}</th>
                          <th scope="col">{t.quarantine.colVirus}</th>
                          <th scope="col">{t.quarantine.colQuarantined}</th>
                          <th scope="col">{t.quarantine.colAction}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {quarantineQuery.data.data.map((entry) => (
                          <tr key={entry.id}>
                            <td className="py-4 font-mono text-xs">{entry.file_id}</td>
                            <td className="py-4">
                              <Badge variant={entry.virus_name ? 'destructive' : 'outline'}>
                                {entry.virus_name || t.quarantine.unknownVirus}
                              </Badge>
                            </td>
                            <td className="py-4">
                              <div className="space-y-1">
                                <div className="text-foreground">{formatDateTime(entry.quarantined_at)}</div>
                                <div className="text-xs text-muted-foreground">
                                  {formatRelativeTime(entry.quarantined_at)}
                                </div>
                              </div>
                            </td>
                            <td className="py-4">
                              <div className="flex flex-wrap gap-2">
                                {QUARANTINE_ACTIONS.map((action) => (
                                  <Button
                                    key={action}
                                    size="sm"
                                    variant={action === 'deleted' ? 'destructive' : 'outline'}
                                    disabled={busyKey === `quarantine:${entry.id}:${action}`}
                                    onClick={() => setQuarantineResolution({ entry, action })}
                                  >
                                    {enumLabel('quarantineAction', action)}
                                  </Button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {quarantineQuery.data.meta.total_pages > 1 ? (
                    <PaginationControls
                      page={quarantinePage}
                      totalPages={quarantineQuery.data.meta.total_pages}
                      onPageChange={setQuarantinePage}
                    />
                  ) : null}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ) : null}
      </Tabs>

      <FileDetailDialog
        fileId={selectedFileId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        isAdmin={isAdmin}
        busyKey={busyKey}
        onDownload={handleDownload}
        onOpenPresigned={handleOpenPresigned}
        onRescan={handleRescan}
        onDelete={setDeleteCandidate}
      />

      <ConfirmDialog
        open={Boolean(deleteCandidate)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteCandidate(null);
          }
        }}
        title={t.dialogs.deleteTitle}
        description={
          deleteCandidate ? t.dialogs.deleteDescription(deleteCandidate.original_name) : ''
        }
        confirmLabel={t.dialogs.deleteConfirm}
        variant="destructive"
        typeToConfirm={deleteCandidate?.original_name}
        loading={deleteCandidate ? busyKey === `delete:${deleteCandidate.id}` : false}
        onConfirm={async () => {
          if (deleteCandidate) {
            await handleDelete(deleteCandidate);
            setDeleteCandidate(null);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(quarantineResolution)}
        onOpenChange={(open) => {
          if (!open) {
            setQuarantineResolution(null);
          }
        }}
        title={t.dialogs.resolveTitle}
        description={
          quarantineResolution
            ? t.dialogs.resolveDescription(enumLabel('quarantineAction', quarantineResolution.action))
            : ''
        }
        confirmLabel={
          quarantineResolution
            ? enumLabel('quarantineAction', quarantineResolution.action)
            : t.dialogs.resolveFallbackConfirm
        }
        variant={quarantineResolution?.action === 'deleted' ? 'destructive' : 'default'}
        loading={
          quarantineResolution
            ? busyKey === `quarantine:${quarantineResolution.entry.id}:${quarantineResolution.action}`
            : false
        }
        onConfirm={async () => {
          if (quarantineResolution) {
            await handleResolveQuarantine(quarantineResolution.entry, quarantineResolution.action);
            setQuarantineResolution(null);
          }
        }}
      />
    </div>
  );
}
