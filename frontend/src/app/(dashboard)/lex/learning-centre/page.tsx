'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Award, BookOpen, Check, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { useLearningCentreCopy } from './_components/learning-copy';

const STORAGE_KEY = 'watheeq-learning-centre-progress-v1';

function readCompletedModules(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export default function LearningCentrePage() {
  const { locale, direction } = useLocaleOrDefault();
  const copy = useLearningCentreCopy();
  const [completed, setCompleted] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCompleted(readCompletedModules());
    setHydrated(true);
  }, []);

  const validCompleted = useMemo(
    () =>
      completed.filter((id) =>
        copy.modules.some((module) => module.id === id),
      ),
    [completed, copy.modules],
  );
  const progress = hydrated
    ? Math.round((validCompleted.length / copy.modules.length) * 100)
    : 0;
  const remaining = copy.modules.length - validCompleted.length;

  function toggleComplete(id: string) {
    setCompleted((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <LexRouteGuard route="/lex/learning-centre">
      <div className="space-y-6" dir={direction} lang={locale}>
        <PageHeader title={copy.title} description={copy.description} />

        <section className="flex flex-col gap-5 rounded-2xl bg-clario-dark-teal p-6 text-white sm:flex-row sm:items-center">
          <div
            className="grid h-24 w-24 shrink-0 place-items-center rounded-full p-2"
            style={{
              background: `conic-gradient(hsl(var(--ds-success-500)) ${progress}%, rgba(255,255,255,.18) ${progress}% 100%)`,
            }}
            role="img"
            aria-label={copy.progress(progress)}
          >
            <div className="grid h-full w-full place-items-center rounded-full bg-clario-dark-teal text-lg font-bold">
              {progress}%
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Award className="h-5 w-5 text-warning-300" aria-hidden />
              <h2 className="text-xl font-bold">
                {remaining === 0
                  ? copy.completedGoal
                  : copy.progressTitle}
              </h2>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
              {remaining === 0
                ? copy.completedGoalDescription
                : copy.progressDescription(remaining)}
            </p>
          </div>
        </section>

        <section aria-labelledby="learning-modules-title">
          <h2
            id="learning-modules-title"
            className="mb-4 text-lg font-semibold"
          >
            {copy.modulesTitle}
          </h2>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {copy.modules.map((module) => {
              const isComplete = validCompleted.includes(module.id);
              const moduleProgress = isComplete ? 100 : 0;
              return (
                <Card key={module.id} className="h-full">
                  <CardContent className="flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                        <BookOpen className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="text-xs font-semibold text-primary">
                        {isComplete ? copy.completed : copy.progress(0)}
                      </span>
                    </div>
                    <p className="mt-4 text-xs text-muted-foreground">
                      {module.duration} · {module.level}
                    </p>
                    <h3 className="mt-1 font-semibold">{module.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">
                      {module.description}
                    </p>
                    <Progress
                      value={moduleProgress}
                      className="mt-4 h-2"
                      aria-label={copy.progress(moduleProgress)}
                    />
                    <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                      <Button variant="outline" className="flex-1" asChild>
                        <Link href={module.href}>
                          <ExternalLink
                            className="me-2 h-4 w-4"
                            aria-hidden
                          />
                          {copy.openGuide}
                        </Link>
                      </Button>
                      <Button
                        type="button"
                        variant={isComplete ? 'secondary' : 'default'}
                        className={
                          isComplete
                            ? 'flex-1'
                            : 'flex-1 bg-brand-primary-600 text-white hover:bg-brand-primary-700'
                        }
                        onClick={() => toggleComplete(module.id)}
                      >
                        {isComplete ? (
                          <Check className="me-2 h-4 w-4" aria-hidden />
                        ) : null}
                        {isComplete ? copy.completed : copy.complete}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      </div>
    </LexRouteGuard>
  );
}
