'use client';

import { type ReactElement, useCallback, useEffect, useState } from 'react';
import {
  BookText,
  ClipboardList,
  FileSignature,
  FileText,
  Languages,
  Layers,
  PenLine,
  ScrollText,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { LexRouteGuard } from '../_guards/lex-route-guard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLocale } from '@/components/providers/locale-provider';
import { AssemblyTask } from './_components/assembly-task';
import { ClauseTask } from './_components/clause-task';
import { ContractTask } from './_components/contract-task';
import { FallbacksTask } from './_components/fallbacks-task';
import { GlossaryTask } from './_components/glossary-task';
import { ObligationQaTask } from './_components/obligation-qa-task';
import { RewriteTask } from './_components/rewrite-task';
import { RfpTask } from './_components/rfp-task';
import { SummarizeTask } from './_components/summarize-task';
import { TranslateTask } from './_components/translate-task';
import { type DraftingLabels, useDraftingLabels } from './_components/drafting-shared';
import { DraftingWorkspaceCockpit } from './_components/drafting-workspace-cockpit';
import { DraftingCommandBar, DraftingHistoryPanel } from './_components/drafting-workspace-panels';
import {
  DEFAULT_DRAFTING_WORKSPACE_ID,
  DRAFTING_NAVIGATE_EVENT,
  type DraftingHandoff,
  type DraftingTaskKey,
  normalizeDraftingWorkspaceId,
  normalizeOptionalDraftingId,
  restoreDraftingWorkspaceVersion,
  setActiveDraftingWorkspaceContext,
  writeDraftingHandoff,
} from './_components/drafting-workspace';

type DraftingTab = DraftingTaskKey;

type DraftingTabKey =
  | 'clause'
  | 'contract'
  | 'rewrite'
  | 'fallbacks'
  | 'translate'
  | 'summarize'
  | 'glossary'
  | 'rfp'
  | 'obligationQa'
  | 'assembly';

const DRAFTING_TAB_KEYS: DraftingTab[] = [
  'clause',
  'contract',
  'rewrite',
  'fallbacks',
  'translate',
  'summarize',
  'glossary',
  'rfp',
  'obligationQa',
  'assembly',
];

interface DraftingRouteState {
  activeTab: DraftingTab;
  workspaceId: string;
  projectId?: string;
  activeVersionId?: string;
}

interface DraftingTabConfig {
  value: DraftingTabKey;
  label: string;
  icon: LucideIcon;
  render: () => ReactElement;
}

function isDraftingTab(value: string | null | undefined): value is DraftingTab {
  return Boolean(value && DRAFTING_TAB_KEYS.includes(value as DraftingTab));
}

function readHandoffString(handoff: DraftingHandoff, key: string): string | undefined {
  const value = handoff.payload?.[key];
  return typeof value === 'string' ? value : undefined;
}

function readDraftingRouteState(): DraftingRouteState {
  if (typeof window === 'undefined') {
    return {
      activeTab: 'clause',
      workspaceId: DEFAULT_DRAFTING_WORKSPACE_ID,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab') ?? params.get('task');
  const projectId = normalizeOptionalDraftingId(params.get('project') ?? params.get('projectId'));
  const activeVersionId = normalizeOptionalDraftingId(params.get('result') ?? params.get('version'));
  return {
    activeTab: isDraftingTab(tabParam) ? tabParam : 'clause',
    workspaceId: normalizeDraftingWorkspaceId(
      params.get('workspace') ?? params.get('workspaceId') ?? params.get('w') ?? projectId,
    ),
    projectId,
    activeVersionId,
  };
}

function replaceDraftingRouteState(state: DraftingRouteState): void {
  if (typeof window === 'undefined') return;
  if (process.env.NODE_ENV === 'test') return;
  const url = new URL(window.location.href);
  url.searchParams.set('tab', state.activeTab);
  url.searchParams.set('workspace', state.workspaceId);
  url.searchParams.delete('task');
  url.searchParams.delete('workspaceId');
  url.searchParams.delete('w');

  if (state.projectId) {
    url.searchParams.set('project', state.projectId);
  } else {
    url.searchParams.delete('project');
  }
  url.searchParams.delete('projectId');

  if (state.activeVersionId) {
    url.searchParams.set('result', state.activeVersionId);
  } else {
    url.searchParams.delete('result');
  }
  url.searchParams.delete('version');

  const nextUrl = `${url.pathname}${url.search ? url.search : ''}${url.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function buildDraftingTabs(labels: DraftingLabels): DraftingTabConfig[] {
  return [
    { value: 'clause', label: labels.tabs.clause, icon: Sparkles, render: () => <ClauseTask /> },
    { value: 'contract', label: labels.tabs.contract, icon: FileSignature, render: () => <ContractTask /> },
    { value: 'rewrite', label: labels.tabs.rewrite, icon: PenLine, render: () => <RewriteTask /> },
    { value: 'fallbacks', label: labels.tabs.fallbacks, icon: Layers, render: () => <FallbacksTask /> },
    { value: 'translate', label: labels.tabs.translate, icon: Languages, render: () => <TranslateTask /> },
    { value: 'summarize', label: labels.tabs.summarize, icon: ScrollText, render: () => <SummarizeTask /> },
    { value: 'glossary', label: labels.tabs.glossary, icon: BookText, render: () => <GlossaryTask /> },
    { value: 'rfp', label: labels.tabs.rfp, icon: ClipboardList, render: () => <RfpTask /> },
    { value: 'obligationQa', label: labels.tabs.obligationQa, icon: ShieldCheck, render: () => <ObligationQaTask /> },
    { value: 'assembly', label: labels.tabs.assembly, icon: FileText, render: () => <AssemblyTask /> },
  ];
}

export default function LexDraftingPage() {
  const [routeState, setRouteState] = useState<DraftingRouteState>(() => readDraftingRouteState());
  const { activeTab, workspaceId, projectId, activeVersionId } = routeState;
  const { locale, direction } = useLocale();
  const labels = useDraftingLabels();
  const draftingTabs = buildDraftingTabs(labels);
  const taskOptions = draftingTabs.map((tab) => ({ value: tab.value, label: tab.label }));

  const setActiveTab = useCallback((task: DraftingTab) => {
    setRouteState((current) => ({ ...current, activeTab: task, activeVersionId: undefined }));
  }, []);

  const setWorkspaceRoute = useCallback((nextWorkspaceId: string, nextProjectId?: string) => {
    setRouteState((current) => ({
      ...current,
      workspaceId: normalizeDraftingWorkspaceId(nextWorkspaceId),
      projectId: normalizeOptionalDraftingId(nextProjectId),
      activeVersionId: undefined,
    }));
  }, []);

  useEffect(() => {
    const syncFromLocation = () => setRouteState(readDraftingRouteState());
    syncFromLocation();
    window.addEventListener('popstate', syncFromLocation);
    return () => window.removeEventListener('popstate', syncFromLocation);
  }, []);

  useEffect(() => {
    setActiveDraftingWorkspaceContext({
      workspaceId,
      projectId,
      activeTask: activeTab,
    });
    replaceDraftingRouteState(routeState);
  }, [activeTab, projectId, routeState, workspaceId]);

  useEffect(() => {
    const handleNavigate = (event: Event) => {
      const detail = (event as CustomEvent<DraftingHandoff>).detail;
      if (detail?.target) {
        setRouteState((current) => ({
          activeTab: detail.target,
          workspaceId: normalizeDraftingWorkspaceId(readHandoffString(detail, 'workspace_id') ?? current.workspaceId),
          projectId: normalizeOptionalDraftingId(readHandoffString(detail, 'project_id') ?? current.projectId),
          activeVersionId: normalizeOptionalDraftingId(readHandoffString(detail, 'version_id')),
        }));
      }
    };
    window.addEventListener(DRAFTING_NAVIGATE_EVENT, handleNavigate);
    return () => window.removeEventListener(DRAFTING_NAVIGATE_EVENT, handleNavigate);
  }, []);

  return (
    <LexRouteGuard route="/lex/drafting">
      <div className="space-y-6 motion-safe:animate-fade-up" dir={direction} lang={locale}>
        <PageHeader title={labels.page.title} description={labels.page.description} eyebrow={labels.page.eyebrow} />

        <DraftingCommandBar
          tasks={taskOptions}
          activeTask={activeTab}
          onTaskChange={setActiveTab}
        />

        <DraftingWorkspaceCockpit
          tasks={taskOptions}
          activeTask={activeTab}
          workspaceId={workspaceId}
          projectId={projectId}
          activeVersionId={activeVersionId}
          onTaskChange={setActiveTab}
          onWorkspaceChange={setWorkspaceRoute}
          onRestoreVersion={(version) => {
            const restored = restoreDraftingWorkspaceVersion(workspaceId, version.id) ?? version;
            const payload: NonNullable<DraftingHandoff['payload']> = {
              workspace_id: workspaceId,
              version_id: restored.id,
            };
            if (projectId) payload.project_id = projectId;
            writeDraftingHandoff({
              target: restored.task,
              text: restored.text,
              title: restored.title,
              payload,
            });
            setRouteState((current) => ({
              ...current,
              activeTab: restored.task,
              activeVersionId: restored.id,
            }));
          }}
        />

        <DraftingHistoryPanel
          onOpen={(record) => {
            const payload: NonNullable<DraftingHandoff['payload']> = {
              record_id: record.id,
              workspace_id: workspaceId,
            };
            if (projectId) payload.project_id = projectId;
            writeDraftingHandoff({
              target: record.task,
              text: record.text,
              title: record.title,
              payload,
            });
            setActiveTab(record.task);
          }}
        />

        <Tabs value={activeTab} onValueChange={(value) => isDraftingTab(value) && setActiveTab(value)}>
          <TabsList className="flex-wrap">
            {draftingTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {draftingTabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value} className="mt-6 motion-safe:animate-fade-up">
              {tab.render()}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </LexRouteGuard>
  );
}
