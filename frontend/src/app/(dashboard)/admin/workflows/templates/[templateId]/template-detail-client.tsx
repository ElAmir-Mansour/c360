'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, type PageHeaderTag } from '@/components/common/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { useFormat } from '@/lib/format/index';
import { useWorkflowTemplate } from '@/hooks/use-workflow-templates';
import { useCreateDefinitionFromTemplate } from '@/hooks/use-workflow-templates';
import { useLocaleOrDefault, useT } from '@/components/providers/locale-provider';
import {
  getTemplateDisplay,
  getTemplateDefaultValueLabel,
  getTemplateStepNameLabel,
  getTemplateStepTypeLabel,
  getTemplateVariableNameLabel,
  getTemplateVariableTypeLabel,
  useTemplateLocalLabels,
} from '../components/template-i18n';

export function TemplateDetailClient() {
  const t = useT('admin');
  const labels = useTemplateLocalLabels();
  const { locale } = useLocaleOrDefault();
  const { formatNumber } = useFormat();
  const params = useParams();
  const router = useRouter();
  const templateId = (params?.templateId as string | undefined) ?? '';
  const [showUseDialog, setShowUseDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const { data: template, isLoading, isError, refetch } =
    useWorkflowTemplate(templateId);
  const createFromTemplate = useCreateDefinitionFromTemplate();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  if (isError || !template) {
    return (
      <ErrorState
        message={t('tpl.failedLoad')}
        onRetry={() => refetch()}
      />
    );
  }

  function handleUse() {
    const display = getTemplateDisplay(template!, labels, locale);
    setNewName(t('tg.copyName', { name: display.name }));
    setNewDescription(display.description);
    setShowUseDialog(true);
  }

  function handleCreate() {
    if (!newName.trim()) return;
    createFromTemplate.mutate(
      {
        template_id: templateId,
        name: newName,
        description: newDescription || undefined,
      },
      {
        onSuccess: (def) => {
          setShowUseDialog(false);
          router.push(`/admin/workflows/definitions/${def.id}/designer`);
        },
      },
    );
  }

  const display = getTemplateDisplay(template, labels, locale);

  return (
    <div className="space-y-6">
      <button
        onClick={() => router.push('/admin/workflows/templates')}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        type="button"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" />
        {t('tpl.back')}
      </button>

      <PageHeader
        eyebrow={t('tpl.eyebrow')}
        title={display.name}
        description={display.description || undefined}
        tags={[
          { label: display.category, tone: 'primary' },
          ...(display.tags.map((tag) => ({
            label: tag,
            tone: 'neutral',
          })) as PageHeaderTag[]),
        ]}
        actions={
          <Button size="sm" onClick={handleUse}>
            <Rocket className="me-1 h-3.5 w-3.5" />
            {t('tpl.useThis')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Steps */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t('tpl.stepsCount', { n: formatNumber(template.steps?.length ?? 0) })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {(template.steps ?? []).map((step, idx) => (
                <div
                  key={step.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <span className="text-xs text-muted-foreground w-4">
                    {formatNumber(idx + 1)}.
                  </span>
                  <span className="font-medium">
                    {getTemplateStepNameLabel(
                      labels,
                      step.name,
                      step.type,
                      formatNumber(idx + 1),
                      locale,
                    )}
                  </span>
                  <Badge variant="outline" className="text-overline">
                    {getTemplateStepTypeLabel(labels, step.type)}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Variables */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              {t('tpl.variablesCount', {
                n: formatNumber(template.variables ? Object.keys(template.variables).length : 0),
              })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(!template.variables || Object.keys(template.variables).length === 0) ? (
              <p className="text-xs text-muted-foreground">
                {t('tpl.noVariables')}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{t('tpl.colName')}</TableHead>
                    <TableHead className="text-xs">{t('tpl.colType')}</TableHead>
                    <TableHead className="text-xs">{t('tpl.colDefault')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(template.variables).map(([name, v], idx) => (
                    <TableRow key={name}>
                      <TableCell className="font-mono text-xs py-1.5">
                        {getTemplateVariableNameLabel(
                          labels,
                          name,
                          formatNumber(idx + 1),
                          locale,
                        )}
                      </TableCell>
                      <TableCell className="text-xs py-1.5">
                        <Badge variant="outline" className="text-overline">
                          {getTemplateVariableTypeLabel(labels, v.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs py-1.5">
                        {getTemplateDefaultValueLabel(labels, v.default)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Use template dialog */}
      <Dialog open={showUseDialog} onOpenChange={setShowUseDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('tpl.useTitle')}</DialogTitle>
            <DialogDescription>
              {t('tpl.useDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="tpl-name" className="text-xs">
                {t('tpl.name')} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tpl-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tpl-desc" className="text-xs">
                {t('tpl.description')}
              </Label>
              <Input
                id="tpl-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowUseDialog(false)}
            >
              {t('tpl.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createFromTemplate.isPending}
            >
              {createFromTemplate.isPending && (
                <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
              )}
              {t('tpl.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
