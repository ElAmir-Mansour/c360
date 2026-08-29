'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/common/page-header';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { SearchInput } from '@/components/shared/forms/search-input';
import { TemplateCard } from './template-card';
import { useFormat } from '@/lib/format/index';
import { useWorkflowTemplates } from '@/hooks/use-workflow-templates';
import { useCreateDefinitionFromTemplate } from '@/hooks/use-workflow-templates';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import {
  getTemplateDisplay,
  getWorkflowCategoryLabel,
  TEMPLATE_CATEGORY_VALUES,
  useTemplateLocalLabels,
} from './template-i18n';
import type { WorkflowTemplate } from '@/types/models';

export function TemplateGallery() {
  const router = useRouter();
  const t = useT('admin');
  const labels = useTemplateLocalLabels();
  const { locale } = useLocaleOrDefault();
  const { formatNumber } = useFormat();
  const categoryLabel = (v: string): string => getWorkflowCategoryLabel(labels, v);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [useDialogTemplate, setUseDialogTemplate] =
    useState<WorkflowTemplate | null>(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const { data, isLoading, isError, refetch } = useWorkflowTemplates({
    per_page: 100,
    ...(category !== 'all' ? { category } : {}),
    ...(search ? { search } : {}),
  });

  const createFromTemplate = useCreateDefinitionFromTemplate();
  const templates = useMemo(() => data?.data ?? [], [data]);

  const metrics = useMemo(() => {
    const categories = new Set(
      templates.map((t) => t.category).filter((c) => Boolean(c)),
    );
    return { available: templates.length, categories: categories.size };
  }, [templates]);

  function handleUseTemplate(template: WorkflowTemplate) {
    const display = getTemplateDisplay(template, labels, locale);
    setUseDialogTemplate(template);
    setNewName(t('tg.copyName', { name: display.name }));
    setNewDescription(display.description);
  }

  function handleCreate() {
    if (!useDialogTemplate || !newName.trim()) return;
    createFromTemplate.mutate(
      {
        template_id: useDialogTemplate.id,
        name: newName,
        description: newDescription || undefined,
      },
      {
        onSuccess: (def) => {
          setUseDialogTemplate(null);
          router.push(`/admin/workflows/definitions/${def.id}/designer`);
        },
      },
    );
  }

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={t('td.eyebrow')}
          title={t('tg.title')}
          description={t('tg.descShort')}
        />
        <ErrorState
          message={t('tg.failedLoad')}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={t('td.eyebrow')}
        title={t('tg.title')}
        description={t('tg.desc')}
        tags={
          isLoading
            ? undefined
            : [
                {
                  label: t('tg.templatesCount', { n: formatNumber(metrics.available) }),
                  tone: metrics.available > 0 ? 'info' : 'neutral',
                  icon: <LayoutTemplate className="h-3.5 w-3.5" aria-hidden />,
                },
                {
                  label: t('tg.categoriesCount', { n: formatNumber(metrics.categories) }),
                  tone: 'neutral',
                },
              ]
        }
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('tg.searchPlaceholder')}
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-40 h-8 text-sm">
            <SelectValue placeholder={t('tg.category')} />
          </SelectTrigger>
          <SelectContent>
            {TEMPLATE_CATEGORY_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {categoryLabel(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <LoadingSkeleton variant="card" count={6} />
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-sm font-medium">{t('tg.noTemplates')}</p>
          <p className="text-xs mt-1">{t('tg.noTemplatesHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onClick={handleUseTemplate}
            />
          ))}
        </div>
      )}

      {/* Use template dialog */}
      <Dialog
        open={!!useDialogTemplate}
        onOpenChange={(open) => {
          if (!open) setUseDialogTemplate(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tg.useTemplate')}</DialogTitle>
            <DialogDescription>
              {t('tg.createFromDesc', {
                name: useDialogTemplate
                  ? getTemplateDisplay(useDialogTemplate, labels, locale).name
                  : '',
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="def-name" className="text-xs">
                {t('c.name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="def-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="def-desc" className="text-xs">
                {t('c.description')}
              </Label>
              <Input
                id="def-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUseDialogTemplate(null)}
            >
              {t('c.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createFromTemplate.isPending}
            >
              {createFromTemplate.isPending && (
                <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
              )}
              {t('c.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
