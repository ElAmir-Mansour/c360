'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { enterpriseApi } from '@/lib/enterprise';
import type { LexPlaybookTemplate } from '@/types/suites';
import { usePlaybookLabels } from './labels';
import { formatToken } from './playbook-form';

interface PlaybookTemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: LexPlaybookTemplate) => void;
}

/**
 * WTQ-RSK-02 #7 — template library picker. Lists the static playbook templates
 * and lets the user clone one into a new DRAFT playbook. On "Use template" it
 * hands the chosen template back to the caller (which prefills the create
 * dialog) and closes itself.
 *
 * This is the cross-agent contract the catalog "New from template" entry point
 * relies on: props are exactly `{ open, onOpenChange, onSelect }`.
 */
export function PlaybookTemplatePicker({
  onOpenChange,
  onSelect,
  open,
}: PlaybookTemplatePickerProps) {
  const labels = usePlaybookLabels();
  const { direction, locale } = useLocaleOrDefault();

  const templatesQuery = useQuery({
    queryKey: ['lex-playbook-templates'],
    queryFn: () => enterpriseApi.lex.listPlaybookTemplates(),
    enabled: open,
  });

  const templates = templatesQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] max-w-2xl overflow-y-auto"
        dir={direction}
        lang={locale}
      >
        <DialogHeader>
          <DialogTitle>{labels.templates.pickerTitle}</DialogTitle>
          <DialogDescription>
            {labels.templates.pickerDescription}
          </DialogDescription>
        </DialogHeader>

        {templatesQuery.isLoading ? (
          <LoadingSkeleton variant="card" count={3} />
        ) : templatesQuery.isError ? (
          <ErrorState
            message={labels.catalog.loadError}
            onRetry={() => void templatesQuery.refetch()}
          />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={labels.templates.empty}
            description={labels.templates.pickerDescription}
          />
        ) : (
          <div className="space-y-3">
            {templates.map((template) => (
              <div
                key={template.key}
                className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-start sm:justify-between"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{template.name}</p>
                    <Badge variant="outline">
                      {labels.contractTypeLabels[String(template.contract_type)] ??
                        formatToken(String(template.contract_type))}
                    </Badge>
                    <Badge variant="secondary">
                      {labels.templates.clauses(template.clauses.length)}
                    </Badge>
                  </div>
                  {template.description ? (
                    <p className="text-sm text-muted-foreground">
                      {template.description}
                    </p>
                  ) : null}
                </div>
                <div className="shrink-0">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onSelect(template);
                      onOpenChange(false);
                    }}
                  >
                    {labels.templates.use}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
