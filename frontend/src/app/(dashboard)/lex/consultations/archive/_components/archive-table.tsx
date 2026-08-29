'use client';

import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  FolderArchive,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
  StatusBadge,
  type StatusTone,
} from '@/components/shared/status-badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { useLexFormat } from '@/lib/lex/ksa';
import type { Consultation } from '@/lib/lex/consultations';
import { useConsultationLabels } from '../../_components/labels';
import { useConsultationArchiveLabels } from './archive-labels';
import { consultationResolvedAt } from './archive-utils';

const CONSULTATION_STATUS_TONE: Record<Consultation['status'], StatusTone> = {
  submitted: 'info',
  classified: 'pending',
  routed: 'warning',
  responded: 'success',
  approved: 'primary',
  archived: 'neutral',
};

interface ConsultationArchiveTableProps {
  consultations: Consultation[];
  totalRows: number;
  page: number;
  pageSize: number;
  loading?: boolean;
  error?: string | null;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRetry?: () => void;
}

export function ConsultationArchiveTable({
  consultations,
  totalRows,
  page,
  pageSize,
  loading = false,
  error,
  onPageChange,
  onPageSizeChange,
  onRetry,
}: ConsultationArchiveTableProps) {
  const archiveLabels = useConsultationArchiveLabels();
  const consultationLabels = useConsultationLabels();
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize));
  const firstRow = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, totalRows);

  const renderActions = (consultation: Consultation) => (
    <div className="flex items-center justify-end">
      <Button asChild variant="outline" size="sm">
        <Link href={`/lex/consultations/${consultation.id}`}>
          {archiveLabels.table.view}
        </Link>
      </Button>
    </div>
  );

  const body = (() => {
    if (loading) {
      return (
        <div className="space-y-3 p-5" aria-busy="true">
          {Array.from({ length: Math.min(pageSize, 8) }).map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="max-w-lg text-sm text-muted-foreground">{error}</p>
          {onRetry ? (
            <Button type="button" variant="outline" onClick={onRetry}>
              {archiveLabels.table.retry}
            </Button>
          ) : null}
        </div>
      );
    }

    if (consultations.length === 0) {
      return (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <FolderArchive className="h-6 w-6" aria-hidden />
          </div>
          <div>
            <h2 className="font-semibold">{archiveLabels.table.emptyTitle}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {archiveLabels.table.emptyDescription}
            </p>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="hidden overflow-x-auto sm:block">
          <Table>
            <TableHeader className="bg-primary/[0.035]">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-foreground/80">
                  {archiveLabels.columns.reference}
                </TableHead>
                <TableHead className="text-foreground/80">
                  {archiveLabels.columns.subject}
                </TableHead>
                <TableHead className="text-foreground/80">
                  {archiveLabels.columns.requester}
                </TableHead>
                <TableHead className="text-foreground/80">
                  {archiveLabels.columns.advisor}
                </TableHead>
                <TableHead className="text-foreground/80">
                  {archiveLabels.columns.submitted}
                </TableHead>
                <TableHead className="text-foreground/80">
                  {archiveLabels.columns.resolved}
                </TableHead>
                <TableHead className="text-foreground/80">
                  {archiveLabels.columns.status}
                </TableHead>
                <TableHead className="text-end text-foreground/80">
                  {archiveLabels.columns.actions}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {consultations.map((consultation) => {
                const title =
                  resolveLocalized(consultation.title, locale) ||
                  consultation.consultation_number;
                const resolvedAt = consultationResolvedAt(consultation);
                return (
                  <TableRow key={consultation.id} className="hover:bg-primary/[0.035]">
                    <TableCell>
                      <Link
                        href={`/lex/consultations/${consultation.id}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {consultation.consultation_number}
                      </Link>
                    </TableCell>
                    <TableCell className="min-w-64 max-w-96">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 truncate font-medium" title={title}>
                          {title}
                        </span>
                        <Badge variant="outline" size="sm" className="shrink-0">
                          {consultationLabels.filters.typeOptions[consultation.type]}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{consultation.requester_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {consultation.department ||
                            archiveLabels.table.noDepartment}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {consultation.advisor_name ||
                        archiveLabels.table.unassigned}
                    </TableCell>
                    <TableCell>
                      <time dateTime={consultation.created_at}>
                        {f.formatDate(consultation.created_at)}
                      </time>
                    </TableCell>
                    <TableCell>
                      {resolvedAt ? (
                        <time dateTime={resolvedAt}>
                          {f.formatDate(resolvedAt)}
                        </time>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={consultation.status}
                        tone={CONSULTATION_STATUS_TONE[consultation.status]}
                        label={
                          consultationLabels.filters.statusOptions[
                            consultation.status
                          ]
                        }
                        size="sm"
                      />
                    </TableCell>
                    <TableCell>{renderActions(consultation)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div className="divide-y divide-border/60 sm:hidden">
          {consultations.map((consultation) => {
            const title =
              resolveLocalized(consultation.title, locale) ||
              consultation.consultation_number;
            const resolvedAt = consultationResolvedAt(consultation);
            return (
              <article key={consultation.id} className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/lex/consultations/${consultation.id}`}
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      {consultation.consultation_number}
                    </Link>
                    <h2 className="mt-1 line-clamp-2 font-semibold">{title}</h2>
                  </div>
                  <StatusBadge
                    status={consultation.status}
                    tone={CONSULTATION_STATUS_TONE[consultation.status]}
                    label={
                      consultationLabels.filters.statusOptions[
                        consultation.status
                      ]
                    }
                    size="sm"
                  />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {archiveLabels.columns.requester}
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {consultation.requester_name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {archiveLabels.columns.advisor}
                    </dt>
                    <dd className="mt-0.5 font-medium">
                      {consultation.advisor_name ||
                        archiveLabels.table.unassigned}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {archiveLabels.columns.submitted}
                    </dt>
                    <dd className="mt-0.5">
                      {f.formatDate(consultation.created_at)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {archiveLabels.columns.resolved}
                    </dt>
                    <dd className="mt-0.5">
                      {resolvedAt ? f.formatDate(resolvedAt) : '—'}
                    </dd>
                  </div>
                </dl>
                {renderActions(consultation)}
              </article>
            );
          })}
        </div>
      </>
    );
  })();

  return (
    <section
      className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-elevation-1"
      aria-label={archiveLabels.title}
    >
      {body}
      {!loading && !error && totalRows > 0 ? (
        <div className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            {archiveLabels.table.showing(
              f.formatNumber(firstRow),
              f.formatNumber(lastRow),
              f.formatNumber(totalRows),
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="consultation-archive-page-size"
              className="sr-only"
            >
              {archiveLabels.table.rowsPerPage}
            </label>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger
                id="consultation-archive-page-size"
                className="h-9 w-20"
                aria-label={archiveLabels.table.rowsPerPage}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {f.formatNumber(size)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="min-w-28 text-center text-sm font-medium">
              {archiveLabels.table.page(
                f.formatNumber(page),
                f.formatNumber(pageCount),
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              disabled={page <= 1}
              aria-label={archiveLabels.table.previousPage}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              disabled={page >= pageCount}
              aria-label={archiveLabels.table.nextPage}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
