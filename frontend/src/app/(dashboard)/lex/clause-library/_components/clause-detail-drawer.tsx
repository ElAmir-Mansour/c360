'use client';

import { CopyPlus, ExternalLink, FileText, Pencil, Tags } from 'lucide-react';
import { RelativeTime } from '@/components/shared/relative-time';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatDateTime } from '@/lib/utils';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { LexClauseLibraryEntry } from '@/types/suites';
import { ClauseUseActions } from './clause-use-actions';
import { ClauseVersionHistory } from './clause-version-history';
import { formatClauseVersion } from './clause-library-utils';
import { type ClauseLibraryLabels, useClauseLibraryLabels } from './clause-content-labels';
import { useClauseTaxonomyLabels } from './clause-taxonomy-labels';

export interface ClauseDetailDrawerProps {
  entry: LexClauseLibraryEntry | null;
  relatedEntries?: LexClauseLibraryEntry[];
  onEdit?: (entry: LexClauseLibraryEntry) => void;
  onCloneVersion?: (entry: LexClauseLibraryEntry) => void;
  onClose: () => void;
}

export function ClauseDetailDrawer({
  entry,
  relatedEntries,
  onEdit,
  onCloneVersion,
  onClose,
}: ClauseDetailDrawerProps) {
  const labels = useClauseLibraryLabels();
  const taxonomy = useClauseTaxonomyLabels();
  const { locale } = useLocaleOrDefault();
  const t = labels.drawer;
  return (
    <Sheet
      open={Boolean(entry)}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-hidden p-0 sm:max-w-3xl">
        {entry ? (
          <div className="flex h-full flex-col">
            <div className="border-b border-border/70 px-6 py-5">
              <SheetHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{entry.code}</Badge>
                  <Badge variant="secondary">{formatClauseVersion(entry.version)}</Badge>
                  <StatusBadge
                    status={String(entry.status)}
                    label={taxonomy.status(entry.status)}
                    size="sm"
                  />
                  <Badge variant="outline">
                    {t.governancePrefix(taxonomy.status(entry.governance_status))}
                  </Badge>
                </div>
                <div>
                  <SheetTitle className="text-xl" dir="auto">
                    {resolveLocalized({ en: entry.title_en, ar: entry.title_ar }, locale) || entry.code}
                  </SheetTitle>
                  <SheetDescription>
                    {t.clauseForJurisdiction(
                      taxonomy.clauseType(entry.clause_type),
                      entry.jurisdiction || t.defaultJurisdiction,
                    )}
                  </SheetDescription>
                </div>
              </SheetHeader>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {onEdit ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onEdit(entry)}>
                    <Pencil className="me-1.5 h-4 w-4" aria-hidden="true" />
                    {t.edit}
                  </Button>
                ) : null}
                {onCloneVersion ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onCloneVersion(entry)}
                  >
                    <CopyPlus className="me-1.5 h-4 w-4" aria-hidden="true" />
                    {t.cloneVersion}
                  </Button>
                ) : null}
                <ClauseUseActions entry={entry} />
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="px-6 py-5">
                <Tabs defaultValue="preview" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="preview">{t.tabPreview}</TabsTrigger>
                    <TabsTrigger value="versions">{t.tabVersions}</TabsTrigger>
                    <TabsTrigger value="metadata">{t.tabMetadata}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="preview" className="space-y-5">
                    <ClausePreview entry={entry} t={t} locale={locale} />
                  </TabsContent>

                  <TabsContent value="versions">
                    <ClauseVersionHistory entry={entry} relatedEntries={relatedEntries} />
                  </TabsContent>

                  <TabsContent value="metadata">
                    <ClauseMetadata entry={entry} t={t} />
                  </TabsContent>
                </Tabs>
              </div>
            </ScrollArea>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ClausePreview({
  entry,
  t,
  locale,
}: {
  entry: LexClauseLibraryEntry;
  t: ClauseLibraryLabels['drawer'];
  locale: string;
}) {
  const sections = locale === 'ar'
    ? [
        {
          key: 'ar',
          title: t.arabic,
          dir: 'rtl' as const,
          heading: entry.title_ar || t.noArabicTitle,
          body: entry.text_ar || t.noArabicText,
        },
        {
          key: 'en',
          title: t.english,
          dir: 'auto' as const,
          heading: entry.title_en || t.untitledClause,
          body: entry.text_en || t.noEnglishText,
        },
      ]
    : [
        {
          key: 'en',
          title: t.english,
          dir: 'auto' as const,
          heading: entry.title_en || t.untitledClause,
          body: entry.text_en || t.noEnglishText,
        },
        {
          key: 'ar',
          title: t.arabic,
          dir: 'rtl' as const,
          heading: entry.title_ar || t.noArabicTitle,
          body: entry.text_ar || t.noArabicText,
        },
      ];

  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section key={section.key} className="space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-medium">{section.title}</h3>
          </div>
          <div className="rounded-lg border border-border/70 bg-card/60 p-4" dir={section.dir}>
            <h4 className="text-base font-semibold">{section.heading}</h4>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-foreground">
              {section.body}
            </p>
          </div>
        </section>
      ))}

      {entry.tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Tags className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {entry.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ClauseMetadata({
  entry,
  t,
}: {
  entry: LexClauseLibraryEntry;
  t: ClauseLibraryLabels['drawer'];
}) {
  const taxonomy = useClauseTaxonomyLabels();
  const m = t.metadata;
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MetadataItem label={m.clauseType} value={taxonomy.clauseType(entry.clause_type)} />
        <MetadataItem label={m.category} value={entry.category || m.notSet} />
        <MetadataItem label={m.jurisdiction} value={entry.jurisdiction || m.notSet} />
        <MetadataItem label={m.language} value={taxonomy.language(entry.language)} />
        <MetadataItem label={m.riskLevel} value={taxonomy.risk(entry.risk_level)} />
        <MetadataItem label={m.source} value={entry.source || m.notSet} />
        <MetadataItem label={m.created} value={formatDateTime(entry.created_at)} />
        <MetadataItem label={m.updated} value={formatDateTime(entry.updated_at)} />
        <MetadataItem label={m.createdBy} value={entry.created_by || m.notSet} />
        <MetadataItem label={m.updatedBy} value={entry.updated_by || m.notSet} />
      </dl>

      {entry.source_url ? (
        <>
          <Separator />
          <a
            href={entry.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            {m.sourceUrl}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </>
      ) : null}

      <Separator />

      <div className="space-y-2 text-sm">
        <p className="font-medium">{m.recordIds}</p>
        <dl className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3 text-xs">
          <MetadataItem compact label={m.id} value={entry.id} />
          <MetadataItem compact label={m.tenantId} value={entry.tenant_id} />
          <MetadataItem compact label={m.supersedesId} value={entry.supersedes_id || m.notSet} />
          <MetadataItem compact label={m.deprecatedById} value={entry.deprecated_by_id || m.notSet} />
          <MetadataItem compact label={m.replacementClauseId} value={entry.replacement_clause_id || m.notSet} />
        </dl>
      </div>

      {entry.deprecated_at ? (
        <p className="text-sm text-muted-foreground">
          {m.deprecatedRelative} <RelativeTime date={entry.deprecated_at} />.
        </p>
      ) : null}
    </div>
  );
}

function MetadataItem({
  label,
  value,
  compact = false,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? 'grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]' : 'rounded-lg border border-border/70 bg-card/60 p-3'}>
      <dt className="text-xs font-medium uppercase text-muted-foreground">{label}</dt>
      <dd className={compact ? 'break-all text-xs text-foreground' : 'mt-1 break-words text-sm text-foreground'}>
        {value}
      </dd>
    </div>
  );
}
