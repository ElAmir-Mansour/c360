'use client';

import { BookOpen, Brain, FileCode2, Shield, Sparkles, LayoutTemplate } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/common/empty-state';
import type { NotebookServer, NotebookTemplate } from '@/lib/notebooks';
import { cn } from '@/lib/utils';
import { useNotebooksLabels } from '../_lib/notebooks-i18n';

const difficultyLabelKey: Record<NotebookTemplate['difficulty'], 'beginner' | 'intermediate' | 'advanced'> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
};

const iconForTemplate = (tags: string[]) => {
  if (tags.includes('spark')) return Sparkles;
  if (tags.includes('ai')) return Brain;
  if (tags.includes('security')) return Shield;
  return BookOpen;
};

const difficultyTone: Record<NotebookTemplate['difficulty'], string> = {
  beginner: 'border-success-300/60 bg-success-50 text-success-700 dark:border-success-700/60 dark:bg-success-700/15 dark:text-success-300',
  intermediate: 'border-warning-300/60 bg-warning-50 text-warning-700 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-300',
  advanced: 'border-primary/25 bg-primary/10 text-primary',
};

interface TemplateGalleryProps {
  templates: NotebookTemplate[];
  activeServer: NotebookServer | null;
  busyTemplateId: string | null;
  onOpenTemplate: (template: NotebookTemplate) => void;
}

export function TemplateGallery({ templates, activeServer, busyTemplateId, onOpenTemplate }: TemplateGalleryProps) {
  const t = useNotebooksLabels();
  if (templates.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 bg-card/60">
        <EmptyState
          icon={LayoutTemplate}
          title={t.templates.emptyTitle}
          description={t.templates.emptyDescription}
          size="compact"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {templates.map((template) => {
        const Icon = iconForTemplate(template.tags);
        return (
          <Card
            key={template.id}
            className="group/template"
          >
            <CardHeader className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-2xl bg-primary/10 p-3 text-primary transition-transform duration-fast group-hover/template:-translate-y-0.5">
                  <Icon className="h-5 w-5" />
                </div>
                <Badge variant="outline" className={cn(difficultyTone[template.difficulty])}>
                  {t.templates[difficultyLabelKey[template.difficulty]]}
                </Badge>
              </div>
              <div>
                <CardTitle className="text-base">{template.title}</CardTitle>
                <CardDescription className="mt-2 min-h-12 leading-6">{template.description}</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                <FileCode2 className="h-3.5 w-3.5 text-primary" />
                <span className="truncate">{template.filename}</span>
              </div>
              <div className="flex min-h-16 flex-wrap content-start gap-2">
                {template.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
              <Button
                className="w-full"
                disabled={!activeServer || busyTemplateId === template.id}
                onClick={() => onOpenTemplate(template)}
              >
                {activeServer ? t.templates.openTemplate : t.templates.launchServerFirst}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
